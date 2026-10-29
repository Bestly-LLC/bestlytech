// ha-fixer/lib.ts — the pure parts of Tinker's Automation Fixer (no network, no Deno APIs, so vitest can run them).
// Contract: docs/ha-fixer-opusplan.md. Everything Jared reads is plain words with 12-hour times and US units.

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
// deno-lint-ignore no-explicit-any
export type Json = any;

export const TZ = "America/Los_Angeles";
export const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;
export const DENY = ["!secret", "shell_command", "command_line", "rest_command", "python_script", "pyscript", "hassio.",
  "homeassistant.stop", "homeassistant.restart", "recorder.purge"];

export const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
export const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const strList = (v: unknown, n = 8, max = 300): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => (x as string).trim().slice(0, max)) : [];
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export const plainErr = (e: unknown) => String((e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 200);
export const semverLt = (a: string, b: string) => {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0), pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
};

/* ───────── time (Pacific, 12-hour) ───────── */

const dtf = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts });

/** "6:02 AM" (or "6:02:10 AM" with sec, "Oct 29, 6:02 AM" with date). Plain ASCII spaces. */
export function fmt12(when: string | number | Date | null | undefined, o: { sec?: boolean; date?: boolean } = {}): string {
  if (when === null || when === undefined || when === "") return "";
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  const t = dtf({ hour: "numeric", minute: "2-digit", ...(o.sec ? { second: "2-digit" } : {}), hour12: true }).format(d);
  const out = t.replace(/[\u202f\u00a0]/g, " ");
  if (!o.date) return out;
  const day = dtf({ month: "short", day: "numeric" }).format(d);
  return `${day}, ${out}`;
}

export function localParts(d: Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const p = Object.fromEntries(dtf({ year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, parseInt(x.value, 10)]));
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute };
}

/** A wall-clock time in Pacific to a real instant. */
export function localToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let out = guess;
  for (let i = 0; i < 2; i++) {
    const lp = localParts(new Date(out));
    const asUtc = Date.UTC(lp.y, lp.mo - 1, lp.d, lp.h, lp.mi);
    out += guess - asUtc;
  }
  return new Date(out);
}

const addDaysLocal = (now: Date, days: number, h: number, mi = 0): Date => {
  const lp = localParts(new Date(now.getTime() + days * 86_400_000));
  return localToUtc(lp.y, lp.mo, lp.d, h, mi);
};

export type Scope = { start: Date; end: Date; note: string };

/** Read "when" out of a sentence: 6 AM, this morning, last night, yesterday, just now. Null when it says nothing. */
export function parseWhen(question: string, now: Date): Scope | null {
  const q = question.toLowerCase();
  const clamp = (s: Date, e: Date, note: string): Scope => {
    const end = e.getTime() > now.getTime() ? now : e;
    const start = new Date(Math.max(s.getTime(), end.getTime() - 48 * 3_600_000));
    return { start, end, note };
  };
  if (/\b(just now|right now|a (few )?minutes? ago|a moment ago|few minutes ago)\b/.test(q)) {
    return clamp(new Date(now.getTime() - 25 * 60_000), now, "the last 25 minutes");
  }
  const m = q.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/);
  const yday = /\b(yesterday|last night|night before)\b/.test(q);
  if (m) {
    let h = parseInt(m[1], 10) % 12;
    if (m[3] === "p") h += 12;
    const mi = m[2] ? parseInt(m[2], 10) : 0;
    const lp = localParts(now);
    let t = localToUtc(lp.y, lp.mo, lp.d, h, mi);
    if (yday || t.getTime() > now.getTime() + 10 * 60_000) t = addDaysLocal(now, -1, h, mi);
    return clamp(new Date(t.getTime() - 20 * 60_000), new Date(t.getTime() + 60 * 60_000), `around ${fmt12(t)}`);
  }
  if (/\blast night\b/.test(q)) return clamp(addDaysLocal(now, -1, 18), addDaysLocal(now, 0, 7), "last night");
  if (/\b(this morning|morning)\b/.test(q)) return clamp(addDaysLocal(now, 0, 4), addDaysLocal(now, 0, 12), "this morning");
  if (/\bthis afternoon\b/.test(q)) return clamp(addDaysLocal(now, 0, 12), addDaysLocal(now, 0, 18), "this afternoon");
  if (/\b(this evening|tonight)\b/.test(q)) return clamp(addDaysLocal(now, 0, 17), addDaysLocal(now, 1, 0), "this evening");
  if (yday) return clamp(addDaysLocal(now, -1, 0), addDaysLocal(now, 0, 0), "yesterday");
  if (/\btoday\b/.test(q)) return clamp(addDaysLocal(now, 0, 0), now, "today so far");
  return null;
}

export function defaultScope(now: Date): Scope {
  return { start: new Date(now.getTime() - 6 * 3_600_000), end: now, note: "the last 6 hours (I did not catch when it happened)" };
}

/* ───────── names ───────── */

export const prettyId = (id: string) =>
  id.split(".").slice(1).join(".").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const nameOf = (id: string, names: Map<string, string>) => names.get(id) || prettyId(id);

