// ava-voices: the voice switcher for both Avas (personal + RoofGuard). Admin only. (Spark, 2026-10-04)
//
// Jared: "a dropdown in my admin to switch voices on the fly, play a sample from admin; Lulu, Sapphire, Chutki,
// Serafina and the last two voices Ava used." One favorites list serves both Avas; history is per Ava.
//
// Separate on purpose: this function never edits ava-assistant or roofguard-caller (they carry live phone lines). It only
// (a) reads voices from ElevenLabs, (b) PATCHes an agent's tts block, and (c) keeps ava_settings.voice_id / rg_settings.voice_id
// in step so a later setup re-run in either function lands on the same voice.
//
//   {action:"list"}                       favorites, last-two history per Ava, each Ava's current voice, samples left today.
//   {action:"seed"}                       finds Lulu, Sapphire, Chutki and Serafina in the voice library and saves them as
//                                         favorites (idempotent; picks the exact-name match with the most usage).
//   {action:"find", query}                search the shared library by name (for "Add a voice").
//   {action:"add_favorite", voice}        save one found voice.   {action:"remove_favorite", voice_id}
//   {action:"say", voice_id, text}        mp3 of that voice saying the text (the same Flash v2 model the agents speak with).
//   {action:"use", source, voice_id, public_owner_id?, name}   source: "ava" | "rg" | "both". Adds a shared voice to the
//                                         account if needed, patches the agent(s), saves, writes history.
//   {action:"health"}                     watchdog (every 10 min, no AI): each Ava's voice still exists, else back to the
//                                         previous voice (or Lily), agent patched, Scout told.
// Secrets come from Vault through ava_secret() (service role only).

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Expose-Headers": "x-says-left" };
const LILY = "pFZP5JQG7iQjIQuC4Bku";
const WANTED = ["Lulu", "Sapphire", "Chutki", "Serafina"];
/** Many library voices share a name; Jared named the exact one ("Sapphire - Sweet, Youthful, and Clear"). */
const HINT: Record<string, RegExp> = { Sapphire: /youthful/i };
const SAY_CAP = 40;
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;
type Src = "ava" | "rg";
const LABEL: Record<Src, string> = { ava: "Ava", rg: "RoofGuard Ava" };
const URL_OF: Record<Src, string> = { ava: "https://bestly.tech/admin/ava", rg: "https://bestly.tech/admin/roofguard" };
/** Same speech settings both Avas were set up with (flash v2 is the only English-safe fast model). */
const tts = (voice_id: string) => ({ voice_id, model_id: "eleven_flash_v2", stability: 0.55, similarity_boost: 0.8, optimize_streaming_latency: 4, speed: 1.05 });

