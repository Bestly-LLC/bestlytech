// ava-admin: the bridge between Ava (ElevenLabs agent_0301m44te1qffk08jd2cqwtgy1th) and the Bestly admin.
// Plan: docs/ava-admin-bridge-opusplan.md. verify_jwt = false; the auth is ours.
//
//   GET  /status?conversation_id&caller_id&q     overall health + what needs Jared, or one client / lead / contact by name or phone
//   POST /calls                                   {conversation_id, caller_id, action, agent, campaign?, to?, purpose?, confirmed}
//   GET  /metrics?conversation_id&caller_id&range&agent
//   POST /fix                                     {conversation_id, caller_id, action: list|retry|ask_scout|check|approve|undo, issue?, ask?, job_id?, confirmed}
//                                                 docs/ava-fix-issues-opusplan.md. retry = the Fix Ladder's "Try again"; ask_scout = admin-chat on autopilot (writes blocked).
//                                                 PHASE B (passkey tap): approve and undo NEVER run here. They create a pending public.ava_approvals row and push a short link
//                                                 (bestly.tech/y/<code>); the approval happens in Jared's signed-in admin after a fresh Face ID (webauthn-authenticate
//                                                 approval_options / approval_verify -> ava_approval_decide), and the page runs the action with his admin JWT, the same
//                                                 "Yes, do it" path the Fix Ladder pane uses. `check` reports the approval, then the Scout job.
//   POST|GET /selftest                            service key only (pg_cron ava-admin-bridge-selftest, hourly at :17)
//   POST /provision                               service key only: {op:"sync_secret"} pushes the Vault secret to the ElevenLabs workspace secret
//
// Three layers on every tool route, in this order:
//   1. Authorization: Bearer <Vault ava_admin_bridge_secret>, compared in constant time. Wrong = HTTP 401 (the only 401).
//   2. The conversation is a live Ava call (ElevenLabs GET /convai/conversations/{id}, cached 60 s per id).
//   3. The caller is Jared. The number comes from ElevenLabs' own record of the call, not from the tool's caller_id field
//      (that one is only compared and logged). Web chats carry no caller number, so they are refused until there is a way to
//      prove a web session is Jared's (the init hook marks nobody on the web; see bestly_memory ava/admin-bridge-2026-10-13).
// Everything else is HTTP 200 with {ok:false, reason_code, say} so Ava just speaks the say line. No LLM in here.
// Writes (call_ops with confirmed=true) go through the paths that already exist: hunter_campaign_set, rg_settings.calling_enabled,
// pipeline_send, ava-assistant action "call". Capped at 20 place_call a day; a repeat inside 2 minutes replays the first answer.
import { createClient } from "npm:@supabase/supabase-js@2";
import { MARKER, FIX_MARKER, APPROVAL_MARKER, withPromptBlock } from "../_shared/ava-admin-prompt.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SB_URL, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const SELF = `${SB_URL}/functions/v1/ava-admin`;
const AVA_AGENT = "agent_0301m44te1qffk08jd2cqwtgy1th";
const SECRET_NAME = "ava_admin_bridge_secret";
const JARED = new Set(["+18165007236", "+14242349256"]);
const TZ = "America/Los_Angeles";
const DAILY_CALLS = 20;
const IDEM_MS = 120_000;
const CONV_TTL = 60_000;
const SAY_MAX = 199;
const PAYLOAD_MAX = 1900;

type Any = Record<string, unknown>;
type Reply = { ok: boolean; say: string; data?: Any; next?: string; reason_code?: string };

