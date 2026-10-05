// ava-voicebank — Jared's Pro voice clone, fed from his own mic track in every recorded meeting (2026-10-05).
//
// Caller: the meeting recorder agent on the Mac mini (scripts/meetingrec/voicebank.py), header x-recorder-key, checked
// against meeting_recorder_state.key_sha256 exactly like meeting-recorder. The Mac does the cutting (free, local): only
// Jared's mic, only while the far end is silent, no clipping, wideband mic. Eli's voice never reaches this function.
//
//   {op:"state"}                          what's banked, what was skipped, whether the bank takes more
//   {op:"skip", meeting, why}             remember a meeting with nothing usable, so it isn't cut again
//   {op:"upload_url", meeting, part}      signed upload into the private ava-voice bucket (pvc/<meeting>-<part>.m4a)
//   {op:"commit", meeting, part, seconds, score}
//                                         storage -> ElevenLabs Pro clone sample; raw file deleted right after.
//                                         Bank cap 3 h: past it, a better clip replaces the weakest ones.
//   {op:"tick"}                           hourly: plan check, voice check (one-time verification), train / retrain,
//                                         switch Ava's "Use my voice" once the trained voice really speaks on her
//                                         phone model. Every alert is signed by Ava.
//
// The quick clone stays live until the switch and is kept as the fallback (ava_settings.jared_ivc_voice_id).
// verify_jwt is off (agent auth is done here), same as meeting-recorder.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const XI = "https://api.elevenlabs.io/v1";
const PHONE_MODEL = "eleven_flash_v2";          // Ava's phone model (ava-assistant ttsConfig)
const MIN_TRAIN_S = 30 * 60;                    // ElevenLabs asks for 30+ minutes for a Pro clone
const CAP_S = 3 * 3600;                         // more than ~3 h doesn't help; past it, better clips replace weaker ones
const RETRAIN_GROWTH_S = 30 * 60;               // retrain once 30+ new minutes are in...
const RETRAIN_EVERY_MS = 7 * 24 * 3600_000;     // ...and the last training is a week old
const URL_ADMIN = "https://bestly.tech/admin/ava";
const VERIFY_URL = "https://elevenlabs.io/app/voice-lab";
const SAMPLE_LINE = "Hey, it's Jared's AI assistant, using his voice. He asked me to give you a quick call.";

const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const NAME_RE = /^meeting-\d{8}-\d{4}[a-z0-9-]*$/;

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function xiKey(): Promise<string | null> {
  const { data, error } = await db.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  return error || typeof data !== "string" || !data ? null : data;
}
const xh = (key: string, json = true): Record<string, string> => (json ? { "xi-api-key": key, "Content-Type": "application/json" } : { "xi-api-key": key });