const err = (error: string, status = 400) => Response.json({ ok: false, error }, { status, headers: CORS });
const ok = (b: Record<string, unknown>) => Response.json({ ok: true, ...b }, { headers: CORS });
const trimTo = (v: unknown, n: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

async function vault(name: string): Promise<string | null> {
  const { data, error } = await db.rpc("ava_secret", { p_name: name });
  return error || typeof data !== "string" || !data ? null : data;
}
const serviceCall = (req: Request) => {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return [bearer, (req.headers.get("apikey") ?? "").trim()].some((t) => t && SERVICE_KEYS.has(t));
};
async function isAdmin(req: Request): Promise<boolean> {
  if (serviceCall(req)) return true;
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}
const xiH = (key: string, json = true): Record<string, string> => json ? { "xi-api-key": key, "content-type": "application/json" } : { "xi-api-key": key };

// deno-lint-ignore no-explicit-any
type Raw = Record<string, any>;
function slim(v: Raw) {
  const l = (v.labels ?? {}) as Record<string, string>;
  const full = String(v.name ?? "");
  const [head, ...rest] = full.split(/\s+[-–—|]\s+/);
  return {
    voice_id: String(v.voice_id ?? ""), public_owner_id: v.public_owner_id ? String(v.public_owner_id) : null,
    name: (head ?? "").trim() || full, accent: String(v.accent ?? l.accent ?? ""), gender: String(v.gender ?? l.gender ?? ""),
    description: trimTo(v.description || rest.join(" - ") || v.descriptive || l.descriptive, 120),
    preview_url: (v.preview_url as string | undefined) ?? null, usage: Number(v.usage_character_count_1y ?? v.cloned_by_count ?? 0),
  };
}

/** One voice in this account: 404 / voice_not_found = missing; status 0 = couldn't tell. */
async function voiceInfo(key: string, id: string): Promise<{ status: number; missing: boolean; v?: Raw }> {
  try {
    const r = await fetch(`${XI}/voices/${id}`, { headers: xiH(key, false) });
    if (r.ok) return { status: 200, missing: false, v: await r.json() };
    const t = await r.text().catch(() => "");
    return { status: r.status, missing: r.status === 404 || /voice_not_found|voice.{0,20}not found/i.test(t) };
  } catch { return { status: 0, missing: false }; }
}

async function search(key: string, query: string) {
  const q = query.trim().slice(0, 40);
  const out = new Map<string, ReturnType<typeof slim>>();
  const mine = await fetch(`${XI.replace("/v1", "/v2")}/voices?search=${encodeURIComponent(q)}&page_size=20`, { headers: xiH(key, false) }).catch(() => null);
  if (mine?.ok) for (const v of ((await mine.json().catch(() => ({}))).voices ?? []) as Raw[]) if (v.category !== "cloned") out.set(v.voice_id, slim(v));
  const shared = await fetch(`${XI}/shared-voices?search=${encodeURIComponent(q)}&page_size=30&sort=usage_character_count_1y`, { headers: xiH(key, false) }).catch(() => null);
  if (shared?.ok) for (const v of ((await shared.json().catch(() => ({}))).voices ?? []) as Raw[]) if (!out.has(v.voice_id)) out.set(v.voice_id, slim(v));
  return [...out.values()];
}

async function saysLeft(): Promise<number> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const { data } = await db.from("ava_voice_usage").select("says").eq("source", "ava").eq("day", day).maybeSingle();
  return Math.max(0, SAY_CAP - (data?.says ?? 0));
}

type Cur = { voice_id: string; agent_id: string | null };
async function currentOf(src: Src): Promise<Cur> {
  const { data } = await db.from(src === "ava" ? "ava_settings" : "rg_settings").select("voice_id, agent_id").eq("id", true).maybeSingle();
  return { voice_id: data?.voice_id ?? LILY, agent_id: data?.agent_id ?? null };
}

async function list(): Promise<Response> {
  const { data: favs } = await db.from("ava_voice_favorites").select("*").order("sort").order("name");
  const out: Record<string, unknown> = {};
  for (const src of ["ava", "rg"] as Src[]) {
    const cur = await currentOf(src);
    const { data: hist } = await db.from("ava_voice_history").select("voice_id, name, used_at").eq("source", src).order("used_at", { ascending: false }).limit(12);
    const seen = new Set<string>([cur.voice_id]);
    const recent = (hist ?? []).filter((h) => !seen.has(h.voice_id) && seen.add(h.voice_id)).slice(0, 2);
    const known = (favs ?? []).find((f) => f.voice_id === cur.voice_id)?.name ?? (hist ?? []).find((h) => h.voice_id === cur.voice_id)?.name ?? null;
    out[src] = { current: { voice_id: cur.voice_id, name: known }, recent, ready: !!cur.agent_id };
  }
  const have = new Set((favs ?? []).map((f) => f.name.toLowerCase()));
  return ok({ favorites: favs ?? [], ...out, says_left: await saysLeft(), say_cap: SAY_CAP, needs_seed: WANTED.some((n) => !have.has(n.toLowerCase()) || (HINT[n] && !HINT[n].test((favs ?? []).find((f) => f.name.toLowerCase() === n.toLowerCase())?.description ?? ""))) });
}

