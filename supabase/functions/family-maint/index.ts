// family-maint — housekeeping for the Family Cookbook. Owner: Basil. Service key only.
//   { op: "daily" }    purge Recently Deleted older than 30 days (rows, photos, the Bestly Cloud Files copies), clear abandoned
//                      cards and old sign-in leftovers, write family_purge_log, then run nc_sync
//   { op: "nc_sync" }  copy photos that never reached Bestly Cloud Files > Family Recipes (3 tries each, 20 per run)
// Called by pg_cron through family_maint_tick() once a day, and by Basil's watchdog when a run is missed.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRETS: string[] = (() => {
  const out: string[] = [];
  try { for (const v of Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRETS[0] ?? "", { auth: { persistSession: false } });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const OWNER_DIR: Record<string, string> = { mom: "Mom", jared: "Jared", mariah: "Mariah" };
const DAY = 86_400_000;

async function ncCreds() {
  const { data } = await db.rpc("get_nextcloud_credentials");
  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.base_url) throw new Error("Bestly Cloud is not connected");
  return { base: String(r.base_url).replace(/\/+$/, ""), user: String(r.username), auth: "Basic " + btoa(`${r.username}:${r.app_password}`) };
}
const seg = (s: string) => s.split("/").map(encodeURIComponent).join("/");
const dav = (c: Awaited<ReturnType<typeof ncCreds>>, path: string) => `${c.base}/remote.php/dav/files/${encodeURIComponent(c.user)}${seg(path)}`;
async function mkcols(c: Awaited<ReturnType<typeof ncCreds>>, path: string) {
  let cur = "";
  for (const part of path.split("/").filter(Boolean)) {
    cur += "/" + part;
    const r = await fetch(dav(c, cur), { method: "MKCOL", headers: { Authorization: c.auth }, signal: AbortSignal.timeout(15_000) });
    if (![201, 405, 301].includes(r.status)) throw new Error(`MKCOL ${cur} ${r.status}`);
  }
}

async function ncSync(): Promise<{ synced: number; failed: number }> {
  const { data: rows } = await db.from("family_photos").select("id, capture_id, recipe_id, side, storage_path, created_at, nc_tries")
    .is("nc_synced_at", null).lt("nc_tries", 3).order("created_at").limit(20);
  if (!rows?.length) return { synced: 0, failed: 0 };
  let c: Awaited<ReturnType<typeof ncCreds>>;
  try { c = await ncCreds(); } catch (e) {
    for (const p of rows) await db.from("family_photos").update({ nc_error: (e as Error).message.slice(0, 200), nc_tries: p.nc_tries + 1 }).eq("id", p.id);
    return { synced: 0, failed: rows.length };
  }
  let synced = 0, failed = 0;
  for (const p of rows) {
    try {
      let role = "jared";
      if (p.recipe_id) {
        const { data: r } = await db.from("pantry_recipes").select("family_by").eq("id", p.recipe_id).maybeSingle();
        role = r?.family_by ?? "jared";
      } else if (p.capture_id) {
        const { data: cap } = await db.from("family_captures").select("member_id").eq("id", p.capture_id).maybeSingle();
        const { data: m } = cap ? await db.from("family_members").select("role").eq("id", cap.member_id).maybeSingle() : { data: null };
        role = m?.role ?? "jared";
      }
      const dl = await db.storage.from("family-cards").download(p.storage_path);
      if (dl.error || !dl.data) throw new Error("photo missing from the private store");
      const dir = `/Family Recipes/${OWNER_DIR[role] ?? "Jared"}`;
      await mkcols(c, dir);
      const day = new Date(p.created_at).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      const ext = p.storage_path.split(".").pop() ?? "jpg";
      const path = `${dir}/${day} card ${String(p.capture_id ?? p.recipe_id ?? p.id).slice(0, 6)} ${p.side}.${ext}`;
      const r = await fetch(dav(c, path), { method: "PUT", headers: { Authorization: c.auth, "Content-Type": dl.data.type || "image/jpeg" }, body: new Uint8Array(await dl.data.arrayBuffer()), signal: AbortSignal.timeout(30_000) });
      if (![201, 204].includes(r.status)) throw new Error(`PUT ${r.status}`);
      await db.from("family_photos").update({ nc_path: path, nc_synced_at: new Date().toISOString(), nc_error: null }).eq("id", p.id);
      synced++;
    } catch (e) {
      failed++;
      await db.from("family_photos").update({ nc_error: (e as Error).message.slice(0, 200), nc_tries: p.nc_tries + 1 }).eq("id", p.id);
    }
  }
  return { synced, failed };
}

