// agent-watch: Switchboard, the line keeper for every template phone agent (docs/agent-template-opusplan.md, Phase 2).
// Cron `agent-watch` runs it at 8-59/10 * * * *. For each voice_agents row of kind "template" that is live:
//   1. the ElevenLabs agent still exists
//   2. the post-call webhook is still attached          (heals: agent-hub setup)
//   3. every tool in voice_agents.tool_ids is attached  (heals: re-attach)
//   4. its phone number is still assigned to it         (heals: reassign; skipped when settings.watch names another keeper, e.g. maya-watch)
//   5. sync the last 20 conversations                   (heals missed webhooks)
//   6. today's spend is under the daily cap             (alert: money, so it interrupts)
// Writes agent_health. Alerts: agent.line.<slug> and agent.spend.<slug>, signed with the agent's own name.
// verify_jwt = true: the cron sends the service key; a signed-in admin can run it too.

import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(URL_, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const HUB = `${URL_}/functions/v1/agent-hub`;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

// deno-lint-ignore no-explicit-any
type Any = any;
type Row = { slug: string; name: string; status: string; elevenlabs_agent_id: string | null; phone_number_id: string | null; webhook_id: string | null;
  tool_ids: string[] | null; settings: Record<string, unknown> | null };

const pacificDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;

async function hub(body: Record<string, unknown>): Promise<Any> {
  const r = await fetch(HUB, { method: "POST", headers: { "content-type": "application/json", apikey: SB_SECRET, authorization: `Bearer ${SB_SECRET}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(100_000) });
  return await r.json().catch(() => ({ ok: false, error: `agent-hub ${r.status}` }));
}

async function raise(key: string, name: string, bad: boolean, o: { title: string; ok_title: string; body?: string; needs?: string; healed?: boolean }) {
  if (bad) await db.rpc("bestly_raise", { p_key: key, p_kind: "problem", p_severity: "warning", p_title: o.title, p_body: o.body ?? null, p_area: "agent", p_needs_jared: o.needs ?? null });
  else await db.rpc("bestly_raise", { p_key: key, p_kind: "resolved", p_severity: "info", p_title: o.ok_title, p_body: o.body ?? null, p_area: "agent", p_healed: o.healed === true });
  void name;
}

async function checkAgent(a: Row, key: string): Promise<{ slug: string; ok: boolean; problems: string[]; fixed: string[]; spend: Any }> {
  const H = { "xi-api-key": key, "content-type": "application/json" };
  const problems: string[] = [];
  const fixed: string[] = [];
  const agentId = a.elevenlabs_agent_id!;
  const watchedElsewhere = !!(a.settings ?? {}).watch;

  // 1-3. agent, webhook, tools
  const ar = await fetch(`${XI}/convai/agents/${agentId}`, { headers: H });
  if (!ar.ok) {
    problems.push(ar.status === 404 ? "My voice agent is gone from the voice platform." : `My voice agent did not answer (${ar.status}).`);
  } else {
    const aj = await ar.json();
    const attached = aj?.platform_settings?.workspace_overrides?.webhooks?.post_call_webhook_id ?? null;
    if (!attached || (a.webhook_id && attached !== a.webhook_id)) {
      const s = await hub({ action: "setup", slug: a.slug });
      if (s?.ok) fixed.push("Re-attached my post-call webhook.");
      else problems.push(`My post-call webhook came off and re-attaching failed${s?.error ? `: ${String(s.error).slice(0, 160)}` : ""}.`);
    }
    const want = a.tool_ids ?? [];
    const have: string[] = aj?.conversation_config?.agent?.prompt?.tool_ids ?? [];
    const missing = want.filter((t) => !have.includes(t));
    if (missing.length) {
      const fx = await fetch(`${XI}/convai/agents/${agentId}`, { method: "PATCH", headers: H,
        body: JSON.stringify({ conversation_config: { agent: { prompt: { tool_ids: [...have, ...missing] } } } }) });
      if (fx.ok) fixed.push(`Re-attached ${missing.length} of my tools.`);
      else problems.push(`${missing.length} of my tools came off and re-attaching failed.`);
    }
  }

  // 4. phone number points at this agent (unless another keeper owns that check)
  if (!watchedElsewhere && a.phone_number_id) {
    const pr = await fetch(`${XI}/convai/phone-numbers/${a.phone_number_id}`, { headers: H });
    if (!pr.ok) problems.push(`My phone number is missing on the voice platform (${pr.status}).`);
    else {
      const pj = await pr.json();
      if (pj?.assigned_agent?.agent_id !== agentId) {
        const fx = await fetch(`${XI}/convai/phone-numbers/${a.phone_number_id}`, { method: "PATCH", headers: H, body: JSON.stringify({ agent_id: agentId }) });
        if (fx.ok) fixed.push("Reassigned my phone number to myself.");
        else problems.push("My phone number is not assigned to me, and reassigning failed.");
      }
    }
  }

  // 5. heal any missed webhooks
  const sy = await hub({ action: "sync", slug: a.slug, limit: 20 });
  if (sy?.ok) { if (Number(sy.added) > 0) fixed.push(`Caught ${sy.added} call${sy.added === 1 ? "" : "s"} the webhook missed.`); }
  else problems.push(`Syncing my calls failed${sy?.error ? `: ${String(sy.error).slice(0, 160)}` : ""}.`);

  // 6. today's spend against the cap
  const cap = Number((a.settings ?? {}).daily_cap ?? 10);
  const perMin = Number((a.settings ?? {}).cost_per_min ?? 0.12);
  const since = new Date(Date.now() - 36 * 3600_000).toISOString();
  const { data: rows } = await db.from("agent_calls").select("started_at, cost, duration_secs").eq("agent_slug", a.slug).gte("started_at", since);
  const today = pacificDay(new Date());
  let spent = 0;
  for (const r of (rows ?? []) as { started_at: string; cost: number | null; duration_secs: number | null }[]) {
    if (pacificDay(new Date(r.started_at)) !== today) continue;
    spent += r.cost ?? ((r.duration_secs ?? 0) / 60) * perMin;
  }
  const over = cap > 0 && spent >= cap;
  return { slug: a.slug, ok: problems.length === 0, problems, fixed, spend: { spent, cap, over } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { data: agents, error } = await db.from("voice_agents")
    .select("slug, name, status, elevenlabs_agent_id, phone_number_id, webhook_id, tool_ids, settings")
    .eq("kind", "template").eq("status", "live");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: CORS });
  const { data: k } = await db.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  const key = typeof k === "string" ? k : "";
  const out: Any[] = [];
  for (const a of (agents ?? []) as Row[]) {
    if (!a.elevenlabs_agent_id) continue;
    let r: Awaited<ReturnType<typeof checkAgent>>;
    try {
      if (!key) throw new Error("the ElevenLabs key is missing from Vault");
      r = await checkAgent(a, key);
    } catch (e) {
      r = { slug: a.slug, ok: false, problems: [`My check crashed: ${String((e as Error).message ?? e).slice(0, 200)}`], fixed: [], spend: { spent: 0, cap: 0, over: false } };
    }
    const now = new Date().toISOString();
    const row: Record<string, unknown> = { agent_slug: a.slug, ok: r.ok, problems: [...r.problems, ...r.fixed], healed: r.fixed.length > 0, checked_at: now };
    if (r.ok) row.last_ok_at = now;
    await db.from("agent_health").upsert(row, { onConflict: "agent_slug" });
    await raise(`agent.line.${a.slug}`, a.name, !r.ok, {
      title: `${a.name}: calls can't reach me`, ok_title: r.fixed.length ? `${a.name}: I fixed my phone line` : `${a.name}: line OK`,
      body: (r.ok ? r.fixed : r.problems).join(" ") || undefined, healed: r.fixed.length > 0,
      needs: "Open my page, press Run setup again in Settings, and check the voice platform." });
    await raise(`agent.spend.${a.slug}`, a.name, r.spend.over, {
      title: `${a.name}: I'm over today's spend cap (${money(r.spend.spent)} of ${money(r.spend.cap)})`, ok_title: `${a.name}: spend under the cap`,
      body: `Today's calls add up to ${money(r.spend.spent)} against a ${money(r.spend.cap)} cap.`,
      needs: "Raise the daily cap in my settings if that is expected, or pause me." });
    out.push({ slug: a.slug, ok: r.ok, problems: r.problems, fixed: r.fixed, spent: Math.round(r.spend.spent * 100) / 100, cap: r.spend.cap, over: r.spend.over });
  }
  return Response.json({ ok: true, agents: out }, { headers: CORS });
});
