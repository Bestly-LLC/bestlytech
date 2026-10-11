// Offline tests for the v44 final-answer gate (rawToolJson / narratesStep / thinkingLeak). No network, no secrets.
//   deno test --no-lock --node-modules-dir=none supabase/functions/_shared/free-llm.leak.test.ts
import { narratesStep, rawToolJson, thinkingLeak } from "./free-llm.ts";

const gate = (t: string) => rawToolJson(t) || narratesStep(t);
const eq = (a: unknown, b: unknown, msg: string) => { if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`); };

// The original 10 strings from the first review: same verdicts as before.
const ORIGINAL: [string, boolean][] = [
  ["We need to see where Live Activity is started. Look in shared folder.\n{\n  \"repo\": \"site\",\n  \"path\": \"ios/BestlySky/Shared\"\n}\n\nOPTIONS: Show me the files | Open", true],
  ["{\n  \"repo\": \"site\",\n  \"find\": \"Myth: you'd know\"\n}\n\nOPTIONS: Show me first | Keep going", true],
  ["We’re in the site repo iOS code: AircraftLiveActivity.swift hardcodes widgetURL to bestlysky://checkin so we can read it", false],
  ["We need to see the columns of client_asks to understand structure. Let's query information_schema.\nWe need to fetch", true],
  ["assistantcommentary to=functions.read_file json{\"path\":\"x\"}", true],
  ["Three trips start this week: Blue Steel Tue, Wed and Fri. Earnings are $412.", false],
  ["Let's go with Friday for the call. I'll send the invite.", false],
  ["I checked the build: it passed at 4:12 PM and the deploy is live.", false],
  ["We need to renew the Apple cert by Friday; it expires Sunday.", false],
  ["{\"ok\":true}", false],
];
Deno.test("original 10 strings behave the same", () => {
  for (const [t, want] of ORIGINAL) eq(gate(t), want, JSON.stringify(t.slice(0, 50)));
});

Deno.test("a requested fenced JSON config passes untouched", () => {
  const cfg = '```json\n{\n  "name": "scout-daily",\n  "id": 7,\n  "path": "/admin",\n  "input": {"mode": "dry"}\n}\n```';
  eq(rawToolJson(cfg), false, "fenced config alone");
  eq(gate(cfg), false, "fenced config gate");
  eq(rawToolJson("Here is the config you asked for:\n" + cfg), false, "fenced config with intro");
  eq(gate("Let's look at it. Here is the payload:\n" + cfg), false, "narration-like intro + fence is still an answer");
  eq(rawToolJson(cfg + "\n\nOPTIONS: Looks right | Change the id"), false, "fenced config with options line");
  eq(rawToolJson('```\n{"repo":"site","path":"a.ts"}\n```'), false, "fenced arguments-shaped block is data Jared asked to see");
});

Deno.test("unfenced JSON with ordinary keys is an answer, not a tool call", () => {
  eq(rawToolJson('{"name":"Blue Steel","id":42,"path":"Tue"}'), false, "ordinary keys");
  eq(rawToolJson('{"name": "Maya", "input": "voice"}'), false, "name + input without a known tool");
  eq(gate('Config is {"name":"x","id":1} and that is the whole thing.'), false, "inline config");
});

Deno.test("a bare tool call written as text is caught", () => {
  eq(rawToolJson('{"tool":"read_file","args":{"repo":"site","path":"src/App.tsx"}}'), true, "tool+args");
  eq(rawToolJson('{"name":"read_file","arguments":{"repo":"site","path":"a.ts"}}'), true, "known tool name");
  eq(rawToolJson('{"function":{"name":"run_sql","arguments":"{\\"sql\\":\\"select 1\\"}"}}'), true, "openai style");
  eq(rawToolJson('{"tool":"read_file","args":{"repo":"site","path":"a.ts"}}\n\nOPTIONS: Show me | Open it'), true, "tool call + options");
  eq(rawToolJson("{'tool': 'search_code', 'args': {'query': 'x'},}"), false, "single-quote JSON has no double-quoted keys: left to the narration/nudge paths");
  eq(rawToolJson('{"tool":"read_file", "args": {"path": "a.ts",}}'), true, "malformed JSON still caught");
  eq(rawToolJson('```json\n{"tool":"read_file","args":{"path":"a.ts"}}\n```'), true, "whole reply is a fenced tool call");
  eq(rawToolJson('[{"tool":"list_files","args":{"repo":"site"}}]'), true, "array of calls");
});

Deno.test("thinkingLeak still flags the same raw leaks when no tools are offered", () => {
  eq(thinkingLeak('{"tool":"read_file","args":{"path":"a"}}'), true, "raw call");
  eq(thinkingLeak('```json\n{"name":"x","id":1}\n```'), false, "fenced config");
});
