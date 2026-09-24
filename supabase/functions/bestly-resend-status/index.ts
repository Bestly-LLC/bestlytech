// bestly-resend-status — look at, add to, and test the Resend sending domains.
//
// Exists so a question like "is there a free domain slot left" is answered by
// the account itself rather than by a pricing blog. Returns domain names,
// status and the DNS records to publish. Never returns the API key.
//
// Actions: list | add | check | send | email_status
//
// NOTE on `check`: Resend's GET /domains/{id} has been observed returning a
// stale "pending" for hours after the dashboard shows Verified. Treat a
// pending here as inconclusive, not as proof. A real `send` is the only
// honest test of whether sending works.
//
// NOTE on `send`: a hard bounce puts the recipient on Resend's suppression
// list, and a later send to that address returns last_event "suppressed"
// without ever leaving Resend. That looks identical to "still broken" when it
// actually means "we never tried". If a send reads suppressed, clear the
// address from Suppressions before concluding anything about delivery.
//
// KEY ROTATION: this shared the old shop key, which shipped as a literal
// fallback in the hoku-clean repo and is therefore burned. The expired legacy
// key was deleted from this file on 2026-09-24.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (shop_key_sha256, plus shop_key_prev_sha256 while callers move
// over); edge_key_ok() (service-role only) checks them.
const __keyDb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
async function keyOk(k: string | null | undefined): Promise<boolean> {
  if (!k) return false;
  for (const n of ["shop_key_sha256", "shop_key_prev_sha256"]) {
    const { data } = await __keyDb.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shop-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const ok = isSvc(req) || await keyOk(req.headers.get("x-shop-key"));
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "RESEND_API_KEY is not set in this project" }, 500);
  const H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* empty ok */ }
  const action = String(input.action ?? "list");

  const slim = (d: Record<string, unknown>) => ({
    id: d.id, name: d.name, status: d.status, region: d.region, created_at: d.created_at,
    records: (d.records as Record<string, unknown>[] | undefined)?.map((r) => ({
      record: r.record, name: r.name, type: r.type, ttl: r.ttl,
      priority: r.priority, value: r.value, status: r.status,
    })),
  });

  if (action === "list") {
    const r = await fetch("https://api.resend.com/domains", { headers: H });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: b?.message ?? `resend ${r.status}` }, r.status);
    const list = (b?.data ?? []) as Record<string, unknown>[];
    return json({
      ok: true, domain_count: list.length, free_plan_allows: 3,
      slots_left_on_free: Math.max(0, 3 - list.length),
      domains: list.map(slim),
    });
  }

  if (action === "add") {
    const name = String(input.name ?? "").trim().toLowerCase();
    if (!name) return json({ error: "name required" }, 400);
    const r = await fetch("https://api.resend.com/domains", {
      method: "POST", headers: H,
      body: JSON.stringify({ name, region: String(input.region ?? "us-east-1") }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: b?.message ?? `resend ${r.status}`, detail: b }, r.status);
    return json({ ok: true, domain: slim(b) });
  }

  if (action === "check") {
    const id = String(input.id ?? "");
    if (!id) return json({ error: "id required" }, 400);
    await fetch(`https://api.resend.com/domains/${id}/verify`, { method: "POST", headers: H });
    const g = await fetch(`https://api.resend.com/domains/${id}`, { headers: H });
    const b = await g.json().catch(() => ({}));
    if (!g.ok) return json({ error: b?.message ?? `resend ${g.status}` }, g.status);
    return json({
      ok: true, domain: slim(b),
      caveat: "Resend's API status can lag the dashboard by hours. A pending here is not proof of failure.",
    });
  }

  // The only honest proof that a domain can send. Returns the message id so
  // delivery can be followed up with email_status.
  if (action === "send") {
    const to = Array.isArray(input.to) ? input.to.map(String) : [String(input.to ?? "")];
    if (!to[0]) return json({ error: "to required" }, 400);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: H,
      body: JSON.stringify({
        from: String(input.from ?? "HOKU <hello@news.hoku-clean.com>"),
        to,
        subject: String(input.subject ?? "HOKU sending test"),
        text: String(input.text ?? "Test."),
      }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: b?.message ?? `resend ${r.status}`, detail: b }, r.status);
    return json({ ok: true, id: b?.id, to });
  }

  if (action === "email_status") {
    const id = String(input.id ?? "");
    if (!id) return json({ error: "id required" }, 400);
    const g = await fetch(`https://api.resend.com/emails/${id}`, { headers: H });
    const b = await g.json().catch(() => ({}));
    if (!g.ok) return json({ error: b?.message ?? `resend ${g.status}` }, g.status);
    return json({
      ok: true,
      id: b?.id, to: b?.to, from: b?.from, subject: b?.subject,
      last_event: b?.last_event, created_at: b?.created_at,
    });
  }

  return json({ error: `unknown action "${action}"` }, 400);
});
