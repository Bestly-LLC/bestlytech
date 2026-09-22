// partner-admin — Jared manages partner logins (Eli) from /admin/partners.
//
//   op list                 partners, whether they have a login, last sign-in
//   op link    {partner_id} creates the login the first time (no email is sent),
//                           then returns a one-time sign-in link for Jared to text them
//   op disable {partner_id} turns their access off (the login is kept, but blocked)
//   op enable  {partner_id}
//
// Admin JWT only, except op claim (the partner's own browser).
//
// The link carries a CLAIM CODE, not an auth token: /partner/welcome trades the code for a fresh
// one-time token at the moment he clicks (op claim), then for a session, then he sets a password.
// It used to carry the token itself, and generating a second link quietly invalidated the first —
// so a link made a minute earlier came back "expired".

import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = "https://bestly.tech";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const sha256 = async (v: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const code40 = () => {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return [...a].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* empty */ }

  // The partner's own browser: swap the claim code in his link for a fresh sign-in token.
  if (body.op === "claim") {
    const code = String(body.code ?? "").trim();
    if (code.length < 16) return J({ ok: false, error: "bad_code" }, 400);
    const hash = await sha256(code);
    const { data: row } = await db.from("partners").select("id, email, name, claim_expires_at").eq("claim_hash", hash).maybeSingle();
    if (!row) return J({ ok: false, error: "unknown_link" }, 404);
    if (row.claim_expires_at && Date.parse(row.claim_expires_at) < Date.now()) return J({ ok: false, error: "expired" }, 410);
    const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email: row.email });
    const token = link?.properties?.hashed_token || "";
    if (error || !token) return J({ ok: false, error: error?.message ?? "no token" }, 500);
    await db.from("partners").update({ claim_used_at: new Date().toISOString() }).eq("id", row.id);
    return J({ ok: true, token, email: row.email, name: row.name });
  }

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return J({ ok: false, error: "unauthorized" }, 401);
  const { data: isAdmin } = await db.rpc("has_role", { _user_id: who.user.id, _role: "admin" });
  if (!isAdmin) return J({ ok: false, error: "admin only" }, 403);

  if (body.op === "list") {
    const { data: rows } = await db.from("partners").select("*").order("created_at");
    const out = [];
    for (const p of rows ?? []) {
      let user = null;
      if (p.user_id) {
        const { data } = await db.auth.admin.getUserById(p.user_id);
        const u = data?.user as any;
        if (u) user = { last_sign_in_at: u.last_sign_in_at, disabled: !!u.banned_until && Date.parse(u.banned_until) > Date.now(), has_password: !!u.user_metadata?.password_set };
      }
      const { count } = await db.from("meeting_recordings").select("id", { count: "exact", head: true }).contains("people", [p.roster_name]);
      out.push({ ...p, user, meetings: count ?? 0 });
    }
    return J({ ok: true, partners: out });
  }

  const { data: p } = await db.from("partners").select("*").eq("id", String(body.partner_id ?? "")).maybeSingle();
  if (!p) return J({ ok: false, error: "no such partner" }, 404);

  if (body.op === "link") {
    let userId = p.user_id as string | null;
    if (!userId) {
      // Reuse an existing login with that email, else create one. No email goes out.
      const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users?.find((u) => (u.email ?? "").toLowerCase() === p.email.toLowerCase());
      if (existing) userId = existing.id;
      else {
        const { data: made, error } = await db.auth.admin.createUser({
          email: p.email, email_confirm: true, user_metadata: { name: p.name, partner: true },
        });
        if (error || !made?.user) return J({ ok: false, error: error?.message ?? "could not create the login" });
        userId = made.user.id;
      }
      await db.from("partners").update({ user_id: userId }).eq("id", p.id);
      await db.from("user_roles").upsert({ user_id: userId, role: "partner" }, { onConflict: "user_id,role", ignoreDuplicates: true });
    }
    // A claim code, good for 7 days and usable more than once (people tap a text twice). The
    // real sign-in token is minted when he opens it, so a newer link never breaks an older one.
    const code = code40();
    const { error: saveErr } = await db.from("partners").update({
      claim_hash: await sha256(code),
      claim_expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      claim_used_at: null,
      link_sent_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (saveErr) return J({ ok: false, error: saveErr.message });
    return J({ ok: true, url: `${SITE}/partner/welcome?c=${code}`, expires_in_minutes: 7 * 24 * 60 });
  }

  if (body.op === "disable" || body.op === "enable") {
    if (!p.user_id) return J({ ok: false, error: "no login yet" });
    const { error } = await db.auth.admin.updateUserById(p.user_id, { ban_duration: body.op === "disable" ? "876000h" : "none" } as any);
    return J(error ? { ok: false, error: error.message } : { ok: true });
  }

  return J({ ok: false, error: "unknown op" }, 400);
});
