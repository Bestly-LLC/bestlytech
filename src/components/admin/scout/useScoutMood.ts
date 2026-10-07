import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { splitQuestions } from "../ScoutQuestions";
import { useNow } from "../ScoutRecorder";
import type { ScoutMood } from "./ScoutBuddy";
import {
  BIG_ONE_MS, READ_TOOLS, ROTATE_MS, THINKING_MS, announceLine, makeBag, replyBubble, workingLine,
  type ReplyTone,
} from "./scoutLines";

/**
 * Scout's mood: one small state machine that turns what the window already knows (typing, a request in flight,
 * the last tool he ran, a new reply, unread dots) into a face.
 *
 * Priority, highest first: a timed reaction (surprised, happy, proud, sad) > confused > searching > working >
 * thinking > listening > needs > waiting > sleepy > idle. Reactions fire on transitions only (a new reply, Stop),
 * never on a re-render, and never for messages that were already on screen when the thread loaded. A new mood
 * replaces the old one at once; nothing queues. While the panel is open the launcher states (needs, waiting,
 * sleepy) stay out of it: he is already looking at Scout.
 */

export interface ScoutMsg {
  id?: string;
  role: "user" | "assistant";
  body: string;
  created_at?: string;
}

export interface ScoutReply {
  id: number;
  tone: ReplyTone;
  /** The whole line for the bubble beside the launcher. */
  line: string;
  whileClosed: boolean;
}

export interface MoodInput {
  open: boolean;
  busy: boolean;
  chainAlive: boolean;
  /** He has a draft in the box. */
  typing: boolean;
  msgs: ScoutMsg[];
  threadId: string | null;
  /** ISO time the current request started, when this window sent it. */
  runStart: string | null;
  anyUnread: boolean;
  anyNeedsYou: boolean;
  urgentCount: number;
  pendingJobs: number;
  /** True for the "Still working on it" progress note (edited in place, never a reply). */
  isProgress: (body: string) => boolean;
  /** The body the window writes when he taps Stop. */
  stopMark: string;
  /** Only the primary window sleeps (it owns the launcher). */
  primary: boolean;
}

interface Act { id: string; tool: string; ok: boolean; at: number }

