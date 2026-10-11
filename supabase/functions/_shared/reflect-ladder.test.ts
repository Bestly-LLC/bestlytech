// Offline test for the reflect retry ladder: a simulated total free outage must still reach the paid stage with >= 8 s.
//   deno test --no-lock --node-modules-dir=none supabase/functions/_shared/reflect-ladder.test.ts
import { type Attempt, chunkStartMin, FREE_MIN_MS, PAID_MIN_MS, PAID_RESERVE_MS, runLadder } from "./reflect-ladder.ts";

const ATTEMPTS: Attempt[] = [
  { name: "freellm>groq>cloudflare", skip: [], deadline: 38_000, paid: "never", wait: 0 },
  { name: "groq>cloudflare", skip: ["freellm"], deadline: 32_000, paid: "never", wait: 6_000 },
  { name: "cloudflare", skip: ["freellm", "groq"], deadline: 32_000, paid: "never", wait: 15_000 },
];
const PAID: Attempt = { name: "paid", skip: [], deadline: 45_000, paid: "first", wait: 2_000 };
const eq = (a: unknown, b: unknown, m: string) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); };

/** Fake clock. Every free call burns its whole deadlineMs (a timeout); the paid call records how much time it was given. */
function sim(budgetMs: number, opts: { plan: Attempt[]; freeOk?: boolean }) {
  let t = 0;
  const calls: { name: string; deadlineMs: number; left: number }[] = [];
  const deadline = budgetMs;
  const p = runLadder({
    plan: opts.plan, deadline, now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); },
    describe: (at, e) => `${at.name}: ${(e as Error).message}`,
    call: ({ at, deadlineMs }) => {
      calls.push({ name: at.name, deadlineMs, left: deadline - t });
      if (at.paid === "first") return Promise.resolve({ via: "paid:anthropic", json: { lessons: [] } });
      if (opts.freeOk) return Promise.resolve({ via: at.name, json: { lessons: [] } });
      t += deadlineMs;                       // the stage uses all of its time and times out
      return Promise.reject(new Error("timeout"));
    },
  });
  return { p, calls };
}

Deno.test("the old loop (no reserve) reproduces the bug: paid is never reached in a total free outage", async () => {
  let t = 0; const deadline = 120_000; const plan = [...ATTEMPTS, PAID]; let paidTried = false, threw = "";
  try {
    for (const at of plan) {
      if (t + 8_000 > deadline) throw new Error("out of time");                                      // the old guard
      if (at.wait) t += Math.min(at.wait, Math.max(0, deadline - t - 8_000));
      if (at.paid === "first") { paidTried = true; break; }
      t += Math.min(at.deadline, deadline - t);                                                       // the stage times out
    }
  } catch (e) { threw = (e as Error).message; }
  eq(paidTried, false, "old loop never reached paid");
  eq(threw, "out of time", "old loop threw before Claude ran");
});

Deno.test("total free outage, fresh budget: paid is reached with >= 8 s", async () => {
  const { p, calls } = sim(120_000, { plan: [...ATTEMPTS, PAID] });
  const r = await p;
  eq(r.via, "paid:anthropic", "paid ran");
  const paid = calls[calls.length - 1];
  eq(paid.name, "paid", "last call is paid");
  if (paid.deadlineMs < PAID_MIN_MS) throw new Error(`paid got only ${paid.deadlineMs} ms`);
  console.log("calls", JSON.stringify(calls));
});

Deno.test("total free outage, chunk started with only 40 s left: paid is still reached with >= 8 s", async () => {
  const { p, calls } = sim(40_000, { plan: [...ATTEMPTS, PAID] });
  const r = await p;
  eq(r.via, "paid:anthropic", "paid ran");
  const paid = calls[calls.length - 1];
  if (paid.deadlineMs < PAID_MIN_MS) throw new Error(`paid got only ${paid.deadlineMs} ms`);
  // every free stage was capped to leave the reserve
  for (const c of calls.slice(0, -1)) if (c.left - c.deadlineMs < PAID_RESERVE_MS - 1) throw new Error(`free stage ate the reserve: ${JSON.stringify(c)}`);
});

Deno.test("once only the reserve is left the remaining free rungs are skipped", async () => {
  const { p, calls } = sim(PAID_RESERVE_MS + 3_000, { plan: [...ATTEMPTS, PAID] });
  await p;
  eq(calls.length, 1, "only the paid call ran");
  eq(calls[0].name, "paid", "it was the paid call");
});

Deno.test("free success never touches paid", async () => {
  const { p, calls } = sim(120_000, { plan: [...ATTEMPTS, PAID], freeOk: true });
  const r = await p;
  eq(r.via, "freellm>groq>cloudflare", "first rung won");
  eq(calls.length, 1, "one call");
});

Deno.test("paid not allowed (switch/caller says no): no reserve is held and the error is thrown, never a paid call", async () => {
  const { p, calls } = sim(120_000, { plan: ATTEMPTS });
  let threw = false; try { await p; } catch { threw = true; }
  eq(threw, true, "threw after free rungs failed");
  eq(calls.some((c) => c.name === "paid"), false, "no paid call");
  eq(calls[0].deadlineMs, 38_000, "first stage keeps its full time when there is no paid rung");
});

Deno.test("paid also fails: the error carries the history", async () => {
  let t = 0;
  let msg = "";
  try {
    await runLadder({
      plan: [...ATTEMPTS, PAID], deadline: 120_000, now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); },
      describe: (at, e) => `${at.name}: ${(e as Error).message}`,
      call: ({ at, deadlineMs }) => { t += at.paid === "first" ? 100 : deadlineMs; return Promise.reject(new Error(at.paid === "first" ? "paid switch off" : "timeout")); },
    });
  } catch (e) { msg = (e as Error).message; }
  eq(msg.includes("paid: paid switch off"), true, "last error is the paid one");
});

Deno.test("a chunk starts only with enough time for free rungs plus the reserve", () => {
  eq(chunkStartMin(true) >= PAID_RESERVE_MS + FREE_MIN_MS, true, "start threshold");
  eq(chunkStartMin(false), 10_000, "no paid: old threshold");
});
