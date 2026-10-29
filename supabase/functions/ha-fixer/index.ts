// ha-fixer — Tinker, the Home Automation Engineer, fixing and troubleshooting what is ALREADY in Home Assistant
// ("Fix a problem" and "My automations" on /admin/home-hub/automations). Plan: docs/ha-fixer-opusplan.md.
// Free models only: every call is llm({ paid: "never", privacy: "private" }). Nothing is ever applied without Jared's tap.
//
// POST JSON { op, ... }  ->  { ok: true, row? }  |  { ok: false, error }   (errors are plain words, HTTP 200 unless auth fails)
//   diagnose  { question, focus? }  "What went wrong?" -> evidence from the Pi -> plain-words story -> proposed fix (background; the page watches the row)
//   revise    { id, feedback }      Jared corrects Tinker; the same pipeline runs again on the same evidence
//   apply     { id }                ADMIN ONLY. Sends the fix to the Pi (item_edit / package_patch / toggle_automation); the Pi backs the original up first
//   undo      { id }                ADMIN ONLY. Puts the original back (the Pi's backup, or the saved previous version)
//   discard   { id }
//   handoff   { id }                build the prompt and queue a Scout Code Worker job (when Tinker is not sure)
//   inventory {}                    ask the Pi for the list of every automation and script (UI-made and package-based)
//   toggle    { entity_id, enabled }  turn an automation on or off from the list
//   continue  { id | inventory_cmd }  service role only: the Pi answered (called by the ha_fixer_on_command trigger)
//   watch                           cron (every 5 min), service role only: stuck rows, waiting analyses, warm list, Code Worker hand-backs
//
// Admin only (has_role admin), except continue/watch which take the service role. verify_jwt = true.
// The Pi agent (1.6.2+) enforces the same rules again: fingerprints, backups, no shell/REST/secret plumbing, check_config before reload.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { parse as yamlParse } from "jsr:@std/yaml@1.0.5";
import { corsHeaders } from "../_shared/cors.ts";
import { llm, LlmUnavailable, outOfRoomMessage } from "../_shared/free-llm.ts";
import {
  applyEdits, buildTimeline, checkConfig, clone, denyAdded, describeConfig, digestEvidence, ENTITY_RE, entityTargets, guessEntities, houseRuleProblems,
  isObj, type Json, lineDiff, localToUtc, minimalEdit, nameOf, newUnknownEntities, normalizeDiagnosis, parseWhen, defaultScope, plainErr, riskReasons, type Row,
  semverLt, str, strList, stripHaTags, toYaml, DENY, type Suspect,
} from "./lib.ts";

/* ───────── setup ───────── */

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
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...corsHeaders } });

const REPO = "Bestly-LLC/bestlytech";
const MIN_AGENT = "1.6.2";
const CATALOG_FRESH_MS = 30 * 60_000;
const INVENTORY_WARM_MS = 6 * 3_600_000;
const WAIT_QUICK_TRIES = 6;
const WAIT_MAX_TRIES = 24;
const WAIT_NOTE = "Waiting on a free model. Tinker finishes on his own.";
const BUDGET_MS = 140_000;
const STORY_TOKENS = 1_400;
const FIX_TOKENS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function patch(id: string, fields: Row): Promise<Row | null> {
  const { data, error } = await db.from("ha_fixes").update(fields).eq("id", id).select("*").maybeSingle();
  if (error) console.error("ha-fixer patch", id, error.message);
  return data ?? null;
}
async function getRow(id: unknown): Promise<Row | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from("ha_fixes").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}
async function notify(title: string, body: string, severity: "success" | "info" | "warning", dedupe: string) {
  try { await db.rpc("tinker_notify", { p_title: title, p_body: body, p_severity: severity, p_url: "/admin/home-hub/automations", p_dedupe: dedupe }); }
  catch (e) { console.error("tinker_notify", plainErr(e)); }
}
function inBackground(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {});
}

/* ───────── who is calling ───────── */

const bearer = (req: Request) => (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
const isService = (req: Request) => secretKeys.includes(bearer(req)) || secretKeys.includes(req.headers.get("apikey") ?? "");
async function adminUser(req: Request): Promise<string | null> {
  const b = bearer(req);
  if (!b || b.split(".").length !== 3) return null;
  const { data } = await db.auth.getUser(b);
  if (!data?.user) return null;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return ok === true ? data.user.id : null;
}

/* ───────── the home: catalog, names, agent version ───────── */

type Catalog = { entities: string[][]; services: Record<string, string[]>; captured_at: string };

async function readCatalog(): Promise<Catalog | null> {
  const { data } = await db.from("ha_entity_catalog").select("captured_at, data").eq("id", true).maybeSingle();
  const d = data?.data;
  if (!d || !Array.isArray(d.entities) || d.entities.length === 0) return null;
  return { entities: d.entities, services: isObj(d.services) ? d.services : {}, captured_at: data!.captured_at };
}

/** Same device list the Maker uses: fresh enough, or ask the Pi and wait up to 25 seconds, else the old one. */
async function ensureCatalog(): Promise<Catalog | null> {
  const have = await readCatalog();
  if (have && Date.now() - Date.parse(have.captured_at) < CATALOG_FRESH_MS) return have;
  const since = minutesAgo(3);
  const { data: open } = await db.from("home_hub_commands").select("id").eq("requested_by", "ha-automator").eq("action", "catalog")
    .in("status", ["pending", "running"]).gte("created_at", since).limit(1);
  let cmdId = open?.[0]?.id as string | undefined;
  if (!cmdId) {
    cmdId = crypto.randomUUID();
    const { error } = await db.from("home_hub_commands").insert({ id: cmdId, target: "homeassistant", action: "catalog", payload: {}, requested_by: "ha-automator" });
    if (error) cmdId = undefined;
  }
  if (cmdId) {
    const stop = Date.now() + 25_000;
    while (Date.now() < stop) {
      await sleep(1500);
      const { data: c } = await db.from("home_hub_commands").select("status").eq("id", cmdId).maybeSingle();
      if (c && ["done", "failed", "expired"].includes(c.status)) break;
    }
  }
  return (await readCatalog()) ?? have;
}

async function namesMap(cat: Catalog | null): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const e of cat?.entities ?? []) if (typeof e[0] === "string" && e[1]) m.set(e[0], String(e[1]));
  const { data } = await db.from("ha_inventory").select("view").eq("id", true).maybeSingle();
  for (const v of Array.isArray(data?.view) ? data!.view : []) if (v?.entity_id && v?.name && !m.has(v.entity_id)) m.set(v.entity_id, v.name);
  return m;
}

async function agentVersion(): Promise<string | null> {
  const { data } = await db.from("home_hub_agent_state").select("version").eq("agent", "home-hub").maybeSingle();
  return data?.version ? String(data.version) : null;
}

/** The Pi needs the newest Home Hub agent: say so, and ask it to update itself (agent.update is self-verifying and rolls back). */
async function askAgentUpdate(): Promise<string> {
  const { data: rel } = await db.from("home_hub_agent_releases").select("version, sha256").eq("version", MIN_AGENT).maybeSingle();
  if (!rel) return "no release";
  const { data: open } = await db.from("home_hub_commands").select("id").eq("target", "agent").eq("action", "update").in("status", ["pending", "running"]).limit(1);
  if (open?.length) return "already asked";
  const { error } = await db.from("home_hub_commands").insert({ target: "agent", action: "update", payload: { version: rel.version, sha256: rel.sha256 }, requested_by: "ha-fixer" });
  return error ? "could not ask" : "asked";
}

