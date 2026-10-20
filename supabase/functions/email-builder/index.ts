// email-builder — writes branded emails with FREE AI only (docs: Jared, 2026-10-19; plan in the email-builder branch).
//
//   op generate   {kit, request, recipient_name?, recipient_email?, subject_hint?}          -> {doc, warnings, model}
//   op revise     {kit, doc, instruction}                                                    -> {doc, warnings, model, changed}
//   op image      {kit, prompt}                                                              -> {url}
//   op export_eml {html, text, subject, to?, from?}                                          -> {eml, inlined}
//   any op accepts dry_run:true: no model, no image service, no storage; shows the prompt and runs the validator.
//
// Free only: _shared/free-llm.ts with paid:"never" (FreeLLM -> Cloudflare -> local; Gemini/OpenRouter stay out because the
// text is private). Images: Cloudflare Workers AI flux-1-schnell (free daily allowance), uploaded to the public
// email-assets bucket under builder/. Nothing here ever sends mail; email-builder-send does, after Jared's tap.
//
// Watchdog (house rule): all free rungs down or invalid JSON twice, an image failure, or an export failure raises
// bestly_raise('email-builder.*'), owned by Scout via notification_owners('email-builder'). Generation retries once.
//
// Auth: an admin JWT, or the service key (tests). verify_jwt = false because the new sb_secret keys are not JWTs.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm, LlmUnavailable } from "../_shared/free-llm.ts";
import { corsWith } from "../_shared/cors.ts";
import {
  buildEml, type Block, type EmailDoc, type Kit, type EmlImage, imageUrlsIn, kitUrls, lintDoc, normalizeDoc,
  resolveKit, rewriteImagesToCid, urlsIn, renderText,
} from "../_shared/email-render.ts";

const secretKeys = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const SECRET = secretKeys[0];
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, SECRET, { auth: { persistSession: false }, global: { headers: { apikey: SECRET } } });

const CORS = corsWith({ headers: "authorization, content-type, apikey, x-client-info", methods: "POST, OPTIONS" });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function authorized(req: Request): Promise<boolean> {
  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secretKeys.includes(apikey) || secretKeys.includes(bearer)) return true;
  if (!bearer || bearer.split(".").length !== 3) return false;
  const { data } = await db.auth.getUser(bearer);
  if (!data?.user) return false;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return !!ok;
}

/* ───────── watchdog + run log ───────── */

async function raise(key: "generate" | "image" | "export", title: string, body: string) {
  try {
    await db.rpc("bestly_raise", { p_key: `email-builder.${key}`, p_kind: "problem", p_severity: "warning", p_title: title, p_body: body.slice(0, 400), p_area: "email", p_healed: false });
  } catch { /* the alert path must never break the request */ }
}
async function heal(key: "generate" | "image" | "export", title: string) {
  try { await db.rpc("bestly_raise", { p_key: `email-builder.${key}`, p_kind: "resolved", p_title: title }); } catch { /* ignore */ }
}
async function runLog(op: string, kit: string | undefined, ok: boolean, ms: number, o: { provider?: string; model?: string; error?: string; meta?: unknown } = {}) {
  try { await db.from("email_builder_runs").insert({ op, kit: kit ?? null, ok, ms, provider: o.provider ?? null, model: o.model ?? null, error: o.error?.slice(0, 300) ?? null, meta: o.meta ?? null }); } catch { /* table may not exist yet */ }
}

/* ───────── kits ───────── */

async function loadKit(slug: string): Promise<Kit | null> {
  const { data, error } = await db.from("email_brand_kits").select("*").eq("active", true);
  if (error || !data) return null;
  const rows: Record<string, any> = Object.fromEntries(data.map((r: any) => [r.slug, r]));
  if (!rows[slug]) return null;
  return resolveKit(rows[slug], rows);
}

/* ───────── prompts ───────── */

const BLOCK_DOC = `Return ONLY one JSON object, no prose, no code fence:
{"subject":"...","preheader":"...","blocks":[ ... ]}
Block types (use "type" exactly as written):
  {"type":"eyebrow","text":"A few words, shown in capitals above the headline"}
  {"type":"headline","text":"One short headline"}
  {"type":"paragraph","text":"Plain text. **bold** for at most a few key words. A blank line is not needed; one block per paragraph."}
  {"type":"subheading","text":"A short label above a group of paragraphs, e.g. 1. Our call is on your board"}
  {"type":"list","items":["..."],"ordered":false}
  {"type":"button","label":"Open my board","url":"https://...","style":"solid"}   (style "outline" for a second, quieter button)
  {"type":"callout","title":"optional","text":"A short boxed note"}
  {"type":"image","kind":"asset","asset_key":"<one of the picture keys below>","alt":"what the picture shows"}
  {"type":"image","kind":"ai","prompt":"what to draw, in plain words","alt":"what the picture shows"}
  {"type":"divider"}
  {"type":"signature"}
  {"type":"product_ads","keys":["<ad key>"],"variant":"soft"}`;

