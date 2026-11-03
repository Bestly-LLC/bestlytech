// Items 1, 2, 4, 10, 12 on the edge side: self-answer, the deadline engine, path choice, Tesla estimates, booking in auto mode.
// Real modules, in-memory database, captured network. Nothing is sent anywhere.
import { beforeEach, describe, expect, it } from "vitest";
import { autoBookStep, deadlineStep, escalationNote, teslaStep, teslaTotalAnswer } from "../../../supabase/functions/claims-closer/engine.ts";
import { answeredQuestions, freeDropoffs } from "../../../supabase/functions/claims-closer/booking.ts";
import { selfAnswerShop } from "../../../supabase/functions/claims-closer/estimates.ts";
import { FakeDb, captureNetwork, makeCtx, uid } from "./fakeDb";

const H = 36e5;
const iso = (hours: number) => new Date(Date.now() + hours * H).toISOString();
const SETTINGS = { id: true, insurer_contact_mode: "full", booking_mode: "auto", min_accept_pct: 100, deadline_lead_hours: 72, booking_buffer_hours: 4 };

function world(o: { hold?: boolean; gateOk?: boolean; escalateInHours?: number; estimate?: number | null; invoices?: any[]; turoStatus?: string; insurer?: any } = {}) {
  const db = new FakeDb(); const net = captureNetwork();
  const c: any = db.seed("claim_cases", [{ reservation_id: 62622707, guest_first: "Cody", guest_last: "T", status: "waiting_guest", history: false, path: "resolve_directly", vin: "5YJ3E1EA0LF000001",
    opened_at: iso(-24 * 17), escalate_by: iso(o.escalateInHours ?? 40), estimate_amount: o.estimate === undefined ? 900 : o.estimate, invoices: o.invoices ?? [{ amount: 900, due_text: null, paid: false, kind: "damage" }],
    outbound_hold: !!o.hold, outbound_hold_reason: o.hold ? "hold for test" : null, turo_status: o.turoStatus ?? null, insurer: o.insurer ?? {}, repair_booking: null }])[0];
  db.seed("claims_autonomy_settings", [SETTINGS]);
  db.rpcs.claims_gate = () => ({ ok: o.gateOk !== false, live: false, reason: o.gateOk === false ? "waiting for Complete trip" : "open" });
  db.rpcs.claims_ask = (a) => {
    const have = (db.tables.claim_questions ?? []).find((x) => x.case_id === a.p_case && x.key === a.p_key);
    if (have) return have.id;
    return db.seed("claim_questions", [{ case_id: a.p_case, key: a.p_key, kind: a.p_kind, question: a.p_question, options: a.p_options ?? [], asked_at: iso(0), answer: null, answered_at: null, handled_at: null, meta: {} }])[0].id;
  };
  db.rpcs.claims_set_windows = (a) => { for (const w of a.p_windows) { const have = (db.tables.claim_windows ??= []).find((x) => x.case_id === a.p_case && x.kind === w.kind); if (have) Object.assign(have, w); else db.seed("claim_windows", [{ case_id: a.p_case, ...w }]); } return { ok: true }; };
  db.rpcs.claims_add_estimate = (a) => { db.seed("claim_estimates", [{ case_id: a.p_case, shop_id: db.tables.claim_shops?.find((s) => s.slug === a.p_shop_slug)?.id, status: "received", amount: a.p_amount, oem: a.p_oem, ref: "TS-1", line_items: {} }]); return { ok: true }; };
  const { ctx, events, notices } = makeCtx(db);
  return { db, net, ctx, c, events, notices };
}
const sent = (db: FakeDb) => (db.tables.claims_send_log ?? []);

