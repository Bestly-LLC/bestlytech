// card-scan: the pure part (validation + rate-limit decisions), kept free of Deno/Supabase imports so it can be
// exercised offline (see logic.test.ts). index.ts supplies the real Store.

/**
 * Limits, sized for the in-car welcome card QR (a guest scans it once, maybe twice):
 *  - One browser already collapses to ONE row per src per 30 min (the dedupe below), so a real guest never gets near any cap.
 *  - PER_DEVICE: 3 new rows / 10 min across all src values. A real browser needs 1 (2 if it opens both /turo-key and /turo-lax).
 *    The device id is client-chosen, so this only stops a single naive script; the IP cap is the real brake.
 *  - PER_IP: 6 new rows / 10 min. Covers a couple of phones on one Wi-Fi or one carrier-NAT address scanning together.
 *    The cost of a false positive is one uncounted scan (the guest still gets the page), so we err tight.
 *  - GLOBAL: 300 new rows / hour, the same ceiling the old SQL function had. With the per-IP cap an attacker needs
 *    50+ distinct addresses per hour to even reach it, instead of one curl loop.
 *  Only NEW rows count. Repeats that dedupe to an existing row write nothing, so they cost no budget.
 */
export const LIMITS = {
  WINDOW_MS: 10 * 60_000,
  PER_DEVICE: 3,
  PER_IP: 6,
  GLOBAL: 300,
  GLOBAL_WINDOW_MS: 60 * 60_000,
  DEDUPE_MS: 30 * 60_000,
  IP_HASH_KEEP_MS: 60 * 60_000, // ip_hash is nulled after this: it exists only to rate-limit
} as const;

export const MAX_BODY_BYTES = 2048;

export type Row = { src: string; kind: "home" | "lax"; device: string | null; device_id: string | null; ip_hash: string };

export interface Store {
  /** Id of a row with this device_id + src newer than sinceIso, or null. */
  findRecent(deviceId: string, src: string, sinceIso: string): Promise<string | null>;
  /** New rows since sinceIso, filtered by ip_hash and/or device_id (neither = all rows). */
  countSince(sinceIso: string, f: { ipHash?: string; deviceId?: string }): Promise<number>;
  insert(row: Row): Promise<string>;
}

export type Result = { status: 200; id: string | null } | { status: 400 | 429 };

const SRC_RE = /^[a-z0-9-]{1,24}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

/** Plain label like "iPhone Safari (in-app)". Anything outside a small safe alphabet is dropped, then cut to 40. */
export function cleanDevice(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[^A-Za-z0-9 ().-]/g, "").trim().slice(0, 40);
  return s || null;
}

/** Validates an untrusted body. Returns the cleaned fields, or null when it must be refused. */
export function parseScan(body: unknown): { src: string; kind: "home" | "lax"; device: string | null; device_id: string | null } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.src !== "string" || !SRC_RE.test(b.src)) return null;
  if (b.kind !== "home" && b.kind !== "lax") return null; // stricter than the SQL function, which coerced anything else to home
  const device_id = typeof b.device_id === "string" && DEVICE_ID_RE.test(b.device_id) ? b.device_id : null; // bad id: still log the scan, just no dedupe
  return { src: b.src, kind: b.kind, device: cleanDevice(b.device), device_id };
}

export async function logScan(body: unknown, ipHash: string, store: Store, now = Date.now()): Promise<Result> {
  const p = parseScan(body);
  if (!p) return { status: 400 };
  const iso = (ms: number) => new Date(now - ms).toISOString();

  // Same browser, same card, within 30 min: reuse the row (no write, so no budget used).
  if (p.device_id) {
    const prior = await store.findRecent(p.device_id, p.src, iso(LIMITS.DEDUPE_MS));
    if (prior) return { status: 200, id: prior };
  }

  if ((await store.countSince(iso(LIMITS.WINDOW_MS), { ipHash })) >= LIMITS.PER_IP) return { status: 429 };
  if (p.device_id && (await store.countSince(iso(LIMITS.WINDOW_MS), { deviceId: p.device_id })) >= LIMITS.PER_DEVICE) return { status: 429 };
  // Old behaviour kept: a full hour budget means "drop quietly" (no id), not an error the page would care about.
  if ((await store.countSince(iso(LIMITS.GLOBAL_WINDOW_MS), {})) >= LIMITS.GLOBAL) return { status: 200, id: null };

  const id = await store.insert({ ...p, ip_hash: ipHash });
  return { status: 200, id };
}
