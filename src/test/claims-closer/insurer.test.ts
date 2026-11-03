// Items 9 and 11: the guest-insurer track (open the claim, send the estimate and photos, answer the adjuster, chase until paid), outside claims (Kemper),
// and settlement offers under min_accept_pct. Real modules, in-memory database, captured network: nothing is sent anywhere.
import { describe, expect, it } from "vitest";
import { insurerStep, outsideClaimsStep, outsideClaimNext } from "../../../supabase/functions/claims-closer/insurer.ts";
import { answeredQuestions } from "../../../supabase/functions/claims-closer/booking.ts";
import { offerPlan, parseContactNote, verifyInsurerRead } from "../../../supabase/functions/claims-closer/insurer-text.ts";
import { settlementDecision, MAX_CHASES } from "../../../supabase/functions/claims-closer/autonomy.ts";
import { FakeDb, captureNetwork, makeCtx } from "./fakeDb";

const H = 36e5;
const iso = (hours: number) => new Date(Date.now() + hours * H).toISOString();

function world(o: { mode?: "full" | "draft_only"; hold?: boolean; adjusterEmail?: string | null; adjusterPhone?: string | null; estimate?: number | null; state?: string; nextChaseInHours?: number | null; chaseCount?: number; llm?: any } = {}) {
  const db = new FakeDb(); const net = captureNetwork();
  const c: any = db.seed("claim_cases", [{ reservation_id: 62622707, guest_first: "Cody", guest_last: "T", status: "waiting_guest", history: false, path: "turo_claim", vin: "5YJ3E1EA0LF000001", car: "2020 Tesla Model 3",
    opened_at: iso(-300), trip_end: iso(-200), estimate_amount: o.estimate === undefined ? 2184.5 : o.estimate, invoices: [], outbound_hold: !!o.hold, outbound_hold_reason: o.hold ? "test hold" : null,
    insurer: { name: "Progressive", policy_no: "870703450", policy_holder: "Essence Bonner Harris" } }])[0];
  db.seed("claims_autonomy_settings", [{ id: true, insurer_contact_mode: o.mode ?? "full", min_accept_pct: 100 }]);
  db.rpcs.claims_gate = () => ({ ok: true, live: false, reason: "open" });
  db.rpcs.claims_ask = (a) => {
    const have = (db.tables.claim_questions ?? []).find((x) => x.case_id === a.p_case && x.key === a.p_key);
    if (have) return have.id;
    return db.seed("claim_questions", [{ case_id: a.p_case, key: a.p_key, kind: a.p_kind, question: a.p_question, options: a.p_options ?? [], asked_at: iso(0), answer: null, answered_at: null, handled_at: null, meta: {} }])[0].id;
  };
  const track = db.seed("claim_insurer_track", [{ case_id: c.id, insurer_name: "Progressive", policy_no: "870703450", policy_holder: "Essence Bonner Harris", claim_no: null,
    adjuster_email: o.adjusterEmail === undefined ? "claims@progressive.test" : o.adjusterEmail, adjuster_phone: o.adjusterPhone ?? null, state: o.state ?? "identified", chase_count: o.chaseCount ?? 0,
    next_chase_at: o.nextChaseInHours == null ? null : iso(o.nextChaseInHours), created_at: iso(-48), notes: [] }])[0];
  db.seed("claim_evidence", [{ case_id: c.id, kind: "after", storage_path: "p/1.jpg", bytes: 10, taken_at: iso(-100) }, { case_id: c.id, kind: "after", storage_path: "p/2.jpg", bytes: 10, taken_at: iso(-99) }]);
  db.files["p/1.jpg"] = new Uint8Array([1]); db.files["p/2.jpg"] = new Uint8Array([2]);
  const { ctx, events, notices } = makeCtx(db, o.llm ? { llm: o.llm } : {});
  return { db, net, ctx, c, track, events, notices };
}
const reply = (db: FakeDb, from: string, subject: string, body: string) => db.seed("bestly_mail", [{ from_addr: from, subject, body_text: body, sent_at: iso(-1) }])[0];
const llmReturning = (json: any) => async () => ({ json });