describe("item 2: deadline engine", () => {
  let w: ReturnType<typeof world>;
  it("stores every window and, 40 hours before resolve-directly ends with nothing paid, queues a move to a Turo claim", async () => {
    w = world();
    const notes: string[] = [];
    await deadlineStep(w.ctx, w.c, SETTINGS, notes);
    expect((w.db.tables.claim_windows ?? []).some((x) => x.kind === "resolve_directly")).toBe(true);
    const acts = (w.db.tables.claim_turo_actions ?? []).filter((a) => a.kind === "escalate");
    expect(acts).toHaveLength(1);
    expect(acts[0].payload.message).toContain("$900");          // the estimate is the only dollar figure
    expect(acts[0].payload.message).not.toMatch(/deductible|plan|cap\b|review/i);
    expect((w.db.tables.claim_drafts ?? []).filter((d) => d.kind === "escalation")).toHaveLength(1);   // paste-ready fallback for Jared
    expect(w.notices.some((n) => /moving to a Turo claim/.test(n.title) && /Claims Closer|Turo reader/.test(n.body + n.title))).toBe(true);
    expect(notes).toContain("queued a Turo claim");
  });
  it("does not queue a second one on the next tick", async () => {
    w = world();
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    expect((w.db.tables.claim_turo_actions ?? []).filter((a) => a.kind === "escalate")).toHaveLength(1);
  });
  it("an outbound hold blocks it, says so once a day, and does not work around it", async () => {
    w = world({ hold: true });
    const notes: string[] = [];
    await deadlineStep(w.ctx, w.c, SETTINGS, notes);
    expect(w.db.tables.claim_turo_actions ?? []).toHaveLength(0);
    expect(w.notices.some((n) => /blocked/.test(n.title) && /hold/.test(n.body))).toBe(true);
    expect(sent(w.db).some((l) => l.decision === "blocked" && l.code === "hold" && l.channel === "turo_action")).toBe(true);
    expect(w.net.mails).toHaveLength(0); expect(w.net.calls).toHaveLength(0);
  });
  it("the return gate blocks it too (the trip is not complete yet)", async () => {
    w = world({ gateOk: false });
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    expect(w.db.tables.claim_turo_actions ?? []).toHaveLength(0);
    expect(sent(w.db).some((l) => l.code === "gate_closed")).toBe(true);
  });
  it("a paid damage invoice means no escalation at all", async () => {
    w = world({ invoices: [{ amount: 900, paid: true, kind: "damage" }] });
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    expect(w.db.tables.claim_turo_actions ?? []).toHaveLength(0);
  });
  it("a paid INCIDENTAL invoice does not count: the damage is still unpaid, so it still escalates", async () => {
    w = world({ invoices: [{ amount: 122.33, paid: true, kind: "incidental" }] });
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    expect((w.db.tables.claim_turo_actions ?? []).filter((a) => a.kind === "escalate")).toHaveLength(1);
  });
  it("an expired invoice with the Turo claim window still open escalates urgently", async () => {
    w = world({ escalateInHours: 24 * 5, turoStatus: "EXPIRED" });
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    const a = (w.db.tables.claim_turo_actions ?? []).find((x) => x.kind === "escalate");
    expect(a.payload.urgent).toBe(true);
    expect(a.payload.why).toMatch(/expired|declined/);
  });
  it("far from any deadline it does nothing", async () => {
    w = world({ escalateInHours: 24 * 15 });
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    expect(w.db.tables.claim_turo_actions ?? []).toHaveLength(0);
  });
  it("every route closed (Willie's shape): asks Jared once, sends nothing, queues nothing", async () => {
    w = world({ escalateInHours: -24 * 4, estimate: null, turoStatus: "EXPIRED", invoices: [{ amount: 500, paid: false, kind: "damage" }] });
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    const qs = (w.db.tables.claim_questions ?? []).filter((x) => /^path-exhausted-/.test(x.key));
    expect(qs).toHaveLength(1);
    expect(qs[0].options.map((o: any) => o.value)).toEqual(["absorb", "mine"]);
    expect(w.db.tables.claim_turo_actions ?? []).toHaveLength(0);
    expect(w.net.mails).toHaveLength(0);
  });
  it("Jared's 'Absorb it' closes the case; his typed words go nowhere", async () => {
    w = world({ escalateInHours: -24 * 4, estimate: null, turoStatus: "EXPIRED" });
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    const qq = w.db.tables.claim_questions[0];
    Object.assign(qq, { answer: "absorb", answered_at: iso(0), answered_by: "jared" });
    await answeredQuestions(w.ctx, w.c, []);
    expect(w.db.tables.claim_cases[0].status).toBe("closed");
    expect(w.net.mails).toHaveLength(0);
  });
});