function systemPrompt(kit: Kit, mode: "write" | "revise"): string {
  const ads = (kit.product_ads?.items ?? []).map((a) => `  - ${a.key}: ${a.name} - ${a.blurb}`).join("\n") || "  (none)";
  const assets = Object.entries(kit.assets ?? {}).map(([k, a]) => `  - ${k}: ${a.label ?? a.alt}`).join("\n") || "  (none)";
  const policy = kit.ad_policy?.mode ?? "auto";
  const adRule = policy === "never" ? "Do NOT add a product_ads block."
    : policy === "ensure" ? `Add exactly one product_ads block with variant "soft" and ONE key from the list, placed right before the signature. Keep it a quiet one-line mention.`
    : `If the email goes to a customer or client (not to Jared himself) and one product below genuinely helps that reader, add ONE product_ads block with variant "soft" and one key, right before the signature. Tasteful, never pushy. If nothing fits, leave it out.`;
  return `You write emails for ${kit.name}. ${kit.voice ?? ""}

${mode === "revise" ? "You are given the CURRENT email as JSON and an instruction. Return the whole email again with only the change asked for; keep every block, id and link you were not asked to change.\n" : ""}${BLOCK_DOC}

Writing rules (these matter most):
- Write for the least-informed reader. It must be obvious what this is, why they got it, and what to do next. Short sentences. No jargon, no hype.
- Order: optional eyebrow, headline, a greeting paragraph ("Hi Name,"), the message, a sign-off paragraph ("Thanks," or "See you tomorrow,"), then {"type":"signature"} as the LAST block (before an ad).
- Keep it short. A normal email is 3 to 6 paragraphs. Numbered or bold subheadings only when there are 2 or more separate things.
- Buttons: the label says what happens ("Open my board", "Join the call"). Say what a button does in the line before it. Use ONLY links that appear in the REQUEST (or in the current email). Never invent a link. If a button was asked for and no link was given, leave the button out.
- No emoji, ever. Times are 12-hour like 3:05 PM. Distances and temperatures are US units (miles, feet, °F). Write "9 MB" with a space between a number and its unit.
- Pictures: use an asset picture only if it helps. ${kit.ai_images === "never" ? "This brand does NOT use AI pictures: never use kind ai." : "Use kind ai only if the request asks for a picture or the email clearly needs one; one at most; the prompt describes a calm illustration with no text in it."}
- ${adRule}
- Never put a secret, password or private token in the email text.

Picture keys you may use:
${assets}

Product ad keys:
${ads}
${kit.default_eyebrow ? `\nDefault eyebrow when one fits: "${kit.default_eyebrow}".` : ""}`;
}

function userPayload(o: { request: string; recipient_name?: string; recipient_email?: string; subject_hint?: string; doc?: EmailDoc; instruction?: string }) {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return JSON.stringify({
    today,
    ...(o.request ? { REQUEST: o.request } : {}),
    ...(o.recipient_name || o.recipient_email ? { recipient: { name: o.recipient_name || undefined, email: o.recipient_email || undefined } } : {}),
    ...(o.subject_hint ? { subject_hint: o.subject_hint } : {}),
    ...(o.doc ? { CURRENT_EMAIL: { subject: o.doc.subject, preheader: o.doc.preheader, blocks: o.doc.blocks } } : {}),
    ...(o.instruction ? { INSTRUCTION: o.instruction } : {}),
  });
}

/* ───────── generation (with one automatic retry) ───────── */

interface GenOut { doc: EmailDoc; warnings: string[]; model: string; provider: string; tried: unknown[]; attempts: number }

