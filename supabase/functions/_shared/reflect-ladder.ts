// _shared/reflect-ladder.ts - the retry ladder for one reflect batch, with the paid rung's time held back.
//
// 2026-10-10 review fix: the free stages (38 s + 6 s + 32 s + 15 s of waiting) could eat the whole 120 s budget, so the paid stage started with
// less than the 8 s llm() needs and threw before Claude ran: the paid fallback never fired in the outage it exists for. Now the paid rung's
// minimum plus a margin is reserved up front: every free stage is capped to (time left - reserve), and once only the reserve is left the
// remaining free rungs are skipped. Paid still runs only after every free rung has failed, and still only if the Paid AI switch allows it
// (that check lives in llm()). No imports, so it can be tested offline.

export const PAID_MIN_MS = 8_000;       // llm() will not start a call with less than this left
export const PAID_RESERVE_MS = 15_000;  // held back for the paid rung: its minimum plus margin for the wait before it
export const FREE_MIN_MS = 5_000;       // a free stage with less than this is not worth starting

export type Attempt = { name: string; skip: string[]; deadline: number; paid: "never" | "first"; wait: number };
export type LadderCall = (a: { at: Attempt; deadlineMs: number }) => Promise<{ via: string; json: unknown }>;

/** A batch is only started with this much time left, so the free rungs get a real chance before the reserve is touched. */
export const chunkStartMin = (hasPaid: boolean) => (hasPaid ? PAID_RESERVE_MS + 15_000 : 10_000);

export async function runLadder(o: {
  plan: Attempt[]; deadline: number; call: LadderCall; describe: (at: Attempt, e: unknown) => string;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}): Promise<{ json: unknown; via: string }> {
  const now = o.now ?? Date.now, sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const hasPaid = o.plan.some((a) => a.paid === "first");
  let last = "";
  for (const at of o.plan) {
    const isPaid = at.paid === "first";
    const reserve = hasPaid && !isPaid ? PAID_RESERVE_MS : 0;
    let left = o.deadline - now();
    if (isPaid) {
      if (left < PAID_MIN_MS) throw new Error(`out of time (${last || "not tried"})`);
      if (at.wait) { await sleep(Math.min(at.wait, Math.max(0, left - PAID_MIN_MS))); left = o.deadline - now(); }
      if (left < PAID_MIN_MS) throw new Error(`out of time (${last || "not tried"})`);
      try { return await o.call({ at, deadlineMs: Math.min(at.deadline, left) }); }
      catch (e) { last = o.describe(at, e); }
      continue;
    }
    if (left - reserve < FREE_MIN_MS) {
      if (hasPaid) { last = last || `${at.name}: skipped, only the paid reserve was left`; continue; }   // only the reserve is left: skip the free rungs, go to paid
      throw new Error(`out of time (${last || "not tried"})`);
    }
    if (at.wait) { await sleep(Math.min(at.wait, Math.max(0, left - reserve - FREE_MIN_MS))); left = o.deadline - now(); }
    const room = left - reserve;
    if (room < FREE_MIN_MS) { if (hasPaid) continue; throw new Error(`out of time (${last || "not tried"})`); }
    try { return await o.call({ at, deadlineMs: Math.min(at.deadline, room) }); }
    catch (e) { last = o.describe(at, e); }
  }
  throw new Error(last);
}
