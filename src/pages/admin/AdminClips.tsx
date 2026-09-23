/**
 * /admin/clips - voice clips.
 *
 * Two ways in, one pile out:
 *   - AirDrop a recording from the Soundcore Work (or a phone) to the Mac mini. The clips agent
 *     watches ~/Downloads and ~/BestlyClips/inbox, posts it to the clip-ingest edge function.
 *   - Drop a file anywhere on this page. The browser uploads straight into the voice-clips bucket.
 *
 * Either way the Mac mini transcribes it (talkscribe) and writes a summary back, so a clip goes
 * new -> working -> done on its own. Nothing here talks to the Mac; it polls the table.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { startClipUpload, subscribeClipUploads, dismissUpload, CLIPS_CHANGED, type ClipUpload } from "./clipUploads";

import { AdminMark } from "@/components/AdminMark";
import { PageHeader } from "@/components/admin/PageHeader";
import { askScout } from "@/components/admin/scoutBus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Mic,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

type ClipSummary = {
  title?: string;
  summary?: string;
  points?: string[];
  todos?: string[];
};

type Clip = {
  id: string;
  title: string | null;
  path: string;
  bytes: number;
  seconds: number | null;
  source: string;
  status: "new" | "working" | "done" | "error";
  transcript: string | null;
  summary: ClipSummary | null;
  note: string | null;
  error: string | null;
  recorded_at: string | null;
  created_at: string;
  done_at: string | null;
  /** Big uploads are stored as <path>.part000, .part001, ...; null = one object at path. */
  parts?: number | null;
  /** meeting = goes to Calls too; note = stays a clip; null = 10+ minutes counts as a meeting */
  kind?: "meeting" | "note" | null;
  /** the meeting-YYYYMMDD-HHMM it was filed as in Calls */
  meeting_name?: string | null;
};

const partPaths = (c: Pick<Clip, "path" | "parts">) =>
  c.parts ? Array.from({ length: c.parts }, (_, i) => `${c.path}.part${String(i).padStart(3, "0")}`) : [c.path];

const AUDIO_TYPE: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", caf: "audio/x-caf" };

