// ha-automator — Tinker, the Home Automation Engineer ("Automation Maker" at /admin/home-hub/automations).
// Contract: docs/ha-automator-opusplan.md (frozen). Free models only: every call is llm({ paid: "never", privacy: "private" }).
//
// POST JSON { op, ... }  ->  { ok: true, row? }  |  { ok: false, error }   (errors are plain words, HTTP 200 unless auth fails)
//   generate { request }            draft an automation from a sentence (runs in the background; the page watches the row)
//   revise   { id, feedback }       same pipeline with the previous draft and Jared's change request
//   install  { id }                 queue automation_put / package_put on the Pi (status installing; trigger sets installed/failed)
//   undo     { id }                 put the previous version back, or delete what Tinker added
//   toggle   { id, enabled }        turn an installed automation on/off (toggle_automation)
//   discard  { id }
//   handoff  { id }                 build the prompt and queue a Code Worker job (also automatic when Tinker cannot build it)
//   watch                           cron, service role only: page check + self-heal, drafts waiting on a free model, stuck installs,
//                                   Code Worker files coming back, warm device list, heartbeat
//
// v2 (2026-10-28, docs/ha-automator-v2-opusplan.md): Tinker checks and heals his own page (tinker_page_check), never says "try again
// later" (a draft with no free model waits and the watch re-runs it; after 6 tries Scout's out-of-room path suggests a new provider),
// keeps the device list warm, and ships as plain source (no GitHub raw-import shim).
//
// Admin only (has_role admin), except watch which takes the service role. verify_jwt = true.
// Nothing touches Home Assistant until `install`. The Pi agent (1.6.1+) enforces the same id/denylist rules again.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { parse as yamlParse } from "jsr:@std/yaml@1.0.5";
import { corsHeaders } from "../_shared/cors.ts";
import { llm, LlmUnavailable, outOfRoomMessage } from "../_shared/free-llm.ts";

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

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Json = any;

const REPO = "Bestly-LLC/bestlytech";
const ID_RE = /^bestly_[a-z0-9_]{3,60}$/;
const PKG_RE = /^bestly_auto_[a-z0-9_]{3,50}$/;
const PKG_KEYS = new Set(["automation", "script", "scene", "template", "input_boolean", "input_number", "input_select", "input_text",
  "input_datetime", "input_button", "timer", "counter", "schedule", "group"]);
const DENY = ["!secret", "shell_command", "command_line", "rest_command", "python_script", "pyscript", "hassio.",
  "homeassistant.stop", "homeassistant.restart", "recorder.purge"];
const MAX_YAML = 40_000;
const MIN_AGENT = "1.6.1";
const CATALOG_FRESH_MS = 30 * 60_000;
const CATALOG_WARM_MS = 6 * 3_600_000;   // the watch asks the Pi for a fresh device list when ours is older than this
const WAIT_QUICK_TRIES = 6;              // 4 minutes apart, about 30 minutes, then Scout's out-of-room path
const WAIT_MAX_TRIES = 24;               // after that, 15 minutes apart, until about 5 hours in
const WAIT_NOTE = "Waiting on a free model. Tinker finishes on his own.";
const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;

const HOUSE_RULES = `House rules (Jared's):
- Presence, bed, motion, desk and kitchen automations get a state condition: input_boolean.sexy_time is "off".
- Desk and kitchen automations must not fire while binary_sensor.bed_withings_sleep_in_bed is "on". Write it as a "not" condition around state "on" (that sensor reads unknown after restarts, so never test for "off").
- The Sofa lamp always turns on together with its sister lamp.
- Keep the TV backlight strip off while the wall projector is showing.
- Phone notifications use an existing notify.mobile_app_* service from the services list. Never invent a notify service.
- Times written in any message are 12-hour (3:05 PM). Units are US: degrees F, ft, mi, mph. Never metric.
- mode is "single" unless the request implies restart or queued.
- Automation ids look like bestly_<short_slug> (lowercase letters, digits, underscores). Aliases are plain words.
- Every description starts: Made by Tinker from: <the request in his words>.`;

/* ───────── small helpers ───────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const slug = (s: string, max = 40) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max).replace(/_+$/g, "");
const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const strList = (v: unknown, n = 8, max = 300): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => (x as string).trim().slice(0, max)) : [];
const plainErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 200);
const semverLt = (a: string, b: string) => {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0), pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
};

async function patch(id: string, fields: Row): Promise<Row | null> {
  const { data, error } = await db.from("ha_automations").update(fields).eq("id", id).select("*").maybeSingle();
  if (error) console.error("ha-automator patch", id, error.message);
  return data ?? null;
}
async function getRow(id: unknown): Promise<Row | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from("ha_automations").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}
async function notify(title: string, body: string, severity: "success" | "info" | "warning", dedupe: string) {
  try { await db.rpc("tinker_notify", { p_title: title, p_body: body, p_severity: severity, p_dedupe: dedupe }); }
  catch (e) { console.error("tinker_notify", plainErr(e)); }
}

/* ───────── who is calling ───────── */

function bearer(req: Request) { return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""); }
function isService(req: Request): boolean {
  return secretKeys.includes(bearer(req)) || secretKeys.includes(req.headers.get("apikey") ?? "");
}
async function adminUser(req: Request): Promise<string | null> {
  const b = bearer(req);
  if (!b || b.split(".").length !== 3) return null;
  const { data } = await db.auth.getUser(b);
  if (!data?.user) return null;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return ok === true ? data.user.id : null;
}

/* ───────── YAML out (display + what the Pi writes) ─────────
   Home Assistant reads YAML 1.1: an unquoted 20:00:00 becomes the number 72000 and an unquoted on/off becomes a boolean.
   So strings are double-quoted unless they are plain identifiers (light.turn_on, platform names). Checked by a round trip below. */