const STOP = new Set(["the", "and", "when", "then", "turn", "that", "this", "with", "from", "for", "into", "off", "was", "are", "have", "has", "make", "get",
  "set", "any", "all", "every", "should", "would", "could", "after", "before", "while", "once", "again", "also", "only", "just", "than", "them", "they", "its",
  "his", "her", "our", "out", "not", "but", "can", "will", "per", "who", "what", "which", "where", "there", "here", "up", "down", "over", "under", "about",
  "came", "come", "came", "went", "slowly", "walked", "walk", "into", "ramped", "dimmed", "normal", "doesn", "don", "want", "wrong", "happened", "morning",
  "night", "yesterday", "today", "like", "read", "test", "smoke", "earlier", "understand", "changed", "change", "brightness", "level", "sometimes", "did", "didn", "does", "keeps", "keep", "why", "how", "now", "ago", "then", "still", "went", "start", "started"]);
const GENERIC = new Set(["light", "lamp", "bulb", "switch", "plug", "fan", "lock", "cover", "bright", "dim", "brighter", "dimmer", "room"]);
const CONTROLLABLE = new Set(["light", "switch", "cover", "fan", "climate", "media_player", "lock", "scene", "vacuum", "humidifier", "input_boolean", "water_heater", "siren"]);

/** Which devices the sentence is about, by words in their id / name / area. Light-hearted but deterministic. */
export function guessEntities(question: string, entities: string[][], extra: string[] = [], max = 8): string[] {
  const words = [...new Set((question.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/s$/, "")).filter((w) => !GENERIC.has(w)))];
  const wantLight = /\b(light|lights|lamp|lamps|bulb|bright|dim|dimmed|brighter|dimmer)\b/i.test(question);
  const scored: [number, string][] = [];
  for (const e of entities) {
    const [id, name = "", , area = ""] = e;
    if (typeof id !== "string") continue;
    const dom = id.split(".")[0];
    if (!CONTROLLABLE.has(dom)) continue;
    const hay = `${id} ${name} ${area}`.toLowerCase().replace(/_/g, " ");
    let s = 0;
    for (const w of words) if (hay.includes(w)) s++;
    if (!s) continue;
    if (wantLight && dom === "light") s += 0.5;
    scored.push([s, id]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out: string[] = [];
  for (const x of [...extra, ...scored.map((s) => s[1])]) if (ENTITY_RE.test(x) && !out.includes(x)) out.push(x);
  return out.slice(0, max);
}

/* ───────── YAML text (display only) ───────── */

const PLAIN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const RESERVED = /^(y|n|yes|no|on|off|true|false|null|~)$/i;
const scalar = (v: Json): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  const s = String(v);
  return PLAIN.test(s) && !RESERVED.test(s) ? s : JSON.stringify(s);
};
const nonEmpty = (v: Json) => (Array.isArray(v) ? v.length > 0 : isObj(v) && Object.keys(v).length > 0);
const inlineVal = (v: Json) => (Array.isArray(v) ? "[]" : isObj(v) ? "{}" : scalar(v));
function emit(v: Json, ind: number): string[] {
  const pad = " ".repeat(ind);
  const out: string[] = [];
  if (Array.isArray(v)) {
    for (const it of v) {
      if (nonEmpty(it)) { const sub = emit(it, ind + 2); sub[0] = pad + "- " + sub[0].slice(ind + 2); out.push(...sub); }
      else out.push(pad + "- " + inlineVal(it));
    }
    return out;
  }
  for (const [k, val] of Object.entries(v as Row)) {
    if (nonEmpty(val)) { out.push(`${pad}${scalar(k)}:`); out.push(...emit(val, ind + 2)); }
    else out.push(`${pad}${scalar(k)}: ${inlineVal(val)}`);
  }
  return out;
}
export const toYaml = (v: Json): string => emit(v, 0).join("\n") + "\n";

