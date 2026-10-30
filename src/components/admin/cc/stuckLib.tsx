/** Pure pieces of the Stuck / Waiting cards: the feed shape, parsing, and number formatting. No data access, so tests can import it. */
import { Fragment } from "react";

/* ───────── types and parsing ───────── */

export interface StuckBlock { id: string; label: string; detail: string | null; fix_action: string | null; fix_label: string | null }
export interface StuckUndo { id: string; label: string; until: string; at: string; kind: string | null }

/** The server's verdict on an employee's error (stuck_classify): which button leads, and why. */
export type FixKind = "auth" | "transient" | "other";
export type FixPrimary = "key" | "retry" | "scout";
export interface StuckFix {
  kind: FixKind;
  service: string | null;
  label: string;
  tail: string;
  link: string;
  link_label: string | null;
  retry: boolean;
  where: string | null;
  primary: FixPrimary;
  /** A one-line fix only a person can run (a sign-in that needs an Allow tap). The card shows it to copy, instead of a button. */
  command: string | null;
  command_note: string | null;
}

/** The latest thing tapped on a card: working, then done, failed, or (Scout only) needs Jared's yes. */
export type ActionStatus = "working" | "done" | "failed" | "needs_yes";
export interface StuckAction {
  id: string;
  kind: "retry" | "auto_retry" | "scout";
  status: ActionStatus;
  note: string | null;
  thread_id: string | null;
  auto: boolean;
  by: string | null;
}

/** What a Waiting card needs from Jared, when it does (Insurance Filer). Anything else about the card is just a status line. */
export interface StuckNeed {
  kind: "approval" | "call" | "contact" | "check";
  label: string;
  link: string | null;
  link_label: string | null;
  open: boolean | null;      // call only: are the insurer's lines open right now
  opens: string | null;      // call only: when they open next, already formatted
  call: { phone: string; name: string; company: string; purpose: string } | null;
}
/** A block of text to paste somewhere else, shown with a Copy button (the Tesla Service message). */
export interface StuckCopy { id: string; label: string; text: string; note: string | null }
export interface StuckTimelineRow { when: string; text: string; tone: "event" | "settled" }

export interface StuckItem {
  kind: "stuck" | "waiting" | "fixed";
  item_id: string;
  employee_slug: string | null;
  employee_name: string | null;
  title: string;
  subtitle: string | null;
  stuck_since: string | null;
  blocks: StuckBlock[];
  footer: string | null;
  undo?: StuckUndo | null;
  fix?: StuckFix | null;
  action?: StuckAction | null;
  link?: string | null;
  link_label?: string | null;
  pill?: string | null;
  needs_you?: StuckNeed | null;
  copy?: StuckCopy[];
  timeline?: StuckTimelineRow[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function parseFix(raw: unknown): StuckFix | null {
  const f = raw as Record<string, unknown> | null | undefined;
  if (!f || typeof f !== "object") return null;
  const kind = f.kind === "auth" || f.kind === "transient" ? f.kind : "other";
  const retry = f.retry === true;
  // A Retry button only exists where a retry does; an unknown or missing verdict falls back to Scout, never to a dead button.
  let primary: FixPrimary = f.primary === "key" || f.primary === "retry" || f.primary === "scout" ? f.primary : "scout";
  if (primary === "retry" && !retry) primary = "scout";
  return {
    kind, service: str(f.service), label: str(f.label) ?? "Last check-in was not OK", tail: str(f.tail) ?? "",
    link: str(f.link) ?? "/admin/settings", link_label: str(f.link_label), retry, where: str(f.where), primary,
    command: str(f.command), command_note: str(f.command_note),
  };
}

function parseAction(raw: unknown): StuckAction | null {
  const a = raw as Record<string, unknown> | null | undefined;
  if (!a || typeof a !== "object" || !str(a.id)) return null;
  const kind = a.kind === "scout" || a.kind === "auto_retry" ? a.kind : "retry";
  const status = a.status === "done" || a.status === "failed" || a.status === "needs_yes" ? a.status : "working";
  return { id: String(a.id), kind, status, note: str(a.note), thread_id: str(a.thread_id), auto: a.auto === true, by: str(a.by) };
}

function parseNeed(raw: unknown): StuckNeed | null {
  const n = raw as Record<string, unknown> | null | undefined;
  if (!n || typeof n !== "object" || !str(n.label)) return null;
  const kind = n.kind === "call" || n.kind === "contact" || n.kind === "check" ? n.kind : n.kind === "approval" ? "approval" : null;
  if (!kind) return null;
  const c = n.call as Record<string, unknown> | null | undefined;
  const phone = c && typeof c === "object" ? String(c.phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10})/, "") : "";
  return {
    kind, label: String(n.label), link: str(n.link), link_label: str(n.link_label),
    open: typeof n.open === "boolean" ? n.open : null, opens: str(n.opens),
    call: c && typeof c === "object" && phone.length === 10
      ? { phone, name: str(c.name) ?? "", company: str(c.company) ?? "", purpose: str(c.purpose) ?? "" } : null,
  };
}

