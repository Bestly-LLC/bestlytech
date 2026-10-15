// card-scan — logs a scan of the in-car welcome card QR (bestly.tech/turo-key?src=card).
//   POST { src, kind: "home"|"lax", device?, device_id? }  ->  200 { ok: true, id }   (id = scan id, or null when dropped)
//                                                              400 { ok: false } bad input · 429 { ok: false } rate limited
// Public on purpose (verify_jwt = false): the guest is anonymous. This replaces the public card_scan_log() RPC, which was a
// SECURITY DEFINER writer callable with the publishable key. The insert now uses the service role, behind per-IP and
// per-device limits (logic.ts). The returned id is the opaque handle TuroEntry later passes to card_scan_link (token-bound).
// The body is untrusted: every field is re-validated, nothing from it is logged, and no table data is ever returned.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { LIMITS, MAX_BODY_BYTES, type Row, type Store, logScan } from "./logic.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const KEY = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, KEY, { auth: { persistSession: false } });

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const clientIp = (req: Request) =>
  (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "unknown").trim();

// Peppered with the service key tail, so the stored value cannot be reversed by hashing the IPv4 space.
async function ipHash(ip: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`card-scan:${ip}:${KEY.slice(-24)}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// Cheap first brake, per isolate: 30 requests/min per IP hash, before any database work. Best effort only (isolates are
// many and short-lived); the database counts in logic.ts are the real limit.
const burst = new Map<string, { n: number; t: number }>();
function burstOk(k: string, now = Date.now()): boolean {
  if (burst.size > 2000) { for (const [h, v] of burst) if (now - v.t > 60_000) burst.delete(h); if (burst.size > 2000) burst.clear(); }
  const e = burst.get(k);
  if (!e || now - e.t > 60_000) { burst.set(k, { n: 1, t: now }); return true; }
  return ++e.n <= 30;
}

const store: Store = {
  async findRecent(deviceId, src, sinceIso) {
    const { data, error } = await sb.from("card_scans").select("id").eq("device_id", deviceId).eq("src", src)
      .gt("scanned_at", sinceIso).order("scanned_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  },
  async countSince(sinceIso, f) {
    let q = sb.from("card_scans").select("id", { count: "exact", head: true }).gt("scanned_at", sinceIso);
    if (f.ipHash) q = q.eq("ip_hash", f.ipHash);
    if (f.deviceId) q = q.eq("device_id", f.deviceId);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  },
  async insert(row: Row) {
    const { data, error } = await sb.from("card_scans").insert(row).select("id").single();
    if (error || !data) throw error ?? new Error("no row");
    return data.id as string;
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false }, 405);
  try {
    const hash = await ipHash(clientIp(req));
    if (!burstOk(hash)) return json({ ok: false }, 429);

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json({ ok: false }, 400);
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ ok: false }, 400);
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* falls through to 400 */ }

    const r = await logScan(body, hash, store);
    if (r.status !== 200) return json({ ok: false }, r.status);

    // The hash exists only for the rate window; clear old ones now and then (about 1 in 20 writes), no cron needed.
    if (r.id && Math.random() < 0.05) {
      void sb.from("card_scans").update({ ip_hash: null }).not("ip_hash", "is", null)
        .lt("scanned_at", new Date(Date.now() - LIMITS.IP_HASH_KEEP_MS).toISOString()).then(() => {}, () => {});
    }
    return json({ ok: true, id: r.id });
  } catch (e) {
    console.error("card-scan failed", e instanceof Error ? e.message : "unknown"); // never the body
    return json({ ok: false }, 500);
  }
});
