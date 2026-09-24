// partner-mail-ingest: the Mac mini posts one email Jared sent a partner (plus its attachments);
// this stores the attachments in the private partner-files bucket and upserts the partner_mail row.
// Auth: the partner-ai worker key (Supabase Vault: partner_ai_worker_key). verify_jwt = false.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

const safe = (s: string) => s.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

Deno.serve(async (req) => {
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return J({ ok: false, error: "json" }, 400); }
  const { data: ok } = await sb.rpc("partner_ai_key_ok", { p_key: String(b.key ?? "") });
  if (!ok) return J({ ok: false, error: "bad key" }, 401);

  const roster = String(b.roster ?? "").toLowerCase();
  const m = b.message ?? {};
  if (!/^[a-z0-9_-]{2,40}$/.test(roster) || !m.message_id) return J({ ok: false, error: "roster and message_id required" }, 400);

  const dir = `${roster}/${(m.sent_at ?? "").slice(0, 10) || "undated"}-${(await sha(m.message_id)).slice(0, 10)}`;
  const atts: unknown[] = [];
  for (const a of (b.attachments ?? []) as { name: string; type?: string; b64: string }[]) {
    const bytes = Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0));
    const path = `${dir}/${safe(a.name)}`;
    const { error } = await sb.storage.from("partner-files").upload(path, bytes, { contentType: a.type || "application/octet-stream", upsert: true });
    if (error) return J({ ok: false, error: `upload ${a.name}: ${error.message}` }, 500);
    atts.push({ name: a.name, size: bytes.length, type: a.type ?? null, path });
  }
  for (const s of (b.skipped ?? []) as { name: string; size: number; type?: string }[]) atts.push({ ...s, path: null, skipped: "too large" });

  const { error } = await sb.from("partner_mail").upsert({
    roster, message_id: m.message_id, account: m.account ?? "", subject: m.subject ?? null, sent_at: m.sent_at ?? null,
    to_addrs: m.to ?? [], cc_addrs: m.cc ?? [], body_text: (m.body ?? "").slice(0, 60000), links: m.links ?? [], attachments: atts,
  }, { onConflict: "roster,message_id" });
  if (error) return J({ ok: false, error: error.message }, 500);
  return J({ ok: true, attachments: atts.length });
});

async function sha(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
