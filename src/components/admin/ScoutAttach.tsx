/**
 * Files you hand to Scout.
 *
 * Attach by the paperclip, by dragging onto the panel, or by pasting a screenshot. Each file is uploaded to the
 * private scout-files bucket and read straight away by the scout-file function, so a file that can't be read says
 * so before you send rather than after.
 *
 * Two copies of every picture, PDF and video travel in the message:
 *   - a text copy ("[File: …]" block, free vision model first) for the history and for free Scout, and
 *   - a machine line  ⟦scout-files: <path>|<path> kind=image|pdf|video⟧  right under the header. admin-chat reads
 *     that line and hands paid Scout the real pixels (images, PDF pages, video frames) instead of the text copy,
 *     and the `look` tool can open the same paths again later.
 *
 * Videos are never uploaded whole: the browser reads the file locally (up to 500 MB), cuts a few frames, and
 * uploads those as JPEGs. HEIC photos and very large images are shrunk to a JPEG in the browser first.
 *
 * Text, code, CSV and JSON never touch a model and cost nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Film, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type ScoutFileKind = "image" | "pdf" | "text" | "video";

export interface ScoutFile {
  id: string;
  name: string;
  size: number;
  kind: ScoutFileKind | null;
  /** The text copy: file contents, a picture's transcript, a video's summary. */
  text: string | null;
  error: string | null;
  reading: boolean;
  /** What a long job is doing right now, e.g. "cutting frame 3 of 9". */
  step: string | null;
  /** scout-files storage paths: one for a picture or PDF, one per frame for a video. */
  paths: string[];
  frames: number;
  /** Seconds, videos only. */
  duration: number;
  /** A problem that doesn't stop the file from being sent (no text copy could be made, but the pixels are attached). */
  note: string | null;
}

