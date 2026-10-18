/**
 * Words and times for the call debrief. House rules, all of them here so no component has to remember:
 * times are 12-hour (Pacific, like the rest of the admin), a number never wraps away from its unit,
 * and nothing is ever cut short with "...".
 */

const TZ = "America/Los_Angeles";
const NBSP = " ";

/** "12:52 PM". */
export function clock12(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
}

/** The calendar day of a moment in Pacific time, as YYYY-MM-DD. */
function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "Today", "Yesterday", or "Mon, Oct 19" (with the year when it is not this year). */
export function dayWord(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = ymd(d);
  if (day === ymd(now)) return "Today";
  if (day === ymd(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  const sameYear = day.slice(0, 4) === ymd(now).slice(0, 4);
  return d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "Today, 12:52 PM". */
export function stamp(iso: string | null | undefined, now: Date = new Date()): string {
  const day = dayWord(iso, now);
  const time = clock12(iso);
  return [day, time].filter(Boolean).join(", ");
}

/** A due date (YYYY-MM-DD) as "Fri, Oct 23". A date has no time zone, so it is read as noon UTC to never slip a day. */
export function dueLabel(due: string | null | undefined, now: Date = new Date()): string {
  if (!due) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return "";
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = m[1] === ymd(now).slice(0, 4);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Whole minutes between two moments, or null when either is missing. */
export function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.max(1, Math.round(ms / 60_000));
}

/** "47 min", "1 hr 5 min", "2 hr". The number and its unit are joined with a no-break space. */
export function durationLabel(mins: number | null): string {
  if (mins == null) return "";
  if (mins < 60) return `${mins}${NBSP}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}${NBSP}hr ${m}${NBSP}min` : `${h}${NBSP}hr`;
}

/** Seconds into the call as "12:04" or "1:02:03" (elapsed time, not a clock time). */
export function callOffset(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const MONTH_BEFORE_DAY = new RegExp(`\\b(${MONTHS})\\.?\\s+(?=\\d)`, "g");

/**
 * Keeps small things together when a line wraps, without ever changing the words:
 * "3 reels", "47 min", "Oct 23", "12:52 PM" each stay on one line.
 * Display only. Never write the result back to the database or into an input.
 */
export function glue(text: string): string {
  if (!text) return text;
  return text
    .replace(/(\d{1,2}:\d{2})\s+(?=[AaPp][Mm]\b)/g, `$1${NBSP}`)
    .replace(MONTH_BEFORE_DAY, (_m, mon: string) => `${mon}${NBSP}`)
    .replace(/(\d)\s+(?=\p{L})/gu, `$1${NBSP}`);
}

/** Capitalise a first name that arrives lower case ("eli" becomes "Eli"). */
export function nice(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "";
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** "Jared, Eli, Elizabeth" from a list of names, each tidied and de-duplicated. */
export function joinNames(names: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = nice(raw.replace(/[-_]+/g, " "));
    const key = n.toLowerCase();
    if (!n || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.join(", ");
}

/** "Elizabeth's": a possessive that also works for a name ending in s. */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/** "1 thing" / "3 things" with the number glued to its word. */
export function count(n: number, one: string, many: string = `${one}s`): string {
  return `${n}${NBSP}${n === 1 ? one : many}`;
}
