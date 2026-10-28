// _shared/hop-wait.ts — how long a self-hop must wait before it starts (Scout's busy pause).
//
// 2026-10-28: admin-chat used to wait 30 s INSIDE the invocation that was about to end (setTimeout, then fetch). The platform
// killed that invocation before the timer fired, so the next hop never ran and the progress note ("Working: waiting for the free
// AI to free up (0 steps)") sat for two days. Now the hop is fired at once with `not_before` in the body, and the NEW invocation
// (which has a fresh lifetime) does the waiting. This file is the one place that decides how long.

/** Never wait longer than this in one request: the platform kills a function at 150 s and the request still needs its own budget. */
export const HOP_WAIT_CAP_MS = 35_000;
/** How long a busy pause asks the next hop to wait (Groq's per-minute limits clear in about this long). */
export const PAUSE_WAIT_MS = 30_000;

/** Milliseconds to sleep before running, from the `not_before` ISO time in the hop body. 0 for anything missing, invalid or already past. */
export function hopWaitMs(notBefore: unknown, now: number = Date.now(), capMs: number = HOP_WAIT_CAP_MS): number {
  if (typeof notBefore !== "string" || !notBefore) return 0;
  const at = Date.parse(notBefore);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.min(capMs, at - now));
}

/** The `not_before` to put in a hop body: now plus the pause, as an ISO string. */
export function notBeforeIso(now: number = Date.now(), waitMs: number = PAUSE_WAIT_MS): string {
  return new Date(now + waitMs).toISOString();
}