describe("item 9: opening the claim", () => {
  it("emails the adjuster from jared@bestly.tech with his signature, with the estimate and photos attached", async () => {
    const w = world();
    const notes: string[] = [];
    await insurerStep(w.ctx, w.c, notes);
    expect(w.net.mails).toHaveLength(1);
    const m = w.net.mails[0];
    expect(m.from).toBe("Jared Best <jared@bestly.tech>");
    expect(m.to).toEqual(["claims@progressive.test"]); expect(m.bcc).toEqual(["jared@bestly.tech"]);
    expect(JSON.stringify(m)).not.toMatch(/gmail/i);
    expect(m.text).toContain("policy 870703450");
    expect(m.text).toContain("$2,184.50");
    expect(m.text).toMatch(/Jared Best\nPrincipal Consultant/);     // the Bestly signature
    expect(m.attachments.filter((a: any) => /damage-\d\.jpg/.test(a.filename))).toHaveLength(2);
    expect(m.text).not.toMatch(/deductible|plan (max|cap)|out[- ]of[- ]pocket|review|rating|Turo's/i);
    expect(w.db.tables.claim_insurer_track[0].state).toBe("claim_opening");
    expect(w.db.tables.claim_insurer_track[0].next_chase_at).toBeTruthy();
    expect(notes.join()).toMatch(/opened the claim/);
  });
  it("draft_only mode prepares and sends nothing", async () => {
    const w = world({ mode: "draft_only" });
    await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(0); expect(w.net.calls).toHaveLength(0);
    expect(w.db.tables.claim_insurer_track[0].state).toBe("identified");
  });
  it("an outbound hold stops it, and the block is logged", async () => {
    const w = world({ hold: true });
    await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(0);
    expect(w.db.tables.claims_send_log.some((l) => l.channel === "insurer_email" && l.code === "hold" && l.decision === "blocked")).toBe(true);
  });
  it("waits for the estimate; with no adjuster contact it asks Jared once and sends nothing", async () => {
    const a = world({ estimate: null });
    await insurerStep(a.ctx, a.c, []);
    expect(a.net.mails).toHaveLength(0);
    const b = world({ adjusterEmail: null });
    await insurerStep(b.ctx, b.c, []); await insurerStep(b.ctx, b.c, []);
    expect(b.net.mails).toHaveLength(0);
    expect(b.db.tables.claim_questions.filter((x) => /^insurer-contact-/.test(x.key))).toHaveLength(1);
  });
  it("only a phone number: Ava calls (on a recorded line, no payment terms)", async () => {
    const w = world({ adjusterEmail: null, adjusterPhone: "+18005550100" });
    await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(0);
    expect(w.net.calls).toHaveLength(1);
    expect(w.net.calls[0].purpose).toMatch(/Do not agree to any settlement/);
    expect(w.net.calls[0].first_line).toMatch(/recorded line/);
  });
  it("never opens a claim without the policy number the guest gave", async () => {
    const w = world(); w.c.insurer = { name: "Progressive" };
    await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(0);
  });
});

describe("item 9: Jared's note with the adjuster's address is an address, never text that is sent", () => {
  it("takes the email out of the note, and the sentence goes nowhere", async () => {
    const w = world({ adjusterEmail: null });
    await insurerStep(w.ctx, w.c, []);
    const qq = w.db.tables.claim_questions[0];
    Object.assign(qq, { answer: "their claims email is claims@progressive.test, tell them it was a hit and run", answered_at: iso(0), answered_by: "jared" });
    await answeredQuestions(w.ctx, w.c, []);
    expect(w.db.tables.claim_insurer_track[0].adjuster_email).toBe("claims@progressive.test");
    expect(w.net.mails).toHaveLength(0);       // answered_questions only saved the contact
    await insurerStep(w.ctx, w.c, []);          // the next tick opens the claim, in Claims Closer's words
    expect(w.net.mails).toHaveLength(1);
    expect(JSON.stringify(w.net.mails[0])).not.toMatch(/hit and run/);
  });
  it("parses an address and a phone", () => {
    expect(parseContactNote("email me at Claims@Progressive.com or 800-555-0100")).toEqual({ email: "claims@progressive.com", phone: "800-555-0100" });
    expect(parseContactNote("no idea")).toEqual({ email: null, phone: null });
  });
});

describe("item 9: answering the adjuster", () => {
  it("saves the claim number; a claim opened by email (estimate already attached) goes straight to estimate_sent and does not send the estimate twice", async () => {
    const w = world({ state: "claim_opening" });
    w.db.tables.claim_insurer_track[0].notes = [{ note: "opened by email with the estimate and photos attached", estimate_sent: true }];
    reply(w.db, "adjuster@progressive.test", "Re: New third-party claim", "Thanks. Your claim number is 26-4455-8890. Adjuster Dana Lee, 800-555-0111.");
    w.ctx.llm = llmReturning({ kind: "claim_number", claim_no: "26-4455-8890", adjuster_name: "Dana Lee", adjuster_phone: "800-555-0111", asks: [] });
    await insurerStep(w.ctx, w.c, []);
    expect(w.db.tables.claim_insurer_track[0].claim_no).toBe("26-4455-8890");
    expect(w.db.tables.claim_insurer_track[0].state).toBe("estimate_sent");
    expect(w.db.tables.claim_cases[0].insurer.claim_no).toBe("26-4455-8890");
    expect(w.net.mails).toHaveLength(0);
  });
  it("a claim opened by phone: once the claim number is in, the estimate and photos go by email", async () => {
    const w = world({ state: "claim_opening" });
    reply(w.db, "adjuster@progressive.test", "Claim opened", "Your claim number is 26-4455-8890.");
    w.ctx.llm = llmReturning({ kind: "claim_number", claim_no: "26-4455-8890", asks: [] });
    await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(1);
    expect(w.net.mails[0].subject).toMatch(/Claim 26-4455-8890 estimate and photos/);
    expect(w.db.tables.claim_insurer_track[0].state).toBe("estimate_sent");
  });
  it("a claim number that is not written in the mail is dropped", async () => {
    const w = world({ state: "claim_opening" });
    reply(w.db, "adjuster@progressive.test", "Re: claim", "Please send photos.");
    w.ctx.llm = llmReturning({ kind: "claim_number", claim_no: "99-0000-1111", asks: [] });
    await insurerStep(w.ctx, w.c, []);
    expect(w.db.tables.claim_insurer_track[0].claim_no).toBeNull();
  });
  it("when the adjuster asks for photos and the estimate it sends them; what it does not have goes to Jared", async () => {
    const w = world({ state: "claim_open" });
    reply(w.db, "adjuster@progressive.test", "Re: claim 26-4455-8890", "Please send photos of the damage and the estimate, and a copy of the registration.");
    w.ctx.llm = llmReturning({ kind: "request", asks: ["photos", "estimate", "registration"] });
    await insurerStep(w.ctx, w.c, []);
    const docs = w.net.mails.find((m) => /requested documents/.test(m.subject));
    expect(docs).toBeTruthy();
    expect(docs.attachments.some((a: any) => /damage-1/.test(a.filename))).toBe(true);
    expect(w.notices.some((n) => /waiting on you/.test(n.title) && /registration/.test(n.body))).toBe(true);
  });
  it("is idempotent: the same adjuster mail is read once", async () => {
    const w = world({ state: "claim_open" });
    reply(w.db, "adjuster@progressive.test", "Re: claim", "Please send photos.");
    w.ctx.llm = llmReturning({ kind: "request", asks: ["photos"] });
    await insurerStep(w.ctx, w.c, []); await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails.filter((m) => /requested documents/.test(m.subject))).toHaveLength(1);
  });
  it("a denial is reported as a decision for Jared", async () => {
    const w = world({ state: "claim_open" });
    reply(w.db, "adjuster@progressive.test", "Re: claim", "We have denied this claim.");
    w.ctx.llm = llmReturning({ kind: "denial", asks: [] });
    await insurerStep(w.ctx, w.c, []);
    expect(w.db.tables.claim_insurer_track[0].state).toBe("denied");
    expect(w.notices.some((n) => /denied/.test(n.title))).toBe(true);
  });
  it("payment issued moves to awaiting_payment as good news, not an interrupt", async () => {
    const w = world({ state: "estimate_sent" });
    reply(w.db, "adjuster@progressive.test", "Payment", "A check was mailed today.");
    w.ctx.llm = llmReturning({ kind: "payment_issued", asks: [] });
    await insurerStep(w.ctx, w.c, []);
    expect(w.db.tables.claim_insurer_track[0].state).toBe("awaiting_payment");
    expect(w.notices.find((n) => /on its way/.test(n.title))?.severity).toBe("success");
  });
});

