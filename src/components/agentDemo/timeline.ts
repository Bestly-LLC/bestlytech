/**
 * Pure timeline math for the /agent demo. Everything the stage shows is a function of one number, the call time `t`
 * in seconds, so pause, replay and scrubbing are always correct: seeking just recomputes.
 *
 * Timings come from public/agent-demo/<id>.json (written by the audio pipeline). If that file is missing or does not
 * match the script, we estimate from the words so the page always works.
 */
import { TURN_GAP_S, type DemoEvent, type Scenario } from "./scenarios";

export type TLine = {
  start: number;
  end: number;
  /** Start time of each spoken word, only when it lines up one-to-one with the words on screen. */
  words?: number[];
};

export type Timeline = {
  id: string;
  duration: number;
  lines: TLine[];
  source: "json" | "estimate";
};

/** An event with its absolute time on the call clock. */
export type FiredEvent = DemoEvent & { t: number; line: number };

export const LEAD_IN_S = 0.25;
const WORDS_PER_SECOND = 2.7;
const TAIL_S = 0.5;

export const wordsOf = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

export function estimateTimeline(s: Scenario): Timeline {
  let at = LEAD_IN_S;
  const lines: TLine[] = s.lines.map((l) => {
    const n = Math.max(1, wordsOf(l.say ?? l.text).length);
    const start = at;
    const end = start + n / WORDS_PER_SECOND;
    at = end + TURN_GAP_S;
    return { start, end };
  });
  const last = lines[lines.length - 1];
  return { id: s.id, duration: (last ? last.end : 0) + TAIL_S, lines, source: "estimate" };
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate the pipeline's JSON against the script. Returns null if it does not fit (we then estimate). */
export function parseTimeline(raw: unknown, s: Scenario): Timeline | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { duration?: unknown; lines?: unknown };
  if (!Array.isArray(r.lines) || r.lines.length !== s.lines.length || !num(r.duration) || r.duration <= 0) return null;
  const lines: TLine[] = [];
  let prevEnd = 0;
  for (let i = 0; i < r.lines.length; i++) {
    const l = r.lines[i] as { start?: unknown; end?: unknown; words?: unknown };
    if (!num(l?.start) || !num(l?.end) || l.end <= l.start || l.start < prevEnd - 0.01) return null;
    prevEnd = l.end;
    const out: TLine = { start: l.start, end: l.end };
    const script = s.lines[i];
    if (!script.say && Array.isArray(l.words)) {
      const shown = wordsOf(script.text).length;
      const starts = (l.words as { start?: unknown }[]).map((w) => w?.start);
      if (starts.length === shown && starts.every(num)) out.words = starts as number[];
    }
    lines.push(out);
  }
  return { id: s.id, duration: Math.max(r.duration, prevEnd), lines, source: "json" };
}

/** Every event on the call, in the order they fire. */
export function allEvents(s: Scenario, tl: Timeline): FiredEvent[] {
  const out: FiredEvent[] = [];
  s.lines.forEach((l, i) => {
    const tlLine = tl.lines[i];
    if (!tlLine) return;
    for (const e of l.events ?? []) {
      out.push({ ...e, t: tlLine.start + e.at * (tlLine.end - tlLine.start), line: i });
    }
  });
  return out.sort((a, b) => a.t - b.t);
}

/** How many of the (sorted) events have fired by time t. */
export function firedCount(events: FiredEvent[], t: number): number {
  let n = 0;
  while (n < events.length && events[n].t <= t) n++;
  return n;
}

/** Index of the last line that has started by t, or -1 before the first. */
export function lastStartedLine(tl: Timeline, t: number): number {
  let idx = -1;
  for (let i = 0; i < tl.lines.length; i++) if (tl.lines[i].start <= t) idx = i;
  return idx;
}

/** The line being spoken right now (not during the gap between turns), or -1. */
export function speakingLine(tl: Timeline, t: number): number {
  for (let i = 0; i < tl.lines.length; i++) if (t >= tl.lines[i].start && t < tl.lines[i].end) return i;
  return -1;
}

/** How many of the line's n words are on screen at time t. */
export function wordsRevealed(line: TLine, n: number, t: number): number {
  if (t < line.start) return 0;
  if (t >= line.end) return n;
  if (line.words && line.words.length === n) {
    let c = 0;
    for (const w of line.words) if (w <= t + 0.04) c++;
    return Math.max(1, c);
  }
  const frac = (t - line.start) / (line.end - line.start);
  return Math.min(n, Math.floor(frac * n) + 1);
}

/** When a line's "what she did" chip appears: with its first event, or when the line ends if it has none. */
export function toolTime(s: Scenario, tl: Timeline, i: number): number | null {
  const l = s.lines[i];
  if (!l.tool) return null;
  const first = (l.events ?? []).filter((e) => e.do !== "toast")[0] ?? l.events?.[0];
  const tlLine = tl.lines[i];
  if (!tlLine) return null;
  return first ? tlLine.start + first.at * (tlLine.end - tlLine.start) : tlLine.end;
}

export type ToolMark = { t: number; line: number; label: string };
export function toolMarks(s: Scenario, tl: Timeline): ToolMark[] {
  const out: ToolMark[] = [];
  s.lines.forEach((l, i) => {
    const t = toolTime(s, tl, i);
    if (t != null && l.tool) out.push({ t, line: i, label: l.tool });
  });
  return out;
}

/** The first event that tells us who the caller is. Before it we show the phone number. */
export function callerKnownAt(events: FiredEvent[]): number | null {
  const hit = events.find((e) => ["identify", "book", "lead", "name", "address"].includes(e.do));
  return hit ? hit.t : null;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type Caption = { who: "agent" | "caller"; text: string; shown: number };

const NOT_END = /^(Dr|Mr|Ms|Mrs|St)\.$/;
const ends = (w: string) => /[.?!]["\u201d']?$/.test(w) && !NOT_END.test(w);

/** The sentence being spoken right now (words before it are left out so it always fits a small caption bar). */
export function captionAt(s: Scenario, tl: Timeline, t: number): Caption | null {
  const i = lastStartedLine(tl, t);
  if (i < 0 || !tl.lines[i]) return null;
  const words = wordsOf(s.lines[i].text);
  const n = wordsRevealed(tl.lines[i], words.length, t);
  const at = Math.max(0, n - 1);
  let a = at;
  while (a > 0 && !ends(words[a - 1])) a--;
  let b = at;
  while (b < words.length - 1 && !ends(words[b])) b++;
  return { who: s.lines[i].who, text: words.slice(a, b + 1).join(" "), shown: n - a };
}