/** A parted clip plays from its stitched bytes; fetched only when asked (it can be 100MB+). */
function PartsPlayer({ clip }: { clip: Clip }) {
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  const load = async () => {
    setBusy(true); setErr(null);
    try {
      const blobs: Blob[] = [];
      for (const p of partPaths(clip)) {
        const { data, error } = await supabase.storage.from("voice-clips").download(p);
        if (error || !data) throw new Error(error?.message ?? "missing part");
        blobs.push(data);
      }
      const ext = (clip.path.split(".").pop() ?? "").toLowerCase();
      setSrc(URL.createObjectURL(new Blob(blobs, { type: AUDIO_TYPE[ext] ?? "audio/mpeg" })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (src) return <audio controls autoPlay src={src} className="w-full h-10" />;
  return (
    <Button variant="outline" size="sm" className="w-full gap-1.5 border-white/15 bg-white/5" disabled={busy} onClick={() => void load()}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
      {busy ? `Loading ${fmtBytes(clip.bytes)}` : err ? `Couldn't load (${err}) - try again` : `Play (${fmtBytes(clip.bytes)})`}
    </Button>
  );
}

/**
 * The same "in progress" treatment Studio uses on a row Spark is working on:
 * grey slashes behind it, moving slowly, so it reads as busy from across the room.
 */
const HATCH_CSS = `
.clip-busy {
  background-image: repeating-linear-gradient(-45deg, transparent 0 9px, rgba(255,255,255,0.07) 9px 12px);
  background-size: 34px 34px;
  animation: clip-hatch 2.4s linear infinite;
}
@keyframes clip-hatch { to { background-position: 34px 0 } }
@media (prefers-reduced-motion: reduce) { .clip-busy { animation-duration: 9s } }
`;

const AUDIO_EXT = new Set(["m4a", "mp4", "mp3", "wav", "aac", "caf", "amr", "ogg", "opus", "flac", "aiff"]);

const fmtBytes = (n: number) => {
  if (!n) return "-";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const fmtSecs = (s: number | null) => {
  if (!s || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
};

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";

function StatusBadge({ clip }: { clip: Clip }) {
  if (clip.status === "done")
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/15">
        <CheckCircle2 className="h-3 w-3" /> Done
      </Badge>
    );
  if (clip.status === "working")
    return (
      <Badge className="gap-1 bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/15">
        <Loader2 className="h-3 w-3 animate-spin" /> Transcribing
      </Badge>
    );
  if (clip.status === "error")
    return (
      <Badge className="gap-1 bg-red-500/15 text-red-300 border-red-500/30 hover:bg-red-500/15">
        <AlertTriangle className="h-3 w-3" /> Failed
      </Badge>
    );
  return (
    <Badge className="gap-1 bg-white/10 text-white/70 border-white/15 hover:bg-white/10">
      <Clock className="h-3 w-3" /> Waiting for the Mac
    </Badge>
  );
}

function ClipCard({
  clip,
  onDelete,
  onNote,
  onMakeCall,
}: {
  clip: Clip;
  onDelete: (c: Clip) => void;
  onNote: (c: Clip, note: string) => void;
  onMakeCall?: (c: Clip) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [noUrl, setNoUrl] = useState(false);
  const [openTranscript, setOpenTranscript] = useState(false);
  const [note, setNote] = useState(clip.note ?? "");
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => setNote(clip.note ?? ""), [clip.note]);

  // Signed URL, fetched once the card is on screen. They expire; an hour is plenty for a listen.
  // Parted clips: the Mac puts a small playable copy at clip.path once it has the parts; until
  // then (or if that failed) the player stitches the parts in the browser.
  useEffect(() => {
    let live = true;
    setNoUrl(false);
    supabase.storage
      .from("voice-clips")
      .createSignedUrl(clip.path, 60 * 60)
      .then(({ data }) => {
        if (!live) return;
        if (data?.signedUrl) setUrl(data.signedUrl);
        else setNoUrl(true);
      });
    return () => {
      live = false;
    };
  }, [clip.path, clip.parts, clip.status]);

  const s = clip.summary ?? null;
  const title = s?.title || clip.title || clip.path.split("/").pop() || "Clip";
  const dur = fmtSecs(clip.seconds);

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 space-y-4",
        (clip.status === "new" || clip.status === "working") && "clip-busy",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-white font-medium leading-snug break-words">{title}</h3>
          <p className="mt-1 text-xs text-white/45">
            {clip.source === "airdrop" ? "AirDropped" : "Uploaded"} · {fmtWhen(clip.recorded_at || clip.created_at)}
            {dur ? ` · ${dur}` : ""} · {fmtBytes(clip.bytes)}
          </p>
          {clip.meeting_name ? (
            <p className="mt-1.5 text-xs text-[#7cc4ff]">Also in Calls, with who said what ({clip.meeting_name})</p>
          ) : clip.status === "done" && clip.kind !== "meeting" && onMakeCall ? (
            <button type="button" onClick={() => onMakeCall(clip)} className="mt-1.5 text-xs text-white/55 underline-offset-2 hover:text-white hover:underline">
              This was a meeting: file it under Calls
            </button>
          ) : clip.kind === "meeting" && clip.status !== "done" ? (
            <p className="mt-1.5 text-xs text-white/45">Going to Calls once it's transcribed</p>
          ) : null}
          {(clip.summary as { meeting_error?: string } | null)?.meeting_error && (
            <p className="mt-1.5 text-xs text-amber-300/80">{(clip.summary as { meeting_error?: string }).meeting_error}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge clip={clip} />
          {confirmDel ? (
            <Button size="sm" variant="destructive" onClick={() => onDelete(clip)}>
              Really delete
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-white/50 hover:text-red-300"
              onClick={() => {
                setConfirmDel(true);
                window.setTimeout(() => setConfirmDel(false), 4000);
              }}
              aria-label="Delete clip"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {url ? (
        <audio controls preload="metadata" src={url} className="w-full h-10" />
      ) : noUrl && clip.parts ? (
        <PartsPlayer clip={clip} />
      ) : noUrl ? (
        <p className="text-xs text-white/45">The audio file is missing from storage.</p>
      ) : (
        <Skeleton className="h-10 w-full bg-white/5" />
      )}

      {clip.error && (
        <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{clip.error}</p>
      )}

      {s?.summary && <p className="text-sm text-white/80 leading-relaxed">{s.summary}</p>}

      {!!s?.points?.length && (
        <ul className="space-y-1.5 text-sm text-white/70">
          {s.points.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-white/30 select-none">&bull;</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}

      {!!s?.todos?.length && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-amber-300/80 mb-1.5">To do</p>
          <ul className="space-y-1 text-sm text-white/80">
            {s.todos.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-amber-300/60 select-none">&rarr;</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {clip.transcript && (
        <div>
          <button
            type="button"
            onClick={() => setOpenTranscript((v) => !v)}
            className="text-xs text-white/50 hover:text-white/80 underline underline-offset-4"
          >
            {openTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {openTranscript && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-xs leading-relaxed text-white/70">
              {clip.transcript}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (clip.note ?? "") && onNote(clip, note)}
          placeholder="Add a note"
          className="h-9 flex-1 min-w-[12rem] bg-white/5 border-white/10 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-white/15 bg-white/5 hover:bg-white/10"
          disabled={!clip.transcript}
          onClick={() =>
            askScout("What should I do with this clip?", {
              about: `Voice clip "${title}" (${clip.source}, ${fmtWhen(clip.recorded_at || clip.created_at)}).\n\nTranscript:\n${clip.transcript}`,
            })
          }
        >
          <Sparkles className="h-3.5 w-3.5" /> Ask Scout
        </Button>
      </div>
    </div>
  );
}

export default function AdminClips({ embedded }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<ClipUpload[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("voice_clips")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      toast({ title: "Couldn't load clips", description: error.message, variant: "destructive" });
      return;
    }
    setClips((data ?? []) as unknown as Clip[]);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeClipUploads((u) => setUploading(u.filter((x) => x.status !== "done"))), []);

  // A finished upload inserts its row from outside React; pick it up straight away.
  useEffect(() => {
    const on = () => void load();
    window.addEventListener(CLIPS_CHANGED, on);
    return () => window.removeEventListener(CLIPS_CHANGED, on);
  }, [load]);

  // While anything is still being worked on, keep checking - the Mac writes back out of band.
  const pending = useMemo(() => (clips ?? []).filter((c) => c.status === "new" || c.status === "working").length, [clips]);
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  const upload = useCallback(
    (files: File[]) => {
      const good = files.filter((f) => AUDIO_EXT.has((f.name.split(".").pop() ?? "").toLowerCase()));
      const bad = files.length - good.length;
      if (bad) toast({ title: `Skipped ${bad} file${bad > 1 ? "s" : ""}`, description: "Audio files only." });
      // Handed to the module-level queue: it keeps going if this page unmounts.
      for (const f of good) void startClipUpload(f);
    },
    [toast],
  );

  const remove = useCallback(
    async (c: Clip) => {
      setClips((all) => (all ?? []).filter((x) => x.id !== c.id));
      await supabase.storage.from("voice-clips").remove(c.parts ? [c.path, ...partPaths(c)] : [c.path]); // parted clips also have a playable copy at path
      const { error } = await supabase.from("voice_clips").delete().eq("id", c.id);
      if (error) {
        toast({ title: "Delete failed", description: error.message, variant: "destructive" });
        void load();
      }
    },
    [load, toast],
  );

  // Run it again through the call recorder's pipeline so it lands in Calls with names.
  const makeCall = useCallback(
    async (c: Clip) => {
      setClips((all) => (all ?? []).map((x) => (x.id === c.id ? { ...x, kind: "meeting", status: "new" } : x)));
      const { error } = await supabase.from("voice_clips").update({ kind: "meeting", status: "new", error: null } as never).eq("id", c.id);
      if (error) { toast({ title: "Couldn't move it", description: error.message, variant: "destructive" }); void load(); }
      else toast({ title: "Filing it under Calls", description: "The Mac mini names who's speaking; it shows up in Calls in a few minutes." });
    },
    [load, toast],
  );

  const saveNote = useCallback(
    async (c: Clip, note: string) => {
      setClips((all) => (all ?? []).map((x) => (x.id === c.id ? { ...x, note } : x)));
      const { error } = await supabase.from("voice_clips").update({ note }).eq("id", c.id);
      if (error) toast({ title: "Note not saved", description: error.message, variant: "destructive" });
    },
    [toast],
  );

  return (
    <div
      className="space-y-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <style>{HATCH_CSS}</style>
      {!embedded && <AdminMark />}
      <PageHeader
        embedded={embedded}
        title="Clips"
        description="AirDrop a recording to the Mac mini, or drop one here. It gets transcribed and summarised on its own."
        actions={
          <Button variant="outline" size="sm" className="gap-1.5 border-white/15 bg-white/5" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className={`w-full rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-[#c84d2b] bg-[#c84d2b]/10" : "border-white/15 bg-white/[0.02] hover:border-white/30"
        }`}
      >
        <Upload className="mx-auto h-6 w-6 text-white/40" />
        <p className="mt-3 text-sm text-white/70">
          {dragging ? "Let go" : "Drop audio here, or click to pick a file"}
        </p>
        <p className="mt-1 text-xs text-white/40">m4a, mp3, wav, caf and friends. Any length - big files go up in parts.</p>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.m4a,.caf,.amr,.opus"
        multiple
        className="hidden"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {uploading.map((u) => (
        <div
          key={u.id}
          className={cn(
            "rounded-xl border p-4 sm:p-5",
            u.status === "error" ? "border-red-500/25 bg-red-500/[0.06]" : "clip-busy border-white/10 bg-white/[0.03]",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{u.name}</p>
              <p className="mt-1 text-xs text-white/45">
                {u.status === "error"
                  ? `Upload failed - ${u.error ?? "unknown"}`
                  : u.status === "saving"
                    ? "Saving"
                    : `Uploading ${fmtBytes(u.sent)} of ${fmtBytes(u.bytes)}`}
              </p>
            </div>
            {u.status === "error" ? (
              <Button size="sm" variant="ghost" className="text-white/50" onClick={() => dismissUpload(u.id)}>
                Dismiss
              </Button>
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/50" />
            )}
          </div>
          {u.status !== "error" && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-[#0A84FF] transition-[width] duration-200"
                style={{ width: `${Math.round((u.pct ?? 0) * 100)}%` }}
              />
            </div>
          )}
        </div>
      ))}

      {clips === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl bg-white/5" />
          ))}
        </div>
      ) : clips.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-10 text-center">
          <Mic className="mx-auto h-7 w-7 text-white/25" />
          <p className="mt-3 text-white/70">No clips yet.</p>
          <p className="mt-1 text-sm text-white/45">
            AirDrop one from the Soundcore app to the Mac mini and it shows up here within a minute.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(26rem,100%),1fr))] items-start gap-4">
          {clips.map((c) => (
            <ClipCard key={c.id} clip={c} onDelete={remove} onNote={saveNote} onMakeCall={makeCall} />
          ))}
        </div>
      )}
    </div>
  );
}
