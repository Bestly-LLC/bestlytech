// agent-demo-tts: records the scripted Bestly Agent demo calls (/agent) with ElevenLabs, one clip per line.
// Service-role only (the bearer must equal SUPABASE_SERVICE_ROLE_KEY). Input:
//   { id: string, model?: string, lines: [{ n: number, voiceId: string, text: string }] }
// For each line it asks ElevenLabs for speech plus character timing, stores <id>/<n>.mp3 and <id>/<n>.json (the
// alignment) in the public Storage bucket "agent-demo" (fictional demo audio, nothing private), and returns the URLs.
// tools/agent-demo-audio/build.mjs downloads the clips and stitches the final public/agent-demo/<id>.mp3 + .json.
// The ElevenLabs key comes from ava_secret('elevenlabs_api_key') and is never returned or logged.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "agent-demo";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!service || bearer !== service) return json({ ok: false, error: "service role only" }, 401);
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: { id?: string; model?: string; lines?: { n: number; voiceId: string; text: string }[] };
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const id = String(body.id ?? "");
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !lines.length || lines.length > 30) return json({ ok: false, error: "need id and 1-30 lines" }, 400);
  const model = String(body.model || DEFAULT_MODEL);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, service);
  const { data: key } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  if (!key) return json({ ok: false, error: "elevenlabs key not found" }, 500);

  // Bucket (public: fictional demo audio).
  const { data: buckets } = await sb.storage.listBuckets();
  if (!(buckets ?? []).some((b) => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true });
    if (error) return json({ ok: false, error: `bucket: ${error.message}` }, 500);
  }

  const files: unknown[] = [];
  const errors: unknown[] = [];
  for (const l of lines) {
    const n = Number(l.n);
    const text = String(l.text ?? "").trim();
    if (!Number.isInteger(n) || !text || !/^[A-Za-z0-9]{10,40}$/.test(String(l.voiceId))) { errors.push({ n, error: "bad line" }); continue; }
    const call = () => fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${l.voiceId}/with-timestamps?output_format=mp3_44100_64`,
      { method: "POST", headers: { "xi-api-key": String(key), "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) });
    let r = await call();
    if (r.status === 429) { await sleep(2500); r = await call(); }
    if (!r.ok) {
      const t = (await r.text().catch(() => "")).slice(0, 200);
      errors.push({ n, status: r.status, error: t });
      continue;
    }
    const j = await r.json();
    const bin = Uint8Array.from(atob(String(j.audio_base64 ?? "")), (c) => c.charCodeAt(0));
    if (bin.length < 500) { errors.push({ n, error: "empty audio" }); continue; }
    const up1 = await sb.storage.from(BUCKET).upload(`${id}/${n}.mp3`, bin, { contentType: "audio/mpeg", upsert: true });
    const up2 = await sb.storage.from(BUCKET).upload(`${id}/${n}.json`,
      new Blob([JSON.stringify({ model, alignment: j.alignment ?? null, normalized_alignment: j.normalized_alignment ?? null })], { type: "application/json" }),
      { contentType: "application/json", upsert: true });
    if (up1.error || up2.error) { errors.push({ n, error: `upload: ${(up1.error ?? up2.error)!.message}` }); continue; }
    const pub = (p: string) => sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
    files.push({ n, mp3Url: pub(`${id}/${n}.mp3`), alignUrl: pub(`${id}/${n}.json`), chars: text.length, bytes: bin.length });
    await sleep(400);
  }
  return json({ ok: errors.length === 0, model, files, errors });
});