function parseCopy(raw: unknown): StuckCopy[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).filter((c) => c && typeof c === "object" && str(c.id) && str(c.label) && str(c.text))
    .map((c) => ({ id: String(c.id), label: String(c.label), text: String(c.text), note: str(c.note) }));
}

function parseTimeline(raw: unknown): StuckTimelineRow[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).filter((t) => t && typeof t === "object" && str(t.text))
    .map((t) => ({ when: str(t.when) ?? "", text: String(t.text), tone: t.tone === "settled" ? "settled" as const : "event" as const }));
}

/** Defensive: anything that is not the shape we expect is dropped, so a bad feed can never throw inside the page. */
export function parseStuck(raw: unknown): StuckItem[] {
  if (!Array.isArray(raw)) return [];
  const out: StuckItem[] = [];
  for (const x of raw as Record<string, unknown>[]) {
    if (!x || typeof x !== "object") continue;
    const kind = x.kind;
    if ((kind !== "stuck" && kind !== "waiting" && kind !== "fixed") || !str(x.item_id) || !str(x.title)) continue;
    const blocks = (Array.isArray(x.blocks) ? (x.blocks as Record<string, unknown>[]) : [])
      .filter((b) => b && typeof b === "object" && str(b.id) && str(b.label))
      .map((b) => ({ id: String(b.id), label: String(b.label), detail: str(b.detail), fix_action: str(b.fix_action), fix_label: str(b.fix_label) }));
    const u = x.undo as Record<string, unknown> | null | undefined;
    out.push({
      kind, item_id: String(x.item_id), employee_slug: str(x.employee_slug), employee_name: str(x.employee_name),
      title: String(x.title), subtitle: str(x.subtitle), stuck_since: str(x.stuck_since), blocks, footer: str(x.footer),
      undo: u && str(u.id) ? { id: String(u.id), label: str(u.label) ?? "the fix", until: str(u.until) ?? "", at: str(u.at) ?? "", kind: str(u.kind) } : null,
      fix: parseFix(x.fix), action: parseAction(x.action),
      link: str(x.link), link_label: str(x.link_label),
      pill: str(x.pill), needs_you: parseNeed(x.needs_you), copy: parseCopy(x.copy), timeline: parseTimeline(x.timeline),
    });
  }
  return out;
}

/* ───────── the buttons ───────── */

export type FixButton = "key" | "retry" | "scout" | "prompt" | "snooze";

/** The one big button on an employee card. */
export function primaryLabel(fix: StuckFix): string {
  return fix.primary === "key" ? fix.link_label ?? "Update key" : fix.primary === "retry" ? "Retry now" : "Have Scout fix it";
}

/** What "More" holds, in order: whatever is not already the big button, then the prompt, then Snooze. */
export function moreButtons(fix: StuckFix | null | undefined): FixButton[] {
  const out: FixButton[] = [];
  if (fix) {   // a claim has no verdict: its own block buttons are the fixes, so More is just the prompt and Snooze
    if (fix.primary !== "scout") out.push("scout");
    if (fix.primary !== "retry" && fix.retry) out.push("retry");
  }
  out.push("prompt", "snooze");
  return out;
}

export const buttonLabel: Record<FixButton, string> = {
  key: "Update key", retry: "Retry now", scout: "Have Scout fix it", prompt: "Prompt for Claude", snooze: "Snooze 1 day",
};

/** The status line after a tap, in the employee's voice. The card adds "— Name" after it. */
export function actionLine(a: StuckAction): string {
  if (a.note) return a.note;
  if (a.status === "working") return a.kind === "scout" ? "Scout is looking into it." : "Trying again right now.";
  if (a.status === "done") return "That worked.";
  if (a.status === "needs_yes") return "Scout found a fix but needs your yes.";
  return "That did not work.";
}

/* ───────── small helpers ───────── */

export const NBSP = " ";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const word = (n: number) => WORDS[n] ?? String(n);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Fix it" for one, "Fix both" for two, "Fix all three" for more. Adapts as blocks get fixed. */
export const fixAllLabel = (n: number) => (n <= 1 ? "Fix it" : n === 2 ? "Fix both" : `Fix all ${word(n)}`);

/** "45 min", "29 hrs", "3 days": number and unit joined by a no-break space. */
export function spanText(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m}${NBSP}min`;
  if (m < 48 * 60) { const h = Math.floor(m / 60); return `${h}${NBSP}${h === 1 ? "hr" : "hrs"}`; }
  return `${Math.floor(m / 1440)}${NBSP}days`;
}

export const initials = (name: string | null) => (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

/** Wraps every number (with its unit when one follows) in a no-wrap span so it never splits across lines. */
const NUM = /(\$?\d[\d,.:]*(?:\s(?:AM|PM|hrs?|min|days?|mph|mi)\b)?)/g;
export function Nums({ text }: { text: string }) {
  const parts = text.split(NUM);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="whitespace-nowrap">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}

