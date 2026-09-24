// hoku-settings — read and write one tenant's brand_settings row, plus the one
// switch that decides whether social posts actually publish.
//
// Every writable column is named in ALLOWED. An admin panel is a browser page,
// and a browser page can be edited, so the set of columns a request may touch is
// decided here rather than by whatever keys happen to arrive in the body.
//
// KEY ROTATION (complete): the previous key shipped as a literal fallback in the
// hoku-clean repo and was therefore readable by anyone with repo or history
// access. It has been replaced and is no longer accepted.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (hoku_settings_key_sha256, plus hoku_settings_key_prev_sha256 while callers move
// over); edge_key_ok() (service-role only) checks them.
const __keyDb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
async function keyOk(k: string | null | undefined): Promise<boolean> {
  if (!k) return false;
  for (const n of ["hoku_settings_key_sha256", "hoku_settings_key_prev_sha256"]) {
    const { data } = await __keyDb.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-settings-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ALLOWED = new Set([
  "display_name", "tagline", "logo_url", "favicon_url",
  "color_ink", "color_paper", "color_accent", "color_deep", "color_muted",
  "font_display", "font_body", "radius_px",
  "support_email", "legal_name", "address_line1", "address_line2",
  "address_city", "address_state", "address_zip",
  "instagram_url", "tiktok_url", "facebook_url",
  "currency", "shipping_flat_cents", "free_ship_over_cents", "checkout_enabled",
  // Order emails (shop-notify) and Stripe Tax at checkout.
  "mail_from_domain", "email_logo_url", "tax_enabled",
]);

const HEX = /^#[0-9a-fA-F]{6}$/;
const COLORS = ["color_ink", "color_paper", "color_accent", "color_deep", "color_muted"];
// A bare hostname: the part after the @ in orders@<domain>.
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const svc = SB_SECRET;
  const ok = isSvc(req) || await keyOk(req.headers.get("x-settings-key"));
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, svc);

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* empty ok */ }
  const brand = String(input.brand ?? "hoku");
  const action = String(input.action ?? "get");

  // Publishing state for this brand's social accounts. Reported alongside
  // settings because it belongs on the same screen as "is the shop open" --
  // both are switches that decide whether something goes out to the public.
  async function publishing() {
    const { data: accts } = await db.from("social_accounts")
      .select("platform,handle,active,publishing_paused").eq("brand", brand);
    const { count: queued } = await db.from("social_posts")
      .select("*", { count: "exact", head: true })
      .eq("brand", brand).eq("status", "queued");
    const { data: next } = await db.from("social_posts")
      .select("scheduled_at").eq("brand", brand).eq("status", "queued")
      .order("scheduled_at", { ascending: true }).limit(1).maybeSingle();
    return {
      accounts: accts ?? [],
      paused: (accts ?? []).length > 0 &&
              (accts ?? []).every((a: Record<string, unknown>) => a.publishing_paused),
      queued: queued ?? 0,
      next_at: next?.scheduled_at ?? null,
    };
  }

  if (action === "get") {
    const { data, error } = await db.from("brand_settings").select("*").eq("brand", brand).single();
    if (error) return json({ error: error.message }, 500);
    const { data: prods } = await db.from("v_shop_buyable").select("*").eq("brand", brand);
    return json({ ok: true, settings: data, products: prods ?? [], publishing: await publishing() });
  }

  // The hold that actually holds. claim_next_social_post skips a paused account,
  // so queued posts stay queued and nothing reaches Instagram. Resuming is
  // deliberate and explicit -- it was previously possible to believe the queue
  // was held when nothing was stopping it.
  if (action === "set_publishing") {
    const paused = Boolean(input.paused);
    const { error } = await db.from("social_accounts")
      .update({ publishing_paused: paused }).eq("brand", brand);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, publishing: await publishing() });
  }

  if (action === "save") {
    const patch: Record<string, unknown> = {};
    const rejected: string[] = [];
    for (const [k, v] of Object.entries(input.settings ?? {})) {
      if (!ALLOWED.has(k)) { rejected.push(k); continue; }
      patch[k] = v;
    }

    for (const c of COLORS) {
      if (patch[c] !== undefined && !HEX.test(String(patch[c]))) {
        return json({ error: `${c} must be a hex colour like #B7935A` }, 400);
      }
    }
    for (const n of ["radius_px", "shipping_flat_cents", "free_ship_over_cents"]) {
      if (patch[n] !== undefined && patch[n] !== null) {
        const v = Number(patch[n]);
        if (!Number.isFinite(v) || v < 0) return json({ error: `${n} must be a positive number` }, 400);
        patch[n] = Math.round(v);
      }
    }
    for (const b of ["checkout_enabled", "tax_enabled"]) {
      if (patch[b] !== undefined) patch[b] = Boolean(patch[b]);
    }
    if (patch.mail_from_domain !== undefined) {
      const v = String(patch.mail_from_domain ?? "").trim().toLowerCase();
      if (v && !HOST.test(v)) return json({ error: "mail_from_domain must be a bare domain like news.example.com" }, 400);
      patch.mail_from_domain = v || null;
    }
    if (patch.email_logo_url !== undefined) {
      const v = String(patch.email_logo_url ?? "").trim();
      // Mail clients need an absolute URL; a relative path renders as a broken image.
      if (v && !/^https:\/\//i.test(v)) return json({ error: "email_logo_url must be an absolute https:// URL" }, 400);
      patch.email_logo_url = v || null;
    }

    // Turning checkout on with nothing sellable would put a Buy button on a page
    // that can only ever error. Refuse, and say why.
    if (patch.checkout_enabled === true) {
      const { data: buyable } = await db.from("v_shop_buyable")
        .select("sku").eq("brand", brand).eq("buyable", true);
      if (!buyable || buyable.length === 0) {
        return json({ error: "No product has both a price and stock yet, so checkout cannot open." }, 409);
      }
    }

    if (!Object.keys(patch).length) return json({ error: "Nothing to save." }, 400);

    const { data, error } = await db.from("brand_settings")
      .update(patch).eq("brand", brand).select("*").single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, settings: data, ignored: rejected, publishing: await publishing() });
  }

  return json({ error: `unknown action "${action}"` }, 400);
});