async function generate(kit: Kit, o: { request: string; recipient_name?: string; recipient_email?: string; subject_hint?: string; doc?: EmailDoc; instruction?: string }): Promise<GenOut> {
  const mode = o.doc ? "revise" : "write";
  const system = systemPrompt(kit, mode);
  const allowed = [...urlsIn(o.request ?? ""), ...urlsIn(o.instruction ?? ""), ...kitUrls(kit),
    ...((o.doc?.blocks ?? []).flatMap((b) => [(b as any).url, (b as any).button?.url, (b as any).link].filter(Boolean) as string[]))];
  let hint = "";
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await llm({
        task: "write", system: system + hint, user: userPayload(o), json: true, maxTokens: 3200,
        job: "email-builder", fn: "email-builder", scope: "chat", privacy: "private", paid: "never", deadlineMs: 70_000,
        validate: (j) => { const n = normalizeDoc(j, { kit, allowedUrls: allowed }); return n.problems.length ? n.problems.join(", ") : null; },
      });
      const n = normalizeDoc(r.json, { kit, allowedUrls: allowed });
      if (n.problems.length) throw new Error("invalid: " + n.problems.join(", "));
      // keep a revised email's old links on blocks the model re-emitted
      return { doc: n.doc, warnings: [...n.warnings, ...lintDoc(n.doc)], model: r.model, provider: r.provider, tried: r.tried, attempts: attempt };
    } catch (e) {
      lastErr = e instanceof LlmUnavailable ? `${e.reason}: ${e.tried.map((t) => `${t.provider}/${t.model}:${t.outcome}`).join(", ")}` : (e as Error).message;
      hint = `\n\nYour last answer was rejected (${lastErr.slice(0, 160)}). Return the JSON object only, with a headline block and at least one paragraph block.`;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(lastErr || "generation failed");
}

/** Compare two emails by what a reader sees, ignoring block ids and whitespace noise. */
function docSig(d: { subject?: string; preheader?: string; blocks?: unknown[] }): string {
  const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  return JSON.stringify({
    s: norm(d.subject), p: norm(d.preheader),
    b: (d.blocks ?? []).map((x) => {
      const b = x as Record<string, unknown>;
      return [b.type, norm(b.text), norm(b.label), norm(b.url), norm(b.title), norm(b.style), norm(b.variant), norm(b.asset_key), norm(b.prompt), norm(b.alt),
        Array.isArray(b.items) ? b.items.map(norm) : [], Array.isArray(b.keys) ? b.keys.map(norm) : []];
    }),
  });
}

/* ───────── pictures (Cloudflare Workers AI, free allowance) ───────── */

const IMG_DAILY_CAP = 25;
const IMG_MODELS = ["@cf/black-forest-labs/flux-1-schnell", "@cf/bytedance/stable-diffusion-xl-lightning", "@cf/stabilityai/stable-diffusion-xl-base-1.0"];

async function imagesToday(): Promise<number> {
  try {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { count } = await db.from("email_builder_runs").select("id", { count: "exact", head: true }).eq("op", "image").eq("ok", true).gte("created_at", since.toISOString());
    return count ?? 0;
  } catch { return 0; }
}

function b64ToBytes(b: string): Uint8Array { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

async function makeImage(kit: Kit | null, prompt: string): Promise<{ url: string; model: string; bytes: number }> {
  if (kit?.ai_images === "never") throw new Error("This brand does not use AI pictures.");
  if ((await imagesToday()) >= IMG_DAILY_CAP) throw new Error(`Daily free picture limit reached (${IMG_DAILY_CAP}). Try again tomorrow or use a brand picture.`);
  const { data: k } = await db.rpc("llm_keys");
  const acct = String((k as any)?.cloudflare_account_id ?? "").match(/[0-9a-f]{32}/)?.[0];
  const tok = String((k as any)?.cloudflare_ai_token ?? "").trim();
  if (!acct || !tok) throw new Error("no Cloudflare Workers AI key on file");
  const full = `${prompt.trim().slice(0, 400)}. Soft editorial illustration, calm and clean, plenty of empty space, gentle light colors, no text, no letters, no logos, no real people's faces.`;
  const errs: string[] = [];
  for (const model of IMG_MODELS) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${model}`, {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify(model.includes("flux") ? { prompt: full, steps: 4 } : { prompt: full, num_steps: 8 }), signal: AbortSignal.timeout(45_000),
      });
      let bytes: Uint8Array | null = null, type = "image/png";
      const ct = r.headers.get("content-type") ?? "";
      if (r.ok && ct.startsWith("image/")) { bytes = new Uint8Array(await r.arrayBuffer()); type = ct.split(";")[0]; }
      else {
        const j = await r.json().catch(() => null);
        if (r.ok && j?.result?.image) { bytes = b64ToBytes(j.result.image); type = bytes[0] === 0x89 ? "image/png" : "image/jpeg"; }
        else errs.push(`${model.split("/").pop()} ${r.status} ${String(j?.errors?.[0]?.message ?? "").slice(0, 80)}`);
      }
      if (!bytes || bytes.length < 2000) continue;
      const ext = type === "image/png" ? "png" : "jpg";
      const path = `builder/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const up = await db.storage.from("email-assets").upload(path, bytes, { contentType: type, upsert: false });
      if (up.error) throw new Error("upload: " + up.error.message);
      return { url: `${SB_URL}/storage/v1/object/public/email-assets/${path}`, model, bytes: bytes.length };
    } catch (e) { errs.push(`${model.split("/").pop()} ${(e as Error).message.slice(0, 80)}`); }
  }
  throw new Error("every free picture model failed: " + errs.join("; "));
}