describe("item 12: path choice is logged with the reason", () => {
  it("logs the route and why, and does not repeat an unchanged decision", async () => {
    const w = world({ estimate: 1000 });
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    const d = (w.db.tables.claim_decisions ?? []).filter((x) => x.kind === "path");
    expect(d).toHaveLength(1);
    expect(d[0].chosen).toMatch(/resolve_directly|turo_claim|guest_insurer/);
    expect(d[0].why.length).toBeGreaterThan(20);
    expect(d[0].options.length).toBe(3);
    expect(w.events.some((e) => e.kind === "decision" && /Route:/.test(e.title))).toBe(true);
  });
  it("with the guest's insurer on file and a Turo window closing, the Turo claim is filed as protection", async () => {
    const w = world({ estimate: 2000, insurer: { name: "Progressive", policy_no: "870703450" }, escalateInHours: 30 });
    w.c.invoice_max = 500; w.c.host_responsibility = 1500;   // resolve-directly capped, and Turo would pay little: the insurer recovers the most
    await deadlineStep(w.ctx, w.c, SETTINGS, []);
    const dec = w.db.tables.claim_decisions.find((x) => x.kind === "path");
    expect(dec.chosen).toBe("guest_insurer");
    expect(dec.why).toMatch(/Turo claim is filed too as protection|closes in/);
    expect((w.db.tables.claim_turo_actions ?? []).some((a) => a.kind === "escalate")).toBe(true);
  });
  it("the escalation note never says a deductible, plan, cap or review and carries only the estimate", () => {
    const { ctx } = world();
    const note = escalationNote(ctx, { reservation_id: 1, guest_first: "A", guest_last: "B", opened_at: iso(-100), estimate_amount: 900 });
    expect(note).toMatch(/\$900/);
    expect(note).not.toMatch(/deductible|plan|\bcap\b|review|rating/i);
  });
});

describe("item 4: Tesla Service is a first-class estimate source", () => {
  const tesla = (db: FakeDb, subject: string, body: string) => db.seed("bestly_mail", [{ from_addr: "service@tesla.com", subject, body_text: body, sent_at: iso(-2) }])[0];
  it("reads the total from a Tesla estimate mail and adds it as an OEM estimate for the one open case", async () => {
    const w = world({ estimate: null });
    w.db.seed("claim_shops", [{ slug: "tesla-service", name: "Tesla Service", oem_only: true }]);
    tesla(w.db, "Your Tesla Service estimate", "Collision Center estimate #EST-45671\nEstimated total: $2,184.50\nRepair of passenger-side door.");
    const notes: string[] = [];
    await teslaStep(w.ctx, w.c, notes);
    const e = w.db.tables.claim_estimates[0];
    expect(Number(e.amount)).toBe(2184.5); expect(e.oem).toBe(true);
    expect(notes.join()).toMatch(/Tesla estimate \$2184.5/);
    // not twice
    await teslaStep(w.ctx, w.c, []);
    expect(w.db.tables.claim_estimates).toHaveLength(1);
  });
  it("never invents a total: a Tesla mail with no number asks Jared to type it (the note is an input, not outgoing text)", async () => {
    const w = world({ estimate: null });
    w.db.seed("claim_shops", [{ slug: "tesla-service", name: "Tesla Service", oem_only: true }]);
    tesla(w.db, "Your estimate is ready", "Your Tesla Service estimate is ready in the app. Open the Tesla app to review it.");
    await teslaStep(w.ctx, w.c, []);
    expect(w.db.tables.claim_estimates ?? []).toHaveLength(0);
    const qq = w.db.tables.claim_questions.find((x) => /^tesla-total-/.test(x.key));
    expect(qq).toBeTruthy();
    expect(await teslaTotalAnswer(w.ctx, w.c, "it was 1,850 total")).toBe(true);
    expect(Number(w.db.tables.claim_estimates[0].amount)).toBe(1850);
    expect(await teslaTotalAnswer(w.ctx, w.c, "no idea")).toBe(false);
    expect(w.net.mails).toHaveLength(0);
  });
  it("does not attach an unnamed Tesla mail when more than one open case is waiting", async () => {
    const w = world({ estimate: null });
    w.db.seed("claim_cases", [{ reservation_id: 59754331, guest_first: "Willie", history: false, status: "waiting_guest", estimate_amount: null, invoices: [] }]);
    w.db.seed("claim_shops", [{ slug: "tesla-service", name: "Tesla Service" }]);
    tesla(w.db, "Your Tesla Service estimate", "Estimated total: $2,000.00");
    await teslaStep(w.ctx, w.c, []);
    expect(w.db.tables.claim_estimates ?? []).toHaveLength(0);
  });
  it("attaches it when the mail names the car's VIN, even with two open cases", async () => {
    const w = world({ estimate: null });
    w.db.seed("claim_cases", [{ reservation_id: 59754331, guest_first: "Willie", history: false, status: "waiting_guest", estimate_amount: null, invoices: [] }]);
    w.db.seed("claim_shops", [{ slug: "tesla-service", name: "Tesla Service" }]);
    tesla(w.db, "Your Tesla Service estimate", `VIN 5YJ3E1EA0LF000001\nEstimated total: $2,000.00`);
    await teslaStep(w.ctx, w.c, []);
    expect(w.db.tables.claim_estimates).toHaveLength(1);
  });
});