/** Remove photo files (private store + Bestly Cloud Files copy) for these rows. Returns how many photo rows were cleared. */
async function dropPhotos(ids: string[], c: Awaited<ReturnType<typeof ncCreds>> | null): Promise<number> {
  if (!ids.length) return 0;
  const { data: ph } = await db.from("family_photos").select("id, storage_path, nc_path").in("id", ids);
  const paths = (ph ?? []).map((p) => p.storage_path).filter(Boolean);
  if (paths.length) await db.storage.from("family-cards").remove(paths);
  if (c) for (const p of ph ?? []) if (p.nc_path) await fetch(dav(c, p.nc_path), { method: "DELETE", headers: { Authorization: c.auth }, signal: AbortSignal.timeout(15_000) }).catch(() => {});
  await db.from("family_photos").delete().in("id", ids);
  return ph?.length ?? 0;
}

async function daily() {
  const notes: string[] = [];
  let recipes = 0, photos = 0, captures = 0, ok = true;
  let c: Awaited<ReturnType<typeof ncCreds>> | null = null;
  try { c = await ncCreds(); } catch (e) { notes.push("Bestly Cloud files skipped: " + (e as Error).message); }
  try {
    // 1. Recently Deleted past 30 days
    const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
    const { data: old } = await db.from("pantry_recipes").select("id").not("deleted_at", "is", null).lt("deleted_at", cutoff).limit(200);
    for (const r of old ?? []) {
      const { data: ph } = await db.from("family_photos").select("id").eq("recipe_id", r.id);
      photos += await dropPhotos((ph ?? []).map((p) => p.id), c);
      const { error } = await db.from("pantry_recipes").delete().eq("id", r.id);
      if (error) { ok = false; notes.push(`recipe ${r.id}: ${error.message}`); } else recipes++;
    }
    // 2. Cards nobody finished (a week), and ones that were discarded (a day)
    const { data: stale } = await db.from("family_captures").select("id")
      .or(`and(status.in.(reading,closer,ready,failed),created_at.lt.${new Date(Date.now() - 7 * DAY).toISOString()}),and(status.eq.discarded,updated_at.lt.${new Date(Date.now() - DAY).toISOString()})`).limit(200);
    for (const cap of stale ?? []) {
      const { data: ph } = await db.from("family_photos").select("id").eq("capture_id", cap.id).is("recipe_id", null);
      photos += await dropPhotos((ph ?? []).map((p) => p.id), c);
      const { error } = await db.from("family_captures").delete().eq("id", cap.id);
      if (error) { ok = false; notes.push(`card ${cap.id}: ${error.message}`); } else captures++;
    }
    // 3. leftovers
    const nowIso = new Date().toISOString();
    await db.from("family_sessions").delete().lt("expires_at", nowIso);
    await db.from("family_oauth_states").delete().lt("expires_at", nowIso);
    await db.from("family_pair_codes").delete().lt("expires_at", nowIso);
    await db.from("family_auth_log").delete().lt("at", new Date(Date.now() - 60 * DAY).toISOString());
    await db.from("family_purge_log").delete().lt("at", new Date(Date.now() - 180 * DAY).toISOString());
  } catch (e) { ok = false; notes.push((e as Error).message); }
  const sync = await ncSync().catch((e) => { notes.push("sync: " + (e as Error).message); return { synced: 0, failed: 0 }; });
  if (sync.synced || sync.failed) notes.push(`sync ${sync.synced} ok, ${sync.failed} failed`);
  await db.from("family_purge_log").insert({ ok, recipes, photos, captures, detail: notes.join("; ").slice(0, 500) || null });
  return { ok, recipes, photos, captures, sync };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer || !SECRETS.includes(bearer)) return J({ ok: false, error: "service key only" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body.op === "nc_sync") return J({ ok: true, ...(await ncSync()) });
  if (body.op === "daily") {
    const p = daily();
    // @ts-ignore EdgeRuntime is provided by Supabase's runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) { EdgeRuntime.waitUntil(p); return J({ ok: true, started: true }, 202); }
    return J(await p);
  }
  return J({ ok: false, error: "unknown op" }, 400);
});