const MAX = 25 * 1024 * 1024;
const MAX_VIDEO = 500 * 1024 * 1024;
const NBSP = " ";
const kb = (n: number) => (n < 1024 ? `${n}${NBSP}B` : n < 1024 * 1024 ? `${Math.round(n / 1024)}${NBSP}KB` : `${(n / 1048576).toFixed(1)}${NBSP}MB`);
const slug = (s: string) => s.replace(/[^\w.-]+/g, "-").slice(-80);
const today = () => new Date().toISOString().slice(0, 10);
const noBreaks = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** 42 seconds -> "0:42", 125 -> "2:05". */
export const clock = (secs: number) => {
  const t = Math.max(0, Math.round(secs));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const HEIC = /heic|heif/i;
const isVideo = (f: File) => f.type.startsWith("video/") || VIDEO_EXT.test(f.name);
const isHeic = (f: File) => HEIC.test(f.type) || /\.(heic|heif)$/i.test(f.name);
const VIDEO_ERROR = "This video won't open in the browser; try an MP4";

const IMAGE_BIG = 2000;     // longer side above this is shrunk before upload
const IMAGE_TARGET = 1600;
const FRAME_LONG_SIDE = 1280;

// ---------------------------------------------------------------- pictures

async function decodeImage(file: Blob): Promise<{ w: number; h: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void } | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { w: bmp.width, h: bmp.height, draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), close: () => bmp.close() };
  } catch { /* try the older route */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight, draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

const toJpeg = (canvas: HTMLCanvasElement, q: number) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", q));

/**
 * What to upload for a picture. HEIC/HEIF and anything over 2000 px on its long side becomes a JPEG with a long side
 * of at most 1600 px (when this browser can decode it); everything else goes up untouched.
 */
async function prepImage(file: File): Promise<{ body: Blob; type: string; name: string } | { error: string }> {
  const heic = isHeic(file);
  const keep = { body: file as Blob, type: file.type || "application/octet-stream", name: file.name };
  const dec = await decodeImage(file);
  if (!dec) return heic ? { error: "This browser can't open HEIC photos; try a JPEG or PNG" } : keep;
  try {
    const long = Math.max(dec.w, dec.h);
    if (!heic && long <= IMAGE_BIG) return keep;
    const scale = Math.min(1, IMAGE_TARGET / long);
    const w = Math.max(1, Math.round(dec.w * scale)), h = Math.max(1, Math.round(dec.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return heic ? { error: "This browser can't open HEIC photos; try a JPEG or PNG" } : keep;
    ctx.fillStyle = "#fff";            // a transparent PNG would turn black in a JPEG
    ctx.fillRect(0, 0, w, h);
    dec.draw(ctx, w, h);
    const blob = await toJpeg(canvas, 0.85);
    if (!blob) return heic ? { error: "This browser couldn't convert that photo; try a JPEG or PNG" } : keep;
    return { body: blob, type: "image/jpeg", name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } finally {
    dec.close();
  }
}

// ---------------------------------------------------------------- video

/** Wait for one of the events on an element, or give up. Resolves "ok" / "error" / "timeout". */
function waitFor(el: HTMLVideoElement, ok: string[], ms: number): Promise<"ok" | "error" | "timeout"> {
  return new Promise((resolve) => {
    const done = (r: "ok" | "error" | "timeout") => {
      clearTimeout(timer);
      ok.forEach((e) => el.removeEventListener(e, onOk));
      el.removeEventListener("error", onErr);
      resolve(r);
    };
    const onOk = () => done("ok");
    const onErr = () => done("error");
    const timer = setTimeout(() => done("timeout"), ms);
    ok.forEach((e) => el.addEventListener(e, onOk, { once: true }));
    el.addEventListener("error", onErr, { once: true });
  });
}

/** How many frames a clip gets: one every ~5 seconds, never fewer than 3 or more than 12. */
export const frameCount = (duration: number) => Math.min(12, Math.max(3, Math.ceil(duration / 5)));

interface Frames { duration: number; blobs: Blob[] }

/** Cut evenly spaced frames out of a local video. Returns an error line instead of throwing. */
async function cutFrames(file: File, onStep: (s: string) => void): Promise<Frames | { error: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.src = url;
  try {
    const loaded = await waitFor(video, ["loadeddata", "loadedmetadata"], 20_000);
    if (loaded !== "ok" || !video.videoWidth || !video.videoHeight) return { error: VIDEO_ERROR };
    // Some WebM files report an unknown length until the end is read: jumping far ahead makes the browser work it out.
    if (!Number.isFinite(video.duration)) {
      video.currentTime = 1e9;
      await waitFor(video, ["durationchange", "seeked"], 5000);
      video.currentTime = 0;
      await waitFor(video, ["seeked"], 3000);
    }
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return { error: VIDEO_ERROR };

    const n = frameCount(duration);
    const scale = Math.min(1, FRAME_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale)), h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: VIDEO_ERROR };

    const blobs: Blob[] = [];
    for (let i = 0; i < n; i++) {
      onStep(`frame ${i + 1} of ${n}`);
      // Middle of each slice, so the first frame isn't a black fade-in and the last isn't the final blank frame.
      const at = Math.min(duration - 0.05, (duration * (i + 0.5)) / n);
      video.currentTime = Math.max(0, at);
      const seeked = await waitFor(video, ["seeked"], 8000);
      if (seeked === "error") return { error: VIDEO_ERROR };
      if (seeked === "timeout") continue;            // skip a frame that never arrived rather than send a copy of the last one
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await toJpeg(canvas, 0.82);
      if (blob) blobs.push(blob);
    }
    if (!blobs.length) return { error: VIDEO_ERROR };
    return { duration, blobs };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------- the hook

type ReadReply = { ok?: boolean; kind?: ScoutFileKind; text?: string; error?: string } | null;

export function useScoutFiles() {
  const [files, setFiles] = useState<ScoutFile[]>([]);
  const patch = (id: string, p: Partial<ScoutFile>) => setFiles((xs) => xs.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const add = useCallback(async (picked: File[]) => {
    for (const file of picked.slice(0, 5)) {
      const video = isVideo(file);
      if (file.size > (video ? MAX_VIDEO : MAX)) { toast.error(`${file.name} is over ${video ? "500" : "25"}${NBSP}MB`); continue; }
      const id = crypto.randomUUID();
      const name = noBreaks(file.name);
      const blank: ScoutFile = { id, name, size: file.size, kind: video ? "video" : null, text: null, error: null, reading: true, step: null, paths: [], frames: 0, duration: 0, note: null };
      setFiles((xs) => [...xs, blank]);
      const fail = (error: string) => patch(id, { reading: false, step: null, error });

      if (video) {
        patch(id, { step: "opening" });
        const cut = await cutFrames(file, (step) => patch(id, { step }));
        if ("error" in cut) { fail(cut.error); continue; }
        const base = slug(file.name.replace(/\.[^.]+$/, ""));
        patch(id, { step: "uploading" });
        const paths = cut.blobs.map((_, i) => `${today()}/${id}-${base}-f${String(i + 1).padStart(2, "0")}.jpg`);
        const ups = await Promise.all(cut.blobs.map((b, i) =>
          supabase.storage.from("scout-files").upload(paths[i], b, { contentType: "image/jpeg", upsert: false })));
        const bad = ups.find((u) => u.error);
        if (bad?.error) { fail(bad.error.message); continue; }
        patch(id, { paths, frames: paths.length, duration: cut.duration, step: "watching" });
        const { data, error } = await supabase.functions.invoke("scout-file", { body: { op: "frames", paths, name } });
        const r = data as ReadReply;
        if (error || !r?.ok) {
          // The frames are safe in storage, so Scout can still look at them; only the text copy is missing.
          const why = r?.error ?? error?.message ?? "no text copy";
          patch(id, { reading: false, step: null, kind: "video", text: `(No text summary could be made: ${why}. The frames are attached; look at them directly.)`, note: "no text summary" });
        } else {
          patch(id, { reading: false, step: null, kind: "video", text: r.text ?? "" });
        }
        continue;
      }

      let body: Blob = file, type = file.type || "application/octet-stream", upName = file.name;
      if (file.type.startsWith("image/") || isHeic(file)) {
        patch(id, { step: "preparing" });
        const prep = await prepImage(file);
        if ("error" in prep) { fail(prep.error); continue; }
        body = prep.body; type = prep.type; upName = prep.name;
      }
      const path = `${today()}/${id}-${slug(upName)}`;
      patch(id, { step: null });
      const up = await supabase.storage.from("scout-files").upload(path, body, { contentType: type, upsert: false });
      if (up.error) { fail(up.error.message); continue; }
      const { data, error } = await supabase.functions.invoke("scout-file", { body: { op: "read", path } });
      const r = data as ReadReply;
      const picture = type.startsWith("image/") && /^image\/(png|jpe?g|gif|webp)$/i.test(type);
      const pdf = type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (error || !r?.ok) {
        const why = r?.error ?? error?.message ?? "Couldn't read that one";
        if (picture || pdf) {
          // Uploaded fine, so paid Scout (and the look tool) can still see it; only the text copy failed.
          patch(id, { reading: false, kind: picture ? "image" : "pdf", paths: [path], text: `(No text copy could be made: ${why}. The file is attached; look at it directly.)`, note: "no text copy" });
        } else fail(why);
        continue;
      }
      const kind = r.kind ?? "text";
      patch(id, { reading: false, kind, text: r.text ?? "", paths: kind === "image" || kind === "pdf" ? [path] : [] });
    }
  }, []);

  const drop = useCallback(() => setFiles([]), []);
  const remove = useCallback((id: string) => setFiles((xs) => xs.filter((f) => f.id !== id)), []);

  /** What actually goes to Scout: the files first, then the question. */
  const compose = useCallback((question: string) => {
    const ready = files.filter((f) => !f.error && (f.text || f.paths.length));
    // A file that couldn't be read still goes along as a note, so Scout says so instead of acting as if nothing came.
    const failed = files.filter((f) => f.error && !f.text).map((f) => `[File: ${f.name} — couldn't be read: ${f.error}]`);
    if (!ready.length && !failed.length) return question;
    const blocks = [...ready.map((f) => fileBlock(f)), ...failed];
    return `${blocks.join("\n\n")}\n\n---\n${question || "Read this and tell me what you make of it."}`;
  }, [files]);

  const busy = files.some((f) => f.reading);
  return { files, add, drop, remove, compose, busy, count: files.length };
}

/** One file's block in the message: the header, the machine line (pictures, PDFs, videos), then the text copy. */
function fileBlock(f: ScoutFile): string {
  const marker = f.paths.length && (f.kind === "image" || f.kind === "pdf" || f.kind === "video")
    ? `⟦scout-files: ${f.paths.join("|")} kind=${f.kind}⟧\n` : "";
  if (f.kind === "video") {
    return `[Video: ${f.name}, ${clock(f.duration)}, ${f.frames} frame${f.frames === 1 ? "" : "s"} — what happens in it]\n${marker}${f.text ?? ""}`;
  }
  const what = f.kind === "image" ? " — what the image shows" : f.kind === "pdf" ? " — the document's text" : "";
  return `[File: ${f.name}${what}]\n${marker}${f.text ?? ""}`;
}

// ---------------------------------------------------------------- reading a sent message

export interface SentFile {
  name: string;
  kind: ScoutFileKind;
  /** scout-files paths (empty for text files and for files that couldn't be read). */
  paths: string[];
  /** The text copy that came with the file. */
  summary: string;
}

const MARKER = /^⟦scout-files:\s*([^⟧]+?)\s+kind=(image|pdf|video)⟧[ \t]*(?:\n|$)/;
const HEADER = /(?:^|\n\n)\[(File|Video): ([^\n]*)\](?=\n|$)/g;
const FILE_TAIL = / — (?:what the image shows|the document's text|couldn't read.*|couldn't be read.*)$/;
const VIDEO_HEAD = /^(.*?)(?:, \d+:\d{2})?, \d+ frames?(?: — .*)?$/;

/**
 * Takes a sent message apart: the files that rode along (name, kind, storage paths, text copy) and what he typed.
 * A message with no file blocks comes back unchanged with an empty file list.
 */
export function splitFiles(body: string): { files: SentFile[]; text: string } {
  const none = { files: [] as SentFile[], text: body };
  if (!/^\[(File|Video): /.test(body)) return none;
  const cut = body.lastIndexOf("\n\n---\n");
  const head = cut >= 0 ? body.slice(0, cut) : body;
  const text = cut >= 0 ? body.slice(cut + 5).trim() : "";
  const found = [...head.matchAll(HEADER)];
  if (!found.length) return none;

  const files = found.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < found.length ? (found[i + 1].index ?? head.length) : head.length;
    let rest = head.slice(start, end).replace(/^\n/, "");
    const label = m[2];
    let kind: ScoutFileKind = m[1] === "Video" ? "video"
      : / — what the image shows$/.test(label) ? "image"
      : / — the document's text$/.test(label) ? "pdf" : "text";
    const name = m[1] === "Video" ? (label.match(VIDEO_HEAD)?.[1] ?? label) : label.replace(FILE_TAIL, "");
    let paths: string[] = [];
    const mk = rest.match(MARKER);
    if (mk) {
      paths = mk[1].split("|").map((p) => p.trim()).filter(Boolean);
      kind = mk[2] as ScoutFileKind;
      rest = rest.slice(mk[0].length);
    }
    return { name, kind, paths, summary: rest.trim() } as SentFile;
  });
  return { files, text };
}

// ---------------------------------------------------------------- showing files

export function AttachButton({ onPick, disabled }: { onPick: (f: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input} type="file" multiple className="hidden"
        accept="image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm,application/pdf,text/*,.md,.csv,.json,.log,.ts,.tsx,.js,.jsx,.py,.sql,.yml,.yaml"
        onChange={(e) => { onPick([...(e.target.files ?? [])]); e.target.value = ""; }}
      />
      <button
        type="button" onClick={() => input.current?.click()} disabled={disabled}
        aria-label="Attach a file, photo or video for Scout to look at"
        className="scout-press grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white/60 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40 sm:h-[2.375rem] sm:w-[2.375rem]"
      >
        <Paperclip className="h-4 w-4" aria-hidden />
      </button>
    </>
  );
}

export function AttachBar({ files, onRemove }: { files: ScoutFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {files.map((f) => {
        const Icon = f.kind === "image" ? ImageIcon : f.kind === "video" ? Film : FileText;
        const status = f.error ? f.error
          : f.reading ? (f.step ? `Reading, ${f.step}` : "Reading")
          : f.note ? f.note
          : f.kind === "image" ? "looked at"
          : f.kind === "video" ? `${f.frames}${NBSP}frames, ${clock(f.duration)}`
          : kb(f.size);
        return (
          <li key={f.id}
            className={cn("flex min-h-11 max-w-full items-center gap-1.5 rounded-lg py-1 pl-2 pr-1 text-xs",
              f.error ? "bg-red-500/15 text-red-200 bento:text-red-800" : "bg-white/[0.07] text-white/85")}>
            {f.reading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0 [overflow-wrap:anywhere]">{f.name}</span>
            <span className={cn("min-w-0 text-white/60", f.note && !f.error && "text-amber-200/90 bento:text-amber-800")}>{status}</span>
            <button type="button" onClick={() => onRemove(f.id)} aria-label={`Remove ${f.name}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded text-white/60 transition hover:bg-white/10 hover:text-white">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The pictures, PDFs and videos in a sent message, as 64 px tiles. Pictures and videos show a thumbnail from a
 * signed link (a video shows its middle frame and how many frames Scout was given); a PDF is a labelled tile.
 * Names wrap instead of being cut off. Tapping a thumbnail opens it full size in a new tab.
 */
export function FileChips({ files, className }: { files: SentFile[]; className?: string }) {
  const paths = useMemo(() => files.flatMap((f) => (f.kind === "image" || f.kind === "video" ? [thumbPath(f)] : [])).filter(Boolean), [files]);
  const key = paths.join("\n");
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!paths.length) return;
    let alive = true;
    supabase.storage.from("scout-files").createSignedUrls(paths, 3600).then(({ data }) => {
      if (!alive || !data) return;
      setUrls(Object.fromEntries(data.filter((d) => d.path && d.signedUrl).map((d) => [d.path as string, d.signedUrl])));
    }, () => { /* tiles fall back to icons */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!files.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {files.map((f, i) => {
        const src = urls[thumbPath(f)];
        const visual = f.kind === "image" || f.kind === "video";
        const Icon = f.kind === "video" ? Film : f.kind === "image" ? ImageIcon : FileText;
        const tile = (
          <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/[0.07] ring-1 ring-white/10 bento:bg-black/[0.05] bento:ring-black/10">
            {visual && src
              ? <img src={src} alt={f.name} className="h-full w-full object-cover" loading="lazy" />
              : <Icon className="h-6 w-6 text-white/60 bento:text-black/50" aria-hidden />}
            {f.kind === "video" && (
              <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-center text-[10px] font-medium leading-tight text-white">
                {f.paths.length}{NBSP}frames
              </span>
            )}
            {f.kind === "pdf" && (
              <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-center text-[10px] font-semibold leading-tight text-white">PDF</span>
            )}
          </span>
        );
        return (
          <li key={`${f.name}-${i}`} className="flex w-16 flex-col items-center gap-1">
            {visual && src
              ? <a href={src} target="_blank" rel="noreferrer" aria-label={`Open ${f.name}`} className="rounded-xl">{tile}</a>
              : tile}
            <span className="w-full text-center text-[11px] leading-tight text-white/70 [overflow-wrap:anywhere] bento:text-black/60">{f.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The one path a tile draws: a picture's own, a video's middle frame. */
function thumbPath(f: SentFile): string {
  if (!f.paths.length) return "";
  return f.kind === "video" ? f.paths[Math.floor(f.paths.length / 2)] : f.paths[0];
}
