// privacy-verify: the public side of the Privacy Clerk (Vera). verify_jwt = false (see supabase/config.toml).
// The page at bestly.tech/p/<token> talks to this and nothing else.
//   GET  ?t=<token>              {status, action, requested_on, code}. Never an email or phone number.
//   POST {t}                     "Yes, this was me": marks the case verified and wakes Vera.
//   GET  ?t=<token>&download=1   streams the person's data file once their export request is done.
// A token that does not exist or has expired gets a flat 404 after a 300 ms pause. 20 requests per token per hour.
import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors: Record<string, string> = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const J = (b: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
const notFound = async () => { await new Promise((r) => setTimeout(r, 300)); return J({ error: "not found" }, 404); };

type Case = {
  id: string; ticket_code: string; action: string | null; status: string; token_expires_at: string | null; created_at: string;
  export_path: string | null; export_expires_at: string | null; downloaded_at: string | null; hits: number; hits_window_at: string | null;
};
const COLS = "id, ticket_code, action, status, token_expires_at, created_at, export_path, export_expires_at, downloaded_at, hits, hits_window_at";

function view(c: Case): "confirm" | "confirmed" | "done" | "closed" {
  if (c.status === "awaiting_verification") return "confirm";
  if (["verified", "ready", "approved", "needs_jared"].includes(c.status)) return "confirmed";
  if (c.status === "done") return "done";
  return "closed";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  let token = "";
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { return J({ error: "bad request" }, 400); }
    token = String(body.t ?? "");
  } else if (req.method === "GET") token = url.searchParams.get("t") ?? "";
  else return J({ error: "method not allowed" }, 405);

  if (!/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/.test(token)) return await notFound();
  const { data, error } = await db.from("privacy_cases").select(COLS).eq("token", token).maybeSingle();
  if (error) return J({ error: "try again in a minute" }, 500);
  const c = data as Case | null;
  if (!c || !c.token_expires_at || Date.parse(c.token_expires_at) < Date.now()) return await notFound();

  // 20 requests per token per hour
  const fresh = !c.hits_window_at || Date.now() - Date.parse(c.hits_window_at) > 3600_000;
  const hits = fresh ? 1 : c.hits + 1;
  await db.from("privacy_cases").update({ hits, ...(fresh ? { hits_window_at: new Date().toISOString() } : {}) }).eq("id", c.id);
  if (hits > 20) return J({ error: "too many requests, try again later" }, 429, { "Retry-After": "3600" });

  if (req.method === "GET" && url.searchParams.get("download") === "1") {
    if (c.status !== "done" || c.action !== "export" || !c.export_path) return await notFound();
    if (c.export_expires_at && Date.parse(c.export_expires_at) < Date.now()) return await notFound();
    const file = await db.storage.from("privacy-exports").download(c.export_path);
    if (file.error || !file.data) return await notFound();
    const now = new Date();
    if (!c.downloaded_at) {
      const week = new Date(now.getTime() + 7 * 86400_000);
      const cap = c.export_expires_at ? new Date(Math.min(Date.parse(c.export_expires_at), week.getTime())) : week;
      await db.from("privacy_cases").update({ downloaded_at: now.toISOString(), export_expires_at: cap.toISOString(), updated_at: now.toISOString() }).eq("id", c.id);
    }
    return new Response(file.data, { status: 200, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="bestly-data-${c.ticket_code}.json"` } });
  }

  if (req.method === "POST") {
    if (c.status === "awaiting_verification") {
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
      const { data: upd } = await db.from("privacy_cases").update({ verified_at: new Date().toISOString(), verified_ip: ip, status: "verified", updated_at: new Date().toISOString() })
        .eq("id", c.id).eq("status", "awaiting_verification").select("id");
      if (upd?.length) {
        // wake Vera now instead of waiting for her next tick; she also picks it up on her own if this fails
        const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/privacy-clerk`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET },
          body: JSON.stringify({ run: "case", code: c.ticket_code }) }).catch(() => null);
        try { (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(kick); } catch { /* fine */ }
      }
      return J({ status: "confirmed" });
    }
    return J({ status: view(c) });
  }

  return J({
    status: view(c), action: c.action, requested_on: c.created_at, code: c.ticket_code,
    download: c.status === "done" && c.action === "export" && !!c.export_path && !(c.export_expires_at && Date.parse(c.export_expires_at) < Date.now()),
  });
});
