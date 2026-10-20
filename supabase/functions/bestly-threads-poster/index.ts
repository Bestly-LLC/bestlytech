// bestly-threads-poster — the Threads leg of the Studio posting queue (2026-10-19).
// Sibling of bestly-fb-poster / bestly-ig-poster / tiktok-inbox; same queue, same shape.
//
// A queued social_posts row (platform 'threads') is published to the brand's Threads profile:
//   video     -> VIDEO container (video_url + text)
//   image     -> IMAGE container
//   carousel  -> CAROUSEL (each slide an IMAGE child, then the parent)
// then poll the container until FINISHED, then threads_publish. A container that is still processing when this
// run ends is kept in social_posts.publish_id and picked up again by the next drain (no second upload).
// Credentials: social_accounts (platform 'threads'): access_token = long-lived Threads token (60 days, refreshed here
// before it expires), remote_user_id = Threads user id. App creds live in Vault (studio_threads_app_get).
// Tokens are never returned or logged.
//
// Caps and the master rule are enforced INSIDE claim_next_threads_post() (SQL): only Jared-approved items
// (house_post_cleared), the brand's per-day cap, posting window, freshest-first order and expiry, from social_platform_caps.
//
// AI label: Threads' API documents no AI-content flag (checked 2026-10-19), so when the clip has an AI voice the
// text's LAST LINE says "AI voice" (text.ts).
//
// Actions (POST, service role or x-proxy-key):
//   { action:'drain' }     publish one due row (pg_cron, every 5 min)
//   { action:'check' }     prove every active token still works; dead -> inactive + alert to the brand's owner (every 6 h)
//   { action:'refresh' }   roll every token with under 20 days left (daily)
//   { action:'me', brand } sanity check one account
//   { action:'compose', caption, aiLabel? }   the exact text that would be posted (no network)
//   { action:'dryrun', brand, mediaType, mediaUrl|mediaUrls[], caption, aiLabel? }   build + process the container, never publish

import { createClient } from "jsr:@supabase/supabase-js@2";
import { threadsText } from "./text.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const G = "https://graph.threads.net/v1.0";
const PLATFORM = "threads";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-proxy-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };

type Account = { id: string; brand: string; handle: string | null; remote_user_id: string | null; access_token: string | null; active: boolean; client_id: string | null; token_expires_at: string | null; last_refreshed_at: string | null };

