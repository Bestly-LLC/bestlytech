// free-llm — canary + self-test for _shared/free-llm.ts (docs/scout-free-llm-opusplan.md).
//   op canary   probe every enabled free provider with a 20-token JSON prompt; clear cooldowns that pass;
//               raise/resolve ai.free.<provider> incidents. Cron 5:30 AM LA (free-llm-canary).
//   op test     run the phase-1 checks (routing, privacy, size, scrub, each provider, fallback).
//   op run      {task, system, user, json?, privacy?, paid?} one llm() call, for manual checks.
//   op fallback_selftest  2026-10-27: builds the "every free AI is out" reply from made-up and live data and checks it (per-provider reasons,
//               one provider to connect with its key location, 12-hour times, paid offer only when allowed, candidate list matches the table);
//               raises/resolves scout.free_fallback.selftest_message (signed by Scout). Cron scout-free-fallback-selftest (commented in the migration).
// Auth: service key (apikey or Bearer) or an admin JWT. verify_jwt = false (new sb_secret keys are not JWTs).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";
import { llm, llmProbe, LlmUnavailable, scrub, outOfRoomMessage } from "../_shared/free-llm.ts";
import { buildOutOfRoom, checkRoomMessage, CANDIDATES, cleanHistory, isStatusNote, looksLikeStatusParrot, waitingNote, type ProviderRow, type TriedLite } from "../_shared/free-llm-status.ts";

const secretKeys = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const SECRET = secretKeys[0];
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRET, { auth: { persistSession: false }, global: { headers: { apikey: SECRET } } });

const CORS = corsWith({
  headers: "authorization, content-type, apikey, x-client-info",
  methods: "POST, OPTIONS"
});
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o, null, 1), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function authorized(req: Request) {
  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secretKeys.includes(apikey) || secretKeys.includes(bearer)) return true;
  if (!bearer || bearer.split(".").length !== 3) return false;
  const { data } = await db.auth.getUser(bearer);
  if (!data?.user) return false;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return !!ok;
}

async function canary() {
  const { data: provs } = await db.from("llm_providers").select("name, enabled").neq("name", "anthropic");
  const results = [];
  for (const p of (provs ?? []).filter((x: any) => x.enabled)) {
    const r = await llmProbe(p.name);
    results.push(r);
    if (r.ok) await db.rpc("bestly_raise", { p_key: `ai.free.${p.name}`, p_kind: "resolved", p_title: `Free AI: ${p.name} working again` });
    else if (!/skipped/.test(r.error ?? "")) {
      await db.rpc("bestly_raise", { p_key: `ai.free.${p.name}`, p_kind: "problem", p_severity: "warning", p_title: `Free AI: ${p.name} failed its morning check`,
        p_body: `${r.error}. Scout uses the next provider in the chain meanwhile.`, p_area: "ai", p_healed: true });
    }
  }
  await db.rpc("free_llm_watch");
  return results;
}

