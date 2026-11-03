// Regression for 2026-10-28: on case 2a2cd2ee (Willie) Jared answered three shop questions with "Skip we got an estimate from tesla" and Claims Closer
// emailed that text word for word to AGC Collision Center, Pristine Collision Center and Pristine Collision Center Hollywood.
// These tests run the real handler (booking.ts answeredQuestions -> sendMail -> canSend) against an in-memory database and a captured network,
// and prove Jared's words never leave.
import { beforeEach, describe, expect, it } from "vitest";
import { answeredQuestions } from "../../../supabase/functions/claims-closer/booking.ts";
import { sendMail } from "../../../supabase/functions/claims-closer/estimates.ts";
import { FakeDb, captureNetwork, makeCtx } from "./fakeDb";

const JARED = "Skip we got an estimate from tesla";
const day = 864e5;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString();

function world(o: { askedDaysAgo: number; hold?: boolean; gateOk?: boolean; resolveClosed?: boolean }) {
  const db = new FakeDb();
  const net = captureNetwork();
  const shops = db.seed("claim_shops", [
    { name: "AGC Collision Center", email: "estimates@agc.test", contact_name: null, active: true },
    { name: "Pristine Collision Center", email: "est@pristine.test", contact_name: null, active: true },
    { name: "Pristine Collision Center Hollywood", email: "est@pristine-hollywood.test", contact_name: null, active: true },
  ]);
  const c: any = { id: "case-willie", reservation_id: 59754331, guest_first: "Willie", status: "waiting_guest", history: false, outbound_hold: !!o.hold, outbound_hold_reason: o.hold ? "Jared asked for a hold" : null,
    path: "resolve_directly", escalate_by: o.resolveClosed === false ? iso(10) : iso(-4), estimate_amount: null, chosen_estimate_id: null, vin: "5YJ3E1EA0LF000001" };
  db.seed("claim_cases", [c]);
  const estRows = shops.map((s, i) => db.seed("claim_estimates", [{ case_id: c.id, shop_id: s.id, ref: `CC-TEST${i}`, status: "needs_visit", requested_at: iso(-20), line_items: {} }])[0]);
  const qs = estRows.map((e, i) => db.seed("claim_questions", [{ case_id: c.id, key: `shop-asks-${e.id}`, kind: "decision", question: `${shops[i].name} replied and needs: better photos, VIN. What should I do?`, options: [],
    answer: JARED, asked_at: iso(-o.askedDaysAgo), answered_at: iso(0), answered_by: "jared", handled_at: null, meta: {} }])[0]);
  db.rpcs.claims_gate = () => ({ ok: o.gateOk !== false && !o.hold, live: false, reason: o.hold ? "held by the watchdog" : "open" });
  db.rpcs.claims_send_ok = () => o.gateOk !== false && !o.hold;
  db.seed("claims_autonomy_settings", [{ id: true, insurer_contact_mode: "full" }]);
  const { ctx, events, notices } = makeCtx(db);
  return { db, net, ctx, c, shops, estRows, qs, events, notices };
}

const bodies = (mails: any[]) => mails.map((m) => `${m.subject}\n${m.text}`).join("\n=====\n");

