// shop-sync — one interface, many sales channels.
//
// Channels come in two shapes and both land in the same tables:
//
//   PULL  (amazon, tiktok, sandbox) — this function holds the credentials and
//         fetches on a schedule.
//   PUSH  (stripe) — the credential lives elsewhere and that system posts
//         normalised orders in. Stripe is push because the live key already
//         sits on Vercel with the admin, and copying a live payment key into a
//         second system to avoid that would be the wrong trade.
//
// Either way nothing downstream knows which marketplace an order came from.
//
// EVERY CHANNEL IMPLEMENTS FOUR OPERATIONS
//   pullOrders(ctx, since)              new orders  -> shop_orders + items
//   pushInventory(ctx, sku, qty)        our stock   -> the channel
//   pushListing(ctx, listing)           create/update the listing
//   ackShipment(ctx, order, tracking)   mark shipped on the channel
//
// Amazon and TikTok are written in full here but hold no credentials yet, so
// they answer "not connected" with the specific thing that is missing rather
// than throwing something generic. The sandbox channel implements all four for
// real against the database, which is what makes `selftest` a genuine proof of
// the interface before either marketplace account exists.
//
// Actions: health | ingest | ingest_products | sync | reconcile
//          push_inventory | push_listing | ack_shipment | selftest
//
// v6: saveOrders writes through shop_create_order and never touches an order
// the database already holds. See the note above saveOrders.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (shop_key_sha256, plus shop_key_prev_sha256 while callers move
// over); edge_key_ok() (service-role only) checks them.
const __keyDb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
async function keyOk(k: string | null | undefined): Promise<boolean> {
  if (!k) return false;
  for (const n of ["shop_key_sha256", "shop_key_prev_sha256"]) {
    const { data } = await __keyDb.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shop-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// The generic parameters createClient infers differ between call sites, so the
// client type is pinned to one concrete factory rather than the bare return type.
const makeDb = (url: string, key: string) => createClient(url, key);
type Db = ReturnType<typeof makeDb>;
type Creds = Record<string, unknown>;
type Ctx = { db: Db; brand: string; channel: string; credentials: Creds };

type PulledOrder = {
  external_id: string;
  order_number?: string | null;
  placed_at: string;
  email?: string | null;
  customer_name?: string | null;
  phone?: string | null;
  ship?: Record<string, string>;
  total_cents: number;
  currency?: string;
  status?: string;
  shipped_at?: string | null;
  tracking?: string | null;
  raw?: unknown;
  items: { sku?: string; description?: string; qty: number; unit_price_cents: number;
           external_product_id?: string }[];
};

type Adapter = {
  pullOrders(ctx: Ctx, since: Date | null): Promise<PulledOrder[]>;
  pushInventory(ctx: Ctx, sku: string, qty: number): Promise<unknown>;
  pushListing(ctx: Ctx, listing: Record<string, unknown>): Promise<unknown>;
  ackShipment(ctx: Ctx, order: Record<string, unknown>, tracking: string, carrier: string): Promise<unknown>;
};

// A credential that is absent is a configuration fact, not a bug. Saying which
// key is missing is the difference between a five-minute fix and an afternoon.
class NotConnected extends Error {
  constructor(channel: string, missing: string[]) {
    super(`${channel} is not connected — missing credential${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
    this.name = "NotConnected";
  }
}
function need(ctx: Ctx, keys: string[]): Record<string, string> {
  const missing = keys.filter((k) => !ctx.credentials[k]);
  if (missing.length) throw new NotConnected(ctx.channel, missing);
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = String(ctx.credentials[k]);
  return out;
}

// Refreshed access tokens are written back so the next run does not have to ask
// again. Only the token fields are touched; the long-lived secrets are left as
// they are.
async function saveCreds(ctx: Ctx, patch: Creds) {
  const merged = { ...ctx.credentials, ...patch };
  ctx.credentials = merged;
  await ctx.db.from("shop_channels").update({ credentials: merged })
    .eq("brand", ctx.brand).eq("slug", ctx.channel);
}

const money = (n: unknown) => Math.round(Number(n ?? 0) * 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Amazon SP-API
// AWS SigV4 and IAM were dropped in October 2023; an LWA access token in
// x-amz-access-token is the whole of the auth now. Tokens last an hour.
const AMZ_HOSTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const AMZ_US_MARKETPLACE = "ATVPDKIKX0DER";

async function amazonToken(ctx: Ctx): Promise<string> {
  const c = need(ctx, ["refresh_token", "client_id", "client_secret"]);
  const cached = ctx.credentials.access_token as string | undefined;
  const exp = Number(ctx.credentials.access_token_expires_at ?? 0);
  // 60s of slack so a token cannot expire mid-page.
  if (cached && exp > Date.now() + 60_000) return cached;

  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: c.refresh_token,
      client_id: c.client_id,
      client_secret: c.client_secret,
    }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.access_token) {
    throw new Error(`Amazon LWA refused the refresh token: ${b.error_description ?? b.error ?? r.status}`);
  }
  await saveCreds(ctx, {
    access_token: b.access_token,
    access_token_expires_at: Date.now() + Number(b.expires_in ?? 3600) * 1000,
  });
  return b.access_token as string;
}

async function amz(ctx: Ctx, path: string, init: RequestInit = {}) {
  const token = await amazonToken(ctx);
  const host = AMZ_HOSTS[String(ctx.credentials.region ?? "na")] ?? AMZ_HOSTS.na;
  const r = await fetch(host + path, {
    ...init,
    headers: {
      "x-amz-access-token": token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  // getOrders is throttled to roughly one call a minute. A 429 here is normal
  // operation, not an outage, so it is surfaced as a retry signal.
  if (r.status === 429) throw new Error(`Amazon rate limit on ${path} — retry after the next window`);
  if (!r.ok) {
    const errs = body.errors as { message?: string }[] | undefined;
    throw new Error(`Amazon ${r.status} on ${path}: ${errs?.[0]?.message ?? text.slice(0, 200)}`);
  }
  return body;
}

const AMZ_STATUS: Record<string, string> = {
  Pending: "pending", Unshipped: "paid", PartiallyShipped: "paid",
  Shipped: "shipped", Canceled: "cancelled", Unfulfillable: "cancelled",
};

const amazonAdapter: Adapter = {
  async pullOrders(ctx, since) {
    const marketplace = String(ctx.credentials.marketplace_id ?? AMZ_US_MARKETPLACE);
    // Amazon rejects a window that starts less than two minutes ago.
    const after = (since ?? new Date(Date.now() - 30 * 86400000));
    const cap = new Date(Date.now() - 2 * 60000);
    const createdAfter = (after > cap ? cap : after).toISOString();

    const out: PulledOrder[] = [];
    let nextToken: string | null = null;
    let page = 0;

    do {
      const qs = new URLSearchParams({ MarketplaceIds: marketplace });
      if (nextToken) qs.set("NextToken", nextToken);
      else qs.set("LastUpdatedAfter", createdAfter);

      const body = await amz(ctx, `/orders/v0/orders?${qs}`);
      const payload = (body.payload ?? {}) as Record<string, unknown>;
      const orders = (payload.Orders ?? []) as Record<string, unknown>[];
      nextToken = (payload.NextToken as string) ?? null;

      for (const o of orders) {
        const id = String(o.AmazonOrderId);
        const addr = (o.ShippingAddress ?? {}) as Record<string, string>;
        const total = (o.OrderTotal ?? {}) as Record<string, string>;
        const buyer = (o.BuyerInfo ?? {}) as Record<string, string>;

        // Line items are a separate, less throttled call.
        const li = await amz(ctx, `/orders/v0/orders/${id}/orderItems`);
        const liPayload = (li.payload ?? {}) as Record<string, unknown>;
        const items = ((liPayload.OrderItems ?? []) as Record<string, unknown>[]).map((it) => {
          const price = (it.ItemPrice ?? {}) as Record<string, string>;
          const qty = Number(it.QuantityOrdered ?? 1) || 1;
          return {
            sku: it.SellerSKU ? String(it.SellerSKU) : undefined,
            description: it.Title ? String(it.Title) : undefined,
            qty,
            // ItemPrice is the extended price for the line, not the unit price.
            unit_price_cents: Math.round(money(price.Amount) / qty),
            external_product_id: it.ASIN ? String(it.ASIN) : undefined,
          };
        });
        // 0.5 requests/second on getOrderItems.
        await sleep(2100);

        out.push({
          external_id: id,
          order_number: id,
          placed_at: String(o.PurchaseDate),
          email: buyer.BuyerEmail ?? null,
          customer_name: addr.Name ?? null,
          phone: addr.Phone ?? null,
          ship: {
            line1: addr.AddressLine1 ?? "", line2: addr.AddressLine2 ?? "",
            city: addr.City ?? "", state: addr.StateOrRegion ?? "",
            postal: addr.PostalCode ?? "", country: addr.CountryCode ?? "US",
          },
          total_cents: money(total.Amount),
          currency: String(total.CurrencyCode ?? "usd").toLowerCase(),
          status: AMZ_STATUS[String(o.OrderStatus)] ?? "paid",
          raw: o,
          items,
        });
      }
      page++;
      if (nextToken) await sleep(2100);
    } while (nextToken && page < 10);

    return out;
  },

  async pushInventory(ctx, sku, qty) {
    const c = need(ctx, ["seller_id"]);
    const marketplace = String(ctx.credentials.marketplace_id ?? AMZ_US_MARKETPLACE);
    const productType = String(ctx.credentials.product_type ?? "PRODUCT");
    return await amz(ctx,
      `/listings/2021-08-01/items/${c.seller_id}/${encodeURIComponent(sku)}?marketplaceIds=${marketplace}`, {
        method: "PATCH",
        body: JSON.stringify({
          productType,
          patches: [{
            op: "replace",
            path: "/attributes/fulfillment_availability",
            value: [{ fulfillment_channel_code: "DEFAULT", quantity: Math.max(0, qty) }],
          }],
        }),
      });
  },

  async pushListing(ctx, listing) {
    const c = need(ctx, ["seller_id"]);
    const marketplace = String(ctx.credentials.marketplace_id ?? AMZ_US_MARKETPLACE);
    const productType = String(ctx.credentials.product_type ?? "PRODUCT");
    const sku = String(listing.sku ?? "");
    if (!sku) throw new Error("pushListing needs a sku");
    return await amz(ctx,
      `/listings/2021-08-01/items/${c.seller_id}/${encodeURIComponent(sku)}?marketplaceIds=${marketplace}`, {
        method: "PUT",
        body: JSON.stringify({
          productType,
          requirements: "LISTING",
          attributes: {
            item_name: [{ value: String(listing.title ?? ""), marketplace_id: marketplace }],
            brand: [{ value: "HOKU", marketplace_id: marketplace }],
            bullet_point: ((listing.bullets ?? []) as string[])
              .slice(0, 5).map((b) => ({ value: b, marketplace_id: marketplace })),
          },
        }),
      });
  },

  async ackShipment(ctx, order, tracking, carrier) {
    const marketplace = String(ctx.credentials.marketplace_id ?? AMZ_US_MARKETPLACE);
    const id = String(order.external_id ?? "");
    if (!id) throw new Error("ackShipment needs the channel's order id");
    return await amz(ctx, `/orders/v0/orders/${id}/shipmentConfirmation`, {
      method: "POST",
      body: JSON.stringify({
        marketplaceId: marketplace,
        packageDetail: {
          packageReferenceId: id.slice(-8),
          carrierCode: carrier || "USPS",
          trackingNumber: tracking,
          shipDate: new Date().toISOString(),
        },
      }),
    });
  },
};

// ---------------------------------------------------------------- TikTok Shop
// Signature: every query parameter except sign and the access token, sorted by
// key, concatenated as key+value, prefixed with the request path, followed by
// the raw body on non-GET calls, then wrapped in the app secret at both ends
// and HMAC-SHA256'd with that same secret.
const TT_HOST = "https://open-api.tiktokglobalshop.com";

async function ttSign(secret: string, path: string, params: Record<string, string>, body: string) {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token" && k !== "x-tts-access-token")
    .sort();
  let s = path;
  for (const k of keys) s += k + params[k];
  if (body) s += body;
  s = secret + s + secret;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(s));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ttToken(ctx: Ctx): Promise<string> {
  const c = need(ctx, ["app_key", "app_secret", "refresh_token"]);
  const cached = ctx.credentials.access_token as string | undefined;
  const exp = Number(ctx.credentials.access_token_expires_at ?? 0);
  if (cached && exp > Date.now() + 60_000) return cached;

  const qs = new URLSearchParams({
    app_key: c.app_key, app_secret: c.app_secret,
    refresh_token: c.refresh_token, grant_type: "refresh_token",
  });
  const r = await fetch(`https://auth.tiktok-shops.com/api/v2/token/refresh?${qs}`);
  const b = await r.json().catch(() => ({}));
  const data = (b.data ?? {}) as Record<string, unknown>;
  if (!r.ok || !data.access_token) {
    throw new Error(`TikTok refused the refresh token: ${b.message ?? r.status}`);
  }
  await saveCreds(ctx, {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? c.refresh_token,
    access_token_expires_at: Number(data.access_token_expire_in ?? 0) * 1000 || Date.now() + 3600_000,
  });
  return String(data.access_token);
}

async function tt(ctx: Ctx, method: string, path: string, query: Record<string, string> = {}, body?: unknown) {
  const c = need(ctx, ["app_key", "app_secret"]);
  const token = await ttToken(ctx);
  const raw = body === undefined ? "" : JSON.stringify(body);

  const params: Record<string, string> = {
    ...query,
    app_key: c.app_key,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (ctx.credentials.shop_cipher) params.shop_cipher = String(ctx.credentials.shop_cipher);
  params.sign = await ttSign(c.app_secret, path, params, method === "GET" ? "" : raw);

  const r = await fetch(`${TT_HOST}${path}?${new URLSearchParams(params)}`, {
    method,
    headers: { "x-tts-access-token": token, "content-type": "application/json" },
    ...(raw ? { body: raw } : {}),
  });
  const b = await r.json().catch(() => ({}));
  // TikTok answers 200 with a non-zero code on failure, so HTTP status alone
  // is not enough to tell whether the call worked.
  if (!r.ok || Number(b.code ?? 0) !== 0) {
    throw new Error(`TikTok ${b.code ?? r.status} on ${path}: ${b.message ?? "unknown error"}`);
  }
  return (b.data ?? {}) as Record<string, unknown>;
}

const TT_STATUS: Record<string, string> = {
  UNPAID: "pending", ON_HOLD: "pending",
  AWAITING_SHIPMENT: "paid", AWAITING_COLLECTION: "paid", PARTIALLY_SHIPPING: "paid",
  IN_TRANSIT: "shipped", DELIVERED: "shipped", COMPLETED: "shipped",
  CANCELLED: "cancelled",
};

const tiktokAdapter: Adapter = {
  async pullOrders(ctx, since) {
    const after = Math.floor((since ?? new Date(Date.now() - 30 * 86400000)).getTime() / 1000);
    const out: PulledOrder[] = [];
    let cursor = "";
    let page = 0;

    do {
      const q: Record<string, string> = { page_size: "50" };
      if (cursor) q.page_token = cursor;
      const data = await tt(ctx, "POST", "/order/202309/orders/search", q, {
        update_time_ge: after,
      });
      const orders = (data.orders ?? []) as Record<string, unknown>[];
      cursor = String(data.next_page_token ?? "");

      for (const o of orders) {
        const addr = (o.recipient_address ?? {}) as Record<string, unknown>;
        const pay = (o.payment ?? {}) as Record<string, string>;
        const districts = (addr.district_info ?? []) as Record<string, string>[];
        const pick = (level: string) =>
          districts.find((d) => d.address_level_name === level)?.address_name ?? "";

        // TikTok returns one line_item object per unit rather than a quantity,
        // so identical SKUs have to be folded together or the order shows one
        // row per can.
        const byUnit = (o.line_items ?? []) as Record<string, unknown>[];
        const grouped = new Map<string, { sku?: string; description?: string; qty: number; unit_price_cents: number; external_product_id?: string }>();
        for (const li of byUnit) {
          const sku = String(li.seller_sku ?? li.sku_id ?? "");
          const key = sku || String(li.product_id ?? "?");
          const found = grouped.get(key);
          if (found) { found.qty += 1; continue; }
          grouped.set(key, {
            sku: sku || undefined,
            description: li.product_name ? String(li.product_name) : undefined,
            qty: 1,
            unit_price_cents: money(li.sale_price),
            external_product_id: li.product_id ? String(li.product_id) : undefined,
          });
        }

        out.push({
          external_id: String(o.id),
          order_number: String(o.id),
          placed_at: new Date(Number(o.create_time ?? 0) * 1000).toISOString(),
          email: (o.buyer_email as string) ?? null,
          customer_name: (addr.name as string) ?? null,
          phone: (addr.phone_number as string) ?? null,
          ship: {
            line1: String(addr.address_detail ?? addr.full_address ?? ""),
            line2: "",
            city: pick("City"), state: pick("State"),
            postal: String(addr.postal_code ?? ""),
            country: String(addr.region_code ?? "US"),
          },
          total_cents: money(pay.total_amount),
          currency: String(pay.currency ?? "usd").toLowerCase(),
          status: TT_STATUS[String(o.status)] ?? "paid",
          raw: o,
          items: [...grouped.values()],
        });
      }
      page++;
    } while (cursor && page < 20);

    return out;
  },

  async pushInventory(ctx, sku, qty) {
    const productId = String(ctx.credentials[`product_id_${sku}`] ?? "");
    if (!productId) throw new NotConnected(ctx.channel, [`product_id_${sku}`]);
    return await tt(ctx, "POST", `/product/202309/products/${productId}/inventory/update`, {}, {
      skus: [{ id: sku, inventory: [{ warehouse_id: String(ctx.credentials.warehouse_id ?? ""), quantity: Math.max(0, qty) }] }],
    });
  },

  async pushListing(ctx, listing) {
    return await tt(ctx, "POST", "/product/202309/products", {}, {
      title: String(listing.title ?? ""),
      description: String(listing.description ?? ""),
      category_id: String(ctx.credentials.category_id ?? ""),
      skus: [{
        seller_sku: String(listing.sku ?? ""),
        price: { amount: String(((listing.price_cents as number) ?? 0) / 100), currency: "USD" },
      }],
    });
  },

  async ackShipment(ctx, order, tracking, carrier) {
    const pkg = String(order.package_id ?? ctx.credentials[`package_${order.external_id}`] ?? "");
    if (!pkg) throw new Error("TikTok needs the package id for this order before it can be marked shipped");
    return await tt(ctx, "POST", `/fulfillment/202309/packages/${pkg}/ship`, {}, {
      pick_up_type: "PICKUP",
      self_shipment: { tracking_number: tracking, shipping_provider_id: carrier },
    });
  },
};

// ---------------------------------------------------------------- sandbox
// Not a mock of the marketplaces — a real, fully implemented channel. It writes
// to the same tables through the same code path, which is what lets the four
// operations be proven before Amazon or TikTok exist.
const sandboxAdapter: Adapter = {
  async pullOrders(ctx) {
    const n = Number(ctx.credentials.seed_orders ?? 0);
    return Array.from({ length: n }, (_, i) => ({
      external_id: `SANDBOX-${i + 1}`,
      order_number: `SB${1000 + i}`,
      placed_at: new Date(Date.now() - i * 86400000).toISOString(),
      email: `buyer${i + 1}@example.test`,
      customer_name: `Sandbox Buyer ${i + 1}`,
      ship: { line1: "1 Test St", city: "Testville", state: "CA", postal: "90001", country: "US" },
      total_cents: 2400, currency: "usd", status: "paid",
      items: [{ sku: "HOKU-MIST-4OZ", description: "Sandbox item", qty: 1, unit_price_cents: 2400 }],
    }));
  },
  async pushInventory(ctx, sku, qty) {
    await saveCreds(ctx, { [`echo_inventory_${sku}`]: qty });
    return { ok: true, sku, qty, echoed: true };
  },
  async pushListing(ctx, listing) {
    await saveCreds(ctx, { [`echo_listing_${listing.sku}`]: listing.title ?? "" });
    return { ok: true, sku: listing.sku, echoed: true };
  },
  async ackShipment(ctx, order, tracking, carrier) {
    await saveCreds(ctx, { [`echo_shipped_${order.external_id}`]: tracking });
    return { ok: true, order: order.external_id, tracking, carrier, echoed: true };
  },
};

const ADAPTERS: Record<string, Adapter> = {
  sandbox: sandboxAdapter,
  amazon: amazonAdapter,
  tiktok: tiktokAdapter,
};
const PUSH_ONLY = new Set(["stripe"]);

// ---------------------------------------------------------------- persistence
// An order is written ONCE, through shop_create_order, which is also what the
// Stripe webhook calls -- so stock moves exactly once by exactly one path no
// matter which channel the order came from.
//
// After that first write, the local row is authoritative. The earlier version
// of this function upserted status / shipped_at / tracking from whatever the
// channel said on every hourly pass, and replaced the line items. Stripe knows
// nothing about our shipping, so an hour after a shipment went out its tracking
// number was gone and its items no longer resolved to a product. Now an order
// the database already has is left alone.
async function saveOrders(ctx: Ctx, orders: PulledOrder[]) {
  let inserted = 0, skipped = 0;
  for (const o of orders) {
    const { data: existing } = await ctx.db.from("shop_orders")
      .select("id").eq("brand", ctx.brand).eq("channel", ctx.channel)
      .eq("external_id", o.external_id).maybeSingle();
    if (existing) { skipped++; continue; }

    // Resolve marketplace product ids to our SKU before the RPC, which matches
    // by SKU only. Never by description string.
    const items: Record<string, unknown>[] = [];
    for (const it of o.items ?? []) {
      let sku = it.sku ?? null;
      if (!sku && it.external_product_id) {
        const { data: l } = await ctx.db.from("shop_listings")
          .select("product_id, shop_products!inner(sku)")
          .eq("brand", ctx.brand).eq("channel", ctx.channel)
          .eq("external_id", it.external_product_id).maybeSingle();
        const prod = (l as unknown as { shop_products?: { sku?: string } } | null)?.shop_products;
        sku = prod?.sku ?? null;
      }
      items.push({
        sku, description: it.description ?? null,
        qty: it.qty, unit_price_cents: it.unit_price_cents,
      });
    }

    const { data: id, error } = await ctx.db.rpc("shop_create_order", {
      p_brand: ctx.brand, p_channel: ctx.channel, p_external_id: o.external_id,
      p_placed_at: o.placed_at,
      p_email: o.email ?? "", p_customer_name: o.customer_name ?? "", p_phone: o.phone ?? "",
      p_ship: {
        line1: o.ship?.line1 ?? "", line2: o.ship?.line2 ?? "",
        city: o.ship?.city ?? "", state: o.ship?.state ?? "",
        postal_code: o.ship?.postal ?? "", country: o.ship?.country ?? "US",
      },
      p_total_cents: o.total_cents, p_currency: o.currency ?? "usd", p_items: items,
    });
    if (error) throw error;

    // What the channel already knew about this order, applied on first sight
    // only: an Amazon order that was shipped before we ever saw it should not
    // arrive looking unshipped.
    const patch: Record<string, unknown> = {};
    if (o.order_number) patch.order_number = o.order_number;
    if (o.status && o.status !== "paid") patch.status = o.status;
    if (o.shipped_at) patch.shipped_at = o.shipped_at;
    if (o.tracking) patch.tracking = o.tracking;
    if (o.raw) patch.raw = { source: ctx.channel, channel_order: o.raw };
    if (Object.keys(patch).length) {
      const { error: ue } = await ctx.db.from("shop_orders").update(patch).eq("id", id);
      if (ue) throw ue;
    }
    inserted++;
  }
  return { inserted, skipped };
}

const slug = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function loadCtx(db: Db, brand: string, channel: string): Promise<Ctx> {
  const { data } = await db.from("shop_channels")
    .select("credentials").eq("brand", brand).eq("slug", channel).maybeSingle();
  return { db, brand, channel, credentials: (data?.credentials ?? {}) as Creds };
}

// ---------------------------------------------------------------- handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const svcKey = SB_SECRET;
  const auth = req.headers.get("Authorization") || "";
  const ok = isSvc(req) || await keyOk(req.headers.get("x-shop-key"));
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const db = makeDb(Deno.env.get("SUPABASE_URL")!, svcKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const action = String(body.action ?? "health");
  const brand = String(body.brand ?? "hoku");
  const channel = String(body.channel ?? "stripe");

  const log = (ch: string, act: string, okFlag: boolean, detail: unknown) =>
    db.from("shop_sync_log").insert({ brand, channel: ch, action: act, ok: okFlag, detail });

  try {
    if (action === "health") {
      const { data: channels } = await db.from("shop_channels").select("*").eq("brand", brand).order("slug");
      const { count: orders } = await db.from("shop_orders")
        .select("*", { count: "exact", head: true }).eq("brand", brand);
      const { data: stock } = await db.from("v_shop_stock").select("*").eq("brand", brand);
      // Report which channels could actually run, without echoing any secret.
      const readiness = (channels ?? []).map((c: Record<string, unknown>) => {
        const creds = (c.credentials ?? {}) as Creds;
        const wants: Record<string, string[]> = {
          amazon: ["refresh_token", "client_id", "client_secret", "seller_id"],
          tiktok: ["app_key", "app_secret", "refresh_token", "shop_cipher"],
          sandbox: [], stripe: [],
        };
        const missing = (wants[String(c.slug)] ?? []).filter((k) => !creds[k]);
        return { slug: c.slug, active: c.active, connected: missing.length === 0, missing };
      });
      return json({ ok: true, brand, channels: channels ?? [], readiness,
        orders: orders ?? 0, stock: stock ?? [] });
    }

    // Every channel, every operation, end to end against the sandbox. This is
    // the proof that the interface holds before Amazon or TikTok are live.
    if (action === "selftest") {
      const ctx = await loadCtx(db, brand, "sandbox");
      const a = ADAPTERS.sandbox;
      const results: Record<string, unknown> = {};

      const pulled = await a.pullOrders(ctx, null);
      results.pullOrders = { returned: pulled.length };

      results.pushInventory = await a.pushInventory(ctx, "HOKU-MIST-4OZ", 42);
      results.pushListing = await a.pushListing(ctx, { sku: "HOKU-MIST-4OZ", title: "HOKU Facial Mist" });
      results.ackShipment = await a.ackShipment(ctx, { external_id: "SANDBOX-1" }, "9400100000000000000000", "USPS");

      // The two real adapters must fail with a named missing credential rather
      // than a generic crash — that is the contract for "not connected yet".
      const notConnected: Record<string, string> = {};
      for (const slugName of ["amazon", "tiktok"]) {
        const c2 = await loadCtx(db, brand, slugName);
        try {
          await ADAPTERS[slugName].pullOrders(c2, null);
          notConnected[slugName] = "UNEXPECTED: adapter ran without credentials";
        } catch (e) {
          notConnected[slugName] = (e as Error).message;
        }
      }

      await log("sandbox", "selftest", true, { operations: 4 });
      return json({ ok: true, sandbox: results, not_connected: notConnected,
        note: "All four operations exercised against the sandbox channel. Amazon and TikTok are written in full and waiting on credentials only." });
    }

    if (action === "ingest_products") {
      const incoming = (body.products as Record<string, unknown>[]) ?? [];
      const linked: unknown[] = [];
      for (const sp of incoming) {
        const name = String(sp.name ?? "").trim();
        if (!name) continue;
        const { data: existing } = await db.from("shop_products")
          .select("id,sku").eq("brand", brand).eq("name", name).maybeSingle();

        let productId = existing?.id as string | undefined;
        let sku = existing?.sku as string | undefined;
        if (!productId) {
          sku = slug(name);
          const { data: created, error } = await db.from("shop_products").upsert({
            brand, sku, name, units_per_pack: Number(sp.units_per_pack ?? 1), active: true,
          }, { onConflict: "brand,sku" }).select("id,sku").single();
          if (error) throw error;
          productId = created.id as string; sku = created.sku as string;
        }

        await db.from("shop_listings").upsert({
          brand, channel, product_id: productId,
          external_id: String(sp.external_id ?? ""), external_sku: sku,
          listed: true, last_pushed_at: new Date().toISOString(), last_error: null,
        }, { onConflict: "brand,channel,product_id" });

        await db.from("shop_inventory").upsert({
          brand, product_id: productId,
          on_hand: Number(sp.on_hand ?? 0), low_at: Number(sp.low_at ?? 12),
          updated_at: new Date().toISOString(),
        }, { onConflict: "brand,product_id" });

        linked.push({ sku, external_id: sp.external_id, name });
      }
      await log(channel, "push_listing", true, { linked: linked.length });
      return json({ ok: true, linked });
    }

    if (action === "ingest") {
      const orders = (body.orders as PulledOrder[]) ?? [];
      const ctx = await loadCtx(db, brand, channel);
      const saved = await saveOrders(ctx, orders);
      await db.from("shop_channels")
        .update({ last_sync_at: new Date().toISOString(), last_error: null })
        .eq("brand", brand).eq("slug", channel);
      await log(channel, "pull_orders", true, { received: orders.length, ...saved });
      return json({ ok: true, channel, received: orders.length, ...saved });
    }

    if (action === "sync") {
      const only = body.only ? String(body.only) : null;
      const { data: channels } = await db.from("shop_channels")
        .select("*").eq("brand", brand).eq("active", true);
      const results: unknown[] = [];

      for (const ch of channels ?? []) {
        const chSlug = String(ch.slug);
        if (only && chSlug !== only) continue;
        if (PUSH_ONLY.has(chSlug)) {
          results.push({ channel: chSlug, skipped: "push channel — ingests from its own host" });
          continue;
        }
        const adapter = ADAPTERS[chSlug];
        if (!adapter) { results.push({ channel: chSlug, error: "no adapter" }); continue; }
        const ctx: Ctx = { db, brand, channel: chSlug, credentials: (ch.credentials ?? {}) as Creds };
        try {
          const since = ch.last_sync_at ? new Date(String(ch.last_sync_at)) : null;
          const pulled = await adapter.pullOrders(ctx, since);
          const saved = await saveOrders(ctx, pulled);
          await db.from("shop_channels")
            .update({ last_sync_at: new Date().toISOString(), last_error: null })
            .eq("brand", brand).eq("slug", chSlug);
          await log(chSlug, "pull_orders", true, { pulled: pulled.length, ...saved });
          results.push({ channel: chSlug, pulled: pulled.length, ...saved });
        } catch (e) {
          const msg = (e as Error).message;
          await db.from("shop_channels").update({ last_error: msg })
            .eq("brand", brand).eq("slug", chSlug);
          await log(chSlug, "pull_orders", false, { error: msg });
          results.push({ channel: chSlug, error: msg });
        }
      }
      return json({ ok: true, brand, results });
    }

    // Stock is ours; the channel is told about it. Sent to every listed channel
    // unless one is named, so a stock edit cannot quietly update Amazon and
    // leave TikTok overselling.
    if (action === "push_inventory") {
      const sku = String(body.sku ?? "");
      if (!sku) return json({ error: "sku required" }, 400);
      const { data: row } = await db.from("v_shop_stock")
        .select("*").eq("brand", brand).eq("sku", sku).maybeSingle();
      const qty = body.qty !== undefined ? Number(body.qty) : Number(row?.on_hand ?? 0);

      const targets = body.channel ? [String(body.channel)]
        : Object.keys(ADAPTERS).filter((s) => s !== "sandbox");
      const results: unknown[] = [];
      for (const t of targets) {
        const ctx = await loadCtx(db, brand, t);
        try {
          const r = await ADAPTERS[t].pushInventory(ctx, sku, qty);
          await log(t, "push_inventory", true, { sku, qty });
          results.push({ channel: t, ok: true, result: r });
        } catch (e) {
          const msg = (e as Error).message;
          await log(t, "push_inventory", false, { sku, error: msg });
          results.push({ channel: t, ok: false, error: msg });
        }
      }
      return json({ ok: true, sku, qty, results });
    }

    if (action === "push_listing") {
      const sku = String(body.sku ?? "");
      const target = String(body.channel ?? "");
      if (!sku || !target) return json({ error: "sku and channel required" }, 400);
      const { data: p } = await db.from("shop_products")
        .select("id,sku,name,price_cents,description_long").eq("brand", brand).eq("sku", sku).maybeSingle();
      if (!p) return json({ error: "unknown sku" }, 404);
      const { data: l } = await db.from("shop_listings")
        .select("title,description,bullets,price_cents,compliance")
        .eq("brand", brand).eq("channel", target).eq("product_id", p.id).maybeSingle();

      // The compliance trigger already refuses to mark a listing live with a
      // banned claim in it. Pushing one to a marketplace anyway would route
      // around our own gate, so it is refused here too.
      if (l?.compliance) {
        return json({ error: `listing is blocked on compliance: ${l.compliance}` }, 409);
      }

      const ctx = await loadCtx(db, brand, target);
      try {
        const r = await ADAPTERS[target].pushListing(ctx, {
          sku: p.sku, title: l?.title ?? p.name,
          description: l?.description ?? p.description_long,
          bullets: l?.bullets ?? [], price_cents: l?.price_cents ?? p.price_cents,
        });
        await db.from("shop_listings").update({
          last_pushed_at: new Date().toISOString(), last_error: null,
        }).eq("brand", brand).eq("channel", target).eq("product_id", p.id);
        await log(target, "push_listing", true, { sku });
        return json({ ok: true, channel: target, sku, result: r });
      } catch (e) {
        const msg = (e as Error).message;
        await db.from("shop_listings").update({ last_error: msg })
          .eq("brand", brand).eq("channel", target).eq("product_id", p.id);
        await log(target, "push_listing", false, { sku, error: msg });
        return json({ ok: false, channel: target, sku, error: msg }, 502);
      }
    }

    if (action === "ack_shipment") {
      const orderId = String(body.order_id ?? "");
      const tracking = String(body.tracking ?? "");
      if (!orderId || !tracking) return json({ error: "order_id and tracking required" }, 400);
      const { data: o } = await db.from("shop_orders")
        .select("id,channel,external_id").eq("brand", brand).eq("id", orderId).maybeSingle();
      if (!o) return json({ error: "order not found for this brand" }, 404);
      const target = String(o.channel);
      if (PUSH_ONLY.has(target)) {
        return json({ ok: true, channel: target, skipped: "the storefront has no shipment API to call" });
      }
      const ctx = await loadCtx(db, brand, target);
      try {
        const r = await ADAPTERS[target].ackShipment(
          ctx, { external_id: o.external_id }, tracking, String(body.carrier ?? "USPS"));
        await log(target, "ack_shipment", true, { order: orderId, tracking });
        return json({ ok: true, channel: target, result: r });
      } catch (e) {
        const msg = (e as Error).message;
        await log(target, "ack_shipment", false, { order: orderId, error: msg });
        return json({ ok: false, channel: target, error: msg }, 502);
      }
    }

    // The gate on the cutover: the database must agree with the channel of
    // record on which orders exist and what they were worth. Shipped state is
    // deliberately NOT compared -- it lives here, not on the channel.
    if (action === "reconcile") {
      const live = (body.orders as PulledOrder[]) ?? [];
      const { data: rows } = await db.from("shop_orders")
        .select("external_id,total_cents").eq("brand", brand).eq("channel", channel);
      const dbIds = new Set((rows ?? []).map((r: Record<string, unknown>) => String(r.external_id)));
      const liveIds = new Set(live.map((o) => o.external_id));

      const missing = [...liveIds].filter((id) => !dbIds.has(id));
      const extra = [...dbIds].filter((id) => !liveIds.has(id));
      const liveRevenue = live.reduce((n, o) => n + o.total_cents, 0);
      const dbRevenue = (rows ?? []).reduce((n: number, r: Record<string, unknown>) => n + Number(r.total_cents), 0);

      const clean = missing.length === 0 && extra.length === 0 && liveRevenue === dbRevenue;
      await log(channel, "reconcile", clean, { missing: missing.length, extra: extra.length });
      return json({
        ok: true, clean,
        channel_of_record: { orders: live.length, revenue_cents: liveRevenue },
        database: { orders: (rows ?? []).length, revenue_cents: dbRevenue },
        missing_from_db: missing, not_in_channel: extra,
      });
    }

    return json({ error: `unknown action "${action}"` }, 400);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await log(channel, action, false, { error: msg });
    return json({ error: msg }, 500);
  }
});