async function fallbackSelftest() {
  const bad: string[] = [];
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const rows: ProviderRow[] = [
    { name: "freellm", enabled: true, private_ok: true, last_ok_at: iso(20 * 3600_000), cooldown_until: iso(-600_000), cooldown_reason: "freellm_watch: Couldn't resolve host name",
      last_error: `${iso(1800_000)} error: error sending request: dns error: failed to lookup address information` },
    { name: "groq", enabled: true, private_ok: true, last_ok_at: iso(300_000) },
    { name: "cloudflare", enabled: true, private_ok: true, daily_cap: 9000, last_ok_at: iso(3600_000) },
    { name: "gemini", enabled: true, private_ok: false },
    { name: "local", enabled: true, private_ok: true },
  ];
  const tried: TriedLite[] = [
    { provider: "freellm", model: "gpt-oss-120b", outcome: "skipped_off" },
    { provider: "groq", model: "openai/gpt-oss-120b", outcome: "rate_limited" },
    { provider: "cloudflare", model: "@cf/openai/gpt-oss-120b", outcome: "skipped_budget" },
  ];
  const a = buildOutOfRoom({ rows, tried, now, noPaid: false, hints: { modelSkipUntil: { "openai/gpt-oss-120b": now + 90_000 } } });
  bad.push(...checkRoomMessage(a, { noPaid: false, expectOffline: "freellm" }).map((x) => `made-up data: ${x}`));
  const b = buildOutOfRoom({ rows, tried, now, noPaid: true });
  bad.push(...checkRoomMessage(b, { noPaid: true }).map((x) => `no-paid thread: ${x}`));
  // 2026-10-28: the parked-run note is what Jared sees when every provider is out. No paid offer, no buttons, never fed back to a model.
  const sized: TriedLite[] = [...tried.filter((t) => t.provider !== "groq"), { provider: "groq", model: "openai/gpt-oss-120b", outcome: "skipped_size", need: 9400, max: 7000 }];
  const w = waitingNote(buildOutOfRoom({ rows, tried: sized, now, noPaid: true }), 0);
  const wFlat = w.replace(/[\u00a0\u202f]/g, " ");
  if (!wFlat.startsWith("Working: waiting for the free AI")) bad.push("waiting note does not start as an in-place Working note");
  if (/paid ai|OPTIONS|\.\.\.|\u2026|undefined|NaN/i.test(wFlat)) bad.push("waiting note offers paid AI, has buttons, or has junk");
  if (!/Groq cannot take this step/.test(wFlat) || !/offline since/.test(wFlat)) bad.push("waiting note lacks the per-provider reasons (size / offline)");
  if (!isStatusNote(w)) bad.push("waiting note would be fed back to a model");
  if (cleanHistory([{ role: "assistant", body: "Free AI is out of room until 2:16 PM. Please choose to use paid AI or wait." }, { role: "user", body: "hi" }]).length !== 1) bad.push("status note not dropped from model context");
  if (!looksLikeStatusParrot("Free AI is out of room until 2:16 PM. Please choose to use paid AI or wait.")) bad.push("a parroted out-of-room reply is not caught");
  try {
    const live = await outOfRoomMessage({ tried: [], noPaid: false });
    bad.push(...checkRoomMessage(live, { noPaid: false }).map((x) => `live data: ${x}`));
  } catch (e) { bad.push(`live build threw: ${(e as Error).message}`); }
  // The candidate table (what the autoconnect SQL reads) must match the list the code recommends from.
  const { data, error } = await db.from("llm_provider_candidates").select("name, key_name, base_url, model, rank").order("rank");
  if (error) bad.push(`llm_provider_candidates unreadable: ${error.message}`);
  else {
    const t = (data ?? []).map((r: any) => `${r.name}|${r.key_name}|${r.base_url}|${r.model}`).join(",");
    const c = CANDIDATES.map((x) => `${x.name}|${x.keyName}|${x.baseUrl}|${x.model}`).join(",");
    if (t !== c) bad.push("llm_provider_candidates does not match CANDIDATES in free-llm-status.ts");
  }
  if (bad.length) {
    await db.rpc("bestly_raise", { p_key: "scout.free_fallback.selftest_message", p_kind: "problem", p_severity: "warning", p_title: "Scout's free-AI fallback message failed its self-test",
      p_body: bad.join("; ").slice(0, 600), p_area: "ai", p_healed: false });
  } else {
    await db.rpc("bestly_raise", { p_key: "scout.free_fallback.selftest_message", p_kind: "resolved", p_severity: "info", p_title: "Scout's free-AI fallback message passes its self-test" });
  }
  return { ok: bad.length === 0, problems: bad, sample: a.text.replace(/\u00a0/g, " ").slice(0, 900), options: a.options };
}