async function seed(): Promise<Response> {
  const key = await vault("elevenlabs_api_key");
  if (!key) return err("The ElevenLabs key is missing from Vault.", 412);
  const found: string[] = [], missing: string[] = [];
  for (let i = 0; i < WANTED.length; i++) {
    const name = WANTED[i];
    const { data: have } = await db.from("ava_voice_favorites").select("voice_id, description").ilike("name", name).maybeSingle();
    if (have && HINT[name] && !HINT[name].test(have.description ?? "")) {
      // an earlier seed saved the wrong same-named voice (Jared OK'd replacing it); drop it unless an Ava is using it
      const [a, r] = await Promise.all([currentOf("ava"), currentOf("rg")]);
      if (a.voice_id !== have.voice_id && r.voice_id !== have.voice_id) await db.from("ava_voice_favorites").delete().eq("voice_id", have.voice_id);
    } else if (have) { found.push(name); continue; }
    const hits = await search(key, name);
    // the exact-name match wins; female first (she is "Ava"); then the most-used
    const exact = hits.filter((h) => h.name.toLowerCase() === name.toLowerCase());
    const hinted = HINT[name] ? exact.filter((h) => HINT[name].test(h.description ?? "")) : [];
    if (HINT[name] && !hinted.length) { missing.push(name); continue; }   // never save the wrong one
    const pick = (hinted.length ? hinted : exact).sort((a, b) => Number(b.gender === "female") - Number(a.gender === "female") || b.usage - a.usage)[0];
    if (!pick) { missing.push(name); continue; }
    await db.from("ava_voice_favorites").upsert({ voice_id: pick.voice_id, public_owner_id: pick.public_owner_id, name,
      accent: pick.accent, gender: pick.gender, description: pick.description, preview_url: pick.preview_url, sort: 10 + i }, { onConflict: "voice_id" });
    found.push(name);
  }
  return ok({ found, missing });
}

/** Suggestions with no typing: what your saved voices have in common (gender, accent, tone words), searched in the library, minus what you already have. */
const TONE = ["warm", "friendly", "conversational", "casual", "youthful", "clear", "natural", "confident", "smooth", "bright", "calm", "relaxed", "upbeat", "sweet", "professional", "crisp"];
async function suggest(): Promise<Response> {
  const key = await vault("elevenlabs_api_key");
  if (!key) return err("The ElevenLabs key is missing from Vault.", 412);
  const { data: favs } = await db.from("ava_voice_favorites").select("voice_id, name, accent, gender, description").neq("voice_id", LILY);
  const rows = favs ?? [];
  if (!rows.length) return ok({ voices: [], based_on: [] });
  const tally = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs.filter(Boolean)) m.set(x.toLowerCase(), (m.get(x.toLowerCase()) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]); };
  const gender = tally(rows.map((r) => r.gender ?? ""))[0] ?? "female";
  const accents = tally(rows.map((r) => r.accent ?? "")).slice(0, 2);
  const words = tally(rows.flatMap((r) => TONE.filter((w) => (r.description ?? "").toLowerCase().includes(w)))).slice(0, 3);
  const queries = [...words.map((w) => `${gender} ${w}`), ...accents.map((a) => `${a} ${gender}`)].slice(0, 5);
  if (!queries.length) queries.push(`${gender} conversational`);
  const have = new Set([...(await Promise.all([currentOf("ava"), currentOf("rg")])).map((c) => c.voice_id), ...rows.map((r) => r.voice_id), LILY]);
  const names = new Set(rows.map((r) => r.name.toLowerCase()));
  const pool = new Map<string, ReturnType<typeof slim> & { score: number }>();
  for (const batch of await Promise.all(queries.map((q) => search(key, q)))) for (const v of batch) {
    if (!v.voice_id || have.has(v.voice_id) || names.has(v.name.toLowerCase()) || (v.gender && v.gender !== gender)) continue;
    const d = `${v.description} ${v.accent}`.toLowerCase();
    const score = words.filter((w) => d.includes(w)).length * 3 + accents.filter((a) => d.includes(a)).length * 2 + (pool.get(v.voice_id)?.score ?? 0) / 2;
    pool.set(v.voice_id, { ...v, score: Math.max(score, pool.get(v.voice_id)?.score ?? 0) + 1 });
  }
  const voices = [...pool.values()].sort((a, b) => b.score - a.score || b.usage - a.usage).slice(0, 6);
  return ok({ voices, based_on: [gender, ...accents, ...words] });
}