const PLAIN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const RESERVED = /^(y|n|yes|no|on|off|true|false|null|~)$/i;
function scalar(v: Json): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  const s = String(v);
  return PLAIN.test(s) && !RESERVED.test(s) ? s : JSON.stringify(s);
}
const nonEmptyCollection = (v: Json) => (Array.isArray(v) ? v.length > 0 : isObj(v) && Object.keys(v).length > 0);
const inline = (v: Json) => (Array.isArray(v) ? "[]" : isObj(v) ? "{}" : scalar(v));
function emit(v: Json, ind: number): string[] {
  const pad = " ".repeat(ind);
  const out: string[] = [];
  if (Array.isArray(v)) {
    for (const it of v) {
      if (nonEmptyCollection(it)) {
        const sub = emit(it, ind + 2);
        sub[0] = pad + "- " + sub[0].slice(ind + 2);
        out.push(...sub);
      } else out.push(pad + "- " + inline(it));
    }
    return out;
  }
  for (const [k, val] of Object.entries(v as Row)) {
    if (nonEmptyCollection(val)) { out.push(`${pad}${scalar(k)}:`); out.push(...emit(val, ind + 2)); }
    else out.push(`${pad}${scalar(k)}: ${inline(val)}`);
  }
  return out;
}
function toYaml(v: Json): string { return emit(v, 0).join("\n") + "\n"; }
function sameJson(a: Json, b: Json): boolean { return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b)); }
function sortKeys(v: Json): Json {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
/** YAML text the Pi can write, proven to read back as the same data. */
function safeYaml(v: Json): string {
  const y = toYaml(v);
  let back: Json;
  try { back = yamlParse(y); } catch (e) { throw new Error("I could not write valid YAML: " + plainErr(e)); }
  if (!sameJson(back, v)) throw new Error("I could not write YAML that reads back the same.");
  return y;
}

/* ───────── the home: catalog from the Pi ───────── */

type Catalog = { entities: string[][]; services: Record<string, string[]>; ha_version?: string; captured_at: string };

async function readCatalog(): Promise<Catalog | null> {
  const { data } = await db.from("ha_entity_catalog").select("captured_at, data").eq("id", true).maybeSingle();
  const d = data?.data;
  if (!d || !Array.isArray(d.entities) || d.entities.length === 0) return null;
  return { entities: d.entities, services: isObj(d.services) ? d.services : {}, ha_version: d.ha_version, captured_at: data!.captured_at };
}

/** A catalog under 30 minutes old, or ask the Pi for one and wait up to 25 seconds; else the old one with a note. */
async function ensureCatalog(): Promise<{ cat: Catalog | null; note: string | null }> {
  const have = await readCatalog();
  if (have && Date.now() - Date.parse(have.captured_at) < CATALOG_FRESH_MS) return { cat: have, note: null };
  const since = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data: open } = await db.from("home_hub_commands").select("id").eq("requested_by", "ha-automator").eq("action", "catalog")
    .in("status", ["pending", "running"]).gte("created_at", since).limit(1);
  let cmdId = open?.[0]?.id as string | undefined;
  if (!cmdId) {
    cmdId = crypto.randomUUID();
    const { error } = await db.from("home_hub_commands").insert({ id: cmdId, target: "homeassistant", action: "catalog", payload: {}, requested_by: "ha-automator" });
    if (error) { console.error("catalog queue", error.message); cmdId = undefined; }
  }
  if (cmdId) {
    const stop = Date.now() + 25_000;
    while (Date.now() < stop) {
      await sleep(1500);
      const { data: c } = await db.from("home_hub_commands").select("status").eq("id", cmdId).maybeSingle();
      if (c && ["done", "failed", "expired"].includes(c.status)) break;
    }
    const fresh = await readCatalog();
    if (fresh && Date.now() - Date.parse(fresh.captured_at) < CATALOG_FRESH_MS) return { cat: fresh, note: null };
  }
  const old = await readCatalog();
  if (!old) return { cat: null, note: null };
  const mins = Math.max(1, Math.round((Date.now() - Date.parse(old.captured_at)) / 60_000));
  const age = mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`;
  return { cat: old, note: `Your Pi did not answer in time, so I used the device list from ${age} ago. A device added since then may be missing.` };
}

const STOP = new Set(["the", "and", "when", "then", "turn", "that", "this", "with", "from", "for", "into", "off", "was", "are", "have", "has", "make", "get",
  "set", "any", "all", "every", "should", "would", "could", "after", "before", "while", "once", "again", "also", "only", "just", "than", "them", "they", "its", "his",
  "her", "our", "out", "not", "but", "can", "will", "per", "who", "what", "which", "where", "there", "here", "up", "down", "over", "under", "about", "automatically"]);
const DOMAIN_WORDS: Record<string, string[]> = {
  fan: ["fan"], lock: ["lock"], door: ["cover", "lock", "binary_sensor"], garage: ["cover"], gate: ["cover"], blind: ["cover"], shade: ["cover"], curtain: ["cover"],
  cover: ["cover"], thermostat: ["climate"], heat: ["climate"], heater: ["climate"], cool: ["climate"], temperature: ["climate", "sensor"], climate: ["climate"],
  ac: ["climate"], plug: ["switch"], outlet: ["switch"], switch: ["switch"], scene: ["scene"], vacuum: ["vacuum"], camera: ["camera"], speaker: ["media_player"],
  music: ["media_player"], volume: ["media_player"], tv: ["media_player", "remote"], play: ["media_player"], humidifier: ["humidifier"], purifier: ["fan", "humidifier", "sensor"],
  air: ["fan", "humidifier", "sensor"], quality: ["sensor"], battery: ["sensor"], charge: ["sensor", "switch"], charging: ["sensor", "switch"], car: ["sensor", "device_tracker"],
  tesla: ["sensor", "device_tracker"], laundry: ["sensor"], washer: ["sensor"], dryer: ["sensor"], motion: ["binary_sensor"], door_open: ["binary_sensor"],
  window: ["binary_sensor", "cover"], sleep: ["binary_sensor", "sensor"], bed: ["binary_sensor", "sensor"], weather: ["weather", "sensor"], sun: ["sun"],
  sunset: ["sun"], sunrise: ["sun"], dark: ["sun", "sensor"], notify: ["person"], alert: ["person"], tell: ["person"], remind: ["person"],
};

/** The slice of the home that matters for this request: keyword matches + the always-needed entities, capped at ~300. */
function prefilter(cat: Catalog, text: string) {
  const words = [...new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/s$/, "")))];
  const wantDomains = new Set<string>();
  for (const w of words) for (const d of DOMAIN_WORDS[w] ?? []) wantDomains.add(d);
  const must: string[][] = [], scored: [number, string[]][] = [], domainHit: string[][] = [], lights: string[][] = [], players: string[][] = [];
  for (const e of cat.entities) {
    const [id, name = "", , area = ""] = e;
    if (typeof id !== "string") continue;
    const dom = id.split(".")[0];
    if (dom === "person" || dom === "zone" || id === "input_boolean.sexy_time" || id === "binary_sensor.bed_withings_sleep_in_bed" ||
        (dom === "binary_sensor" && id.endsWith("_here"))) { must.push(e); continue; }
    const hay = `${id} ${name} ${area}`.toLowerCase().replace(/_/g, " ");
    let s = 0;
    for (const w of words) if (hay.includes(w)) s++;
    if (s > 0) { scored.push([s, e]); continue; }
    if (wantDomains.has(dom)) domainHit.push(e);
    else if (dom === "light") lights.push(e);
    else if (dom === "media_player") players.push(e);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const picked: string[][] = [], seen = new Set<string>();
  for (const e of [...must, ...scored.map((x) => x[1]), ...domainHit, ...lights, ...players]) {
    if (picked.length >= 300) break;
    if (!seen.has(e[0])) { seen.add(e[0]); picked.push(e); }
  }
  const lines = picked.map((e) => `${e[0]}|${(e[1] ?? "").slice(0, 40)}|${(e[3] ?? "").slice(0, 24)}|${(e[2] ?? "").slice(0, 16)}`).join("\n");
  // services: the domains in play, plus the ones almost every automation touches
  const doms = new Set<string>(["notify", "script", "scene", "homeassistant", "input_boolean", "persistent_notification"]);
  for (const e of picked) doms.add(e[0].split(".")[0]);
  const svc: string[] = [];
  for (const d of doms) {
    const list = cat.services[d];
    if (Array.isArray(list) && list.length) svc.push(`${d}: ${list.slice(0, d === "notify" ? 80 : 40).join(", ")}`);
  }
  return { ids: picked.map((e) => e[0]), lines, services: svc.join("\n") };
}

/* ───────── checking a draft ───────── */

type Draft = {
  kind: "automation" | "package" | "cannot"; title: string; summary: string[]; assumptions: string[];
  risky: boolean; risk_reason: string; reason: string;
  ha_id: string | null; config: Row | null; package_name: string | null; pkg: Row | null;
};

/** Make an id out of what the model gave (or its title) so a sloppy name does not cost a whole repair round. */
function fixId(raw: string, title: string, prefix: string, max: number): string {
  const body = slug(slug(raw, 80).replace(/^bestly_(auto_)?/, "") || title, max);
  return body.length >= 3 ? prefix + body : "";
}

function normalize(j: Json, request: string): Draft | string {
  if (!isObj(j)) return "The answer was not a JSON object.";
  const kind = j.kind;
  if (kind !== "automation" && kind !== "package" && kind !== "cannot") return 'kind must be "automation", "package" or "cannot".';
  const d: Draft = {
    kind, title: str(j.title, 80), summary: strList(j.summary, 8), assumptions: strList(j.assumptions, 8),
    risky: j.risky === true, risk_reason: str(j.risk_reason, 300), reason: str(j.reason, 400),
    ha_id: null, config: null, package_name: null, pkg: null,
  };
  const desc = `Made by Tinker from: ${request.replace(/\s+/g, " ").slice(0, 200)}`;
  if (kind === "automation") {
    d.ha_id = fixId(str(j.ha_id, 80), d.title, "bestly_", 54);
    if (!isObj(j.config)) return "config must be an object (the automation).";
    const { id: _drop, alias, description: _d, mode, ...rest } = clone(j.config) as Row;
    d.config = { alias, description: desc, mode: mode ?? "single", ...rest };
  } else if (kind === "package") {
    d.package_name = fixId(str(j.package_name, 80).replace(/^bestly_auto_/, ""), d.title, "bestly_auto_", 44);
    if (!isObj(j.package)) return "package must be an object whose keys are the allowed top-level keys.";
    d.pkg = clone(j.package);
    if (Array.isArray(d.pkg!.automation)) {
      const used = new Set<string>();
      let n0 = 0;
      for (const a of d.pkg!.automation as Json[]) if (isObj(a)) {
        n0++;
        if (!a.mode) a.mode = "single";
        if (!a.description) a.description = desc;
        let id = ID_RE.test(String(a.id ?? "")) ? String(a.id) : fixId(String(a.id ?? ""), String(a.alias ?? "") || d.title, "bestly_", 54);
        if (!id) id = fixId(`${d.title}_${n0}`, "", "bestly_", 54);
        for (let n = 2; id && used.has(id); n++) id = `${id.replace(/_\d+$/, "")}_${n}`;
        if (id) { a.id = id; used.add(id); }
      }
    }
  }
  return d;
}

const walk = (v: Json, f: (key: string | null, val: Json) => void, key: string | null = null, depth = 0) => {
  if (depth > 30) return;
  f(key, v);
  if (Array.isArray(v)) for (const x of v) walk(x, f, key, depth + 1);
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, f, k, depth + 1);
};

type Check = { errors: string[]; unknown: string[]; risky: boolean; riskReasons: string[] };

function checkDraft(d: Draft, cat: Catalog, request: string): Check {
  const errors: string[] = [], riskReasons: string[] = [];
  const body: Json = d.kind === "automation" ? d.config : d.pkg;

  if (d.kind === "cannot") return { errors, unknown: [], risky: false, riskReasons };
  if (!d.title) errors.push("title is missing.");
  if (d.summary.length < 1) errors.push("summary needs at least one plain sentence.");

  // shape and names
  if (d.kind === "automation") {
    if (!ID_RE.test(d.ha_id ?? "")) errors.push("ha_id must match bestly_ followed by 3 to 60 lowercase letters, digits or underscores.");
    const c = d.config!;
    if (!str(c.alias)) errors.push("config.alias (a plain-words name) is missing.");
    const trig = c.trigger ?? c.triggers, act = c.action ?? c.actions;
    if (!trig || (Array.isArray(trig) && !trig.length)) errors.push("config needs a trigger.");
    if (!act || (Array.isArray(act) && !act.length)) errors.push("config needs an action.");
  } else {
    if (!PKG_RE.test(d.package_name ?? "")) errors.push("package_name must match bestly_auto_ followed by 3 to 50 lowercase letters, digits or underscores.");
    const keys = Object.keys(d.pkg!);
    if (!keys.length) errors.push("package is empty.");
    for (const k of keys) if (!PKG_KEYS.has(k)) errors.push(`package key "${k}" is not allowed. Allowed: ${[...PKG_KEYS].join(", ")}.`);
    if (d.pkg!.automation !== undefined) {
      if (!Array.isArray(d.pkg!.automation)) errors.push("package.automation must be a list.");
      else for (const a of d.pkg!.automation as Json[]) {
        if (!isObj(a) || !ID_RE.test(String(a.id ?? ""))) errors.push("every automation in the package needs id bestly_<slug> (lowercase letters, digits, underscores).");
      }
    }
  }
  if (errors.length && !body) return { errors, unknown: [], risky: false, riskReasons };

  // denylist and size
  const flat = JSON.stringify(body ?? {}).toLowerCase();
  for (const bad of DENY) if (flat.includes(bad)) errors.push(`"${bad}" is not allowed anywhere. Remove it.`);
  let text = "";
  try { text = safeYaml(d.kind === "automation" ? [{ id: d.ha_id, ...body }] : body); } catch (e) { errors.push(plainErr(e)); }
  if (text.length > MAX_YAML) errors.push(`the YAML is ${text.length} characters; the limit is ${MAX_YAML}. Make it smaller.`);

  // what this draft defines itself (helpers, scripts, templates), so references to them are fine
  const defined = new Set<string>(), definedDomains = new Set<string>();
  if (d.kind === "package") {
    for (const k of Object.keys(d.pkg!)) {
      const v = d.pkg![k];
      if (["input_boolean", "input_number", "input_select", "input_text", "input_datetime", "input_button", "timer", "counter", "schedule", "script", "group"].includes(k) && isObj(v)) {
        definedDomains.add(k);
        for (const id of Object.keys(v)) defined.add(`${k}.${id}`);
      }
      if (k === "scene" && Array.isArray(v)) for (const s of v) if (isObj(s) && s.name) defined.add(`scene.${slug(String(s.name))}`);
      if (k === "template" && Array.isArray(v)) {
        for (const t of v) if (isObj(t)) for (const [dom, items] of Object.entries(t)) {
          if (Array.isArray(items)) for (const it of items) if (isObj(it) && it.name) defined.add(`${dom}.${slug(String(it.name))}`);
        }
      }
      if (k === "automation" && Array.isArray(v)) for (const a of v) if (isObj(a) && a.alias) defined.add(`automation.${slug(String(a.alias))}`);
    }
  }
  if (d.kind === "automation" && d.config?.alias) defined.add(`automation.${slug(String(d.config.alias))}`);

  // every entity and service it mentions
  const known = new Set(cat.entities.map((e) => e[0]));
  const names = new Map(cat.entities.map((e) => [e[0], (e[1] ?? "").toLowerCase()] as const));
  const refs = new Set<string>(), services = new Set<string>();
  const addRef = (s: string) => { const t = s.trim(); if (ENTITY_RE.test(t)) refs.add(t); };
  walk(body, (key, val) => {
    if (typeof val !== "string") return;
    if ((key === "entity_id" || key === "zone" || key === "above" || key === "below") && !val.includes("{{") && !val.includes("{%")) {
      for (const part of val.split(",")) { const t = part.trim(); if (t && t !== "all" && t !== "none") addRef(t); }
    }
    if ((key === "service" || key === "action") && ENTITY_RE.test(val.trim())) services.add(val.trim());
    if (val.includes("{{") || val.includes("{%")) {
      for (const m of val.matchAll(/(?:states|is_state|state_attr|is_state_attr|has_value|expand|device_attr)\(\s*['"]([a-z_]+\.[a-z0-9_]+)['"]/g)) addRef(m[1]);
      for (const m of val.matchAll(/\bstates\.([a-z_]+)\.([a-z0-9_]+)/g)) addRef(`${m[1]}.${m[2]}`);
    }
  });
  const unknown = [...refs].filter((r) => !known.has(r) && !defined.has(r)).sort();

  const svcDomains = new Set(Object.keys(cat.services));
  for (const s of services) {
    const [dom, name] = s.split(".");
    if (dom === "script") continue;
    if (svcDomains.size && !svcDomains.has(dom) && !definedDomains.has(dom)) { errors.push(`service domain "${dom}" does not exist in this Home Assistant (${s}).`); continue; }
    const list = cat.services[dom];
    if (Array.isArray(list) && list.length && !list.includes(name)) errors.push(`service ${s} does not exist in this Home Assistant.`);
  }

  // risky: locks, alarms, garage/door covers, thermostat outside 60-85 F, sound at night
  const reasons = new Set<string>(riskReasons);
  const doms = new Set([...refs].map((r) => r.split(".")[0]));
  for (const s of services) doms.add(s.split(".")[0]);
  if (doms.has("lock")) reasons.add("it touches a lock");
  if (doms.has("alarm_control_panel")) reasons.add("it touches the alarm");
  for (const r of refs) if (r.startsWith("cover.") && /garage|door|gate/.test(`${r} ${names.get(r) ?? ""}`)) reasons.add("it opens or closes a garage, door or gate");
  const climateTemps: number[] = [];
  const scanClimate = (v: Json) => {
    if (Array.isArray(v)) { v.forEach(scanClimate); return; }
    if (!isObj(v)) return;
    const svc = String(v.service ?? v.action ?? "");
    if (svc.startsWith("climate.") && isObj(v.data)) {
      for (const k of ["temperature", "target_temp_high", "target_temp_low"]) if (typeof v.data[k] === "number") climateTemps.push(v.data[k]);
    }
    Object.values(v).forEach(scanClimate);
  };
  scanClimate(body);
  if (climateTemps.some((t) => t < 60 || t > 85)) reasons.add("it sets the thermostat outside 60 to 85 degrees F");
  const soundy = [...services].some((s) => /^(media_player\.(play_media|volume_set|volume_up|media_play)|tts\.)/.test(s));
  if (soundy) {
    let night = /\b(night|overnight|midnight|bedtime|asleep|sleeping)\b/i.test(request);
    walk(body, (key, val) => {
      if (typeof val === "string" && (key === "at" || key === "after" || key === "before") && /^\d{1,2}:\d{2}/.test(val)) {
        const h = parseInt(val.split(":")[0], 10);
        if (h >= 21 || h < 6) night = true;
      }
    });
    if (night) reasons.add("it makes sound at night");
  }
  if (d.risky && d.risk_reason) reasons.add(d.risk_reason);
  return { errors: [...new Set(errors)].slice(0, 12), unknown, risky: reasons.size > 0 || d.risky, riskReasons: [...reasons] };
}

/* ───────── the model ───────── */

const SYSTEM = `You are Tinker, Jared's Home Assistant automation engineer. You turn one plain-English request into exactly one of:
- an AUTOMATION (one automation, the usual case),
- a PACKAGE (helpers, templates, scripts, scenes and automations together, only when one automation cannot do it),
- or CANNOT (it needs a new integration, hardware that is not in Home Assistant, a login, HACS, or custom code).
Prefer automation, then package. Use only entity ids from the list you are given (plus helpers you define in the same package). Never guess an entity id.
Use Home Assistant's classic syntax: trigger with platform, condition with condition, action with service.

Reply with ONE JSON object and nothing else. Keys:
kind: the word automation, package or cannot.
title: 3 to 8 plain words naming it.
summary: a list of 2 to 6 short plain sentences. Start them with "When ...", "Only if ..." and "Then ...". No jargon, no entity ids; say "the kitchen lights".
assumptions: a list of plain sentences for every guess you made (a time, a brightness, which lights). Empty list if none.
risky: true or false. risk_reason: one sentence if risky.
For automation: ha_id (bestly_ then a short slug) and config (the automation as an object with alias, description, mode, trigger, condition, action).
For package: package_name (bestly_auto_ then a short slug) and package (an object whose keys are only: automation, script, scene, template, input_boolean, input_number, input_select, input_text, input_datetime, input_button, timer, counter, schedule, group; each automation in it has an id starting bestly_).
For cannot: reason, one plain sentence saying what is missing. Also give title and summary of what he wanted.

Hard limits: never use !secret, shell_command, command_line, rest_command, python_script, pyscript, hassio., homeassistant.stop, homeassistant.restart or recorder.purge. Keep a package under 40,000 characters. Quote every time and every on/off state like "20:00:00" and "on".

${HOUSE_RULES}`;

function userPrompt(request: string, lines: string, services: string, extra: string) {
  return `What Jared wants: ${request}\n\nHis devices, one per line as entity_id|name|area|state:\n${lines}\n\nServices you may call (domain: services):\n${services}\n${extra}\nReturn the JSON now.`;
}

function previousDraft(row: Row): string {
  try {
    const p: Row = { kind: row.kind, title: row.title, summary: row.summary, assumptions: row.assumptions };
    if (row.kind === "automation") { p.ha_id = row.ha_id; p.config = row.config; }
    else if (row.kind === "package" && row.package_yaml) { p.package_name = row.package_name; p.package = yamlParse(row.package_yaml); }
    else return "";
    return `\nYour previous draft (change this one, do not start over unless asked):\n${JSON.stringify(p)}\n`;
  } catch { return ""; }
}

/* ───────── hand-off to the Code Worker ───────── */

function handoffGoal(request: string, reason: string, pkgName: string, ids: string[]): string {
  return `Home Assistant job for Jared, from Tinker (his Home Automation Engineer).

What he asked for, in his words: "${request.replace(/\s+/g, " ").slice(0, 600)}"
Why Tinker could not build it alone: ${reason || "it needs more than one automation can do."}

Create exactly ONE new file: home-assistant/packages/${pkgName}.yaml
Change no other file. Do not touch src/, supabase/, or any existing package.

The file is a Home Assistant package (YAML). Rules:
- Top-level keys allowed: ${[...PKG_KEYS].join(", ")}. Anything else is refused.
- Every automation in it needs id: bestly_<short_slug> (lowercase letters, digits, underscores) and a description that starts "Made by Tinker from: <his request>".
- Never use: ${DENY.join(", ")}.
- Under ${MAX_YAML} characters. No custom YAML tags. Quote every time and every on/off state.
- If part of the request needs something a package cannot do (a new integration, HACS, a login, new hardware, custom code), do not invent it. Write the closest working package using built-in features only, and put a comment at the top of the file saying exactly what is missing.
- Use only these entity ids (they exist in his Home Assistant today) plus helpers you define in the same file:
${ids.join(", ")}

${HOUSE_RULES}`;
}

async function makeHandoff(row: Row, d: Draft | null, reason: string, ids: string[], extra: Row = {}): Promise<Row | null> {
  const request = String(row.request);
  const pkgName = PKG_RE.test(row.package_name ?? "") ? row.package_name : ("bestly_auto_" + (slug(d?.title || request, 36) || "item_" + Math.random().toString(36).slice(2, 7)));
  const finalName = PKG_RE.test(pkgName) ? pkgName : "bestly_auto_item_" + Math.random().toString(36).slice(2, 7);
  const goal = handoffGoal(request, reason, finalName, ids);
  let codeJobId: string | null = null, note: string | null = null;
  const { data: job, error } = await db.from("code_jobs").insert({ repo: REPO, goal }).select("id").maybeSingle();
  if (error || !job) { note = "I could not queue the Code Worker (" + (error?.message ?? "no row").slice(0, 100) + "). Copy the prompt and hand it over yourself."; }
  else codeJobId = job.id;
  const title = d?.title || row.title || (request.length > 60 ? request.slice(0, 57).trim() + "..." : request);
  return await patch(row.id, {
    kind: "cannot", status: "handoff", package_name: finalName, title, code_job_id: codeJobId, handoff_prompt: goal,
    summary: d?.summary?.length ? d.summary : (row.summary ?? [`You asked: ${request.slice(0, 200)}`]),
    assumptions: d?.assumptions ?? row.assumptions ?? [], error: note ?? (reason ? `Tinker could not build this one alone: ${reason}` : null),
    config: null, package_yaml: null, yaml: null, wait_tries: 0, retry_at: null, ...extra,
  });
}

/* ───────── waiting instead of "try again" ─────────
   Jared's rule (2026-10-28): never tell him to wait or retry. When no free model can answer, the row stays "drafting" with a calm
   note and the watch re-runs it every 4 minutes. At the 6th try (about 30 minutes) Scout's out-of-room path names one vetted provider
   to connect (sent to the recap, signed Tinker); the row keeps waiting. Free models only, always. */

async function parkDraft(row: Row, note: string, tried: Json[], attempts: number, extra: Row = {}): Promise<void> {
  const tries = (row.wait_tries ?? 0) + 1;
  const base = { tried, attempts: (row.attempts ?? 0) + attempts, ...extra };
  if (tries >= WAIT_MAX_TRIES) {
    await patch(row.id, { ...base, status: "failed", wait_tries: 0, retry_at: null,
      error: "No free model could write this one in about 5 hours, so Tinker stopped. Nothing was spent. Tap Change it and he starts it over." });
    await notify("I could not write one request", "No free AI model could write it in about 5 hours. Nothing was spent and nothing was installed.", "info", `tinker.gaveup.${row.id}`);
    return;
  }
  let msg = note;
  if (tries >= WAIT_QUICK_TRIES) {
    let ask = "";
    try {
      const room = await outOfRoomMessage({ tried: tried as never, noPaid: true });
      const c = room.candidate;
      ask = c
        ? `To add room now, connect ${c.label}: get a key at ${c.keyUrl} and save it in Supabase Vault as ${c.keyName}. Scout switches it on within 10 minutes.`
        : "Every provider on Scout's vetted no-training list is already connected.";
    } catch (e) { console.error("outOfRoomMessage", plainErr(e)); }
    msg = "Every free model is out of room right now. Tinker keeps checking and finishes on his own." + (ask ? " He sent you a note about which new one to connect." : "");
    if (tries === WAIT_QUICK_TRIES) {
      await notify("The free AI is out of room",
        `I tried every free model for about 30 minutes and none could write "${String(row.request).replace(/\s+/g, " ").slice(0, 80)}". ${ask} I keep trying on my own and finish it the moment one answers.`,
        "info", `tinker.outofroom.${row.id}`);
    }
  }
  await patch(row.id, { ...base, status: "drafting", error: msg, wait_tries: tries,
    retry_at: new Date(Date.now() + (tries < WAIT_QUICK_TRIES ? 4 : 15) * 60_000).toISOString() });
}

/* ───────── the drafting pipeline ───────── */

async function runDraft(row: Row, feedback: string | null) {
  const t0 = Date.now(), BUDGET = 130_000;
  const request = String(row.request);
  const tried: Json[] = [];
  let attempts = 0, model: string | null = null, provider: string | null = null;
  try {
    const { cat, note } = await ensureCatalog();
    if (!cat) {
      await parkDraft(row, "Waiting on your Pi's device list. Tinker finishes on his own.", tried, attempts);
      return;
    }
    const pf = prefilter(cat, request + " " + (feedback ?? ""));
    const extra = feedback ? `${previousDraft(row)}\nJared's change request: ${feedback}\n` : "";
    let problems = "", last: Draft | null = null, lastCheck: Check | null = null;

    for (let round = 0; round < 3; round++) {
      const left = BUDGET - (Date.now() - t0);
      if (left < 12_000) break;
      const user = userPrompt(request, pf.lines, pf.services, extra + problems);
      attempts++;
      let res;
      try {
        res = await llm({
          task: "code", system: SYSTEM, user, json: true, maxTokens: 4000, paid: "never", privacy: "private",
          job: "ha-automator", fn: "ha-automator", ref: row.id, deadlineMs: Math.min(60_000, left - 4000),
          validate: (j: Json) => (isObj(j) && ["automation", "package", "cannot"].includes(j.kind) ? null : "kind must be automation, package or cannot"),
        });
      } catch (e) {
        if (e instanceof LlmUnavailable) { tried.push(...(e.tried ?? [])); if (round === 0 || !last) throw e; break; }
        throw e;
      }
      tried.push(...res.tried); model = res.model; provider = res.provider;

      const d = normalize(res.json, request);
      if (typeof d === "string") { problems = `\nYour last answer was rejected: ${d} Return the full corrected JSON.\n`; continue; }
      if (d.kind === "cannot") { await makeHandoff(row, d, d.reason, pf.ids, { model, provider, tried, attempts: (row.attempts ?? 0) + attempts }); return; }
      if (row.ha_id && d.kind === "automation" && !ID_RE.test(d.ha_id ?? "")) d.ha_id = row.ha_id;
      const c = checkDraft(d, cat, request);
      last = d; lastCheck = c;
      if (!c.errors.length && !c.unknown.length) break;
      problems = "\nYour last answer had these problems. Fix them and return the full corrected JSON:\n" +
        [...c.errors, ...c.unknown.map((u) => `entity ${u} is not in his home. Use one from the list, or define it as a helper in a package.`)].map((e) => "- " + e).join("\n") +
        `\nYour last answer was: ${JSON.stringify(d.kind === "automation" ? { kind: d.kind, title: d.title, summary: d.summary, assumptions: d.assumptions, ha_id: d.ha_id, config: d.config } : { kind: d.kind, title: d.title, summary: d.summary, assumptions: d.assumptions, package_name: d.package_name, package: d.pkg })}\n`;
    }

    if (!last || !lastCheck) {
      await parkDraft(row, "The free AI's last answer was not usable. Tinker is asking another model.", tried, attempts, { model, provider });
      return;
    }
    const patchBase = { model, provider, tried, attempts: (row.attempts ?? 0) + attempts, feedback: feedback ?? row.feedback ?? null, wait_tries: 0, retry_at: null };
    if (lastCheck.errors.length) {
      // still not safe after the repair rounds: do not show it, hand the job to the Code Worker with the same rules
      await makeHandoff(row, last, "the draft kept failing my safety checks (" + lastCheck.errors.slice(0, 3).join("; ") + ")", pf.ids, patchBase);
      return;
    }
    const assumptions = [...last.assumptions];
    if (note) assumptions.push(note);
    if (lastCheck.unknown.length) assumptions.push(`I could not find ${lastCheck.unknown.join(", ")} in your home, so this may not work until ${lastCheck.unknown.length === 1 ? "it exists" : "they exist"}.`);
    const config = last.kind === "automation" ? last.config : null;
    const yaml = last.kind === "automation" ? safeYaml([{ id: last.ha_id, ...last.config }]) : safeYaml(last.pkg);
    const pkgYaml = last.kind === "package" ? `# Made by Tinker from: ${request.replace(/\s+/g, " ").slice(0, 200)}\n${yaml}` : null;
    await patch(row.id, {
      ...patchBase, kind: last.kind, status: "preview", title: last.title, summary: last.summary, assumptions,
      risky: lastCheck.risky, risk_reason: lastCheck.riskReasons.join("; ") || null,
      ha_id: last.kind === "automation" ? last.ha_id : null, package_name: last.kind === "package" ? last.package_name : null,
      config, package_yaml: pkgYaml, yaml: pkgYaml ?? yaml, error: null, code_job_id: null, handoff_prompt: null,
    });
  } catch (e) {
    console.error("ha-automator draft", plainErr(e));
    if (e instanceof LlmUnavailable) {
      await parkDraft(row, WAIT_NOTE, tried, attempts);
      return;
    }
    await patch(row.id, { status: "failed", error: "Something broke while I was writing it: " + plainErr(e), tried, attempts: (row.attempts ?? 0) + attempts, wait_tries: 0, retry_at: null });
  }
}

