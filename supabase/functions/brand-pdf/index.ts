// brand-pdf — her brand guide, as a file she can keep.
//
// Two callers, one code path:
//   client (her board token)              -> her own guide
//   staff  (studio token + client_slug)   -> the same guide, for us
//
// The answers already live behind brand_guide_form, so this function does no
// reading of its own beyond the pictures: it asks the same RPC her board asks,
// and draws the result. One source of truth, so the PDF cannot drift from the
// screen she filled in.
//
// Drawn, not screenshotted: real text, selectable and searchable, at a size
// that prints. pdf-lib's standard fonts mean nothing to embed and nothing to
// download at request time.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, rgb } from "https://esm.sh/pdf-lib@1.17.1";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

// ── page furniture ────────────────────────────────────────────────────────
const A4 = [595.28, 841.89] as const;
const M = 56;                       // margin
const W = A4[0] - M * 2;            // text column
const INK = rgb(0.08, 0.13, 0.12);
const DIM = rgb(0.42, 0.46, 0.45);
const FAINT = rgb(0.63, 0.67, 0.66);
const RULE = rgb(0.85, 0.87, 0.86);
const WASH = rgb(0.95, 0.965, 0.96);

const hexRGB = (h: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
// pdf-lib's standard fonts are WinAnsi: a smart quote or an em dash she typed
// on a phone would throw, so fold the handful that actually turn up.
const plain = (s: unknown) =>
  String(s ?? "")
    .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/ /g, " ").replace(/[​-‍﻿]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

serveIt();

function serveIt() {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    try {
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      const url = new URL(req.url);
      const token = String(body.token ?? url.searchParams.get("c") ?? "");
      const staff = String(body.staff_token ?? "");
      const slug = String(body.client_slug ?? "");

      let clientToken = token;
      if (!clientToken && staff) {
        const { data: s } = await db.rpc("studio_resolve_staff", { p_token: staff });
        const who = Array.isArray(s) ? s[0] : s;
        if (!who?.id) return J({ ok: false, error: "not_found" }, 401);
        const { data: c } = await db.from("approval_clients").select("access_token").eq("slug", slug).maybeSingle();
        if (!c?.access_token) return J({ ok: false, error: "no_client" }, 404);
        clientToken = c.access_token as string;
      }
      if (!clientToken) return J({ ok: false, error: "token required" }, 400);

      const { data, error } = await db.rpc("brand_guide_form", { p_token: clientToken });
      const form = data as Record<string, any>;
      if (error) return J({ ok: false, error: error.message }, 500);
      if (!form?.ok) return J({ ok: false, error: "not_found" }, 401);

      const pdf = await draw(form);
      const name = `${String(form.client?.slug ?? "brand")}-brand-guide.pdf`;
      return new Response(pdf, {
        headers: {
          ...CORS,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      console.error("brand-pdf", e instanceof Error ? e.message : String(e));
      return J({ ok: false, error: "could not build the PDF" }, 500);
    }
  });
}

async function draw(form: Record<string, any>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // the standard-14 names, written out: the StandardFonts enum does not
  // survive the esm.sh build, and these strings are what it holds anyway
  const serif = await doc.embedFont("Times-Roman");
  const serifB = await doc.embedFont("Times-Bold");
  const sans = await doc.embedFont("Helvetica");
  const sansB = await doc.embedFont("Helvetica-Bold");
  const sansO = await doc.embedFont("Helvetica-Oblique");

  const name = plain(form.client?.name || "Your brand");
  const qs: Record<string, any>[] = (form.questions || []).filter((q: any) =>
    (q.answer && String(q.answer).trim()) || (q.chosen && q.chosen.length) || (q.files && q.files.length)
  );
  // the colors drive the cover, so find them before anything is drawn
  const colors: { hex: string; label: string }[] =
    ((form.questions || []).find((q: any) => q.kind === "colors")?.chosen || [])
      .map((x: string) => { const [hex, label] = String(x).split("|"); return { hex: (hex || "").toUpperCase(), label: label || "" }; })
      .filter((c: { hex: string }) => !!hexRGB(c.hex));

  let page = doc.addPage([...A4]);
  let y = 0;

  const newPage = () => { page = doc.addPage([...A4]); y = A4[1] - M; };
  const room = (need: number) => { if (y - need < M + 28) newPage(); };

  const wrap = (text: string, font: any, size: number, width = W): string[] => {
    const out: string[] = [];
    for (const para of plain(text).split(/\n/)) {
      if (!para.trim()) { out.push(""); continue; }
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; }
        else line = next;
      }
      if (line) out.push(line);
    }
    return out;
  };
  const para = (text: string, font: any, size: number, color = INK, lead = 1.45, x = M, width = W) => {
    for (const line of wrap(text, font, size, width)) {
      room(size * lead);
      if (line) page.drawText(line, { x, y, size, font, color });
      y -= size * lead;
    }
  };

  // ── cover ───────────────────────────────────────────────────────────────
  y = A4[1] - 150;
  page.drawText("BESTLY  |  STUDIO", { x: M, y: A4[1] - 62, size: 9, font: sansB, color: FAINT });
  para(name, serifB, 34, INK, 1.18);
  y -= 6;
  para("Brand guide", serif, 20, DIM, 1.2);
  y -= 18;
  para(
    "Your answers, in your words. This is what every post, caption and carousel we make for you is built from.",
    sans, 11.5, DIM, 1.5, M, W * 0.78,
  );
  y -= 26;

  if (colors.length) {
    const sw = Math.min(78, (W - (colors.length - 1) * 10) / Math.max(colors.length, 1));
    let x = M;
    for (const c of colors.slice(0, 6)) {
      page.drawRectangle({ x, y: y - sw, width: sw, height: sw, color: hexRGB(c.hex)!, borderColor: RULE, borderWidth: 0.5 });
      page.drawText(plain(c.label || c.hex), { x, y: y - sw - 13, size: 8, font: sansB, color: DIM });
      page.drawText(c.hex, { x, y: y - sw - 23, size: 7.5, font: sans, color: FAINT });
      x += sw + 10;
    }
    y -= sw + 44;
  }

  const when = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  page.drawLine({ start: { x: M, y: M + 52 }, end: { x: M + W, y: M + 52 }, thickness: 0.75, color: RULE });
  page.drawText(`${form.done} of ${form.total} questions answered  ·  ${when}`,
    { x: M, y: M + 34, size: 9, font: sans, color: FAINT });

  // ── the answers ─────────────────────────────────────────────────────────
  newPage();
  for (const q of qs) {
    room(74);
    y -= 8;
    page.drawLine({ start: { x: M, y: y + 10 }, end: { x: M + W, y: y + 10 }, thickness: 0.75, color: RULE });
    y -= 8;
    para(q.prompt, serifB, 15, INK, 1.3);
    y -= 6;

    if (q.kind === "colors") {
      const cs = (q.chosen || []).map((x: string) => { const [hex, l] = String(x).split("|"); return { hex: (hex || "").toUpperCase(), label: l || "" }; });
      for (const c of cs) {
        const col = hexRGB(c.hex); if (!col) continue;
        room(26);
        page.drawRectangle({ x: M, y: y - 12, width: 16, height: 16, color: col, borderColor: RULE, borderWidth: 0.5 });
        page.drawText(plain(c.label || c.hex), { x: M + 24, y: y - 8, size: 11, font: sansB, color: INK });
        page.drawText(c.hex, { x: M + 24 + Math.max(90, sansB.widthOfTextAtSize(plain(c.label || c.hex), 11) + 14), y: y - 8, size: 10, font: sans, color: DIM });
        y -= 26;
      }
    } else if (q.kind === "fields") {
      const have = Object.fromEntries((q.chosen || []).map((x: string) => { const i = x.indexOf("="); return i > 0 ? [x.slice(0, i), x.slice(i + 1)] : [x, ""]; }));
      for (const o of (q.options || [])) {
        const v = have[o.key]; if (!v) continue;
        room(20);
        page.drawText(plain(o.label), { x: M, y, size: 10, font: sans, color: DIM });
        page.drawText(plain(v), { x: M + 150, y, size: 11, font: sansB, color: INK });
        y -= 19;
      }
    } else if (q.kind === "words") {
      const half = (W - 24) / 2;
      const use = (q.chosen || []).map(plain), avoid = (q.extra || []).map(plain);
      const rows = Math.max(use.length, avoid.length);
      room(24 + rows * 16);
      const lo = (q.options && !Array.isArray(q.options)) ? q.options : {};
      page.drawText(plain(lo.use || "Words we use").toUpperCase(), { x: M, y, size: 8.5, font: sansB, color: FAINT });
      page.drawText(plain(lo.avoid || "Words to avoid").toUpperCase(), { x: M + half + 24, y, size: 8.5, font: sansB, color: FAINT });
      y -= 16;
      for (let i = 0; i < rows; i++) {
        if (use[i]) page.drawText(use[i], { x: M, y, size: 11, font: sans, color: INK });
        if (avoid[i]) page.drawText(avoid[i], { x: M + half + 24, y, size: 11, font: sans, color: INK });
        y -= 16;
      }
    } else if ((q.chosen || []).length) {
      for (const c of q.chosen) { room(19); page.drawText("- " + plain(c), { x: M, y, size: 11.5, font: sans, color: INK }); y -= 19; }
      if (q.answer && String(q.answer).trim()) { y -= 4; para(q.answer, sans, 11.5, INK); }
    } else if (q.answer) {
      para(q.answer, sans, 11.5, INK);
    }

    if ((q.files || []).length) {
      y -= 4;
      const n = q.files.length;
      para(`${n} ${n === 1 ? "picture" : "pictures"} sent with this answer.`, sansO, 10, DIM);
    }
    if (q.has_audio) para("Answered out loud - the recording is in Studio.", sansO, 10, DIM);
    y -= 14;
  }

  if (!qs.length) {
    para("Nothing answered yet. Open your guide and the answers land here.", sansO, 12, DIM);
  }

  // ── what happens with it, then page numbers ─────────────────────────────
  room(120);
  y -= 10;
  const boxTop = y;
  page.drawRectangle({ x: M, y: y - 92, width: W, height: 92, color: WASH });
  y -= 20;
  page.drawText("WHAT THIS DOES", { x: M + 18, y, size: 8.5, font: sansB, color: FAINT });
  y -= 17;
  para(
    "Your colors and fonts set how your carousels are drawn. Your words, and the ones you told us to avoid, " +
    "go into the brief behind every caption. Anything you said you are required to include is checked on every " +
    "post before it reaches you. Change your mind about any of it - open the guide again and answer it differently.",
    sans, 10, DIM, 1.5, M + 18, W - 36,
  );
  y = boxTop - 104;

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (!i) return;
    p.drawText(`${plain(name)}  ·  brand guide`, { x: M, y: M - 22, size: 8, font: sans, color: FAINT });
    const n = `${i + 1} / ${pages.length}`;
    p.drawText(n, { x: M + W - sans.widthOfTextAtSize(n, 8), y: M - 22, size: 8, font: sans, color: FAINT });
  });

  doc.setTitle(`${name} - brand guide`);
  doc.setProducer("Bestly Studio");
  doc.setCreator("Bestly Studio");
  return await doc.save();
}
