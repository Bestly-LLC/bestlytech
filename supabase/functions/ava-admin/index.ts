// ava-admin: the bridge between Ava (ElevenLabs agent_0301m44te1qffk08jd2cqwtgy1th) and the Bestly admin.
// Plan: docs/ava-admin-bridge-opusplan.md. verify_jwt = false; the auth is ours.
//
//   GET  /status?conversation_id&caller_id&q     overall health + what needs Jared, or one client / lead / contact by name or phone
//   POST /calls                                   {conversation_id, caller_id, action, agent, campaign?, to?, purpose?, confirmed}
//   GET  /metrics?conversation_id&caller_id&range&agent
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
const MARKER = "Admin bridge";

/** The block appended to Ava's system prompt (Jared owns her tone, so this is all that was added). The selftest re-adds it if a setup run wipes it. */
const PROMPT_BLOCK = `Admin bridge (Jared only):
- When Jared asks about the business, what needs him, how Maya, Reese, Leo or you are doing, calls, spend, leads or campaigns, use the admin tools and say the "say" line back as written, in your natural voice. Don't add facts the tool didn't give. If it offers a "next" line you may offer it in a few words. The tools check who is calling; if one says only Jared can pull that up, say so and move on.
- To start, pause or resume a campaign, or place a call for him: first call call_ops without confirmed to get the exact action line, say it back in one short line, and only after a clear yes call call_ops again with confirmed true. Never confirm on your own, and never for anyone but Jared.
- Never mention tools, IDs, JSON or that a system sits behind this. If a tool fails, say so in a few words and offer to take a note instead.`;

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
const t12 = (d: string | number | Date) => T12.format(new Date(d)).replace(/ /g, " ");
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
  return (sp > n * 0.5 ? cut.slice(0, sp) : t.slice(0, n)).replace(/[\s,;:.\-–—]+$/, "");
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
      ]);
    }
    await hit(`/status?${qs}`, { headers: { Authorization: "Bearer not-the-secret", "x-ava-selftest": SB_SECRET } }, (s) => s === 401, "bad_secret_401");
    await hit(`/status?conversation_id=conv_selftest&caller_id=%2B15555550100`, { headers: { Authorization: `Bearer ${secret}` } }, (s, j) => s === 200 && j.ok === false, "stub_needs_service_key");
  }
  const sorted = [...lat].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
  add("p95_under_1500ms", p95 <= 1500, `${p95} ms`);

  // 2. Ava still has the 3 tools, her prompt block, and the ElevenLabs secret still matches Vault
  const verifyEl = async () => {
    const out: { tools: boolean; prompt: boolean; secret: boolean; agent: Any | null } = { tools: false, prompt: false, secret: false, agent: null };
    const a = await xi(`/convai/agents/${agentId}`);
    if (a.ok) {
      const pr = (((a.j.conversation_config as Any | undefined)?.agent as Any | undefined)?.prompt ?? {}) as Any;
      const ids = ((pr.tool_ids ?? []) as string[]);
      out.tools = st.tool_ids.length === 3 && st.tool_ids.every((t) => ids.includes(t));
      out.prompt = String(pr.prompt ?? "").includes(MARKER);
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
      if (!el.prompt) body.prompt = `${String(pr.prompt ?? "").trimEnd()}\n\n${PROMPT_BLOCK}`;
      const r = await xi(`/convai/agents/${agentId}`, "PATCH", { conversation_config: { agent: { prompt: body } } });
      fixes.push(r.ok ? `${!el.tools ? "re-attached her tools" : ""}${!el.tools && !el.prompt ? " and " : ""}${!el.prompt ? "re-added her admin prompt block" : ""}` : `agent patch failed (${r.status})`);
    }
    el = await verifyEl();
  }
  add("ava_has_3_tools", el.tools); add("ava_prompt_block", el.prompt); add("el_secret_matches_vault", el.secret);

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
    const routes: Record<string, { method: string; op: string }> = { "/status": { method: "GET", op: "status" }, "/metrics": { method: "GET", op: "metrics" }, "/calls": { method: "POST", op: "calls" } };
    const route = routes[path];
    if (!route) return respond(fail("not_found", "Unknown route."), 404);
    if (req.method !== route.method && !(route.method === "GET" && req.method === "POST")) return respond(fail("bad_request", "Wrong method."), 405);
    const p = await params(req);
    const g = await guard(req, p, route.op);
    if (g instanceof Response) return g;
    let r: Reply & { _log?: Any };
    if (route.op === "status") r = await status(g, p);
    else if (route.op === "metrics") r = await metrics(g, p);
    else r = await calls(g, p);
    const opName = route.op === "calls" ? clip(p.action, 20) || "calls" : route.op;
    const idem = r._log?.idem_key as string | undefined;
    const args: Any = route.op === "calls" ? { action: p.action, agent: p.agent, campaign: clip(p.campaign, 60) || undefined, to_last4: p.to ? last4(String(p.to)) || clip(p.to, 30) : undefined, purpose: clip(p.purpose, 120) || undefined, confirmed: p.confirmed === true || String(p.confirmed) === "true" }
      : route.op === "status" ? { q: clip(p.q, 60) || undefined } : { range: p.range, agent: p.agent };
    logRow({ conversation_id: g.conv, caller_id: g.caller, op: opName, args, ok: r.ok, reason_code: r.ok ? null : r.reason_code, ms: Date.now() - g.t0, idem_key: r.ok ? idem : null, say: r.say, data: r.ok && idem ? (r.data ?? null) : null });
    delete r._log;
    return respond(r);
  } catch (e) {
    console.error("ava-admin", (e as Error)?.message);
    return respond(fail("upstream_down", "Something broke on my side. Try again in a minute."));
  }
});