function inBackground(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else p.catch(() => {});
}

/* ───────── ops ───────── */

async function opGenerate(b: Row, userId: string | null) {
  const request = str(b.request, 1000);
  if (request.length < 5) return { ok: false, error: "Tell me what should happen, in a sentence or two." };
  const { count } = await db.from("ha_automations").select("id", { count: "exact", head: true }).eq("status", "drafting");
  if ((count ?? 0) >= 12) return { ok: false, error: "Tinker already has twelve drafts in line, so this one was not added. Discard one you no longer need." };
  // 4 at once; the rest wait in line and the watch starts them (never "try again in a minute")
  const inLine = (count ?? 0) >= 4;
  const { data: row, error } = await db.from("ha_automations").insert({
    request, status: "drafting", requested_by: userId,
    ...(inLine ? { wait_tries: 1, retry_at: new Date().toISOString(), error: "In line behind other drafts. Tinker starts it on his own." } : {}),
  }).select("*").single();
  if (error || !row) return { ok: false, error: "I could not save that request: " + (error?.message ?? "no row").slice(0, 120) };
  if (!inLine) inBackground(runDraft(row, null));
  return { ok: true, row };
}

async function opRevise(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  const feedback = str(b.feedback, 1000);
  if (feedback.length < 3) return { ok: false, error: "Tell me what to change." };
  if (row.installed_at && row.status !== "undone") return { ok: false, error: "That one is already in Home Assistant. Undo it first, or make a new one." };
  if (!["preview", "failed", "handoff", "undone"].includes(row.status)) return { ok: false, error: "Tinker is still working on that one. Send the change when he is done." };
  const upd = await patch(row.id, { status: "drafting", feedback, error: null, wait_tries: 0, retry_at: null });
  inBackground(runDraft({ ...row, ...(upd ?? {}) }, feedback));
  return { ok: true, row: upd };
}

