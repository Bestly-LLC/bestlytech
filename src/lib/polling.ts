/**
 * PERF-03: add up to ~10% random jitter to a base polling interval so
 * multiple concurrently-mounted dashboards don't fire their fetches on
 * exactly the same minute boundaries.
 */
export function pollInterval(baseMs: number, jitterRatio = 0.1): number {
  const jitter = Math.floor(Math.random() * baseMs * jitterRatio);
  return baseMs + jitter;
}
