/**
 * Meeting-time helpers for Ava's booked calls. Pure and deterministic: no AI, no network, no dependencies.
 *
 * parseMeetingTime turns what the prospect said ("Tuesday at 2pm Pacific", "tomorrow at 9") into a real instant.
 *   confidence "high": an explicit weekday/date AND exactly one clock time, landing in the future. Safe to book as-is.
 *   confidence "low":  anything vague or ambiguous ("Tuesday afternoon", "next week", "9 a.m. and noon", ranges).
 *                      start_at then holds a best guess when one exists (null otherwise) so the UI can prefill a picker.
 *
 * Relative words ("tomorrow", "Tuesday") are counted from `ref` (when Ava took the call), not from `now`, because
 * "tomorrow" means tomorrow relative to the call. The result still has to be in the future of `now` to count as high.
 */

export type Confidence = "high" | "low";
export type ParsedMeetingTime = { start_at: string | null; confidence: Confidence; tz: string; reason?: string };

export const DEFAULT_TZ = "America/Los_Angeles";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD_RE: [RegExp, number][] = [
  [/\bsun(?:day)?\b/, 0], [/\bmon(?:day)?\b/, 1], [/\btue(?:s|sday)?\b/, 2], [/\bwed(?:nesday)?\b/, 3],
  [/\bthu(?:r|rs|rsday)?\b/, 4], [/\bfri(?:day)?\b/, 5], [/\bsat(?:urday)?\b/, 6],
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TZ_WORDS: [RegExp, string][] = [
  [/\b(?:pacific|pst|pdt|pt)\b/, "America/Los_Angeles"],
  [/\b(?:mountain|mst|mdt|mt)\b/, "America/Denver"],
  [/\b(?:central|cst|cdt|ct)\b/, "America/Chicago"],
  [/\b(?:eastern|est|edt|et)\b/, "America/New_York"],
  [/\balaska(?:n)?\b/, "America/Anchorage"],
  [/\bhawaii(?:an)?\b/, "Pacific/Honolulu"],
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Y/M/D/h/m/weekday of an instant as seen on a wall clock in `tz`. */
export function wallParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(d)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute };
}