async function sendToPi(row: Row, nextStatus: "installing" | "undoing" | null, action: string, payload: Row, extra: Row = {}) {
  const cmdId = crypto.randomUUID();
  // the row first, so the trigger finds it waiting when the Pi answers
  const upd = await patch(row.id, { ...(nextStatus ? { status: nextStatus } : {}), command_id: cmdId, error: null, ...extra });
  const { error } = await db.from("home_hub_commands").insert({
    id: cmdId, target: "homeassistant", action, payload: { ...payload, automator_id: row.id }, requested_by: "ha-automator",
  });
  if (error) {
    const back = await patch(row.id, { status: row.status, command_id: row.command_id ?? null, error: "I could not send that to your Pi: " + error.message.slice(0, 120), enabled: row.enabled });
    return { ok: false, error: "I could not send that to your Pi. Nothing was changed.", row: back };
  }
  return { ok: true, row: upd };
}

function recheckStored(row: Row): string | null {
  const body = row.kind === "automation" ? row.config : row.package_yaml;
  if (!body) return "There is nothing to install on this one.";
  const flat = (typeof body === "string" ? body : JSON.stringify(body)).toLowerCase();
  for (const bad of DENY) if (flat.includes(bad)) return `It contains "${bad}", which I never install.`;
  if (row.kind === "automation" && !ID_RE.test(row.ha_id ?? "")) return "Its id is not valid.";
  if (row.kind === "package" && (!PKG_RE.test(row.package_name ?? "") || String(row.package_yaml).length > MAX_YAML)) return "Its package name or size is not valid.";
  return null;
}

