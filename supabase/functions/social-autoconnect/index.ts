// social-autoconnect - watches for a brand whose Facebook Page has just had an
// Instagram business account linked, then wires it up with no human in the loop.
//
// Why this exists: linking Instagram to a Facebook Page requires an Instagram
// password, which only the owner can supply. Everything AFTER that click is
// mechanical, so this runs it: mint the Page token, store it, rehearse the next
// queued post, and only then go live.
//
// The brand is stored INACTIVE first and is promoted to active only after the
// rehearsal passes. claim_next_social_post joins on active, so an unrehearsed
// brand physically cannot have a post claimed off the queue.
//
// Rehearsal is delegated to bestly-ig-poster's dryrun action rather than
// reimplemented here, so it exercises the exact code path the live post takes.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = (k: string): Record<string, string> => k.startsWith("sb_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };

const GRAPH_FB = "https://graph.facebook.com/v23.0";
const PLATFORM = "instagram";

// HOKU is deliberately absent. Its queue stays parked until someone connects it
// on purpose; this job must never switch it on as a side effect.
const AUTO = new Set(["cookieyeti", "inventoryproof"]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PROXY_KEY = Deno.env.get("SOCIAL_PROXY_KEY") ||
  "HZW143PPv0ezYqQ2Ww9tQGar_ywER6dHPXG6yvalpv84jRBR";

const db = createClient(SUPABASE_URL, SB_SECRET, { auth: { persistSession: false } });

// The anon key is public, so verify_jwt alone is not authorization - it only
// proves the caller found a key anyone can read. Real callers are pg_cron
// (service_role JWT) or the Vercel proxy (x-proxy-key). Reject everything else
// so this cannot be hammered by a stranger holding the published anon key.
function b64urlJson(seg: string): Record<string, unknown> | null {
  try {
    const s = seg.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(s + "=".repeat((4 - (s.length % 4)) % 4)));
  } catch { return null; }
}
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function callerAuthorized(req: Request): boolean {
  const k = req.headers.get("x-proxy-key");
  if (k && sameSecret(k, PROXY_KEY)) return true;
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const parts = jwt.split(".");
  if (parts.length === 3) {
    const payload = b64urlJson(parts[1]);
    if (payload && payload.role === "service_role") return true;
  }
  return false;
}

async function fbGet(path: string, params: Record<string, string>) {
  const url = new URL(GRAPH_FB + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString());
  return { status: r.status, json: await r.json() };
}

async function rehearse(brand: string, post: Record<string, unknown>) {
  const urls = (post.media_type === "carousel" && Array.isArray(post.media_urls))
    ? post.media_urls as string[] : null;
  const body: Record<string, unknown> = {
    action: "dryrun",
    brand,
    caption: post.caption ?? "",
    mediaType: post.media_type,
  };
  if (urls) body.mediaUrls = urls; else body.mediaUrl = post.media_url;

  const r = await fetch(`${SUPABASE_URL}/functions/v1/bestly-ig-poster`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...sbHeaders(SB_SECRET),
      "x-proxy-key": PROXY_KEY,
    },
    body: JSON.stringify(body),
  });
  return await r.json();
}

Deno.serve(async (req) => {
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  if (!callerAuthorized(req)) return J({ error: "unauthorized" }, 401);

  const master = await db.rpc("get_meta_master_token");
  const masterTok = master.data ? String(master.data) : "";
  if (!masterTok) return J({ error: "master meta token unavailable" }, 500);

  const { data: rows } = await db.from("social_accounts")
    .select("*").eq("platform", PLATFORM).is("access_token", null);

  const log = (brand: string, outcome: string, detail: unknown) =>
    db.from("social_autoconnect_log").insert({ brand, outcome, detail });

  const out: unknown[] = [];

  for (const a of (rows ?? [])) {
    const brand = a.brand as string;
    if (!AUTO.has(brand)) {
      out.push({ brand, outcome: "skipped", reason: "not in autoconnect allowlist" });
      continue;
    }
    const pageId = a.page_id as string | null;
    if (!pageId) {
      out.push({ brand, outcome: "skipped", reason: "no page_id" });
      continue;
    }

    try {
      // 1. Has an Instagram business account been linked to the Page yet?
      const look = await fbGet(`/${pageId}`, {
        fields: "name,instagram_business_account{id,username}",
        access_token: masterTok,
      });
      const iga = look.json?.instagram_business_account;
      if (!iga?.id) {
        out.push({ brand, outcome: "waiting", reason: "page has no linked instagram business account" });
        continue;
      }

      // 2. Mint the Page token. Derived from a non-expiring user token, a Page
      //    token does not expire either, so no refresh is ever scheduled for it.
      const pt = await fbGet(`/${pageId}`, { fields: "access_token", access_token: masterTok });
      const pageTok = pt.json?.access_token;
      if (!pageTok) {
        await log(brand, "error", { stage: "page-token", detail: pt.json });
        out.push({ brand, outcome: "error", stage: "page-token" });
        continue;
      }

      // 3. Prove that token actually reads this Instagram account.
      const check = await fbGet(`/${iga.id}`, {
        fields: "id,username", access_token: String(pageTok),
      });
      if (!check.json?.id) {
        await log(brand, "error", { stage: "verify", detail: check.json });
        out.push({ brand, outcome: "error", stage: "verify" });
        continue;
      }

      // 4. Store the credential INACTIVE. Nothing can be claimed off the queue yet.
      const upd = await db.from("social_accounts").update({
        access_token: String(pageTok),
        remote_user_id: String(iga.id),
        handle: "@" + (check.json.username ?? iga.username ?? ""),
        token_expires_at: null,
        last_refreshed_at: new Date().toISOString(),
        active: false,
        updated_at: new Date().toISOString(),
      }).eq("brand", brand).eq("platform", PLATFORM);
      if (upd.error) {
        await log(brand, "error", { stage: "store", detail: upd.error.message });
        out.push({ brand, outcome: "error", stage: "store" });
        continue;
      }

      // 5. Rehearse the next queued post end to end, stopping before publish.
      const { data: next } = await db.from("social_posts")
        .select("*").eq("brand", brand).eq("platform", PLATFORM)
        .eq("status", "queued").order("scheduled_at", { ascending: true })
        .limit(1).maybeSingle();

      let rehearsal: unknown = { skipped: "no queued post" };
      if (next) {
        rehearsal = await rehearse(brand, next as Record<string, unknown>);
        if (!(rehearsal as { ok?: boolean }).ok) {
          await log(brand, "rehearsal_failed", { postId: next.id, rehearsal });
          out.push({ brand, outcome: "rehearsal_failed", rehearsal });
          continue;   // stays inactive; nothing posts
        }
      }

      // 6. Rehearsal passed (or there was nothing to rehearse). Go live.
      await db.from("social_accounts").update({ active: true })
        .eq("brand", brand).eq("platform", PLATFORM);

      await log(brand, "connected", {
        igUserId: String(iga.id),
        handle: check.json.username ?? null,
        rehearsal,
      });
      out.push({
        brand, outcome: "connected",
        handle: check.json.username ?? null, active: true,
      });
    } catch (e) {
      await log(brand, "error", { error: String(e) });
      out.push({ brand, outcome: "error", error: String(e) });
    }
  }

  return J({ checkedAt: new Date().toISOString(), results: out });
});
