/**
 * One shared poller per Ava for calls that are happening right now (incoming, outgoing, forwarded). Everything that
 * shows a live call reads this: the live banners, the live pill in the top bar, and the in-call sheet the pill opens.
 * Polling starts with the first reader and stops with the last; every 2 seconds while a call is live, else every 10.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Line } from "./AvaCalls";

export type LiveSource = "ava" | "roofguard";

/**
 * Where a call is right now, so "ringing" and "she is actually talking to someone" never look the same.
 * The voice platform's own words: in-progress = they answered; processing = they hung up and the transcript is
 * still being written; done = finished. Anything earlier (our own "dialing", its "initiated") is still ringing --
 * unless a line has already been said, which only happens once someone picks up.
 */
export type CallPhase = "ringing" | "connected" | "wrapping" | "ended";
export function callPhase(status: string | null | undefined, turns = 0): CallPhase {
  const s = (status ?? "").toLowerCase();
  if (s === "done" || s === "failed") return "ended";
  if (s === "processing") return "wrapping";
  if (s === "in-progress" || s === "in_progress") return "connected";
  return turns > 0 ? "connected" : "ringing";
}
export type LiveItem = {
  key: string; conversation_id: string | null; call_id: string | null; who: string; phone: string | null; status: string; elapsed: number;
  direction: "inbound" | "outbound" | "callback"; transcript: Line[]; forwarded: boolean; voice: "ava" | "jared"; isTest: boolean; contact: string | null;
};
type State = { calls: LiveItem[]; down: boolean };

const fmtPhone = (e164: string | null | undefined) => {
  const d = (e164 ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)})\u00a0${d.slice(3, 6)}-${d.slice(6)}` : e164 ?? "";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
function normalize(source: LiveSource, r: Raw): LiveItem {
  if (source === "ava") {
    return { key: r.conversation_id || r.call_id || r.phone || "live", conversation_id: r.conversation_id ?? null, call_id: r.call_id ?? null,
      who: r.who ?? (fmtPhone(r.phone) || "Caller"), phone: r.phone ?? null, status: r.status ?? "", elapsed: r.elapsed ?? 0,
      direction: r.direction === "outbound" ? "outbound" : "inbound", transcript: r.transcript ?? [], forwarded: r.forwarded === true,
      voice: r.voice === "jared" ? "jared" : "ava", isTest: false, contact: null };
  }
  const dir = r.direction === "inbound" ? "inbound" : r.direction === "callback" ? "callback" : "outbound";
  return { key: r.conversation_id || r.call_id || r.to_number || "live", conversation_id: r.conversation_id ?? null, call_id: r.call_id || null,
    who: (r.company || r.contact || fmtPhone(r.to_number) || "Caller").replace(" (demo)", ""), phone: r.to_number ?? null, status: r.status ?? "", elapsed: r.elapsed ?? 0,
    direction: dir, transcript: r.transcript ?? [], forwarded: false, voice: "ava", isTest: r.is_test === true, contact: r.contact ?? null };
}

type Store = { state: State; subs: Set<(s: State) => void>; timer: ReturnType<typeof setTimeout> | null; fails: number; running: boolean };
const stores: Record<LiveSource, Store> = {
  ava: { state: { calls: [], down: false }, subs: new Set(), timer: null, fails: 0, running: false },
  roofguard: { state: { calls: [], down: false }, subs: new Set(), timer: null, fails: 0, running: false },
};
const FN: Record<LiveSource, string> = { ava: "ava-assistant", roofguard: "roofguard-caller" };
/** Fired when a live call goes away, so pages reload their lists a few seconds later (the post-call webhook lands then). */
export const LIVE_ENDED_EVENT = "ava-live-ended";

function publish(source: LiveSource, state: State) {
  const s = stores[source];
  s.state = state;
  s.subs.forEach((f) => f(state));
}

async function tick(source: LiveSource) {
  const s = stores[source];
  if (!s.running) return;
  let next = 10000;
  if (!document.hidden) {
    const { data, error } = await supabase.functions.invoke(FN[source], { body: { action: "live" } });
    if (error || !data?.ok) {
      s.fails += 1;
      if (s.fails >= 3 && !s.state.down) publish(source, { ...s.state, down: true });
    } else {
      s.fails = 0;
      const calls = ((data.calls ?? []) as Raw[]).map((r) => normalize(source, r));
      if (calls.length < s.state.calls.length) { try { window.dispatchEvent(new CustomEvent(LIVE_ENDED_EVENT, { detail: source })); } catch { /* no window */ } }
      publish(source, { calls, down: false });
      if (calls.length) next = 2000;
    }
  }
  if (s.running) s.timer = setTimeout(() => void tick(source), next);
}

function start(source: LiveSource) {
  const s = stores[source];
  if (s.running) return;
  s.running = true;
  void tick(source);
}
function stop(source: LiveSource) {
  const s = stores[source];
  s.running = false;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}

export function useLiveCalls(source: LiveSource): State {
  const [state, setState] = useState<State>(stores[source].state);
  useEffect(() => {
    const s = stores[source];
    s.subs.add(setState);
    setState(s.state);
    start(source);
    return () => { s.subs.delete(setState); if (s.subs.size === 0) stop(source); };
  }, [source]);
  return state;
}