async function opInstall(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  const draftBack = row.status === "failed" && !row.installed_at && (row.config || row.package_yaml);
  if (row.status !== "preview" && !draftBack) return { ok: false, error: row.status === "installing" ? "It is already being installed." : "Only a preview can be installed." };
  if (row.kind !== "automation" && row.kind !== "package") return { ok: false, error: "This one is not something I can install." };
  const bad = recheckStored(row);
  if (bad) return { ok: false, error: bad };
  const r = row.kind === "automation"
    ? await sendToPi(row, "installing", "automation_put", { id: row.ha_id, config: row.config })
    : await sendToPi(row, "installing", "package_put", { name: row.package_name, yaml: row.package_yaml });
  return r;
}

async function opUndo(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  const can = row.status === "installed" || (row.status === "failed" && row.installed_at && !row.undone_at);
  if (!can) return { ok: false, error: "Only something that is installed can be undone." };
  if (row.kind === "automation") {
    return row.prev_config
      ? await sendToPi(row, "undoing", "automation_put", { id: row.ha_id, config: row.prev_config })
      : await sendToPi(row, "undoing", "automation_delete", { id: row.ha_id });
  }
  if (row.kind === "package") {
    return row.prev_yaml
      ? await sendToPi(row, "undoing", "package_put", { name: row.package_name, yaml: row.prev_yaml })
      : await sendToPi(row, "undoing", "package_delete", { name: row.package_name });
  }
  return { ok: false, error: "There is nothing to undo on this one." };
}

