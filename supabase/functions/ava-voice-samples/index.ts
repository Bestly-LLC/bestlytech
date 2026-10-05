// ava-voice-samples: grow or trim Jared's voice clone without re-recording. Admin only. (Spark, 2026-10-04)
//
// Jared: "upload multiple voice memos and add to the voice; recycle the old ones, no re-recording or re-uploading."
// ElevenLabs keeps every sample a clone was built from, so the old recordings never need to come back from us:
//   {action:"info"}                          the clone's samples: id, name, size.
//   {action:"add", paths:[...]}              new recordings already uploaded to the private ava-voice bucket (same as voice_clone);
//                                            added to the SAME voice (same id, so Use my voice keeps working). Raw files deleted after.
//   {action:"remove", sample_id}             drop one bad sample (the last one can't be removed: delete the voice instead).
// Safety: before an add, the existing samples' audio is held in memory; if the platform replaced instead of appended,
// the old samples are put back. The result always reports the real sample count, never a hoped-for one.
// Personal Ava only; RoofGuard never speaks as Jared. Secrets from Vault via ava_secret().

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const MAX_SAMPLES = 25, MAX_NEW = 10, MAX_BYTES = 25 * 1024 * 1024;

const err = (error: string, status = 400) => Response.json({ ok: false, error }, { status, headers: CORS });
const ok = (b: Record<string, unknown>) => Response.json({ ok: true, ...b }, { headers: CORS });

async function vault(name: string): Promise<string | null> {
  const { data, error } = await db.rpc("ava_secret", { p_name: name });
  return error || typeof data !== "string" || !data ? null : data;
}
async function isAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (SERVICE_KEYS.has(token)) return true;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

// deno-lint-ignore no-explicit-any
type Raw = Record<string, any>;
type Sample = { sample_id: string; file_name: string; size_bytes: number; mime_type: string };
const slimSample = (s: Raw): Sample => ({ sample_id: String(s.sample_id), file_name: String(s.file_name ?? "recording"), size_bytes: Number(s.size_bytes ?? 0), mime_type: String(s.mime_type ?? "audio/mpeg") });

async function getVoice(key: string, id: string): Promise<{ name: string; samples: Sample[] } | null> {
  const r = await fetch(`${XI}/voices/${id}`, { headers: { "xi-api-key": key } }).catch(() => null);
  if (!r?.ok) { await r?.text().catch(() => ""); return null; }
  const v = await r.json().catch(() => null);
  if (!v) return null;
  return { name: String(v.name ?? "Jared"), samples: ((v.samples ?? []) as Raw[]).map(slimSample) };
}
async function cloneId(): Promise<string | null> {
  const { data } = await db.from("ava_settings").select("jared_voice_id").eq("id", true).maybeSingle();
  return data?.jared_voice_id ?? null;
}
/** edit = add these files to the voice (name is required by the platform; keep the current one) */
async function editWith(key: string, id: string, name: string, files: { blob: Blob; name: string }[]): Promise<boolean> {
  const fd = new FormData();
  fd.append("name", name);
  for (const f of files) fd.append("files", f.blob, f.name);
  const r = await fetch(`${XI}/voices/${id}/edit`, { method: "POST", headers: { "xi-api-key": key }, body: fd }).catch(() => null);
  await r?.text().catch(() => "");
  return !!r?.ok;
}

async function info(key: string): Promise<Response> {
  const id = await cloneId();
  if (!id) return ok({ has: false, samples: [] });
  const v = await getVoice(key, id);
  if (!v) return err("Couldn't read your voice from the voice platform. Try again.", 502);
  return ok({ has: true, samples: v.samples, max: MAX_SAMPLES });
}