/** Fill in every ai image block that has a prompt but no url. Failures leave the block empty and say why. */
async function fillImages(kit: Kit, doc: EmailDoc, warnings: string[]): Promise<{ made: number; failed: number }> {
  let made = 0, failed = 0;
  for (const b of doc.blocks) {
    if (b.type !== "image" || b.kind !== "ai" || b.url || !b.prompt) continue;
    const t0 = Date.now();
    try {
      const im = await makeImage(kit, b.prompt);
      b.url = im.url; made++;
      await runLog("image", kit.slug, true, Date.now() - t0, { provider: "cloudflare", model: im.model, meta: { bytes: im.bytes } });
      await heal("image", "Email builder pictures working again");
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      warnings.push(`A picture could not be made (${msg.slice(0, 100)}). Pick one of the brand pictures or try again.`);
      await runLog("image", kit.slug, false, Date.now() - t0, { error: msg });
      await raise("image", "Email builder: free picture failed", `${msg}. The email was still written; the picture block is empty.`);
    }
  }
  return { made, failed };
}

/* ───────── .eml export ───────── */

const IMG_HOSTS = /^(www\.)?bestly\.tech$|^studio\.bestly\.tech$|^cloud\.bestly\.tech$|^rcqfqhguwpmaarseifqg\.supabase\.co$|^(www\.)?inventoryproof\.com$/i;

