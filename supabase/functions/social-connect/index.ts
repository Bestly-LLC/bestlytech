// social-connect — one-click Instagram connection.
//
// SCOPE: Cookie Yeti and InventoryProof ONLY. HOKU is deliberately excluded --
// its 30 posts were scheduled for early September and are overdue, so
// connecting it would dump a backlog. The brand guard runs BEFORE the config
// check so the refusal is verifiable even before secrets are set.
//
// SETUP (once): set META_APP_ID and META_APP_SECRET in Edge Function secrets,
// and add the /callback URL to the Meta app's Valid OAuth Redirect URIs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const GRAPH = "https://graph.facebook.com/v21.0";
const APP_ID = Deno.env.get("META_APP_ID") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = SB_SECRET;

const ALLOWED = new Set(["cookieyeti", "inventoryproof"]);
const LABEL: Record<string, string> = {
  cookieyeti: "Cookie Yeti",
  inventoryproof: "InventoryProof",
};

const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
].join(",");

const db = () => createClient(SUPABASE_URL, SERVICE_KEY);

function page(title: string, body: string, ok = true) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name=viewport content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
max-width:640px;margin:10vh auto;padding:0 24px;color:#14202E;background:#F7F8FA}
h1{font-size:26px;margin:0 0 12px;color:${ok ? "#1C6B4A" : "#A4262C"}}
code{background:#EDF0F4;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
.box{background:#fff;border:1px solid #E1E6EC;border-radius:10px;padding:20px 24px;margin-top:18px}
a{color:#12507E;font-weight:600}</style>
<h1>${title}</h1>${body}`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function j(url: string) {
  const r = await fetch(url);
  const body = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(body?.error ?? body));
  return body;
}

const refusal = () => page("Not available here", `<div class=box>
<p>This endpoint connects <b>Cookie Yeti</b> and <b>InventoryProof</b> only.</p>
<p>HOKU is intentionally excluded — it has a backlog of overdue posts that would
all fire at once on connection.</p></div>`, false);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.split("/").pop();
  const redirectUri = `${url.origin}/social-connect/callback`;
  const brand = (url.searchParams.get("brand") ?? url.searchParams.get("state") ?? "").toLowerCase();

  // Brand guard first, so a refusal never depends on configuration state.
  if ((route === "start" || route === "callback") && !ALLOWED.has(brand)) return refusal();

  if (route === "status") {
    const { data, error } = await db().from("v_social_health").select("*");
    return new Response(JSON.stringify(error ?? data, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  if (!APP_ID || !APP_SECRET) {
    return page("Two values needed", `<div class=box>
<p>Everything else is built and loaded. This needs the Meta app credentials:</p>
<p><code>META_APP_ID</code><br><code>META_APP_SECRET</code></p>
<p>Supabase dashboard → <b>Edge Functions → Secrets</b>. Then reload this page.</p>
<p style="margin-top:16px">Also add this exact URL to the Meta app under
<b>Facebook Login → Settings → Valid OAuth Redirect URIs</b>:</p>
<p><code>${redirectUri}</code></p></div>`, false);
  }

  if (route === "start") {
    const auth = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    auth.searchParams.set("client_id", APP_ID);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("scope", SCOPES);
    auth.searchParams.set("state", brand);
    auth.searchParams.set("response_type", "code");
    return Response.redirect(auth.toString(), 302);
  }

  if (route === "callback") {
    const code = url.searchParams.get("code");
    const denied = url.searchParams.get("error_description");
    if (denied) return page("Meta declined", `<div class=box>${denied}</div>`, false);
    if (!code) return page("No code returned", "<div class=box>Meta sent no authorization code.</div>", false);

    try {
      const short = await j(`${GRAPH}/oauth/access_token?client_id=${APP_ID}` +
        `&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`);

      const long = await j(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
        `&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${short.access_token}`);

      const accounts = await j(`${GRAPH}/me/accounts` +
        `?fields=name,access_token,instagram_business_account{id,username}` +
        `&access_token=${long.access_token}`);

      const withIg = (accounts.data ?? []).filter((p: any) => p.instagram_business_account?.id);
      if (!withIg.length) {
        return page("No Instagram account linked", `<div class=box>
<p>That login has Facebook Pages, but none with a linked Instagram
<b>Business or Creator</b> account.</p>
<p>Link the IG account to a Page in the Instagram app, then try again.</p></div>`, false);
      }

      const { data: row } = await db().from("social_accounts")
        .select("handle").eq("brand", brand).eq("platform", "instagram").maybeSingle();
      const wanted = (row?.handle ?? "").replace(/^@/, "").toLowerCase();
      const exact = withIg.find((p: any) =>
        p.instagram_business_account.username?.toLowerCase() === wanted);

      // Only auto-pick when unambiguous. Never guess which account a brand posts from.
      if (!exact && withIg.length > 1) {
        const list = withIg.map((p: any) =>
          `<li>@${p.instagram_business_account.username ?? p.instagram_business_account.id} (Page: ${p.name})</li>`).join("");
        return page("Which account?", `<div class=box>
<p>The database expects <b>@${wanted}</b> for ${LABEL[brand]}, but that handle
wasn't in this login. These were:</p><ul>${list}</ul>
<p><b>Nothing was saved.</b> Update <code>social_accounts.handle</code> for
<code>${brand}</code> to one of the above, then reconnect.</p></div>`, false);
      }

      const match = exact ?? withIg[0];
      const ig = match.instagram_business_account;

      const { error } = await db().from("social_accounts").update({
        access_token: match.access_token,
        remote_user_id: ig.id,
        app_id: APP_ID,
        app_secret: APP_SECRET,
        token_expires_at: new Date(Date.now() + 60 * 864e5).toISOString(),
        last_refreshed_at: new Date().toISOString(),
        active: true,
        updated_at: new Date().toISOString(),
      }).eq("brand", brand).eq("platform", "instagram");
      if (error) throw new Error(error.message);

      const other = brand === "cookieyeti" ? "inventoryproof" : "cookieyeti";
      return page(`${LABEL[brand]} connected`, `<div class=box>
<p>Posting as <b>@${ig.username ?? ig.id}</b> via the Page “${match.name}”.</p>
<p>The drain job runs every 5 minutes, so the next due post goes out shortly.</p>
<p style="margin-top:16px"><a href="${url.origin}/social-connect/start?brand=${other}">Now connect ${LABEL[other]} →</a></p>
<p style="margin-top:14px"><a href="${url.origin}/social-connect/status">Check status</a></p></div>`);
    } catch (e) {
      return page("Connection failed", `<div class=box><p>Meta returned:</p>
<p><code>${String(e).slice(0, 600)}</code></p></div>`, false);
    }
  }

  return page("Connect Instagram", `<div class=box>
<p><a href="${url.origin}/social-connect/start?brand=cookieyeti">Connect Cookie Yeti →</a><br>
<span style="color:#7C8899;font-size:14px">@cookie_yeti_privacy · 10 posts queued</span></p>
<p style="margin-top:14px"><a href="${url.origin}/social-connect/start?brand=inventoryproof">Connect InventoryProof →</a><br>
<span style="color:#7C8899;font-size:14px">@inventory_proof · 10 posts queued</span></p>
<p style="margin-top:20px;color:#7C8899;font-size:14px">HOKU is excluded on purpose — overdue backlog.</p>
<p style="margin-top:10px"><a href="${url.origin}/social-connect/status">Status</a></p></div>`);
});