async function opToggle(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  if (typeof b.enabled !== "boolean") return { ok: false, error: "Say whether it should be on or off." };
  if (row.status !== "installed") return { ok: false, error: "Only an installed automation can be switched." };
  if (!row.entity_id || !/^automation\.[a-z0-9_]+$/.test(row.entity_id)) {
    return { ok: false, error: "This one is a bundle, so I can't switch it from here. Use Undo to take it out." };
  }
  return await sendToPi(row, null, "toggle_automation", { automation_id: row.entity_id, enabled: b.enabled }, { enabled: b.enabled });
}

async function opDiscard(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  if (row.status === "drafting" && !(row.wait_tries > 0)) return { ok: false, error: "Tinker is writing that one right now. You can discard it the moment it appears." };
  if (["installing", "undoing", "installed"].includes(row.status)) return { ok: false, error: "That one is in Home Assistant. Undo it first." };
  return { ok: true, row: await patch(row.id, { status: "discarded", error: null }) };
}

async function opHandoff(b: Row) {
  const row = await getRow(b.id);
  if (!row) return { ok: false, error: "I can't find that one." };
  if (["installing", "undoing", "installed"].includes(row.status)) return { ok: false, error: "That one is in Home Assistant already." };
  if (row.status === "handoff" && row.code_job_id) return { ok: true, row };
  const { cat } = await ensureCatalog();
  const ids = cat ? prefilter(cat, row.request).ids : [];
  const r = await makeHandoff(row, null, "Jared asked for the Code Worker to take it.", ids);
  return { ok: !!r, row: r, ...(r ? {} : { error: "I could not hand that over." }) };
}

