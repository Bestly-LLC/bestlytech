// bestly-meta-probe — connect a brand's Instagram through the Facebook Graph API.
//
// Background: the Instagram-Login OAuth flow failed three times. Instagram forces
// re-authentication and the redirect never completes. It turns out that flow was never
// necessary — the vault already holds a never-expiring Meta USER token that administers
// the HOKU Page, and an Instagram Business account is reachable through its Page.
//
// Actions:
//   probe  (default) — list Pages and their linked Instagram accounts. Read-only.
//   link              — mint a PAGE access token for one brand and store it in
//                       social_accounts, exactly where the OAuth flow would have put it.
//
// A token is never returned to the caller in either action.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (edge_proxy_key_sha256, plus edge_proxy_key_prev_sha256 while callers move
// over); edge_key_ok() (service-role only) checks them.
async function keyOk(k: string | null | undefined): Promise<boolean> {
  if (!k) return false;
  for (const n of ["edge_proxy_key_sha256", "edge_proxy_key_prev_sha256"]) {
    const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}
const GRAPH = "https://graph.facebook.com/v21.0";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Belt and braces: no token may leave this function, not even inside an error string.
function scrub(value: unknown, secrets: string[]): unknown {
  let s = JSON.stringify(value);
  for (const sec of secrets) {
    if (sec && sec.length > 8) s = s.split(sec).join("[REDACTED]");
  }
  return JSON.parse(s);
}

Deno.serve(async (req) => {
  const secrets: string[] = [];
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(scrub(o, secrets), null, 2), {
      status: s,
      headers: { "Content-Type": "application/json" },
    });

  const k = req.headers.get("x-proxy-key");
  if (!k || !(await keyOk(k))) return J({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* probe takes no body */ }
  const action = String(body.action ?? "probe");

  let token = "";
  try {
    const { data, error } = await db.rpc("get_meta_master_token");
    if (error) return J({ step: "vault", error: error.message }, 500);
    token = typeof data === "string" ? data : String(data ?? "");
    if (!token) return J({ step: "vault", error: "token empty" }, 500);
    secrets.push(token);
  } catch (e) {
    return J({ step: "vault", error: String(e) }, 500);
  }

  // Every Page this user administers, with the Instagram account behind it and the
  // Page token needed to publish to it.
  const res = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}` +
    `&limit=50&access_token=${encodeURIComponent(token)}`,
  );
  const pages = await res.json();
  if (!Array.isArray(pages?.data)) return J({ step: "pages", raw: pages }, 500);

  for (const p of pages.data) {
    if (typeof p.access_token === "string") secrets.push(p.access_token);
  }

  if (action === "probe") {
    return J({
      pages: pages.data.map((p: Record<string, any>) => ({
        pageId: p.id,
        pageName: p.name,
        hasPageToken: !!p.access_token,
        instagram: p.instagram_business_account ?? null,
      })),
    });
  }

  if (action === "link") {
    const brand = String(body.brand ?? "");
    if (!brand) return J({ error: "brand required" }, 400);

    const { data: acct, error: aErr } = await db.from("social_accounts")
      .select("brand, platform, handle, page_id")
      .eq("brand", brand).eq("platform", "instagram").maybeSingle();
    if (aErr) return J({ error: aErr.message }, 500);
    if (!acct) return J({ error: `no instagram row for brand ${brand}` }, 404);
    if (!acct.page_id) return J({ error: `brand ${brand} has no page_id set` }, 400);

    const page = pages.data.find((p: Record<string, any>) => String(p.id) === String(acct.page_id));
    if (!page) return J({ error: `page ${acct.page_id} not administered by this token` }, 404);

    const ig = page.instagram_business_account;
    if (!ig?.id) return J({ error: `page ${page.name} has no linked Instagram account` }, 400);
    if (!page.access_token) return J({ error: `no page token returned for ${page.name}` }, 500);

    // A Page token derived from a never-expiring user token does not expire either,
    // so token_expires_at stays null — same shape as the working cookieyeti row.
    const { error: uErr } = await db.from("social_accounts").update({
      access_token: page.access_token,
      remote_user_id: String(ig.id),
      active: true,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("brand", brand).eq("platform", "instagram");
    if (uErr) return J({ error: uErr.message }, 500);

    await db.from("social_autoconnect_log").insert({
      brand,
      outcome: "linked_via_master_token",
      detail: {
        pageId: page.id,
        pageName: page.name,
        igId: ig.id,
        igUsername: ig.username,
        note: "Connected through the Facebook Graph API using the vault master token, " +
              "bypassing the Instagram Login OAuth flow that kept failing.",
      },
    });

    return J({
      ok: true,
      brand,
      pageName: page.name,
      instagram: { id: ig.id, username: ig.username, name: ig.name },
    });
  }

  return J({ error: "unknown action" }, 400);
});
