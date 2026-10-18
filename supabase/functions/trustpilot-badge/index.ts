// trustpilot-badge — bestly.tech/r/badge.png, the live Trustpilot rating
// badge for Jared's email signature. Renders a small transparent PNG from
// trustpilot_stats (filled by the Pi's IMAP reader off Trustpilot's own
// "new review" emails — no scraping, no paid TrustBox). v2 (2026-10-18): a
// small white pill with Trustpilot's OFFICIAL logo and star images (brand
// assets v4.1.0, unaltered); drawing code lives in badge.ts. 264x36 pt,
// rendered at 3x (792x108 px).
//
// GET /trustpilot-badge -> image/png, Cache-Control: max-age=3600.
// On a DB failure, serves the last good PNG stored in email-assets/trustpilot/
// so a signature never shows a broken image. See bestly_memory
// plan/trustpilot-email-signature-2026-10-17 for the full plan.

import satori from "npm:satori@0.12.1";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Badge, H_PT, PT, W_PT, starsKey, type Img, type Stats } from "./badge.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback. Same pattern
// as social-render — trustpilot_reviews has RLS on with no anon policies, so
// the service key must actually resolve or every read comes back empty.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB = Deno.env.get("SUPABASE_URL")!;
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(SB, SB_SECRET, { auth: { persistSession: false } });
const ASSETS = `${SB}/storage/v1/object/public/social-media/assets`;
const FALLBACK_BUCKET = "email-assets";
const FALLBACK_PATH = "trustpilot/badge-last-good.png";

// ── official Trustpilot brand assets (v4.1.0), used unaltered ──────────────
// Fetched from Trustpilot's CDN once per isolate; copies are kept in
// email-assets/trustpilot/brand/ and read from there if the CDN is down.
const TP = "https://cdn.trustpilot.net/brand-assets/4.1.0";
const assetCache: Record<string, Promise<Img>> = {};
function toImg(svgText: string): Img {
  const m = svgText.match(/viewBox="\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/);
  if (!m) throw new Error("no viewBox");
  const bytes = new TextEncoder().encode(svgText);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return { uri: "data:image/svg+xml;base64," + btoa(bin), aspect: Number(m[1]) / Number(m[2]) };
}
function brandAsset(cdnPath: string, name: string): Promise<Img> {
  if (!assetCache[name]) {
    assetCache[name] = (async () => {
      const store = db.storage.from(FALLBACK_BUCKET);
      try {
        const r = await fetch(`${TP}/${cdnPath}`);
        if (!r.ok) throw new Error("cdn " + r.status);
        const text = await r.text();
        const img = toImg(text);
        store.upload(`trustpilot/brand/${name}`, new Blob([text], { type: "image/svg+xml" }), { contentType: "image/svg+xml", upsert: true }).catch(() => {});
        return img;
      } catch (_e) {
        const { data, error } = await store.download(`trustpilot/brand/${name}`);
        if (error || !data) throw new Error("brand asset unavailable: " + name);
        return toImg(await data.text());
      }
    })();
    assetCache[name].catch(() => { delete assetCache[name]; });
  }
  return assetCache[name];
}

// ── fonts + wasm, once per isolate ──────────────────────────────────────────
const fontCache: Record<string, Promise<ArrayBuffer>> = {};
function font(file: string) {
  if (!fontCache[file]) {
    fontCache[file] = fetch(`${ASSETS}/${file}`).then((r) => {
      if (!r.ok) throw new Error("font " + file + " " + r.status);
      return r.arrayBuffer();
    });
  }
  return fontCache[file];
}
let wasmReady: Promise<void> | null = null;
function ensureWasm() {
  if (!wasmReady) wasmReady = fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm").then((r) => initWasm(r));
  return wasmReady;
}
async function fonts() {
  const spec: [string, number, string][] = [
    ["InterTight", 600, "fonts/InterTight-600.ttf"],
    ["InterTight", 700, "fonts/InterTight-700.ttf"],
  ];
  return Promise.all(spec.map(async ([name, weight, file]) => ({
    name, weight, style: "normal" as const, data: await font(file),
  })));
}

async function renderPng(stats: Stats): Promise<Uint8Array> {
  await ensureWasm();
  const hasReviews = !!stats && stats.count > 0;
  const [f, logo, stars] = await Promise.all([
    fonts(),
    brandAsset("logo-black.svg", "logo-black.svg"),
    hasReviews ? brandAsset(`stars/stars-${starsKey(stats!.avg)}.svg`, `stars-${starsKey(stats!.avg)}.svg`) : Promise.resolve(null),
  ]);
  const w = W_PT * PT, hgt = H_PT * PT;
  // deno-lint-ignore no-explicit-any
  const svg = await satori(Badge(stats, { logo, stars }) as any, { width: w, height: hgt, fonts: f });
  const raster = new Resvg(svg, { fitTo: { mode: "width", value: w } }).render();
  return raster.asPng();
}

async function fallbackPng(): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(FALLBACK_BUCKET).download(FALLBACK_PATH);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const headers = { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" };
  try {
    const { data, error } = await db.from("trustpilot_stats").select("avg_rating,review_count").maybeSingle();
    if (error) throw error;
    const stats: Stats = { avg: data?.avg_rating ?? null, count: data?.review_count ?? 0 };
    const png = await renderPng(stats);
    // Best-effort: keep the fallback fresh. Never let this fail the response.
    db.storage.from(FALLBACK_BUCKET).upload(FALLBACK_PATH, png, { contentType: "image/png", upsert: true }).catch(() => {});
    return new Response(png, { headers });
  } catch (_e) {
    const fb = await fallbackPng().catch(() => null);
    if (fb) return new Response(fb, { headers: { ...headers, "Cache-Control": "public, max-age=60" } });
    try {
      const png = await renderPng(null);
      return new Response(png, { headers: { ...headers, "Cache-Control": "public, max-age=60" } });
    } catch {
      return new Response("badge unavailable", { status: 503 });
    }
  }
});