describe("item 10: booking in auto mode", () => {
  const shop = (db: FakeDb, o: any) => db.seed("claim_shops", [{ name: "AGC Collision Center", phone: "+13105550101", slug: "agc", ...o }])[0];
  it("starts the booking itself once the money is assured (damage invoice paid), and logs why", async () => {
    const w = world({ invoices: [{ amount: 900, paid: true, kind: "damage" }] });
    const s = shop(w.db, {}); w.c.chosen_shop_id = s.id;
    await autoBookStep(w.ctx, w.c, SETTINGS, []);
    expect(w.db.tables.claim_cases[0].repair_booking.state).toBe("requested");
    expect(w.db.tables.claim_cases[0].repair_booking.auto).toBe(true);
    expect(w.events.some((e) => e.kind === "booking" && /on its own/.test(e.title))).toBe(true);
  });
  it("does not front the repair: no assured money, no booking", async () => {
    const w = world();
    w.c.chosen_shop_id = shop(w.db, {}).id;
    const notes: string[] = [];
    await autoBookStep(w.ctx, w.c, SETTINGS, notes);
    expect(w.db.tables.claim_cases[0].repair_booking).toBeNull();
    expect(notes.join()).toMatch(/not booking yet/);
  });
  it("confirm mode never books by itself", async () => {
    const w = world({ invoices: [{ amount: 900, paid: true, kind: "damage" }] });
    w.c.chosen_shop_id = shop(w.db, {}).id;
    await autoBookStep(w.ctx, w.c, { ...SETTINGS, booking_mode: "confirm" }, []);
    expect(w.db.tables.claim_cases[0].repair_booking).toBeNull();
  });
  it("Tesla Service (booked in the Tesla app) goes to Jared as one question, not a phone call", async () => {
    const w = world({ invoices: [{ amount: 900, paid: true, kind: "damage" }] });
    w.c.chosen_shop_id = shop(w.db, { slug: "tesla-service", name: "Tesla Service", phone: null }).id;
    await autoBookStep(w.ctx, w.c, SETTINGS, []);
    expect(w.db.tables.claim_cases[0].repair_booking).toBeNull();
    expect(w.db.tables.claim_questions.some((x) => /^booking-nopath-/.test(x.key))).toBe(true);
    expect(w.net.calls).toHaveLength(0);
  });
  it("offers drop-off times that avoid booked Turo trips plus the buffer", async () => {
    const w = world();
    // a trip that blocks tomorrow through the day after
    w.db.seed("turo_trips", [{ reservation_id: 1, starts_at: iso(8), ends_at: iso(60), vin: "5YJ3E1EA0LF000001", status: "BOOKED" }]);
    const slots = await freeDropoffs(w.ctx, w.c, 3);
    expect(slots.length).toBeGreaterThan(0);
    for (const t of slots) {
      const pick = t + 3 * 24 * H + 2 * H;
      expect(Date.parse(iso(8)) < pick + 4 * H && Date.parse(iso(60)) > t - 4 * H).toBe(false);
    }
  });
});

