// deno test --no-lock --node-modules-dir=none supabase/functions/_shared/chat-memory.test.ts
import { briefBlock, BRIEF_CHARS, type ChatBrief, followUpRewrite, isFollowUpPhrase, resultDigest, stripOptions } from "./chat-memory.ts";

const eq = (a: unknown, b: unknown, msg: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v: unknown, msg: string) => { if (!v) throw new Error(msg); };

// The real admin-chat cleanOption (duplicated here, not imported - index.ts has no exports): trims separators,
// collapses whitespace and drops a trailing "." or "…". stripOptions dedupes AFTER this runs, same as adhdShape.
const cleanOption = (o: unknown) => String(o ?? "").replace(/[|\n]/g, " ").replace(/\s+/g, " ").replace(/[.…]+$/, "").trim();

Deno.test("isFollowUpPhrase - the exact words that dropped thread d42608b1's run", () => {
  ok(isFollowUpPhrase("continue"), "continue");
  ok(isFollowUpPhrase("try now"), "try now");
  ok(isFollowUpPhrase("Try again."), "Try again.");
  ok(isFollowUpPhrase("any luck?"), "any luck?");
  ok(isFollowUpPhrase("  keep going  "), "keep going, padded");
});

Deno.test("isFollowUpPhrase - a real new ask is never a follow-up", () => {
  ok(!isFollowUpPhrase("Let's do this improvement from The Improver: Route high-failure free AI agents to local LLM fallback"), "improver ask");
  ok(!isFollowUpPhrase("what's the status of the Turo fleet"), "a question");
  ok(!isFollowUpPhrase(""), "empty");
});

Deno.test("followUpRewrite - carries the live goal and next step; raw text stays what gets stored", () => {
  const brief: ChatBrief = { goal: "Route high-failure free AI agents to local LLM fallback", open: ["update free-llm.ts routing"] };
  eq(followUpRewrite("continue", brief), "continue = keep working on: Route high-failure free AI agents to local LLM fallback. Next: update free-llm.ts routing.", "rewrite with goal+open");
});

Deno.test("followUpRewrite - no brief goal yet: leaves the raw text alone", () => {
  eq(followUpRewrite("try now", null), "try now", "null brief");
  eq(followUpRewrite("try now", {}), "try now", "empty brief");
});

Deno.test("briefBlock - empty without a goal, built and capped with one", () => {
  eq(briefBlock(null), "", "null");
  eq(briefBlock({}), "", "no goal");
  const big: ChatBrief = { goal: "x", facts: Array.from({ length: 50 }, (_, i) => `fact ${i} `.repeat(20)) };
  const block = briefBlock(big);
  ok(block.includes("Goal: x"), "keeps the goal line");
  ok(block.length <= BRIEF_CHARS + 60, `block was ${block.length} chars, cap is ${BRIEF_CHARS}`);
});

Deno.test("briefBlock - a section only appears when it has items", () => {
  const block = briefBlock({ goal: "g", done: ["did a thing"] });
  ok(block.includes("Done:\n- did a thing"), "has Done");
  ok(!block.includes("Open:"), "no empty Open section");
  ok(!block.includes("Decisions:"), "no empty Decisions section");
});

Deno.test("resultDigest - read_file/run_sql/search_code/db_write, item D", () => {
  eq(resultDigest("read_file", { ok: true, path: "a.ts", content: "l1\nl2\nl3" }), "a.ts (3 lines)", "read_file");
  eq(resultDigest("run_sql", { ok: true, rows: [{ id: 1 }, { id: 2 }] }), '2 rows, first: {"id":1}', "run_sql rows");
  eq(resultDigest("run_sql", { ok: true, rows: [] }), "0 rows", "run_sql empty");
  eq(resultDigest("search_code", { ok: true, name_hits: [{ path: "a.ts" }], content_hits: [{ path: "b.ts" }] }), "a.ts, b.ts", "search_code hits");
  eq(resultDigest("search_code", { ok: true, name_hits: [], content_hits: [] }), "no matches", "search_code empty");
  eq(resultDigest("db_write", { ok: true, count: 1 }), "1 row(s)", "db_write");
  eq(resultDigest("read_file", { ok: false, error: "nope" }), "", "failed call");
  eq(resultDigest("send_email", { ok: true }), "", "no digest for this tool");
});

// The real reply from thread d42608b1 at 2026-11-01 16:09:30 PT: an OPTIONS: fragment buried mid-sentence
// ("...for high-failure free-AI agents. OPTIONS: ... first.") that the old line-start-only regex never touched,
// plus the real final OPTIONS: line - so Jared saw OPTIONS printed twice.
const REAL_4_09_REPLY = "Add a local Ollama LLM provider named “local‑llm” (enabled, private_ok true) to llm_providers. This lets the free‑AI agent workflow fall back to the Pi’s local model when high‑failure routes occur. \n\nNext step: update the routing logic to use this new provider for high‑failure free‑AI agents. OPTIONS: Update routing code now | Review routing logic first.\n\nOPTIONS: Update routing code now | Review routing logic first";

Deno.test("stripOptions - de-dupes the real double-OPTIONS reply from thread d42608b1 (item F)", () => {
  const { body, options } = stripOptions(REAL_4_09_REPLY, cleanOption);
  ok(!body.includes("OPTIONS:"), `body still has a stray OPTIONS: fragment:\n${body}`);
  eq(options, ["Update routing code now", "Review routing logic first"], "merged + deduped options");
  ok(body.includes("Next step: update the routing logic"), "keeps the real sentence, just not the embedded OPTIONS:");
});

Deno.test("stripOptions - a mid-sentence OPTIONS with no line-start one is still caught", () => {
  const { body, options } = stripOptions("Done already. OPTIONS: Yes | No");
  eq(body, "Done already.", "mid-sentence stripped");
  eq(options, ["Yes", "No"], "options still extracted");
});

Deno.test("stripOptions - no OPTIONS: at all is a no-op", () => {
  const { body, options } = stripOptions("Just a plain reply.");
  eq(body, "Just a plain reply.", "unchanged");
  eq(options, [], "no options");
});