async function needAgentUpdate(row: Row) {
  const how = await askAgentUpdate();
  await patch(row.id, {
    status: "failed", needs_agent_update: true, wait_tries: 0, retry_at: null,
    error: how === "no release"
      ? "Your Pi needs the newest Home Hub update before Tinker can look into this."
      : "Your Pi needs the newest Home Hub update before Tinker can look into this. Tinker asked it to update, and he starts this question again on his own when it is done.",
  });
}

/* ───────── the model: waiting instead of "try again" ───────── */

async function park(row: Row, note: string, tried: Json[], attempts: number, extra: Row = {}): Promise<void> {
  const tries = (row.wait_tries ?? 0) + 1;
  const base = { tried, attempts: (row.attempts ?? 0) + attempts, ...extra };
  if (tries >= WAIT_MAX_TRIES) {
    await patch(row.id, { ...base, status: "failed", wait_tries: 0, retry_at: null,
      error: "No free model could answer in about 5 hours, so Tinker stopped. Nothing was spent and nothing was changed. Tap Ask again and he starts over." });
    await notify("I could not look into one problem", "No free AI model could answer in about 5 hours. Nothing was spent and nothing was changed.", "info", `tinker.fixgaveup.${row.id}`);
    return;
  }
  let msg = note;
  if (tries >= WAIT_QUICK_TRIES) {
    let ask = "";
    try {
      const room = await outOfRoomMessage({ tried: tried as never, noPaid: true });
      const c = room.candidate;
      ask = c ? `To add room now, connect ${c.label}: get a key at ${c.keyUrl} and save it in Supabase Vault as ${c.keyName}. Scout switches it on within 10 minutes.` : "Every provider on Scout's vetted no-training list is already connected.";
    } catch (e) { console.error("outOfRoomMessage", plainErr(e)); }
    msg = "Every free model is out of room right now. Tinker keeps checking and finishes on his own." + (ask ? " He sent you a note about which new one to connect." : "");
    if (tries === WAIT_QUICK_TRIES) {
      await notify("The free AI is out of room", `I tried every free model for about 30 minutes and none could look into "${String(row.question).replace(/\s+/g, " ").slice(0, 80)}". ${ask} I keep trying on my own.`, "info", `tinker.fixoutofroom.${row.id}`);
    }
  }
  await patch(row.id, { ...base, error: msg, wait_tries: tries, retry_at: new Date(Date.now() + (tries < WAIT_QUICK_TRIES ? 4 : 15) * 60_000).toISOString() });
}

/* ───────── step 1: what happened, when, and to which devices ───────── */

const SCOPE_SYSTEM = `You are Tinker, Jared's Home Assistant troubleshooter. Jared says what went wrong in his house. Decide WHICH devices to look at and WHEN it happened.
Reply with ONE JSON object and nothing else. Keys:
entity_ids: up to 8 entity ids copied from the device list that the problem is about (the lights, switches, fans or covers he talks about). Never invent one.
start and end: when to look, local Pacific time as YYYY-MM-DDTHH:MM (24-hour, only in this answer). Cover from 20 minutes before it began to 60 minutes after, longer if he says it ramps or keeps changing. If he gives no time, use the last 6 hours.
note: one plain sentence saying what you looked at ("around 6:00 AM today"). Times in this sentence are 12-hour.`;

type Scope = { entity_ids: string[]; start: Date; end: Date; note: string; focus: string | null; how: string };

async function inventoryView(): Promise<Row[]> {
  const { data } = await db.from("ha_inventory").select("view").eq("id", true).maybeSingle();
  return Array.isArray(data?.view) ? data!.view : [];
}

/** An automation Jared named ("the shower music one"): score its name against his words. */
function guessAutomation(question: string, view: Row[]): Row | null {
  const words = [...new Set((question.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 4).map((w) => w.replace(/s$/, "")))]
    .filter((w) => !["automation", "script", "light", "lights", "that", "this", "keeps", "wrong", "turns", "turned", "comes", "again", "from", "with", "when", "they", "them", "happen", "happened"].includes(w));
  let best: Row | null = null, bestScore = 0;
  for (const v of view) {
    const hay = `${v.name ?? ""} ${v.entity_id ?? ""}`.toLowerCase().replace(/_/g, " ");
    let s = 0;
    for (const w of words) if (hay.includes(w)) s++;
    if (s > bestScore) { best = v; bestScore = s; }
  }
  return best && bestScore >= 2 ? best : null;
}

async function scopeFor(row: Row, cat: Catalog): Promise<Scope | string> {
  const now = new Date();
  const view = await inventoryView();
  let focus: string | null = typeof row.focus === "string" && /^(automation|script)\.[a-z0-9_]+$/.test(row.focus) ? row.focus : null;
  const named = !focus ? guessAutomation(row.question, view) : null;
  if (named) focus = named.entity_id;
  const focusItem = focus ? view.find((v) => v.entity_id === focus) : null;
  const extra = Array.isArray(focusItem?.targets) ? focusItem!.targets.filter((t: string) => ENTITY_RE.test(t)) : [];
  const parsed = parseWhen(row.question + " " + (row.feedback ?? ""), now);
  let ents = guessEntities(row.question + " " + (row.feedback ?? ""), cat.entities, extra, 8);
  let when = parsed;
  let how = "words";
  if ((!ents.length || !when) && !(focus && ents.length)) {
    // ask a free model for what the words did not settle; one quick try, never waits
    try {
      const lines = cat.entities.filter((e) => /^(light|switch|cover|fan|climate|media_player|lock|scene|input_boolean)\./.test(String(e[0])))
        .map((e) => `${e[0]}|${String(e[1] ?? "").slice(0, 32)}|${String(e[3] ?? "").slice(0, 18)}`).join("\n").slice(0, 5_500);
      const localNow = `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "full", timeStyle: "short" }).format(now)} Pacific`;
      const res = await llm({
        task: "extract", system: SCOPE_SYSTEM, json: true, maxTokens: 500, paid: "never", privacy: "private",
        user: `Right now it is ${localNow}.\nWhat Jared said: ${row.question}${row.feedback ? `\nHis correction: ${row.feedback}` : ""}\n\nDevices, one per line as entity_id|name|area:\n${lines}\n\nReturn the JSON now.`,
        job: "ha-fixer", fn: "ha-fixer", ref: row.id, deadlineMs: 28_000,
        validate: (j: Json) => (isObj(j) && Array.isArray(j.entity_ids) ? null : "entity_ids must be a list"),
      });
      const j = res.json as Row;
      const known = new Set(cat.entities.map((e) => e[0]));
      const llmEnts = strList(j.entity_ids, 8, 80).filter((e) => known.has(e));
      if (!ents.length && llmEnts.length) { ents = [...extra.filter((x: string) => !llmEnts.includes(x)), ...llmEnts].slice(0, 8); how = "model"; }
      const m1 = String(j.start ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/), m2 = String(j.end ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!when && m1 && m2) {
        const s = localToUtc(+m1[1], +m1[2], +m1[3], +m1[4], +m1[5]), e = localToUtc(+m2[1], +m2[2], +m2[3], +m2[4], +m2[5]);
        if (e.getTime() > s.getTime() && s.getTime() <= now.getTime()) {
          when = { start: s, end: e.getTime() > now.getTime() ? now : e, note: str(j.note, 120) || "the time you described" };
          how = "model";
        }
      }
    } catch (e) {
      if (!(e instanceof LlmUnavailable)) console.error("ha-fixer scope", plainErr(e));
    }
  }
  if (!ents.length && extra.length) ents = extra.slice(0, 8);
  if (!ents.length && !focus) {
    return "I could not tell which light or device you mean. Say which one (for example \"the bathroom lights\"), and when it happened if you know.";
  }
  const w = when ?? defaultScope(now);
  if (w.end.getTime() - w.start.getTime() < 10 * 60_000) w.start = new Date(w.end.getTime() - 20 * 60_000);
  return { entity_ids: ents, start: w.start, end: w.end, note: w.note, focus, how };
}

