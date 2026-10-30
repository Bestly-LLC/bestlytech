/** Pure logic for the Command Center home (no data access), so tests can import it. */
import type { WxEventsPayload } from "@/lib/commandCenter";

export interface TodayRow {
  key: string; source: string; severity: string; title: string; detail: string | null; action_label: string | null;
  url: string | null; since: string | null; item_count: number | null; rank: number;
}

export const SEV: Record<string, number> = { blocked: 0, critical: 0, error: 0, warning: 1, todo: 2, info: 3 };

const ARES = /^Ares couldn't fix: /;
/** Rows Ares raises one finding at a time. More than this many fold into one "Ares couldn't fix N" row that opens Security. */
const FOLD_OVER = 2;

/**
 * Real items only (no FYI), same notice raised twice shown once, worst then oldest first.
 * Ares's unfixed findings fold into ONE row (2026-10-30: 40 DMARC/header/port rows made the AI team card read "48 need you"
 * and buried the three things that were actually his). The "N security problems need you" outage row repeats that same
 * pile, so it goes when the fold is there. Nothing is hidden: the folded row opens Security, which lists every finding.
 */
export function realNeeds(rows: TodayRow[] | undefined): TodayRow[] {
  const seen = new Set<string>();
  const sorted = (rows ?? [])
    .filter((r) => (SEV[r.severity] ?? 3) < 3)
    .sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3) || (a.since ?? "").localeCompare(b.since ?? ""))
    .filter((r) => { const k = `${r.source}|${r.title.trim().toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const ares = sorted.filter((r) => ARES.test(r.title));
  if (ares.length <= FOLD_OVER) return sorted;
  const worst = ares[0];
  const fold: TodayRow = {
    key: "fold:ares",
    source: worst.source,
    severity: worst.severity,
    title: `Ares couldn't fix ${ares.length} security findings`,
    detail: `Worst first: ${worst.title.replace(ARES, "")}. He keeps trying each night.`,
    action_label: "Open Security",
    url: "/admin/security",
    since: ares.map((r) => r.since).filter(Boolean).sort()[0] ?? worst.since,
    item_count: ares.length,
    rank: worst.rank,
  };
  const out: TodayRow[] = [];
  let placed = false;
  for (const r of sorted) {
    if (ARES.test(r.title)) { if (!placed) { out.push(fold); placed = true; } continue; }
    if (/\bsecurity problems? need you\b/i.test(r.title)) continue;
    out.push(r);
  }
  return out;
}

export interface Upcoming { title: string; start: string }

/**
 * What is next on the calendar, from BOTH places it lives: the meetings feed (next-meeting) and the calendar items the weather
 * draws (admin_cc_wx_events). Before 2026-10-30 My day read only the first, so it said "Mon 12:00 PM" while Friday's Happy Hour
 * sat on the weather, and it compared objects by reference, so the same meeting came back as its own "then" ("Eli x Jared, then
 * Eli x Jared"). Turo items are left to the Turo card; all-day items are not "next".
 */
export function upcoming(meetings: { next: { title: string; start: string } | null | undefined; events: { title: string; start: string }[] }, evs: WxEventsPayload | undefined, now = Date.now()): Upcoming[] {
  const all: Upcoming[] = [
    ...meetings.events.map((e) => ({ title: e.title, start: e.start })),
    ...(meetings.next ? [{ title: meetings.next.title, start: meetings.next.start }] : []),
    ...(evs?.events ?? []).filter((e) => e.source !== "turo" && !e.all_day).map((e) => ({ title: e.title, start: e.start })),
  ];
  const seen = new Set<string>();
  return all
    .map((e) => ({ title: (e.title ?? "").replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim(), start: e.start }))
    .filter((e) => e.title && new Date(e.start).getTime() >= now - 5 * 60_000)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .filter((e) => {
      const k = `${e.title.toLowerCase()}|${Math.round(new Date(e.start).getTime() / 60_000)}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
}