describe("a shop question answered with a note is never relayed", () => {
  let w: ReturnType<typeof world>;

  describe("the exact case: Willie's questions, asked Oct 7 to 12 and answered Oct 28", () => {
    beforeEach(() => { w = world({ askedDaysAgo: 21 }); });
    it("sends nothing to anyone: the questions are stale (over 7 days, Turo's window closed), so they are retired", async () => {
      await answeredQuestions(w.ctx, w.c, []);
      expect(w.net.mails).toHaveLength(0);
      expect(w.net.calls).toHaveLength(0);
      expect(w.qs.every((q) => q.retired_at && q.handled_at)).toBe(true);
      expect(w.qs[0].retired_reason).toMatch(/resolve-directly window has closed/);
    });
    it("still honors 'drop it': the shop threads are closed quietly, status closed, requested_at untouched", async () => {
      const before = w.estRows.map((e) => e.requested_at);
      await answeredQuestions(w.ctx, w.c, []);
      expect(w.estRows.map((e) => e.status)).toEqual(["closed", "closed", "closed"]);
      expect(w.estRows.map((e) => e.requested_at)).toEqual(before);
    });
  });

  describe("the same note on fresh questions (asked yesterday), gate open", () => {
    beforeEach(() => { w = world({ askedDaysAgo: 1, resolveClosed: false }); });
    it("sends each shop one short line written by Claims Closer, with none of Jared's words, no Tesla, no amounts", async () => {
      await answeredQuestions(w.ctx, w.c, []);
      expect(w.net.mails).toHaveLength(3);
      const all = bodies(w.net.mails);
      expect(all).toContain("Thanks, we're all set on this one.");
      expect(all.toLowerCase()).not.toContain("tesla");
      expect(all.toLowerCase()).not.toContain("we got an estimate");
      expect(all.toLowerCase()).not.toContain("skip");
      expect(all).not.toMatch(/\$\s?\d/);
      for (const m of w.net.mails) expect(m.text.split(/\n\n--\n/)[0].trim().split("\n\n")).toHaveLength(2);   // greeting + the one line (signature follows after "--")
    });
    it("closes the estimate requests and does not reset requested_at to now", async () => {
      const before = w.estRows.map((e) => e.requested_at);
      await answeredQuestions(w.ctx, w.c, []);
      expect(w.estRows.map((e) => e.status)).toEqual(["closed", "closed", "closed"]);
      expect(w.estRows.map((e) => e.requested_at)).toEqual(before);
    });
    it("treats three questions with the same answer as ONE decision and one alert", async () => {
      await answeredQuestions(w.ctx, w.c, []);
      expect(w.db.tables.claim_decisions).toHaveLength(1);
      expect(w.db.tables.claim_decisions[0].inputs.words_sent).toBe(false);
      expect(JSON.stringify(w.db.tables.claim_decisions)).not.toContain("tesla");
      expect(w.notices).toHaveLength(1);
      expect(w.qs.every((q) => q.handled_at)).toBe(true);
    });
    it("never names another shop to a shop", async () => {
      await answeredQuestions(w.ctx, w.c, []);
      for (const m of w.net.mails) {
        const own = w.shops.find((x) => x.email === m.to[0])!.name;
        const rest = String(m.text).split(own).join("");
        for (const other of w.shops) if (other.name !== own) expect(rest).not.toContain(other.name);
      }
    });
  });

  describe("outbound hold (Willie's case now has one)", () => {
    beforeEach(() => { w = world({ askedDaysAgo: 1, hold: true, resolveClosed: false }); });
    it("sends nothing at all, and records each blocked send", async () => {
      await answeredQuestions(w.ctx, w.c, []);
      expect(w.net.mails).toHaveLength(0);
      const blocked = (w.db.tables.claims_send_log ?? []).filter((r) => r.decision === "blocked");
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked[0].code).toBe("hold");
    });
  });

  describe("'Answer it for me' answers from the record only", () => {
    it("replies with the VIN and the photos already on file, in Claims Closer's words", async () => {
      w = world({ askedDaysAgo: 1, resolveClosed: false });
      w.qs.forEach((q) => { q.answer = "answer"; q.options = [{ value: "answer", label: "Answer it for me" }]; });
      w.qs[2].meta = { asks_for: "better photos of fender and rim/tire, VIN" };
      w.qs[1].meta = { asks_for: "Clarify whether fender scuffing is dirt or damage" };
      w.qs[0].meta = { asks_for: "how you heard about us" };
      await answeredQuestions(w.ctx, w.c, []);
      const byTo = Object.fromEntries(w.net.mails.map((m) => [m.to[0], m.text]));
      expect(byTo["estimates@agc.test"]).toContain("Found you online.");
      expect(byTo["est@pristine-hollywood.test"]).toContain("The VIN is 5YJ3E1EA0LF000001.");
      expect(byTo["est@pristine.test"]).toBeUndefined();   // dirt vs damage can't be answered from the record: nothing sent
      expect(w.estRows[1].status).toBe("needs_visit");      // left exactly as it was
    });
  });

  describe("the backstop: even a buggy code path cannot send his words", () => {
    it("sendMail blocks any text that shares a run of 4 words with something Jared typed", async () => {
      w = world({ askedDaysAgo: 1, resolveClosed: false });
      w.qs.forEach((q) => { q.handled_at = iso(0); });
      const r = await sendMail(w.ctx, w.c, { to: "estimates@agc.test", subject: "Re: Photo estimate request", key: "k1", purpose: "answer_shop",
        text: `Hi AGC team,\n\n${JARED}\n\nThanks,\nJared` });
      expect(r.ok).toBe(false);
      expect((r as any).blocked).toBe(true);
      expect(w.net.mails).toHaveLength(0);
      expect(w.db.tables.claims_send_log.some((l: any) => l.code === "overlap")).toBe(true);
    });
    it("blocks a quoted fragment too", async () => {
      w = world({ askedDaysAgo: 1, resolveClosed: false });
      const r = await sendMail(w.ctx, w.c, { to: "estimates@agc.test", subject: "Re: x", key: "k2", purpose: "answer_shop", text: "Hello,\n\nJust so you know we got an estimate already.\n\nThanks" });
      expect(r.ok).toBe(false);
      expect(w.net.mails).toHaveLength(0);
    });
  });
});

