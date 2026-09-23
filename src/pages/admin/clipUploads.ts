/**
 * Clip uploads, held outside React.
 *
 * A dropped clip can be 80MB and take a minute. If the upload lived in the Clips
 * page's state it would die the moment Jared clicked another tab, which is exactly
 * how "Upload failed: ... Load failed" happens. So the queue is a module singleton:
 * the page mounts and unmounts around it, the transfers keep going, and the header
 * pill (ClipActivity) reads the same store from anywhere in the admin.
 *
 * XHR rather than supabase-js storage.upload because we want real progress events.
 *
 * Big files go up in parts. The project's storage has a global per-object cap (50MB) that sits
 * under the bucket's own 200MB limit, so an 80MB meeting recording used to fail every time:
 * "413 EntityTooLarge" in Chrome, a bare "Load failed" in Safari. Now anything over PART_BYTES is
 * split into <path>.part000, .part001, ... and voice_clips.parts records the count; the Mac worker
 * and the player stitch the bytes back together. Each part retries on its own, and if the server
 * still says too big, the part size halves and it starts over (self-adjusting, no code change).
 * A final failure is reported to Scout (admin_report -> fix ladder), and the next success clears it.
 */
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = "https://rcqfqhguwpmaarseifqg.supabase.co";
const BUCKET = "voice-clips";
/** Under the project's 50MB global object cap, with room to spare. */
let PART_BYTES = 40 * 1024 * 1024;
const MIN_PART_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const TRIES = 4;

class TooBig extends Error {}

/** Tell Scout (monitor incident admin.clips.upload), or clear it after a success. Never throws. */
function report(ok: boolean, detail: string) {
  void (supabase.rpc as any)("admin_report", { p_where: "clips.upload", p_detail: detail, p_ok: ok }).then(
    () => {},
    () => {},
  );
}

export type ClipUpload = {
  id: string;
  name: string;
  bytes: number;
  sent: number;
  /** 0-1, or null before the first progress event */
  pct: number | null;
  status: "uploading" | "saving" | "done" | "error";
  /** "meeting" when dropped on the Calls tab: it goes through the call recorder's pipeline. */
  kind?: "meeting" | "note" | null;
  error?: string;
  startedAt: number;
};

type Listener = (items: ClipUpload[]) => void;

const items = new Map<string, ClipUpload>();
const listeners = new Set<Listener>();
const xhrs = new Map<string, XMLHttpRequest>();

const snapshot = () => [...items.values()].sort((a, b) => a.startedAt - b.startedAt);
const emit = () => {
  const s = snapshot();
  for (const fn of listeners) fn(s);
};

export function subscribeClipUploads(fn: Listener) {
  listeners.add(fn);
  fn(snapshot());
  return () => {
    listeners.delete(fn);
  };
}

export const activeUploads = () => snapshot().filter((u) => u.status === "uploading" || u.status === "saving");

/** Clear a finished row (done or error). In-flight rows ignore this. */
export function dismissUpload(id: string) {
  const u = items.get(id);
  if (!u || u.status === "uploading" || u.status === "saving") return;
  items.delete(id);
  emit();
}

export function cancelUpload(id: string) {
  xhrs.get(id)?.abort();
  xhrs.delete(id);
  items.delete(id);
  emit();
}

/** Called when a clip row lands, so the Clips page can refresh without polling. */
export const CLIPS_CHANGED = "bestly:clips-changed";
const changed = () => window.dispatchEvent(new Event(CLIPS_CHANGED));

// Warn before closing the tab while bytes are still moving. Navigating inside the
// admin is fine - only a real unload kills the transfer.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!activeUploads().length) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

