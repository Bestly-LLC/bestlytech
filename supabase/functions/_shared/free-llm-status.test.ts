// Offline tests for the "every free rung failed" message. No network, no secrets.
//   deno test --no-lock --node-modules-dir=none supabase/functions/_shared/free-llm-status.test.ts
import { buildOutOfRoom, checkRoomMessage, diagnoseProvider, pickCandidate, ptWhen, CANDIDATES, type ProviderRow, type TriedLite } from "./free-llm-status.ts";

const eq = (a: unknown, b: unknown, msg: string) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c: unknown, msg: string) => { if (!c) throw new Error(msg); };

// Oct 27 2026, 3:35 PM Pacific (PDT) = 22:35 UTC.
const NOW = Date.parse("2026-10-27T22:35:00Z");
const rows: ProviderRow[] = [
  { name: "freellm", enabled: true, private_ok: true, cooldown_until: "2026-10-27T22:46:00Z", cooldown_reason: "freellm_watch: Couldn't resolve host name",
    last_ok_at: "2026-10-27T00:05:00Z", last_error: "2026-10-27T22:30:02.500Z error: error sending request for url (https://bestly-pi.example/v1/chat/completions): client error (Connect): dns error: failed to lookup address information" },
  { name: "groq", enabled: true, private_ok: true, last_ok_at: "2026-10-27T22:33:10Z", last_error: "2026-10-27T20:43:08.429Z rate_limited: 429 {\"error\":{\"message\":\"Rate limit reached for model `openai/gpt-oss-120b`" },
  { name: "cloudflare", enabled: true, private_ok: true, daily_cap: 9000, last_ok_at: "2026-10-27T22:30:03Z", last_error: "2026-10-27T20:30:03.641Z rate_limited: 429 {\"errors\":[{\"message\":\"AiError: you have used up your daily free allocation of 10,000 neurons" },
  { name: "gemini", enabled: true, private_ok: false },
  { name: "openrouter", enabled: true, private_ok: false },
  { name: "local", enabled: true, private_ok: true, last_ok_at: "2026-10-27T18:30:19Z", last_error: "2026-10-24T20:30:47.231Z timeout: local model took too long" },
  { name: "anthropic", enabled: true, private_ok: true },
];
const tried: TriedLite[] = [
  { provider: "freellm", model: "gpt-oss-120b", outcome: "skipped_off" },
  { provider: "groq", model: "openai/gpt-oss-120b", outcome: "rate_limited" },
  { provider: "groq", model: "qwen/qwen3.8-27b", outcome: "rate_limited" },
  { provider: "groq", model: "openai/gpt-oss-20b", outcome: "rate_limited" },
  { provider: "cloudflare", model: "@cf/openai/gpt-oss-120b", outcome: "skipped_budget" },
];
const hints = { modelSkipUntil: { "openai/gpt-oss-120b": NOW + 90_000, "qwen/qwen3.8-27b": NOW + 40_000, "openai/gpt-oss-20b": NOW + 120_000 } };

Deno.test("times are Pacific 12-hour with the right day word", () => {
  eq(ptWhen(Date.parse("2026-10-27T00:05:00Z"), NOW), "yesterday at 5:05 PM", "yesterday");
  eq(ptWhen(Date.parse("2026-10-28T00:00:00Z"), NOW, true), "5:00 PM", "cloudflare reset, bare");
  eq(ptWhen(Date.parse("2026-10-24T20:30:00Z"), NOW), "Oct 24 at 1:30 PM", "older date");
});

Deno.test("the Pi is reported offline with the real time and cause", () => {
  const d = diagnoseProvider(rows[0], tried, NOW);
  ok(d.down, "down flag");
  ok(d.line.includes("offline since yesterday at 5:05 PM"), d.line);
  ok(d.line.includes("cannot find the Pi on the network"), d.line);
});

Deno.test("an outage_note on the row is quoted, not hard-coded text", () => {
  const withNote = { ...rows[0], outage_note: "down until Hestia is rebuilt (new drive arrives Wed Oct 28, 1 to 4 PM)." };
  const d = diagnoseProvider(withNote, tried, NOW);
  ok(d.line.includes("down until Hestia is rebuilt (new drive arrives Wed Oct 28, 1 to 4 PM)."), d.line);
  ok(!d.line.includes("cannot find"), "note replaces the guessed cause");
});

Deno.test("without a note the newest incident note title is used", () => {
  const d = diagnoseProvider(rows[0], tried, NOW, {}, "Hestia diagnosis 11:50 AM Oct 27");
  ok(d.line.includes('latest incident note: "Hestia diagnosis 11:50 AM Oct 27"'), d.line);
});

Deno.test("Cloudflare names its reset time, Groq names when a model frees up", () => {
  const cf = diagnoseProvider(rows[2], tried, NOW);
  ok(cf.line.includes("resets at 5:00 PM"), cf.line);
  const gq = diagnoseProvider(rows[1], tried, NOW, hints);
  ok(/all 3 of its free models are at the per-minute limit; the first frees up in under a minute/.test(gq.line), gq.line);
});

Deno.test("full message: reasons, ONE recommendation with key location, paid offer, no junk", () => {
  const out = buildOutOfRoom({ rows, tried, now: NOW, noPaid: false, hints });
  eq(checkRoomMessage(out, { noPaid: false, expectOffline: "freellm" }).join("; "), "", "message problems");
  eq(out.candidate?.name, "sambanova", "first recommendation");
  ok(out.text.includes("https://cloud.sambanova.ai/apis") && out.text.includes("sambanova_api_key"), "key location");
  ok(out.text.includes("skipped on purpose"), "gemini/openrouter explained");
  ok(!/Next action: none/i.test(out.text), "never a dead end");
  ok(out.options.startsWith("OPTIONS: Use paid AI for this one | Wait and retry at"), out.options);
  eq((out.text.match(/Best new one to connect/g) ?? []).length, 1, "exactly one recommendation");
});

Deno.test("no paid offer after he said no", () => {
  const out = buildOutOfRoom({ rows, tried, now: NOW, noPaid: true, hints });
  eq(checkRoomMessage(out, { noPaid: true }).join("; "), "", "message problems");
  ok(!/Paid AI costs/.test(out.text), "no paid sentence");
  ok(out.options.startsWith("OPTIONS: Wait and retry at"), out.options);
});

Deno.test("a connected candidate is skipped; next one is recommended; none left says so", () => {
  eq(pickCandidate(["groq", "sambanova"])?.name, "cerebras", "second candidate");
  eq(pickCandidate(CANDIDATES.map((c) => c.name)), null, "none left");
  const out = buildOutOfRoom({ rows: [...rows, { name: "sambanova", enabled: true, private_ok: true }, { name: "cerebras", enabled: true, private_ok: true }], tried, now: NOW, noPaid: false, hints });
  ok(out.text.includes("already connected"), "all connected");
});

Deno.test("candidates all state a policy source and a key location", () => {
  for (const c of CANDIDATES) {
    ok(c.policyUrls.length >= 2 && c.keyUrl.startsWith("https://") && c.baseUrl.startsWith("https://") && c.keyName.endsWith("_api_key"), c.name);
  }
});
