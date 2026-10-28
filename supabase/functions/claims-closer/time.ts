// Los Angeles time helpers for Claims Closer. Pure. Everything a person reads is 12-hour Pacific.
export const TZ = "America/Los_Angeles";
export const HOUR = 36e5;
export const DAY = 864e5;

/** 12-hour Pacific, e.g. "Wed, Oct 28, 1:45 PM" */
export const fmtPT = (iso?: string | number | null): string | null => iso == null ? null
  : new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

function offsetMs(ms: number): number {   // LA wall clock minus UTC at this instant (negative), independent of the machine's own time zone
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((x) => x.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
}
/** the instant for a wall-clock time in Los Angeles ("2026-10-31", 9, 30) */
export function laInstant(dateIso: string, h: number, m: number): number {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  return guess - offsetMs(guess - offsetMs(guess));
}
export const laDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
export const laWeekday = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
export const spokenTime = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "October 06 at 11:55 AM" (Turo's wording, Los Angeles time) -> epoch ms, this year (next year if that is far past). */
export function laTime(text: string, nowMs = Date.now()): number | null {
  const m = /^([A-Za-z]+) (\d{1,2}) at (\d{1,2}):(\d{2}) ?([AP]M)$/i.exec(text.trim());
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].toLowerCase());
  if (mon < 0) return null;
  let h = Number(m[3]) % 12; if (m[5].toUpperCase() === "PM") h += 12;
  const year = Number(new Date(nowMs).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 4));
  const at = (y: number) => {
    const iso = `${y}-${String(mon + 1).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
    return laInstant(iso, h, Number(m[4]));
  };
  const t = at(year);
  return t < nowMs - 200 * DAY ? at(year + 1) : t;
}

/** "Friday, October 23, 2026 at 9:30 PM" (the date Turo's 7-days-left reminder gives for filing a claim) -> epoch ms */
export function laTimeLong(text: string): number | null {
  const m = /(?:[A-Za-z]+,\s+)?([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s?([AP]M)/i.exec(text);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].toLowerCase()); if (mon < 0) return null;
  let h = Number(m[4]) % 12; if (m[6].toUpperCase() === "PM") h += 12;
  return laInstant(`${m[3]}-${String(mon + 1).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`, h, Number(m[5]));
}
