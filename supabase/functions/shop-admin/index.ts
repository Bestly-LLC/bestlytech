// shop-admin — everything the admin panel reads and writes, brand-scoped.
//
// Split from shop-sync deliberately: sync talks to marketplaces, this talks to
// the panel. The real work happens in Postgres functions so shipping and stock
// edits are atomic and leave an audit trail in shop_inventory_moves.
//
// This is also the only door to the shop_* RPCs. They are SECURITY DEFINER and
// were once executable by the public anon key, which meant anyone with the
// storefront's JavaScript could dump customers or drain stock. EXECUTE has been
// revoked from anon; every caller — the admin panel, the Stripe webhook, the
// hourly reconcile — comes through here with the shop key, and this function
// talks to Postgres as service role.
//
// Actions: data | set_stock | mark_shipped | channels | set_channel | sync_log
//          catalogue | save_product | save_listing | create_order | resend_notification
//          order_get | refund | refund_by_payment_intent | order_status
//          record_abandoned | mark_recovered | abandoned_list          (v11)
// Auth: x-shop-key, or Authorization: Bearer <service_role_key>
//
// v11 (12 Sep 2026): abandoned checkout recovery. record_abandoned is called
// by the webhook on checkout.session.expired; the AFTER INSERT trigger on
// shop_abandoned_checkouts enqueues the single reminder email. mark_recovered
// is called on checkout.session.completed when Stripe reports recovered_from.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = (k: string): Record<string, string> => k.startsWith("sb_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const OWN_KEY = "tLDXwk5x0KR4CPON28k7jP3eJEZLRNrF5Rqb7oLZLR4Zwaav";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shop-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const EXTRA_INT = ["subtotal_cents", "discount_cents", "shipping_cents", "tax_cents"];
const EXTRA_TXT = ["payment_intent", "promo_code", "status"];
function pickExtra(x: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of EXTRA_INT) if (x[k] != null && Number.isFinite(Number(x[k]))) out[k] = Math.round(Number(x[k]));
  for (const k of EXTRA_TXT) if (typeof x[k] === "string" && x[k]) out[k] = String(x[k]).slice(0, 200);
  if (typeof x.livemode === "boolean") out.livemode = x.livemode;
  return out;
}

