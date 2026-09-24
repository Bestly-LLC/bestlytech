// bestly-fb-photo — publish to a Facebook Page, server-side.
//
// Why this exists: the Bestly posting tasks used to carry a Page access token
// in plain text inside their scheduled task prompts, because bestly-ig-poster
// covers Instagram and nothing covered the Facebook half. A prompt is stored
// forever and printed in full by list_triggers, so that token was a permanent
// copy of a publishing credential sitting in a place it had no business being.
//
// The credential now lives where every other brand's does — social_accounts —
// and the caller never sees it. A Page token minted from a long-lived user
// token does not expire, so there is nothing to refresh here.
//
// Actions (POST):
//   { action: "me",    brand }                        -> page id, name, sanity check
//   { action: "post",  brand, imageUrl, message }     -> one photo
//   { action: "album", brand, imageUrls[], message }  -> one multi-photo post
//
// Facebook has no organic carousel, so "album" is how a set of slides goes up
// as a single story: each photo is created unpublished, then one feed post
// attaches them all in order. Order matters — slide 1 is the thumbnail.
//
// Callers are server-side only, and arrive through invoke_edge_function().

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const GRAPH = "https://graph.facebook.com/v23.0";
const PLATFORM = "instagram";   // one row per brand holds both the IG id and the Page id

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-proxy-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function b64urlJson(seg: string): Record<string, unknown> | null {
  try {
    const s = seg.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(s + "=".repeat((4 - (s.length % 4)) % 4)));
  } catch { return null; }
}

// Constant-time, so a wrong key cannot be discovered a byte at a time.
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// The anon key is public, so verify_jwt on its own proves nothing about who is
// asking. Two things count as server-side:
//
//   * x-proxy-key matching vault's edge_proxy_key. This is the live path:
//     invoke_edge_function() attaches it on every call.
//   * an Authorization JWT whose role claim is service_role. Kept because the
//     project's service key is NOT always a JWT — the current one is a short
//     sb_secret-style string with no claims at all, which is exactly why the
//     first cut of this function rejected its own caller with a 401.
//
// The key is read from vault per request rather than baked in, so rotating it
// is one SQL statement and no redeploy.
async function callerAuthorized(req: Request): Promise<boolean> {
  const k = req.headers.get("x-proxy-key");
  if (k) {
    const { data } = await db.rpc("get_edge_proxy_key");
    const want = typeof data === "string" ? data : "";
    if (want && sameSecret(k, want)) return true;
  }
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const parts = jwt.split(".");
  if (parts.length === 3) {
    const payload = b64urlJson(parts[1]);
    if (payload && payload.role === "service_role") return true;
  }
  return false;
}

type Account = {
  brand: string; page_id: string | null; access_token: string | null;
  active: boolean; publishing_paused: boolean;
};

async function getAccount(brand: string): Promise<Account> {
  const { data, error } = await db.from("social_accounts")
    .select("brand,page_id,access_token,active,publishing_paused")
    .eq("brand", brand).eq("platform", PLATFORM).maybeSingle();
  if (error) throw new Error("db: " + error.message);
  if (!data) throw new Error(`brand '${brand}' is not registered`);
  if (!data.access_token) throw new Error(`brand '${brand}' has no access token`);
  if (!data.page_id) throw new Error(`brand '${brand}' has no page_id — this brand has no Facebook Page`);
  return data as Account;
}

// The token goes in the Authorization header, never the query string — a URL
// ends up in logs and proxies, and this one never expires.
async function graphPost(acct: Account, path: string, form: URLSearchParams) {
  const r = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${acct.access_token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  return { ok: r.ok, json: await r.json() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await callerAuthorized(req))) return J({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  const action = String(body.action ?? "post");
  const brand = String(body.brand ?? "").toLowerCase();
  if (!brand) return J({ ok: false, error: "brand required" }, 400);

  try {
    const acct = await getAccount(brand);

    if (action === "me") {
      const r = await fetch(`${GRAPH}/${acct.page_id}?fields=id,name,category`, {
        headers: { authorization: `Bearer ${acct.access_token}` },
      });
      const j = await r.json();
      return J({ ok: r.ok, brand, page: j }, r.ok ? 200 : 502);
    }

    // The same switch the Instagram side honours, so one flag stops a brand
    // posting anywhere rather than half of it going out.
    if (action === "post" || action === "album") {
      if (acct.publishing_paused) return J({ ok: false, error: "publishing_paused for this brand" }, 409);
      if (!acct.active) return J({ ok: false, error: "brand is not active" }, 409);
    }

    const message = String(body.message ?? "");

    if (action === "post") {
      const imageUrl = String(body.imageUrl ?? "");
      if (!/^https:\/\//.test(imageUrl)) return J({ ok: false, error: "imageUrl must be an https URL" }, 400);
      if (!message.trim()) return J({ ok: false, error: "message required" }, 400);

      const r = await graphPost(acct, `${acct.page_id}/photos`,
        new URLSearchParams({ url: imageUrl, message, published: "true" }));
      if (!r.ok || !r.json?.id) return J({ ok: false, stage: "publish", detail: r.json }, 502);
      return J({ ok: true, brand, pageId: acct.page_id,
                 postId: String(r.json.post_id ?? r.json.id), photoId: String(r.json.id) });
    }

    if (action === "album") {
      const urls = (Array.isArray(body.imageUrls) ? body.imageUrls : []).map(String);
      if (urls.length < 2) return J({ ok: false, error: "album needs at least 2 imageUrls — use action:post for one" }, 400);
      if (urls.length > 10) return J({ ok: false, error: "album takes at most 10 images" }, 400);
      if (!urls.every((u) => /^https:\/\//.test(u))) return J({ ok: false, error: "every imageUrl must be an https URL" }, 400);
      if (!message.trim()) return J({ ok: false, error: "message required" }, 400);

      // Unpublished photos first. If one fails the feed post is never made, so
      // a half-built album is left as orphaned unpublished photos rather than a
      // post that is missing slides — the slides are an argument in order, and
      // a gap in the middle changes what it says.
      const ids: string[] = [];
      for (let i = 0; i < urls.length; i++) {
        const r = await graphPost(acct, `${acct.page_id}/photos`,
          new URLSearchParams({ url: urls[i], published: "false" }));
        if (!r.ok || !r.json?.id) {
          return J({ ok: false, stage: `slide-${i + 1}`, uploaded: ids.length, detail: r.json }, 502);
        }
        ids.push(String(r.json.id));
      }

      const attached = JSON.stringify(ids.map((id) => ({ media_fbid: id })));
      const feed = await graphPost(acct, `${acct.page_id}/feed`,
        new URLSearchParams({ message, attached_media: attached }));
      if (!feed.ok || !feed.json?.id) return J({ ok: false, stage: "feed", uploaded: ids.length, detail: feed.json }, 502);
      return J({ ok: true, brand, pageId: acct.page_id, postId: String(feed.json.id), slides: ids.length });
    }

    return J({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return J({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
