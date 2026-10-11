#!/usr/bin/env node
// Bestly Agent demo audio builder. See README.md in this folder.
//
//   node tools/agent-demo-audio/build.mjs sql [id] [--force]   print the SQL that records scenarios whose text changed
//   node tools/agent-demo-audio/build.mjs [id] [--force]       download the recorded clips and write public/agent-demo/<id>.mp3 + .json
//   node tools/agent-demo-audio/build.mjs check                verify the written files (durations, ordering, plausibility)
//
// Idempotent: each JSON carries a hash of the voice ids + spoken texts; scenarios whose hash is unchanged are skipped.
// No npm dependencies: esbuild (already in node_modules) reads src/components/agentDemo/scenarios.ts, ffmpeg/ffprobe do the audio.
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(join(root, "package.json"));
const esbuild = require("esbuild");

const SUPABASE_URL = "https://rcqfqhguwpmaarseifqg.supabase.co";
const BUCKET_URL = `${SUPABASE_URL}/storage/v1/object/public/agent-demo`;
const OUT_DIR = join(root, "public/agent-demo");
const CLIPS_DIR = join(here, "clips"); // downloaded clips (not committed)
const MODEL = "eleven_v4"; // one model for every line. Voices must be fine-tuned for it (checked with the edge function's "voice" op).
const REC_FORMAT = "mp3_44100_128"; // what ElevenLabs records; the final web files are encoded once at WEB_KBPS.
const WEB_KBPS = "96k";
const LEAD_IN_S = 0.25;
const RATE = 44100;
const BYTES_PER_S = RATE * 2; // mono s16le