async function say(b: Record<string, unknown>): Promise<Response> {
  const voice = String(b.voice_id ?? ""), text = String(b.text ?? "").replace(/\s+/g, " ").trim();
  if (!VOICE_ID.test(voice)) return err("Pick a voice first.");
  if (!text) return err("Type something for her to say.");
  if (text.length > 240) return err("Keep it to 240 characters.");
  const key = await vault("elevenlabs_api_key");
  if (!key) return err("The ElevenLabs key is missing from Vault.", 412);
  const t = await db.rpc("ava_voice_say_take", { p_source: "ava", p_cap: SAY_CAP });
  if (t.error || !t.data) return err("Couldn't check today's sample limit. Try again.", 500);
  if (t.data.ok !== true) return err(`That's all ${SAY_CAP} samples for today. They reset at midnight Pacific.`, 429);
  const res = await fetch(`${XI}/text-to-speech/${voice}?output_format=mp3_44100_64`, { method: "POST", headers: xiH(key), body: JSON.stringify({ text, model_id: "eleven_flash_v2" }) });
  if (!res.ok || !res.body) {
    // a failed sample doesn't count
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    await db.from("ava_voice_usage").update({ says: Math.max(0, (t.data.says ?? 1) - 1) }).eq("source", "ava").eq("day", day);
    await res.text().catch(() => "");
    // a shared voice not yet in the account can still be sampled by id on most plans; if not, say so plainly
    return err(res.status === 404 || res.status === 400 ? "That voice can't be sampled yet. Use it once, or pick another." : "The voice platform couldn't make that sample. Try again.", res.status === 404 ? 404 : 502);
  }
  return new Response(res.body, { headers: { ...CORS, "content-type": "audio/mpeg", "cache-control": "no-store", "x-says-left": String(Math.max(0, SAY_CAP - (t.data.says ?? SAY_CAP))) } });
}

/** Point one Ava at a voice: agent first (fast fail), then settings, then history. */
async function apply(key: string, src: Src, voiceId: string, name: string): Promise<string | null> {
  const cur = await currentOf(src);
  if (cur.agent_id) {
    const pr = await fetch(`${XI}/convai/agents/${cur.agent_id}`, { method: "PATCH", headers: xiH(key), body: JSON.stringify({ conversation_config: { tts: tts(voiceId) } }) });
    if (!pr.ok) { await pr.text().catch(() => ""); return `${LABEL[src]}: the voice platform wouldn't switch her voice.`; }
  }
  const now = new Date().toISOString();
  const tbl = src === "ava" ? "ava_settings" : "rg_settings";
  const { error } = await db.from(tbl).update(src === "ava" ? { voice_id: voiceId, updated_at: now } : { voice_id: voiceId, updated_at: now, updated_by: "ava-voices" }).eq("id", true);
  if (error) return `${LABEL[src]}: switched on the platform but couldn't save it (${error.message}).`;
  if (cur.voice_id !== voiceId) await db.from("ava_voice_history").insert({ source: src, voice_id: voiceId, name });
  return null;
}

async function use(b: Record<string, unknown>): Promise<Response> {
  const vid = String(b.voice_id ?? ""), owner = String(b.public_owner_id ?? ""), name = trimTo(b.name, 60) || "Voice";
  const which = String(b.source ?? "ava");
  const srcs: Src[] = which === "both" ? ["ava", "rg"] : which === "rg" ? ["rg"] : ["ava"];
  if (!VOICE_ID.test(vid) || (owner && !VOICE_ID.test(owner))) return err("Pick a voice first.");
  const key = await vault("elevenlabs_api_key");
  if (!key) return err("The ElevenLabs key is missing from Vault.", 412);

  let useId = vid;
  const have = await voiceInfo(key, vid);
  if (have.status !== 200 && owner) {
    const r = await fetch(`${XI}/voices/add/${owner}/${vid}`, { method: "POST", headers: xiH(key), body: JSON.stringify({ new_name: `Ava – ${name}` }) });
    const t = await r.text().catch(() => "");
    if (r.ok) { try { useId = JSON.parse(t).voice_id ?? vid; } catch { /* keep vid */ } }
    else if (!(r.status === 400 && /already/i.test(t))) {
      if (/voice_limit|limit.{0,30}(reached|exceeded)|maximum.{0,20}voices/i.test(t)) return err("Your voice library is full. Remove a voice you don't use in ElevenLabs, then try again.", 409);
      if (r.status === 401 || r.status === 402 || r.status === 403) return err("Your ElevenLabs plan won't let this voice be added.", 402);
      return err("Couldn't add that voice to your library. Try again, or pick another.", 502);
    }
  } else if (have.status !== 200) return err("That voice isn't in your account. Reload the list and try again.", 404);
  const check = await voiceInfo(key, useId);
  if (check.status !== 200) return err("That voice isn't in your account. Reload the list and try again.", 404);
  if (check.v?.category === "cloned") return err("A cloned voice can't be her default voice. Use the Use my voice switch in the dialer.", 409);

  const problems: string[] = [];
  for (const s of srcs) { const p = await apply(key, s, useId, name); if (p) problems.push(p); }
  // the favorite keeps pointing at the id the agents now use (a shared voice gets a new id once it's added)
  if (useId !== vid) await db.from("ava_voice_favorites").update({ voice_id: useId, public_owner_id: null }).eq("voice_id", vid);
  return problems.length === srcs.length ? err(problems.join(" "), 502) : ok({ voice_id: useId, name, applied: srcs.filter((_, i) => !problems[i]), problems });
}