function put(url: string, token: string, body: Blob, type: string, up: ClipUpload, base: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrs.set(up.id, xhr);
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      up.sent = base + e.loaded;
      up.pct = up.bytes ? up.sent / up.bytes : null;
      emit();
    };
    xhr.onload = () => {
      xhrs.delete(up.id);
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `${xhr.status}`;
      let big = xhr.status === 413;
      try {
        const b = JSON.parse(xhr.responseText);
        msg = b.message || b.error || msg;
        // Storage answers HTTP 400 with statusCode "413" in the body for an oversize object.
        if (String(b.statusCode) === "413" || /exceeded the maximum allowed size|payload too large/i.test(msg)) big = true;
      } catch {
        if (xhr.responseText) msg = xhr.responseText.slice(0, 200);
      }
      if (big) return reject(new TooBig(`too big for storage (${msg})`));
      const err = new Error(`${xhr.status} ${msg}`);
      (err as Error & { status?: number }).status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => {
      xhrs.delete(up.id);
      reject(new Error("the connection dropped"));
    };
    xhr.onabort = () => {
      xhrs.delete(up.id);
      reject(new Error("cancelled"));
    };
    xhr.send(body);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One object, retried: a dropped connection (Safari "Load failed") or a 5xx gets another go. */
async function putWithRetry(url: string, token: () => Promise<string>, body: Blob, type: string, up: ClipUpload, base: number) {
  let last: unknown;
  for (let i = 0; i < TRIES; i++) {
    if (!items.has(up.id)) throw new Error("cancelled");
    try {
      return await put(url, await token(), body, type, up, base);
    } catch (e) {
      last = e;
      const status = (e as { status?: number }).status ?? 0;
      if (e instanceof TooBig || (e as Error).message === "cancelled") throw e;
      // 409 = this exact part already landed on an earlier try; that's a success.
      if (status === 409) return;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) throw e;
      await wait(1500 * 2 ** i);
    }
  }
  throw last;
}

/** Queue one file. Returns once it's finished, but nothing needs to await it. */
export async function startClipUpload(file: File, kind: "meeting" | "note" | null = null) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const up: ClipUpload = {
    id, name: file.name, bytes: file.size, sent: 0, pct: null,
    status: "uploading", startedAt: Date.now(), kind,
  };
  items.set(id, up);
  emit();

  const clean = file.name.replace(/[^\w.\- ]+/g, "").slice(-120) || "clip.m4a";
  try {
    if (file.size > MAX_TOTAL_BYTES) throw new Error("over 2GB - trim the recording first");
    // Fresh token per request: a long upload can outlive the one we started with.
    const token = async () => {
      const { data: s } = await supabase.auth.getSession();
      const t = s.session?.access_token;
      if (!t) throw new Error("signed out");
      return t;
    };
    await token();

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const type = file.type || "application/octet-stream";
    let path = `upload/${stamp}-${clean}`;
    let parts: number | null = null;

    // Try the current part size; if storage still says too big, halve it and start over.
    for (;;) {
      try {
        if (file.size <= PART_BYTES) {
          await putWithRetry(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, token, file, type, up, 0);
          parts = null;
        } else {
          const n = Math.ceil(file.size / PART_BYTES);
          for (let i = 0; i < n; i++) {
            const from = i * PART_BYTES;
            const name = `${path}.part${String(i).padStart(3, "0")}`;
            await putWithRetry(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(name)}`, token,
              file.slice(from, Math.min(file.size, from + PART_BYTES)), "application/octet-stream", up, from);
          }
          parts = n;
        }
        break;
      } catch (e) {
        if (!(e instanceof TooBig) || PART_BYTES <= MIN_PART_BYTES) throw e;
        PART_BYTES = Math.max(MIN_PART_BYTES, Math.floor(PART_BYTES / 2));
        path = `upload/${stamp}-${PART_BYTES}-${clean}`; // new names; the old half-set is just ignored
        up.sent = 0; up.pct = 0; emit();
      }
    }

    up.status = "saving";
    up.pct = 1;
    emit();

    const { error } = await supabase.from("voice_clips").insert({
      title: clean.replace(/\.[^.]+$/, ""),
      path,
      bytes: file.size,
      source: "upload",
      recorded_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      parts,
      kind,
    } as never);
    if (error) throw error;
    report(true, `${clean} (${Math.round(file.size / 1048576)}MB${parts ? `, ${parts} parts` : ""}) uploaded fine.`);

    up.status = "done";
    emit();
    changed();
    // A finished row clears itself; an error stays until it's dismissed.
    setTimeout(() => dismissUpload(id), 4000);
  } catch (e) {
    if (!items.has(id)) return;            // cancelled
    up.status = "error";
    up.error = e instanceof Error ? e.message : String(e);
    emit();
    changed();
    report(false, `Clip upload failed on /admin (Meetings > Clips).\nFile: ${clean}, ${Math.round(file.size / 1048576)}MB, ${file.type || "no type"}\n`
      + `Error: ${up.error}\nPart size: ${Math.round(PART_BYTES / 1048576)}MB\nBrowser: ${navigator.userAgent}\n`
      + `Code: src/pages/admin/clipUploads.ts (parts upload) and scripts/clips/clips.py (stitching).`);
  }
}
