// scout-file — turns a file Jared drops into the Scout chat into text Scout can read.
//
// Why a separate function rather than teaching admin-chat to take attachments: admin-chat imports
// _shared/free-llm.ts, and deploying it replaces every file in the function. Redeploying it from
// anywhere that does not hold a byte-exact copy of that shared file would break the free ladder.
// So the file work lives here, admin-chat is untouched, and the chat only ever sees text.
//
//   op read  { path }  ->  { ok, name, kind, text, cost_usd }
//
//     text, markdown, csv, json, xml, html, code   read straight through. No model, $0.
//     png/jpeg/gif/webp                            transcribed by the model (a screenshot of an
//                                                  error becomes the error text)
//     pdf                                          read as a document block
//
// Vision needs a model that has it: the free ladder's providers are text-only, so images and PDFs
// use claude-haiku-4-5 with a tight cap, and every call is logged to ai_spend like the rest.
// Text files never reach a model at all, which is the common case and stays free.

import { createClient } from "jsr:@supabase/supabase-js@2";

const secretKeys = (() => {
  const out: string[] = [];
  try {
    const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    for (const v of Object.values(j)) if (typeof v === "string") out.push(v);
  } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) out.push(legacy);
  return out;
})();
const SECRET = secretKeys[0];
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRET, {
  auth: { persistSession: false }, global: { headers: { apikey: SECRET } },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

/** Only Jared. The bucket is his, and this function reads it with the service role. */
async function adminOnly(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secretKeys.includes(bearer) || secretKeys.includes(req.headers.get("apikey") ?? "")) return true;
  if (!bearer || bearer.split(".").length !== 3) return false;
  const { data } = await db.auth.getUser(bearer);
  if (!data?.user) return false;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return ok === true;
}

const IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;
const TEXTISH = /^(text\/|application\/(json|xml|sql|javascript|x-ndjson))/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|xml|html?|css|sql|log|ts|tsx|js|jsx|py|rb|go|rs|sh|env|ini|toml|conf)$/i;
const MAX_TEXT = 120_000;   // ~30k tokens: past this Scout is reading noise, not a file
const MAX_BYTES = 25 * 1024 * 1024;

const b64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const PRICE_IN = 1, PRICE_OUT = 5; // haiku, $ per 1M tokens

async function look(kind: "image" | "pdf", media: string, data: string, name: string) {
  const key = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").match(/sk-ant-[A-Za-z0-9_\-]{20,}/)?.[0];
  if (!key) return { text: "", error: "No API key, so I can't look at images or PDFs yet." };
  const block = kind === "image"
    ? { type: "image", source: { type: "base64", media_type: media, data } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  const ask = kind === "image"
    ? "Transcribe every word visible in this image exactly, then describe in one or two lines what it shows. If it is a screenshot of an error, dashboard or code, the exact text matters most. No preamble."
    : "Write out the readable content of this document in plain text, keeping its headings and order. No preamble, no summary.";

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5", max_tokens: 4000,
      messages: [{ role: "user", content: [block, { type: "text", text: ask }] }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) return { text: "", error: `The model couldn't read it (${r.status}).` };
  const j = await r.json();
  const text = (j.content ?? []).filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text).join("").trim();
  const u = j.usage ?? {};
  const cost = ((u.input_tokens ?? 0) * PRICE_IN + (u.output_tokens ?? 0) * PRICE_OUT) / 1e6;
  try {
    await db.from("ai_spend").insert({
      fn: "scout-file", scope: "chat", job: `read:${kind}`, model: String(j.model ?? "claude-haiku-4-5"),
      ref: name.slice(0, 200), input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
      cost_usd: cost, provider: "anthropic", ok: true, ms: 0, outcome: "ok",
    });
  } catch { /* telemetry is not the job */ }
  return { text, cost };
}

async function read(path: string) {
  const name = path.split("/").pop() ?? "file";
  const { data: blob, error } = await db.storage.from("scout-files").download(path);
  if (error || !blob) return { ok: false, error: `Couldn't open that file: ${error?.message ?? "not found"}` };
  if (blob.size > MAX_BYTES) return { ok: false, error: "That file is over 25 MB." };

  const mime = blob.type || "";
  const buf = await blob.arrayBuffer();

  if (TEXTISH.test(mime) || TEXT_EXT.test(name)) {
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buf).replace(/\u0000/g, "");
    let note = "";
    if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); note = "\n\n[cut off: only the first 120,000 characters]"; }
    return { ok: true, name, kind: "text", text: text + note, cost_usd: 0 };
  }
  if (IMAGE.test(mime)) {
    const r = await look("image", mime.toLowerCase().replace("image/jpg", "image/jpeg"), b64(buf), name);
    return r.error ? { ok: false, error: r.error } : { ok: true, name, kind: "image", text: r.text, cost_usd: r.cost };
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
    const r = await look("pdf", "application/pdf", b64(buf), name);
    return r.error ? { ok: false, error: r.error } : { ok: true, name, kind: "pdf", text: r.text, cost_usd: r.cost };
  }
  return { ok: false, error: `I can't read ${mime || "that kind of file"} yet — text, code, CSV, JSON, images and PDFs work.` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await adminOnly(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: { op?: string; path?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  if ((body.op ?? "read") !== "read") return J({ ok: false, error: "op must be read" }, 400);
  const path = String(body.path ?? "");
  if (!path || path.includes("..")) return J({ ok: false, error: "path required" }, 400);
  try {
    return J(await read(path));
  } catch (e) {
    return J({ ok: false, error: (e as Error).message });
  }
});