// ---------- small helpers ----------
const enc = new TextEncoder();
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const bg = (p: Promise<unknown>) => { const q = p.catch(() => {}); // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(q); };
async function sha(s: string): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
const hexOf = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
/** Constant-time string compare: hash both, then XOR every byte (no early exit, no length leak). */
async function safeEq(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const toE164 = (v: string) => { const d = String(v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : null; };
const normPhone = (v: unknown) => { const s = String(v ?? "").trim(); return s ? (toE164(s) ?? s) : null; };
const last4 = (v: string) => v.replace(/\D/g, "").slice(-4);
const pretty = (e: string) => { const d = e.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e; };
const T12 = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const DAYF = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" });
const MD = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const t12 = (d: string | number | Date) => T12.format(new Date(d)).replace(/\u202f/g, " ");
/** "today at 3:05 PM" / "Mon, Oct 12". */
const when = (d: string | number | Date) => DAYF.format(new Date(d)) === DAYF.format(new Date()) ? `today at ${t12(d)}` : MD.format(new Date(d));
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const num = (n: number) => (Number.isInteger(n) && n >= 0 && n <= 10 ? WORDS[n] : String(n));
const plural = (n: number, one: string, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
/** Shorten to a word boundary without an ellipsis (nothing that reads as cut off). */
function fit(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1); const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.5 ? cut.slice(0, sp) : t.slice(0, n)).replace(/[\s,;:.\-\u2013\u2014]+$/, "");
}
function pacificMidnightIso(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const sinceMid = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return new Date(Date.now() - sinceMid).toISOString();
}

function respond(r: Reply, status = 200): Response {
  let say = r.say.replace(/\s+/g, " ").trim();
  if (say.length > SAY_MAX) {
    // prefer the end of the last whole sentence that fits
    const cut = say.slice(0, SAY_MAX + 1); const dot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
    say = dot > 60 ? cut.slice(0, dot + 1) : fit(say, SAY_MAX);
  }
  const body: Any = { ok: r.ok, ...(r.ok ? {} : { reason_code: r.reason_code ?? "upstream_down" }), say };
  if (r.data) body.data = r.data;
  if (r.next) body.next = fit(r.next, 120);
  if (JSON.stringify(body).length > PAYLOAD_MAX) { // payload under 2 KB: drop the detail, keep the voice line
    body.data = { trimmed: true };
    if (JSON.stringify(body).length > PAYLOAD_MAX) delete body.next;
  }
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
const fail = (reason_code: string, say: string, data?: Any): Reply => ({ ok: false, reason_code, say, ...(data ? { data } : {}) });

// ---------- secrets (cached in memory for a minute) ----------
let secretCache: { v: string; at: number } | null = null;
async function bridgeSecret(): Promise<string | null> {
  if (secretCache && Date.now() - secretCache.at < 60_000) return secretCache.v;
  const { data, error } = await sb.rpc("ava_bridge_secret");
  if (error || typeof data !== "string" || !data) return null;
  secretCache = { v: data, at: Date.now() };
  return data;
}
let xiCache: { v: string; at: number } | null = null;
async function xiKey(): Promise<string | null> {
  if (xiCache && Date.now() - xiCache.at < 300_000) return xiCache.v;
  const { data, error } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  if (error || typeof data !== "string" || !data) return null;
  xiCache = { v: data, at: Date.now() };
  return data;
}
let agentCache: { v: string; at: number } | null = null;
async function avaAgentId(): Promise<string> {
  if (agentCache && Date.now() - agentCache.at < 300_000) return agentCache.v;
  const { data } = await sb.from("ava_settings").select("agent_id").eq("id", true).maybeSingle();
  const v = (data?.agent_id as string | null) || AVA_AGENT;
  agentCache = { v, at: Date.now() };
  return v;
}
const isService = (req: Request) => {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return [bearer, (req.headers.get("apikey") ?? "").trim()].some((t) => t && SERVICE_KEYS.has(t));
};

// ---------- layer 2: this is a live Ava call ----------
type Conv = { ok: true; caller: string | null } | { ok: false; upstream: boolean };
const convCache = new Map<string, { at: number; v: Conv }>();
async function checkConversation(id: string): Promise<Conv> {
  const hit = convCache.get(id);
  if (hit && Date.now() - hit.at < CONV_TTL) return hit.v;
  const [key, aid] = await Promise.all([xiKey(), avaAgentId()]);
  if (!key) return { ok: false, upstream: true };
  let r: Response;
  try { r = await fetch(`${XI}/convai/conversations/${encodeURIComponent(id)}`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(4000) }); }
  catch { return { ok: false, upstream: true }; }
  if (r.status >= 500 || r.status === 429) return { ok: false, upstream: true };
  let v: Conv = { ok: false, upstream: false };
  if (r.ok) {
    const c = await r.json().catch(() => null) as Any | null;
    const meta = (c?.metadata ?? {}) as Any;
    const started = Number(meta.start_time_unix_secs ?? 0) * 1000;
    const live = c?.status === "in-progress" && c?.agent_id === aid && started > 0 && Date.now() - started < 2 * 3600_000;
    if (live) {
      const dv = ((c?.conversation_initiation_client_data as Any | undefined)?.dynamic_variables ?? {}) as Any;
      const pc = (meta.phone_call ?? {}) as Any;
      v = { ok: true, caller: normPhone(dv.system__caller_id) ?? normPhone(pc.external_number) };
    }
  }
  convCache.set(id, { at: Date.now(), v });
  if (convCache.size > 200) for (const [k, e] of convCache) if (Date.now() - e.at > CONV_TTL) convCache.delete(k);
  return v;
}

// ---------- audit log ----------
type LogRow = { conversation_id?: string | null; caller_id?: string | null; op: string; args?: Any; ok: boolean; reason_code?: string | null; ms?: number; idem_key?: string | null; say?: string | null; data?: Any | null };
const logRow = (r: LogRow) => bg(sb.from("ava_admin_bridge_log").insert({
  conversation_id: r.conversation_id ?? null, caller_id: r.caller_id ?? null, op: r.op, args: r.args ?? {}, ok: r.ok, reason_code: r.reason_code ?? null,
  ms: r.ms ?? null, idem_key: r.idem_key ?? null, say: r.say ? r.say.slice(0, 300) : null, data: r.data ?? null }).then(() => {}));

type Ctx = { conv: string; caller: string; selftest: boolean; t0: number };
/** All three layers. Returns the context, or the Response to send. */
async function guard(req: Request, p: Any, op: string): Promise<Ctx | Response> {
  const t0 = Date.now();
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const secret = await bridgeSecret();
  if (!secret) return respond(fail("upstream_down", "My line into the business is down right now."));
  if (!bearer || !(await safeEq(bearer, secret))) {
    logRow({ op: "auth", ok: false, reason_code: "bad_secret", ms: Date.now() - t0, args: { path: op } });
    return respond({ ok: false, reason_code: "bad_secret", say: "Not authorized." }, 401);
  }
  const conv = clip(p.conversation_id, 80);
  const selftest = conv === "conv_selftest" && (await safeEq(req.headers.get("x-ava-selftest") ?? "", SB_SECRET));
  const claimed = normPhone(p.caller_id);
  if (selftest) return { conv, caller: claimed ?? "+18165007236", selftest: true, t0 };
  if (!/^conv_[A-Za-z0-9]+$/.test(conv)) {
    logRow({ op, ok: false, reason_code: "stale_call", ms: Date.now() - t0, conversation_id: conv || null });
    return respond(fail("stale_call", "I can't tell which call this is, so I can't open that."));
  }
  const c = await checkConversation(conv);
  if (!c.ok) {
    const code = c.upstream ? "upstream_down" : "stale_call";
    logRow({ op, ok: false, reason_code: code, ms: Date.now() - t0, conversation_id: conv });
    return respond(c.upstream ? fail("upstream_down", "I can't check this call right now. Try me again in a minute.") : fail("stale_call", "That call isn't live anymore, so I can't open the business."));
  }
  // the number ElevenLabs saw wins; the tool's caller_id is only compared
  const caller = c.caller;
  if (!caller || !JARED.has(caller)) {
    logRow({ op, ok: false, reason_code: "not_jared", ms: Date.now() - t0, conversation_id: conv, caller_id: caller ?? claimed, args: { web: !caller, claimed_matches: claimed === caller } });
    return respond(fail("not_jared", "That's something only Jared can pull up."));
  }
  return { conv, caller, selftest: false, t0 };
}

async function params(req: Request): Promise<Any> {
  const u = new URL(req.url);
  const q: Any = Object.fromEntries(u.searchParams.entries());
  if (req.method === "POST") { const b = await req.json().catch(() => ({})); if (b && typeof b === "object") return { ...q, ...(b as Any) }; }
  return q;
}

// ---------- /status ----------
async function status(ctx: Ctx, p: Any): Promise<Reply> {
  const q = clip(p.q, 80);
  if (q) {
    const { data, error } = await sb.rpc("ava_bridge_lookup", { p_q: q });
    if (error) return fail("upstream_down", "I couldn't look that up just now.");
    const rows = (data ?? []) as Any[];
    if (!rows.length) return fail("not_found", `I can't find anything for ${fit(q, 40)}.`);
    const line = (r: Any) => {
      const name = String(r.name ?? "");
      if (r.kind === "client") return `${name} is a ${r.status} client${r.extra ? `, ${r.extra}` : ""}.`;
      if (r.kind === "contact") return `${name} is in Jared's contacts${r.status ? ` as ${r.status}` : ""}.`;
      const who = String(r.extra ?? "").split(",")[0] || "an agent";
      return `${name} is ${who}'s lead, status ${r.status ?? "new"}, ${r.last_at ? `last called ${when(String(r.last_at))}` : "not called yet"}.`;
    };
    const names = [...new Set(rows.map((r) => String(r.name)))];
    if (names.length > 1) {
      const choices = rows.slice(0, 3).map((r) => ({ name: String(r.name), detail: `${r.kind}${r.status ? `, ${r.status}` : ""}` }));
      return { ok: false, reason_code: "ambiguous", say: `I found ${num(names.length)}: ${choices.map((c) => c.name).join(", ")}. Which one?`, data: { choices } };
    }
    return { ok: true, say: line(rows[0]), data: { matches: rows.slice(0, 3).map((r) => ({ kind: r.kind, name: r.name, status: r.status, last_at: r.last_at ?? null })) } };
  }
  const { data, error } = await sb.rpc("ava_bridge_health");
  if (error || !data) return fail("upstream_down", "I couldn't read the dashboard just now.");
  const h = data as Any;
  const errs = Number(h.issues_error ?? 0), needs = Number(h.needs_n ?? 0), maya = Number(h.maya_on ?? 0);
  const titles = ((h.needs ?? []) as string[]).map((t) => fit(t.replace(/^[^:]{2,30} couldn't fix:\s*/i, "").replace(/^Still down after an hour:\s*/i, ""), 60));
  const green = errs === 0 && h.ava_line_ok !== false;
  const parts = [
    green ? "All green." : errs > 0 ? `${errs === 1 ? "One problem is open" : `${plural(errs, "problem")} open`}: ${fit(String(h.top_issue ?? "see the dashboard"), 60)}.` : "My phone line has a problem.",
    needs > 0 ? `${needs === 1 ? "One thing needs" : `${plural(needs, "thing")} need`} you${titles[0] ? `, first: ${titles[0]}` : ""}.` : "Nothing needs you.",
    `Maya's ${maya > 0 ? "on" : "paused"}, Reese is ${h.reese_on ? "on" : "paused"}.`,
  ];
  return { ok: true, say: parts.join(" "), data: { green, problems: errs, needs_you: needs, needs: titles, maya_campaigns_on: maya, maya_campaigns: h.maya_total, reese_on: !!h.reese_on, line_ok: h.ava_line_ok ?? null },
    next: needs > 0 ? "Want the rest of what needs you?" : "Want today's numbers?" };
}

// ---------- /metrics ----------
const RANGES = ["today", "yesterday", "7d", "30d"] as const;
const AGENTS = ["all", "ava", "maya", "reese", "leo"] as const;
const RANGE_LABEL: Record<string, string> = { today: "Today", yesterday: "Yesterday", "7d": "The last seven days", "30d": "The last thirty days" };
async function metrics(_ctx: Ctx, p: Any): Promise<Reply> {
  const range = clip(p.range, 12).toLowerCase() || "today";
  const agent = clip(p.agent, 12).toLowerCase() || "all";
  if (!(RANGES as readonly string[]).includes(range)) return fail("bad_request", "I can do today, yesterday, the last seven days or the last thirty.");
  if (!(AGENTS as readonly string[]).includes(agent)) return fail("not_found", "I only track Ava, Maya, Reese and Leo.");
  const { data, error } = await sb.rpc("ava_bridge_metrics", { p_range: range });
  if (error || !data) return fail("upstream_down", "I couldn't pull the numbers just now.");
  const m = data as Any; const A = (m.agents ?? {}) as Record<string, Record<string, number>>;
  const pick = agent === "all" ? ["maya", "reese", "ava", "leo"] : [agent];
  const calls = pick.reduce((s, k) => s + Number(A[k]?.calls ?? 0), 0);
  const mins = pick.reduce((s, k) => s + Number(A[k]?.mins ?? 0), 0);
  const voice = pick.reduce((s, k) => s + Number(A[k]?.cost ?? 0), 0);
  const aiSpend = agent === "all" ? Number(m.ai_spend ?? 0) : 0;
  const spent = voice + aiSpend;
  const booked = ["maya", "reese"].filter((k) => pick.includes(k)).map((k) => [k, Number(A[k]?.booked ?? 0)] as const).filter(([, n]) => n > 0);
  const qualified = ["maya", "reese"].filter((k) => pick.includes(k)).reduce((s, k) => s + Number(A[k]?.qualified ?? 0), 0);
  const who = agent === "all" ? "" : ` for ${agent[0].toUpperCase()}${agent.slice(1)}`;
  const say = [
    `${RANGE_LABEL[range]}${who}: ${plural(calls, "call")}, ${plural(mins, "minute")}, ${usd(spent)} spent.`,
    booked.length ? booked.map(([k, n]) => `${k[0].toUpperCase()}${k.slice(1)} booked ${n === 1 ? "one meeting" : `${num(n)} meetings`}.`).join(" ") : (pick.includes("maya") || pick.includes("reese")) ? "No meetings booked." : "",
    qualified > 0 ? `Pipeline has ${num(qualified)} qualified ${qualified === 1 ? "lead" : "leads"}.` : "",
  ].filter(Boolean).join(" ");
  const per: Any = {}; for (const k of pick) per[k] = { calls: A[k]?.calls ?? 0, mins: A[k]?.mins ?? 0, cost: A[k]?.cost ?? null, booked: A[k]?.booked ?? null };
  return { ok: true, say, data: { range, agent, calls, minutes: mins, spent: Math.round(spent * 100) / 100, per_agent: per, qualified_leads: qualified }, next: range === "today" ? "Want yesterday, or the week?" : undefined };
}

// ---------- /calls (call_ops) ----------
const ACTIONS = ["start_campaign", "pause_campaign", "resume_campaign", "place_call"] as const;
const CALL_AGENTS = ["maya", "reese", "ava", "leo"] as const;
type Plan = { say_preview: string; run: () => Promise<Reply>; target: string; done: string; note: string };

async function placedToday(): Promise<number> {
  const { count } = await sb.from("ava_admin_bridge_log").select("id", { count: "exact", head: true }).eq("op", "place_call").eq("ok", true).gte("ts", pacificMidnightIso());
  return count ?? 0;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function planCampaign(action: string, agent: string, campaign: string): Promise<Plan | Reply> {
  const on = action !== "pause_campaign";
  const verb = on ? "start" : "pause";
  if (agent === "maya") {
    if (!campaign) {
      const { data } = await sb.rpc("ava_bridge_find", { p_kind: "campaign", p_q: "all", p_agent: "maya" });
      const rows = (data ?? []) as Any[];
      return { ok: false, reason_code: "ambiguous", say: `Which Maya campaign: ${rows.map((r) => String(r.name).split(" ")[0].toLowerCase()).join(", ")}, or all of them?`, data: { choices: rows.slice(0, 3).map((r) => ({ name: String(r.name), detail: r.enabled ? "on" : "paused" })) } };
    }
    const { data, error } = await sb.rpc("ava_bridge_find", { p_kind: "campaign", p_q: campaign, p_agent: "maya" });
    if (error) return fail("upstream_down", "I couldn't look up the campaigns just now.");
    const rows = (data ?? []) as Any[];
    if (!rows.length) return fail("not_found", `I don't see a Maya campaign called ${fit(campaign, 40)}.`);
    const isAll = /^(all|everything|every campaign|all campaigns)$/i.test(campaign);
    if (rows.length > 1 && !isAll) return { ok: false, reason_code: "ambiguous", say: `That matches ${rows.map((r) => String(r.name)).slice(0, 3).join(", ")}. Which one?`, data: { choices: rows.slice(0, 3).map((r) => ({ name: String(r.name), detail: r.enabled ? "on" : "paused" })) } };
    const todo = rows.filter((r) => Boolean(r.enabled) !== on);
    const names = rows.map((r) => String(r.name));
    const label = isAll ? "all of Maya's campaigns" : `Maya's ${names[0]} campaign`;
    if (!todo.length) return { ok: true, say: `${cap(label)} ${isAll ? "are" : "is"} already ${on ? "running" : "paused"}.`, data: { changed: 0 } };
    return {
      say_preview: `${cap(verb)} ${isAll ? `all ${num(todo.length)} of Maya's campaigns` : label}`,
      target: `maya:${todo.map((r) => r.slug).sort().join(",")}`,
      done: `Done. ${isAll ? `Maya's ${num(todo.length)} campaigns are` : `${cap(label)} is`} ${on ? "on" : "paused"}.`,
      note: `${on ? "Started" : "Paused"} ${isAll ? `all of Maya's campaigns (${todo.length})` : `Maya's ${names[0]} campaign`} for you`,
      run: async () => {
        const res = await Promise.all(todo.map((r) => sb.rpc("hunter_campaign_set", { p_slug: r.slug, p_enabled: on })));
        const bad = res.find((x) => x.error);
        if (bad) return fail("upstream_down", "That didn't go through. Check the Pipeline page.", { error: fit(bad.error!.message, 80) });
        return { ok: true, say: "", data: { changed: todo.length, now: on ? "on" : "paused" } };
      },
    };
  }
  if (agent === "reese") {
    const { data: s } = await sb.from("rg_settings").select("calling_enabled, agent_id, phone_number_id, from_number, callback_number, pilot_limit").eq("id", true).maybeSingle();
    if (!s) return fail("upstream_down", "I couldn't read Reese's settings.");
    if (Boolean(s.calling_enabled) === on) return { ok: true, say: `Reese is already ${on ? "calling" : "paused"}.`, data: { changed: 0 } };
    if (on) {
      const { count: tests } = await sb.from("rg_calls").select("id", { count: "exact", head: true }).eq("is_test", true);
      const ready = !!(s.agent_id && s.phone_number_id && s.from_number && s.callback_number && (s.pilot_limit ?? 0) > 0 && (tests ?? 0) > 0);
      if (!ready) return fail("not_ready", "Reese isn't set up to call yet. Finish her go-live steps on the RoofGuard page first.", { missing: [!s.agent_id && "agent", !s.phone_number_id && "line", !s.callback_number && "callback number", !((s.pilot_limit ?? 0) > 0) && "pilot limit", !((tests ?? 0) > 0) && "test call"].filter(Boolean) });
    }
    return {
      say_preview: `${cap(verb)} Reese's calling`, target: "reese:calling",
      done: `Done. Reese is ${on ? "calling again, weekdays in business hours" : "paused"}.`,
      note: `${on ? "Started" : "Paused"} Reese's calling for you`,
      run: async () => {
        const { error } = await sb.from("rg_settings").update({ calling_enabled: on, updated_at: new Date().toISOString(), updated_by: "ava admin bridge" }).eq("id", true);
        return error ? fail("upstream_down", "That didn't go through. Check the RoofGuard page.") : { ok: true, say: "", data: { now: on ? "on" : "paused" } };
      },
    };
  }
  return fail("bad_request", `${cap(agent)} doesn't run campaigns. I can switch Maya's or Reese's.`);
}

async function planCall(agent: string, to: string, purpose: string): Promise<Plan | Reply> {
  if (agent === "leo") return fail("bad_request", "Leo only calls guests on their own trips. I can have you or Maya call instead.");
  if (!to) return fail("bad_request", "Who should I call?");
  if (purpose.length < 4) return fail("bad_request", "What's the call about? One sentence is plenty.");
  const done = await placedToday();
  if (done >= DAILY_CALLS) return fail("limit_hit", `That's ${num(DAILY_CALLS)} calls through me today, the limit. Try tomorrow, or place it from the dashboard.`, { used: done, limit: DAILY_CALLS });
  const digits = to.replace(/\D/g, "");
  if (agent === "ava") {
    let phone = digits.length >= 10 ? toE164(to) : null, name = "";
    if (!phone) {
      if (digits.length >= 7) return fail("bad_request", "I need the full ten digit number, or a name from Jared's contacts.");
      const { data } = await sb.rpc("ava_bridge_find", { p_kind: "contact", p_q: to });
      const rows = (data ?? []) as Any[];
      if (!rows.length) return fail("not_found", `I don't have ${fit(to, 40)} in Jared's contacts. Give me the number.`);
      if (rows.length > 1) return { ok: false, reason_code: "ambiguous", say: `Which one: ${rows.slice(0, 3).map((r) => String(r.name)).join(", ")}?`, data: { choices: rows.slice(0, 3).map((r) => ({ name: String(r.name), detail: String(r.relationship ?? "contact") })) } };
      phone = toE164(String(rows[0].phone)); name = String(rows[0].name);
      if (!phone) return fail("not_found", `${name} has no usable number saved.`);
    }
    const who = name || pretty(phone);
    return {
      say_preview: `Have Ava call ${who} about: ${fit(purpose, 70)}`, target: `ava:${last4(phone)}`,
      done: `Done. Ava is calling ${who} now.`, note: `Ava is calling ${name || `the number ending ${last4(phone)}`}: ${fit(purpose, 80)}`,
      run: async () => {
        let r: Response;
        try { r = await fetch(`${SB_URL}/functions/v1/ava-assistant`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET },
          body: JSON.stringify({ action: "call", phone, name, purpose }), signal: AbortSignal.timeout(7000) }); }
        catch { return fail("upstream_down", "The call didn't go out. Try again in a minute."); }
        const j = await r.json().catch(() => ({})) as Any;
        if (r.ok && j.ok) return { ok: true, say: "", data: { calling: last4(phone!), call_id: j.call_id ?? null } };
        return fail(r.status === 429 ? "limit_hit" : "upstream_down", fit(String(j.error ?? "The call didn't go out."), 150));
      },
    };
  }
  // maya / reese: the call goes out through Pipeline (the lead is queued and she dials in her next window)
  const { data } = await sb.rpc("ava_bridge_find", { p_kind: "lead", p_q: to });
  const rows = (data ?? []) as Any[];
  if (!rows.length) return fail("not_found", `I can't find a lead matching ${fit(to, 40)}. ${cap(agent)} calls leads from the Pipeline.`);
  if (rows.length > 1 && new Set(rows.map((r) => String(r.company))).size > 1) return { ok: false, reason_code: "ambiguous", say: `Which one: ${rows.slice(0, 3).map((r) => String(r.company)).join(", ")}?`, data: { choices: rows.slice(0, 3).map((r) => ({ name: String(r.company), detail: `${r.owner}, ${r.status}` })) } };
  const lead = rows[0]; const co = String(lead.company ?? "that lead");
  return {
    say_preview: `Queue ${co} for ${cap(agent)} to call`, target: `${agent}:${lead.id}`,
    done: `Done. ${co} is queued for ${cap(agent)}, she'll call in her next calling window.`, note: `Queued ${co} for ${cap(agent)} to call`,
    run: async () => {
      const { error } = await sb.rpc("pipeline_send", { p_table: lead.lead_table, p_id: lead.id, p_agent: agent });
      return error ? fail("blocked" as string, fit(error.message.replace(/^.*?:\s*/, ""), 140)) : { ok: true, say: "", data: { queued: true } };
    },
  };
}

async function calls(ctx: Ctx, p: Any): Promise<Reply & { _log?: Any }> {
  const action = clip(p.action, 20);
  const agent = clip(p.agent, 12).toLowerCase() || (action === "place_call" ? "ava" : "");
  if (!(ACTIONS as readonly string[]).includes(action)) return fail("bad_request", "I can start, pause or resume a campaign, or place a call.");
  if (!(CALL_AGENTS as readonly string[]).includes(agent)) return fail("bad_request", "Which agent: Maya, Reese, Ava or Leo?");
  const confirmed = p.confirmed === true || String(p.confirmed).toLowerCase() === "true";
  const campaign = clip(p.campaign, 80), to = clip(p.to, 80), purpose = clip(p.purpose, 400);
  const plan = action === "place_call" ? await planCall(agent, to, purpose) : await planCampaign(action, agent, campaign);
  if (!("run" in plan)) return plan;   // an answer already (ambiguous, not_found, already done, bad_request ...)
  const idem = `${ctx.conv}|${action}|${plan.target}`;
  if (!confirmed) {
    return { ok: false, reason_code: "not_confirmed", say: `${plan.say_preview}. Say yes and I'll do it.`, data: { preview: true, action, agent },
      next: "Read that back to Jared, then call again with confirmed true after a clear yes." };
  }
  // 2 minute idempotency: the same action on the same target in this call replays the first answer
  const since = new Date(Date.now() - IDEM_MS).toISOString();
  const { data: prior } = await sb.from("ava_admin_bridge_log").select("say, data").eq("idem_key", idem).eq("ok", true).gte("ts", since).order("ts", { ascending: false }).limit(1);
  if (prior?.length) return { ok: true, say: `Already done a minute ago. ${prior[0].say ?? ""}`.trim(), data: { ...(prior[0].data as Any ?? {}), repeat: true } };
  const r = await plan.run();
  if (!r.ok) return r;
  const say = plan.done;
  // every successful write rings a quiet note signed Ava (info, bell + recap, never an interrupt)
  bg(sb.rpc("scout_notify", { p_title: `Ava (assistant): ${fit(plan.note, 140)}`, p_body: `You asked on a call. ${t12(Date.now())} Pacific.`, p_severity: "info", p_push: false, p_url: "/admin/ava",
    p_dedupe: `ava-bridge-${idem}-${Math.floor(Date.now() / IDEM_MS)}` }).then(() => {}));
  return { ok: true, say, data: { ...(r.data ?? {}), action, agent }, _log: { idem_key: idem } };
}

// ---------- /fix (Phase A of docs/ava-fix-issues-opusplan.md) ----------
// list, retry, ask_scout, check run here. approve and undo NEVER run here: they create a request that Jared taps on his phone (see requestTap, Phase B).
// No new write privilege: retry is the Fix Ladder's own "Try again" (service key, same as the pane), ask_scout is admin-chat on
// autopilot (writes blocked in code there, exactly like voice-ask), and the notes are info-class through notify_route.
const FIX_ACTIONS = ["list", "retry", "ask_scout", "check", "approve", "undo"] as const;
const DAILY_SCOUT = 10;
const VOICE_THREAD = "Ava (voice)";
const JOB_STALE_MS = 8 * 60_000;
const LADDER_WAIT_MS = 5_500;
const SCOUT_START_WAIT_MS = 2_500;
const SPOKEN_TITLE = 38;
const TRAIL_WORD = /\s+(the|a|an|of|to|as|for|and|or|in|on|at|is|are|with|by|from|that|than|its|their|but|if)$/i;
/** A title short enough to say aloud, never ending on a dangling word like "the". */
const spoken = (t: string) => { let s = fit(t, SPOKEN_TITLE); for (let i = 0; i < 4 && TRAIL_WORD.test(s); i++) s = s.replace(TRAIL_WORD, ""); return s; };

const keyHeaders = (k: string): Record<string, string> => k.startsWith("sb_secret_") ? { apikey: k, "Content-Type": "application/json" } : { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms));

type R = Reply & { _log?: Any };
type Item = { kind: "incident" | "card" | "autofix"; key: string; title: string; name: string; area: string; stage: string; ask: string; severity: string; hay: string; order: number };
const plainTitle = (t: string) => String(t ?? "").replace(/^\s*(Still down after an hour|Ares couldn't fix|Fixed|Resolved)\s*:\s*/i, "").replace(/\s+/g, " ").trim();
const norm = (t: string) => plainTitle(t).toLowerCase().replace(/[0-9]+/g, "#").replace(/[^a-z#]+/g, " ").trim();
const SEV: Record<string, number> = { critical: 0, error: 0, urgent: 0, warning: 1, info: 2, todo: 2 };
const STAGE_ORDER: Record<string, number> = { needs_yes: 0, claude: 2, scout: 3, free_ai: 4, auto: 5 };
const hayOf = (...p: string[]) => p.join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");

/** Open incidents + Needs-you cards, deduped. needs_yes incidents first, then Needs-you cards, then the rest by how far along the ladder they are. */
async function loadItems(): Promise<{ items: Item[]; autofix: Item[] } | null> {
  const [inc, cards] = await Promise.all([
    sb.from("monitor_issues").select("key, title, area, severity, fix_stage, scout_ask, opened_at").eq("status", "open").limit(120),
    sb.rpc("admin_today_rows"),
  ]);
  if (inc.error && cards.error) return null;
  const items: Item[] = [];
  const seenKey = new Set<string>(), seenTitle = new Set<string>();
  for (const r of (inc.data ?? []) as Any[]) {
    const key = String(r.key), title = plainTitle(String(r.title ?? key)), stage = String(r.fix_stage ?? "auto");
    seenKey.add(key); seenTitle.add(norm(title));
    const sev = SEV[String(r.severity)] ?? 2;
    items.push({ kind: "incident", key, title, name: spoken(title), area: String(r.area ?? ""), stage, ask: String(r.scout_ask ?? ""), severity: String(r.severity ?? "info"),
      hay: hayOf(title, String(r.area ?? ""), key), order: (stage === "needs_yes" ? 0 : (STAGE_ORDER[stage] ?? 5)) * 10 + sev + Math.min(0.9, Date.parse(String(r.opened_at)) / 1e14) });
  }
  let n = 0;
  for (const r of (cards.data ?? []) as Any[]) {
    const title = plainTitle(String(r.title ?? ""));
    if (!title) continue;
    if (r.origin_table === "monitor_issues" && seenKey.has(String(r.origin_id))) continue;
    if (seenTitle.has(norm(title))) continue;
    seenTitle.add(norm(title));
    items.push({ kind: "card", key: String(r.key), title, name: spoken(title), area: String(r.source ?? ""), stage: "card", ask: "", severity: String(r.severity ?? "info"),
      hay: hayOf(title, String(r.source ?? "")), order: 10 + Math.min(Number(r.rank ?? 3), 5) * 0.1 + n++ * 0.001 });
  }
  items.sort((a, b) => a.order - b.order);
  const af = await sb.from("security_autofix_log").select("id, at, finding_key, action, note").not("undo_sql", "is", null).eq("ok", true)
    .gte("at", new Date(Date.now() - 14 * 86400_000).toISOString()).order("at", { ascending: false }).limit(20);
  const autofix: Item[] = ((af.data ?? []) as Any[]).map((r, i) => {
    const title = plainTitle(String(r.note || r.action || r.finding_key || "an automatic fix"));
    return { kind: "autofix" as const, key: `autofix:${r.id}`, title, name: spoken(title), area: "security", stage: "autofix", ask: "", severity: "info", hay: hayOf(title, String(r.finding_key ?? ""), String(r.action ?? "")), order: i };
  });
  return { items, autofix };
}

const STOP = new Set(["the", "an", "that", "this", "thing", "things", "one", "issue", "problem", "please", "fix", "try", "again", "retry", "my", "it", "for", "on", "with", "about", "of", "to", "is", "are", "ask", "scout", "undo", "approve", "and", "its"]);
const ORDINALS: [RegExp, number][] = [[/\b(first|1st|top|number one)\b/i, 0], [/\b(second|2nd|number two)\b/i, 1], [/\b(third|3rd|number three)\b/i, 2]];
const tokens = (s: string) => s.toLowerCase().replace(/'s\b/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));
const hasTok = (hay: string, t: string) => t.length <= 3 ? new RegExp(`\\b${t}\\b`).test(hay) : hay.includes(t) || (t.endsWith("s") && hay.includes(t.slice(0, -1)));

/** Plan section 1: one hit goes, 2+ is ambiguous (Ava asks which), none is not_found. */
function resolveItem(pool: Item[], issue: string, what: string): { item: Item } | Reply {
  const q = clip(issue, 120);
  for (const [re, i] of ORDINALS) if (re.test(q) && pool[i]) return { item: pool[i] };
  const qt = tokens(q);
  if (!qt.length) return fail("not_found", `I'm not sure which ${what} you mean.`);
  const scored = pool.map((it) => ({ it, s: qt.filter((t) => hasTok(it.hay, t)).length / qt.length })).filter((x) => x.s >= 0.5);
  if (!scored.length) return fail("not_found", `I can't find ${what} matching ${fit(q, 40)}.`);
  const top = Math.max(...scored.map((x) => x.s));
  const hits = scored.filter((x) => x.s === top).map((x) => x.it);
  if (hits.length === 1) return { item: hits[0] };
  return ambiguous(hits);
}
function ambiguous(hits: Item[]): Reply {
  const c = hits.slice(0, 3);
  const names = c.map((h) => h.name);
  const say = hits.length > 3 ? `That matches ${hits.length} things. Is it ${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}?`
    : `That matches ${names.join(" and ")}. Which one?`;
  return { ok: false, reason_code: "ambiguous", say, data: { choices: c.map((h) => ({ name: h.name, stage: h.stage })) } };
}

const STAGE_SAY: Record<string, string> = { needs_yes: "fix ready", card: "needs you", claude: "stuck", scout: "in progress", free_ai: "in progress", auto: "in progress" };

async function fixList(): Promise<Reply> {
  const all = await loadItems();
  if (!all) return fail("upstream_down", "I couldn't read the issues just now.");
  const { items } = all;
  if (!items.length) return { ok: true, say: "Nothing's broken right now.", data: { count: 0, items: [] } };
  const top = items.slice(0, 3);
  const ord = ["First,", "Then", "And"];
  const say = `${items.length <= 10 ? cap(num(items.length)) : items.length} open. ${top.map((t, i) => `${ord[i]} ${t.name}, ${STAGE_SAY[t.stage] ?? "in progress"}.`).join(" ")}`;
  const first = top[0];
  const next = first.stage === "needs_yes" ? "Want me to send the first fix to your phone for a Face ID tap?" : first.kind === "incident" ? "Want me to try the first one again?" : "The first one needs you in admin.";
  return { ok: true, say, data: { count: items.length, spoken: top.length, items: top.map((t) => ({ name: t.name, stage: t.stage })) }, next };
}

// ----- notes: Ava-signed, info class, through notify_route (the autonomy gate decides; nothing here pushes on its own) -----
let voiceThreadCache: { id: string; uid: string; at: number } | null = null;
async function adminUid(): Promise<string | null> {
  const { data } = await sb.from("user_roles").select("user_id").eq("role", "admin").order("user_id").limit(1).maybeSingle();
  return (data as Any | null)?.user_id as string | null ?? null;
}
/** The one reusable "Ava (voice)" admin chat thread (created on first use). */
async function voiceThread(): Promise<{ id: string; uid: string } | null> {
  if (voiceThreadCache && Date.now() - voiceThreadCache.at < 300_000) return voiceThreadCache;
  const uid = await adminUid();
  if (!uid) return null;
  const { data: th } = await sb.from("admin_chat_threads").select("id").eq("user_id", uid).eq("title", VOICE_THREAD).order("created_at").limit(1);
  let id = (th?.[0] as Any | undefined)?.id as string | undefined;
  if (!id) {
    const { data, error } = await sb.from("admin_chat_threads").insert({ user_id: uid, title: VOICE_THREAD }).select("id").single();
    if (error || !data) return null;
    id = (data as Any).id as string;
  }
  voiceThreadCache = { id, uid, at: Date.now() };
  return voiceThreadCache;
}
/** A short note signed Ava in the "Ava (voice)" thread. Unread = purple dot; a note carrying NEEDS_YES turns it orange (admin_chat_thread_list). */
async function threadNote(text: string, dedupeContains: string): Promise<void> {
  const th = await voiceThread();
  if (!th) return;
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: recent } = await sb.from("admin_chat_messages").select("body").eq("thread_id", th.id).eq("role", "assistant").gte("created_at", since).limit(30);
  if (((recent ?? []) as Any[]).some((m) => String(m.body).includes(dedupeContains))) return;
  await sb.from("admin_chat_messages").insert({ thread_id: th.id, role: "assistant", body: text });
  await sb.from("admin_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", th.id);
}
async function bellNote(title: string, body: string, tag: string): Promise<void> {
  await sb.rpc("notify_route", { p_title: fit(title, 160), p_body: fit(body, 300), p_level: "passive", p_source: "Ava", p_url: "https://bestly.tech/admin", p_tag: tag });
}
const dayTag = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

async function tapNeeded(ctx: Ctx, action: "approve" | "undo", item: Item): Promise<Reply> {
  const t = item.title;
  let say: string, note: string;
  if (action === "undo") {
    say = item.kind === "autofix" ? "Undoing an automatic fix needs your tap in admin, under Security. I put a note there." : "That one needs your tap in admin.";
    note = `Ava (voice): you asked me by phone to undo "${t}". Undoing needs your tap in admin (Security, the automatic fixes list), not your voice.`;
  } else if (item.kind === "incident" && item.stage === "needs_yes") {
    say = "That one needs your tap in admin. The fix is ready and waiting there.";
    note = `Ava (voice): you asked me by phone to approve "${t}". I can't approve by voice, so it needs your tap, one button.\nNEEDS_YES: ${fit(item.ask || "the fix Scout wrote", 200)}\nOpen the alert for it (bell or Needs you) and tap "Yes, do it".`;
  } else if (item.kind === "incident") {
    return fail("not_ready", `${cap(item.name)} isn't waiting on a yes yet. It's ${STAGE_SAY[item.stage] ?? "in progress"}.`, { stage: item.stage });
  } else {
    say = "That one needs your tap in admin. It's in Needs you.";
    note = `Ava (voice): you asked me by phone about "${t}". It needs you in admin, it is in Needs you.`;
  }
  if (!ctx.selftest) {
    await threadNote(note, `"${t}"`).catch(() => {});
    await bellNote(`Ava (voice): ${action === "undo" ? "undo" : "approval"} needs your tap, ${fit(t, 80)}`, "You asked on a call. I can't do it by voice, it is lined up for your tap.", `ava-tap-${action}-${norm(t).slice(0, 40)}-${dayTag()}`).catch(() => {});
  }
  return { ok: false, reason_code: "needs_tap", say, data: { issue: item.name, stage: item.stage, action, noted: !ctx.selftest } };
}

// ----- approve / undo: create a request for Jared's phone. Nothing here runs the fix. -----
const APPROVAL_TTL_MIN = 10;
const REQUEST_PUSH_OK = new Set(["ha", "web"]);
async function requestTap(ctx: Ctx, p: Any, action: "approve" | "undo", item: Item, confirmed: boolean): Promise<R> {
  let source = "", actionText = "", plain = "", autofixId: number | null = null, preview = "";
  const title = item.title;
  if (action === "approve") {
    if (item.kind !== "incident") return tapNeeded(ctx, action, item);   // a Needs-you card: not a ladder fix, stays his tap in admin
    if (item.stage !== "needs_yes") return fail("not_ready", `${cap(item.name)} isn't waiting on a yes yet. It's ${STAGE_SAY[item.stage] ?? "in progress"}.`, { stage: item.stage });
    source = item.ask.trim();
    if (!source) return fail("not_ready", `${cap(item.name)} doesn't have a written fix yet, so there's nothing to approve.`);
    actionText = `Yes, do it: ${source}`;
    plain = fit(source, 200);
    preview = `The fix is: ${fit(source, 90).replace(/[.!?]+$/, "")}.`;
  } else {
    if (item.kind !== "autofix") return fail("not_found", "I can only put back an automatic fix, and that isn't one.");
    autofixId = Number(item.key.replace("autofix:", ""));
    const { data: row } = await sb.from("security_autofix_log").select("id, note, action, undo_sql, ok").eq("id", autofixId).maybeSingle();
    if (!row || !row.ok || !row.undo_sql) return fail("not_found", "I can't find the undo for that automatic fix.");
    source = String(row.undo_sql);
    const what = plainTitle(String(row.note || row.action || "an automatic fix"));
    actionText = `Yes, do it: Undo the automatic fix "${what}". Run exactly this SQL and nothing else, then say FIXED: ${source}`;
    plain = fit(`Put back the automatic fix: ${what}`, 200);
    preview = `Put back the automatic fix on ${fit(what, 60).replace(/[.!?]+$/, "")}.`;
  }
  // Already approved a moment ago (the incident can stay at needs_yes while Scout works): never run the same thing twice.
  const recent = await sb.from("ava_approvals").select("decided_at").eq("kind", action).eq("issue_key", item.key).in("status", ["approved", "running", "done"])
    .gte("decided_at", new Date(Date.now() - 60 * 60_000).toISOString()).order("decided_at", { ascending: false }).limit(1);
  const done = (recent.data?.[0] as Any | undefined)?.decided_at as string | undefined;
  if (done) return fail("already_done", action === "undo" ? `You already put that one back at ${t12(done)}.` : `You already approved that one at ${t12(done)}. Scout's on it.`, { issue: item.name });
  if (!confirmed) {
    return { ok: false, reason_code: "not_confirmed", say: `${preview} Say yes and I'll send it to your phone for Face ID.`, data: { preview: true, action, issue: item.name },
      next: "Read that back to Jared, then call again with confirmed true after a clear yes. This only sends a request to his phone.", _log: { args: { issue_key: item.key } } };
  }
  // The hourly selftest may exercise the whole path, but only on an explicit flag, and its rows can never be approved or pushed.
  if (ctx.selftest && p.selftest_create !== true) {
    return fail("not_confirmed", "Selftest: the request would go to his phone here.", { selftest: true });
  }
  const { data: made, error } = await sb.rpc("ava_approval_create", { p_kind: action, p_issue_key: item.key, p_title: title, p_action_text: actionText, p_source_text: source,
    p_plain: plain, p_autofix_id: autofixId, p_conversation: ctx.conv, p_verified: !ctx.selftest });
  const m = (made ?? {}) as Any;
  if (error || !m.ok) {
    if (m.reason === "too_many_pending") return fail("limit_hit", "There are already five requests waiting on your phone. Clear those first.", { reason: m.reason });
    if (m.reason === "daily_cap") return fail("limit_hit", "That's twenty approval requests today, the limit. Use the button in admin.", { reason: m.reason });
    return fail("upstream_down", "I couldn't set that up just now. Use the button in admin.", { error: error ? fit(error.message, 80) : String(m.reason ?? "") });
  }
  const code = String(m.code);
  let pushed = m.pushed === true;
  if (!ctx.selftest && !pushed) {
    const { data: res } = await sb.rpc("ava_approval_push", { p_code: code });
    pushed = REQUEST_PUSH_OK.has(String(res ?? ""));
    if (!pushed) {
      return { ok: true, say: "The request is made but the push didn't go. Look in your bell in admin and tap it there.", data: { action, issue: item.name, approval: "pending", pushed: false, push: fit(String(res ?? "none"), 20) },
        _log: { args: { issue_key: item.key, approval: code.slice(0, 2) + "*****" } } };
    }
  }
  const expires = t12(String(m.expires_at));
  if (!ctx.selftest && !m.existing) {
    bg(threadNote(`Ava (voice): you asked me by phone to ${action === "undo" ? "put back" : "approve"} "${title}". I sent it to your phone for a Face ID tap. It expires at ${expires}.`, `"${title}"`));
  }
  const say = ctx.selftest ? "Selftest: request created, nothing was sent." : m.existing ? "That's already on your phone. Tap it and Face ID it." : "Sent to your phone. Tap it and Face ID it.";
  return { ok: true, say, data: { action, issue: item.name, approval: "pending", pushed, selftest: ctx.selftest || undefined, expires_at_pacific: expires, ...(ctx.selftest ? { code } : {}) },
    next: "Keep chatting. When he says he tapped it, call check.", _log: { args: { issue_key: item.key, approval: code.slice(0, 2) + "*****" } } };
}

// ----- retry: the Fix Ladder's own "Try again" -----
async function priorOk(idem: string): Promise<Reply | null> {
  const since = new Date(Date.now() - IDEM_MS).toISOString();
  const { data: prior } = await sb.from("ava_admin_bridge_log").select("say, data").eq("idem_key", idem).eq("ok", true).gte("ts", since).order("ts", { ascending: false }).limit(1);
  return prior?.length ? { ok: true, say: `Already done a minute ago. ${prior[0].say ?? ""}`.trim(), data: { ...(prior[0].data as Any ?? {}), repeat: true } } : null;
}
async function fixRetry(ctx: Ctx, p: Any, confirmed: boolean): Promise<R> {
  const all = await loadItems();
  if (!all) return fail("upstream_down", "I couldn't read the issues just now.");
  const inc = all.items.filter((i) => i.kind === "incident");
  const issue = clip(p.issue, 120);
  let item: Item;
  if (!issue) {
    if (inc.length === 1) item = inc[0];
    else if (!inc.length) return fail("not_found", "There's nothing open I can try again.");
    else return { ...ambiguous(inc), say: `Which one should I try again? ${inc.slice(0, 3).map((h) => h.name).join(", ")}.` };
  } else {
    const r = resolveItem(all.items, issue, "issue");
    if ("ok" in r) return r;
    item = r.item;
  }
  if (item.kind !== "incident") return fail("needs_tap", `${cap(item.name)} isn't something I can try again. It needs you in admin.`, { issue: item.name });
  const note = item.stage === "needs_yes" ? " It already has a fix ready; trying again starts the ladder over." : "";
  if (!confirmed) {
    return { ok: false, reason_code: "not_confirmed", say: `Try the ladder again on ${item.name}.${note} Say yes and I'll do it.`, data: { preview: true, action: "retry", issue: item.name },
      next: "Read that back to Jared, then call again with confirmed true after a clear yes.", _log: { args: { issue_key: item.key } } };
  }
  const idem = `${ctx.conv}|retry|${item.key}`;
  const rep = await priorOk(idem);
  if (rep) return rep;
  const run = fetch(`${SB_URL}/functions/v1/fix-ladder`, { method: "POST", headers: keyHeaders(SB_SECRET), body: JSON.stringify({ op: "retry", key: item.key }) })
    .then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) as Any })).catch(() => ({ status: 0, j: {} as Any }));
  bg(run);
  const first = await Promise.race([run, sleep(LADDER_WAIT_MS)]);
  if (first && (first.status === 0 || first.status >= 400 || first.j.ok === false)) return fail("upstream_down", "The ladder didn't take that. Try the button in admin.", { issue: item.name });
  const already = first?.j?.result === "already fixed";
  const say = already ? `${cap(item.name)} is already fixed.` : "Kicked it back to the ladder. I'll check in a minute.";
  bg(bellNote(`Ava (voice): tried the ladder again on ${fit(item.title, 80)}`, `You asked on a call. ${t12(Date.now())} Pacific.`, `ava-retry-${item.key}-${Math.floor(Date.now() / IDEM_MS)}`));
  return { ok: true, say, data: { issue: item.name, action: "retry", ladder: first ? fit(String(first.j.result ?? "started"), 40) : "started" }, _log: { idem_key: idem, args: { issue_key: item.key } } };
}

// ----- ask_scout: a background Scout job on autopilot (writes blocked in admin-chat), logged in the "Ava (voice)" thread -----
async function scoutToday(): Promise<number> {
  const { count } = await sb.from("ava_admin_bridge_log").select("id", { count: "exact", head: true }).eq("op", "fix_ask_scout").eq("ok", true).gte("ts", pacificMidnightIso());
  return count ?? 0;
}
const QUESTION_WORDS = /^\s*(who|what|what's|whats|why|how|which|when|where|is|are|does|do|did|can|could|will|any|tell me|show me|list|check|status)\b/i;
async function fixAskScout(ctx: Ctx, p: Any, confirmed: boolean): Promise<R> {
  let ask = clip(p.ask, 500);
  const issue = clip(p.issue, 120);
  let about = "";
  if (issue) {
    const all = await loadItems();
    if (!all) return fail("upstream_down", "I couldn't read the issues just now.");
    const r = resolveItem(all.items, issue, "issue");
    if ("ok" in r) return r;
    about = r.item.title;
    if (!ask) ask = `Look into this issue and tell me what is wrong and what you would do: ${about}`;
  }
  if (ask.length < 6) return fail("bad_request", "What should I ask Scout? One sentence is plenty.");
  const preview = `Ask Scout${about ? ` about ${fit(about, 50)}` : ""}: ${fit(ask, 90)}`;
  if (!confirmed) {
    return { ok: false, reason_code: "not_confirmed", say: `${preview}. It only looks, it can't change anything. Say yes and I'll send it.`, data: { preview: true, action: "ask_scout" },
      next: "Read that back to Jared, then call again with confirmed true after a clear yes." };
  }
  const idem = `${ctx.conv}|ask_scout|${hexOf(await sha(ask + about)).slice(0, 12)}`;
  const rep = await priorOk(idem);
  if (rep) return rep;
  const used = await scoutToday();
  if (used >= DAILY_SCOUT) return fail("limit_hit", `That's ${num(DAILY_SCOUT)} Scout jobs through me today, the limit. Try tomorrow, or ask Scout in admin.`, { used, limit: DAILY_SCOUT });
  const th = await voiceThread();
  if (!th) return fail("upstream_down", "I couldn't open the Scout chat just now.");
  const jobId = `av${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const q = QUESTION_WORDS.test(ask) && !/[?.!]\s*$/.test(ask) ? `${ask}?` : ask;
  const text = `[Ava job ${jobId}] From Ava, Jared on the phone. He asked this out loud and Ava will read your answer to him, so reply in one or two short plain sentences, no lists or markdown. ` +
    `This path is read-only: nothing can be changed from here. If the answer needs a change or his yes, say what you would do in one line.${about ? `\nIt is about this issue: ${about}.` : ""}\nHe said: ${q}`;
  const run = fetch(`${SB_URL}/functions/v1/admin-chat`, { method: "POST", headers: keyHeaders(SB_SECRET), body: JSON.stringify({ body: text.slice(0, 5800), autopilot: true, thread_id: th.id, title: VOICE_THREAD }) })
    .then(async (r) => ({ status: r.status, text: (await r.text().catch(() => "")).slice(0, 200) })).catch(() => ({ status: 0, text: "" }));
  bg(run);
  const early = await Promise.race([run, sleep(SCOUT_START_WAIT_MS)]);
  if (early && (early.status === 0 || early.status >= 400)) return fail("upstream_down", "Scout didn't pick that up. Try again in a minute.", { status: early.status });
  bg(bellNote(`Ava (voice): asked Scout: ${fit(ask, 100)}`, `You asked on a call. Read-only. The answer lands in the Ava (voice) chat.`, `ava-scout-${jobId}`));
  return { ok: true, say: "Scout's looking into it. Give it a couple of minutes, then ask me to check.", data: { job_id: jobId, action: "ask_scout", status: "running" }, next: "Keep chatting; ask me to check when you want the answer.",
    _log: { idem_key: idem, args: { job_id: jobId, ask: clip(ask, 120) } } };
}

// ----- check: read the job back out of the "Ava (voice)" thread -----
type JobRead = { status: "running" | "done" | "fixed" | "needs_yes" | "stuck"; line: string };
function readJob(reply: string): JobRead {
  const clean = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*OPTIONS:.*$/gim, "").replace(/[*_`#>\[\]]/g, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const last = [...reply.matchAll(/^(FIXED|NEEDS_YES|STUCK):\s*(.+)$/gm)].pop();
  if (last && last[1] === "NEEDS_YES" && /paid AI/i.test(last[2])) return { status: "needs_yes", line: "The free AI couldn't finish it. Going further would use paid AI, and that's your call in admin" };
  if (last) return { status: last[1].toLowerCase() as JobRead["status"], line: fit(clean(last[2]), 150) };
  const body = clean(reply.split(/\n\s*\n/)[0] ?? reply);
  const sentence = (body.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? body).trim();
  let line = sentence;
  if (line.length > 150) { const cut = line.slice(0, 170); const k = Math.max(cut.lastIndexOf(";"), cut.lastIndexOf(" - ")); line = k > 60 ? cut.slice(0, k) : fit(line, 150); }
  return { status: "done", line: line.replace(/[\s,;:]+$/, "") };
}
/** The tap request Ava made on this call, and then the Scout job the tap started. */
async function approvalCheck(ctx: Ctx, a: Any): Promise<R> {
  const id = String(a.id), status = String(a.status), undo = a.kind === "undo";
  const base = { approval: status, kind: a.kind, issue: spoken(plainTitle(String(a.issue_title ?? ""))) };
  if (status === "pending" && Date.parse(String(a.expires_at)) <= Date.now()) {
    await sb.from("ava_approvals").update({ status: "expired" }).eq("id", id).eq("status", "pending");
    return { ok: true, say: "That request timed out before you tapped. Want me to send it again?", data: { ...base, approval: "expired" }, _log: { args: { approval_id: id } } };
  }
  if (status === "pending") {
    const mins = Math.max(1, Math.ceil((Date.parse(String(a.expires_at)) - Date.now()) / 60_000));
    return { ok: true, say: `Still waiting on your tap. It's on your phone, about ${plural(mins, "minute")} left.`, data: { ...base, minutes_left: mins }, _log: { args: { approval_id: id } } };
  }
  if (status === "expired") {
    return { ok: true, say: a.result === "changed" ? "That fix changed since I asked, so I dropped it. Want me to send it again?" : "That request timed out before you tapped. Want me to send it again?", data: base, _log: { args: { approval_id: id } } };
  }
  if (status === "declined") return { ok: true, say: "You said no on your phone, so nothing ran.", data: base, _log: { args: { approval_id: id } } };
  // approved / running / done / failed: your tap went through. Read Scout's answer out of the Ava (voice) chat.
  const since = a.decided_at ? Date.parse(String(a.decided_at)) : Date.now();
  if (status === "failed") return { ok: true, say: "Your tap went through but Scout didn't start it. Tap Yes, do it in admin instead.", data: { ...base, result: fit(String(a.result ?? ""), 100) }, _log: { args: { approval_id: id } } };
  const thread = String(a.run_thread_id ?? "");
  let reply = "", started = false;
  if (thread) {
    const { data: um } = await sb.from("admin_chat_messages").select("id, body, created_at").eq("thread_id", thread).eq("role", "user")
      .gte("created_at", new Date(since - 5000).toISOString()).order("created_at").limit(10);
    const mine = ((um ?? []) as Any[]).find((m) => String(m.body).replace(/\s+/g, " ").trim().startsWith(String(a.action_text).replace(/\s+/g, " ").trim().slice(0, 120)));
    if (mine) {
      started = true;
      const { data: after } = await sb.from("admin_chat_messages").select("role, body").eq("thread_id", thread).gt("created_at", String(mine.created_at)).order("created_at").limit(12);
      for (const m of (after ?? []) as Any[]) { if (m.role === "user") break; if (m.role === "assistant") reply = String(m.body); }
    }
  }
  if (!reply) {
    const age = Date.now() - since;
    if (!started && age > JOB_STALE_MS) return { ok: true, say: "Got your tap, but I don't see Scout start. Look in the Ava voice chat in admin.", data: { ...base, scout: "not_started" }, _log: { args: { approval_id: id } } };
    if (age > JOB_STALE_MS * 2) return { ok: true, say: "Got your tap. Scout hasn't answered after a while. It's in the Ava voice chat in admin.", data: { ...base, scout: "stuck" }, _log: { args: { approval_id: id } } };
    return { ok: true, say: started ? "Got your tap. Scout's on it." : "Got your tap. Scout's starting.", data: { ...base, scout: started ? "running" : "starting" }, _log: { args: { approval_id: id } } };
  }
  const r = readJob(reply);
  const what = undo ? "put it back" : "fixed it";
  const say = r.status === "needs_yes" ? `Got your tap. Scout needs one more yes: ${r.line}. It's in the Ava voice chat in admin.`
    : r.status === "stuck" ? `Got your tap, but Scout got stuck: ${r.line}.` : r.status === "fixed" ? `Got your tap. Scout ${what}: ${r.line}.` : `Got your tap. Scout says: ${r.line.replace(/[.!?]?$/, ".")}`;
  if ((r.status === "needs_yes" || r.status === "stuck") && !ctx.selftest) {
    bg(bellNote(`Ava (voice): Scout ${r.status === "stuck" ? "got stuck" : "needs one more yes"} after your tap`, fit(r.line, 200), `ava-approval-result-${String(a.code)}`));
  }
  return { ok: true, say, data: { ...base, scout: r.status, result: r.line }, _log: { args: { approval_id: id } } };
}

async function fixCheck(ctx: Ctx, p: Any): Promise<R> {
  let jobId = clip(p.job_id, 20).toLowerCase();
  if (jobId && !/^av[0-9a-f]{6}$/.test(jobId)) jobId = "";
  if (!jobId) {
    const { data } = await sb.from("ava_admin_bridge_log").select("args, ts").eq("conversation_id", ctx.conv).eq("op", "fix_ask_scout").eq("ok", true).order("ts", { ascending: false }).limit(1);
    jobId = String((data?.[0]?.args as Any | undefined)?.job_id ?? "");
    // Whichever she did last on this call wins: a tap request newer than the last Scout job is what he is asking about.
    const { data: ap } = await sb.from("ava_approvals").select("*").eq("conversation_id", ctx.conv).order("created_at", { ascending: false }).limit(1);
    const a = ap?.[0] as Any | undefined;
    if (a && (!jobId || Date.parse(String(a.created_at)) > Date.parse(String(data?.[0]?.ts ?? 0)))) return approvalCheck(ctx, a);
  }
  if (!jobId) return fail("not_found", "I haven't sent Scout anything on this call.");
  const th = await voiceThread();
  if (!th) return fail("upstream_down", "I couldn't open the Scout chat just now.");
  const { data: um } = await sb.from("admin_chat_messages").select("id, created_at").eq("thread_id", th.id).eq("role", "user").ilike("body", `%[Ava job ${jobId}]%`).order("created_at", { ascending: false }).limit(1);
  const mine = um?.[0] as Any | undefined;
  if (!mine) return fail("not_found", "I can't find that Scout job.", { job_id: jobId });
  const { data: after } = await sb.from("admin_chat_messages").select("role, body, created_at").eq("thread_id", th.id).gt("created_at", String(mine.created_at)).order("created_at").limit(12);
  let reply = "";
  for (const m of (after ?? []) as Any[]) { if (m.role === "user") break; if (m.role === "assistant") reply = String(m.body); }
  if (!reply) {
    const age = Date.now() - Date.parse(String(mine.created_at));
    if (age > JOB_STALE_MS) return { ok: true, say: "Scout hasn't answered after a few minutes. It's in the Ava voice chat in admin.", data: { job_id: jobId, status: "stuck", result: "no answer yet" }, _log: { args: { job_id: jobId } } };
    return { ok: true, say: "Scout's still working on it.", data: { job_id: jobId, status: "running" }, _log: { args: { job_id: jobId } } };
  }
  const r = readJob(reply);
  const say = r.status === "needs_yes" ? `Scout needs one yes: ${r.line}. That one needs your tap in admin.`
    : r.status === "stuck" ? `Scout got stuck: ${r.line}.` : r.status === "fixed" ? `Scout fixed it: ${r.line}.` : `Scout says: ${r.line.replace(/[.!?]?$/, ".")}`;
  if ((r.status === "needs_yes" || r.status === "stuck") && !ctx.selftest) {
    bg(bellNote(`Ava (voice): Scout ${r.status === "stuck" ? "got stuck" : "needs a yes"} on the job you asked for`, fit(r.line, 200), `ava-scout-result-${jobId}`));
  }
  return { ok: true, say, data: { job_id: jobId, status: r.status, result: r.line }, _log: { args: { job_id: jobId } } };
}

async function fix(ctx: Ctx, p: Any): Promise<R> {
  const action = clip(p.action, 20).toLowerCase();
  if (!(FIX_ACTIONS as readonly string[]).includes(action)) return fail("bad_request", "I can list what's broken, try one again, ask Scout, or check on a Scout job.");
  const confirmed = p.confirmed === true || String(p.confirmed).toLowerCase() === "true";
  if (action === "list") return fixList();
  if (action === "retry") return fixRetry(ctx, p, confirmed);
  if (action === "ask_scout") return fixAskScout(ctx, p, confirmed);
  if (action === "check") return fixCheck(ctx, p);
  // approve / undo: never executed here, whatever `confirmed` says. They create a request for Jared's phone (passkey tap).
  const all = await loadItems();
  if (!all) return fail("upstream_down", "I couldn't read the issues just now.");
  const issue = clip(p.issue, 120);
  const pool = action === "undo" ? [...all.autofix, ...all.items] : all.items;
  let item: Item;
  if (!issue) {
    const cands = action === "undo" ? all.autofix : all.items.filter((i) => i.stage === "needs_yes");
    if (!cands.length) return fail("not_found", action === "undo" ? "I don't see an automatic fix I could put back." : "Nothing is waiting on your yes right now.");
    if (cands.length > 1) return { ...ambiguous(cands), say: `Which one? ${cands.slice(0, 3).map((h) => h.name).join(", ")}.` };
    item = cands[0];
  } else {
    const r = resolveItem(pool, issue, action === "undo" ? "fix" : "issue");
    if ("ok" in r) return r;
    item = r.item;
  }
  return requestTap(ctx, p, action as "approve" | "undo", item, confirmed);
}

// ---------- selftest + recovery ----------
async function xi(path: string, method = "GET", body?: Any): Promise<{ ok: boolean; status: number; j: Any }> {
  const key = await xiKey();
  if (!key) return { ok: false, status: 0, j: { error: "no ElevenLabs key" } };
  try {
    const r = await fetch(`${XI}${path}`, { method, headers: { "xi-api-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) as Any };
  } catch (e) { return { ok: false, status: 0, j: { error: clip((e as Error).message, 100) } }; }
}
type State = { el_secret_id: string | null; tool_ids: string[]; agent_id: string | null; detail: Any };
async function getState(): Promise<State> {
  const { data } = await sb.from("ava_admin_bridge_state").select("el_secret_id, tool_ids, agent_id, detail").eq("id", true).maybeSingle();
  return { el_secret_id: (data?.el_secret_id as string | null) ?? null, tool_ids: (data?.tool_ids as string[] | null) ?? [], agent_id: (data?.agent_id as string | null) ?? AVA_AGENT, detail: (data?.detail as Any | null) ?? {} };
}
/** Pushes the Vault bridge secret to the ElevenLabs workspace secret (create or update). Never returns or logs the value. */
async function syncSecret(): Promise<{ ok: boolean; secret_id?: string; error?: string }> {
  const val = await bridgeSecret();
  if (!val) return { ok: false, error: "no Vault secret" };
  const st = await getState();
  let id = st.el_secret_id;
  if (!id) {
    const list = await xi("/convai/secrets");
    const hit = ((list.j.secrets ?? []) as Any[]).find((s) => s.name === SECRET_NAME);
    id = hit ? String(hit.secret_id) : null;
  }
  let res = id ? await xi(`/convai/secrets/${id}`, "PATCH", { name: SECRET_NAME, value: val, type: "update" }) : null;
  if (!res || !res.ok) {
    res = await xi("/convai/secrets", "POST", { name: SECRET_NAME, value: val, type: "new" });
    if (res.ok && res.j.secret_id) id = String(res.j.secret_id);
  }
  if (!res.ok || !id) return { ok: false, error: `ElevenLabs refused the secret (${res.status}): ${fit(JSON.stringify(res.j).replace(val, "[secret]"), 160)}` };
  const fp = hexOf(await sha(val)).slice(0, 16);
  await sb.from("ava_admin_bridge_state").update({ el_secret_id: id, detail: { ...st.detail, synced_fp: fp, synced_at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", true);
  return { ok: true, secret_id: id };
}

type Check = { name: string; ok: boolean; ms?: number; note?: string };
async function selftest(): Promise<Any> {
  const checks: Check[] = []; const fixes: string[] = [];
  const add = (name: string, ok: boolean, note?: string, ms?: number) => checks.push({ name, ok, ...(note ? { note } : {}), ...(ms !== undefined ? { ms } : {}) });
  const secret = await bridgeSecret();
  add("vault_secret", !!secret);
  const st = await getState();
  const agentId = st.agent_id ?? AVA_AGENT;

  // 1. our own endpoints, three rounds each, with the selftest stub (skips only the conversation check)
  const lat: number[] = [];
  const hit = async (path: string, init: RequestInit, want: (s: number, j: Any) => boolean, label: string) => {
    const t = Date.now();
    let s = 0, j: Any = {};
    try { const r = await fetch(`${SELF}${path}`, { ...init, signal: AbortSignal.timeout(8000) }); s = r.status; j = await r.json().catch(() => ({})) as Any; } catch { /* counted as a failure */ }
    const ms = Date.now() - t; lat.push(ms);
    add(label, want(s, j), s ? `${s}` : "no answer", ms);
  };
  if (secret) {
    const H = { Authorization: `Bearer ${secret}`, "x-ava-selftest": SB_SECRET, "Content-Type": "application/json" };
    const qs = "conversation_id=conv_selftest&caller_id=%2B18165007236";
    for (let i = 0; i < 3; i++) {
      await Promise.all([
        hit(`/status?${qs}`, { headers: H }, (s, j) => s === 200 && j.ok === true && typeof j.say === "string", "status"),
        hit(`/metrics?${qs}&range=today`, { headers: H }, (s, j) => s === 200 && j.ok === true, "metrics"),
        hit(`/calls`, { method: "POST", headers: H, body: JSON.stringify({ conversation_id: "conv_selftest", caller_id: "+18165007236", action: "pause_campaign", agent: "maya", campaign: "zz-selftest-no-such-campaign", confirmed: false }) },
          (s, j) => s === 200 && j.reason_code === "not_found", "calls_dry"),
        // Phase A fix routes: a real list, a retry that cannot match anything, and an approve that must never come back ok
        hit(`/fix`, { method: "POST", headers: H, body: JSON.stringify({ conversation_id: "conv_selftest", caller_id: "+18165007236", action: "list" }) },
          (s, j) => s === 200 && j.ok === true && typeof j.say === "string", "fix_list"),
        hit(`/fix`, { method: "POST", headers: H, body: JSON.stringify({ conversation_id: "conv_selftest", caller_id: "+18165007236", action: "retry", issue: "zzqx-selftest-no-such-issue", confirmed: false }) },
          (s, j) => s === 200 && j.ok === false && j.reason_code === "not_found", "fix_retry_dry"),
        // Phase B: an approve never runs anything, and on the selftest stub it does not even create a request unless explicitly asked
        hit(`/fix`, { method: "POST", headers: H, body: JSON.stringify({ conversation_id: "conv_selftest", caller_id: "+18165007236", action: "approve", confirmed: true }) },
          (s, j) => s === 200 && j.ok === false && ["needs_tap", "not_found", "ambiguous", "not_confirmed", "not_ready", "already_done"].includes(String(j.reason_code)), "fix_approve_never_runs"),
        hit(`/fix`, { method: "POST", headers: H, body: JSON.stringify({ conversation_id: "conv_selftest", caller_id: "+18165007236", action: "undo", issue: "zzqx-selftest-no-such-fix", confirmed: true }) },
          (s, j) => s === 200 && j.ok === false && j.reason_code === "not_found", "fix_undo_dry"),
      ]);
    }
    // approvals: nothing the dry runs did may have created a request; expired / used / mismatched / un-tapped are refused; the tap page, push and the passkey endpoint are up
    const probe = async (label: string, run: () => Promise<{ ok: boolean; note?: string }>) => {
      const t = Date.now();
      let r: { ok: boolean; note?: string } = { ok: false, note: "no answer" };
      try { r = await run(); } catch (e) { r = { ok: false, note: clip((e as Error).message, 60) }; }
      add(label, r.ok, r.note, Date.now() - t);
    };
    await probe("approval_refusals", async () => {
      const { data, error } = await sb.rpc("ava_approval_selftest");
      const d = (data ?? {}) as Any;
      return { ok: !error && d.ok === true, note: error ? fit(error.message, 60) : ((d.checks ?? []) as Any[]).filter((c) => c.ok !== true).map((c) => String(c.name)).join(", ") || undefined };
    });
    await probe("approvals_swept", async () => {
      const { data, error } = await sb.rpc("ava_approvals_sweep");
      const d = (data ?? {}) as Any;
      return { ok: !error && Number(d.approved_waiting_over_30m ?? 0) === 0, note: error ? fit(error.message, 60) : `${d.pending ?? 0} waiting` };
    });
    await probe("no_dry_run_created_requests", async () => {
      const { count } = await sb.from("ava_approvals").select("id", { count: "exact", head: true }).eq("conversation_id", "conv_selftest").gte("created_at", new Date(Date.now() - 5 * 60_000).toISOString());
      return { ok: (count ?? 0) === 0, note: `${count ?? 0}` };
    });
    await probe("tap_page_loads", async () => {
      const r = await fetch("https://www.bestly.tech/y/zzzzzzz", { signal: AbortSignal.timeout(7000) });
      const html = await r.text();
      return { ok: r.status === 200 && html.includes('id="root"'), note: `${r.status}` };
    });
    await probe("push_notify_reachable", async () => {
      const r = await fetch(`${SB_URL}/functions/v1/push-notify`, { method: "POST", headers: keyHeaders(SB_SECRET), body: JSON.stringify({ action: "init" }), signal: AbortSignal.timeout(7000) });
      const j = await r.json().catch(() => ({})) as Any;
      return { ok: r.status === 200 && typeof j.public_key === "string", note: `${r.status}` };
    });
    await probe("passkey_endpoint_guarded", async () => {
      const r = await fetch(`${SB_URL}/functions/v1/webauthn-authenticate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approval_options", code: "zzzzzzz", origin: "https://www.bestly.tech" }), signal: AbortSignal.timeout(7000) });
      const j = await r.json().catch(() => ({})) as Any;
      return { ok: r.status === 200 && /sign in/i.test(String(j.error ?? "")), note: `${r.status}` };
    });
    await hit(`/status?${qs}`, { headers: { Authorization: "Bearer not-the-secret", "x-ava-selftest": SB_SECRET } }, (s) => s === 401, "bad_secret_401");
    await hit(`/status?conversation_id=conv_selftest&caller_id=%2B15555550100`, { headers: { Authorization: `Bearer ${secret}` } }, (s, j) => s === 200 && j.ok === false, "stub_needs_service_key");
  }
  const sorted = [...lat].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
  add("p95_under_1500ms", p95 <= 1500, `${p95} ms`);

  // 2. Ava still has her 4 bridge tools (status, metrics, call_ops, fix_issue), her prompt block (with the fix_issue and passkey-tap rules), and the ElevenLabs secret still matches Vault
  const verifyEl = async () => {
    const out: { tools: boolean; prompt: boolean; secret: boolean; agent: Any | null } = { tools: false, prompt: false, secret: false, agent: null };
    const a = await xi(`/convai/agents/${agentId}`);
    if (a.ok) {
      const pr = (((a.j.conversation_config as Any | undefined)?.agent as Any | undefined)?.prompt ?? {}) as Any;
      const ids = ((pr.tool_ids ?? []) as string[]);
      out.tools = st.tool_ids.length >= 4 && st.tool_ids.every((t) => ids.includes(t));   // admin_status, call_ops, admin_metrics + fix_issue
      out.prompt = String(pr.prompt ?? "").includes(MARKER) && String(pr.prompt ?? "").includes(FIX_MARKER) && String(pr.prompt ?? "").includes(APPROVAL_MARKER);
      out.agent = pr;
    }
    const list = await xi("/convai/secrets");
    const hitS = ((list.j.secrets ?? []) as Any[]).find((s) => s.name === SECRET_NAME);
    const fp = secret ? hexOf(await sha(secret)).slice(0, 16) : "";
    const st2 = await getState();
    out.secret = !!hitS && !!st2.el_secret_id && st2.el_secret_id === hitS.secret_id && st2.detail.synced_fp === fp;
    return out;
  };
  let el = await verifyEl();
  if (!el.tools || !el.prompt || !el.secret) {
    // recover: re-attach the tools (keeping everything she already has), re-add the prompt block, re-sync the secret
    if (!el.secret) { const r = await syncSecret(); fixes.push(r.ok ? "re-synced the ElevenLabs secret" : `secret sync failed: ${r.error}`); }
    if ((!el.tools || !el.prompt) && el.agent) {
      const pr = el.agent; const ids = Array.from(new Set([...(((pr.tool_ids ?? []) as string[])), ...st.tool_ids]));
      const body: Any = { tool_ids: ids };
      if (!el.prompt) body.prompt = withPromptBlock(String(pr.prompt ?? ""));   // append if missing, swap in place if an older copy of the block is there
      const r = await xi(`/convai/agents/${agentId}`, "PATCH", { conversation_config: { agent: { prompt: body } } });
      fixes.push(r.ok ? `${!el.tools ? "re-attached her tools" : ""}${!el.tools && !el.prompt ? " and " : ""}${!el.prompt ? "re-added her admin prompt block" : ""}` : `agent patch failed (${r.status})`);
    }
    el = await verifyEl();
  }
  add("ava_has_tools", el.tools); add("ava_prompt_block", el.prompt); add("el_secret_matches_vault", el.secret);

  const bad = checks.filter((c) => !c.ok);
  const ok = bad.length === 0;
  await sb.from("ava_admin_bridge_state").update({ last_selftest_at: new Date().toISOString(), ok, p95_ms: p95,
    detail: { ...(await getState()).detail, checks: checks.map((c) => `${c.ok ? "ok" : "FAIL"} ${c.name}`), fixes }, ...(fixes.length ? { last_recovered_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }).eq("id", true);
  logRow({ op: "selftest", ok, reason_code: ok ? null : bad[0].name, ms: p95, args: { fixes, failed: bad.map((b) => b.name) } });
  if (ok) {
    await sb.rpc("bestly_raise", { p_key: "ava.admin-bridge", p_kind: "resolved", p_severity: "info", p_title: "her admin line works again", p_body: fixes.length ? `Fixed on its own: ${fixes.join("; ")}.` : null, p_area: "ava" });
  } else {
    await sb.rpc("bestly_raise", { p_key: "ava.admin-bridge", p_kind: "problem", p_severity: "warning", p_title: "I can't reach the business from the phone right now",
      p_body: `My admin line failed its hourly check (${bad.map((b) => b.name).join(", ")}). I tried to fix it${fixes.length ? ` (${fixes.join("; ")})` : ""} and couldn't. I still answer calls and take messages; I just can't read the dashboard.`, p_area: "ava",
      p_needs_jared: "Ask Claude to look at the Ava admin bridge (supabase/functions/ava-admin)." });
  }
  return { ok, p95_ms: p95, checks, fixes };
}

// ---------- router ----------
Deno.serve(async (req) => {
  const path = new URL(req.url).pathname.replace(/^.*\/ava-admin/, "").replace(/\/+$/, "") || "/";
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  try {
    if (path === "/selftest" || path === "/provision") {
      if (!isService(req)) return respond({ ok: false, reason_code: "bad_secret", say: "Service key only." }, 401);
      if (path === "/selftest") return new Response(JSON.stringify(await selftest()), { headers: { "Content-Type": "application/json" } });
      const b = await params(req);
      if (b.op === "sync_secret") return new Response(JSON.stringify(await syncSecret()), { headers: { "Content-Type": "application/json" } });
      return respond(fail("bad_request", "unknown op"));
    }
    const routes: Record<string, { method: string; op: string }> = { "/status": { method: "GET", op: "status" }, "/metrics": { method: "GET", op: "metrics" }, "/calls": { method: "POST", op: "calls" }, "/fix": { method: "POST", op: "fix" } };
    const route = routes[path];
    if (!route) return respond(fail("not_found", "Unknown route."), 404);
    if (req.method !== route.method && !(route.method === "GET" && req.method === "POST")) return respond(fail("bad_request", "Wrong method."), 405);
    const p = await params(req);
    const g = await guard(req, p, route.op);
    if (g instanceof Response) return g;
    let r: Reply & { _log?: Any };
    if (route.op === "status") r = await status(g, p);
    else if (route.op === "metrics") r = await metrics(g, p);
    else if (route.op === "fix") r = await fix(g, p);
    else r = await calls(g, p);
    const opName = route.op === "calls" ? clip(p.action, 20) || "calls" : route.op === "fix" ? `fix_${clip(p.action, 20).toLowerCase() || "unknown"}` : route.op;
    const idem = r._log?.idem_key as string | undefined;
    const args: Any = route.op === "calls" ? { action: p.action, agent: p.agent, campaign: clip(p.campaign, 60) || undefined, to_last4: p.to ? last4(String(p.to)) || clip(p.to, 30) : undefined, purpose: clip(p.purpose, 120) || undefined, confirmed: p.confirmed === true || String(p.confirmed) === "true" }
      : route.op === "status" ? { q: clip(p.q, 60) || undefined }
      : route.op === "fix" ? { action: clip(p.action, 20).toLowerCase(), issue: clip(p.issue, 60) || undefined, confirmed: p.confirmed === true || String(p.confirmed).toLowerCase() === "true", ...((r._log?.args ?? {}) as Any) }
      : { range: p.range, agent: p.agent };
    logRow({ conversation_id: g.conv, caller_id: g.caller, op: opName, args, ok: r.ok, reason_code: r.ok ? null : r.reason_code, ms: Date.now() - g.t0, idem_key: r.ok ? idem : null, say: r.say, data: r.ok && idem ? (r.data ?? null) : null });
    delete r._log;
    return respond(r);
  } catch (e) {
    console.error("ava-admin", (e as Error)?.message);
    return respond(fail("upstream_down", "Something broke on my side. Try again in a minute."));
  }
});