/** The instant at which a wall clock in `tz` reads y-m-d h:min. Handles DST by correcting twice. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const want = Date.UTC(y, m - 1, d, h, min);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const w = wallParts(new Date(t), tz);
    t += want - Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
  }
  return new Date(t);
}

/** "2026-10-14T14:00" (what <input type="datetime-local"> holds) for an instant, read in `tz`. */
export function toLocalInput(iso: string | Date, tz: string): string {
  const w = wallParts(typeof iso === "string" ? new Date(iso) : iso, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.min)}`;
}

/** The inverse: a datetime-local value typed in `tz` back to an ISO instant, or null if it is not a full date and time. */
export function fromLocalInput(v: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz).toISOString();
}

/** "Tue, Oct 14 at 2:00 PM CDT", always 12-hour, with the zone it is shown in. */
export function formatMeeting(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(d);
  return `${day} at ${time}`;
}

const isTz = (tz: string | null | undefined): tz is string => {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

type Clock = { h: number; min: number };

function findClocks(t: string): Clock[] {
  const out: Clock[] = [];
  const add = (h: number, min: number) => { if (!out.some((c) => c.h === h && c.min === min)) out.push({ h, min }); };
  // 2pm, 2:30 pm, 12pm (noon is rewritten to 12pm before this runs)
  for (const m of t.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/g)) {
    let h = Number(m[1]) % 12; if (m[3] === "pm") h += 12;
    add(h, m[2] ? Number(m[2]) : 0);
  }
  // 14:00 (24-hour, no am/pm)
  // (a bare "2:30" is read as business hours, like "at 2", not as 2:30 in the morning)
  for (const m of t.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:am|pm))/g)) {
    const n = Number(m[1]);
    add(m[1].startsWith("0") || n > 12 ? n : n >= 7 && n <= 11 ? n : n === 12 ? 12 : n + 12, Number(m[2]));
  }
  // "at 9", "at 2": no am/pm, so assume business hours (7 to 11 morning, 12 to 6 afternoon)
  for (const m of t.matchAll(/\bat\s+(1[0-2]|0?[1-9])\b(?!\s*(?::|am|pm|\d))/g)) {
    const n = Number(m[1]);
    add(n >= 7 && n <= 11 ? n : n === 12 ? 12 : n + 12, 0);
  }
  return out;
}

export function parseMeetingTime(text: string | null | undefined, leadTz: string | null | undefined, now: Date = new Date(), ref: Date = now): ParsedMeetingTime {
  let tz = isTz(leadTz) ? leadTz : DEFAULT_TZ;
  const raw = (text ?? "").trim();
  if (!raw) return { start_at: null, confidence: "low", tz, reason: "no time given" };

  let t = raw.toLowerCase()
    .replace(/\b([ap])\.\s?m\.?/g, "$1m")
    .replace(/\b(?:12\s*)?noon\b/g, "12pm")
    .replace(/[,;]/g, " ");

  for (const [re, z] of TZ_WORDS) if (re.test(t)) { tz = z; break; }

  const clocks = findClocks(t);
  const range = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to|until|through|and|or)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/.test(t) && clocks.length > 0;
  const ambiguousTime = clocks.length > 1 || range;

  // Date: today / tomorrow / explicit month-day / m/d / weekday, all counted from `ref` on the lead's wall clock.
  const r = wallParts(ref, tz);
  const refDay = Date.UTC(r.y, r.m - 1, r.d);
  const addDays = (n: number) => { const x = new Date(refDay + n * 864e5); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
  let date: { y: number; m: number; d: number } | null = null;
  let vague: string | undefined;

  const monthDay = new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  const slash = /\b(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])(?:\/(\d{2,4}))?\b/.exec(t);
  let weekday = -1;
  for (const [re, n] of WD_RE) if (re.test(t)) { weekday = n; break; }

  if (monthDay || slash) {
    const mo = monthDay ? MONTHS.indexOf(monthDay[1]) + 1 : Number(slash![1]);
    const da = monthDay ? Number(monthDay[2]) : Number(slash![2]);
    let yr = r.y;
    if (slash?.[3]) yr = Number(slash[3]) < 100 ? 2000 + Number(slash[3]) : Number(slash[3]);
    else if (Date.UTC(yr, mo - 1, da) < refDay) yr += 1;
    const chk = new Date(Date.UTC(yr, mo - 1, da));
    if (chk.getUTCMonth() === mo - 1 && chk.getUTCDate() === da) {
      date = { y: yr, m: mo, d: da };
      if (weekday >= 0 && chk.getUTCDay() !== weekday) vague = "weekday and date disagree";
    } else vague = "not a real date";
  } else if (/\btomorrow\b/.test(t)) {
    date = addDays(1);
  } else if (/\btoday\b|\btonight\b/.test(t)) {
    date = addDays(0);
  } else if (weekday >= 0) {
    const first = ((weekday - new Date(refDay).getUTCDay() + 7) % 7) || 7; // next one strictly after the call day
    date = addDays(first);
    // "next Tuesday" said early in the week could mean this week's or next week's
    if (/\bnext\b/.test(t) && first + new Date(refDay).getUTCDay() < 7) vague = `"next ${WEEKDAYS[weekday]}" could mean two different days`;
  } else if (/\bnext week\b|\bthis week\b|\bweek of\b/.test(t)) {
    vague = "no day given";
  }

  const clock = clocks[0];
  let guess: Date | null = null;
  if (date) guess = zonedToUtc(date.y, date.m, date.d, clock ? clock.h : 10, clock ? clock.min : 0, tz);

  if (!date) return { start_at: null, confidence: "low", tz, reason: vague ?? "no day given" };
  if (!clock) return { start_at: guess!.toISOString(), confidence: "low", tz, reason: "no clock time given" };
  if (ambiguousTime) return { start_at: guess!.toISOString(), confidence: "low", tz, reason: "more than one time given" };
  if (vague) return { start_at: guess!.toISOString(), confidence: "low", tz, reason: vague };
  if (guess!.getTime() <= now.getTime()) return { start_at: guess!.toISOString(), confidence: "low", tz, reason: "that time has already passed" };
  return { start_at: guess!.toISOString(), confidence: "high", tz };
}
