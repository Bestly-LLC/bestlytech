// recipe-parse — Basil reads a recipe from a photo or a link (Recipes tab "Snap to save"). Free AI only (paid: "never").
// Admin JWT or the service key (the Basil watchdog retries a stuck job with the service key).
// POST { job_id }           -> works a job made by recipe_parse_enqueue(kind, source)
// POST { kind, source }     -> makes the job itself, then works it
//   photo: source = "recipes/parse/<file>" in the private recipe-photos bucket; link: source = https URL
// Writes recipe_parse_jobs.result = { draft: RecipeDoc-shaped, review: string[] }. Nothing is saved to the library here:
// the page shows a review screen first, and recipe_save() runs only after the owner taps Save.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Self-contained on purpose (deployable through the Supabase MCP without the 100 KB _shared/free-llm.ts):
//  - text: calls the deployed free-llm function (op run, paid "never"), which is the same free ladder Scout uses
//  - photos: Groq's free Llama 4 vision models, same key store (llm_keys) and same ai_spend log as _shared/free-llm.ts llmVision
//  - there is no paid rung anywhere in this file
const SECRETS: string[] = (() => {
  const out: string[] = [];
  try { for (const v of Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const SECRET_KEY = SECRETS[0] ?? "";
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPA_URL, SECRET_KEY, { auth: { persistSession: false }, global: { headers: { apikey: SECRET_KEY } } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const isServiceRequest = async (req: Request) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  return SECRETS.includes(bearer) || SECRETS.includes(apikey);
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const CATEGORIES = ["Sauces & Pasta", "Ferments & Drinks", "Bread", "Sauces & Dressings", "Drinks", "Baking", "Mains", "Sides", "Breakfast", "Snacks", "Soups", "Desserts"];
const UNITS = ["cup", "tbsp", "tsp", "oz", "lb", "fl oz", "count", "egg", "clove", "pinch", "can", "stick"];

const SYSTEM = `You turn recipe text into clean JSON. Use US units (cups, tbsp, tsp, oz, lb, fl oz, °F). Convert grams and milliliters to the nearest sensible US unit and say so in "notes".
Return ONLY a JSON object, no commentary:
{"title": string, "category": one of ${JSON.stringify(CATEGORIES)}, "blurb": one plain sentence or "",
 "yield": {"amount": number, "unit": string}, "time": {"total_min": number|null, "prep_min": number|null},
 "ingredients": [{"name": string, "amount": number|null, "unit": one of ${JSON.stringify(UNITS)} or a short phrase like "to taste" or "optional" when amount is null, "optional": boolean, "note": string|null}],
 "steps": [{"title": string (2 to 4 words), "text": string, "timer_sec": number|null}],
 "tips": [string], "notes": [string describing anything you were unsure of, guessed, converted or could not read]}
Rules: amounts are decimal numbers (1/2 is 0.5). Never invent an ingredient or a step that is not in the text. If a number is unreadable use null and add a note. Put each ingredient's name without its amount. Steps are short imperative sentences; set timer_sec only when the step names a duration.`;

// ---- link fetching with a basic SSRF guard (public https only, 3 redirects, 1.5 MB, 12 s) ----
function publicHost(h: string): boolean {
  const host = h.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (host.includes(":") || host.startsWith("[")) return false;
  return host.includes(".");
}
async function fetchPage(url: string): Promise<string> {
  let cur = url;
  for (let i = 0; i < 4; i++) {
    const u = new URL(cur);
    if (u.protocol !== "https:" || !publicHost(u.hostname)) throw new Error("That link is not a public web page.");
    const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; BasilRecipeReader/1.0)", Accept: "text/html,application/xhtml+xml" } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { cur = new URL(r.headers.get("location")!, u).toString(); continue; }
    if (!r.ok) throw new Error(`The site answered ${r.status}.`);
    const buf = new Uint8Array(await r.arrayBuffer());
    return new TextDecoder().decode(buf.slice(0, 1_500_000));
  }
  throw new Error("Too many redirects.");
}
function textOfHtml(html: string): string {
  // Prefer schema.org Recipe JSON-LD: it is exact and short.
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocks) {
    try {
      const j = JSON.parse(b.trim());
      const stack = Array.isArray(j) ? [...j] : [j];
      while (stack.length) {
        const n = stack.shift();
        if (!n || typeof n !== "object") continue;
        if (Array.isArray(n["@graph"])) stack.push(...n["@graph"]);
        const t = n["@type"];
        if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return "SCHEMA.ORG RECIPE\n" + JSON.stringify(n).slice(0, 14_000);
      }
    } catch { /* not valid JSON-LD, keep looking */ }
  }
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<\/(p|div|li|h\d|br|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&frac12;/g, "1/2")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
  return body.slice(0, 14_000);
}

function b64(buf: Uint8Array): string {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode(...buf.subarray(i, i + CH));
  return btoa(s);
}

const FALLBACK_VISION = ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"];
async function logSpend(model: string, ok: boolean, ms: number, inT: number, outT: number, why?: string, ref?: string) {
  try {
    await db.from("ai_spend").insert({ fn: "recipe-parse", scope: "background", job: "recipe-parse", model, ref: ref ?? null, input_tokens: inT, output_tokens: outT, cost_usd: 0, provider: "groq", ok, ms, outcome: ok ? "ok" : `error: ${why ?? ""}`.slice(0, 300) });
  } catch { /* best effort */ }
}
/** Free Groq vision (Llama 4 Scout, then Maverick). Throws "free-llm all_failed" when none answers. */
async function groqVision(image: { b64: string; mime: string }, system: string, prompt: string, ref: string): Promise<{ text: string; model: string }> {
  const { data: raw } = await db.rpc("llm_keys");
  const key = String((raw as Record<string, string> | null)?.groq_api_key ?? "").match(/gsk_[A-Za-z0-9]{20,}/)?.[0];
  if (!key) throw new Error("free-llm all_failed: no Groq key connected");
  const { data: prov } = await db.from("llm_providers").select("enabled, private_ok, cooldown_until").eq("name", "groq").maybeSingle();
  if (prov && (!prov.enabled || !prov.private_ok)) throw new Error("free-llm all_failed: Groq vision is switched off");
  if (image.b64.length > 3_900_000) throw new Error("That photo is too big. Take it again a little farther back.");
  let models = FALLBACK_VISION;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const rank = (id: string) => (/scout/i.test(id) ? 0 : /maverick/i.test(id) ? 1 : 2);
      const ids = (((await r.json()).data ?? []) as any[]).filter((m) => m?.id && m.active !== false && /llama-4|vision|-vl\b/i.test(String(m.id)) && !/guard|whisper|tts|embed/i.test(String(m.id)))
        .map((m) => String(m.id)).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
      if (ids.length) models = ids;
    }
  } catch { /* use the fallback list */ }
  let last = "";
  for (const model of models) {
    const t0 = Date.now();
    try {
      const mime = /^image\/(png|jpeg|gif|webp)$/.test(image.mime) ? image.mime : "image/jpeg";
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ model, max_tokens: 2500, messages: [{ role: "system", content: system },
          { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${image.b64}` } }] }] }),
      });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
      const j = await r.json();
      const text = String(j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) throw new Error("empty reply");
      await logSpend(String(j.model ?? model), true, Date.now() - t0, Number(j.usage?.prompt_tokens ?? 0), Number(j.usage?.completion_tokens ?? 0), undefined, ref);
      return { text, model: String(j.model ?? model) };
    } catch (e) {
      last = (e as Error).message;
      await logSpend(model, false, Date.now() - t0, 0, 0, last, ref);
    }
  }
  throw new Error(`free-llm all_failed: ${last}`);
}
/** Free text ladder via the deployed free-llm function. paid is "never". Retries once on a bad shape. */
async function freeExtract(system: string, user: string, validate: (j: any) => string | null): Promise<{ json: any; model: string }> {
  let why = "";
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${SUPA_URL}/functions/v1/free-llm`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SECRET_KEY }, signal: AbortSignal.timeout(75_000),
      body: JSON.stringify({ op: "run", task: "extract", system, user: i ? `${user}\n\n(Your last answer was rejected: ${why}. Return the JSON object only.)` : user, json: true, paid: "never", maxTokens: 3500 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) throw new Error(`free-llm all_failed: ${String(j?.error ?? r.status).slice(0, 200)}`);
    why = validate(j.json) ?? "";
    if (!why) return { json: j.json, model: String(j.model ?? "free") };
  }
  throw new Error(`The model could not read it cleanly (${why}).`);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "recipe";
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Shape the model's JSON into the app's RecipeDoc, and list everything the owner should double-check.
function toDraft(raw: any, review: string[]) {
  const title = String(raw?.title ?? "").trim() || "Untitled recipe";
  const category = CATEGORIES.includes(raw?.category) ? raw.category : "Mains";
  const used = new Set<string>();
  const ingredients = (Array.isArray(raw?.ingredients) ? raw.ingredients : []).map((x: any, i: number) => {
    const name = String(x?.name ?? "").trim();
    let id = slug(name).split("-")[0] || "i" + (i + 1);
    while (used.has(id)) id += "x";
    used.add(id);
    const amount = num(x?.amount);
    let unit = String(x?.unit ?? "").trim().toLowerCase();
    if (/^(g|gram|grams|kg|ml|milliliters?|l|liters?)$/.test(unit)) { review.push(`"${name}" is in ${unit}. Convert it to a US unit.`); }
    if (amount === null && !unit) unit = "to taste";
    if (amount !== null && !unit) unit = "count";
    const out: Record<string, unknown> = { id, name, amount, unit };
    if (x?.optional) out.optional = true;
    if (x?.note) out.note = String(x.note);
    if (!name) review.push(`Ingredient ${i + 1} has no name.`);
    if (amount === null && !/taste|optional|as needed|garnish|pinch|dash/.test(unit)) review.push(`No amount for "${name}".`);
    return out;
  }).filter((x: any) => x.name);
  const steps = (Array.isArray(raw?.steps) ? raw.steps : []).map((s: any, i: number) => {
    const o: Record<string, unknown> = { title: String(s?.title ?? "").trim() || `Step ${i + 1}`, text: String(s?.text ?? "").trim() };
    const t = num(s?.timer_sec); if (t && t >= 10 && t <= 172_800) o.timer_sec = Math.round(t);
    return o;
  }).filter((s: any) => s.text);
  if (!ingredients.length) review.push("No ingredients were found.");
  if (!steps.length) review.push("No steps were found.");
  // Step text stays as written (no {id} tokens), so the scaler leaves step amounts alone; ingredient amounts still scale.
  const y = raw?.yield ?? {};
  const yamt = num(y.amount);
  if (!yamt) review.push("No serving count. Set one before you scale it.");
  const notes: string[] = (Array.isArray(raw?.notes) ? raw.notes : []).map(String).filter(Boolean).slice(0, 8);
  const tm = raw?.time ?? {};
  const time: Record<string, number> = {};
  if (num(tm.total_min)) time.total_min = Math.round(num(tm.total_min)!);
  if (num(tm.prep_min)) time.prep_min = Math.round(num(tm.prep_min)!);
  return {
    id: slug(title) + "-" + Date.now().toString(36),
    title, category, blurb: String(raw?.blurb ?? "").trim(),
    yield: { amount: yamt ?? 4, unit: String(y.unit ?? "servings") || "servings" },
    ...(Object.keys(time).length ? { time } : {}),
    tags: [], omnicook: "none", ingredients, steps,
    tips: (Array.isArray(raw?.tips) ? raw.tips : []).map(String).filter(Boolean).slice(0, 6),
    flags: notes,
  };
}

async function work(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: job } = await db.from("recipe_parse_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, error: "no such job" };
  if (job.status === "done") return { ok: true };
  await db.from("recipe_parse_jobs").update({ status: "running", attempts: (job.attempts ?? 0) + 1, updated_at: new Date().toISOString(), error: null }).eq("id", jobId);
  try {
    let text = "";
    let via = "";
    if (job.kind === "photo") {
      const dl = await db.storage.from("recipe-photos").download(job.source);
      if (dl.error || !dl.data) throw new Error("Could not open the photo.");
      const mime = dl.data.type && dl.data.type.startsWith("image/") ? dl.data.type : "image/jpeg";
      if (/heic|heif/.test(mime)) throw new Error("This photo is HEIC. Take it as JPEG or choose Most Compatible in Camera settings.");
      const buf = new Uint8Array(await dl.data.arrayBuffer());
      const v = await groqVision({ b64: b64(buf), mime },
        "You transcribe recipes from photos exactly. Never add anything that is not on the page.",
        "Transcribe this recipe in full as plain text: the title, any servings or time, every ingredient with its amount and unit exactly as printed, and every step in order. Mark any word or number you cannot read as [unclear].", jobId);
      text = v.text; via = v.model;
      if (text.replace(/\s/g, "").length < 40) throw new Error("I could not read a recipe in that photo. Try a closer, brighter shot.");
    } else {
      text = textOfHtml(await fetchPage(job.source));
      if (text.replace(/\s/g, "").length < 80) throw new Error("That page has no readable recipe. Try the photo instead.");
    }
    const r = await freeExtract(SYSTEM, text.slice(0, 14_000),
      (j) => (!j || typeof j !== "object" ? "not an object" : !Array.isArray(j.ingredients) || !j.ingredients.length ? "no ingredients" : !Array.isArray(j.steps) || !j.steps.length ? "no steps" : null));
    const review: string[] = [];
    if (/\[unclear\]/i.test(text)) review.push("Some of the print was hard to read. Check the amounts marked below.");
    const draft = toDraft(r.json, review);
    if (job.kind === "link") (draft as any).source_url = job.source;
    await db.from("recipe_parse_jobs").update({
      status: "done", result: { draft, review }, model: [via, r.model].filter(Boolean).join(" + "), updated_at: new Date().toISOString(), error: null,
    }).eq("id", jobId);
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const busy = /free-llm|all_failed|budget|paid_never/i.test(msg);
    const human = busy ? "The free models are all busy. Basil will try again in a few minutes." : msg;
    const attempts = (job.attempts ?? 0) + 1;
    // A busy model is retried by Basil's watchdog (it re-queues stuck jobs); a plain failure is final.
    await db.from("recipe_parse_jobs").update({ status: busy && attempts < 2 ? "queued" : "failed", error: human, updated_at: new Date().toISOString() }).eq("id", jobId);
    return { ok: false, error: human };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await isServiceRequest(req))) {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const { data: who } = jwt ? await db.auth.getUser(jwt) : { data: null };
    const uid = who?.user?.id;
    if (!uid) return J({ ok: false, error: "unauthorized" }, 401);
    const { data: isAdmin } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
    if (!isAdmin) return J({ ok: false, error: "admin only" }, 403);
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  let jobId = typeof body.job_id === "string" ? body.job_id : "";
  if (!jobId) {
    const kind = body.kind === "photo" || body.kind === "link" ? body.kind : "";
    const source = String(body.source ?? "");
    if (!kind) return J({ ok: false, error: "kind must be photo or link" }, 400);
    if (kind === "photo" && !/^recipes\/parse\/[A-Za-z0-9._-]{1,120}$/.test(source)) return J({ ok: false, error: "bad photo path" }, 400);
    if (kind === "link" && !/^https:\/\/\S+$/i.test(source)) return J({ ok: false, error: "Paste a full https link." }, 400);
    const { data, error } = await db.from("recipe_parse_jobs").insert({ kind, source }).select("id").single();
    if (error) return J({ ok: false, error: error.message }, 500);
    jobId = data.id;
  }
  // Work the job without holding the caller: the page watches the job row (Realtime), and the watchdog retries a stuck one.
  const p = work(jobId);
  // @ts-ignore EdgeRuntime is provided by Supabase's runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) { EdgeRuntime.waitUntil(p); return J({ ok: true, job_id: jobId }, 202); }
  const r = await p;
  return J({ ok: r.ok, job_id: jobId, error: r.error }, r.ok ? 200 : 502);
});
