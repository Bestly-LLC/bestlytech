import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { call, type TimerRow } from "./rx";
import { durRange } from "@/lib/recipes/scale";

/** One kitchen timer. Timers live in the database (recipe_timers), so a reload or a second device still sees them,
 *  and Basil announces a timer on the HomePods even if this page went to sleep (the minute job catches it). */
export interface LiveTimer {
  id: string; key: string; label: string; recipeId: number | null; total: number; endsAt: number; done: boolean;
}

/* ---------- chime (Web Audio, unlocked by the first tap on the page) ---------- */
let AC: AudioContext | null = null;
export function unlockAudio() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    AC = AC ?? new Ctor();
    if (AC.state === "suspended") void AC.resume();
  } catch { /* no audio here */ }
}
export function chime() {
  if (!AC) return;
  const t = AC.currentTime;
  for (const [freq, at] of [[880, 0], [1174.66, 0.2], [1567.98, 0.4]] as const) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = "sine"; o.frequency.value = freq; o.connect(g); g.connect(AC.destination);
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1);
    o.start(t + at); o.stop(t + at + 1.1);
  }
}

/** 4:05 or 1:02:09, rounded up so a timer never shows 0:00 while it still has time. */
export function remainingText(sec: number): string {
  const s = Math.ceil(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function useTimers(opts: { speakerOn: boolean }) {
  const [timers, setTimers] = useState<LiveTimer[]>([]);
  const [tick, setTick] = useState(0);
  const ref = useRef<LiveTimer[]>([]);
  const firedIds = useRef<Set<string>>(new Set());
  const dismissed = useRef<Set<string>>(new Set());
  ref.current = timers;
  const speakerOn = useRef(opts.speakerOn);
  speakerOn.current = opts.speakerOn;

  /** Merge the running timers the server knows about (after a load or a reload). */
  const hydrate = useCallback((rows: TimerRow[], serverNow: string) => {
    const skew = Date.parse(serverNow) - Date.now();
    for (const r of rows) if (r.status === "done") firedIds.current.add(r.id);
    setTimers((cur) => {
      const mine = cur.filter((t) => t.id.startsWith("tmp-"));
      const fromServer: LiveTimer[] = rows.filter((r) => r.status !== "stopped" && !dismissed.current.has(r.id)).map((r) => ({
        id: r.id, key: r.id, label: r.label, recipeId: r.recipe_id, total: r.total_sec, endsAt: Date.parse(r.ends_at) - skew, done: r.status === "done",
      }));
      // keep the local "done" flag and any locally dismissed state for timers we already hold
      const merged = fromServer.map((s) => {
        const c = cur.find((x) => x.id === s.id);
        return c ? { ...s, done: c.done || s.done, key: c.key } : s;
      });
      return [...merged, ...mine];
    });
  }, []);

  const start = useCallback(async (key: string, label: string, sec: number, maxSec: number | null | undefined, recipeId: number | null) => {
    if (ref.current.some((t) => t.key === key && !t.done)) { toast(`${label} timer is already running`); return; }
    const tmp = `tmp-${Math.random().toString(36).slice(2)}`;
    setTimers((c) => [...c, { id: tmp, key, label, recipeId, total: sec, endsAt: Date.now() + sec * 1000, done: false }]);
    toast(`${label} timer started`, { description: durRange(sec, maxSec) + (maxSec ? ". Starts at the low end, add time if needed." : "") + (speakerOn.current ? " Basil announces it on the kitchen speakers." : ""), duration: 2800 });
    try {
      const id = await call<string>("recipe_timer_start", { p_recipe_id: recipeId, p_label: label, p_sec: sec });
      setTimers((c) => c.map((t) => (t.id === tmp ? { ...t, id } : t)));
    } catch (e) {
      toast.error(`Basil could not save the ${label} timer, so it will not announce on the speakers. ${(e as Error).message}`);
    }
  }, []);

  const plus = useCallback((id: string) => {
    firedIds.current.delete(id);
    setTimers((c) => c.map((t) => (t.id === id ? { ...t, done: false, endsAt: (t.done ? Date.now() : t.endsAt) + 60_000, total: t.total + 60 } : t)));
    if (!id.startsWith("tmp-")) void call("recipe_timer_adjust", { p_id: id, p_add_sec: 60 }).catch(() => undefined);
  }, []);

  const stop = useCallback((id: string) => {
    const t = ref.current.find((x) => x.id === id);
    dismissed.current.add(id);
    setTimers((c) => c.filter((x) => x.id !== id));
    if (t && !t.done && !id.startsWith("tmp-")) void call("recipe_timer_stop", { p_id: id }).catch(() => undefined);
  }, []);

  /** Stop the newest running timer (or the one for a key); used by "stop timer" by voice. */
  const stopLatest = useCallback((key?: string) => {
    const list = ref.current.filter((t) => !t.done);
    const t = (key && [...list].reverse().find((x) => x.key === key)) || list[list.length - 1];
    if (t) stop(t.id);
    return !!t;
  }, [stop]);

  useEffect(() => {
    if (!timers.length) return;
    const iv = setInterval(() => {
      const now = Date.now();
      const fired = ref.current.filter((t) => !t.done && t.endsAt <= now && !firedIds.current.has(t.id));
      if (fired.length) {
        for (const t of fired) firedIds.current.add(t.id);
        setTimers((c) => c.map((t) => (fired.some((f) => f.id === t.id) ? { ...t, done: true } : t)));
        for (const t of fired) {
          chime();
          toast(`${t.label} timer done`, { description: speakerOn.current ? "Announced on the kitchen speakers." : undefined, duration: 6500 });
          if (!t.id.startsWith("tmp-")) void call("recipe_timer_done", { p_id: t.id }).catch(() => undefined);
        }
      }
      setTick((n) => n + 1);
    }, 250);
    return () => clearInterval(iv);
  }, [timers.length]);

  const remaining = (t: LiveTimer) => Math.max(0, (t.endsAt - Date.now()) / 1000);
  void tick;
  return { timers, hydrate, start, plus, stop, stopLatest, remaining };
}