async function loadScenarios() {
  const src = readFileSync(join(root, "src/components/agentDemo/scenarios.ts"), "utf8");
  const js = esbuild.transformSync(src, { loader: "ts", format: "esm" }).code;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

const spoken = (l) => l.say ?? l.text;
const voiceFor = (s, l, MAYA) => (l.who === "agent" ? MAYA : s.caller.voiceId);
const hashOf = (s, MAYA) =>
  createHash("sha256").update(MODEL + "\n" + s.lines.map((l) => `${voiceFor(s, l, MAYA)}|${spoken(l)}`).join("\n")).digest("hex");
const existingHash = (id) => {
  try { return JSON.parse(readFileSync(join(OUT_DIR, `${id}.json`), "utf8")).hash; } catch { return null; }
};

function run(cmd, args, input) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("close", (code) => (code === 0 ? res(Buffer.concat(out)) : rej(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString().slice(-300)}`))));
    p.stdin.on("error", () => {});
    p.stdin.end(input);
  });
}
const decode = (file) => run("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(RATE), "pipe:1"]);

async function download(url, file) {
  const r = await fetch(`${url}?t=${Date.now()}`); // cache-bust: a re-recording overwrites the same Storage path
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** Words of the spoken text with the second each one starts, from ElevenLabs character timing. */
function alignedStarts(align) {
  const a = align?.alignment;
  if (!a?.characters || !a.character_start_times_seconds) return null;
  const starts = [];
  let inWord = false;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) inWord = false;
    else if (!inWord) { inWord = true; starts.push(a.character_start_times_seconds[i]); }
  });
  return starts;
}

async function buildOne(mod, s) {
  const { MAYA_VOICE_ID, TURN_GAP_S } = mod;
  const dir = join(CLIPS_DIR, s.id, hashOf(s, MAYA_VOICE_ID).slice(0, 10)); // keyed by hash, so stale clips are never reused
  mkdirSync(dir, { recursive: true });
  const chunks = [Buffer.alloc(Math.round(LEAD_IN_S * RATE) * 2)];
  let cursor = LEAD_IN_S;
  const lines = [];
  for (let n = 0; n < s.lines.length; n++) {
    const l = s.lines[n];
    const mp3 = join(dir, `${n}.mp3`), aj = join(dir, `${n}.json`);
    if (!existsSync(mp3)) await download(`${BUCKET_URL}/${s.id}/${n}.mp3`, mp3);
    if (!existsSync(aj)) await download(`${BUCKET_URL}/${s.id}/${n}.json`, aj);
    const pcm = await decode(mp3);
    const dur = pcm.length / BYTES_PER_S;
    if (dur < 0.3) throw new Error(`${s.id} line ${n} is empty (${dur.toFixed(2)}s)`);
    const entry = { start: +cursor.toFixed(3), end: +(cursor + dur).toFixed(3) };
    if (l.say == null) {
      const starts = alignedStarts(JSON.parse(readFileSync(aj, "utf8")));
      const ws = l.text.split(" ").filter(Boolean);
      if (starts && starts.length === ws.length) {
        entry.words = ws.map((w, i) => ({ w, start: +(cursor + starts[i]).toFixed(3) }));
      } else console.warn(`  note: ${s.id} line ${n}: ${starts ? starts.length : 0} aligned words vs ${ws.length} shown, words omitted`);
    }
    lines.push(entry);
    chunks.push(pcm);
    cursor += dur;
    if (n < s.lines.length - 1) { chunks.push(Buffer.alloc(Math.round(TURN_GAP_S * RATE) * 2)); cursor += TURN_GAP_S; }
  }
  mkdirSync(OUT_DIR, { recursive: true });
  // One encode of the whole call, so the file is a single consistent mono 64 kbps / 44.1 kHz mp3.
  const mp3 = await run("ffmpeg", ["-v", "error", "-f", "s16le", "-ar", String(RATE), "-ac", "1", "-i", "pipe:0",
    "-c:a", "libmp3lame", "-b:a", WEB_KBPS, "-ar", String(RATE), "-ac", "1", "-f", "mp3", "pipe:1"], Buffer.concat(chunks));
  writeFileSync(join(OUT_DIR, `${s.id}.mp3`), mp3);
  const duration = +(Buffer.concat(chunks).length / BYTES_PER_S).toFixed(3);
  writeFileSync(join(OUT_DIR, `${s.id}.json`),
    JSON.stringify({ id: s.id, hash: hashOf(s, MAYA_VOICE_ID), duration, gap: TURN_GAP_S, lines }) + "\n");
  console.log(`built ${s.id}: ${s.lines.length} lines, ${duration.toFixed(1)}s`);
}

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  return parseFloat(r.stdout);
}

async function check(mod) {
  let bad = 0;
  for (const s of mod.SCENARIOS) {
    const jf = join(OUT_DIR, `${s.id}.json`), mf = join(OUT_DIR, `${s.id}.mp3`);
    if (!existsSync(jf) || !existsSync(mf)) { console.log(`MISSING ${s.id}`); bad++; continue; }
    const j = JSON.parse(readFileSync(jf, "utf8"));
    const real = probe(mf);
    const notes = [];
    if (Math.abs(real - j.duration) > 0.1) notes.push(`mp3 ${real.toFixed(2)}s vs json ${j.duration}s`);
    if (j.lines.length !== s.lines.length) notes.push("line count differs");
    if (j.hash !== hashOf(s, mod.MAYA_VOICE_ID)) notes.push("stale hash (text changed)");
    if (j.duration < 20) notes.push("too short");
    j.lines.forEach((ln, i) => {
      const words = Math.max(spoken(s.lines[i]).split(" ").length, 4);
      const d = ln.end - ln.start, wps = words / d;
      if (i > 0 && ln.start <= j.lines[i - 1].start) notes.push(`line ${i} start not increasing`);
      if ((wps < 1.5 && d > 4) || wps > 5) notes.push(`line ${i}: ${words} words in ${d.toFixed(2)}s (${wps.toFixed(1)} w/s)`);
    });
    console.log(`${notes.length ? "WARN" : "ok  "} ${s.id}: ${j.duration}s, ${j.lines.length} lines, ${statSync(mf).size} bytes${notes.length ? "\n   " + notes.join("\n   ") : ""}`);
    bad += notes.length ? 1 : 0;
  }
  process.exit(bad ? 1 : 0);
}

const args = process.argv.slice(2);
const cmd = ["sql", "check"].includes(args[0]) ? args.shift() : "build";
const force = args.includes("--force");
const only = args.find((a) => !a.startsWith("--"));
const mod = await loadScenarios();
const todo = mod.SCENARIOS.filter((s) => !only || s.id === only);
if (only && !todo.length) { console.error(`no scenario "${only}"`); process.exit(1); }

if (cmd === "check") await check(mod);
else if (cmd === "sql") {
  for (const s of todo) {
    if (!force && existingHash(s.id) === hashOf(s, mod.MAYA_VOICE_ID)) { console.log(`-- ${s.id}: unchanged, skipped`); continue; }
    const payload = { id: s.id, model: MODEL, format: REC_FORMAT, lines: s.lines.map((l, n) => ({ n, voiceId: voiceFor(s, l, mod.MAYA_VOICE_ID), text: spoken(l) })) };
    const chars = payload.lines.reduce((a, l) => a + l.text.length, 0);
    console.log(`-- ${s.id}: ${chars} characters of speech`);
    console.log(`select public.invoke_edge_function('agent-demo-tts', $j$${JSON.stringify(payload)}$j$::jsonb, 120000);`);
    console.log(`-- then: select status_code, content from net._http_response where id = <the id above>;`);
  }
} else {
  for (const s of todo) {
    if (!force && existingHash(s.id) === hashOf(s, mod.MAYA_VOICE_ID)) { console.log(`skip ${s.id} (unchanged)`); continue; }
    await buildOne(mod, s);
  }
}
