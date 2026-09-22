// partner-admin — Jared manages partner logins (Eli) from /admin/partners.
//
//   op list                 partners, whether they have a login, last sign-in
//   op link    {partner_id} creates the login the first time (no email is sent),
//                           then returns a one-time sign-in link for Jared to text them
//   op disable {partner_id} turns their access off (the login is kept, but blocked)
//   op enable  {partner_id}
//
// Admin JWT only. The link carries a single-use token_hash that the /partner/welcome
// page trades for a session (supabase.auth.verifyOtp), then the partner sets a password.

import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = "https://bestly.tech";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return J({ ok: false, error: "unauthorized" }, 401);
  const { data: isAdmin } = await db.rpc("has_role", { _user_id: who.user.id, _role: "admin" });
  if (!isAdmin) return J({ ok: false, error: "admin only" }, 403);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* empty */ }

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
    const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email: p.email });
    if (error) return J({ ok: false, error: error.message });
    const action = link?.properties?.action_link ?? "";
    const token = link?.properties?.hashed_token || (action ? new URL(action).searchParams.get("token") : "") || "";
    if (!token) return J({ ok: false, error: "no token came back" });
    await db.from("partners").update({ link_sent_at: new Date().toISOString() }).eq("id", p.id);
    const url = `${SITE}/partner/welcome#t=${encodeURIComponent(token)}&e=${encodeURIComponent(p.email)}`;
    return J({ ok: true, url, expires_in_minutes: 60 });
  }

  if (body.op === "disable" || body.op === "enable") {
    if (!p.user_id) return J({ ok: false, error: "no login yet" });
    const { error } = await db.auth.admin.updateUserById(p.user_id, { ban_duration: body.op === "disable" ? "876000h" : "none" } as any);
    return J(error ? { ok: false, error: error.message } : { ok: true });
  }

  return J({ ok: false, error: "unknown op" }, 400);
});