describe("item 1: answering a shop from the record before asking Jared", () => {
  let w: ReturnType<typeof world>;
  const shopRow = () => w.db.seed("claim_shops", [{ name: "Pristine Collision Center", email: "est@pristine.test", contact_name: "Dana Smith" }])[0];
  beforeEach(() => { w = world({ estimate: null }); });
  it("answers VIN + 'found you online' + photos with no question to Jared", async () => {
    const s = shopRow();
    w.db.seed("claim_evidence", [{ case_id: w.c.id, kind: "after", storage_path: "p/1.jpg", bytes: 10, taken_at: iso(-30) }]);
    w.db.files["p/1.jpg"] = new Uint8Array([1, 2, 3]);
    const e = w.db.seed("claim_estimates", [{ case_id: w.c.id, shop_id: s.id, ref: "CC-1", status: "needs_visit", requested_at: iso(-10), line_items: {} }])[0];
    await selfAnswerShop(w.ctx, w.c, e, s, "est@pristine.test", "VIN, how you heard about us, better photos", "2026-10-28T10:00:00Z", []);
    expect(w.net.mails).toHaveLength(1);
    const m = w.net.mails[0];
    expect(m.from).toMatch(/jared@bestly\.tech/); expect(m.from).not.toMatch(/gmail/i);
    expect(m.text).toContain("The VIN is 5YJ3E1EA0LF000001");
    expect(m.text).toContain("Found you online");
    expect(m.attachments.some((a: any) => /damage-1\.jpg/.test(a.filename))).toBe(true);
    expect(w.db.tables.claim_questions ?? []).toHaveLength(0);
    expect(w.db.tables.claim_estimates[0].status).toBe("requested");
    expect(w.db.tables.claim_estimates[0].requested_at).toBe(e.requested_at);   // the follow-up clocks are not restarted
  });
  it("a repeat of the same request is not answered twice (idempotent key), and a money or booking ask is left alone", async () => {
    const s = shopRow();
    const e = w.db.seed("claim_estimates", [{ case_id: w.c.id, shop_id: s.id, ref: "CC-2", status: "needs_visit", requested_at: iso(-10), line_items: {} }])[0];
    await selfAnswerShop(w.ctx, w.c, e, s, "est@pristine.test", "Is the deductible paid? What day can you drop it off?", "2026-10-28T10:00:00Z", []);
    expect(w.net.mails).toHaveLength(0);          // not in a box it can answer: left alone, not guessed
    expect(w.db.tables.claim_questions ?? []).toHaveLength(0);   // and not turned into a question either
  });
  it("with a hold on the case the answer waits instead of sending", async () => {
    w = world({ estimate: null, hold: true });
    const s = shopRow();
    const e = w.db.seed("claim_estimates", [{ case_id: w.c.id, shop_id: s.id, ref: "CC-3", status: "needs_visit", requested_at: iso(-10), line_items: {} }])[0];
    const notes: string[] = [];
    await selfAnswerShop(w.ctx, w.c, e, s, "est@pristine.test", "VIN", "2026-10-28T10:00:00Z", notes);
    expect(w.net.mails).toHaveLength(0);
    expect(w.db.tables.claim_estimates[0].line_items.self_answer_pending).toBeTruthy();
    expect(notes.join()).toMatch(/waiting for the gate or a hold/);
  });
});

void uid;
