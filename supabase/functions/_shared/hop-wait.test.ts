// deno test --no-lock --node-modules-dir=none supabase/functions/_shared/hop-wait.test.ts
import { hopWaitMs, notBeforeIso, HOP_WAIT_CAP_MS, PAUSE_WAIT_MS } from "./hop-wait.ts";

const eq = (a: unknown, b: unknown, msg: string) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const NOW = Date.parse("2026-10-28T20:43:58Z");

Deno.test("a future not_before is waited on, up to the cap", () => {
  eq(hopWaitMs(new Date(NOW + 30_000).toISOString(), NOW), 30_000, "30 s");
  eq(hopWaitMs(new Date(NOW + 10 * 60_000).toISOString(), NOW), HOP_WAIT_CAP_MS, "far future is capped, never a long sleep");
});

Deno.test("missing, invalid or past not_before means start now", () => {
  for (const v of [undefined, null, "", "soon", 12345, {}, new Date(NOW - 5000).toISOString()]) eq(hopWaitMs(v, NOW), 0, JSON.stringify(v));
});

Deno.test("the pause the busy path asks for fits under the cap and round-trips", () => {
  eq(hopWaitMs(notBeforeIso(NOW), NOW), PAUSE_WAIT_MS, "pause");
  if (PAUSE_WAIT_MS > HOP_WAIT_CAP_MS) throw new Error("pause longer than the cap");
});