async function startGather(row: Row): Promise<void> {
  try {
    const ver = await agentVersion();
    if (ver && semverLt(ver, MIN_AGENT)) { await needAgentUpdate(row); return; }
    const cat = await ensureCatalog();
    if (!cat) {
      await park(row, "Waiting on your Pi's device list. Tinker starts on his own.", [], 0, { status: "gathering" });
      return;
    }
    const sc = await scopeFor(row, cat);
    if (typeof sc === "string") { await patch(row.id, { status: "failed", error: sc, wait_tries: 0, retry_at: null }); return; }
    const names = await namesMap(cat);
    const cmdId = crypto.randomUUID();
    const upd = await patch(row.id, {
      status: "gathering", command_id: cmdId, error: null, wait_tries: 0, retry_at: null, needs_agent_update: false,
      window_start: sc.start.toISOString(), window_end: sc.end.toISOString(), window_note: sc.note,
      entities: sc.entity_ids.map((id) => ({ id, name: nameOf(id, names) })), focus: sc.focus ?? row.focus ?? null,
    });
    if (!upd) return;
    const { error } = await db.from("home_hub_commands").insert({
      id: cmdId, target: "homeassistant", action: "evidence", requested_by: "ha-fixer",
      payload: { entity_ids: sc.entity_ids, start: sc.start.toISOString(), end: sc.end.toISOString(), ...(sc.focus ? { focus: sc.focus } : {}), fix_id: row.id },
    });
    if (error) await patch(row.id, { status: "failed", error: "I could not send that to your Pi: " + error.message.slice(0, 120), command_id: null });
  } catch (e) {
    console.error("ha-fixer gather", plainErr(e));
    await patch(row.id, { status: "failed", error: "Something broke while I was starting: " + plainErr(e), wait_tries: 0, retry_at: null });
  }
}

/* ───────── step 2: what happened and why (the story), then the fix ───────── */

const RULES = `Times are always 12-hour with AM or PM (6:02 AM), never 24-hour. Units are US (degrees F, feet, miles, mph), never metric. Plain everyday words: say "the bathroom light", never an entity id.`;

const DIAG_SYSTEM = `You are Tinker, Jared's Home Assistant troubleshooter. He says what went wrong in his house. You get what Home Assistant recorded (history, logbook, run traces) and the automations, scripts and file sections that mention those devices. Work out what actually happened and why.
Reply with ONE JSON object and nothing else. Keys:
story: a list of 3 to 7 short plain sentences in time order: what happened, and which automation, script or setting did it. Include the exact numbers from the record (for example "from 20% to 100% over about 6 minutes").
culprit: the key (K1, K2 ... or S1 ...) of the ONE thing whose settings cause the problem and should be changed. null if you cannot tell, or if none of them did it (say so in the story, for example a person used the switch or app).
also: keys of other things that took part (may be empty).
cause: one sentence naming the exact setting that causes it.
confidence: "high" only if the recorded events line up with that thing's settings (same device, same time, same amount). "medium" if likely. "low" if you are guessing.
unsure: when confidence is not high, one sentence saying what is missing.
Use only the evidence given. Never invent a time, a device or a number. A thing marked "did not run in the window" is rarely the cause, unless the record shows its effect.
${RULES}`;

const FIX_SYSTEM = `You are Tinker, Jared's Home Assistant fixer. You get the current text of ONE automation, script or settings section that causes a problem, and what is wrong. Change as little as possible so the problem stops and everything else keeps working.
Reply with ONE JSON object and nothing else. Keys:
type: "rewrite" (give the complete new version), "turn_off" (only when the whole automation should not run at all; this turns it off and does NOT delete it), or "none" (when a change cannot fix this, or you are not sure).
new_version: for "rewrite", the COMPLETE new version in the same format you were given (a JSON object for an automation or script from the editor; the exact YAML text, with the same indentation, for a block from a file). Keep every other key, line and comment as it is. Keep key names such as trigger or triggers, action or actions exactly as given.
before: 1 to 3 plain sentences: what it does now (the part that is wrong).
after: 1 to 3 plain sentences: what it will do after your change.
risky: true or false. risk_reason: one sentence when risky.
Hard rules: never delete anything. Never remove the trigger. Never add !secret, shell_command, command_line, rest_command, python_script, pyscript, hassio., homeassistant.stop, homeassistant.restart or recorder.purge. Use only entity ids that already appear in the text you were given, or in the device list.
${RULES}`;

type Target =
  | { mode: "ui"; s: Suspect; cfg: Row; domain: "automation" | "script" }
  | { mode: "package"; s: Suspect; file: string; fileText: string; sha: string; region: string; kind: "automation" | "script" }
  | { mode: "section"; file: string; fileText: string; sha: string; region: string; label: string; key: string }
  | { mode: "none"; why: string };

function targetFor(key: string | null, dig: ReturnType<typeof digestEvidence>, ev: Row): Target {
  if (!key) return { mode: "none", why: "no culprit" };
  const pf: Row = isObj(ev.package_files) ? ev.package_files : {};
  if (key.startsWith("S")) {
    const sec = dig.sections.find((x) => x.key === key);
    const f = sec ? pf[sec.file] : null;
    if (!sec || !f || typeof f.text !== "string") return { mode: "none", why: "I cannot see that part of the file" };
    if (f.text.split(sec.text).length - 1 !== 1) return { mode: "none", why: "that part of the file is not unique" };
    return { mode: "section", file: sec.file, fileText: f.text, sha: f.sha256, region: sec.text, label: sec.section, key };
  }
  const s = dig.suspects.find((x) => x.key === key);
  const r = (Array.isArray(ev.referrers) ? ev.referrers : []).find((x: Row, i: number) => `K${i + 1}` === key);
  if (!s || !r) return { mode: "none", why: "I cannot find it" };
  const kind = s.kind === "script" ? "script" : s.kind === "automation" ? "automation" : null;
  if (!kind) return { mode: "none", why: `${s.kind}s are not something I change yet` };
  if (s.where === "ui") {
    if (!isObj(r.cfg) || !s.hash || !s.id) return { mode: "none", why: "it is too big for me to rewrite safely" };
    return { mode: "ui", s, cfg: r.cfg, domain: kind };
  }
  if (s.where === "package" && s.file) {
    const f = pf[s.file];
    const block = typeof r.block === "string" ? r.block : "";
    if (!f || typeof f.text !== "string" || !block || block.length >= 7000) return { mode: "none", why: "its file or text is too big for me to rewrite safely" };
    if (f.text.split(block).length - 1 !== 1) return { mode: "none", why: "I could not point at it in the file safely" };
    return { mode: "package", s, file: s.file, fileText: f.text, sha: f.sha256, region: block, kind };
  }
  return { mode: "none", why: "I cannot see where it lives" };
}

const reindent = (next: string, prev: string): string => {
  const ind = (t: string) => (t.split("\n").find((l) => l.trim()) ?? "").match(/^ */)![0].length;
  const d = ind(prev) - ind(next);
  if (!d) return next;
  return next.split("\n").map((l) => (!l.trim() ? l : d > 0 ? " ".repeat(d) + l : l.slice(Math.min(-d, l.match(/^ */)![0].length)))).join("\n");
};

type FixBuilt = { fix: Row; before: string[]; after: string[]; diff: Row[]; risky: boolean; riskReason: string | null } | { problems: string[] };

