/**
 * Calls tab: drop a meeting recorded anywhere else (phone, Soundcore, a Zoom export) and it is
 * filed exactly like a call recorded on the Mac mini.
 *
 * The file goes up through the same queue as Clips (big files in parts), tagged kind='meeting'.
 * The Mac mini's clips worker then hands it to the call recorder's pipeline: transcribe, tell every
 * voice apart against the saved voiceprints (name_mixed.py), upload to the Nextcloud archive, and
 * the recorder agent ingests it into meeting_recordings (summary, to-dos, partner portal). It stays
 * in Clips too, where it can be played.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2, Pause, Play, Upload } from "lucide-react";
import { startClipUpload, subscribeClipUploads, dismissUpload, CLIPS_CHANGED, type ClipUpload } from "./clipUploads";

const AUDIO = /\.(m4a|mp3|wav|aac|caf|amr|ogg|opus|flac|aiff|mp4)$/i;

export type LinkedClip = { id: string; path: string; meeting_name: string | null; status: string; title: string | null; kind: string | null; seconds: number | null; created_at: string };

/** Clips that are (or are becoming) meetings. Refreshes while any are still being worked on. */
export function useMeetingClips(onFiled?: () => void) {
  const [clips, setClips] = useState<LinkedClip[]>([]);
  const filed = useRef<Set<string>>(new Set());
  const load = useMemo(() => async () => {
    const { data } = await supabase.from("voice_clips")
      .select("id, path, meeting_name, status, title, kind, seconds, created_at")
      .or("kind.eq.meeting,meeting_name.not.is.null")
      .order("created_at", { ascending: false }).limit(100);
    const rows = (data ?? []) as unknown as LinkedClip[];
    // A meeting that just got its name is now in the Nextcloud archive: have Calls reload.
    const names = rows.filter((r) => r.meeting_name).map((r) => r.meeting_name as string);
    if (filed.current.size && names.some((n) => !filed.current.has(n))) onFiled?.();
    filed.current = new Set(names);
    setClips(rows);
  }, [onFiled]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = () => void load();
    window.addEventListener(CLIPS_CHANGED, on);
    return () => window.removeEventListener(CLIPS_CHANGED, on);
  }, [load]);
  const busy = clips.some((c) => c.status === "new" || c.status === "working");
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(t);
  }, [busy, load]);
  return clips;
}

/** Play the clip a meeting came from (its small playable copy). */
export function MeetingPlay({ clip }: { clip: LinkedClip }) {
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const el = useRef<HTMLAudioElement | null>(null);
  const toggle = async () => {
    if (!src) {
      const { data, error } = await supabase.storage.from("voice-clips").createSignedUrl(clip.path, 3600);
      if (error || !data?.signedUrl) { setErr("Audio not ready yet"); return; }
      setSrc(data.signedUrl);
      setPlaying(true);
      return;
    }
    if (playing) el.current?.pause(); else void el.current?.play();
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void toggle()} className="border-white/10 text-white/70 hover:text-white">
        {playing ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
        {err ?? (playing ? "Pause" : "Play")}
      </Button>
      {src && (
        <audio ref={el} src={src} autoPlay className="hidden"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onError={() => { setErr("Can't play"); setPlaying(false); }} />
      )}
    </>
  );
}

export function MeetingDrop({ clips }: { clips: LinkedClip[] }) {
  const [drag, setDrag] = useState(false);
  const [ups, setUps] = useState<ClipUpload[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => subscribeClipUploads((u) => setUps(u.filter((x) => x.kind === "meeting" && x.status !== "done"))), []);
  const go = (files: File[]) => files.filter((f) => AUDIO.test(f.name)).forEach((f) => void startClipUpload(f, "meeting"));
  const working = clips.filter((c) => c.status === "new" || c.status === "working");

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); go(Array.from(e.dataTransfer.files)); }}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-3 text-left transition-colors",
          drag ? "border-[#0A84FF] bg-[#0A84FF]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25",
        )}
      >
        <Upload className="h-5 w-5 shrink-0 text-white/40" />
        <span className="min-w-0">
          <span className="block text-sm text-white/80">{drag ? "Let go" : "Drop a meeting recorded somewhere else"}</span>
          <span className="block text-xs text-white/40">Phone, Soundcore, a Zoom export. It's transcribed, everyone's named by voice, and it lands here like any call.</span>
        </span>
      </button>
      <input ref={input} type="file" accept="audio/*,.m4a,.caf,.amr,.opus" multiple className="hidden"
        onChange={(e) => { go(Array.from(e.target.files ?? [])); e.target.value = ""; }} />

      {ups.map((u) => (
        <div key={u.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
          <p className="min-w-0 truncate text-sm text-white/70">
            {u.status === "error" ? `Upload failed: ${u.error ?? "unknown"}` : `Uploading ${u.name} · ${Math.round((u.pct ?? 0) * 100)}%`}
          </p>
          {u.status === "error"
            ? <Button size="sm" variant="ghost" className="text-white/50" onClick={() => dismissUpload(u.id)}>Dismiss</Button>
            : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/40" />}
        </div>
      ))}
      {working.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
          <p className="min-w-0 truncate text-sm text-white/70">
            {c.status === "new" ? "Waiting for the Mac mini" : "Transcribing and naming who's speaking"} · {c.title ?? "meeting"}
          </p>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/40" />
        </div>
      ))}
    </div>
  );
}