/** Strip Home Assistant's own tags (!secret, !include ...) so a plain YAML parser can read a file to describe it. Display only. */
export const stripHaTags = (text: string) => text.replace(/(^|[\s:\[,-])!(secret|include[a-z_]*|env_var|input)\s+/g, "$1");

/* ───────── diff ───────── */

export type DiffLine = { t: " " | "+" | "-" | "="; s: string };

export function lineDiff(a: string, b: string, ctx = 2): DiffLine[] {
  const A = a.replace(/\n$/, "").split("\n"), B = b.replace(/\n$/, "").split("\n");
  const ops: DiffLine[] = [];
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let s = 0;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  const a2 = A.slice(p, A.length - s), b2 = B.slice(p, B.length - s);
  for (let i = 0; i < p; i++) ops.push({ t: " ", s: A[i] });
  if (a2.length * b2.length > 250_000) {
    for (const x of a2) ops.push({ t: "-", s: x });
    for (const x of b2) ops.push({ t: "+", s: x });
  } else {
    const n = a2.length, m = b2.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { ops.push({ t: " ", s: a2[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: "-", s: a2[i++] });
      else ops.push({ t: "+", s: b2[j++] });
    }
    while (i < n) ops.push({ t: "-", s: a2[i++] });
    while (j < m) ops.push({ t: "+", s: b2[j++] });
  }
  for (let i = A.length - s; i < A.length; i++) ops.push({ t: " ", s: A[i] });
  // collapse long unchanged runs
  const out: DiffLine[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t !== " ") { out.push(ops[i++]); continue; }
    let j = i;
    while (j < ops.length && ops[j].t === " ") j++;
    const run = ops.slice(i, j), first = i === 0, last = j === ops.length;
    const keepHead = first ? 0 : ctx, keepTail = last ? 0 : ctx;
    if (run.length <= keepHead + keepTail + 1) out.push(...run);
    else {
      out.push(...run.slice(0, keepHead));
      const hidden = run.length - keepHead - keepTail;
      out.push({ t: "=", s: `${hidden} unchanged line${hidden === 1 ? "" : "s"}` });
      if (keepTail) out.push(...run.slice(run.length - keepTail));
    }
    i = j;
  }
  return out.slice(0, 400);
}

/* ───────── editing a package file by text ───────── */

const countOf = (text: string, needle: string) => (needle ? text.split(needle).length - 1 : 0);

/** Replace a region of a file with new text by the smallest unique edit (first changed line to last changed line, widened until it is unique). */
export function minimalEdit(fileText: string, oldRegion: string, newRegion: string): { edits?: { old: string; new: string }[]; error?: string } {
  if (countOf(fileText, oldRegion) !== 1) return { error: "That part of the file is not unique, so I could not point at it safely." };
  const o = oldRegion.split("\n"), n = newRegion.split("\n");
  let p = 0;
  while (p < o.length && p < n.length && o[p] === n[p]) p++;
  let s = 0;
  while (s < o.length - p && s < n.length - p && o[o.length - 1 - s] === n[n.length - 1 - s]) s++;
  if (p === o.length && p === n.length) return { error: "The new text is the same as the old." };
  let lo = p, hi = o.length - s, hn = n.length - s;
  // pad with a neighbouring line when a side is empty or all blank (pure insertion / deletion)
  const body = (arr: string[], a: number, b: number) => arr.slice(a, b).join("\n");
  let from = lo;
  for (let tries = 0; tries < 12; tries++) {
    const oldText = body(o, from, hi), newText = body(n, from, hn);
    const unique = oldText.trim() !== "" && countOf(fileText, oldText) === 1;
    if (unique) return { edits: [{ old: oldText, new: newText }] };
    if (from > 0 && (tries % 2 === 0 || hi >= o.length)) from--;
    else if (hi < o.length) { hi++; hn++; }
    else if (from > 0) from--;
    else break;
  }
  return { error: "I could not find a unique place to make that edit." };
}

export function applyEdits(text: string, edits: { old: string; new: string }[]): { text?: string; error?: string } {
  let work = text;
  for (let i = 0; i < edits.length; i++) {
    const { old, new: nw } = edits[i];
    const c = countOf(work, old);
    if (c !== 1) return { error: `Edit ${i + 1}: the text to replace ${c === 0 ? "was not found" : "appears " + c + " times"}.` };
    work = work.replace(old, () => nw);
  }
  return { text: work };
}

/** Top-level sections of a package file by plain text: [{key, start, end, text}] (end exclusive, in lines). */
export function fileSections(text: string): { key: string; start: number; end: number; text: string }[] {
  const lines = text.split("\n");
  const tops: [string, number][] = [];
  lines.forEach((l, i) => {
    if (!l || /^[\s#-]/.test(l)) return;
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)(?: [A-Za-z0-9_ ]+)?\s*:/);
    if (m) tops.push([m[1], i]);
  });
  return tops.map(([key, start], k) => {
    let end = k + 1 < tops.length ? tops[k + 1][1] : lines.length;
    while (end - 1 > start && !lines[end - 1].trim()) end--;
    return { key, start, end, text: lines.slice(start, end).join("\n") };
  });
}

/* ───────── checks on a proposed change ───────── */

const countTok = (t: string, tok: string) => t.toLowerCase().split(tok).length - 1;

/** The new text may not ADD a forbidden thing. What is already there stays as it is. */
export function denyAdded(oldText: string, newText: string): string | null {
  for (const d of DENY) if (countTok(newText, d) > countTok(oldText, d)) return `"${d}" is not allowed in a fix.`;
  return null;
}

const KNOWN_DOMAINS = "light|switch|sensor|binary_sensor|input_boolean|input_number|input_select|input_text|input_datetime|input_button|scene|script|automation|cover|climate|fan|lock|media_player|person|device_tracker|zone|sun|weather|group|timer|counter|number|select|button|vacuum|camera|humidifier|alarm_control_panel|water_heater|siren|remote|update|calendar|todo";
const ENTITY_IN_TEXT = new RegExp(`(?<![A-Za-z0-9_.])((?:${KNOWN_DOMAINS})\\.[a-z0-9_]+)(?![A-Za-z0-9_.])`, "g");

/** Entities the new text mentions that were not in the old text and are not in his home. */
export function newUnknownEntities(oldText: string, newText: string, known: Set<string>, services: Record<string, string[]>): string[] {
  const before = new Set([...oldText.matchAll(ENTITY_IN_TEXT)].map((m) => m[1]));
  const out = new Set<string>();
  for (const m of newText.matchAll(ENTITY_IN_TEXT)) {
    const id = m[1];
    if (before.has(id) || known.has(id)) continue;
    const [dom, name] = id.split(".");
    if ((services[dom] ?? []).includes(name)) continue;           // a service like light.turn_on
    if (/^(turn_on|turn_off|toggle|reload|set_|create|remove|update)/.test(name)) continue;
    out.add(id);
  }
  return [...out].sort();
}

export function riskReasons(newText: string, oldText: string, names: Map<string, string> = new Map()): string[] {
  const out = new Set<string>();
  const was = (re: RegExp) => re.test(oldText);
  const lockRe = /\block\.[a-z0-9_]+/i, alarmRe = /alarm_control_panel\./i;
  if (lockRe.test(newText) && !was(lockRe)) out.add("it touches a lock");
  if (alarmRe.test(newText) && !was(alarmRe)) out.add("it touches the alarm");
  for (const m of newText.matchAll(/cover\.[a-z0-9_]+/g)) {
    if (/garage|door|gate/.test(`${m[0]} ${names.get(m[0]) ?? ""}`) && !oldText.includes(m[0])) out.add("it opens or closes a garage, door or gate");
  }
  for (const m of newText.matchAll(/climate\.set_temperature[\s\S]{0,300}?temperature"?:\s*(\d+(?:\.\d+)?)/g)) {
    const t = parseFloat(m[1]);
    if ((t < 60 || t > 85) && !oldText.includes(m[0])) out.add("it sets the thermostat outside 60 to 85 degrees F");
  }
  const oldLines = oldText.split("\n").length, newLines = newText.split("\n").length;
  if (oldLines >= 12 && newLines < oldLines * 0.5) out.add("it removes more than half of the automation");
  return [...out];
}

/** Structure checks on a replacement automation / script config. Returns plain problems. */
export function checkConfig(domain: "automation" | "script" | "scene", cfg: Json): string[] {
  const errs: string[] = [];
  if (!isObj(cfg) || !Object.keys(cfg).length) return ["The new version is empty."];
  if (domain === "automation") {
    const trig = cfg.triggers ?? cfg.trigger, act = cfg.actions ?? cfg.action;
    if (!trig || (Array.isArray(trig) && !trig.length)) errs.push("The new version has no trigger, so it would never run. I never remove a trigger silently. If you want it off, I turn it off and say so.");
    if (!act || (Array.isArray(act) && !act.length)) errs.push("The new version does nothing (no action).");
  } else if (domain === "script") {
    const seq = cfg.sequence;
    if (!seq || (Array.isArray(seq) && !seq.length)) errs.push("The new version does nothing (no steps).");
  }
  return errs;
}

/** Entity ids named as targets in a config's actions (for "Fix this": which devices to look at). */
export function entityTargets(cfg: Json, max = 6): string[] {
  const out: string[] = [];
  const walk = (v: Json, depth = 0) => {
    if (depth > 12 || out.length >= max) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (!isObj(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "entity_id") {
        const list = Array.isArray(x) ? x : typeof x === "string" ? x.split(",") : [];
        for (const e of list) { const t = String(e).trim(); if (ENTITY_RE.test(t) && !out.includes(t) && out.length < max) out.push(t); }
      } else walk(x, depth + 1);
    }
  };
  walk(cfg.actions ?? cfg.action ?? cfg.sequence ?? cfg);
  return out;
}

/* ───────── one plain line per automation ───────── */

const timeOf = (v: unknown): string => {
  const s = String(v ?? "");
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return s;
  let h = parseInt(m[1], 10);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
};
const listOf = (v: Json): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
const namesList = (ids: string[], names: Map<string, string>, max = 3) => {
  const n = ids.map((i) => nameOf(i, names));
  return n.length <= max ? n.join(", ").replace(/, ([^,]*)$/, n.length > 1 ? " and $1" : ", $1") : `${n.slice(0, max).join(", ")} and ${n.length - max} more`;
};
const forText = (f: Json): string => {
  if (!f) return "";
  if (typeof f === "string") return f.replace(/^0?(\d+):(\d{2}):(\d{2})$/, (_m, h, mi, s) => (+h ? `${+h} hr ` : "") + (+mi ? `${+mi} min` : +s ? `${+s} sec` : "")).trim();
  if (isObj(f)) { const p = []; if (f.hours) p.push(`${f.hours} hr`); if (f.minutes) p.push(`${f.minutes} min`); if (f.seconds) p.push(`${f.seconds} sec`); return p.join(" "); }
  return "";
};
const stateWord = (s: Json) => (s === "on" ? "turns on" : s === "off" ? "turns off" : s === "home" ? "arrives home" : s === "not_home" ? "leaves" : s === "unavailable" ? "goes offline" : s === "open" ? "opens" : s === "closed" ? "closes" : `changes to ${s}`);

export function describeTrigger(t: Json, names: Map<string, string>): string {
  if (!isObj(t)) return "something happens";
  const kind = String(t.trigger ?? t.platform ?? "");
  const ents = listOf(t.entity_id);
  const who = ents.length ? namesList(ents, names) : "something";
  const fr = forText(t.for);
  switch (kind) {
    case "time": return `at ${listOf(t.at).map((a) => (ENTITY_RE.test(a) ? `the time set in ${nameOf(a, names)}` : timeOf(a))).join(" or ") || "a set time"}`;
    case "time_pattern": return t.minutes ? `every ${String(t.minutes).replace("/", "")} minutes` : t.hours ? `every ${String(t.hours).replace("/", "")} hours` : "on a repeating timer";
    case "sun": return `at ${t.event === "sunrise" ? "sunrise" : "sunset"}${t.offset ? ` (offset ${t.offset})` : ""}`;
    case "state": {
      const to = t.to === undefined || t.to === null ? "" : Array.isArray(t.to) ? t.to.join(" or ") : String(t.to);
      const act = to ? stateWord(to) : t.from ? `stops being ${t.from}` : "changes";
      return `${who} ${act}${fr ? ` for ${fr}` : ""}`;
    }
    case "numeric_state": return `${who} goes ${t.above !== undefined ? `above ${t.above}` : ""}${t.below !== undefined ? `${t.above !== undefined ? " and " : ""}below ${t.below}` : ""}`.trim();
    case "zone": return `${who} ${t.event === "leave" ? "leaves" : "arrives at"} ${t.zone ? nameOf(String(t.zone), names) : "a zone"}`;
    case "homeassistant": return "Home Assistant starts";
    case "event": return `the ${t.event_type ?? "an"} event happens`;
    case "webhook": return "a web hook is called";
    case "template": return "a custom check becomes true";
    case "mqtt": return "a message arrives";
    case "calendar": return "a calendar event starts";
    case "device": return `${who} reports something`;
    default: return kind ? `${kind} happens` : "something happens";
  }
}

export function describeCondition(c: Json, names: Map<string, string>): string {
  if (typeof c === "string") return "a custom check passes";
  if (!isObj(c)) return "";
  const kind = String(c.condition ?? "");
  const ents = listOf(c.entity_id);
  switch (kind) {
    case "state": return `${ents.length ? namesList(ents, names) : "something"} is ${Array.isArray(c.state) ? c.state.join(" or ") : c.state}`;
    case "time": return `it is ${c.after ? `after ${timeOf(c.after)}` : ""}${c.after && c.before ? " and " : ""}${c.before ? `before ${timeOf(c.before)}` : ""}${c.weekday ? ` on ${listOf(c.weekday).join(", ")}` : ""}`.trim();
    case "sun": return `the sun is ${c.after ? "up after " + c.after : c.before ? "down before " + c.before : "in a set position"}`;
    case "numeric_state": return `${ents.length ? namesList(ents, names) : "a value"} is ${c.above !== undefined ? `above ${c.above}` : ""}${c.below !== undefined ? `${c.above !== undefined ? " and " : ""}below ${c.below}` : ""}`;
    case "not": return `not (${(Array.isArray(c.conditions) ? c.conditions : []).map((x: Json) => describeCondition(x, names)).filter(Boolean).join(" and ")})`;
    case "or": return (Array.isArray(c.conditions) ? c.conditions : []).map((x: Json) => describeCondition(x, names)).filter(Boolean).join(" or ");
    case "and": return (Array.isArray(c.conditions) ? c.conditions : []).map((x: Json) => describeCondition(x, names)).filter(Boolean).join(" and ");
    case "zone": return `${ents.length ? namesList(ents, names) : "someone"} is in ${c.zone ? nameOf(String(c.zone), names) : "a zone"}`;
    case "template": return "a custom check passes";
    default: return "";
  }
}

const VERBS: Record<string, string> = {
  turn_on: "turns on", turn_off: "turns off", toggle: "toggles", open_cover: "opens", close_cover: "closes", lock: "locks", unlock: "unlocks",
  media_play: "plays", media_pause: "pauses", media_stop: "stops", volume_set: "sets the volume of", play_media: "plays media on", set_temperature: "sets the temperature of",
  select_option: "chooses an option for", set_value: "sets", increment: "adds one to", reset: "resets", start: "starts", cancel: "cancels", finish: "finishes",
};

export function describeAction(a: Json, names: Map<string, string>): string {
  if (!isObj(a)) return "";
  if (a.delay !== undefined) {
    const d = a.delay;
    const t = isObj(d) ? forText(d) : typeof d === "string" ? forText(d) : typeof d === "number" ? `${d} sec` : "a moment";
    return `waits ${t}`;
  }
  if (a.wait_template !== undefined || a.wait_for_trigger !== undefined) return "waits until something happens";
  if (a.choose !== undefined) return `picks one of ${Array.isArray(a.choose) ? a.choose.length : "several"} paths${a.default ? " (with a fallback)" : ""}`;
  if (a.if !== undefined) return "checks a condition, then acts";
  if (a.repeat !== undefined) return "repeats some steps";
  if (a.parallel !== undefined) return "does several things at once";
  if (a.event !== undefined) return `sends the ${a.event} event`;
  if (a.stop !== undefined) return "stops";
  if (a.variables !== undefined) return "";
  if (a.scene !== undefined) return `sets the ${nameOf(String(a.scene), names)} scene`;
  const svc = String(a.action ?? a.service ?? "");
  if (!svc) return "";
  const [dom, name] = svc.split(".");
  const tgt = [...listOf(a.target?.entity_id), ...listOf(a.entity_id), ...listOf(a.data?.entity_id)];
  const data = isObj(a.data) ? a.data : {};
  const bits: string[] = [];
  const bri = data.brightness_pct ?? (data.brightness !== undefined ? Math.round((Number(data.brightness) / 255) * 100) : undefined);
  if (bri !== undefined && Number.isFinite(Number(bri))) bits.push(`${bri}% brightness`);
  if (data.transition !== undefined) bits.push(`fading over ${data.transition} sec`);
  if (data.color_temp_kelvin !== undefined) bits.push(`${data.color_temp_kelvin} K`);
  if (data.temperature !== undefined && dom === "climate") bits.push(`${data.temperature} °F`);
  const withBits = bits.length ? ` (${bits.join(", ")})` : "";
  if (dom === "scene" && name === "turn_on") return `sets ${tgt.length ? namesList(tgt, names) : "a scene"}`;
  if (dom === "script") return `runs ${name === "turn_on" ? (tgt.length ? namesList(tgt, names) : "a script") : prettyId(svc)}`;
  if (dom === "notify") return "sends a notification";
  if (dom === "persistent_notification") return "posts a notice in Home Assistant";
  if (dom === "tts" || svc.includes("announce")) return "says something out loud";
  if (dom === "automation") return `${name === "turn_off" ? "turns off" : name === "turn_on" ? "turns on" : name === "trigger" ? "runs" : "controls"} ${tgt.length ? namesList(tgt, names) : "an automation"}`;
  if (dom === "homeassistant" && name === "turn_off") return `turns off ${tgt.length ? namesList(tgt, names) : "things"}`;
  if (dom === "homeassistant" && name === "turn_on") return `turns on ${tgt.length ? namesList(tgt, names) : "things"}`;
  const verb = VERBS[name] ?? `calls ${svc}`;
  return `${verb}${tgt.length ? " " + namesList(tgt, names) : a.target?.area_id ? " everything in " + listOf(a.target.area_id).join(", ") : ""}${withBits}`.trim();
}

/** "At 6:00 AM, Bathroom Light turns on. Only if Sexy Time is off. Then turns on Bathroom Light (100% brightness) and waits 5 min." */
export function describeConfig(cfg: Json, names: Map<string, string>, kind: "automation" | "script" = "automation"): string {
  if (!isObj(cfg)) return "";
  const parts: string[] = [];
  if (kind === "automation") {
    const trig = [cfg.triggers ?? cfg.trigger].flat().filter(Boolean);
    const when = trig.slice(0, 2).map((t) => describeTrigger(t, names));
    if (when.length) {
      const first = when[0][0].toUpperCase() + when[0].slice(1);
      parts.push(`${/^(at|every)\b/i.test(when[0]) ? "" : "When "}${first}${when[1] ? `, or ${when[1]}` : ""}${trig.length > 2 ? `, or ${trig.length - 2} more` : ""}`);
    }
    const cond = [cfg.conditions ?? cfg.condition].flat().filter(Boolean).slice(0, 2).map((c) => describeCondition(c, names)).filter(Boolean);
    if (cond.length) parts.push(`only if ${cond.join(" and ")}`);
  }
  const acts = [(kind === "script" ? cfg.sequence : cfg.actions ?? cfg.action)].flat().filter(Boolean);
  const said = acts.map((a) => describeAction(a, names)).filter(Boolean);
  if (said.length) {
    const shown = said.slice(0, 4).join(", then ");
    parts.push(`${kind === "script" ? "" : "then "}${shown}${said.length > 4 ? `, and ${said.length - 4} more steps` : ""}`);
  }
  let line = parts.join(", ");
  if (!line) return "";
  line = line.charAt(0).toUpperCase() + line.slice(1);
  if (line.length > 260) line = line.slice(0, line.lastIndexOf(" ", 250)) + " and more";
  return line + ".";
}

/* ───────── what Home Assistant recorded, as a short story for the model and a timeline for Jared ───────── */

export type TimelineItem = { t: string; text: string; at: number };

function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

/** history series [time, state, brightness %, kelvin, position] -> short lines. */
export function historyLines(series: Json[][], max = 14): string[] {
  const rows = series.filter((r) => Array.isArray(r));
  const pick = sample(rows, max);
  return pick.map((r) => {
    const bits = [String(r[1])];
    if (r[2] !== null && r[2] !== undefined) bits.push(`${r[2]}%`);
    if (r[3]) bits.push(`${r[3]} K`);
    if (r[4] !== null && r[4] !== undefined && r[2] === null) bits.push(`${r[4]}%`);
    return `${fmt12(r[0], { sec: true })} ${bits.join(" ")}`;
  });
}

export function buildTimeline(ev: Row, names: Map<string, string>, max = 16): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const r of Array.isArray(ev.logbook) ? ev.logbook : []) {
    const at = Date.parse(r.when);
    if (!Number.isFinite(at)) continue;
    const who = r.context_entity_id_name || r.context_name || (r.context_domain && r.context_service ? `${r.context_domain}.${r.context_service}` : "");
    const what = r.entity_id && /^(automation|script)\./.test(r.entity_id) ? `${r.name ?? nameOf(r.entity_id, names)} ${r.message ?? "ran"}`
      : `${r.name ?? nameOf(String(r.entity_id ?? "something"), names)} ${r.message ?? (r.state ? "became " + r.state : "changed")}`;
    items.push({ at, t: fmt12(r.when, { sec: true }), text: `${what}${who ? ` (started by ${who})` : ""}`.replace(/\s+/g, " ").slice(0, 200) });
  }
  const hist: Row = isObj(ev.history) ? ev.history : {};
  for (const [eid, series] of Object.entries(hist)) {
    if (!Array.isArray(series)) continue;
    const rows = series as Json[][];
    // brightness steps worth a line: first, biggest jumps and the last
    const sig = rows.filter((r, i) => i === 0 || i === rows.length - 1 || (r[2] !== null && rows[i - 1][2] !== null && Math.abs(Number(r[2]) - Number(rows[i - 1][2])) >= 15) || r[1] !== rows[i - 1][1]);
    for (const r of sample(sig, 6)) {
      const at = Date.parse(r[0]);
      if (!Number.isFinite(at)) continue;
      items.push({ at, t: fmt12(r[0], { sec: true }), text: `${nameOf(eid, names)} is ${r[1]}${r[2] !== null && r[2] !== undefined ? ` at ${r[2]}% brightness` : ""}` });
    }
  }
  items.sort((a, b) => a.at - b.at);
  // drop exact duplicates, keep the order
  const seen = new Set<string>();
  const uniq = items.filter((i) => { const k = `${i.t}|${i.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return sample(uniq, max);
}

const cleanBlock = (b: string) => b.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).join("\n");

export type Suspect = { key: string; kind: string; entity_id: string | null; name: string; where: string; file: string | null; id: string | null; fired: boolean; last_run: string; hits: string[]; hash: string | null };

/** The evidence as a compact text for the model (about 9,000 characters at most) and the list of things it can point at. */
export function digestEvidence(question: string, ev: Row, names: Map<string, string>, budget = 9000): { text: string; suspects: Suspect[]; sections: { key: string; file: string; section: string; text: string }[] } {
  const lines: string[] = [];
  const w = ev.window ?? {};
  lines.push(`Question: ${question}`);
  lines.push(`Window looked at: ${fmt12(w.start, { date: true })} to ${fmt12(w.end, { date: true })} (Pacific, 12-hour)`);
  const ents: Row = isObj(ev.entities) ? ev.entities : {};
  for (const [id, e] of Object.entries(ents)) lines.push(`Device ${id} "${e?.name ?? nameOf(id, names)}" now ${e?.state ?? "missing"}${e?.brightness_pct !== null && e?.brightness_pct !== undefined ? ` ${e.brightness_pct}%` : ""}${e?.area ? ` in ${e.area}` : ""}`);
  const hist: Row = isObj(ev.history) ? ev.history : {};
  for (const [id, s] of Object.entries(hist)) if (Array.isArray(s) && s.length) lines.push(`History of ${id} (${s.length} changes): ${historyLines(s as Json[][]).join(" | ")}`);
  const lb = (Array.isArray(ev.logbook) ? ev.logbook : []).slice(-60);
  if (lb.length) {
    lines.push("Logbook (what Home Assistant recorded; 'by' is what started it):");
    for (const r of lb) {
      const by = r.context_entity_id_name || r.context_name || r.context_service || "";
      lines.push(`  ${fmt12(r.when, { sec: true })} ${r.name ?? r.entity_id ?? ""} ${r.message ?? r.state ?? ""}${by ? ` [by ${by}]` : ""}`.replace(/\s+/g, " ").slice(0, 190));
    }
  }
  const rel: Row = isObj(ev.related) ? ev.related : {};
  for (const [id, r] of Object.entries(rel).slice(0, 8)) {
    const attrs = isObj(r.attrs) ? Object.entries(r.attrs).slice(0, 8).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ") : "";
    lines.push(`Related ${id} "${r.name ?? ""}" is ${r.state} and lists ${Array.isArray(r.lists) ? r.lists.join(", ") : ""}; ${attrs}`.slice(0, 380));
  }
  const fired = (Array.isArray(ev.fired_in_window) ? ev.fired_in_window : []).map((f: Row) => `${f.name ?? f.entity_id} at ${fmt12(f.last_triggered, { sec: true })}`);
  if (fired.length) lines.push(`Automations and scripts that ran in the window: ${fired.join("; ")}`);
  for (const n of Array.isArray(ev.notes) ? ev.notes : []) lines.push(`Note: ${n}`);

  const suspects: Suspect[] = [];
  const refs: Row[] = Array.isArray(ev.referrers) ? ev.referrers : [];
  refs.slice(0, 10).forEach((r, i) => {
    const key = `K${i + 1}`;
    suspects.push({
      key, kind: String(r.kind ?? "automation"), entity_id: r.entity_id ?? null, name: String(r.name ?? r.entity_id ?? key), where: String(r.where ?? "unknown"),
      file: r.file ?? null, id: r.id ?? null, fired: r.fired === true, last_run: r.last_triggered ? fmt12(r.last_triggered, { date: true }) : "", hits: Array.isArray(r.hits) ? r.hits.slice(0, 6) : [],
      hash: typeof r.hash === "string" ? r.hash : null,
    });
  });
  const traceBy = new Map<string, Row[]>();
  for (const t of Array.isArray(ev.traces) ? ev.traces : []) { const a = traceBy.get(t.entity_id) ?? []; a.push(t); traceBy.set(t.entity_id, a); }
  const room = Math.max(1800, budget - lines.join("\n").length - 600);
  const per = Math.floor(room / Math.max(1, Math.min(refs.length, 10)));
  refs.slice(0, 10).forEach((r, i) => {
    const s = suspects[i];
    const head = `${s.key} ${s.kind} "${s.name}" (${s.where === "package" ? "in file " + s.file : s.where}) ${s.fired ? "RAN in the window" : "did not run in the window"}${s.last_run ? `, last ran ${s.last_run}` : ""}; mentions ${s.hits.join(", ")}`;
    const body = r.cfg !== undefined ? JSON.stringify(r.cfg) : r.cfg_text ? String(r.cfg_text) : cleanBlock(String(r.block ?? ""));
    const cap = s.fired ? Math.round(per * 1.5) : Math.round(per * 0.6);
    lines.push(head, body.length > cap ? body.slice(0, cap) + " [cut for size]" : body);
    for (const t of (traceBy.get(r.entity_id) ?? []).slice(-2)) {
      const steps = (Array.isArray(t.steps) ? t.steps : []).filter((x: Row) => x.do || x.why || x.error).slice(0, 5).map((x: Row) => `${x.path}: ${x.why ?? x.do ?? x.error}`).join(" ; ");
      lines.push(`  trace ${fmt12(t.started, { sec: true })} ${t.state ?? ""} ${t.error ? "ERROR " + t.error : ""} ${steps}`.replace(/\s+/g, " ").slice(0, 700));
    }
  });
  // the non-automation parts of the package files that mention these devices (adaptive lighting, templates, light groups ...)
  const sections: { key: string; file: string; section: string; text: string }[] = [];
  const tokens = Object.keys(ents);
  const pf: Row = isObj(ev.package_files) ? ev.package_files : {};
  for (const [file, f] of Object.entries(pf)) {
    if (!f || typeof f.text !== "string") continue;
    for (const sec of fileSections(f.text)) {
      if (["automation", "script"].includes(sec.key)) continue;
      if (!tokens.some((t) => sec.text.includes(t)) && !/adaptive_lighting|template|light|group/.test(sec.key)) continue;
      if (sec.text.length > 3500) continue;
      if (sections.length >= 3) break;
      sections.push({ key: `S${sections.length + 1}`, file, section: sec.key, text: sec.text });
    }
  }
  for (const s of sections) lines.push(`${s.key} section "${s.section}" of file ${s.file} (not an automation):\n${cleanBlock(s.text).slice(0, 1400)}`);
  return { text: lines.join("\n").slice(0, budget + 1500), suspects, sections };
}

/* ───────── what the model gives back ───────── */

export function normalizeDiagnosis(j: Json, keys: Set<string>): { story: string[]; culprit: string | null; also: string[]; confidence: "high" | "medium" | "low"; cause: string; unsure: string } | string {
  if (!isObj(j)) return "The answer was not a JSON object.";
  const story = strList(j.story, 8, 400);
  if (!story.length) return "story needs 2 to 7 plain sentences.";
  let culprit = typeof j.culprit === "string" ? j.culprit.trim().toUpperCase() : null;
  if (culprit && !keys.has(culprit)) culprit = null;
  const also = strList(j.also, 4, 6).map((x) => x.toUpperCase()).filter((x) => keys.has(x) && x !== culprit);
  const c = String(j.confidence ?? "").toLowerCase();
  return { story, culprit, also, confidence: c === "high" || c === "medium" ? c : "low", cause: str(j.cause, 400), unsure: str(j.unsure, 300) };
}

/** Times in 24-hour form ("06:02") or metric units in a sentence Jared will read. */
export function houseRuleProblems(lines: string[]): string[] {
  const out: string[] = [];
  const joined = lines.join(" ");
  if (/\b([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?\b(?!\s?[AaPp]\.?[Mm])/.test(joined)) out.push("write every time as 6:02 AM (12-hour with AM or PM), never 24-hour");
  if (/\b\d+(\.\d+)?\s?(°\s?C|celsius|km\/h|kph|kilomet|meters?\b|\bkg\b)/i.test(joined)) out.push("use US units (degrees F, feet, miles, mph)");
  return out;
}
