// social-render — the Cookie Yeti / InventoryProof card renderer, server-side.
//
// The first version of this lived as Python in a sandbox that was reset on
// 2026-09-12 and took the renderer with it. This one lives where the data is.
// It turns a small JSON description of a card into a 1080×1350 JPEG that
// matches the September card system, writes the JPEG into the brand's bucket,
// and returns the stored URL. social_posts only ever points at stored copies,
// so a bad day here cannot break a post that is already scheduled.
//
// Actions (POST, JSON):
//   render   { brand, slug, cards:[{kind, eyebrow, head, body, big, pose, ground, accent}], dry? }
//            -> renders every card as slides 1..n, stores under
//               <bucket>/social/<brand>/<slug>-NN.jpg (a single: <slug>.jpg)
//            -> { ok, urls }.  dry:true returns the first JPEG inline instead.
//   preview  { brand, card }  -> image/jpeg of that one card, nothing stored
//   queue_next { brand, limit? } -> bank -> render -> social_posts, up to per_run times
//   health   -> fonts reachable, wasm ready
//
// Auth: the service_role JWT (pg_cron / invoke_edge_function) or a staff
// session token in x-staff-token (Studio's Library tab). Never a key in a page.
//
// Type only. There is no photo layout and no way to ask for one: an <img> can
// only ever be the mascot or a brand mark, by name.

import satori from "npm:satori@0.12.1";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { encode as jpegEncode } from "npm:jpeg-js@0.4.4";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { W, H, KINDS, GROUNDS, ACCENT, cy, ip, setAssets, type Card } from "./layout.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-staff-token, x-proxy-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SB = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB, SB_SECRET, { auth: { persistSession: false } });
const ASSETS = `${SB}/storage/v1/object/public/social-media/assets`;
setAssets(ASSETS);
const BUCKET: Record<string, string> = { cookieyeti: "ig-staging", inventoryproof: "inventoryproof-social" };
const CODE: Record<string, "cy" | "ip"> = { cookieyeti: "cy", inventoryproof: "ip" };

// ── fonts + wasm, once per isolate ──────────────────────────────────────────
const FONT_FILES: Record<string, string> = {
  it500: "fonts/InterTight-500.ttf", it600: "fonts/InterTight-600.ttf", it700: "fonts/InterTight-700.ttf", it800: "fonts/InterTight-800.ttf",
  mr500: "fonts/Manrope-500.ttf", mr600: "fonts/Manrope-600.ttf", mr700: "fonts/Manrope-700.ttf", mr800: "fonts/Manrope-800.ttf",
  pf800: "fonts/PlayfairDisplay-800.ttf",
};
const fontCache: Record<string, Promise<ArrayBuffer>> = {};
function font(key: string) {
  if (!fontCache[key]) fontCache[key] = fetch(`${ASSETS}/${FONT_FILES[key]}`).then((r) => { if (!r.ok) throw new Error("font " + key + " " + r.status); return r.arrayBuffer(); });
  return fontCache[key];
}
let wasmReady: Promise<void> | null = null;
function ensureWasm() {
  if (!wasmReady) wasmReady = fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm").then((r) => initWasm(r));
  return wasmReady;
}
async function fontsFor(b: "cy" | "ip") {
  const spec = b === "cy"
    ? [["InterTight", 500, "it500"], ["InterTight", 600, "it600"], ["InterTight", 700, "it700"], ["InterTight", 800, "it800"], ["Playfair", 800, "pf800"]]
    : [["Manrope", 500, "mr500"], ["Manrope", 600, "mr600"], ["Manrope", 700, "mr700"], ["Manrope", 800, "mr800"]];
  return Promise.all(spec.map(async ([name, weight, key]) => ({ name: name as string, weight: weight as number, style: "normal" as const, data: await font(key as string) })));
}

async function renderJpg(b: "cy" | "ip", card: Card): Promise<Uint8Array> {
  await ensureWasm();
  const fonts = await fontsFor(b);
  if (card.pose && !/^[a-z0-9-]{3,48}$/.test(card.pose)) throw new Error("bad pose");
  if (!KINDS[b].includes(card.kind)) throw new Error(`bad kind "${card.kind}" for ${b}`);
  // deno-lint-ignore no-explicit-any
  const svg = await satori((b === "cy" ? cy(card) : ip(card)) as any, { width: W, height: H, fonts });
  // Instagram's publishing API takes JPEG for images, so the raster goes
  // through a JPEG encoder rather than out as PNG (~220 ms at this size).
  const raster = new Resvg(svg, { fitTo: { mode: "width", value: W }, background: "#000000" }).render();
  const rgba = raster.pixels;
  const jpg = jpegEncode({ data: rgba, width: raster.width, height: raster.height }, 90);
  return new Uint8Array(jpg.data);
}