/* ───────── watch (cron, every 5 minutes) ───────── */

async function watch() {
  const out: Row = { requeued: 0, failed: 0, handbacks: 0, interrupted: 0, redrafted: 0, catalog: "fresh", page: "page check did not run" };
  let pageOk = true;
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  try {
    // 0. Tinker checks his own page: the signed-in read permission and admin policy on his two tables.
    //    Grant gone + policy there -> the same grant is put back (logged, with undo). Policy gone -> never granted, Tinker alerts.
    //    (2026-10-21 to 2026-10-29 the page said "permission denied" while this watch, running as the service role, stayed green.)
    try {
      const { data: pc, error: pcErr } = await db.rpc("tinker_page_check");
      if (pcErr) { out.page = "page check could not run: " + plainErr(pcErr.message); pageOk = false; }
      else { out.page = String(pc?.summary ?? "page check ok"); pageOk = pc?.ok !== false; }
    } catch (e) { out.page = "page check could not run: " + plainErr(e); pageOk = false; }

    // 1. drafting that never finished (the function was cut off): not a failure, back in line to be written again
    const { data: drafting } = await db.from("ha_automations").select("id").eq("status", "drafting").eq("wait_tries", 0).is("retry_at", null).lt("updated_at", minutesAgo(6));
    for (const r of drafting ?? []) {
      await patch(r.id, { wait_tries: 1, retry_at: new Date().toISOString(), error: "Tinker's last try was cut off. He starts it again on his own." });
      out.interrupted++;
    }

    // 1b. drafts waiting on a free model (or in line): re-run the ones that are due, two at a time.
    //     retry_at is moved forward first (a 12 minute lease), so two ticks never run the same draft twice.
    const { data: due } = await db.from("ha_automations").select("*").eq("status", "drafting").gt("wait_tries", 0).lte("retry_at", new Date().toISOString()).order("retry_at").limit(2);
    for (const r of due ?? []) {
      const { data: got } = await db.from("ha_automations").update({ retry_at: new Date(Date.now() + 12 * 60_000).toISOString() })
        .eq("id", r.id).eq("retry_at", r.retry_at).select("*").maybeSingle();
      if (got) { inBackground(runDraft(got, got.feedback ?? null)); out.redrafted++; }
    }

    // 1c. a warm device list: when ours is over 6 hours old, ask the Pi for a new one now (no AI; Hestia does the work),
    //     so the first draft of the day does not stand around for 25 seconds. At most one ask per 30 minutes.
    const { data: cat } = await db.from("ha_entity_catalog").select("captured_at").eq("id", true).maybeSingle();
    const catAge = cat?.captured_at ? Date.now() - Date.parse(cat.captured_at) : Infinity;
    if (catAge > CATALOG_WARM_MS) {
      const { data: recent } = await db.from("home_hub_commands").select("id").eq("requested_by", "ha-automator").eq("action", "catalog").gte("created_at", minutesAgo(30)).limit(1);
      if (!recent?.length) {
        const { error } = await db.from("home_hub_commands").insert({ id: crypto.randomUUID(), target: "homeassistant", action: "catalog", payload: {}, requested_by: "ha-automator" });
        out.catalog = error ? "could not ask the Pi: " + plainErr(error.message) : "asked the Pi for a new device list";
      } else out.catalog = "device list is old, Pi already asked";
    }

    // 2. installing / undoing that the Pi never answered: one re-queue, then give up and say so
    const { data: stuck } = await db.from("ha_automations").select("*").in("status", ["installing", "undoing"]).lt("updated_at", minutesAgo(10)).limit(10);
    for (const r of stuck ?? []) {
      const { data: cmds } = await db.from("home_hub_commands").select("id, action, payload, status, created_at")
        .eq("requested_by", "ha-automator").eq("payload->>automator_id", r.id).neq("action", "catalog").order("created_at", { ascending: false });
      const mine = cmds ?? [];
      const verb = r.status === "installing" ? "install" : "undo";
      if (mine.length >= 2 || !mine.length) {
        for (const c of mine) if (["pending", "running"].includes(c.status)) await db.from("home_hub_commands").update({ status: "expired", error: "Tinker gave up waiting." }).eq("id", c.id);
        await patch(r.id, { status: "failed", command_id: null, error: `Home Assistant did not answer after two tries, so nothing was ${verb === "install" ? "installed" : "undone"}. Is your Pi online?` });
        await notify(`Tinker: I could not ${verb} ${r.title ?? "an automation"}`,
          `The Pi did not answer after two tries, so nobody could fix it from here. Nothing was changed in Home Assistant.`, "warning", `tinker.stuck.${r.id}`);
        out.failed++;
      } else {
        const last = mine[0];
        const cmdId = crypto.randomUUID();
        await patch(r.id, { command_id: cmdId });
        const { error } = await db.from("home_hub_commands").insert({ id: cmdId, target: "homeassistant", action: last.action, payload: last.payload, requested_by: "ha-automator" });
        if (error) { console.error("requeue", error.message); continue; }
        if (["pending", "running"].includes(last.status)) await db.from("home_hub_commands").update({ status: "expired", error: "Tinker re-sent this." }).eq("id", last.id);
        out.requeued++;
      }
    }

    // 3. Code Worker hand-backs
    const { data: hand } = await db.from("ha_automations").select("*").eq("status", "handoff").not("code_job_id", "is", null).limit(5);
    for (const r of hand ?? []) {
      const { data: job } = await db.from("code_jobs").select("status, result").eq("id", r.code_job_id).maybeSingle();
      if (!job) continue;
      if (job.status === "failed") {
        const msg = "The Code Worker could not finish this one. Copy the prompt and hand it to Claude Code yourself.";
        if (r.error !== msg) await patch(r.id, { error: msg });
        continue;
      }
      if (job.status !== "done") continue;
      const sha = typeof job.result?.commit_sha === "string" && /^[0-9a-f]{7,40}$/.test(job.result.commit_sha) ? job.result.commit_sha : null;
      const got = await fetchPackageFile(r.package_name, sha);
      if (typeof got === "string" && got.startsWith("ERR:")) {
        const msg = got.slice(4);
        if (r.error !== msg) await patch(r.id, { error: msg });
        continue;
      }
      const res = await acceptHandback(r, got as string);
      if (res) out.handbacks++;
    }

    // 4. an agent too old to do any of this
    const { data: st } = await db.from("home_hub_agent_state").select("version").eq("agent", "home-hub").maybeSingle();
    if (st?.version && semverLt(String(st.version), MIN_AGENT)) {
      const { count } = await db.from("ha_automations").select("id", { count: "exact", head: true }).in("status", ["installing", "undoing", "preview", "installed"]);
      if ((count ?? 0) > 0) {
        await notify("Tinker: the Pi agent needs an update", `The Pi agent is on ${st.version}. I need ${MIN_AGENT} or newer to install automations.`, "warning", `tinker.agent-old.${st.version}`);
      }
    }
    out.agent = st?.version ?? null;
    await db.from("agent_beats").upsert({ slug: "tinker", at: new Date().toISOString(), ok: pageOk,
      summary: `Watch ran: ${out.page}; ${out.requeued} re-sent, ${out.failed} gave up, ${out.handbacks} came back from the Code Worker, ${out.redrafted} waiting drafts re-run` +
        (out.catalog === "fresh" ? "" : `; ${out.catalog}`) }, { onConflict: "slug" });
  } catch (e) {
    console.error("ha-automator watch", plainErr(e));
    await db.from("agent_beats").upsert({ slug: "tinker", at: new Date().toISOString(), ok: false, summary: "Watch broke: " + plainErr(e) }, { onConflict: "slug" });
    return { ok: false, error: plainErr(e), ...out };
  }
  return { ok: true, ...out };
}

