// agent-demo-tts: records the scripted Bestly Agent demo calls (/agent) with ElevenLabs, one clip per line.
// Service-role only (the bearer must equal SUPABASE_SERVICE_ROLE_KEY). Input:
//   { id: string, model?: string, format?: string, lines: [{ n: number, voiceId: string, text: string }] }
// Voice-picking ops (same auth, no audio is made, nothing is spent):
//   { op: "voices", params: { category: "professional", gender: "male", ... } }  search the shared voice library
//   { op: "voice", voiceId }                                                   look up one voice in this account
//   { op: "add", publicOwnerId, voiceId, name }                                add a library voice to this account
//   { op: "remove", voiceId }                                                  delete a voice this function added (name must start "Demo caller - ")
// For each line it asks ElevenLabs for speech plus character timing, stores <id>/<n>.mp3 and <id>/<n>.json (the
// alignment) in the public Storage bucket "agent-demo" (fictional demo audio, nothing private), and returns the URLs.
// tools/agent-demo-audio/build.mjs downloads the clips and stitches the final public/agent-demo/<id>.mp3 + .json.
// The ElevenLabs key comes from ava_secret('elevenlabs_api_key') and is never returned or logged.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "agent-demo";
const DEFAULT_MODEL = "eleven_multilingual_v2";
// Recorded at 128 kbps; build.mjs encodes the final web files once (mono, 96 kbps).
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!service || bearer !== service) return json({ ok: false, error: "service role only" }, 401);
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: { op?: string; params?: Record<string, string | number>; voiceId?: string; publicOwnerId?: string; name?: string; id?: string; model?: string; format?: string; lines?: { n: number; voiceId: string; text: string }[] };
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }

  if (body.op) {
    const sb0 = createClient(Deno.env.get("SUPABASE_URL")!, service);
    const { data: k0 } = await sb0.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
    if (!k0) return json({ ok: false, error: "elevenlabs key not found" }, 500);
    const h = { "xi-api-key": String(k0), "Content-Type": "application/json" };
    const idOk = (v: unknown) => /^[A-Za-z0-9]{10,64}$/.test(String(v ?? ""));
    if (body.op === "voices") {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(body.params ?? {})) if (/^[a-z_]{2,30}$/.test(k)) q.set(k, String(v).slice(0, 80));
      const r = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${q}`, { headers: h });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ ok: false, status: r.status, error: JSON.stringify(j).slice(0, 300) });
      const voices = (j.voices ?? []).map((v: Record<string, unknown>) => ({
        id: v.voice_id, owner: v.public_owner_id, name: v.name, cat: v.category, g: v.gender, age: v.age, accent: v.accent,
        desc: v.descriptive, use: v.use_case, lang: v.language, usage1y: v.usage_character_count_1y, cloned: v.cloned_by_count,
        notice: v.notice_period, free: v.free_users_allowed, live: v.live_moderation_enabled, rate: v.rate,
        models: v.high_quality_base_model_ids, about: String(v.description ?? "").slice(0, 140),
      }));
      return json({ ok: true, has_more: j.has_more, voices });
    }
    if (body.op === "voice") {
      if (!idOk(body.voiceId)) return json({ ok: false, error: "bad voiceId" }, 400);
      const r = await fetch(`https://api.elevenlabs.io/v1/voices/${body.voiceId}`, { headers: h });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ ok: false, status: r.status, error: JSON.stringify(j).slice(0, 300) });
      return json({ ok: true, voice: { id: j.voice_id, name: j.name, category: j.category, labels: j.labels, description: String(j.description ?? "").slice(0, 200),
        models: j.high_quality_base_model_ids, ft: j.fine_tuning ? { state: j.fine_tuning.state, is_allowed: j.fine_tuning.is_allowed_to_fine_tune } : null,
        sharing: j.sharing ? { status: j.sharing.status, owner: j.sharing.original_voice_id, public_owner_id: j.sharing.public_owner_id } : null, preview_url: j.preview_url } });
    }
    if (body.op === "add") {
      if (!idOk(body.voiceId) || !idOk(body.publicOwnerId)) return json({ ok: false, error: "bad ids" }, 400);
      const r = await fetch(`https://api.elevenlabs.io/v1/voices/add/${body.publicOwnerId}/${body.voiceId}`, { method: "POST", headers: h,
        body: JSON.stringify({ new_name: String(body.name ?? "Demo voice").slice(0, 60) }) });
      const j = await r.json().catch(() => ({}));
      return json({ ok: r.ok, status: r.status, voice_id: j.voice_id ?? null, error: r.ok ? null : JSON.stringify(j).slice(0, 300) });
    }
    if (body.op === "remove") {
      if (!idOk(body.voiceId)) return json({ ok: false, error: "bad voiceId" }, 400);
      const g = await fetch(`https://api.elevenlabs.io/v1/voices/${body.voiceId}`, { headers: h });
      const gj = await g.json().catch(() => ({}));
      if (!g.ok || !String(gj.name ?? "").startsWith("Demo caller - ")) return json({ ok: false, error: "not a demo voice" }, 400);
      const r = await fetch(`https://api.elevenlabs.io/v1/voices/${body.voiceId}`, { method: "DELETE", headers: h });
      return json({ ok: r.ok, status: r.status });
    }
    return json({ ok: false, error: "unknown op" }, 400);
  }
  const id = String(body.id ?? "");
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !lines.length || lines.length > 30) return json({ ok: false, error: "need id and 1-30 lines" }, 400);
  const model = String(body.model || DEFAULT_MODEL);
  const format = /^mp3_44100_(64|96|128|192)$/.test(String(body.format)) ? String(body.format) : "mp3_44100_128";

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
      `https://api.elevenlabs.io/v1/text-to-speech/${l.voiceId}/with-timestamps?output_format=${format}`,
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
  return json({ ok: errors.length === 0, model, format, files, errors });
});