async function exportEml(i: { html: string; text: string; subject: string; to?: string; from?: string }) {
  const urls = imageUrlsIn(i.html).filter((u) => { try { const x = new URL(u); return x.protocol === "https:" && IMG_HOSTS.test(x.hostname); } catch { return false; } }).slice(0, 12);
  const images: EmlImage[] = [], map: Record<string, string> = {}, skipped: string[] = [];
  await Promise.all(urls.map(async (u, n) => {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
      const ct = (r.headers.get("content-type") ?? "").split(";")[0];
      if (!r.ok || !ct.startsWith("image/")) throw new Error(`${r.status} ${ct}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length > 5_000_000) throw new Error("over 5 MB");
      const cid = `img${n + 1}.${Math.random().toString(36).slice(2, 8)}@bestly.tech`;
      map[u] = cid;
      images.push({ cid, contentType: ct, data: buf, filename: u.split("/").pop()?.split("?")[0] || `image${n + 1}` });
    } catch (e) { skipped.push(`${u} (${(e as Error).message})`); }
  }));
  const eml = buildEml({ from: i.from || "Jared Best <jared@bestly.tech>", to: i.to, subject: i.subject, html: rewriteImagesToCid(i.html, map), text: i.text, images });
  return { eml, inlined: images.length, skipped };
}

/* ───────── http ───────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await authorized(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { return J({ ok: false, error: "json" }, 400); }
  const op = String(b.op ?? "");
  const dry = b.dry_run === true;
  const t0 = Date.now();
  try {
    if (op === "export_eml") {
      const html = String(b.html ?? "");
      if (!html || html.length > 1_500_000) return J({ ok: false, error: "html missing or too large" }, 400);
      if (dry) return J({ ok: true, dry_run: true, would_inline: imageUrlsIn(html).length });
      try {
        const out = await exportEml({ html, text: String(b.text ?? ""), subject: String(b.subject ?? "").slice(0, 200), to: b.to ? String(b.to).slice(0, 300) : undefined, from: b.from ? String(b.from).slice(0, 200) : undefined });
        await runLog("export", undefined, true, Date.now() - t0, { meta: { inlined: out.inlined, skipped: out.skipped.length } });
        return J({ ok: true, ...out });
      } catch (e) {
        await runLog("export", undefined, false, Date.now() - t0, { error: (e as Error).message });
        await raise("export", "Email builder: could not build the .eml", (e as Error).message);
        return J({ ok: false, error: (e as Error).message }, 200);
      }
    }

    const kit = await loadKit(String(b.kit ?? ""));
    if (!kit) return J({ ok: false, error: `unknown brand kit "${b.kit}"` }, 404);

    if (op === "image") {
      const prompt = String(b.prompt ?? "").trim();
      if (!prompt) return J({ ok: false, error: "prompt required" }, 400);
      if (dry) return J({ ok: true, dry_run: true, models: IMG_MODELS, left_today: IMG_DAILY_CAP - (await imagesToday()) });
      try {
        const im = await makeImage(kit, prompt);
        await runLog("image", kit.slug, true, Date.now() - t0, { provider: "cloudflare", model: im.model });
        await heal("image", "Email builder pictures working again");
        return J({ ok: true, ...im });
      } catch (e) {
        await runLog("image", kit.slug, false, Date.now() - t0, { error: (e as Error).message });
        await raise("image", "Email builder: free picture failed", (e as Error).message);
        return J({ ok: false, error: (e as Error).message }, 200);
      }
    }

    if (op === "generate" || op === "revise") {
      const request = String(b.request ?? "").trim();
      const doc: EmailDoc | undefined = op === "revise" ? { subject: String(b.doc?.subject ?? ""), preheader: b.doc?.preheader, blocks: Array.isArray(b.doc?.blocks) ? b.doc.blocks as Block[] : [] } : undefined;
      if (op === "generate" && request.length < 3) return J({ ok: false, error: "tell me what the email should say" }, 400);
      if (op === "revise" && (!doc || !String(b.instruction ?? "").trim())) return J({ ok: false, error: "doc and instruction required" }, 400);
      const input = { request, recipient_name: b.recipient_name, recipient_email: b.recipient_email, subject_hint: b.subject_hint, doc, instruction: b.instruction ? String(b.instruction).slice(0, 800) : undefined };
      if (dry) {
        // No model call: show the prompt and push a canned model answer through the validator and renderer's repair step.
        const mock = b.mock ?? { subject: "Dry run", blocks: [{ type: "headline", text: "Dry run" }, { type: "paragraph", text: "Hello." }] };
        const n = normalizeDoc(mock, { kit, allowedUrls: [...urlsIn(request), ...urlsIn(String(b.instruction ?? ""))] });
        return J({ ok: true, dry_run: true, system_chars: systemPrompt(kit, doc ? "revise" : "write").length, user: JSON.parse(userPayload(input)), normalized: n.doc, warnings: n.warnings, problems: n.problems, text: renderText(kit, n.doc) });
      }
      let out: GenOut;
      try {
        out = await generate(kit, input);
      } catch (e) {
        const msg = (e as Error).message;
        await runLog(op, kit.slug, false, Date.now() - t0, { error: msg });
        await raise("generate", "Email builder: the free AI could not write the email", `${msg}. Tried the free ladder twice. Nothing was sent.`);
        return J({ ok: false, error: "The free AI is busy or answered badly twice. Nothing was lost. Try again in a minute.", detail: msg }, 200);
      }
      // revise: free models sometimes hand the email back untouched. Retry once, harder; if still the same, say so.
      let changed: boolean | undefined;
      let retried = false;
      if (op === "revise" && doc) {
        const before = docSig(doc);
        changed = docSig(out.doc) !== before;
        if (!changed) {
          retried = true;
          try {
            const again = await generate(kit, { ...input, instruction: "The previous attempt returned the email unchanged. You MUST apply this change visibly: " + String(input.instruction ?? "") });
            if (docSig(again.doc) !== before) { out = again; changed = true; }
          } catch { /* keep the first answer; changed stays false */ }
        }
      }
      const warnings = [...out.warnings];
      const pics = await fillImages(kit, out.doc, warnings);
      await runLog(op, kit.slug, true, Date.now() - t0, { provider: out.provider, model: out.model, meta: { attempts: out.attempts, blocks: out.doc.blocks.length, pictures: pics, ...(changed === undefined ? {} : { changed, retried }) } });
      await heal("generate", "Email builder writing again");
      return J({ ok: true, doc: out.doc, warnings, model: out.model, provider: out.provider, attempts: out.attempts, pictures: pics, ...(changed === undefined ? {} : { changed }) });
    }
    return J({ ok: false, error: "op must be generate, revise, image or export_eml" }, 400);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});