async function fetchPackageFile(name: string, sha: string | null): Promise<string> {
  if (!PKG_RE.test(name ?? "")) return "ERR:The package name on this one is not valid, so I can't look for the file.";
  const path = `home-assistant/packages/${name}.yaml`;
  for (const ref of sha ? [sha, "main"] : ["main"]) {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${path}`, { headers: { "User-Agent": "ha-automator" } });
      if (r.ok) { const t = await r.text(); if (t.trim()) return t; }
    } catch { /* try the next ref */ }
  }
  return "ERR:The Code Worker finished, but the file is not in the repo where I expected it. Copy the prompt and hand it over yourself.";
}

/** Validate the file the Code Worker wrote; if it passes, this becomes a normal preview. */
async function acceptHandback(r: Row, text: string): Promise<boolean> {
  const stop = async (msg: string) => { if (r.error !== msg) await patch(r.id, { error: msg }); return false; };
  if (text.length > MAX_YAML) return await stop(`The file the Code Worker wrote is ${text.length} characters; the limit is ${MAX_YAML}. Ask for a smaller one.`);
  const flat = text.toLowerCase();
  for (const bad of DENY) if (flat.includes(bad)) return await stop(`The Code Worker's file contains "${bad}", which I never install. Copy the prompt and try again.`);
  let pkg: Json;
  try { pkg = yamlParse(text); } catch (e) { return await stop("The Code Worker's file is not valid YAML: " + plainErr(e)); }
  if (!isObj(pkg)) return await stop("The Code Worker's file is empty or not a Home Assistant package.");
  const cat = (await readCatalog()) ?? { entities: [], services: {}, captured_at: new Date().toISOString() } as Catalog;
  const d: Draft = {
    kind: "package", title: r.title ?? "", summary: ["x"], assumptions: [], risky: false, risk_reason: "", reason: "",
    ha_id: null, config: null, package_name: r.package_name, pkg,
  };
  const c = cat.entities.length ? checkDraft(d, cat, r.request) : { errors: [], unknown: [], risky: false, riskReasons: [] } as Check;
  const errs = c.errors.filter((e) => !/^(title|summary)/.test(e));
  if (errs.length) return await stop("The Code Worker's file did not pass my safety check: " + errs.slice(0, 3).join(" "));

  // plain-English summary of what the file does
  let title = r.title ?? "", summary: string[] = [], assumptions: string[] = strList(r.assumptions);
  try {
    const res = await llm({
      task: "summarize", system: "You describe Home Assistant YAML to a non-technical homeowner. Reply with one JSON object: title (3 to 8 plain words), summary (2 to 6 short sentences starting When / Only if / Then, no entity ids), assumptions (a list, may be empty).",
      user: `Request: ${r.request}\n\nYAML:\n${text.slice(0, 12_000)}`, json: true, maxTokens: 900, paid: "never", privacy: "private",
      job: "ha-automator", fn: "ha-automator", ref: r.id, deadlineMs: 40_000,
    });
    if (isObj(res.json)) { title = str(res.json.title, 80) || title; summary = strList(res.json.summary, 8); assumptions = [...assumptions, ...strList(res.json.assumptions, 4)]; }
  } catch { /* fall back below */ }
  if (!summary.length) {
    const aliases = Array.isArray(pkg.automation) ? (pkg.automation as Json[]).filter(isObj).map((a) => String(a.alias ?? a.id)).slice(0, 5) : [];
    summary = [aliases.length ? `This adds: ${aliases.join("; ")}.` : "The Code Worker wrote a Home Assistant package for this request.", "Open the YAML to see exactly what it does."];
  }
  if (c.unknown.length) assumptions.push(`I could not find ${c.unknown.join(", ")} in your home, so this may not work until ${c.unknown.length === 1 ? "it exists" : "they exist"}.`);
  await patch(r.id, {
    kind: "package", status: "preview", title: title || "Home Assistant package", summary, assumptions,
    risky: c.risky, risk_reason: c.riskReasons.join("; ") || null, package_yaml: text, yaml: text, config: null, ha_id: null, error: null,
  });
  await notify(`Tinker: ${title || "your automation"} is ready for your tap`, "The Code Worker finished it and it passed my checks. Open the Automation Maker to preview and install it.", "success", `tinker.handback.${r.id}`);
  return true;
}

/* ───────── entry ───────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let b: Row = {};
  try { b = await req.json(); } catch { /* empty */ }
  const op = String(b.op ?? "");

  try {
    if (op === "watch") {
      if (!isService(req)) return J({ ok: false, error: "Only the schedule can run the watch." }, 403);
      return J(await watch());
    }
    const service = isService(req);
    const userId = service ? null : await adminUser(req);
    if (!service && !userId) return J({ ok: false, error: "Only Jared's admin can use the Automation Maker." }, 403);
    switch (op) {
      case "generate": return J(await opGenerate(b, userId));
      case "revise": return J(await opRevise(b));
      case "install": return J(await opInstall(b));
      case "undo": return J(await opUndo(b));
      case "toggle": return J(await opToggle(b));
      case "discard": return J(await opDiscard(b));
      case "handoff": return J(await opHandoff(b));
      default: return J({ ok: false, error: "I don't know that request." });
    }
  } catch (e) {
    console.error("ha-automator", op, plainErr(e));
    return J({ ok: false, error: "Something broke on my side: " + plainErr(e) });
  }
});