// Render every card of a post as slides 1..n and store them in the brand's
// bucket. The stored URL is what social_posts will point at.
async function renderAll(brand: string, b: "cy" | "ip", slug: string, cards: Card[]) {
  const n = cards.length, urls: string[] = [], ms: number[] = [];
  const bucket = BUCKET[brand];
  for (let k = 0; k < n; k++) {
    const t0 = Date.now();
    const jpg = await renderJpg(b, { ...cards[k], i: k + 1, n });
    ms.push(Date.now() - t0);
    const path = n === 1 ? `social/${brand}/${slug}.jpg` : `social/${brand}/${slug}-${String(k + 1).padStart(2, "0")}.jpg`;
    const { error } = await db.storage.from(bucket).upload(path, jpg, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" });
    if (error) throw new Error(`store ${path}: ${error.message}`);
    urls.push(`${SB}/storage/v1/object/public/${bucket}/${path}`);
  }
  return { urls, ms };
}

async function staffOk(token: string) {
  if (!token) return null;
  const { data } = await db.rpc("studio_resolve_staff", { p_token: token });
  const s = Array.isArray(data) ? data[0] : data;
  return s?.id ? s : null;
}
// Server-side callers: pg_cron / invoke_edge_function send the vault's proxy
// key in x-proxy-key (checked against the vault through a service-role-only
// RPC, so the key never appears in this file) or the service-role bearer.
async function serviceRole(req: Request) {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (isSvc(req)) return true;
  const parts = bearer.split(".");
  if (parts.length === 3) {
    try { const s = parts[1].replace(/-/g, "+").replace(/_/g, "/"); if (JSON.parse(atob(s + "=".repeat((4 - s.length % 4) % 4))).role === "service_role") return true; } catch { /* not a jwt */ }
  }
  const k = req.headers.get("x-proxy-key") || "";
  if (!k) return false;
  const { data } = await db.rpc("internal_proxy_key_ok", { p_key: k });
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const staff = await staffOk(req.headers.get("x-staff-token") || "");
  if (!(await serviceRole(req)) && !staff) return J({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  const action = String(body.action ?? "render");
  try {
    if (action === "health") {
      const t0 = Date.now(); await ensureWasm(); await fontsFor("cy"); await fontsFor("ip");
      return J({ ok: true, ms: Date.now() - t0, kinds: KINDS, grounds: { cy: Object.keys(GROUNDS.cy), ip: Object.keys(GROUNDS.ip) }, accents: { ip: Object.keys(ACCENT.ip) } });
    }
    const brand = String(body.brand ?? "");
    const b = CODE[brand];
    if (!b) return J({ ok: false, error: "brand must be cookieyeti or inventoryproof" }, 400);

    if (action === "preview") {
      const card = { i: 1, n: 1, ...(body.card as Card) };
      const t0 = Date.now();
      const png = await renderJpg(b, card);
      return new Response(png, { headers: { ...cors, "Content-Type": "image/jpeg", "X-Render-Ms": String(Date.now() - t0), "Cache-Control": "no-store" } });
    }

    if (action === "render") {
      const slug = String(body.slug ?? "");
      if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return J({ ok: false, error: "slug: lower case, digits, hyphens" }, 400);
      const cards = (body.cards as Card[]) ?? [];
      if (!cards.length || cards.length > 10) return J({ ok: false, error: "1 to 10 cards" }, 400);
      if (body.dry) {
        const jpg = await renderJpg(b, { ...cards[0], i: 1, n: cards.length });
        return new Response(jpg, { headers: { ...cors, "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
      }
      const r = await renderAll(brand, b, slug, cards);
      return J({ ok: true, brand, slug, ...r, by: staff ? staff.slug : "service" });
    }

    // The daily job. Ask the bank what fits next, render it, commit it as one
    // scheduled post. Repeats up to per_run times or until the runway target
    // is met. Every gate (approved, claim rules, five-dimension check) is in
    // the database; this is only the hands.
    if (action === "queue_next") {
      if (staff && !staff.can_promote) return J({ ok: false, error: "not_permitted" }, 403);
      const { data: st } = await db.from("social_brand_settings").select("per_run,enabled").eq("brand", brand).maybeSingle();
      if (!st || !st.enabled) return J({ ok: false, error: "brand_disabled" }, 409);
      const limit = Math.min(Number(body.limit ?? st.per_run ?? 2), 5);
      const results: unknown[] = [];
      // Outcome is written back onto the newest open social_bank_log row for
      // this brand, so Studio reads status from our own table instead of
      // joining pg_net's unindexed response table (which timed out).
      const done = async (status: number, note: string) => {
        const { data: open } = await db.from("social_bank_log").select("id").eq("brand", brand).is("status", null)
          .order("id", { ascending: false }).limit(1).maybeSingle();
        if (open) await db.from("social_bank_log").update({ status, note, finished_at: new Date().toISOString() }).eq("id", open.id);
      };
      try {
        for (let k = 0; k < limit; k++) {
          const { data: nx, error: e1 } = await db.rpc("social_bank_next", { p_brand: brand });
          if (e1) throw new Error("bank_next: " + e1.message);
          if (!nx?.ok) { results.push({ stop: nx }); break; }
          const row = nx.row;
          let rendered: { urls: string[]; ms: number[] };
          try { rendered = await renderAll(brand, b, String(row.slug), row.cards as Card[]); }
          catch (e) { results.push({ slug: row.slug, error: "render: " + (e as Error).message }); break; }
          const { data: c, error: e2 } = await db.rpc("social_bank_commit", { p_bank_id: row.id, p_media_urls: rendered.urls, p_slot: nx.slot });
          if (e2) throw new Error("bank_commit: " + e2.message);
          results.push({ slug: row.slug, slot: nx.slot, ms: rendered.ms, commit: c });
          if (!c?.ok) break;
        }
      } catch (e) {
        await done(500, String((e as Error).message ?? e));
        throw e;
      }
      const queued = results.filter((r) => (r as { commit?: { ok?: boolean } }).commit?.ok).length;
      const firstErr = results.map((r) => (r as { error?: string }).error).find(Boolean);
      const stop = results.map((r) => (r as { stop?: { error?: string; reason?: string } }).stop).find(Boolean);
      await done(firstErr ? 500 : 200, firstErr ?? `${queued} queued` + (stop ? ` · ${stop.error ?? stop.reason ?? "stopped"}` : ""));
      return J({ ok: true, brand, results, by: staff ? staff.slug : "service" });
    }

    return J({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return J({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