async function test() {
  const out: Record<string, unknown> = {};
  const check = (name: string, pass: boolean, detail?: unknown) => { out[name] = { pass, detail }; };

  // 1. scrub
  const s = scrub('key sk-ant-api03-abcdefghijklmnopqrstuvwxyz and "api_key": "abcd1234abcd1234abcd" and commit 4820d3eb55be43a0bf64f0267cd4948c186a10cb');
  check("scrub", !s.includes("sk-ant-api03") && !s.includes("abcd1234abcd1234abcd") && s.includes("4820d3eb"), s);

  // 2. each provider answers
  for (const p of ["groq", "cloudflare", "local", "freellm"] as const) { const r = await llmProbe(p); check(`probe_${p}`, r.ok, r); }

  // 3. ladder: judge, JSON, private
  try {
    const r = await llm({ task: "judge", system: "Decide if the task is done from the evidence. JSON: {\"verdict\":\"done|not_done|unknown\"}.", user: JSON.stringify({ todo: "Send invoice to Acme", evidence: ["Sent mail: 'Invoice #12 attached' to acme"] }), json: true, job: "free-llm-test", fn: "free-llm", paid: "never", deadlineMs: 40_000,
      validate: (j) => ["done", "not_done", "unknown", "partly"].includes(j?.verdict) ? null : "bad verdict" });
    check("judge_free", r.cost_usd === 0 && !!r.json?.verdict, { provider: r.provider, model: r.model, json: r.json, tried: r.tried });
  } catch (e) { check("judge_free", false, e instanceof LlmUnavailable ? e.tried : String(e)); }

  // 4. privacy: private never tries gemini/openrouter even if enabled
  try {
    const r = await llm({ task: "summarize", system: "Summarize in 5 words.", user: "The quick brown fox jumps over the lazy dog.", job: "free-llm-test", fn: "free-llm", paid: "never", deadlineMs: 30_000 });
    check("privacy_default", !r.tried.some((t) => t.provider === "gemini" || t.provider === "openrouter"), r.tried);
  } catch (e) { check("privacy_default", !(e as any).tried?.some((t: any) => ["gemini", "openrouter"].includes(t.provider)), (e as any).tried); }

  // 5. size: a ~10K-token prompt skips groq
  try {
    const big = "Line of filler text about nothing in particular. ".repeat(700);
    const r = await llm({ task: "summarize", system: "Say OK.", user: big, maxTokens: 50, job: "free-llm-test", fn: "free-llm", paid: "never", deadlineMs: 60_000 });
    check("size_skip_groq", r.tried[0]?.provider === "groq" && r.tried[0]?.outcome === "skipped_size", r.tried);
  } catch (e) { check("size_skip_groq", (e as any).tried?.[0]?.outcome === "skipped_size", (e as any).tried); }

  // 6. paid never -> LlmUnavailable when nothing free is usable (write route with paid never, CF disabled via size)
  try {
    await llm({ task: "judge", system: "x", user: "y".repeat(600_000), job: "free-llm-test", fn: "free-llm", paid: "never", deadlineMs: 5_000 });
    check("paid_never_throws", false);
  } catch (e) { check("paid_never_throws", e instanceof LlmUnavailable && e.reason === "paid_never", (e as any).reason); }

  const pass = Object.values(out).every((v: any) => v.pass);
  return { pass, out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await authorized(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    switch (body.op) {
      case "canary": return J({ ok: true, canary: await canary() });
      case "test": return J({ ok: true, ...(await test()) });
      case "fallback_selftest": return J({ ...(await fallbackSelftest()) });
      case "run": {
        const r = await llm({ task: body.task ?? "summarize", system: String(body.system ?? ""), user: String(body.user ?? ""), json: !!body.json,
          privacy: body.privacy === "public" ? "public" : "private", paid: body.paid ?? "never", job: "manual", fn: "free-llm", maxTokens: body.maxTokens });
        return J({ ok: true, ...r });
      }
      default: return J({ ok: false, error: "op must be canary, test, run or fallback_selftest" }, 400);
    }
  } catch (e) {
    return J({ ok: false, error: (e as Error).message, tried: (e as any).tried }, 200);
  }
});