type S = {
  jared_voice_id: string | null; jared_pvc_voice_id: string | null; jared_ivc_voice_id: string | null; pvc_state: string;
  pvc_trained_seconds: number; pvc_last_train_at: string | null; pvc_live_at: string | null;
};
async function settings(): Promise<S> {
  const { data } = await db.from("ava_settings")
    .select("jared_voice_id, jared_pvc_voice_id, jared_ivc_voice_id, pvc_state, pvc_trained_seconds, pvc_last_train_at, pvc_live_at")
    .eq("id", true).single();
  return data as S;
}
async function setS(patch: Record<string, unknown>) {
  await db.from("ava_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", true);
}
async function notify(title: string, body: string, severity: "info" | "warning" | "high", dedupe: string, push = true) {
  await db.rpc("scout_notify", { p_title: `Ava (assistant): ${title}`, p_body: body, p_severity: severity, p_push: push, p_url: URL_ADMIN, p_dedupe: dedupe });
}
async function bankSeconds(): Promise<number> {
  const { data } = await db.from("ava_voice_bank").select("seconds");
  return (data ?? []).reduce((a, r) => a + Number(r.seconds || 0), 0);
}
const mins = (s: number) => `${Math.round(s / 60)} min`;
const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} hr ${Math.round((s % 3600) / 60)} min` : mins(s));

/** The Pro clone in ElevenLabs, created on first use. */
async function ensurePvc(key: string): Promise<string> {
  const s = await settings();
  if (s.jared_pvc_voice_id) return s.jared_pvc_voice_id;
  const r = await fetch(`${XI}/voices/pvc`, {
    method: "POST", headers: xh(key),
    body: JSON.stringify({ name: "Jared (Ava assistant, Pro)", language: "en",
      description: "Jared's own voice, learned from his own mic in his meetings. For his AI assistant; always disclosed as AI." }),
  });
  const t = await r.text();
  let j: { voice_id?: string } = {}; try { j = JSON.parse(t); } catch { /* not json */ }
  if (!r.ok || !j.voice_id) {
    if (r.status === 401 || r.status === 402 || r.status === 403 || /professional|subscription|plan/i.test(t)) {
      await setS({ pvc_state: "no_plan", pvc_note: "Your ElevenLabs plan doesn't include the Pro clone (Creator or higher)." });
      throw new Error("no_plan");
    }
    throw new Error(`create failed ${r.status}: ${t.slice(0, 200)}`);
  }
  await setS({ jared_pvc_voice_id: j.voice_id, pvc_state: "collecting", pvc_note: "Pro clone created. Collecting your voice." });
  return j.voice_id;
}

async function removeSample(key: string, voice: string, sampleId: string) {
  const r = await fetch(`${XI}/voices/pvc/${voice}/samples/${sampleId}`, { method: "DELETE", headers: xh(key, false) });
  await r.text().catch(() => "");
  return r.ok || r.status === 404;
}

async function opState() {
  const [{ data: bank }, { data: skips }, s] = await Promise.all([
    db.from("ava_voice_bank").select("meeting, part, seconds, score"),
    db.from("ava_voice_bank_skips").select("meeting"),
    settings(),
  ]);
  const total = (bank ?? []).reduce((a, r) => a + Number(r.seconds || 0), 0);
  const weakest = (bank ?? []).reduce((m, r) => Math.min(m, Number(r.score ?? 0)), Infinity);
  return J({
    ok: true, total_sec: total, cap_sec: CAP_S, state: s?.pvc_state ?? "collecting",
    done: [...new Set([...(bank ?? []).map((r) => r.meeting), ...(skips ?? []).map((r) => r.meeting)])],
    weakest_score: Number.isFinite(weakest) ? weakest : null,
  });
}

async function opCommit(b: Record<string, unknown>) {
  const meeting = String(b.meeting ?? ""), part = Number(b.part ?? 1);
  const seconds = Number(b.seconds ?? 0), score = Number(b.score ?? 0);
  if (!NAME_RE.test(meeting) || !(part >= 1 && part <= 20) || !(seconds > 5 && seconds < 1500)) return J({ ok: false, error: "bad input" }, 400);
  const path = `pvc/${meeting}-${part}.m4a`;
  const drop = () => db.storage.from("ava-voice").remove([path]);
  if ((await settings()).pvc_state === "paused") { await drop(); return J({ ok: true, kept: false, why: "paused" }); }
  const key = await xiKey();
  if (!key) { await drop(); return J({ ok: false, error: "ElevenLabs key missing from Vault" }, 412); }

  // over the cap: only a clip that beats the weakest ones gets in, and they go out
  const total = await bankSeconds();
  if (total + seconds > CAP_S) {
    const { data: weak } = await db.from("ava_voice_bank").select("id, seconds, score, xi_sample_id").lt("score", score).order("score", { ascending: true });
    let freed = 0; const out: { id: string; seconds: number; score: number; xi_sample_id: string | null }[] = [];
    for (const w of weak ?? []) { if (total - freed + seconds <= CAP_S) break; freed += Number(w.seconds); out.push(w); }
    if (total - freed + seconds > CAP_S) { await drop(); return J({ ok: true, kept: false, why: "bank full; not better than what's there" }); }
    const s = await settings();
    for (const w of out) {
      if (s.jared_pvc_voice_id && w.xi_sample_id) await removeSample(key, s.jared_pvc_voice_id, w.xi_sample_id);
      await db.from("ava_voice_bank").delete().eq("id", w.id);
    }
  }

  let voice: string;
  try { voice = await ensurePvc(key); } catch (e) { await drop(); return J({ ok: false, error: (e as Error).message }, 402); }
  const dl = await db.storage.from("ava-voice").download(path);
  if (dl.error || !dl.data) return J({ ok: false, error: "upload not found" }, 404);
  const form = new FormData();
  form.append("files", new File([dl.data], `${meeting}-${part}.m4a`, { type: "audio/mp4" }));
  form.append("remove_background_noise", "false");
  const r = await fetch(`${XI}/voices/pvc/${voice}/samples`, { method: "POST", headers: xh(key, false), body: form });
  const t = await r.text();
  await drop();                                        // the raw clip never sits around
  if (!r.ok) return J({ ok: false, error: `ElevenLabs ${r.status}: ${t.slice(0, 300)}` }, 502);
  let j: unknown = {}; try { j = JSON.parse(t); } catch { /* */ }
  const first = Array.isArray(j) ? j[0] : j;
  const sampleId = (first as { sample_id?: string })?.sample_id ?? null;
  await db.from("ava_voice_bank").upsert({ meeting, part, seconds, score, xi_sample_id: sampleId, added_at: new Date().toISOString() }, { onConflict: "meeting,part" });
  const now = await bankSeconds();
  await setS({ pvc_note: `Added ${mins(seconds)} from ${meeting}. ${hm(now)} of your voice banked.` });
  return J({ ok: true, kept: true, total_sec: now });
}

type Voice = {
  fine_tuning?: { state?: Record<string, string>; is_allowed_to_fine_tune?: boolean; manual_verification_requested?: boolean };
  voice_verification?: { requires_verification?: boolean; is_verified?: boolean };
};

async function speaks(key: string, voice: string): Promise<boolean> {
  const r = await fetch(`${XI}/text-to-speech/${voice}?output_format=mp3_22050_32`, {
    method: "POST", headers: xh(key), body: JSON.stringify({ text: SAMPLE_LINE, model_id: PHONE_MODEL }),
  });
  const ok = r.ok && (r.headers.get("content-type") ?? "").includes("audio");
  await r.arrayBuffer().catch(() => null);
  return ok;
}

async function opTick() {
  const nowIso = new Date().toISOString();
  await setS({ pvc_checked_at: nowIso });
  const s = await settings();
  if (s.pvc_state === "paused") return J({ ok: true, state: "paused" });   // he deleted his voice; nothing until he records again
  const total = await bankSeconds();
  const day = nowIso.slice(0, 10);
  const key = await xiKey();
  if (!key) return J({ ok: false, error: "ElevenLabs key missing from Vault" }, 412);

  // plan check (cheap, and the reason a Pro clone can't start)
  const sub = await fetch(`${XI}/user/subscription`, { headers: xh(key, false) }).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (sub && sub.can_use_professional_voice_cloning === false) {
    await setS({ pvc_state: "no_plan", pvc_note: `${hm(total)} of your voice is banked. Your ElevenLabs plan needs Creator or higher for the Pro clone.` });
    await notify("your Pro voice needs a plan upgrade", `I've banked ${hm(total)} of your voice from your meetings, but your ElevenLabs plan doesn't include the Pro clone. Creator or higher turns it on; I'll pick it up on my own after that.`,
      "warning", `ava-pvc-noplan-${nowIso.slice(0, 8)}`);
    return J({ ok: true, state: "no_plan" });
  }
  if (s.pvc_state === "no_plan") await setS({ pvc_state: "collecting" });

  if (!s.jared_pvc_voice_id || total < MIN_TRAIN_S) {
    await setS({ pvc_state: "collecting", pvc_note: `${hm(total)} of your voice banked. Training starts at 30 min.` });
    return J({ ok: true, state: "collecting", total_sec: total });
  }

  const vr = await fetch(`${XI}/voices/${s.jared_pvc_voice_id}`, { headers: xh(key, false) });
  if (vr.status === 404 || vr.status === 400) {
    // the Pro clone was removed in ElevenLabs: start over, keep the quick clone live
    await db.from("ava_voice_bank").delete().neq("meeting", "");
    await db.from("ava_voice_bank_skips").delete().neq("meeting", "");
    const back = s.jared_voice_id === s.jared_pvc_voice_id ? s.jared_ivc_voice_id : s.jared_voice_id;
    await setS({ jared_pvc_voice_id: null, jared_voice_id: back, pvc_state: "collecting", pvc_trained_seconds: 0, pvc_last_train_at: null, pvc_live_at: null,
      pvc_note: "The Pro clone was gone from ElevenLabs. Back on the quick clone; rebuilding from your meetings." });
    await notify("your Pro voice went missing, rebuilding it", "It's no longer in ElevenLabs. Calls use your quick clone again, and I'm rebuilding the Pro one from your meeting recordings.", "warning", `ava-pvc-missing-${day}`);
    return J({ ok: true, state: "rebuilding" });
  }
  const v: Voice = vr.ok ? await vr.json() : {};
  const states = v.fine_tuning?.state ?? {};
  const phone = states[PHONE_MODEL];
  const busy = Object.values(states).some((x) => /fine_tuning|queued|training/i.test(String(x)));

  if (v.voice_verification?.requires_verification && !v.voice_verification?.is_verified) {
    await setS({ pvc_state: "needs_verify", pvc_note: `${hm(total)} banked. Waiting on your one-time voice check in ElevenLabs.` });
    await notify("one 30-second voice check and your Pro voice can train",
      `I've banked ${hm(total)} of your voice from your meetings. ElevenLabs needs you to read one short line, once, to prove it's you: open ${VERIFY_URL}, pick "Jared (Ava assistant, Pro)", and do the voice check. I'll train it as soon as that's done.`,
      "info", `ava-pvc-verify-${day}`);
    return J({ ok: true, state: "needs_verify" });
  }

  if (busy) {
    await setS({ pvc_state: s.pvc_state === "live" ? "live" : "training", pvc_note: `Training on ${hm(s.pvc_trained_seconds || total)} of your voice.` });
    return J({ ok: true, state: "training" });
  }

  // train the first time, then retrain when 30+ new minutes are in and a week has passed
  const neverTrained = !s.pvc_last_train_at;
  const grew = total - Number(s.pvc_trained_seconds || 0) >= RETRAIN_GROWTH_S;
  const old = !s.pvc_last_train_at || Date.now() - Date.parse(s.pvc_last_train_at) >= RETRAIN_EVERY_MS;
  if (neverTrained || (grew && old && Object.values(states).includes("fine_tuned"))) {
    let tr = await fetch(`${XI}/voices/pvc/${s.jared_pvc_voice_id}/train`, { method: "POST", headers: xh(key), body: JSON.stringify({ model_id: PHONE_MODEL }) });
    let tt = await tr.text();
    if (!tr.ok && tr.status === 422) {        // model not offered for Pro training: train the default, the speak test decides
      tr = await fetch(`${XI}/voices/pvc/${s.jared_pvc_voice_id}/train`, { method: "POST", headers: xh(key), body: "{}" });
      tt = await tr.text();
    }
    if (!tr.ok) {
      if (/verif/i.test(tt)) {
        await setS({ pvc_state: "needs_verify", pvc_note: "Waiting on your one-time voice check in ElevenLabs." });
        await notify("one 30-second voice check and your Pro voice can train",
          `ElevenLabs needs you to read one short line, once: open ${VERIFY_URL}, pick "Jared (Ava assistant, Pro)", and do the voice check.`, "info", `ava-pvc-verify-${day}`);
        return J({ ok: true, state: "needs_verify" });
      }
      await setS({ pvc_note: `Training didn't start (${tr.status}). I'll retry next hour.` });
      return J({ ok: false, error: `train ${tr.status}: ${tt.slice(0, 300)}` }, 502);
    }
    await setS({ pvc_state: s.pvc_state === "live" ? "live" : "training", pvc_trained_seconds: total, pvc_last_train_at: nowIso,
      pvc_note: `${neverTrained ? "Training" : "Retraining"} on ${hm(total)} of your voice.` });
    if (!neverTrained) await notify(`retraining your Pro voice on ${hm(total)}`, `More of your meetings are in. Calls keep your current voice until the new one is done.`, "info", `ava-pvc-retrain-${day}`, false);
    return J({ ok: true, state: "training" });
  }

  // trained: switch "Use my voice" over, but only once it really speaks on her phone model
  if (phone === "fine_tuned" || Object.values(states).includes("fine_tuned")) {
    const fresh = s.pvc_last_train_at && (!s.pvc_live_at || Date.parse(s.pvc_live_at) < Date.parse(s.pvc_last_train_at));
    if (s.jared_voice_id !== s.jared_pvc_voice_id || fresh) {
      if (!(await speaks(key, s.jared_pvc_voice_id))) {
        await setS({ pvc_note: `Trained, but it won't speak on Ava's phone model yet. Your quick clone stays on.` });
        await notify("your Pro voice trained but can't run on calls yet", `It trained on ${hm(Number(s.pvc_trained_seconds || total))}, but it doesn't speak on the phone model I use, so calls stay on your quick clone. I'll keep checking.`,
          "warning", `ava-pvc-nospeak-${day}`);
        return J({ ok: true, state: "trained_not_speaking" });
      }
      // only once the deployed ava-assistant has the Pro-clone guard (a re-record must never delete it): it stamps
      // pvc_guard_at on every line check. Until then the quick clone stays on and the switch waits.
      const { data: g } = await db.from("ava_settings").select("pvc_guard_at").eq("id", true).single();
      if (!g?.pvc_guard_at || Date.now() - Date.parse(g.pvc_guard_at) > 24 * 3600_000) {
        await setS({ pvc_note: `Trained and ready. Switching once Ava's latest update is deployed.` });
        if (!s.pvc_live_at && s.pvc_last_train_at && Date.now() - Date.parse(s.pvc_last_train_at) > 2 * 24 * 3600_000) {
          await db.rpc("bestly_raise", { p_key: "recorder.voicebank_guard", p_kind: "problem", p_severity: "warning", p_area: "recorder", p_needs_jared: null, p_healed: false,
            p_title: "Voice Coach: Jared's Pro voice is trained but waiting on an ava-assistant deploy",
            p_body: "Deploy supabase/functions/ava-assistant from main (it has the Pro-clone guard and stamps ava_settings.pvc_guard_at). The switch happens on the next hourly tick." }).then(() => {}, () => {});
        }
        return J({ ok: true, state: "trained_waiting_guard" });
      }
      const keepIvc = s.jared_voice_id && s.jared_voice_id !== s.jared_pvc_voice_id ? s.jared_voice_id : s.jared_ivc_voice_id;
      await setS({ jared_ivc_voice_id: keepIvc, jared_voice_id: s.jared_pvc_voice_id, pvc_state: "live", pvc_live_at: nowIso,
        pvc_note: `Live. Trained on ${hm(Number(s.pvc_trained_seconds || total))} of your voice.` });
      await notify(s.pvc_live_at ? "your Pro voice got better" : "your Pro voice is live",
        `"Use my voice" now uses the Pro clone, trained on ${hm(Number(s.pvc_trained_seconds || total))} of your own voice from your meetings. Hear it with the sample button at /admin/ava. Your quick clone is kept as the backup.`,
        "info", `ava-pvc-live-${nowIso.slice(0, 13)}`);
      return J({ ok: true, state: "live" });
    }
    await setS({ pvc_state: "live", pvc_note: `Live. Trained on ${hm(Number(s.pvc_trained_seconds || total))}; ${hm(total)} banked.` });
    return J({ ok: true, state: "live" });
  }

  await setS({ pvc_note: `${hm(total)} banked. Waiting on ElevenLabs.` });
  return J({ ok: true, state: s.pvc_state });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const key = req.headers.get("x-recorder-key") ?? "";
  const { data: row } = await db.from("meeting_recorder_state").select("key_sha256").eq("id", 1).single();
  if (!key || !row?.key_sha256 || (await sha256(key)) !== row.key_sha256) return J({ ok: false, error: "bad key" }, 401);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  try {
    switch (b.op) {
      case "state": return await opState();
      case "skip": {
        const meeting = String(b.meeting ?? "");
        if (!NAME_RE.test(meeting)) return J({ ok: false, error: "bad meeting" }, 400);
        await db.from("ava_voice_bank_skips").upsert({ meeting, why: String(b.why ?? "").slice(0, 200), at: new Date().toISOString() });
        return J({ ok: true });
      }
      case "upload_url": {
        const meeting = String(b.meeting ?? ""), part = Number(b.part ?? 1);
        if (!NAME_RE.test(meeting) || !(part >= 1 && part <= 20)) return J({ ok: false, error: "bad input" }, 400);
        const { data, error } = await db.storage.from("ava-voice").createSignedUploadUrl(`pvc/${meeting}-${part}.m4a`, { upsert: true });
        return error ? J({ ok: false, error: error.message }, 500) : J({ ok: true, url: data.signedUrl });
      }
      case "commit": return await opCommit(b);
      case "tick": return await opTick();
      default: return J({ ok: false, error: `unknown op ${b.op}` }, 400);
    }
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});