describe("item 11: settlement offers (min_accept_pct = 100; below it is always Jared's decision)", () => {
  it("pure rule: 100% or more is accepted; anything lower goes to Jared, with the percentage", () => {
    expect(settlementDecision(2184.5, 2184.5, 100)).toEqual({ decision: "accept", pct: 100 });
    expect(settlementDecision(2500, 2184.5, 100).decision).toBe("accept");
    expect(settlementDecision(2184.499, 2184.5, 100).decision).toBe("accept");     // rounding below half a cent only
    expect(settlementDecision(2184.49, 2184.5, 100).decision).toBe("jared");      // a cent short is still short: Jared decides
    expect(settlementDecision(2000, 2184.5, 100)).toMatchObject({ decision: "jared", pct: 91.55 });
    expect(settlementDecision(0, 2184.5, 100).decision).toBe("jared");
    expect(offerPlan(1000, 2000, 100).decision).toBe("jared");
  });
  it("an offer at the full estimate is accepted, in Claims Closer's words, for exactly that amount", async () => {
    const w = world({ state: "estimate_sent" });
    reply(w.db, "adjuster@progressive.test", "Offer", "We will pay $2,184.50 for this claim.");
    w.ctx.llm = llmReturning({ kind: "offer", amount: 2184.5, asks: [] });
    await insurerStep(w.ctx, w.c, []);
    const m = w.net.mails.find((x) => /settlement accepted/.test(x.subject));
    expect(m).toBeTruthy();
    expect(m.text).toContain("$2,184.50");
    expect(w.db.tables.claim_insurer_track[0].state).toBe("awaiting_payment");
    expect(w.db.tables.claim_decisions.some((d) => d.kind === "settlement" && d.chosen === "accept")).toBe(true);
  });
  it("an offer below 100% sends NOTHING (no counter, no partial acceptance) and asks Jared with buttons", async () => {
    const w = world({ state: "estimate_sent" });
    reply(w.db, "adjuster@progressive.test", "Offer", "We can pay $1,500 to settle.");
    w.ctx.llm = llmReturning({ kind: "offer", amount: 1500, asks: [] });
    await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(0); expect(w.net.calls).toHaveLength(0);
    const qq = w.db.tables.claim_questions.find((x) => /^insurer-offer-/.test(x.key));
    expect(qq.question).toMatch(/68\.67%/);
    expect(qq.options.map((o: any) => o.value)).toEqual(["accept", "hold", "mine"]);
    expect(qq.meta.amount).toBe(1500);
    expect(w.db.tables.claim_insurer_track[0].state).toBe("estimate_sent");
  });
  it("Jared taps 'Ask them to look again at the full estimate': the email restates only the full estimate, never his words or the low number", async () => {
    const w = world({ state: "estimate_sent" });
    reply(w.db, "adjuster@progressive.test", "Offer", "We can pay $1,500 to settle.");
    w.ctx.llm = llmReturning({ kind: "offer", amount: 1500, asks: [] });
    await insurerStep(w.ctx, w.c, []);
    Object.assign(w.db.tables.claim_questions.find((x) => /^insurer-offer-/.test(x.key)), { answer: "hold", answered_at: iso(0), answered_by: "jared" });
    await answeredQuestions(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(1);
    expect(w.net.mails[0].text).toContain("$2,184.50");
    expect(w.net.mails[0].text).not.toContain("1,500");
    expect(w.net.mails[0].text).not.toMatch(/counter|offer/i);
  });
  it("Jared taps 'Accept': accepts that exact amount and nothing else", async () => {
    const w = world({ state: "estimate_sent" });
    reply(w.db, "adjuster@progressive.test", "Offer", "We can pay $1,500 to settle.");
    w.ctx.llm = llmReturning({ kind: "offer", amount: 1500, asks: [] });
    await insurerStep(w.ctx, w.c, []);
    Object.assign(w.db.tables.claim_questions.find((x) => /^insurer-offer-/.test(x.key)), { answer: "accept", answered_at: iso(0), answered_by: "jared" });
    await answeredQuestions(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(1);
    expect(w.net.mails[0].text).toContain("$1,500");
    expect(w.db.tables.claim_insurer_track[0].state).toBe("awaiting_payment");
  });
  it("an amount the model made up (not written in the mail) is dropped, so it can never be accepted", () => {
    const r = verifyInsurerRead({ kind: "offer", amount: 9999, asks: [] }, "We will review and get back to you.");
    expect(r.amount).toBeNull(); expect(r.kind).toBe("other");
  });
});

describe("item 9: chasing until paid", () => {
  it("does not chase before the delay; chases after it, spaced out, and counts", async () => {
    const early = world({ state: "estimate_sent", nextChaseInHours: 20, chaseCount: 0 });
    await insurerStep(early.ctx, early.c, []);
    expect(early.net.mails).toHaveLength(0);
    const due = world({ state: "estimate_sent", nextChaseInHours: -1, chaseCount: 0 });
    await insurerStep(due.ctx, due.c, []);
    expect(due.net.mails).toHaveLength(1);
    expect(due.net.mails[0].subject).toMatch(/Following up/);
    expect(due.db.tables.claim_insurer_track[0].chase_count).toBe(1);
    expect(Date.parse(due.db.tables.claim_insurer_track[0].next_chase_at)).toBeGreaterThan(Date.now() + 40 * H);
  });
  it("after the last allowed chase it stops and tells Jared the decision, once", async () => {
    const w = world({ state: "awaiting_payment", nextChaseInHours: -1, chaseCount: MAX_CHASES });
    await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(0);
    expect(w.db.tables.claim_insurer_track[0].state).toBe("stalled");
    expect(w.notices.filter((n) => /not answering/.test(n.title))).toHaveLength(1);
  });
  it("a hold stops the chase too", async () => {
    const w = world({ state: "estimate_sent", nextChaseInHours: -1, hold: true });
    await insurerStep(w.ctx, w.c, []);
    expect(w.net.mails).toHaveLength(0); expect(w.net.calls).toHaveLength(0);
  });
});

describe("outside claims (Kemper 26123598964)", () => {
  const kemper = (db: FakeDb, o: any = {}) => db.seed("claim_outside_claims", [{ label: "Kemper check for the Tesla Collision repair", insurer_name: "Kemper", claim_no: "26123598964", adjuster_name: "Sunshine Kennedy",
    adjuster_email: null, adjuster_phone: null, state: "open", chase_count: 0, reply_due_at: iso(-1), next_chase_at: iso(-1), notes: [{ note: "escalate to supervisor Terrell Frasier, 800-353-6737 ext. 1512117" }], ...o }])[0];
  it("waits until its deadline; at the deadline with no contact it asks Jared and repeats Jared's own supervisor note", async () => {
    const w = world(); kemper(w.db, { next_chase_at: iso(30), reply_due_at: iso(30) });
    const n: string[] = [];
    await outsideClaimsStep(w.ctx, n);
    expect(w.notices).toHaveLength(0);
    w.db.tables.claim_outside_claims[0].next_chase_at = iso(-1); w.db.tables.claim_outside_claims[0].reply_due_at = iso(-1);
    await outsideClaimsStep(w.ctx, n);
    expect(w.notices).toHaveLength(1);
    expect(w.notices[0].body).toMatch(/Terrell Frasier/);
    expect(w.net.mails).toHaveLength(0);
  });
  it("with an adjuster email it chases from jared@bestly.tech; an outbound hold on some other case does not matter, draft_only does", async () => {
    const w = world({ hold: true }); kemper(w.db, { adjuster_email: "sunshine@kemper.test" });
    await outsideClaimsStep(w.ctx, []);
    expect(w.net.mails).toHaveLength(1);
    expect(w.net.mails[0].from).toBe("Jared Best <jared@bestly.tech>");
    expect(w.net.mails[0].text).toContain("26123598964");
    expect(w.db.tables.claim_outside_claims[0].chase_count).toBe(1);
    const d = world({ mode: "draft_only" }); kemper(d.db, { adjuster_email: "sunshine@kemper.test" });
    await outsideClaimsStep(d.ctx, []);
    expect(d.net.mails).toHaveLength(0);
  });
  it("the chase rule is pure and capped", () => {
    expect(outsideClaimNext({ state: "paid" }, Date.now())).toBe("done");
    expect(outsideClaimNext({ state: "open", chase_count: MAX_CHASES }, Date.now())).toBe("stalled");
    expect(outsideClaimNext({ state: "open", next_chase_at: iso(5) }, Date.now())).toBe("wait");
    expect(outsideClaimNext({ state: "open", next_chase_at: iso(-1), adjuster_phone: "+1800" }, Date.now())).toBe("chase_call");
    expect(outsideClaimNext({ state: "open", next_chase_at: iso(-1) }, Date.now())).toBe("need_contact");
  });
});

describe("every insurer template passes the same guards the guest messages do", () => {
  it("no reviews, no Turo voice, no plan or deductible figures, and no dollar figure other than the amounts it is given", async () => {
    const { reviewGuard, planGuard, moneyGuard } = await import("../../../supabase/functions/claims-closer/guards.ts");
    const T = await import("../../../supabase/functions/claims-closer/insurer-text.ts");
    const c = { car: "2020 Tesla Model 3", vin: "5YJ3E1EA0LF000001" }; const t = { insurer_name: "Progressive", policy_no: "870703450", policy_holder: "Essence Bonner Harris", claim_no: "26-4455-8890" };
    const mails = [T.openClaimEmail(c, t, { estimate: 2184.5, shop: "AGC Collision Center", lossDate: "October 26", photos: 3 }), T.sendEstimateEmail(c, t, { estimate: 2184.5, shop: null, photos: 2 }),
      T.chaseEmail(c, t, 1), T.chaseEmail(c, t, 3), T.acceptOfferEmail(c, t, 2184.5), T.holdForFullEmail(c, t, 2184.5), T.documentsEmail(c, t, { estimate: 2184.5, photos: 2, sent: ["2 photos of the damage"] })];
    for (const m of mails) {
      const text = `${m.subject}\n\n${m.text}`;
      expect(reviewGuard(text).ok, text).toBe(true);
      expect(planGuard(text), text).toBe(true);
      expect(moneyGuard(text, [2184.5]), text).toBe(true);
      expect(text).not.toMatch(/\.\.\./);
      expect(text).not.toMatch(/\b(1[3-9]|2[0-4]):\d{2}\b/);
    }
    const calls = [T.openClaimCallScript(c, t, { estimate: 2184.5 }), T.chaseCallScript(c, t)];
    for (const s of calls) { expect(planGuard(s)).toBe(true); expect(reviewGuard(s).ok).toBe(true); expect(s).toMatch(/Do not agree to any settlement/); }
  });
});