const slug = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const svcKey = SB_SECRET;
  const auth = req.headers.get("Authorization") || "";
  const ok = (req.headers.get("x-shop-key") || "") === OWN_KEY ||
    isSvc(req);
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, svcKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const action = String(body.action ?? "data");
  // The brand is pinned by the caller (the Vercel proxy hard-codes it), never
  // chosen by the browser. One panel, one brand.
  const brand = String(body.brand ?? "hoku");

  try {
    if (action === "data") {
      const { data, error } = await db.rpc("shop_admin_data", { _brand: brand });
      if (error) throw error;
      return json(data);
    }

    // The one path by which a payment becomes an order. The webhook has already
    // verified Stripe's signature; this just runs the idempotent RPC as service
    // role. The brand comes from the caller, which validated it against tenants.
    if (action === "create_order") {
      const { data: tenant } = await db.from("tenants").select("brand").eq("brand", brand).maybeSingle();
      if (!tenant) return json({ error: `unknown brand "${brand}"` }, 400);
      const { data, error } = await db.rpc("shop_create_order", {
        p_brand: brand,
        p_channel: String(body.channel ?? "stripe"),
        p_external_id: String(body.external_id ?? ""),
        p_placed_at: String(body.placed_at ?? new Date().toISOString()),
        p_email: String(body.email ?? ""),
        p_customer_name: String(body.customer_name ?? ""),
        p_phone: String(body.phone ?? ""),
        p_ship: body.ship ?? {},
        p_total_cents: Number(body.total_cents ?? 0),
        p_currency: String(body.currency ?? "usd"),
        p_items: body.items ?? [],
        // Totals breakdown + payment reference. Only whitelisted keys reach the
        // RPC so a caller cannot smuggle arbitrary columns through p_extra.
        p_extra: pickExtra((body.extra && typeof body.extra === "object" ? body.extra : {}) as Record<string, unknown>),
      });
      if (error) throw error;
      return json({ ok: true, order: data });
    }

    // checkout.session.expired → one row, and (via trigger) one reminder email.
    // Idempotent on (brand, session_id): Stripe retries webhooks, and a retry
    // must not mail twice. The email address is required — no address, no row.
    if (action === "record_abandoned") {
      const { data: tenant } = await db.from("tenants").select("brand").eq("brand", brand).maybeSingle();
      if (!tenant) return json({ error: `unknown brand "${brand}"` }, 400);
      const session_id = String(body.session_id ?? "");
      const email = String(body.email ?? "").trim().toLowerCase();
      const recovery_url = String(body.recovery_url ?? "");
      if (!/^cs_(live|test)_[A-Za-z0-9]{24,}$/.test(session_id)) return json({ error: "bad session_id" }, 400);
      if (!email || !email.includes("@")) return json({ ok: true, skipped: "no email" });
      if (!recovery_url.startsWith("https://")) return json({ ok: true, skipped: "no recovery url" });

      const { data: existing } = await db.from("shop_abandoned_checkouts")
        .select("id").eq("brand", brand).eq("session_id", session_id).maybeSingle();
      if (existing) return json({ ok: true, id: existing.id, duplicate: true });

      const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]).slice(0, 50).map((i) => ({
        sku: i.sku ? String(i.sku).slice(0, 60) : null,
        description: i.description ? String(i.description).slice(0, 160) : null,
        qty: Math.max(1, Number(i.qty) || 1),
        unit_price_cents: Math.max(0, Math.round(Number(i.unit_price_cents) || 0)),
      })) : [];
      const { data, error } = await db.from("shop_abandoned_checkouts").insert({
        brand, session_id, email,
        customer_name: body.customer_name ? String(body.customer_name).slice(0, 120) : null,
        recovery_url: recovery_url.slice(0, 2000),
        recovery_expires_at: body.recovery_expires_at ? new Date(Number(body.recovery_expires_at) * 1000).toISOString() : null,
        items,
        subtotal_cents: Math.max(0, Math.round(Number(body.subtotal_cents) || 0)),
        currency: String(body.currency ?? "usd").toLowerCase(),
        livemode: body.livemode !== false,
        expired_at: body.expired_at ? new Date(Number(body.expired_at) * 1000).toISOString() : new Date().toISOString(),
      }).select("id").single();
      if (error) throw error;
      return json({ ok: true, id: data.id });
    }

    // checkout.session.completed with recovered_from set: the customer used
    // the link. Mark it so the panel can count recoveries and the reminder
    // (if still queued) is never sent.
    if (action === "mark_recovered") {
      const original = String(body.recovered_from ?? "");
      const newSession = String(body.session_id ?? "");
      if (!original) return json({ error: "recovered_from required" }, 400);
      const { data, error } = await db.from("shop_abandoned_checkouts")
        .update({ recovered_at: new Date().toISOString(), recovered_session_id: newSession || null })
        .eq("brand", brand).eq("session_id", original).is("recovered_at", null)
        .select("id").maybeSingle();
      if (error) throw error;
      if (data?.id) {
        await db.from("shop_notifications").update({ status: "skipped", error: "recovered before send" })
          .eq("abandoned_id", data.id).eq("status", "queued");
      }
      return json({ ok: true, marked: !!data });
    }

    if (action === "abandoned_list") {
      const { data } = await db.from("shop_abandoned_checkouts")
        .select("id,session_id,email,customer_name,subtotal_cents,currency,expired_at,recovered_at,livemode")
        .eq("brand", brand).order("expired_at", { ascending: false })
        .limit(Math.min(Number(body.limit ?? 50), 200));
      const { data: sent } = await db.from("shop_notifications")
        .select("abandoned_id,status,sent_at").eq("brand", brand).eq("kind", "abandoned");
      const byId: Record<string, unknown> = {};
      for (const n of sent ?? []) byId[String((n as Record<string, unknown>).abandoned_id)] = n;
      return json({ ok: true, rows: (data ?? []).map((r: Record<string, unknown>) => ({ ...r, email_status: byId[String(r.id)] ?? null })) });
    }

    if (action === "catalogue") {
      const { data, error } = await db.from("v_shop_catalogue")
        .select("*").eq("brand", brand).order("name");
      if (error) throw error;
      const { data: channels } = await db.from("shop_channels")
        .select("slug,label,active").eq("brand", brand).order("slug");
      return json({ ok: true, products: data ?? [], channels: channels ?? [] });
    }

    if (action === "save_product") {
      const sku = String(body.sku ?? "").trim() || slug(String(body.name ?? ""));
      if (!sku) return json({ error: "sku or name required" }, 400);
      const patch: Record<string, unknown> = { brand, sku };
      for (const k of ["name", "gtin", "net_content", "description_long"]) {
        if (body[k] !== undefined) patch[k] = body[k] === "" ? null : body[k];
      }
      if (body.units_per_pack !== undefined) patch.units_per_pack = Math.max(1, Number(body.units_per_pack) || 1);
      if (body.price_cents !== undefined) patch.price_cents = Math.max(0, Number(body.price_cents) || 0);
      if (body.active !== undefined) patch.active = Boolean(body.active);
      if (!patch.name) patch.name = sku;

      const { data, error } = await db.from("shop_products")
        .upsert(patch, { onConflict: "brand,sku" }).select("id,sku").single();
      if (error) throw error;

      await db.from("shop_inventory").upsert(
        { brand, product_id: data.id, on_hand: 0, low_at: 12 },
        { onConflict: "brand,product_id", ignoreDuplicates: true });
      return json({ ok: true, sku: data.sku, id: data.id });
    }

    // Listing copy is checked by a database trigger, so a banned claim cannot
    // be marked live no matter what the browser sends.
    if (action === "save_listing") {
      const sku = String(body.sku ?? "");
      const channel = String(body.channel ?? "");
      if (!sku || !channel) return json({ error: "sku and channel required" }, 400);

      const { data: p } = await db.from("shop_products")
        .select("id").eq("brand", brand).eq("sku", sku).maybeSingle();
      if (!p) return json({ error: "unknown sku" }, 404);

      const patch: Record<string, unknown> = { brand, channel, product_id: p.id };
      for (const k of ["title", "description", "external_id", "external_sku"]) {
        if (body[k] !== undefined) patch[k] = body[k] === "" ? null : body[k];
      }
      if (body.bullets !== undefined) {
        patch.bullets = Array.isArray(body.bullets) ? body.bullets
          : String(body.bullets).split("\n").map((s) => s.trim()).filter(Boolean);
      }
      if (body.images !== undefined) patch.images = body.images;
      if (body.price_cents !== undefined) patch.price_cents = Math.max(0, Number(body.price_cents) || 0);
      if (body.listed !== undefined) patch.listed = Boolean(body.listed);

      const { data, error } = await db.from("shop_listings")
        .upsert(patch, { onConflict: "brand,channel,product_id" })
        .select("listed,compliance").single();
      if (error) throw error;

      return json({
        ok: true, listed: data.listed, compliance: data.compliance,
        blocked: !!data.compliance,
      });
    }

    if (action === "set_stock") {
      const sku = String(body.sku ?? "");
      if (!sku) return json({ error: "sku required" }, 400);
      const { data, error } = await db.rpc("shop_set_stock", {
        _brand: brand, _sku: sku,
        _on_hand: body.on_hand === undefined ? null : Math.max(0, Number(body.on_hand) || 0),
        _low_at:  body.low_at  === undefined ? null : Math.max(0, Number(body.low_at)  || 0),
      });
      if (error) throw error;
      return json(data);
    }

    if (action === "mark_shipped") {
      const orderId = String(body.order_id ?? "");
      if (!orderId) return json({ error: "order_id required" }, 400);
      // Belt and braces: fetched brand-scoped first, so an id from another
      // brand cannot be shipped through this panel even if guessed.
      const { data: o } = await db.from("shop_orders")
        .select("id").eq("id", orderId).eq("brand", brand).maybeSingle();
      if (!o) return json({ error: "order not found for this brand" }, 404);

      const { data, error } = await db.rpc("shop_mark_shipped", {
        _order_id: orderId,
        _tracking: body.tracking ? String(body.tracking) : null,
        _carrier:  body.carrier  ? String(body.carrier)  : null,
        _undo: Boolean(body.undo ?? false),
      });
      if (error) throw error;
      return json(data);
    }

    // The refund flow: /api/refund reads the order (for the PaymentIntent and
    // the refundable balance), calls Stripe, then records the result here.
    if (action === "order_get") {
      const orderId = String(body.order_id ?? "");
      if (!orderId) return json({ error: "order_id required" }, 400);
      const { data: o } = await db.from("shop_orders")
        .select("id,brand,channel,external_id,order_number,status,total_cents,refunded_cents,payment_intent,livemode,shipped_at,email")
        .eq("id", orderId).eq("brand", brand).maybeSingle();
      if (!o) return json({ error: "order not found for this brand" }, 404);
      return json({ ok: true, order: o });
    }

    if (action === "refund") {
      const orderId = String(body.order_id ?? "");
      if (!orderId) return json({ error: "order_id required" }, 400);
      const { data: o } = await db.from("shop_orders").select("id").eq("id", orderId).eq("brand", brand).maybeSingle();
      if (!o) return json({ error: "order not found for this brand" }, 404);
      const { data, error } = await db.rpc("shop_refund_order", {
        _order_id: orderId,
        _amount_cents: Math.round(Number(body.amount_cents ?? 0)),
        _restock: Boolean(body.restock ?? false),
        _reason: body.reason ? String(body.reason).slice(0, 500) : null,
        _provider_refund_id: body.provider_refund_id ? String(body.provider_refund_id) : null,
        _provider: String(body.provider ?? "stripe"),
      });
      if (error) return json({ error: error.message }, 409);
      return json(data);
    }

    // Stripe-dashboard refunds arrive as charge.refunded with only the
    // PaymentIntent; the webhook resolves it to an order here. Brand-scoped
    // because each Vercel project pins its own brand.
    if (action === "refund_by_payment_intent") {
      const pi = String(body.payment_intent ?? "");
      if (!pi) return json({ error: "payment_intent required" }, 400);
      const { data: o } = await db.from("shop_orders").select("id,refunded_cents,total_cents")
        .eq("brand", brand).eq("payment_intent", pi).maybeSingle();
      if (!o) return json({ error: "no order for that payment_intent" }, 404);
      const { data, error } = await db.rpc("shop_refund_order", {
        _order_id: o.id,
        _amount_cents: Math.round(Number(body.amount_cents ?? 0)),
        _restock: false,
        _reason: body.reason ? String(body.reason).slice(0, 500) : "refunded in Stripe",
        _provider_refund_id: body.provider_refund_id ? String(body.provider_refund_id) : null,
        _provider: "stripe",
      });
      if (error) return json({ error: error.message }, 409);
      return json({ ...data, order_id: o.id });
    }

    // Public order card. Keyed by the Checkout session id, which is 60+
    // characters of Stripe entropy -- unguessable, but still treated as a
    // bearer: only what the customer needs comes back. No full address, no
    // phone, email masked.
    if (action === "order_status") {
      const ext = String(body.external_id ?? "");
      if (!/^cs_(live|test)_[A-Za-z0-9]{24,}$/.test(ext)) return json({ error: "not found" }, 404);
      const { data: o } = await db.from("shop_orders")
        .select("id,order_number,status,placed_at,shipped_at,carrier,tracking,ship_city,ship_state,email,currency,subtotal_cents,discount_cents,shipping_cents,tax_cents,total_cents,refunded_cents,promo_code")
        .eq("brand", brand).eq("channel", "stripe").eq("external_id", ext).maybeSingle();
      if (!o) return json({ error: "not found" }, 404);
      const { data: items } = await db.from("shop_order_items")
        .select("description,sku,qty").eq("order_id", o.id).order("id");
      const mask = (e: string) => {
        const [u, d] = String(e || "").split("@");
        if (!u || !d) return "";
        return `${u.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}`;
      };
      return json({
        ok: true,
        order: {
          number: o.order_number, status: o.status, placed_at: o.placed_at,
          shipped_at: o.shipped_at, carrier: o.carrier ?? "", tracking: o.tracking ?? "",
          ship_city: o.ship_city ?? "", ship_state: o.ship_state ?? "",
          email_masked: mask(o.email), currency: o.currency,
          subtotal: o.subtotal_cents, discount: o.discount_cents, shipping: o.shipping_cents,
          tax: o.tax_cents, total: o.total_cents, refunded: o.refunded_cents, promo_code: o.promo_code ?? "",
          items: (items ?? []).map((i: Record<string, unknown>) => ({ desc: i.description ?? i.sku, qty: i.qty })),
        },
      });
    }

    // "Resend email" on an order row. shop-notify re-queues the (order, kind)
    // row and sends; the order is brand-checked there as well.
    if (action === "resend_notification") {
      const orderId = String(body.order_id ?? "");
      const kind = String(body.kind ?? "");
      if (!orderId || !kind) return json({ error: "order_id and kind required" }, 400);
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/shop-notify`, {
        method: "POST",
        headers: { ...sbHeaders(svcKey), "Content-Type": "application/json" },
        body: JSON.stringify({ resend: true, order_id: orderId, kind, brand }),
      });
      const out = await r.json().catch(() => ({}));
      return json(out, r.status);
    }

    if (action === "channels") {
      const { data: channels } = await db.from("shop_channels")
        .select("*").eq("brand", brand).order("slug");
      const { data: listings } = await db.from("shop_listings")
        .select("channel,listed,compliance").eq("brand", brand);
      const { data: log } = await db.from("shop_sync_log")
        .select("channel,action,ok,detail,created_at")
        .eq("brand", brand).order("created_at", { ascending: false }).limit(12);
      const { data: counts } = await db.from("shop_orders").select("channel").eq("brand", brand);
      const byChannel: Record<string, number> = {};
      for (const r of counts ?? []) {
        const c = (r as { channel: string }).channel;
        byChannel[c] = (byChannel[c] ?? 0) + 1;
      }
      return json({
        ok: true,
        channels: (channels ?? []).map((c: Record<string, unknown>) => {
          const mine = (listings ?? []).filter((l: Record<string, unknown>) => l.channel === c.slug);
          // Credentials never leave this function.
          const { credentials: _c, ...safe } = c;
          return {
            ...safe,
            connected: !!(c.credentials && Object.keys(c.credentials as object).length),
            orders: byChannel[c.slug as string] ?? 0,
            listings: mine.filter((l: Record<string, unknown>) => l.listed).length,
            blocked: mine.filter((l: Record<string, unknown>) => l.compliance).length,
          };
        }),
        log: log ?? [],
      });
    }

    if (action === "set_channel") {
      const slugName = String(body.slug ?? "");
      if (!slugName) return json({ error: "slug required" }, 400);
      const { error } = await db.from("shop_channels")
        .update({ active: Boolean(body.active), last_error: null })
        .eq("brand", brand).eq("slug", slugName);
      if (error) throw error;
      return json({ ok: true, slug: slugName, active: Boolean(body.active) });
    }

    if (action === "sync_log") {
      const { data } = await db.from("shop_sync_log")
        .select("*").eq("brand", brand)
        .order("created_at", { ascending: false })
        .limit(Math.min(Number(body.limit ?? 25), 100));
      return json({ ok: true, log: data ?? [] });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? String(err) }, 500);
  }
});
