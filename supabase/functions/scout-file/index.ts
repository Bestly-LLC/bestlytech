// scout-file — turns a file Jared drops into the Scout chat into text Scout can read.
//
// This makes the TEXT copy of a file: what free Scout and the chat history read. Paid Scout does not rely on it,
// admin-chat hands Claude the real pixels (see the scout-files marker in ScoutAttach.tsx). Deploying this function
// now needs _shared/free-llm.ts next to it (it imports llmVision), and admin-chat needs the same copy of that file.
//
//   op read    { path }                ->  { ok, name, kind, text, cost_usd }
//   op frames  { paths: [..], name? }  ->  { ok, name, kind: "video", text, cost_usd }   frames the browser cut from a video
//
//     text, markdown, csv, json, xml, html, code   read straight through. No model, $0.
//     png/jpeg/gif/webp                            a free Groq vision model first (a screenshot of an error becomes
//                                                  the error text), Claude Haiku only if that fails
//     video frames                                 the same, all frames at once, described in order
//     pdf                                          read as a document block by Claude Haiku
//
// Every model call is logged to ai_spend like the rest. Text files never reach a model, which is the common case and stays free.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";
import { llmVision, LlmUnavailable, type VisionImage } from "../_shared/free-llm.ts";

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

const CORS = corsWith({
  headers: "authorization, content-type, apikey, x-client-info",
  methods: "POST, OPTIONS"
});
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
const MAX_FRAMES = 12;

const b64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const PRICE_IN = 1, PRICE_OUT = 5; // haiku, $ per 1M tokens

/** PDFs only: a document block needs Claude, so this stays on Haiku. */
async function lookPdf(data: string, name: string) {
  const key = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").match(/sk-ant-[A-Za-z0-9_\-]{20,}/)?.[0];
  if (!key) return { text: "", error: "No API key, so I can't read PDFs yet." };
  const block = { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  const ask = "Write out the readable content of this document in plain text, keeping its headings and order. No preamble, no summary.";

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
      fn: "scout-file", scope: "chat", job: "read:pdf", model: String(j.model ?? "claude-haiku-4-5"),
      ref: name.slice(0, 200), input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0,
      cost_usd: cost, provider: "anthropic", ok: true, ms: 0, outcome: "ok",
    });
  } catch { /* telemetry is not the job */ }
  return { text, cost };
}

const IMAGE_ASK = "Transcribe every word visible in this image exactly, then describe in one or two lines what it shows. If it is a screenshot of an error, dashboard or code, the exact text matters most. No preamble.";
const VIDEO_ASK = (n: number) =>
  `These ${n} images are frames taken evenly, in order, from one video. Describe what happens in the video from start to end in a few short lines, naming the frame numbers where things change. ` +
  "Copy any text that is readable on screen exactly (an error, a label, a number). Say plainly what you can't tell from still frames. No preamble.";

/** Free vision model first, Haiku only if that fails (both inside llmVision). */
async function seeImages(images: VisionImage[], prompt: string, name: string, job: string) {
  try {
    const r = await llmVision({
      images, prompt, maxTokens: job === "read:video" ? 900 : 700, job, ref: name.slice(0, 200), fn: "scout-file", scope: "chat",
    });
    return { text: r.text, cost: r.cost_usd };
  } catch (e) {
    if (e instanceof LlmUnavailable) {
      const tooBig = e.tried.some((t) => t.outcome === "skipped_size") && !e.tried.some((t) => t.outcome === "ok");
      return {
        text: "", cost: 0,
        error: e.reason === "budget" ? "Paid AI is at its cap and the free vision models are busy, so I couldn't read it."
          : tooBig ? "That image is too large to read (over 5 MB)."
          : "No vision model is answering right now.",
      };
    }
    return { text: "", cost: 0, error: (e as Error).message };
  }
}

/** The media type from the file's first bytes, so a mislabelled upload never reaches a model as the wrong type. */
function sniffImage(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
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
    const type = sniffImage(new Uint8Array(buf)) ?? mime.toLowerCase().replace("image/jpg", "image/jpeg");
    const r = await seeImages([{ b64: b64(buf), mime: type }], IMAGE_ASK, name, "read:image");
    return r.error ? { ok: false, error: r.error } : { ok: true, name, kind: "image", text: r.text, cost_usd: r.cost };
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
    const r = await lookPdf(b64(buf), name);
    return r.error ? { ok: false, error: r.error } : { ok: true, name, kind: "pdf", text: r.text, cost_usd: r.cost };
  }
  return { ok: false, error: `I can't read ${mime || "that kind of file"} yet — text, code, CSV, JSON, images and PDFs work.` };
}

/** A video's frames (cut and uploaded by the browser), described in order. */
async function readFrames(paths: string[], label: string) {
  const images: VisionImage[] = [];
  for (const path of paths.slice(0, MAX_FRAMES)) {
    const { data: blob, error } = await db.storage.from("scout-files").download(path);
    if (error || !blob) return { ok: false, error: `Couldn't open a frame: ${error?.message ?? "not found"}` };
    const buf = await blob.arrayBuffer();
    images.push({ b64: b64(buf), mime: sniffImage(new Uint8Array(buf)) ?? "image/jpeg" });
  }
  const name = label || (paths[0]?.split("/").pop() ?? "video");
  const r = await seeImages(images, VIDEO_ASK(images.length), name, "read:video");
  return r.error ? { ok: false, error: r.error } : { ok: true, name, kind: "video", text: r.text, cost_usd: r.cost };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await adminOnly(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: { op?: string; path?: string; paths?: unknown; name?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const op = body.op ?? "read";
  if (op !== "read" && op !== "frames") return J({ ok: false, error: "op must be read or frames" }, 400);
  try {
    if (op === "frames") {
      const paths = (Array.isArray(body.paths) ? body.paths : []).map(String);
      if (!paths.length || paths.some((p) => !p || p.includes(".."))) return J({ ok: false, error: "paths required" }, 400);
      return J(await readFrames(paths, String(body.name ?? "").slice(0, 200)));
    }
    const path = String(body.path ?? "");
    if (!path || path.includes("..")) return J({ ok: false, error: "path required" }, 400);
    return J(await read(path));
  } catch (e) {
    return J({ ok: false, error: (e as Error).message });
  }
});
