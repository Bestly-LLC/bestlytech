/** Pure pieces of the Stuck / Waiting cards: the feed shape, parsing, and number formatting. No data access, so tests can import it. */
import { Fragment } from "react";

/* ───────── types and parsing ───────── */

export interface StuckBlock { id: string; label: string; detail: string | null; fix_action: string | null; fix_label: string | null }
export interface StuckUndo { id: string; label: string; until: string; at: string }
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
  link?: string | null;
  link_label?: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

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
      undo: u && str(u.id) ? { id: String(u.id), label: str(u.label) ?? "the fix", until: str(u.until) ?? "", at: str(u.at) ?? "" } : null,
      link: str(x.link), link_label: str(x.link_label),
    });
  }
  return out;
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

