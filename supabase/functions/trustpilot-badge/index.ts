// trustpilot-badge — bestly.tech/r/badge.png, the live Trustpilot rating
// badge for Jared's email signature. Renders a small transparent PNG from
// trustpilot_stats (filled by the Pi's IMAP reader off Trustpilot's own
// "new review" emails — no scraping, no paid TrustBox). Bestly-drawn stars
// only: no Trustpilot logo or star art anywhere in this file.
//
// GET /trustpilot-badge -> image/png, Cache-Control: max-age=3600.
// On a DB failure, serves the last good PNG stored in email-assets/trustpilot/
// so a signature never shows a broken image. See bestly_memory
// plan/trustpilot-email-signature-2026-10-17 for the full plan.

import satori from "npm:satori@0.12.1";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

// Dimensions per plan: drawn at 2x retina, displayed at 300x60.
const W = 600, H = 120;
const NAVY = "rgb(15,33,51)";
const ACCENT = "rgb(76,95,201)";

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

// deno-lint-ignore no-explicit-any
const h = (type: string, props: Record<string, any> | null, ...children: any[]) => {
  const kids = children.filter((c) => c != null && c !== false);
  const p: Record<string, any> = { ...(props || {}) };
  if (kids.length === 1) p.children = kids[0];
  else if (kids.length > 1) p.children = kids;
  return { type, props: p };
};

// A single Bestly-drawn five-point star. `fill` 0..1 is how much of it is
// filled, drawn as a clipped overlay rather than any third-party star glyph.
function Star(fill: number, size: number) {
  const path = "M12 1.6l3.09 6.26 6.91 1-5 4.87 1.18 6.88L12 17.3l-6.18 3.31L7 13.73l-5-4.87 6.91-1z";
  const pct = Math.max(0, Math.min(1, fill)) * 100;
  return h("div", { style: { position: "relative", width: size, height: size, display: "flex" } },
    h("svg", { width: size, height: size, viewBox: "0 0 24 24", style: { position: "absolute", left: 0, top: 0 } },
      h("path", { d: path, fill: "rgba(15,33,51,0.18)" })),
    h("div", { style: { position: "absolute", left: 0, top: 0, width: size, height: size, overflow: "hidden", display: "flex" } },
      h("div", { style: { width: `${pct}%`, height: size, display: "flex" } },
        h("svg", { width: size, height: size, viewBox: "0 0 24 24" },
          h("path", { d: path, fill: ACCENT })))));
}

function Stars(avg: number, size = 22) {
  const stars = [];
  for (let i = 0; i < 5; i++) stars.push(Star(Math.max(0, Math.min(1, avg - i)), size));
  return h("div", { style: { display: "flex", gap: 3, alignItems: "center" } }, ...stars);
}

// Badge content. No box, no hard edges — the "feathered" look the signature
// calls for comes from having nothing but soft type and the stars, not from
// a pill or border that would need blurring.
function Badge(stats: { avg: number | null; count: number } | null) {
  const hasReviews = !!stats && stats.count > 0;
  const label = !hasReviews
    ? "Be our first review on Trustpilot"
    : null;
  return h("div", { style: {
    width: W, height: H, display: "flex", alignItems: "center", gap: 14,
    fontFamily: "InterTight", padding: "0 8px",
  } },
    hasReviews ? Stars(stats!.avg ?? 0) : null,
    h("div", { style: { display: "flex", flexDirection: "column", justifyContent: "center" } },
      hasReviews
        ? h("div", { style: { display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" } },
            h("span", { style: { fontSize: 30, fontWeight: 700, color: NAVY } }, String(stats!.avg)),
            h("span", { style: { fontSize: 18, fontWeight: 600, color: NAVY, opacity: 0.85 } }, "average"))
        : h("span", { style: { fontSize: 22, fontWeight: 700, color: NAVY } }, label),
      hasReviews
        ? h("span", { style: { fontSize: 18, fontWeight: 600, color: NAVY, opacity: 0.7, marginTop: 2 } },
            `${stats!.count} review${stats!.count === 1 ? "" : "s"} on Trustpilot`)
        : h("span", { style: { fontSize: 16, fontWeight: 600, color: NAVY, opacity: 0.7, marginTop: 2 } }, "trustpilot.com")));
}

async function renderPng(stats: { avg: number | null; count: number } | null): Promise<Uint8Array> {
  await ensureWasm();
  const f = await fonts();
  // deno-lint-ignore no-explicit-any
  const svg = await satori(Badge(stats) as any, { width: W, height: H, fonts: f });
  const raster = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render();
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
    const stats = { avg: data?.avg_rating ?? null, count: data?.review_count ?? 0 };
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
