import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Mic, Square, Plus, X, Loader2, FileText, Sparkles } from "lucide-react";

/**
 * The call recorder on the Mac mini, driven from Scout.
 *
 * Reads live state from the meeting_recorder_status view (the agent on the Mac
 * reports every ~3s) and sends start/stop through the meeting-recorder edge
 * function, which checks the admin role. The Mac runs the same start.sh /
 * stop.sh the Desktop apps use, so either way of recording shows up here.
 */

export interface RecorderState {
  status: "offline" | "idle" | "recording" | "transcribing" | "error";
  current_name: string | null;
  roster: string[];
  started_at: string | null;
  stage: string | null;
  known_voices: string[];
  seconds_since: number | null;
}

export interface RecentRecording {
  id: string;
  name: string;
  started_at: string | null;
  stopped_at: string | null;
  roster: string[];
  line_count: number | null;
  debriefed_at: string | null;
  created_at: string;
}

const OFFLINE_AFTER_S = 30;

const pretty = (n: string) =>
  n
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");

export const listNames = (names: string[]) => {
  const p = names.map(pretty);
  if (p.length <= 1) return p[0] ?? "";
  return `${p.slice(0, -1).join(", ")} and ${p[p.length - 1]}`;
};

export function clock(fromIso: string | null, now: number) {
  if (!fromIso) return "0:00";
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Live recorder state. Polls fast while something is happening, slowly otherwise. */
export function useRecorder(active: boolean) {
  const [state, setState] = useState<RecorderState | null>(null);
  const [latest, setLatest] = useState<RecentRecording | null>(null);

  const refresh = useCallback(async () => {
    const [{ data: s }, { data: r }] = await Promise.all([
      supabase.from("meeting_recorder_status" as any).select("*").maybeSingle(),
      supabase
        .from("meeting_recordings" as any)
        .select("id, name, started_at, stopped_at, roster, line_count, debriefed_at, created_at")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(1),
    ]);
    if (s) {
      const row = s as any;
      const offline = row.seconds_since == null || row.seconds_since > OFFLINE_AFTER_S;
      setState({ ...row, status: offline ? "offline" : row.status } as RecorderState);
    }
    setLatest(((r ?? []) as any[])[0] ?? null);
  }, []);

  const busy = state?.status === "recording" || state?.status === "transcribing";
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, active || busy ? 3000 : 20000);
    return () => clearInterval(t);
  }, [refresh, active, busy]);

  return { state, latest, refresh };
}

export function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
        on ? "border-white bg-white text-black" : "border-white/15 text-white/70 hover:border-white/35 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

