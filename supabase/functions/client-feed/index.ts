// client-feed — keeps a client's public posts on bestly.tech current on their own.
//
// Two doors:
//   GET  ?brand=&limit=       public, no key. What /work renders.
//   POST {action:'sync'}      pg_cron (service key). Pulls Instagram, mirrors
//                             each thumbnail into Storage, upserts the rows.
//
// Why mirror the images instead of embedding Instagram: their CDN URLs are
// signed and expire within days, and embed.js is blocked for a good share of
// this audience (Cookie Yeti's own users run blockers). Our copy keeps working
// and leaks no visitor data to Meta.
//
// Token rotation is NOT handled here. bestly-ig-poster's 'refresh' cron already
// rolls every token in social_accounts nearing expiry, this one included —
// building a second roller next to it is how you get two workers fighting.
// This function only reports a token that went bad; client_feed_watch() alerts.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => {
  try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; }
};
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, {
  auth: { persistSession: false },
  global: { headers: { apikey: SB_SECRET } },
});

const GRAPH_IG = "https://graph.instagram.com/v23.0";
const BUCKET = "client-feed";
const MAX_POSTS = 12;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const J = (o: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });

function isServiceCall(req: Request): boolean {
  const keys = [SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean);
  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return keys.includes(apikey) || keys.includes(bearer);
}

/** Posts we are allowed to surface publicly, by brand. */
async function publicPosts(brand: string, limit: number) {
  const { data, error } = await db
    .from("client_feed_posts")
    .select("remote_id, permalink, caption, media_type, posted_at, image_url")
    .eq("brand", brand)
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.remote_id,
    permalink: p.permalink,
    caption: p.caption,
    type: p.media_type,
    posted_at: p.posted_at,
    image: p.image_url,
  }));
}

type IgMedia = {
  id: string;
  permalink?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp?: string;
};

/** Copy one thumbnail into our bucket. Returns the public URL, or null. */
async function mirror(brand: string, m: IgMedia): Promise<string | null> {
  const src = m.media_type === "VIDEO" ? (m.thumbnail_url ?? m.media_url) : m.media_url;
  if (!src) return null;
  const res = await fetch(src);
  if (!res.ok) return null;
  const type = res.headers.get("content-type") ?? "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const path = `${brand}/${m.id}.${ext}`;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: type,
    upsert: true,
    cacheControl: "604800",
  });
  if (error) return null;
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function syncBrand(brand: string) {
  const { data: acct, error: acctErr } = await db
    .from("social_accounts")
    .select("brand, handle, access_token, remote_user_id, active")
    .eq("brand", brand)
    .eq("platform", "instagram")
    .maybeSingle();
  if (acctErr) throw new Error(acctErr.message);
  if (!acct?.access_token) throw new Error("no token on social_accounts");
  if (acct.active === false) throw new Error("account not active");

  const qs = new URLSearchParams({
    fields: "id,permalink,caption,media_type,media_url,thumbnail_url,timestamp",
    limit: String(MAX_POSTS),
    access_token: acct.access_token,
  });
  const res = await fetch(`${GRAPH_IG}/me/media?${qs}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? `graph ${res.status}`;
    throw new Error(String(msg).slice(0, 300));
  }

  const media: IgMedia[] = Array.isArray(body?.data) ? body.data : [];
  let mirrored = 0;

  for (const m of media) {
    if (!m.id || !m.permalink) continue;
    // Only fetch the image when we do not already hold one for this post.
    const { data: existing } = await db
      .from("client_feed_posts")
      .select("image_url")
      .eq("brand", brand)
      .eq("remote_id", m.id)
      .maybeSingle();

    let imageUrl = existing?.image_url ?? null;
    if (!imageUrl) {
      imageUrl = await mirror(brand, m);
      if (imageUrl) mirrored++;
    }

    const { error } = await db.from("client_feed_posts").upsert({
      brand,
      remote_id: m.id,
      permalink: m.permalink,
      caption: m.caption ?? null,
      media_type: m.media_type ?? null,
      posted_at: m.timestamp ?? null,
      image_url: imageUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: "brand,remote_id" });
    if (error) throw new Error(error.message);
  }

  return { brand, handle: acct.handle, seen: media.length, mirrored };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const brand = url.searchParams.get("brand") ?? "";
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), MAX_POSTS);
      if (!brand) return J({ error: "brand required" }, 400);

      // Only brands explicitly published to the site are readable here.
      const { data: allowed } = await db
        .from("client_feed_brands")
        .select("brand")
        .eq("brand", brand)
        .eq("published", true)
        .maybeSingle();
      if (!allowed) return J({ error: "unknown brand" }, 404);

      const posts = await publicPosts(brand, limit);
      return J({ brand, posts }, 200, {
        // A visitor can hold this for 10 min; the edge revalidates every 5.
        "Cache-Control": "public, max-age=600, s-maxage=300, stale-while-revalidate=86400",
      });
    }

    if (req.method === "POST") {
      if (!isServiceCall(req)) return J({ error: "forbidden" }, 403);
      const payload = await req.json().catch(() => ({}));
      if (payload?.action !== "sync") return J({ error: "unknown action" }, 400);

      const { data: brands } = await db
        .from("client_feed_brands")
        .select("brand")
        .eq("published", true);

      const results: unknown[] = [];
      for (const row of brands ?? []) {
        const brand = row.brand as string;
        try {
          const out = await syncBrand(brand);
          await db.from("client_feed_brands").update({
            last_ok_at: new Date().toISOString(),
            last_error: null,
            consecutive_failures: 0,
          }).eq("brand", brand);
          results.push({ ok: true, ...out });
        } catch (e) {
          const msg = String((e as Error)?.message ?? e).slice(0, 300);
          // Count the failure so the watchdog can see a pattern, and keep the
          // last good rows in place — a bad sync must never blank the page.
          await db.rpc("client_feed_note_failure", { p_brand: brand, p_error: msg });
          results.push({ ok: false, brand, error: msg });
        }
      }
      return J({ ran: results.length, results });
    }

    return J({ error: "method not allowed" }, 405);
  } catch (e) {
    return J({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});