function b64urlJson(seg: string): Record<string, unknown> | null {
  try { const s = seg.replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(s + "=".repeat((4 - (s.length % 4)) % 4))); } catch { return null; }
}
async function callerAuthorized(req: Request): Promise<boolean> {
  const k = req.headers.get("x-proxy-key");
  if (k) for (const n of ["edge_proxy_key_sha256", "edge_proxy_key_prev_sha256"]) {
    const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: k }); if (data === true) return true;
  }
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const parts = jwt.split(".");
  if (parts.length === 3) { const p = b64urlJson(parts[1]); if (p && p.role === "service_role") return true; }
  return false;
}
const scrub = (s: string) => s.replace(/THAA[A-Za-z0-9_-]{20,}/g, "THAA…").replace(/access_token=[^&\s"]+/g, "access_token=…").replace(/client_secret=[^&\s"]+/g, "client_secret=…");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tx(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET") {
  const u = new URL(path.startsWith("http") ? path : G + path);
  let r: Response;
  if (method === "GET") { for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v); r = await fetch(u.toString()); }
  else r = await fetch(u.toString(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

async function account(brand: string): Promise<Account> {
  const { data, error } = await db.from("social_accounts").select("*").eq("brand", brand).eq("platform", PLATFORM).maybeSingle();
  if (error) throw new Error("db: " + error.message);
  if (!data) throw new Error(`brand '${brand}' has no threads account`);
  if (!data.access_token || !data.remote_user_id) throw new Error(`brand '${brand}' threads is not connected`);
  return data as Account;
}

// ---- alerts: signed by the owner of the brand (mnd -> Anchor; everything else -> Studio Watch) ----------------------
const alertKey = (brand: string) => (brand === "minutenewsdaily" ? "mnd.threads" : "studio:threads");
async function raise(brand: string, kind: "problem" | "resolved", title: string, body: string | null) {
  try { await db.rpc("bestly_raise", { p_key: alertKey(brand), p_kind: kind, p_severity: kind === "resolved" ? "info" : "warn", p_title: title, p_body: body, p_area: "ops" }); } catch { /* alerts are best effort */ }
}
// a live reconnect link for the brand's client (reuse an unused one; mint only when none is open)
async function reconnectLink(a: Account): Promise<string | null> {
  if (!a.client_id) return null;
  const { data: open } = await db.from("social_connect_links").select("short_code, created_by").eq("client_id", a.client_id).is("used_at", null)
    .gt("expires_at", new Date(Date.now() + 2 * 86400000).toISOString()).not("short_code", "is", null).like("created_by", "% · threads").order("created_at", { ascending: false }).limit(1);
  if (open?.[0]?.short_code) return "https://www.bestly.tech/c/" + open[0].short_code;
  const { data } = await db.rpc("social_connect_mint", { p_client: a.client_id, p_by: "Threads watchdog", p_platform: PLATFORM });
  return typeof data === "string" ? data : null;
}

// ---- publishing ---------------------------------------------------------------------------------------------------
type Row = { id?: string; brand: string; media_type: string; media_url: string; media_urls: string[] | null; caption: string | null; publish_id?: string | null; approval_item_id?: string | null };

async function waitFinished(tok: string, id: string, tries = 25, gap = 4000) {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    const s = await tx(`/${id}`, { fields: "status,error_message", access_token: tok });
    last = s.json;
    const st = s.json?.status;
    if (st === "FINISHED" || st === "PUBLISHED") return { ok: true as const };
    if (st === "ERROR" || st === "EXPIRED") return { ok: false as const, stage: "processing", detail: s.json };
    if (s.json?.error) return { ok: false as const, stage: "status", detail: s.json.error };
    await sleep(gap);
  }
  return { ok: false as const, stage: "processing-timeout", detail: last, waiting: true };
}

async function createContainer(a: Account, row: Row, text: string, topic: string | null) {
  const uid = a.remote_user_id!, tok = a.access_token!;
  const withTopic = (p: Record<string, string>) => { if (topic) p.topic_tag = topic; return p; };
  const mt = row.media_type;
  if (mt === "carousel" && Array.isArray(row.media_urls) && row.media_urls.length > 1) {
    const kids: string[] = [];
    for (let i = 0; i < row.media_urls.length; i++) {
      const c = await tx(`/${uid}/threads`, { media_type: "IMAGE", image_url: row.media_urls[i], is_carousel_item: "true", access_token: tok }, "POST");
      if (!c.json?.id) return { ok: false as const, stage: `carousel-slide-${i + 1}`, detail: c.json?.error ?? c.json };
      const w = await waitFinished(tok, String(c.json.id), 10, 2000);
      if (!w.ok) return { ok: false as const, stage: `carousel-slide-${i + 1}-${w.stage}`, detail: w.detail };
      kids.push(String(c.json.id));
    }
    const p = await tx(`/${uid}/threads`, withTopic({ media_type: "CAROUSEL", children: kids.join(","), text, access_token: tok }), "POST");
    if (!p.json?.id) return { ok: false as const, stage: "carousel-container", detail: p.json?.error ?? p.json };
    return { ok: true as const, id: String(p.json.id) };
  }
  const isVideo = mt === "video" || mt === "reel";
  const params: Record<string, string> = isVideo
    ? { media_type: "VIDEO", video_url: row.media_url, text, access_token: tok }
    : { media_type: "IMAGE", image_url: row.media_url, text, access_token: tok };
  const c = await tx(`/${uid}/threads`, withTopic(params), "POST");
  if (!c.json?.id) return { ok: false as const, stage: "container", detail: c.json?.error ?? c.json };
  return { ok: true as const, id: String(c.json.id) };
}

async function aiLabelFor(itemId: string | null | undefined): Promise<boolean> {
  if (!itemId) return true;                                   // unknown provenance: label it (fail safe)
  const { data } = await db.from("approval_items").select("provenance").eq("id", itemId).maybeSingle();
  const p = (data as any)?.provenance;
  if (!p || typeof p !== "object") return true;
  return p.ai_voice === true || p.ai_label_needed === true;
}

async function publishAny(a: Account, row: Row, opts: { dry?: boolean; aiLabel?: boolean } = {}) {
  const ai = opts.aiLabel ?? await aiLabelFor(row.approval_item_id);
  const { text, topic } = threadsText(row.caption ?? "", ai);
  if (!text) return { ok: false, stage: "text", detail: "empty text" };
  let cid = row.publish_id || null;
  if (!cid) {
    const c = await createContainer(a, row, text, topic);
    if (!c.ok) return c;
    cid = c.id;
    if (row.id) await db.from("social_posts").update({ publish_id: cid }).eq("id", row.id);
  }
  const w = await waitFinished(a.access_token!, cid, (row.media_type === "video" || row.media_type === "reel") ? 25 : 8, 4000);
  if (!w.ok) {
    // a container Threads reports ERROR/EXPIRED (or no longer knows) must not be reused: the next attempt builds a fresh one
    if (w.stage === "processing" || w.stage === "status") { if (row.id) await db.from("social_posts").update({ publish_id: null }).eq("id", row.id); }
    return { ...w, containerId: cid };
  }
  if (opts.dry) return { ok: true, dry: true, stage: "container-finished", containerId: cid, text, topic };
  let pub: Awaited<ReturnType<typeof tx>> | null = null;
  for (let i = 0; i < 4; i++) {
    pub = await tx(`/${a.remote_user_id}/threads_publish`, { creation_id: cid, access_token: a.access_token! }, "POST");
    if (pub.json?.id) break;
    await sleep(3000);
  }
  if (!pub?.json?.id) return { ok: false, stage: "publish", detail: pub?.json?.error ?? pub?.json, containerId: cid };
  const mid = String(pub.json.id);
  const pl = await tx(`/${mid}`, { fields: "permalink", access_token: a.access_token! });
  return { ok: true, remoteId: mid, permalink: pl.json?.permalink ?? null, text };
}

// a token Threads refuses for good (190 invalid/expired, 102 session, 10/200 permission) = reconnect needed
const deadToken = (e: any) => !!e && [190, 102, 10, 200, 459, 464].includes(Number(e.code));

async function goDead(a: Account, why: string) {
  await db.from("social_accounts").update({ active: false, updated_at: new Date().toISOString() }).eq("id", a.id);
  const link = await reconnectLink(a);
  await raise(a.brand, "problem", "Threads connection lost",
    `${a.handle ?? a.brand}: ${why}. Queued Threads posts are held until it is reconnected.` + (link ? `\nReconnect (one tap, log in as ${a.handle ?? "the account"}): ${link}` : ""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (!(await callerAuthorized(req))) return J({ error: "unauthorized" }, 401);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = body.action || "drain";
  const brand = String(body.brand ?? "").toLowerCase();
  try {
    if (action === "compose") {
      const r = threadsText(String(body.caption ?? ""), body.aiLabel !== false);
      return J({ ...r, length: [...r.text].length });
    }

    if (action === "me") {
      const a = await account(brand);
      const r = await tx("/me", { fields: "id,username,name", access_token: a.access_token! });
      return J(r.json?.error ? { error: r.json.error.message ? scrub(String(r.json.error.message)) : r.json.error, code: r.json.error.code } : r.json, r.status);
    }

    if (action === "dryrun") {
      const a = await account(brand);
      const urls: string[] | null = Array.isArray(body.mediaUrls) && body.mediaUrls.length ? body.mediaUrls.map(String) : null;
      const mt = String(body.mediaType || (urls && urls.length > 1 ? "carousel" : "video"));
      const res: any = await publishAny(a, { brand, media_type: mt, media_url: String(body.mediaUrl ?? urls?.[0] ?? ""), media_urls: urls, caption: String(body.caption ?? "") },
        { dry: true, aiLabel: body.aiLabel !== false });
      return J({ brand, published: false, ...res }, res.ok ? 200 : 502);
    }

    if (action === "check") {
      const { data } = await db.from("social_accounts").select("*").eq("platform", PLATFORM).eq("active", true);
      const out: unknown[] = []; let healthy = 0; const healthyBrands: string[] = [];
      for (const a of (data ?? []) as Account[]) {
        if (!a.access_token || !a.remote_user_id) continue;
        const r = await tx("/me", { fields: "id,username", access_token: a.access_token });
        if (r.json?.id) { out.push({ brand: a.brand, ok: true }); healthy++; healthyBrands.push(a.brand); continue; }
        const e = r.json?.error;
        if (deadToken(e)) { await goDead(a, "Threads no longer accepts the connection"); out.push({ brand: a.brand, ok: false, dead: true, code: e?.code }); }
        else out.push({ brand: a.brand, ok: false, transient: true, code: e?.code });
      }
      for (const b of healthyBrands) await raise(b, "resolved", "Threads connection healthy", null);
      return J({ results: out });
    }

    if (action === "refresh") {
      const { data } = await db.from("social_accounts").select("*").eq("platform", PLATFORM).eq("active", true);
      const out: unknown[] = [];
      for (const a of (data ?? []) as Account[]) {
        if (!a.access_token) continue;
        const left = a.token_expires_at ? (Date.parse(a.token_expires_at) - Date.now()) / 86400000 : 0;
        if (left > 20) { out.push({ brand: a.brand, skipped: true, daysLeft: Math.round(left) }); continue; }
        const ageH = a.last_refreshed_at ? (Date.now() - Date.parse(a.last_refreshed_at)) / 3600000 : 999;
        if (ageH < 24) { out.push({ brand: a.brand, skipped: true, why: "token under 24 h old" }); continue; }
        const r = await tx("https://graph.threads.net/refresh_access_token", { grant_type: "th_refresh_token", access_token: a.access_token });
        if (r.json?.access_token) {
          const exp = new Date(Date.now() + (Number(r.json.expires_in) || 5184000) * 1000).toISOString();
          await db.from("social_accounts").update({ access_token: r.json.access_token, token_expires_at: exp, last_refreshed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", a.id);
          out.push({ brand: a.brand, refreshed: true, tokenExpiresAt: exp });
        } else {
          out.push({ brand: a.brand, refreshed: false, code: r.json?.error?.code });
          if (deadToken(r.json?.error) || left < 7) await goDead(a, left < 7 ? `the login expires in ${Math.max(0, Math.round(left))} day(s) and could not be refreshed` : "Threads refused the token refresh");
        }
      }
      return J({ results: out });
    }

    if (action === "drain") {
      await db.rpc("requeue_stuck_social_posts");
      const { data: claimed, error: cErr } = await db.rpc("claim_next_threads_post");
      if (cErr) return J({ error: cErr.message }, 500);
      const row = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!row) return J({ drained: 0 });
      try {
        const a = await account(row.brand);
        const res: any = await publishAny(a, row);
        if (res.ok) {
          await db.from("social_posts").update({ status: "posted", remote_id: res.remoteId, permalink: res.permalink, posted_at: new Date().toISOString(), error: null }).eq("id", row.id);
          await raise(row.brand, "resolved", "Threads posting healthy", null);
          return J({ drained: 1, id: row.id, brand: row.brand, permalink: res.permalink });
        }
        if (deadToken(res.detail)) await goDead(a, "Threads refused the token while posting");
        const giveUp = row.attempts >= row.max_attempts || deadToken(res.detail);
        // a container still processing is not a failure to report: keep its id and try again on the next drain
        await db.from("social_posts").update({ status: giveUp ? "failed" : "queued", error: scrub(`${res.stage}: ${JSON.stringify(res.detail)}`).slice(0, 2000) }).eq("id", row.id);
        if (giveUp) await raise(row.brand, "problem", "A Threads post failed",
          `${a.handle ?? row.brand}: ${scrub(res.stage + ": " + JSON.stringify(res.detail)).slice(0, 400)}\nPost id ${row.id}. Studio shows a Retry button.`);
        return J({ drained: 0, id: row.id, retrying: !giveUp, stage: res.stage }, 502);
      } catch (e) {
        const giveUp = row.attempts >= row.max_attempts;
        await db.from("social_posts").update({ status: giveUp ? "failed" : "queued", error: scrub(String(e)).slice(0, 2000) }).eq("id", row.id);
        if (giveUp) await raise(row.brand, "problem", "A Threads post failed", scrub(String(e)).slice(0, 400) + `\nPost id ${row.id}.`);
        return J({ drained: 0, id: row.id, retrying: !giveUp, error: scrub(String(e)) }, 500);
      }
    }
    return J({ error: "unknown action" }, 400);
  } catch (e) { return J({ error: scrub(String(e)) }, 500); }
});