const STUCK = /I'd need paid AI|\bSTUCK\b/;
const DONE = /\b(done|fixed|sent|pushed|cleared|resolved|deployed)\b/i;
const FAILED = /\b(failed|couldn't|could not|didn't work|did not work|error|can't|unable)\b/i;
/** The window's own error copy (Scout.tsx send()): these never come from the model. */
const OWN_ERROR = /^(That one ran too long|I couldn't reach the server|Your sign-in expired)/;
const CONFUSED_FOR_MS = 10 * 60_000;
const SLEEP_AFTER_MS = 15 * 60_000;

export const asksSomething = (body: string) => splitQuestions(body).questions.length > 0 || STUCK.test(body);

export function useScoutMood(i: MoodInput) {
  const running = i.busy || i.chainAlive;
  const now = useNow(running);
  const mountedAt = useRef(Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  /* ---- timed reactions ---- */
  const [reaction, setReaction] = useState<{ mood: ScoutMood; id: number } | null>(null);
  const [replay, setReplay] = useState(0);
  const idRef = useRef(0);
  const timer = useRef<number>();
  const fire = useCallback((mood: ScoutMood, ms: number) => {
    window.clearTimeout(timer.current);
    const id = ++idRef.current;
    setReaction({ mood, id });
    setReplay(id); // remounts the face so a repeat of the same mood plays again from its first frame
    timer.current = window.setTimeout(() => setReaction((r) => (r && r.id === id ? null : r)), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /* ---- the run: when it started, and the tools he has used in it ---- */
  const runSince = useRef<number | null>(null);
  const wasRunning = useRef(false);
  const acts = useRef<Act[]>([]);
  const [tool, setTool] = useState<{ tool: string; at: number } | null>(null);
  useEffect(() => {
    if (running && !wasRunning.current) {
      runSince.current = i.runStart ? Date.parse(i.runStart) || Date.now() : Date.now();
      acts.current = [];
    }
    wasRunning.current = running;
    if (!running) setTool(null);
  }, [running, i.runStart]);

  const threadRef = useRef(i.threadId);
  threadRef.current = i.threadId;
  const fetchActs = useCallback(async (): Promise<Act[]> => {
    const id = threadRef.current;
    if (!id) return acts.current;
    const since = new Date((runSince.current ?? Date.now() - 120_000) - 3000).toISOString();
    const { data, error } = await supabase
      .from("admin_chat_actions")
      .select("id, tool, ok, created_at")
      .eq("thread_id", id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error || !data) return acts.current;
    acts.current = data.map((r) => ({ id: String(r.id), tool: String(r.tool), ok: r.ok !== false, at: Date.parse(r.created_at) }));
    return acts.current;
  }, []);

  // Poll the newest tool every 2 s, only while a run is going.
  useEffect(() => {
    if (!running || !i.threadId) return;
    let live = true;
    const tick = async () => {
      const list = await fetchActs();
      if (!live) return;
      const t = list[0];
      setTool((prev) => (!t ? prev : prev && prev.tool === t.tool && prev.at === t.at ? prev : { tool: t.tool, at: t.at }));
    };
    void tick();
    const h = window.setInterval(tick, 2000);
    return () => { live = false; window.clearInterval(h); };
  }, [running, i.threadId, fetchActs]);

  /* ---- a new reply, or Stop: the transitions that make a reaction ---- */
  const seen = useRef(new Set<string>());
  const lastStop = useRef(0);
  const replyId = useRef(0);
  const [reply, setReply] = useState<ScoutReply | null>(null);
  const openRef = useRef(i.open);
  openRef.current = i.open;

  const react = useCallback(async (bot: ScoutMsg) => {
    let tone: ReplyTone;
    if (OWN_ERROR.test(bot.body)) {
      tone = "sad";
    } else {
      let list: Act[] = acts.current;
      try { list = await fetchActs(); } catch { /* keep what we saw */ }
      const used = list.length > 0;
      const failed = list.some((a) => !a.ok);
      if (asksSomething(bot.body)) tone = "confused";
      else if (failed && FAILED.test(bot.body)) tone = "sad";
      else if (used && DONE.test(bot.body)) tone = "proud";
      else tone = "happy";
    }
    if (!alive.current) return;
    const closed = !openRef.current;
    if (closed) fire(tone === "sad" ? "sad" : "surprised", tone === "sad" ? 6000 : 700);
    else if (tone !== "confused") fire(tone, tone === "happy" ? 1200 : tone === "proud" ? 1600 : 6000);
    setReply({ id: ++replyId.current, tone, line: replyBubble(tone, bot.body), whileClosed: closed });
  }, [fetchActs, fire]);

  useEffect(() => {
    const fresh: ScoutMsg[] = [];
    for (const m of i.msgs) {
      const key = m.id ?? `${m.role}|${m.created_at ?? ""}|${m.body.length}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      const at = m.created_at ? Date.parse(m.created_at) : Date.now();
      if (at < mountedAt.current - 5000) continue; // already there when the thread loaded
      fresh.push(m);
    }
    if (!fresh.length) return;
    if (fresh.some((m) => m.role === "user" && m.body === i.stopMark) && Date.now() - lastStop.current > 3000) {
      lastStop.current = Date.now();
      fire("sad", 6000);
    }
    const bot = [...fresh].reverse().find((m) => m.role === "assistant" && !i.isProgress(m.body));
    if (bot) void react(bot);
  }, [i.msgs, i.stopMark, i.isProgress, fire, react]);

  /* ---- sleepy: panel closed, nothing waiting, 15 minutes of nothing. Any pointer or key wakes him. ---- */
  const [sleepy, setSleepy] = useState(false);
  const sleepyRef = useRef(false);
  const lastAct = useRef(Date.now());
  const calm = !i.anyUnread && !i.anyNeedsYou && i.urgentCount === 0 && i.pendingJobs === 0;
  const stateRef = useRef({ open: i.open, running, calm });
  stateRef.current = { open: i.open, running, calm };
  useEffect(() => {
    if (!i.primary) return;
    const wake = () => {
      const n = Date.now();
      if (n - lastAct.current < 800) return;
      lastAct.current = n;
      if (sleepyRef.current) {
        sleepyRef.current = false;
        setSleepy(false);
        fire("surprised", 500);
      }
    };
    const evs = ["pointermove", "pointerdown", "keydown"] as const;
    evs.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    const h = window.setInterval(() => {
      const s = stateRef.current;
      if (!s.open && !s.running && s.calm && !sleepyRef.current && Date.now() - lastAct.current >= SLEEP_AFTER_MS) {
        sleepyRef.current = true;
        setSleepy(true);
      }
    }, 30_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, wake));
      window.clearInterval(h);
    };
  }, [i.primary, fire]);
  useEffect(() => {
    if (i.open || !calm) {
      lastAct.current = Date.now();
      if (sleepyRef.current) {
        sleepyRef.current = false;
        setSleepy(false);
      }
    }
  }, [i.open, calm]);

  /* ---- the face ---- */
  const last = i.msgs[i.msgs.length - 1];
  const lastAt = last?.created_at ? Date.parse(last.created_at) : Date.now();
  const confusedNow = !running && !!last && last.role === "assistant" && asksSomething(last.body) && Date.now() - lastAt < CONFUSED_FOR_MS;
  const elapsedMs = running && runSince.current ? Math.max(0, now - runSince.current) : 0;
  const searching = running && !!tool && READ_TOOLS.has(tool.tool) && now - tool.at < 8000;

  let mood: ScoutMood = "idle";
  if (reaction) mood = reaction.mood;
  else if (confusedNow) mood = "confused";
  else if (running) mood = searching ? "searching" : elapsedMs >= THINKING_MS ? "working" : "thinking";
  else if (i.open && i.typing) mood = "listening";
  else if (!i.open && (i.anyNeedsYou || i.urgentCount > 0 || i.pendingJobs > 0)) mood = "needs";
  else if (!i.open && i.anyUnread) mood = "waiting";
  else if (!i.open && sleepy) mood = "sleepy";

  return { mood, replay, tool: tool?.tool ?? null, reply, elapsedMs, running };
}

/**
 * The line in the working row. Rotates a shuffled bag every 3.5 s only while nothing better is known (no tool, no
 * progress note, under 45 s); otherwise it is the real thing he is doing. `announce` changes only when the tool
 * does, so a screen reader hears "Reading the database", not every rotating line.
 */
export function useWorkingLine(o: {
  running: boolean;
  tool: string | null;
  elapsedMs: number;
  progress: { step: number; min: number } | null;
  chainOnly: boolean;
}) {
  const bag = useRef<() => string>();
  if (!bag.current) bag.current = makeBag();
  const [rotating, setRotating] = useState(() => (bag.current as () => string)());
  const rotates = o.running && !o.tool && !o.progress && !o.chainOnly && o.elapsedMs < BIG_ONE_MS;
  useEffect(() => {
    if (!rotates) return;
    const h = window.setInterval(() => setRotating((bag.current as () => string)()), ROTATE_MS);
    return () => window.clearInterval(h);
  }, [rotates]);
  const [announce, setAnnounce] = useState(() => announceLine(o.tool));
  useEffect(() => setAnnounce(announceLine(o.tool)), [o.tool]);
  return { line: workingLine({ tool: o.tool, elapsedMs: o.elapsedMs, progress: o.progress, chainOnly: o.chainOnly, rotating }), announce };
}
