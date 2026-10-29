// family-admin — Jared's side of the Family Cookbook (admin Kitchen > "Invite to the family cookbook"). Owner: Basil.
// Admin JWT (or the service key). Nothing here ever stores or shows a Bestly Cloud password.
//   overview                    -> people, paid-reader budget, last purge, photo sync state
//   save_member {role,name,last_name,email}   -> remember who the seat is for (mom | mariah)
//   create_account {role}       -> Bestly Cloud account (random password nobody sees, NO email on the account, so Bestly Cloud
//                                  sends nothing), "Family" group, per-person folder shares under Family Recipes
//   draft {role}                -> the welcome email wording (editable in the page)
//   send_welcome {role,subject,text} -> sets the account's email (so "Forgot password?" works) and sends the welcome from
//                                  jared@bestly.tech with his Bestly signature (bestly-send-mail). Only on Jared's tap.
//   cloud_welcome {role}        -> optional: Bestly Cloud's own set-password message, for people who skip the "Forgot password?" step
//   set_paid {on,cap}           -> the small paid reader switch and monthly cap (0 to 50 dollars)
//   selftest                    -> creates and deletes a throwaway email-less account to prove creation sends nothing

import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRETS: string[] = (() => {
  const out: string[] = [];
  try { for (const v of Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPA_URL, SECRETS[0] ?? "", { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FOLDERS: Record<string, string> = { mom: "Mom", jared: "Jared", mariah: "Mariah" };

async function isAdmin(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  if (SECRETS.includes(bearer)) return true;
  const { data: { user } } = await db.auth.getUser(bearer);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

// ---------- Bestly Cloud (the provisioning API and WebDAV, signed in as the house account) ----------
type Nc = { base: string; user: string; auth: string };
async function nc(): Promise<Nc> {
  const { data } = await db.rpc("get_nextcloud_credentials");
  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.base_url) throw new Error("Bestly Cloud is not connected");
  return { base: String(r.base_url).replace(/\/+$/, ""), user: String(r.username), auth: "Basic " + btoa(`${r.username}:${r.app_password}`) };
}
async function ocs(c: Nc, method: string, path: string, form?: URLSearchParams): Promise<{ code: number; msg: string; data: any; http: number }> {
  const r = await fetch(`${c.base}/ocs/v1.php${path}${path.includes("?") ? "&" : "?"}format=json`, {
    method, headers: { Authorization: c.auth, "OCS-APIRequest": "true", Accept: "application/json", ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form, signal: AbortSignal.timeout(20_000),
  });
  const j = await r.json().catch(() => null);
  return { code: Number(j?.ocs?.meta?.statuscode ?? 0), msg: String(j?.ocs?.meta?.message ?? ""), data: j?.ocs?.data, http: r.status };
}
const seg = (s: string) => s.split("/").map(encodeURIComponent).join("/");
async function mkcols(c: Nc, path: string) {
  let cur = "";
  for (const part of path.split("/").filter(Boolean)) {
    cur += "/" + part;
    const r = await fetch(`${c.base}/remote.php/dav/files/${encodeURIComponent(c.user)}${seg(cur)}`, { method: "MKCOL", headers: { Authorization: c.auth }, signal: AbortSignal.timeout(15_000) });
    if (![201, 405, 301].includes(r.status)) throw new Error(`could not make the folder ${cur} (${r.status})`);
  }
}
const randomPassword = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "x").replace(/\//g, "y").replace(/=+$/, "") + "Aa1!";
};
async function ensureGroup(c: Nc, name: string): Promise<string> {
  const g = await ocs(c, "GET", `/cloud/groups?search=${encodeURIComponent(name)}`);
  if ((g.data?.groups ?? []).includes(name)) return "group already there";
  const m = await ocs(c, "POST", "/cloud/groups", new URLSearchParams({ groupid: name }));
  if (m.code !== 100) throw new Error(`could not make the ${name} group: ${m.msg || m.code}`);
  return "group made";
}
const canSee = (viewer: string, owner: string) => owner === "mom" ? true : viewer === "mom" ? false : (viewer === "jared" || viewer === "mariah") && (owner === "jared" || owner === "mariah");

/** Folders under Family Recipes, shared read-only so each person sees exactly the recipe folders the app lets them see. */
async function ensureShares(c: Nc): Promise<string[]> {
  const out: string[] = [];
  const { data: members } = await db.from("family_members").select("role, nc_uid").not("nc_uid", "is", null);
  for (const owner of Object.keys(FOLDERS)) {
    const path = `/Family Recipes/${FOLDERS[owner]}`;
    await mkcols(c, path);
    const ex = await ocs(c, "GET", `/apps/files_sharing/api/v1/shares?path=${encodeURIComponent(path)}`);
    const have = new Set<string>((Array.isArray(ex.data) ? ex.data : []).filter((s: any) => s.share_type === 0).map((s: any) => String(s.share_with).toLowerCase()));
    for (const m of members ?? []) {
      if (m.role === "jared" || !canSee(m.role, owner)) continue;
      const uid = String(m.nc_uid);
      if (have.has(uid.toLowerCase())) { out.push(`${FOLDERS[owner]} already shared with ${uid}`); continue; }
      const s = await ocs(c, "POST", "/apps/files_sharing/api/v1/shares", new URLSearchParams({ path, shareType: "0", shareWith: uid, permissions: "1" }));
      if (s.code !== 100) throw new Error(`could not share ${FOLDERS[owner]} with ${uid}: ${s.msg || s.code}`);
      out.push(`${FOLDERS[owner]} shared with ${uid}`);
    }
  }
  return out;
}

const baseUid = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 24);

async function createAccount(role: string) {
  const steps: string[] = [];
  const { data: m } = await db.from("family_members").select("*").eq("role", role).maybeSingle();
  if (!m) throw new Error("No such seat.");
  if (role === "jared") throw new Error("Jared's account already exists.");
  if (!m.name || !m.last_name) throw new Error("Add the first and last name first.");
  const c = await nc();
  steps.push(await ensureGroup(c, "Family"));
  const uid = m.nc_uid || baseUid(m.name);
  if (!uid) throw new Error("Could not make a username from that name.");
  const ex = await ocs(c, "GET", `/cloud/users/${encodeURIComponent(uid)}`);
  if (ex.code === 100) {
    if (!m.nc_uid) throw new Error(`A Bestly Cloud account named "${uid}" already exists and is not part of this seat. Pick another name.`);
    steps.push(`account ${uid} already there`);
  } else {
    // No email on the account on purpose: Bestly Cloud sends its own welcome message only when an address is given.
    const form = new URLSearchParams({ userid: uid, password: randomPassword(), displayName: `${m.name} ${m.last_name}` });
    form.append("groups[]", "Family");
    const r = await ocs(c, "POST", "/cloud/users", form);
    if (r.code !== 100) throw new Error(`Bestly Cloud would not make the account: ${r.msg || r.code}`);
    steps.push(`account ${uid} made, no email on it`);
  }
  const g = await ocs(c, "POST", `/cloud/users/${encodeURIComponent(uid)}/groups`, new URLSearchParams({ groupid: "Family" }));
  steps.push(g.code === 100 ? "added to the Family group" : "already in the Family group");
  await db.from("family_members").update({ nc_uid: uid, status: m.status === "active" ? "active" : "invited", invited_at: m.invited_at ?? new Date().toISOString() }).eq("role", role);
  steps.push(...await ensureShares(c));
  return { uid, steps };
}

// ---------- welcome wording ----------
function draft(role: string, m: { name: string; email: string | null; nc_uid: string | null }) {
  const link = "https://bestly.tech/cookbook";
  const uid = m.nc_uid || baseUid(m.name);
  if (role === "mom") {
    return {
      subject: "Your recipe cookbook is ready",
      text: `Hi Mom,

I made a cookbook for our family. Your recipe cards and everyone else's live in one place, and it works right on your phone.

Open it here: ${link}

The first time you sign in:
1. Tap "Sign in with Bestly Cloud".
2. On the next page, tap "Forgot password?" and type: ${uid}
3. A message will come to this email address with a link. Tap it and choose a password you will remember.
4. Go back to ${link} and sign in with ${uid} and your new password.

After that it remembers you. To add a card, tap the big button, then take a picture of the front and the back. If a word is hard to read it shows up in yellow, and you can tap it to pick the right one.

Call me if any of it is confusing. I would much rather walk you through it.

Love,
Jared`,
    };
  }
  return {
    subject: "The family cookbook is ready",
    text: `Hi ${m.name},

The family cookbook is ready. It keeps our recipe cards in one place and works like an app on your phone.

Open it here: ${link}

The first time you sign in:
1. Tap "Sign in with Bestly Cloud".
2. On the next page, tap "Forgot password?" and type: ${uid}
3. A message will come to this email address with a link. Tap it and choose a password.
4. Go back to ${link} and sign in with ${uid} and your new password.

You can add a card by taking a picture of the front and back. You will see Mom's recipes and mine along with yours, and anything someone marks "Someone else check this" shows up in your Needs a look list so you can fix a word and approve it.

If you want to skip passwords later, Bestly Cloud lets you add a passkey under Settings, Security.

Jared`,
  };
}

async function overview() {
  const [{ data: members }, { data: ps }, { data: purge }, { data: settings }] = await Promise.all([
    db.from("family_members").select("role, name, last_name, nc_uid, email, status, invited_at, first_sign_in_at, last_sign_in_at").order("role"),
    db.rpc("family_paid_state"),
    db.from("family_purge_log").select("at, ok, recipes, photos, captures, detail").order("at", { ascending: false }).limit(1),
    db.from("family_settings").select("paid_on, paid_cap_usd").eq("id", true).maybeSingle(),
  ]);
  const [{ count: unsynced }, { count: stuck }, { count: recipes }] = await Promise.all([
    db.from("family_photos").select("id", { count: "exact", head: true }).is("nc_synced_at", null),
    db.from("family_captures").select("id", { count: "exact", head: true }).in("status", ["reading", "closer", "failed"]),
    db.from("pantry_recipes").select("id", { count: "exact", head: true }).not("family_by", "is", null).is("deleted_at", null),
  ]);
  return { members, paid: ps, settings, lastPurge: purge?.[0] ?? null, unsynced, waiting: stuck, familyRecipes: recipes };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await isAdmin(req))) return J({ ok: false, error: "admin only" }, 401);
  const b = await req.json().catch(() => ({}));
  const role = String(b.role ?? "");
  try {
    switch (b.op) {
      case "overview": return J({ ok: true, ...(await overview()) });
      case "save_member": {
        if (!["mom", "mariah"].includes(role)) return J({ ok: false, error: "Pick Mom or Mariah." }, 400);
        const name = String(b.name ?? "").trim(), last = String(b.last_name ?? "").trim(), email = String(b.email ?? "").trim().toLowerCase();
        if (!name || name.length > 40 || !last || last.length > 40) return J({ ok: false, error: "Add a first and last name." }, 400);
        if (!EMAIL.test(email)) return J({ ok: false, error: "That email does not look right." }, 400);
        const { error } = await db.from("family_members").update({ name, last_name: last, email }).eq("role", role);
        if (error) return J({ ok: false, error: error.message }, 500);
        return J({ ok: true });
      }
      case "create_account": return J({ ok: true, ...(await createAccount(role)) });
      case "draft": {
        const { data: m } = await db.from("family_members").select("name, email, nc_uid").eq("role", role).maybeSingle();
        if (!m) return J({ ok: false, error: "No such seat." }, 404);
        return J({ ok: true, to: m.email, ...draft(role, m) });
      }
      case "send_welcome": {
        const { data: m } = await db.from("family_members").select("name, email, nc_uid, status").eq("role", role).maybeSingle();
        if (!m?.email || !m.nc_uid) return J({ ok: false, error: "Create the account first." }, 400);
        const subject = String(b.subject ?? "").trim(), text = String(b.text ?? "");
        if (!subject || text.length < 40) return J({ ok: false, error: "Write the message first." }, 400);
        const c = await nc();
        const e = await ocs(c, "PUT", `/cloud/users/${encodeURIComponent(m.nc_uid)}`, new URLSearchParams({ key: "email", value: m.email }));
        if (e.code !== 100) return J({ ok: false, error: `Could not set the email on the account: ${e.msg || e.code}` }, 502);
        const r = await fetch(`${SUPA_URL}/functions/v1/bestly-send-mail`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRETS[0]}`, apikey: SECRETS[0] },
          body: JSON.stringify({ to: m.email, subject, text }), signal: AbortSignal.timeout(30_000),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.ok === false) return J({ ok: false, error: `The mail did not go: ${String(j?.error ?? r.status)}` }, 502);
        await db.from("family_auth_log").insert({ ok: true, stage: "welcome", detail: `welcome sent to ${role}` });
        return J({ ok: true, sentTo: m.email });
      }
      case "cloud_welcome": {
        const { data: m } = await db.from("family_members").select("nc_uid, email").eq("role", role).maybeSingle();
        if (!m?.nc_uid || !m.email) return J({ ok: false, error: "Send the welcome first so the account has an email." }, 400);
        const c = await nc();
        const r = await ocs(c, "POST", `/cloud/users/${encodeURIComponent(m.nc_uid)}/welcome`);
        return r.code === 100 ? J({ ok: true }) : J({ ok: false, error: `Bestly Cloud would not send it: ${r.msg || r.code}` }, 502);
      }
      case "set_paid": {
        const cap = Number(b.cap);
        if (!Number.isFinite(cap) || cap < 0 || cap > 50) return J({ ok: false, error: "The cap is between 0 and 50 dollars." }, 400);
        const { error } = await db.from("family_settings").update({ paid_on: b.on === true, paid_cap_usd: cap, updated_at: new Date().toISOString() }).eq("id", true);
        if (error) return J({ ok: false, error: error.message }, 500);
        return J({ ok: true });
      }
      case "selftest": {
        const c = await nc(); const uid = "zz-cookbook-test"; const steps: string[] = [];
        const pre = await ocs(c, "GET", `/cloud/users/${uid}`);
        if (pre.code === 100) await ocs(c, "DELETE", `/cloud/users/${uid}`);
        steps.push(await ensureGroup(c, "Family"));
        const form = new URLSearchParams({ userid: uid, password: randomPassword(), displayName: "Cookbook test (delete me)" });
        form.append("groups[]", "Family");
        const made = await ocs(c, "POST", "/cloud/users", form);
        steps.push(`create: ${made.code} ${made.msg}`);
        const who = await ocs(c, "GET", `/cloud/users/${uid}`);
        steps.push(`email on the account: ${who.data?.email ? "yes (unexpected)" : "none"}; groups: ${JSON.stringify(who.data?.groups ?? [])}`);
        const del = await ocs(c, "DELETE", `/cloud/users/${uid}`);
        steps.push(`delete: ${del.code}`);
        return J({ ok: made.code === 100 && del.code === 100, steps });
      }
      default: return J({ ok: false, error: "unknown op" }, 400);
    }
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});
