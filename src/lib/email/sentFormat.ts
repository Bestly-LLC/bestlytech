// 12-hour times only (Jared's rule). Date and time are returned as separate pieces so the UI can keep each number with its unit.
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function timePart(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : TIME.format(d).replace(/ /g, " ");
}
export function dayPart(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DAY.format(d);
}
export function isToday(iso: string, now = new Date()): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