async function add(key: string, body: Raw): Promise<Response> {
  const paths = ((body.paths ?? []) as unknown[]).map(String).filter((p) => /^clone\/[A-Za-z0-9._-]+$/.test(p)).slice(0, MAX_NEW);
  if (!paths.length) return err("Pick at least one recording.");
  const id = await cloneId();
  if (!id) { await db.storage.from("ava-voice").remove(paths); return err("Make your voice first, then add to it.", 409); }
  const before = await getVoice(key, id);
  if (!before) { await db.storage.from("ava-voice").remove(paths); return err("Couldn't read your voice from the voice platform. Try again.", 502); }
  if (before.samples.length + paths.length > MAX_SAMPLES) {
    await db.storage.from("ava-voice").remove(paths);
    return err(`Your voice holds up to ${MAX_SAMPLES} recordings and has ${before.samples.length}. Remove a weak one first.`, 409);
  }

  const files: { blob: Blob; name: string }[] = [];
  for (const p of paths) {
    const d = await db.storage.from("ava-voice").download(p);
    if (d.error || !d.data || d.data.size > MAX_BYTES) continue;
    files.push({ blob: d.data, name: p.split("/").pop() ?? "memo.m4a" });
  }
  if (!files.length) { await db.storage.from("ava-voice").remove(paths); return err("Couldn't read those recordings. Upload them again.", 400); }

  // hold the old audio in memory so a replace-instead-of-append can be undone
  const held = new Map<string, { blob: Blob; name: string }>();
  for (const s of before.samples) {
    const a = await fetch(`${XI}/voices/${id}/samples/${s.sample_id}/audio`, { headers: { "xi-api-key": key } }).catch(() => null);
    if (a?.ok) held.set(s.sample_id, { blob: await a.blob(), name: s.file_name }); else await a?.text().catch(() => "");
  }

  const sent = await editWith(key, id, before.name, files);
  await db.storage.from("ava-voice").remove(paths);   // raw recordings never stay on our side
  if (!sent) return err("The voice platform rejected those recordings. Check they're clear speech, 30 seconds or longer, and try again.", 502);

  let after = await getVoice(key, id);
  const keptIds = new Set((after?.samples ?? []).map((s) => s.sample_id));
  const lost = before.samples.filter((s) => !keptIds.has(s.sample_id) && held.has(s.sample_id));
  let restored = 0;
  if (after && lost.length) {   // it replaced instead of appended: put the old ones back
    if (await editWith(key, id, before.name, lost.map((s) => held.get(s.sample_id)!))) { restored = lost.length; after = await getVoice(key, id); }
  }
  const total = after?.samples.length ?? null;
  if (total === null) return err("Added, but couldn't confirm the result. Reload and check the list.", 502);
  if (total < before.samples.length + files.length) {
    await db.rpc("scout_notify", { p_title: "Ava's voice: add-to-clone didn't fully add", p_body: `Had ${before.samples.length}, sent ${files.length}, now ${total}. Open the voice studio and check the list.`,
      p_severity: "warning", p_push: false, p_url: "https://bestly.tech/admin/ava", p_dedupe: `ava-voice-samples-${new Date().toISOString().slice(0, 13)}` });
  }
  return ok({ samples: after!.samples, before: before.samples.length, added: files.length, restored, max: MAX_SAMPLES });
}

async function remove(key: string, body: Raw): Promise<Response> {
  const sid = String(body.sample_id ?? "");
  if (!/^[A-Za-z0-9]{10,40}$/.test(sid)) return err("Pick a recording.");
  const id = await cloneId();
  if (!id) return err("No voice to change.", 409);
  const v = await getVoice(key, id);
  if (!v) return err("Couldn't read your voice from the voice platform. Try again.", 502);
  if (!v.samples.some((s) => s.sample_id === sid)) return err("That recording is already gone. Reload the list.", 404);
  if (v.samples.length <= 1) return err("That's the only recording. Delete the voice instead, or add another first.", 409);
  const r = await fetch(`${XI}/voices/${id}/samples/${sid}`, { method: "DELETE", headers: { "xi-api-key": key } }).catch(() => null);
  await r?.text().catch(() => "");
  if (!r?.ok) return err("The voice platform wouldn't remove it. Try again.", 502);
  const after = await getVoice(key, id);
  return ok({ samples: after?.samples ?? v.samples.filter((s) => s.sample_id !== sid), max: MAX_SAMPLES });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req))) return new Response("unauthorized", { status: 401, headers: CORS });
  const b = await req.json().catch(() => ({}));
  const key = await vault("elevenlabs_api_key");
  if (!key) return err("The ElevenLabs key is missing from Vault.", 412);
  try {
    switch (b.action) {
      case "info": return await info(key);
      case "add": return await add(key, b);
      case "remove": return await remove(key, b);
      default: return err("unknown action");
    }
  } catch (e) {
    return err(`Something went wrong (${e instanceof Error ? e.message : "error"}).`, 500);
  }
});
