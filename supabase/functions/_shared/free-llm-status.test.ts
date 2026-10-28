// Offline tests for the "every free rung failed" message. No network, no secrets.
//   deno test --no-lock --node-modules-dir=none supabase/functions/_shared/free-llm-status.test.ts
import { buildOutOfRoom, checkRoomMessage, diagnoseProvider, pickCandidate, ptWhen, CANDIDATES, cleanHistory, isStatusNote, looksLikeStatusParrot, waitingNote, parkDelayMs, type ProviderRow, type TriedLite } from "./free-llm-status.ts";

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

Deno.test("FreeLLM is reported offline with the real time and cause", () => {
  const d = diagnoseProvider(rows[0], tried, NOW);
  ok(d.down, "down flag");
  ok(d.line.includes("offline since yesterday at 5:05 PM"), d.line);
  ok(d.line.includes("cannot find its server on the network"), d.line);
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

const flat = <T extends { line: string }>(d: T): T => ({ ...d, line: d.line.replace(/[\u00a0\u202f]/g, " ") });
// 2026-10-28: step 0 of a tool-heavy run. FreeLLM is down, Groq skips every rung for size (the tool list alone is most of its
// 7,000-token ceiling), Cloudflare skips for its daily cap. The reply must say so in numbers, not just "out of room".
const stepZero: TriedLite[] = [
  { provider: "freellm", model: "gpt-oss-120b", outcome: "skipped_off" },
  { provider: "groq", model: "openai/gpt-oss-120b", outcome: "skipped_size", need: 9412, max: 7000 },
  { provider: "groq", model: "qwen/qwen3.8-27b", outcome: "skipped_size", need: 9412, max: 7000 },
  { provider: "groq", model: "openai/gpt-oss-20b", outcome: "skipped_size", need: 9412, max: 7000 },
  { provider: "cloudflare", model: "@cf/openai/gpt-oss-120b", outcome: "skipped_budget" },
];

Deno.test("skipped_size on Groq says the step is too big, with the numbers, and that waiting will not fix it", () => {
  const d = flat(diagnoseProvider(rows[1], stepZero, NOW));
  ok(d.tooBig, "tooBig flag");
  ok(d.line.includes("cannot take this step") && d.line.includes("about 9,400 tokens") && d.line.includes("about 7,000 per request"), d.line);
  ok(d.line.includes("Waiting will not fix that"), d.line);
  ok(d.backAt === undefined, "a size problem has no come-back time");
});

Deno.test("skipped_size without numbers still reads cleanly", () => {
  const d = flat(diagnoseProvider(rows[1], [{ provider: "groq", model: "m", outcome: "skipped_size" }], NOW));
  ok(d.line.includes("bigger than the free per-request limit") && !/undefined|NaN/.test(d.line), d.line);
});

Deno.test("skipped_budget on Cloudflare names the reset; Scout's own request allowance is reported with its numbers", () => {
  const cf = flat(diagnoseProvider(rows[2], stepZero, NOW));
  ok(cf.line.includes("resets at 5:00 PM"), cf.line);
  const own = flat(diagnoseProvider({ ...rows[2], cooldown_reason: null, last_error: null }, [{ provider: "cloudflare", model: "m", outcome: "skipped_budget", used: 9000, cap: 9000 }], NOW));
  ok(own.line.includes("9,000 requests a day I allow myself") && own.line.includes("resets at 5:00 PM"), own.line);
});

Deno.test("step-zero message: every provider has a reason, the size problem is named, the recommendation fixes it", () => {
  for (const noPaid of [false, true]) {
    const out = buildOutOfRoom({ rows, tried: stepZero, now: NOW, noPaid, hints });
    eq(checkRoomMessage(out, { noPaid, expectOffline: "freellm" }).join("; "), "", "message problems");
    const text = out.text.replace(/[\u00a0\u202f]/g, " ");
    ok(text.includes("Groq cannot take this step"), text);
    ok(text.includes("Cloudflare's daily free limit is used up"), text);
    ok(text.includes("so it fixes the size problem above"), text);
    ok(text.includes("100,000 tokens per request"), text);
    eq(out.lines.filter((l) => /^\W*$/.test(l.line)).length, 0, "no empty reasons");
  }
});

Deno.test("mixed: Groq rate-limited on one model and too big for another reports both", () => {
  const t: TriedLite[] = [
    { provider: "groq", model: "openai/gpt-oss-120b", outcome: "rate_limited" },
    { provider: "groq", model: "qwen/qwen3.8-27b", outcome: "skipped_size", need: 9000, max: 7000 },
  ];
  const d = flat(diagnoseProvider(rows[1], t, NOW, { modelSkipUntil: { "openai/gpt-oss-120b": NOW + 50_000 } }));
  ok(d.line.includes("per-minute limit") && d.line.includes("over its per-request limit"), d.line);
});


// 2026-10-28: Scout's own status text must never reach a model, and must never come back as an answer.
Deno.test("status notes are dropped from the model's context, OPTIONS lines too", () => {
  const thread = [
    { role: "user", body: "what needs me today" },
    { role: "assistant", body: "Free AI is out of room until 2:16 PM. Please choose to use paid AI or wait.\n\nOPTIONS: Use paid AI for this one | Wait and retry at 2:16 PM" },
    { role: "assistant", body: "Working: waiting for the free AI to free up (0 steps)" },
    { role: "assistant", body: "Worked 5 steps over 3 min." },
    { role: "assistant", body: "Stopped after 2 steps: the next step never started, even after I restarted it once. Say keep going and I pick it up here." },
    { role: "assistant", body: "I tried every free AI provider I have and none can answer right now. Here is exactly why:\n- Groq is busy" },
    { role: "assistant", body: "Two things need you: the Mercury review and a Turo claim.\n\nOPTIONS: Open Mercury | Open the claim" },
    { role: "user", body: "keep going" },
  ];
  const paid = cleanHistory(thread);
  eq(paid.length, 3, "paid path keeps real turns only");
  ok(paid[1].body.includes("OPTIONS: Open Mercury"), "paid path keeps OPTIONS");
  const free = cleanHistory(thread, { stripOptions: true });
  eq(free.length, 3, "free path real turns");
  ok(!free.some((m) => /OPTIONS|out of room|Working:|Worked \d|Stopped after/.test(m.body)), JSON.stringify(free));
  ok(free[1].body === "Two things need you: the Mercury review and a Turo claim.", free[1].body);
  ok(isStatusNote("Free AI is out of room until 2:16 PM.") && !isStatusNote("Groq is out of room on tokens, here is the plan."), "isStatusNote");
});

Deno.test("a model reply that copies Scout's status text is not an answer", () => {
  for (const t of [
    "Free AI is out of room until 2:16 PM. Please choose to use paid AI or wait.",
    "I tried every free AI provider I have and none can answer right now.",
    "Working: waiting for the free AI to free up (3 steps)",
    "Your options are to wait or use paid AI.",
    "OPTIONS: Use paid AI for this one | Wait and retry at 2:16 PM",
  ]) ok(looksLikeStatusParrot(t), t);
  for (const t of [
    "Two things need you today: the Mercury review and a Turo claim.",
    "Paid AI costs about 5 to 50 cents a run, and the switch is off right now.",
    "The Groq queue is fine; Cloudflare resets at 5:00 PM.",
  ]) ok(!looksLikeStatusParrot(t), t);
});

Deno.test("waiting note: short, in place, why per provider, one provider to connect, no paid offer, no buttons", () => {
  const out = buildOutOfRoom({ rows, tried: stepZero, now: NOW, noPaid: true, hints });
  const note = waitingNote(out, 0);
  const flatNote = note.replace(/[\u00a0\u202f]/g, " ");
  ok(note.startsWith("Working: waiting for the free AI (0 steps)."), note);
  ok(flatNote.includes("offline since yesterday at 5:05 PM") && flatNote.includes("Groq cannot take this step") && flatNote.includes("resets at 5:00 PM"), flatNote);
  ok(!flatNote.includes("skipped on purpose") && !flatNote.includes("not used for live chat"), "nothing that is not actually being waited on");
  ok(flatNote.includes("connect SambaNova Cloud") && flatNote.includes("https://cloud.sambanova.ai/apis") && flatNote.includes("sambanova_api_key"), flatNote);
  ok(!/paid ai/i.test(flatNote) && !/OPTIONS/.test(flatNote), flatNote);
  ok(!/\.\.\.|…|undefined|NaN/.test(flatNote), flatNote);
  ok(!looksLikeStatusParrot("Two things need you today.") && isStatusNote(note), "it is itself a status note, so it never goes back to a model");
});

Deno.test("parked runs retry between 1 and 5 minutes, sooner when a provider is due back", () => {
  const out = buildOutOfRoom({ rows, tried: stepZero, now: NOW, noPaid: true, hints });
  eq(parkDelayMs({ ...out, backAt: NOW + 2 * 3600_000 }, NOW), 5 * 60_000, "far away: poll every 5 min");
  eq(parkDelayMs({ ...out, backAt: NOW + 90_000 }, NOW), 90_000, "due in 90 s");
  eq(parkDelayMs({ ...out, backAt: NOW + 5_000 }, NOW), 60_000, "never under a minute");
});