function buildFix(t: Target, j: Json, known: Set<string>, services: Record<string, string[]>, names: Map<string, string>): FixBuilt {
  if (!isObj(j)) return { problems: ["The answer was not a JSON object."] };
  const type = String(j.type ?? "");
  const before = strList(j.before, 4, 300), after = strList(j.after, 4, 300);
  const bad = houseRuleProblems([...before, ...after]);
  if (bad.length) return { problems: bad.map((b) => "In before/after: " + b) };
  if (type === "turn_off") {
    if (t.mode === "none" || !("s" in t) || t.s.kind !== "automation" || !t.s.entity_id) return { problems: ["turn_off only works on an automation. Use rewrite."] };
    return {
      fix: { type: "turn_off", entity_id: t.s.entity_id, name: t.s.name },
      before: before.length ? before : [`${t.s.name} runs on its own.`],
      after: ["This automation will be turned off. It is not deleted, and nothing else changes. Undo turns it back on."],
      diff: [{ t: "-", s: "enabled: on" }, { t: "+", s: "enabled: off" }], risky: false, riskReason: "it turns the whole automation off",
    };
  }
  if (type !== "rewrite") return { problems: ["The model did not offer a safe change."] };
  if (!before.length || !after.length) return { problems: ["before and after each need 1 to 3 plain sentences."] };

  if (t.mode === "ui") {
    const next = j.new_version;
    if (!isObj(next)) return { problems: ["new_version must be the complete automation as a JSON object."] };
    const prev = clone(t.cfg) as Row; delete prev.id;
    const nv = clone(next) as Row; delete nv.id;
    const errs = checkConfig(t.domain, nv);
    const a = JSON.stringify(prev), b = JSON.stringify(nv);
    const deny = denyAdded(a, b);
    if (deny) errs.push(deny);
    if (a === b) errs.push("new_version is the same as the old one. Change the setting that causes the problem.");
    const unknown = newUnknownEntities(a, b, known, services);
    if (unknown.length) errs.push(`entity ${unknown.join(", ")} is not in his home. Use only ids from the text or the device list.`);
    if (errs.length) return { problems: errs };
    const ys = toYaml(prev), yn = toYaml(nv);
    const risk = riskReasons(yn, ys, names);
    if (j.risky === true && str(j.risk_reason, 200)) risk.push(str(j.risk_reason, 200));
    return {
      fix: { type: "item_edit", domain: t.domain, id: t.s.id, entity_id: t.s.entity_id, name: t.s.name, expect_hash: t.s.hash, config: nv },
      before, after, diff: lineDiff(ys, yn), risky: risk.length > 0, riskReason: [...new Set(risk)].join("; ") || null,
    };
  }
  if (t.mode === "package" || t.mode === "section") {
    let next = typeof j.new_version === "string" ? j.new_version.replace(/\r/g, "").replace(/\s+$/, "") : "";
    if (!next.trim()) return { problems: ["new_version must be the complete new text of that part of the file."] };
    next = reindent(next, t.region);
    const errs: string[] = [];
    const deny = denyAdded(t.region, next);
    if (deny) errs.push(deny);
    if (next === t.region) errs.push("new_version is the same as the old one. Change the setting that causes the problem.");
    // it must still be valid YAML of the right shape
    try {
      const p = yamlParse(stripHaTags(next)) as Json;
      if (t.mode === "package" && t.kind === "automation") {
        const o = Array.isArray(p) ? p[0] : null;
        if (!isObj(o)) errs.push("An automation in a file must stay one list item starting with '- id:'.");
        else {
          const oldId = (t.region.match(/^\s*-\s*id:\s*["']?([A-Za-z0-9_\-]+)/m) ?? [])[1];
          if (oldId && o.id !== oldId) errs.push(`The id must stay ${oldId}.`);
          errs.push(...checkConfig("automation", o));
        }
      } else if (t.mode === "package") {
        if (!isObj(p) || Object.keys(p).length !== 1) errs.push("A script in a file must stay one entry.");
        else errs.push(...checkConfig("script", Object.values(p)[0]));
      } else if (!isObj(p) || !Object.keys(p).includes(t.key.startsWith("S") ? t.label : "")) {
        errs.push(`The section must keep its name ${t.label}.`);
      }
    } catch (e) { errs.push("That is not valid YAML: " + plainErr(e)); }
    const unknown = newUnknownEntities(t.region, next, known, services);
    if (unknown.length) errs.push(`entity ${unknown.join(", ")} is not in his home. Use only ids from the text or the device list.`);
    if (errs.length) return { problems: errs.slice(0, 6) };
    const me = minimalEdit(t.fileText, t.region, next);
    if (!me.edits) return { problems: [me.error ?? "I could not turn that into a safe edit."] };
    const applied = applyEdits(t.fileText, me.edits);
    if (!applied.text) return { problems: [applied.error ?? "The edit did not apply."] };
    try { yamlParse(stripHaTags(applied.text)); } catch (e) {
      try { yamlParse(stripHaTags(t.fileText)); return { problems: ["The whole file would no longer be valid YAML: " + plainErr(e)] }; } catch { /* the original did not parse with this reader either; the Pi's own check decides */ }
    }
    const risk = riskReasons(next, t.region, names);
    if (j.risky === true && str(j.risk_reason, 200)) risk.push(str(j.risk_reason, 200));
    const nm = t.mode === "package" ? t.s.name : t.label;
    return {
      fix: { type: "package_patch", name: t.file, expect_sha256: t.sha, edits: me.edits, item: nm, entity_id: t.mode === "package" ? t.s.entity_id : null },
      before, after, diff: lineDiff(t.region, next), risky: risk.length > 0, riskReason: [...new Set(risk)].join("; ") || null,
    };
  }
  return { problems: ["That part cannot be changed from here."] };
}

async function runAnalysis(row: Row, feedback: string | null): Promise<void> {
  const t0 = Date.now();
  const tried: Json[] = [];
  let attempts = 0, model: string | null = null, provider: string | null = null;
  try {
    if (!row.evidence_cmd) { await startGather(row); return; }
    const { data: cmd } = await db.from("home_hub_commands").select("status, result").eq("id", row.evidence_cmd).maybeSingle();
    const ev = cmd?.result as Row | null;
    if (!cmd || cmd.status !== "done" || !isObj(ev)) { await patch(row.id, { status: "failed", error: "What Home Assistant recorded is gone, so Tinker cannot look at it again. Tap Ask again.", wait_tries: 0, retry_at: null }); return; }
    const cat = await readCatalog();
    const names = await namesMap(cat);
    for (const r of Array.isArray(ev.referrers) ? ev.referrers : []) if (r?.entity_id && r?.name && !names.has(r.entity_id)) names.set(r.entity_id, r.name);
    const dig = digestEvidence(row.question + (feedback ? `\nJared's correction: ${feedback}` : ""), ev, names);
    const timeline = buildTimeline(ev, names).map(({ t, text }) => ({ t, text }));
    const keys = new Set([...dig.suspects.map((s) => s.key), ...dig.sections.map((s) => s.key)]);
    const left = () => BUDGET_MS - (Date.now() - t0);

    // A. the story
    let story: string[] = Array.isArray(row.story) ? row.story : [];
    let culpritKey: string | null = row.culprit?.key ?? null;
    let confidence: "high" | "medium" | "low" = row.confidence ?? "low";
    let cause = row.culprit?.why ?? "";
    let unsure = "";
    const redo = !!feedback || row.stage !== "story_done" || !story.length;
    if (redo) {
      let problems = "";
      let diag: ReturnType<typeof normalizeDiagnosis> | null = null;
      for (let round = 0; round < 2; round++) {
        if (left() < 15_000) break;
        attempts++;
        const res = await llm({
          task: "judge", system: DIAG_SYSTEM, json: true, maxTokens: STORY_TOKENS, paid: "never", privacy: "private",
          user: `${dig.text}\n${problems}\nReturn the JSON now.`,
          job: "ha-fixer", fn: "ha-fixer", ref: row.id, deadlineMs: Math.min(60_000, left() - 4000),
          validate: (j: Json) => (isObj(j) && Array.isArray(j.story) ? null : "story must be a list of sentences"),
        }).catch((e) => { if (e instanceof LlmUnavailable) { tried.push(...(e.tried ?? [])); } throw e; });
        tried.push(...res.tried); model = res.model; provider = res.provider;
        const d = normalizeDiagnosis(res.json, keys);
        if (typeof d === "string") { problems = `\nYour last answer was rejected: ${d} Return the full corrected JSON.\n`; continue; }
        const hr = houseRuleProblems(d.story);
        if (hr.length && round === 0) { problems = `\nYour last answer broke a rule: ${hr.join("; ")}. Return the full corrected JSON.\n`; diag = d; continue; }
        diag = d; break;
      }
      if (!diag || typeof diag === "string") { await park(row, "The free AI's last answer was not usable. Tinker is asking another model.", tried, attempts, { model, provider }); return; }
      story = diag.story; culpritKey = diag.culprit; confidence = diag.confidence; cause = diag.cause; unsure = diag.unsure;
      if (unsure && diag.confidence !== "high") story = [...story, `I am not fully sure: ${unsure.replace(/^i am not (fully )?sure:?\s*/i, "")}`];
      const sus = dig.suspects.find((s) => s.key === culpritKey);
      if (confidence === "high" && sus && !sus.fired) confidence = "medium";
      const noRecord = !(ev.logbook?.length) && !Object.keys(isObj(ev.history) ? ev.history : {}).length;
      if (noRecord) confidence = "low";
      const sec = dig.sections.find((s) => s.key === culpritKey);
      const c = culpritKey ? {
        key: culpritKey, entity_id: sus?.entity_id ?? null, name: sus?.name ?? (sec ? `${sec.section} settings in ${sec.file}` : culpritKey), kind: sus?.kind ?? "section",
        where: sus?.where ?? "package", file: sus?.file ?? sec?.file ?? null, why: cause,
      } : null;
      await patch(row.id, {
        story, culprit: c, confidence, timeline, stage: "story_done", model, provider, tried, attempts: (row.attempts ?? 0) + attempts, error: null,
        suspects: dig.suspects.map((s) => ({ key: s.key, name: s.name, kind: s.kind, where: s.where, file: s.file, entity_id: s.entity_id, last_run: s.last_run, ran: s.fired, why: s.hits.map((h) => nameOf(h, names)).slice(0, 3).join(", ") })),
        entities: row.entities,
      });
      row = { ...row, story, culprit: c, confidence, stage: "story_done" };
    }

    // B. the fix
    if (!culpritKey || (confidence === "low" && !feedback)) {
      await patch(row.id, { status: "diagnosed", wait_tries: 0, retry_at: null, error: null });
      return;
    }
    if (left() < 30_000) { await patch(row.id, { status: "analyzing", retry_at: new Date(Date.now() + 60_000).toISOString() }); return; }
    const tg = targetFor(culpritKey, dig, ev);
    if (tg.mode === "none") {
      await patch(row.id, { status: "diagnosed", wait_tries: 0, retry_at: null, error: `I found the cause, but ${tg.why}. Tap Hand to the Code Worker and he works it out in the repo.` });
      return;
    }
    const known = new Set((cat?.entities ?? []).map((e) => e[0]));
    const text = tg.mode === "ui" ? JSON.stringify(tg.cfg, null, 1) : tg.region;
    const label = tg.mode === "section" ? `settings section "${tg.label}" of file ${tg.file}` : `${tg.s.kind} "${tg.s.name}"${tg.mode === "package" ? ` in file ${tg.file}` : " from the editor (a JSON object)"}`;
    let problems = "";
    let built: FixBuilt | null = null;
    for (let round = 0; round < 3; round++) {
      if (left() < 14_000) break;
      attempts++;
      const user = `What Jared said: ${row.question}${feedback || row.feedback ? `\nHis correction: ${feedback ?? row.feedback}` : ""}\n\nWhat went wrong (Tinker's finding): ${story.join(" ")}\nThe setting that causes it: ${cause}\n\nThe ${label}:\n${text.slice(0, 7_000)}\n${problems}\nReturn the JSON now.`;
      let res;
      try {
        res = await llm({
          task: "code", system: FIX_SYSTEM, user, json: true, maxTokens: FIX_TOKENS, paid: "never", privacy: "private",
          job: "ha-fixer", fn: "ha-fixer", ref: row.id, deadlineMs: Math.min(60_000, left() - 4000),
          validate: (j: Json) => (isObj(j) && ["rewrite", "turn_off", "none"].includes(String(j.type)) ? null : "type must be rewrite, turn_off or none"),
        });
      } catch (e) {
        if (e instanceof LlmUnavailable) { tried.push(...(e.tried ?? [])); throw e; }
        throw e;
      }
      tried.push(...res.tried); model = res.model; provider = res.provider;
      const j = res.json as Json;
      if (isObj(j) && j.type === "none") { built = { problems: ["The model said no safe change exists."] }; break; }
      built = buildFix(tg, j, known, cat?.services ?? {}, names);
      if (!("problems" in built)) break;
      problems = "\nYour last answer was refused for these reasons. Fix them and return the full corrected JSON:\n" + built.problems.map((p) => "- " + p).join("\n") + "\n";
    }
    if (!built || "problems" in built) {
      const why = built && "problems" in built ? built.problems[0] : "I ran out of time.";
      await patch(row.id, {
        status: "diagnosed", model, provider, tried, attempts: (row.attempts ?? 0) + attempts, wait_tries: 0, retry_at: null,
        error: `I know what causes it, but I could not write a change that passes my safety checks (${String(why).replace(/\.$/, "")}). Tap Hand to the Code Worker, or tell me more and I try again.`,
      });
      return;
    }
    await patch(row.id, {
      status: "proposed", fix: built.fix, before_plain: built.before, after_plain: built.after, diff: built.diff, risky: built.risky, risk_reason: built.riskReason,
      model, provider, tried, attempts: (row.attempts ?? 0) + attempts, error: null, wait_tries: 0, retry_at: null, feedback: feedback ?? row.feedback ?? null,
    });
  } catch (e) {
    console.error("ha-fixer analysis", plainErr(e));
    if (e instanceof LlmUnavailable) { await park(row, WAIT_NOTE, tried, attempts); return; }
    await patch(row.id, { status: "failed", error: "Something broke while I was working it out: " + plainErr(e), tried, attempts: (row.attempts ?? 0) + attempts, wait_tries: 0, retry_at: null });
  }
}

/** Take the analysis for one row (a lease, so two wake-ups never run it twice), then run it in the background. */
async function leaseAnalysis(id: string, feedback: string | null = null): Promise<Row | null> {
  const { data } = await db.from("ha_fixes").update({ retry_at: new Date(Date.now() + 10 * 60_000).toISOString() })
    .eq("id", id).eq("status", "analyzing").or(`retry_at.is.null,retry_at.lte.${new Date().toISOString()}`).select("*").maybeSingle();
  if (!data) return null;
  inBackground(runAnalysis(data, feedback));
  return data;
}

/* ───────── ops ───────── */

async function opDiagnose(b: Row, userId: string | null) {
  const question = str(b.question, 1500);
  if (question.length < 6) return { ok: false, error: "Tell me what went wrong, in a sentence or two." };
  const { count } = await db.from("ha_fixes").select("id", { count: "exact", head: true }).in("status", ["gathering", "analyzing"]);
  if ((count ?? 0) >= 8) return { ok: false, error: "Tinker is already looking into eight problems, so this one was not added. Discard one you no longer need." };
  const focus = typeof b.focus === "string" && /^(automation|script)\.[a-z0-9_]+$/.test(b.focus) ? b.focus : null;
  const { data: row, error } = await db.from("ha_fixes").insert({ question, focus, status: "gathering", requested_by: userId }).select("*").single();
  if (error || !row) return { ok: false, error: "I could not save that question: " + (error?.message ?? "no row").slice(0, 120) };
  inBackground(startGather(row));
  return { ok: true, row };
}

async function opRevise(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  const feedback = str(b.feedback, 1000);
  if (feedback.length < 3) return { ok: false, error: "Tell me what to change." };
  if (!["proposed", "diagnosed", "failed", "undone", "handoff"].includes(row.status)) return { ok: false, error: row.status === "applied" ? "That fix is live. Undo it first, or ask a new question." : "Tinker is still working on that one. Send the change when he is done." };
  if (!row.evidence_cmd) {
    const upd = await patch(row.id, { status: "gathering", feedback, error: null, wait_tries: 0, retry_at: null });
    inBackground(startGather({ ...row, ...(upd ?? {}), feedback }));
    return { ok: true, row: upd };
  }
  const upd = await patch(row.id, { status: "analyzing", feedback, error: null, wait_tries: 0, retry_at: null, fix: null, diff: null, before_plain: null, after_plain: null, risky: false, risk_reason: null });
  if (upd) await leaseAnalysis(row.id, feedback);
  return { ok: true, row: upd };
}

/** After the story is saved and the fix is stored, check it once more before it ever reaches the Pi. */
function recheckFix(row: Row): string | null {
  const f = row.fix;
  if (!isObj(f)) return "There is no fix on this one.";
  const diff: Row[] = Array.isArray(row.diff) ? row.diff : [];
  const minus = diff.filter((d) => d.t === "-").map((d) => d.s).join("\n"), plus = diff.filter((d) => d.t === "+").map((d) => d.s).join("\n");
  if (f.type !== "turn_off") {
    const bad = denyAdded(minus, plus);
    if (bad) return bad;
  }
  if (f.type === "item_edit") {
    if (!["automation", "script", "scene"].includes(f.domain) || !/^[A-Za-z0-9_-]{1,80}$/.test(String(f.id)) || !isObj(f.config) || !/^[0-9a-f]{16}$/.test(String(f.expect_hash))) return "The stored fix is not valid.";
  } else if (f.type === "package_patch") {
    if (!/^[A-Za-z0-9][A-Za-z0-9_\-/]{1,95}$/.test(String(f.name)) || String(f.name).includes("..") || !/^[0-9a-f]{64}$/.test(String(f.expect_sha256)) || !Array.isArray(f.edits) || !f.edits.length || f.edits.length > 12) return "The stored fix is not valid.";
  } else if (f.type === "turn_off") {
    if (!/^automation\.[a-z0-9_]+$/.test(String(f.entity_id))) return "The stored fix is not valid.";
  } else return "I don't know that kind of fix.";
  return null;
}

async function sendToPi(row: Row, nextStatus: "applying" | "undoing", action: string, payload: Row) {
  const cmdId = crypto.randomUUID();
  const upd = await patch(row.id, { status: nextStatus, command_id: cmdId, error: null });
  const { error } = await db.from("home_hub_commands").insert({
    id: cmdId, target: "homeassistant", action, payload: { ...payload, fix_id: row.id }, requested_by: "ha-fixer",
  });
  if (error) {
    const back = await patch(row.id, { status: row.status, command_id: row.command_id ?? null, error: "I could not send that to your Pi: " + error.message.slice(0, 120) });
    return { ok: false, error: "I could not send that to your Pi. Nothing was changed.", row: back };
  }
  return { ok: true, row: upd };
}

async function opApply(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  if (row.status !== "proposed") return { ok: false, error: row.status === "applying" ? "It is already being applied." : "Only a proposed fix can be applied." };
  const bad = recheckFix(row);
  if (bad) return { ok: false, error: bad };
  const ver = await agentVersion();
  if (ver && semverLt(ver, MIN_AGENT)) { await askAgentUpdate(); return { ok: false, needsAgent: true, error: "Your Pi needs the newest Home Hub update first. Tinker asked it to update. Tap Apply again in a minute." }; }
  const f = row.fix;
  if (f.type === "item_edit") return await sendToPi(row, "applying", "item_edit", { domain: f.domain, id: f.id, config: f.config, expect_hash: f.expect_hash });
  if (f.type === "package_patch") return await sendToPi(row, "applying", "package_patch", { name: f.name, expect_sha256: f.expect_sha256, edits: f.edits });
  return await sendToPi(row, "applying", "toggle_automation", { automation_id: f.entity_id, enabled: false });
}

async function opUndo(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  if (row.status !== "applied") return { ok: false, error: "Only a fix that is live can be undone." };
  const u = row.undo;
  if (!isObj(u) || !["item_edit", "package_restore", "toggle_automation"].includes(String(u.action)) || !isObj(u.payload)) return { ok: false, error: "There is no undo saved for this one." };
  return await sendToPi(row, "undoing", u.action, u.payload);
}

async function opDiscard(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  if (["applying", "undoing", "applied"].includes(row.status)) return { ok: false, error: row.status === "applied" ? "That fix is live. Undo it first." : "That one is in Home Assistant right now." };
  if (["gathering", "analyzing"].includes(row.status) && !(row.wait_tries > 0)) return { ok: false, error: "Tinker is looking into that one right now. You can discard it the moment he is done." };
  return { ok: true, row: await patch(row.id, { status: "discarded", error: null }) };
}

function handoffGoal(row: Row): string {
  const story = (Array.isArray(row.story) ? row.story : []).join(" ");
  const sus = (Array.isArray(row.suspects) ? row.suspects : []).map((s: Row) => `${s.name} (${s.where === "package" ? "file " + s.file : s.where})`).join("; ");
  return `Home Assistant troubleshooting job for Jared, from Tinker (his Home Automation Engineer).

What he said went wrong, in his words: "${String(row.question).replace(/\s+/g, " ").slice(0, 600)}"
What Tinker found (looked at ${row.window_note ?? "the time he described"}): ${story || "Tinker could not explain it from what Home Assistant recorded."}
${row.culprit ? `Tinker's best guess at the cause: ${row.culprit.name}${row.culprit.why ? " - " + row.culprit.why : ""} (confidence: ${row.confidence ?? "low"}).` : "Tinker has no confident guess."}
Things that mention the devices: ${sus || "none found"}.

Investigate and write down the fix. Create exactly ONE new file: docs/ha-fixes/${new Date().toISOString().slice(0, 10)}-${String(row.id).slice(0, 8)}.md
Change no other file. In it, put: the root cause in plain words; the exact YAML change (before and after) for the Home Assistant package or automation that causes it; how to undo it. Do not run anything on Jared's Home Assistant. Never use: ${DENY.join(", ")}.
Rules: times are 12-hour (6:02 AM), units are US (degrees F, feet, miles), no emoji.`;
}

async function opHandoff(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  if (["applying", "undoing", "gathering"].includes(row.status)) return { ok: false, error: "Tinker is working on that one right now." };
  if (row.status === "handoff" && row.code_job_id) return { ok: true, row };
  const goal = handoffGoal(row);
  const { data: job, error } = await db.from("code_jobs").insert({ repo: REPO, goal }).select("id").maybeSingle();
  const note = error || !job ? "I could not queue the Code Worker (" + (error?.message ?? "no row").slice(0, 100) + "). Copy the prompt and hand it over yourself." : null;
  const upd = await patch(row.id, { status: "handoff", code_job_id: job?.id ?? null, handoff_prompt: goal, error: note, wait_tries: 0, retry_at: null });
  return { ok: !!upd, row: upd };
}

/* ───────── the list of every automation ───────── */

async function opInventory() {
  const { data: open } = await db.from("home_hub_commands").select("id").eq("requested_by", "ha-fixer").eq("action", "inventory")
    .in("status", ["pending", "running"]).gte("created_at", minutesAgo(3)).limit(1);
  if (open?.length) return { ok: true, pending: true };
  const ver = await agentVersion();
  if (ver && semverLt(ver, MIN_AGENT)) { const how = await askAgentUpdate(); return { ok: false, needsAgent: true, error: how === "no release" ? "Your Pi needs the newest Home Hub update before the list works." : "Your Pi needs the newest Home Hub update first. Tinker asked it to update. Tap Refresh again in a minute." }; }
  const id = crypto.randomUUID();
  await db.from("ha_inventory").update({ requested_at: new Date().toISOString(), command_id: id, error: null }).eq("id", true);
  const { error } = await db.from("home_hub_commands").insert({ id, target: "homeassistant", action: "inventory", payload: {}, requested_by: "ha-fixer" });
  if (error) return { ok: false, error: "I could not ask your Pi: " + error.message.slice(0, 120) };
  return { ok: true, pending: true };
}

function parseBlock(block: string, kind: "automation" | "script"): Row | null {
  try {
    const p = yamlParse(stripHaTags(block)) as Json;
    if (kind === "automation") return Array.isArray(p) && isObj(p[0]) ? p[0] : null;
    return isObj(p) ? (Object.values(p)[0] as Row) ?? null : null;
  } catch { return null; }
}

async function processInventory(cmdId: string): Promise<Row> {
  const { data: cmd } = await db.from("home_hub_commands").select("status, result, error, payload").eq("id", cmdId).maybeSingle();
  if (!cmd) return { ok: false, error: "no such command" };
  if (cmd.status !== "done" || !isObj(cmd.result)) {
    await db.from("ha_inventory").update({ error: cmd.status === "expired" ? "Your Pi did not pick that up in time." : `I could not read the list. ${String(cmd.error ?? "").slice(0, 200)}`.trim() }).eq("id", true);
    return { ok: false, error: "the Pi did not give a list" };
  }
  const r = cmd.result as Row;
  const cat = await readCatalog();
  const names = new Map<string, string>();
  for (const e of cat?.entities ?? []) if (typeof e[0] === "string" && e[1]) names.set(e[0], String(e[1]));
  const rows: Row[] = [...(Array.isArray(r.automations) ? r.automations : []), ...(Array.isArray(r.scripts) ? r.scripts : [])];
  for (const x of rows) if (x?.entity_id && x?.name) names.set(x.entity_id, String(x.name));
  const view: Row[] = [];
  for (const x of rows) {
    if (!x?.entity_id) continue;
    const kind: "automation" | "script" = String(x.entity_id).startsWith("script.") ? "script" : "automation";
    let cfg: Row | null = null;
    if (x.where === "ui" && isObj(x.cfg) && !x.cfg.truncated) cfg = x.cfg;
    else if (x.where === "package" && typeof x.block === "string") cfg = parseBlock(x.block, kind);
    let line = cfg ? describeConfig(cfg, names, kind) : "";
    const desc = cfg && typeof cfg.description === "string" ? cfg.description.replace(/^Made by Tinker from:\s*/i, "").replace(/\s+/g, " ").trim() : "";
    if (!line && desc) line = desc.length > 200 ? desc.slice(0, desc.lastIndexOf(" ", 190)) + "." : desc;
    if (!line) line = x.where === "package" ? `Lives in the ${x.file} file. Open Fix this to see what it does.` : "A long one. Fix this shows what it does.";
    const mine = /^bestly_/.test(String(x.id ?? "")) || /^Made by Tinker/i.test(String(cfg?.description ?? ""));
    view.push({
      entity_id: x.entity_id, name: String(x.name ?? x.entity_id), kind, state: x.state, last_run: x.last_triggered ?? null, where: x.where ?? "unknown", file: x.file ?? null,
      id: x.id ?? null, mode: x.mode ?? null, running: typeof x.running === "number" ? x.running : 0, line, mine, targets: cfg ? entityTargets(cfg) : [],
    });
  }
  view.sort((a, b) => (a.kind === b.kind ? String(a.name).localeCompare(String(b.name)) : a.kind === "automation" ? -1 : 1));
  const counts = {
    automations: view.filter((v) => v.kind === "automation").length, scripts: view.filter((v) => v.kind === "script").length,
    on: view.filter((v) => v.kind === "automation" && v.state === "on").length, off: view.filter((v) => v.kind === "automation" && v.state === "off").length,
    ui: view.filter((v) => v.where === "ui").length, package: view.filter((v) => v.where === "package").length, unknown: view.filter((v) => v.where === "unknown").length,
    packages: Array.isArray(r.packages) ? r.packages.length : 0,
  };
  const { error } = await db.from("ha_inventory").update({ captured_at: new Date().toISOString(), view, counts, error: null, command_id: cmdId }).eq("id", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true, counts };
}

async function opToggle(b: Row) {
  const entity = str(b.entity_id, 90);
  if (!/^automation\.[a-z0-9_]+$/.test(entity) || typeof b.enabled !== "boolean") return { ok: false, error: "Say which automation, and whether it should be on or off." };
  const view = await inventoryView();
  if (!view.some((v) => v.entity_id === entity)) return { ok: false, error: "I do not see that automation in the list. Tap Refresh and try again." };
  const id = crypto.randomUUID();
  const { error } = await db.from("home_hub_commands").insert({ id, target: "homeassistant", action: "toggle_automation", payload: { automation_id: entity, enabled: b.enabled }, requested_by: "ha-fixer" });
  if (error) return { ok: false, error: "I could not send that to your Pi: " + error.message.slice(0, 120) };
  const stop = Date.now() + 14_000;
  let st: Row | null = null;
  while (Date.now() < stop) {
    await sleep(1000);
    const { data: c } = await db.from("home_hub_commands").select("status, error").eq("id", id).maybeSingle();
    if (c && ["done", "failed", "expired"].includes(c.status)) { st = c; break; }
  }
  if (st?.status === "done") {
    const v2 = (await inventoryView()).map((v) => (v.entity_id === entity ? { ...v, state: b.enabled ? "on" : "off" } : v));
    await db.from("ha_inventory").update({ view: v2 }).eq("id", true);
    return { ok: true, state: b.enabled ? "on" : "off" };
  }
  if (st) return { ok: false, error: st.status === "expired" ? "Your Pi did not pick that up in time. Nothing changed." : "Home Assistant said no: " + String(st.error ?? "no reason given").slice(0, 160) };
  return { ok: true, pending: true };
}

/* ───────── continue (the Pi answered) and watch (cron) ───────── */

async function opContinue(b: Row) {
  if (typeof b.inventory_cmd === "string" && /^[0-9a-f-]{36}$/i.test(b.inventory_cmd)) return await processInventory(b.inventory_cmd);
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  if (row.status !== "analyzing") return { ok: true, skipped: row.status };
  const got = await leaseAnalysis(row.id, null);
  return { ok: true, started: !!got };
}

async function watch() {
  const out: Row = { rerun: 0, regathered: 0, expired: 0, handbacks: 0, inventory: "fresh", resumed: 0 };
  try {
    // 1. gathering that went nowhere: the function was cut off before the command, or the trigger missed the answer
    const { data: gath } = await db.from("ha_fixes").select("*").eq("status", "gathering").lt("updated_at", minutesAgo(4)).limit(5);
    for (const r of gath ?? []) {
      if (r.command_id) {
        const { data: c } = await db.from("home_hub_commands").select("status, action, created_at").eq("id", r.command_id).maybeSingle();
        if (c?.status === "done" && c.action === "evidence") {
          await patch(r.id, { status: "analyzing", evidence_cmd: r.command_id, error: null, wait_tries: 0, retry_at: null });
          await leaseAnalysis(r.id); out.rerun++; continue;
        }
        if (c && ["pending", "running"].includes(c.status) && Date.parse(c.created_at) < Date.now() - 10 * 60_000) {
          await db.from("home_hub_commands").update({ status: "expired", error: "Tinker gave up waiting." }).eq("id", r.command_id);   // the trigger then fails the row with a plain note
          out.expired++; continue;
        }
        if (c && ["pending", "running"].includes(c.status)) continue;
        if (c) { await patch(r.id, { status: "failed", error: r.error ?? "Your Pi could not read what Home Assistant recorded." }); continue; }
      }
      if ((r.wait_tries ?? 0) > 0 && r.retry_at && Date.parse(r.retry_at) > Date.now()) continue;
      const { data: got } = await db.from("ha_fixes").update({ updated_at: new Date().toISOString() }).eq("id", r.id).eq("status", "gathering").eq("updated_at", r.updated_at).select("*").maybeSingle();
      if (got) { inBackground(startGather(got)); out.regathered++; }
    }

    // 2. analyses that are due: waiting on a free model, or cut off
    const { data: due } = await db.from("ha_fixes").select("id").eq("status", "analyzing").lte("retry_at", new Date().toISOString()).order("retry_at").limit(2);
    for (const r of due ?? []) if (await leaseAnalysis(r.id)) out.rerun++;
    const { data: cut } = await db.from("ha_fixes").select("id").eq("status", "analyzing").is("retry_at", null).lt("updated_at", minutesAgo(6)).limit(3);
    for (const r of cut ?? []) { await patch(r.id, { retry_at: new Date().toISOString() }); if (await leaseAnalysis(r.id)) out.rerun++; }

    // 3. applying / undoing that the Pi never answered: expire the command, and the trigger puts the row back with a plain note
    const { data: stuck } = await db.from("ha_fixes").select("id, command_id, status, updated_at").in("status", ["applying", "undoing"]).lt("updated_at", minutesAgo(10)).limit(10);
    for (const r of stuck ?? []) {
      const { data: c } = r.command_id ? await db.from("home_hub_commands").select("status").eq("id", r.command_id).maybeSingle() : { data: null };
      if (c && ["pending", "running"].includes(c.status)) { await db.from("home_hub_commands").update({ status: "expired", error: "Tinker gave up waiting." }).eq("id", r.command_id); out.expired++; }
      else if (!c || ["expired", "failed", "done"].includes(c.status)) {
        await patch(r.id, { status: r.status === "applying" ? "proposed" : "applied", error: "Your Pi did not answer, so I am not sure what happened. Nothing was reported as changed. Check the list, then try again." });
        await notify("Tinker: a fix did not finish", "Your Pi did not answer in ten minutes, so I cannot say if the change landed. Open the Automation Maker to check.", "warning", `tinker.fixstuck.${r.id}`);
        out.expired++;
      }
    }

    // 4. an agent that just got the update: start the questions that were waiting for it again
    const ver = await agentVersion();
    if (ver && !semverLt(ver, MIN_AGENT)) {
      const { data: waiting } = await db.from("ha_fixes").select("*").eq("needs_agent_update", true).eq("status", "failed").gt("created_at", minutesAgo(180)).limit(3);
      for (const r of waiting ?? []) {
        const upd = await patch(r.id, { status: "gathering", needs_agent_update: false, error: null });
        if (upd) { inBackground(startGather(upd)); out.resumed++; }
      }
    }

    // 5. a warm list of automations (no AI: the Pi does the work)
    const { data: inv } = await db.from("ha_inventory").select("captured_at, requested_at, command_id").eq("id", true).maybeSingle();
    const age = inv?.captured_at ? Date.now() - Date.parse(inv.captured_at) : Infinity;
    if (inv?.command_id && inv.requested_at && (!inv.captured_at || Date.parse(inv.requested_at) > Date.parse(inv.captured_at))) {
      const { data: c } = await db.from("home_hub_commands").select("status").eq("id", inv.command_id).maybeSingle();
      if (c?.status === "done") { await processInventory(inv.command_id); out.inventory = "built from a finished answer"; }
    }
    if (age > INVENTORY_WARM_MS && ver && !semverLt(ver, MIN_AGENT)) {
      const r = await opInventory();
      out.inventory = r.ok ? "asked the Pi for a new list" : "could not ask the Pi";
    }

    // 6. Code Worker hand-backs
    const { data: hand } = await db.from("ha_fixes").select("id, code_job_id, handback, error").eq("status", "handoff").not("code_job_id", "is", null).limit(5);
    for (const r of hand ?? []) {
      const { data: job } = await db.from("code_jobs").select("status, result").eq("id", r.code_job_id).maybeSingle();
      if (!job) continue;
      if (job.status === "failed") { const m = "The Code Worker could not finish this one. Copy the prompt and hand it to Claude Code yourself."; if (r.error !== m) await patch(r.id, { error: m }); continue; }
      if (job.status !== "done" || r.handback) continue;
      const sha = typeof job.result?.commit_sha === "string" && /^[0-9a-f]{7,40}$/.test(job.result.commit_sha) ? job.result.commit_sha : null;
      await patch(r.id, { handback: sha ? `The Code Worker wrote up the fix (commit ${sha.slice(0, 7)}) in docs/ha-fixes. Read it, then ask Tinker to try again with what it found.` : "The Code Worker finished. Read what it wrote in docs/ha-fixes, then ask Tinker to try again with what it found.", error: null });
      await notify("Tinker: the Code Worker finished a troubleshooting job", "It wrote up a fix. Open the Automation Maker to read it.", "success", `tinker.fixhandback.${r.id}`);
      out.handbacks++;
    }
    out.agent = ver;
  } catch (e) {
    console.error("ha-fixer watch", plainErr(e));
    return { ok: false, error: plainErr(e), ...out };
  }
  return { ok: true, ...out };
}

/* ───────── entry ───────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let b: Row = {};
  try { b = await req.json(); } catch { /* empty */ }
  const op = String(b.op ?? "");
  try {
    if (op === "watch" || op === "continue") {
      if (!isService(req)) return J({ ok: false, error: "Only the schedule can run that." }, 403);
      return J(op === "watch" ? await watch() : await opContinue(b));
    }
    const service = isService(req);
    const userId = service ? null : await adminUser(req);
    if (!service && !userId) return J({ ok: false, error: "Only Jared's admin can use the Automation Maker." }, 403);
    // Nothing reaches Home Assistant without his own tap: apply and undo need his signed-in session, never the service role.
    if ((op === "apply" || op === "undo") && !userId) return J({ ok: false, error: "A fix is applied only by Jared's own tap." }, 403);
    switch (op) {
      case "diagnose": return J(await opDiagnose(b, userId));
      case "revise": return J(await opRevise(b));
      case "apply": return J(await opApply(b));
      case "undo": return J(await opUndo(b));
      case "discard": return J(await opDiscard(b));
      case "handoff": return J(await opHandoff(b));
      case "inventory": return J(await opInventory());
      case "toggle": return J(await opToggle(b));
      default: return J({ ok: false, error: "I don't know that request." });
    }
  } catch (e) {
    console.error("ha-fixer", op, plainErr(e));
    return J({ ok: false, error: "Something broke on my side: " + plainErr(e) });
  }
});