async function health(): Promise<Response> {
  const key = await vault("elevenlabs_api_key");
  if (!key) return ok({ skipped: "no ElevenLabs key" });
  const notes: string[] = [], hour = new Date().toISOString().slice(0, 13);
  for (const src of ["ava", "rg"] as Src[]) {
    const cur = await currentOf(src);
    const info = await voiceInfo(key, cur.voice_id);
    if (!info.missing) continue;                       // fine, or couldn't tell (a network blip is never "fixed" on a guess)
    const { data: hist } = await db.from("ava_voice_history").select("voice_id, name").eq("source", src).neq("voice_id", cur.voice_id).order("used_at", { ascending: false }).limit(5);
    let back = { voice_id: LILY, name: "Lily" };
    for (const h of hist ?? []) { if ((await voiceInfo(key, h.voice_id)).status === 200) { back = h; break; } }
    const problem = await apply(key, src, back.voice_id, back.name);
    notes.push(`${LABEL[src]}'s voice went missing; ${problem ? "couldn't switch her back" : `back on ${back.name}`}`);
    await db.rpc("scout_notify", { p_title: `${LABEL[src]}: her voice went missing, switched to ${back.name}`,
      p_body: problem ? `${problem} Pick a new voice in the switcher.` : `The voice she was using no longer exists in the account. She's on ${back.name} again. Pick another in the switcher.`,
      p_severity: problem ? "high" : "warning", p_push: true, p_url: URL_OF[src], p_dedupe: `ava-voices-missing-${src}-${hour}` });
  }
  return ok({ notes });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req))) return new Response("unauthorized", { status: 401, headers: CORS });
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "list": return await list();
      case "seed": return await seed();
      case "find": {
        const key = await vault("elevenlabs_api_key");
        if (!key) return err("The ElevenLabs key is missing from Vault.", 412);
        const q = trimTo(b.query, 40);
        if (q.length < 2) return err("Type at least two letters.");
        return ok({ voices: (await search(key, q)).slice(0, 12) });
      }
      case "add_favorite": {
        const v = (b.voice ?? {}) as Raw;
        if (!VOICE_ID.test(String(v.voice_id ?? ""))) return err("Pick a voice first.");
        const { error } = await db.from("ava_voice_favorites").upsert({ voice_id: String(v.voice_id), public_owner_id: v.public_owner_id ? String(v.public_owner_id) : null,
          name: trimTo(v.name, 60) || "Voice", accent: trimTo(v.accent, 30), gender: trimTo(v.gender, 20), description: trimTo(v.description, 120),
          preview_url: v.preview_url ? String(v.preview_url) : null, sort: 100 }, { onConflict: "voice_id" });
        return error ? err("Couldn't save that voice.", 500) : ok({});
      }
      case "remove_favorite": {
        const { error } = await db.from("ava_voice_favorites").delete().eq("voice_id", String(b.voice_id ?? ""));
        return error ? err("Couldn't remove that voice.", 500) : ok({});
      }
      case "suggest": return await suggest();
      case "say": return await say(b);
      case "use": return await use(b);
      case "health": return await health();
      default: return err("unknown action");
    }
  } catch (e) {
    return err(`Something went wrong (${e instanceof Error ? e.message : "error"}).`, 500);
  }
});