export function RecorderBar({
  state,
  latest,
  refresh,
  onDebrief,
}: {
  state: RecorderState | null;
  latest: RecentRecording | null;
  refresh: () => void;
  onDebrief: (r: RecentRecording) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState<"start" | "stop" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow(state?.status === "recording");

  // A sent command is done once the Mac reports the new state.
  useEffect(() => {
    if (sending === "start" && state?.status === "recording") setSending(null);
    if (sending === "stop" && state?.status !== "recording") setSending(null);
  }, [state?.status, sending]);

  // Don't spin forever if the Mac never picks it up.
  useEffect(() => {
    if (!sending) return;
    const t = setTimeout(async () => {
      setSending(null);
      const { data } = await supabase
        .from("meeting_recorder_commands" as any)
        .select("status, error")
        .order("created_at", { ascending: false })
        .limit(1);
      const c = ((data ?? []) as any[])[0];
      setErr(c?.error ?? "The Mac mini didn't answer in time. Try again.");
    }, 25000);
    return () => clearTimeout(t);
  }, [sending]);

  const act = async (op: "start" | "stop", roster?: string[]) => {
    setErr(null);
    setSending(op);
    const { data, error } = await supabase.functions.invoke("meeting-recorder", { body: { op, roster } });
    if (error || !(data as any)?.ok) {
      setSending(null);
      setErr((data as any)?.error ?? error?.message ?? "Something went wrong.");
    } else if (op === "start") {
      setPicking(false);
    }
    refresh();
  };

  const addTyped = () => {
    const names = typed
      .split(/,|\band\b/i)
      .map((n) => n.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
      .filter((n) => n && n !== "jared");
    if (names.length) {
      setExtra((x) => [...new Set([...x, ...names.filter((n) => !(state?.known_voices ?? []).includes(n))])]);
      setPicked((p) => [...new Set([...p, ...names])]);
    }
    setTyped("");
  };

  if (!state) return null;

  const status = state.status;
  const shell = "border-b border-white/[0.06] px-3 py-2.5";

  if (status === "offline") {
    return (
      <div className={cn(shell, "flex items-center gap-2 text-xs text-white/45")}>
        <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Call recorder is offline. It comes back when the Mac mini is awake.</span>
      </div>
    );
  }

  if (status === "recording") {
    return (
      <div className={cn(shell, "flex items-center gap-2.5")} aria-live="polite">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tabular-nums text-white">Recording {clock(state.started_at, now)}</p>
          <p className="truncate text-xs text-white/50">
            {state.roster.length ? `You, ${listNames(state.roster)}` : "Names not set"}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => act("stop")}
          disabled={sending === "stop"}
          className="h-8 shrink-0 gap-1.5 bg-white px-3 text-xs text-black hover:bg-white/90"
        >
          {sending === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />}
          Stop & transcribe
        </Button>
      </div>
    );
  }

  if (status === "transcribing") {
    return (
      <div className={cn(shell, "flex items-center gap-2.5")} aria-live="polite">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/70" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Transcribing the call</p>
          <p className="truncate text-xs text-white/50">
            {state.stage ? state.stage[0].toUpperCase() + state.stage.slice(1) : "Working"}. Takes a few minutes.
          </p>
        </div>
      </div>
    );
  }

  // idle
  const fresh =
    latest && !latest.debriefed_at && Date.now() - new Date(latest.created_at).getTime() < 3 * 3600_000 ? latest : null;
  const voices = [...new Set([...(state.known_voices ?? []), ...extra])];

  return (
    <div className={shell}>
      {fresh && !picking && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/[0.05] px-2.5 py-2">
          <FileText className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">Transcript ready</p>
            <p className="truncate text-[0.6875rem] text-white/50">
              {fresh.roster.length ? `With ${listNames(fresh.roster)}` : fresh.name}
              {fresh.line_count ? ` · ${fresh.line_count} lines` : ""}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => onDebrief(fresh)}
            className="h-7 shrink-0 gap-1 bg-white px-2.5 text-xs text-black hover:bg-white/90"
          >
            <Sparkles className="h-3 w-3" />
            Debrief
          </Button>
          <Link
            to="/admin/meetings"
            className="shrink-0 px-1 text-xs text-white/55 underline-offset-2 hover:text-white hover:underline"
          >
            Open
          </Link>
        </div>
      )}

      {!picking ? (
        <button
          type="button"
          onClick={() => {
            setPicking(true);
            setErr(null);
          }}
          className="flex w-full items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-white/80 transition-colors hover:border-white/30 hover:text-white"
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" aria-hidden />
          Record a call
          <span className="ml-auto text-xs text-white/40">on the Mac mini</span>
        </button>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Who's on the call?</p>
            <button
              type="button"
              onClick={() => setPicking(false)}
              aria-label="Cancel"
              className="rounded-md p-1 text-white/45 hover:bg-white/5 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {voices.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {voices.map((v) => (
                <Chip
                  key={v}
                  on={picked.includes(v)}
                  onClick={() => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                >
                  {pretty(v)}
                  {!(state.known_voices ?? []).includes(v) && <span className="opacity-60">· new</span>}
                </Chip>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTyped();
                }
              }}
              placeholder="Add someone new"
              aria-label="Add a name"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={addTyped}
              disabled={!typed.trim()}
              aria-label="Add name"
              className="h-[2.125rem] w-[2.125rem] shrink-0 border border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[0.6875rem] leading-snug text-white/45">
            New names are learned from their voice after the call. Let everyone know you're recording.
          </p>
          <Button
            onClick={() => act("start", picked)}
            disabled={sending === "start"}
            className="h-9 w-full gap-2 bg-red-500 text-sm font-semibold text-white hover:bg-red-500/90"
          >
            {sending === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            {sending === "start"
              ? "Starting on the Mac mini..."
              : picked.length
                ? `Start recording with ${listNames(picked)}`
                : "Start recording"}
          </Button>
        </div>
      )}

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}
