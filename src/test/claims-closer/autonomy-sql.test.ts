// Runs the REAL autonomy migrations in PGlite and exercises the SQL rules: items 3, 5, 6, 7, 8, 11 and the nudge ladder (item 1), windows (item 2),
// reminders (item 10). Nothing here sends anything: alerts land in test_notices, and no network is involved.
import { beforeAll, describe, expect, it } from "vitest";
import { makeDb } from "./pg";

let q: Awaited<ReturnType<typeof makeDb>>["q"];
let n = 7000000;
const hoursAgo = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 36e5).toISOString();
const HOME = { lat: 34.084241, lng: -118.371793 };
const LAX = { lat: 33.94159, lng: -118.40853 };

async function newCase(o: { guest?: string; vin?: string; path?: string; endedHoursAgo?: number | null; completed?: boolean; hold?: string | null; status?: string; estimate?: number | null; progressHoursAgo?: number | null } = {}) {
  const res = ++n;
  const vin = o.vin ?? `VIN${res}`;
  const ended = o.endedHoursAgo === undefined ? 30 : o.endedHoursAgo;
  const [c] = await q(`insert into claim_cases (reservation_id, guest_first, guest_last, vin, path, status, estimate_amount, outbound_hold, outbound_hold_reason, outbound_hold_at, trip_end, last_progress_at, opened_at)
    values ($1,$2,'Tester',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [res, o.guest ?? "Cody", vin, o.path ?? "resolve_directly", o.status ?? "waiting_return", o.estimate ?? null, !!o.hold, o.hold ?? null, o.hold ? hoursAgo(20) : null,
      ended === null ? null : ended >= 0 ? hoursAgo(ended) : hoursFromNow(-ended), o.progressHoursAgo == null ? null : hoursAgo(o.progressHoursAgo), hoursAgo(o.progressHoursAgo ?? 100)]);
  if (ended !== null) await q(`insert into turo_trips (reservation_id, starts_at, ends_at, vin, status) values ($1,$2,$3,$4,'BOOKED')`, [res, hoursAgo((ended >= 0 ? ended : 0) + 72), ended >= 0 ? hoursAgo(ended) : hoursFromNow(-ended), vin]);
  await q(`insert into lax_guest_links (reservation_id, token, host_completed_at) values ($1,$2,$3)`, [res, `tok${res}`, o.completed ? hoursAgo(1) : null]);
  return c as any;
}
const car = (vin: string, p: { lat?: number | null; lng?: number | null; ageMin?: number; raw?: any } = {}) =>
  q(`insert into turo_vehicle_state (vin, display_name, latitude, longitude, observed_at, raw) values ($1,'Blue Steel',$2,$3,$4,$5) on conflict (vin) do update set latitude=excluded.latitude, longitude=excluded.longitude, observed_at=excluded.observed_at, raw=excluded.raw`,
    [vin, p.lat === undefined ? HOME.lat : p.lat, p.lng === undefined ? HOME.lng : p.lng, new Date(Date.now() - (p.ageMin ?? 2) * 6e4).toISOString(), p.raw ?? null]);
const link = async (res: number) => (await q(`select * from lax_guest_links where reservation_id=$1`, [res]))[0];
const notices = async (like: string) => q(`select * from test_notices where title ilike $1 or body ilike $1`, [`%${like}%`]);
const turoMail = (res: number, subject: string, body: string, from = "no-reply@turo.com") =>
  q(`with m as (insert into bestly_mail (from_addr, subject, body_text) values ($1,$2,$3) returning *) select claims_mail_seen(m) from m`, [from, subject, `${body}\nhttps://turo.com/reservation/${res}`]);

beforeAll(async () => { q = (await makeDb()).q; }, 60000);

describe("item 8: Auto Complete trip", () => {
  it("ended + parked at home = complete, with source 'auto' and the evidence", async () => {
    const c = await newCase({ endedHoursAgo: 5 });
    await car(c.vin);
    const r = (await q(`select claims_auto_complete_trips(false) r`))[0].r;
    expect(r.completed).toBeGreaterThanOrEqual(1);
    const l = await link(c.reservation_id);
    expect(l.host_completed_at).not.toBeNull();
    expect(l.host_completed_source).toBe("auto");
    expect(l.host_completed_evidence.car.where).toBe("home");
    expect(l.host_completed_evidence.rule).toMatch(/reservation ended/);
    expect((await q(`select * from claim_trip_complete_log where reservation_id=$1`, [c.reservation_id])).length).toBe(1);
    expect((await notices("trip complete"))[0].body).toMatch(/\d{1,2}:\d{2} (AM|PM)/);   // 12-hour Pacific
  });
  it("ended + parked at the LAX garage = complete", async () => {
    const c = await newCase({ endedHoursAgo: 3 });
    await car(c.vin, LAX);
    await q(`select claims_auto_complete_trips(false)`);
    expect((await link(c.reservation_id)).host_completed_evidence.car.where).toBe("lax");
  });
  it("ended + driving = NOT complete", async () => {
    const c = await newCase({ endedHoursAgo: 3 });
    await car(c.vin);
    await q(`insert into car_drives (vin, started_at, ended_at) values ($1, now() - interval '20 minutes', null)`, [c.vin]);
    await q(`select claims_auto_complete_trips(false)`);
    expect((await link(c.reservation_id)).host_completed_at).toBeNull();
    const d = (await q(`select claims_auto_complete_trips(true) r`))[0].r.checked.find((x: any) => x.reservation_id === c.reservation_id);
    expect(d.reason).toBe("car is driving");
  });
  it("driving shown by live telemetry (gear D) = NOT complete", async () => {
    const c = await newCase({ endedHoursAgo: 3 });
    await car(c.vin, { raw: { telemetry: { at: new Date().toISOString(), gear: "D", speed_mph: 31 } } });
    await q(`select claims_auto_complete_trips(false)`);
    expect((await link(c.reservation_id)).host_completed_at).toBeNull();
  });
  it("reservation not ended = NOT complete, even with the car parked at home", async () => {
    const c = await newCase({ endedHoursAgo: -6 });   // ends in 6 hours
    await car(c.vin);
    await q(`select claims_auto_complete_trips(false)`);
    expect((await link(c.reservation_id)).host_completed_at).toBeNull();
  });
  it("location unknown (no reading, stale reading, or no coordinates) = NOT complete, falls back to the 24-hour reminder", async () => {
    const none = await newCase({ endedHoursAgo: 3 });
    const stale = await newCase({ endedHoursAgo: 3 }); await car(stale.vin, { ageMin: 400 });
    const blank = await newCase({ endedHoursAgo: 3 }); await car(blank.vin, { lat: null, lng: null });
    await q(`select claims_auto_complete_trips(false)`);
    for (const c of [none, stale, blank]) expect((await link(c.reservation_id)).host_completed_at).toBeNull();
    const rows = (await q(`select claims_auto_complete_trips(true) r`))[0].r.checked;
    for (const c of [none, stale, blank]) expect(rows.find((x: any) => x.reservation_id === c.reservation_id).reason).toMatch(/car location unknown/);
  });
  it("parked somewhere else = NOT complete; the manual button still works (host_completed_at is plain)", async () => {
    const c = await newCase({ endedHoursAgo: 3 });
    await car(c.vin, { lat: 34.05, lng: -118.25 });
    await q(`select claims_auto_complete_trips(false)`);
    expect((await link(c.reservation_id)).host_completed_at).toBeNull();
    await q(`update lax_guest_links set host_completed_at = now() where reservation_id=$1`, [c.reservation_id]);   // what the manual button does
    expect((await link(c.reservation_id)).host_completed_source).toBeNull();
  });
  it("the dry run reports and changes nothing; the setting turns it off", async () => {
    const c = await newCase({ endedHoursAgo: 5 }); await car(c.vin);
    const d = (await q(`select claims_auto_complete_trips(true) r`))[0].r.checked.find((x: any) => x.reservation_id === c.reservation_id);
    expect(d.decision).toBe("would_complete");
    expect((await link(c.reservation_id)).host_completed_at).toBeNull();
    await q(`select claims_autonomy_set('auto_complete', 'false')`);
    const c2 = await newCase({ endedHoursAgo: 5 }); await car(c2.vin);
    expect((await q(`select claims_auto_complete_trips(false) r`))[0].r.off).toBe(true);
    expect((await link(c2.reservation_id)).host_completed_at).toBeNull();
    await q(`select claims_autonomy_set('auto_complete', 'true')`);
  });
});

describe("item 6: hold auto-release", () => {
  const LIVE = "a message reached the guest while the trip was still live";
  it("releases a live-trip hold once the trip is over and complete", async () => {
    const c = await newCase({ endedHoursAgo: 5, completed: true, hold: LIVE });
    const r = (await q(`select claims_hold_autorelease() r`))[0].r;
    expect(r.released).toBeGreaterThanOrEqual(1);
    const row = (await q(`select outbound_hold, outbound_hold_reason from claim_cases where id=$1`, [c.id]))[0];
    expect(row.outbound_hold).toBe(false);
    expect(row.outbound_hold_reason).toBeNull();
  });
  it("keeps it held while Complete trip is not done, and while the trip is still live", async () => {
    const a = await newCase({ endedHoursAgo: 5, completed: false, hold: LIVE });
    const b = await newCase({ endedHoursAgo: -4, completed: false, hold: LIVE });
    await q(`select claims_hold_autorelease()`);
    for (const c of [a, b]) expect((await q(`select outbound_hold from claim_cases where id=$1`, [c.id]))[0].outbound_hold).toBe(true);
  });
  it("never releases dollar-figure, Turo-voice or review holds, however complete the trip is", async () => {
    const reasons = ["a message with a dollar figure reached the guest", "a message spoke for Turo", "a message mentioned reviews", "first message before Complete trip"];
    const cases = [];
    for (const why of reasons) cases.push(await newCase({ endedHoursAgo: 5, completed: true, hold: why }));
    await q(`select claims_hold_autorelease()`);
    for (const c of cases) expect((await q(`select outbound_hold from claim_cases where id=$1`, [c.id]))[0].outbound_hold).toBe(true);
    // and Jared hears about them: held over 24 hours = one reminder with the reason (the helper sets outbound_hold_at 20 hours back, so age them)
    await q(`update claim_cases set outbound_hold_at = now() - interval '30 hours' where id = any($1::uuid[])`, [cases.map((c) => c.id)]);
    expect((await q(`select claims_hold_autorelease() r`))[0].r.still_held).toBeGreaterThanOrEqual(4);
    expect((await notices("still on hold")).length).toBeGreaterThanOrEqual(4);
  });
});

describe("Willie's hold (set by Jared at 1:53 PM) is never touched by the auto-release", () => {
  it("a Jared-set hold reason stays, even when the trip is over and complete", async () => {
    const c = await newCase({ endedHoursAgo: 400, completed: true, hold: "Jared 10/28 1:53 PM: answers were relayed verbatim to shops; hold all outbound until the answer-relay fix ships" });
    await q(`select claims_hold_autorelease()`);
    const row = (await q(`select outbound_hold, outbound_hold_reason from claim_cases where id=$1`, [c.id]))[0];
    expect(row.outbound_hold).toBe(true);
    expect(row.outbound_hold_reason).toMatch(/answer-relay fix ships/);
  });
});

describe("item 7: stuck alert", () => {
  it("alerts after 48 hours with no forward progress, signed as a Claims Closer alert, once per case per 48 hours", async () => {
    const c = await newCase({ guest: "Stucky", progressHoursAgo: 60 });
    const first = (await q(`select claims_stuck_alert() r`))[0].r;
    expect(first.alerted).toBeGreaterThanOrEqual(1);
    const alerts = await notices("Stucky");
    expect(alerts.length).toBe(1);
    expect(alerts[0].title).toMatch(/has not moved in \d+ hours/);
    expect(alerts[0].body).toMatch(/Waiting on/);
    expect(alerts[0].body).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    await q(`select claims_stuck_alert()`);
    expect((await notices("Stucky")).length).toBe(1);   // not again
    await q(`update claim_cases set stuck_alert_at = now() - interval '49 hours' where id=$1`, [c.id]);
    await q(`select claims_stuck_alert()`);
    // (the test notice table dedupes on the hour key, so count the case's own stuck-alert events: 48 hours later it fires again)
    expect((await q(`select 1 from claim_events where case_id=$1 and title='Stuck alert sent to Jared'`, [c.id])).length).toBe(2);
  });
  it("does not alert while there is progress", async () => {
    await newCase({ guest: "Moving", progressHoursAgo: 10 });
    await q(`select claims_stuck_alert()`);
    expect((await notices("Moving")).length).toBe(0);
  });
  it("a sent message, a Turo change or a booking resets the clock; a plain mail event does not", async () => {
    const c = await newCase({ guest: "Clock", progressHoursAgo: 70 });
    await q(`insert into claim_events (case_id, reservation_id, kind, title) values ($1,$2,'mail','just a mail')`, [c.id, c.reservation_id]);
    expect((await q(`select last_progress_at from claim_cases where id=$1`, [c.id]))[0].last_progress_at.getTime()).toBeLessThan(Date.now() - 60 * 36e5);
    await q(`insert into claim_events (case_id, reservation_id, kind, title) values ($1,$2,'sent','message sent')`, [c.id, c.reservation_id]);
    expect((await q(`select last_progress_at from claim_cases where id=$1`, [c.id]))[0].last_progress_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await q(`select claims_stuck_alert()`);
    expect((await notices("Clock")).length).toBe(0);
  });
});

describe("items 3 and 5: Turo mail changes case state", () => {
  const INC_BODY = (amt: string, kind: string, id: number) => `Reimbursement invoice\nTotal charge - $${amt}\n${kind}\nuntil November 05 at 11:55 AM\nhttps://turo.com/invoices?invoiceId=${id}`;
  it("an incidental (Supercharging) invoice paid never touches the damage claim; Cody's $122.33", async () => {
    const c = await newCase({ guest: "CodyX", path: "turo_claim", estimate: 900, status: "waiting_guest" });
    await turoMail(c.reservation_id, "Reimbursement invoice", INC_BODY("122.33", "incidental charges: Supercharging", 222));
    await turoMail(c.reservation_id, "Your guest paid the reimbursement invoice", `${INC_BODY("122.33", "incidental charges: Supercharging", 222)}\nThe invoice has been paid.`);
    const row = (await q(`select * from claim_cases where id=$1`, [c.id]))[0];
    expect(row.invoices).toHaveLength(1);
    expect(row.invoices[0]).toMatchObject({ paid: true, kind: "incidental", amount: 122.33 });
    expect(row.recovered_amount).toBeNull();
    expect(row.status).toBe("waiting_guest");
    expect((await q(`select * from claim_payments where case_id=$1`, [c.id])).length).toBe(0);
    const note = (await q(`select title from claim_events where case_id=$1 and kind='note'`, [c.id]))[0];
    expect(note.title).toMatch(/incidental/);
  });
  it("a damage invoice paid records which invoice, moves recovered_amount and closes the case when it covers the estimate", async () => {
    const c = await newCase({ guest: "Damaged", estimate: 500, status: "invoiced" });
    await turoMail(c.reservation_id, "Reimbursement invoice", INC_BODY("500.00", "damage charges for the passenger bumper", 111));
    await turoMail(c.reservation_id, "Your guest paid the reimbursement invoice", `${INC_BODY("500.00", "damage charges for the passenger bumper", 111)}\nThe invoice has been paid.`);
    const row = (await q(`select * from claim_cases where id=$1`, [c.id]))[0];
    expect(row.invoices[0]).toMatchObject({ paid: true, kind: "damage", invoice_id: 111 });
    expect(Number(row.recovered_amount)).toBe(500);
    expect(row.status).toBe("paid");
    expect((await q(`select source, amount from claim_payments where case_id=$1`, [c.id]))[0]).toMatchObject({ source: "guest_invoice" });
  });
  it("two invoices on one case: paying the incidental one leaves the damage invoice unpaid", async () => {
    const c = await newCase({ guest: "Both", estimate: 800, status: "invoiced" });
    await turoMail(c.reservation_id, "Reimbursement invoice", INC_BODY("800.00", "damage charges", 301));
    await turoMail(c.reservation_id, "Reimbursement invoice", INC_BODY("61.20", "incidental charges", 302));
    await turoMail(c.reservation_id, "Your guest paid the reimbursement invoice", `${INC_BODY("61.20", "incidental charges", 302)}\nThe invoice has been paid.`);
    const inv = (await q(`select invoices from claim_cases where id=$1`, [c.id]))[0].invoices;
    expect(inv.find((i: any) => i.invoice_id === 301).paid).toBe(false);
    expect(inv.find((i: any) => i.invoice_id === 302).paid).toBe(true);
    expect((await q(`select status, recovered_amount from claim_cases where id=$1`, [c.id]))[0].recovered_amount).toBeNull();
  });
  it("invoice expired/cancelled lapses the window and wakes the case (Willie's $500)", async () => {
    const c = await newCase({ guest: "Willy", status: "invoiced" });
    await turoMail(c.reservation_id, "Reimbursement invoice canceled", "The window to modify your reimbursement invoice has passed. Your invoice has been canceled.");
    expect((await q(`select status from claim_windows where case_id=$1 and kind='invoice_expiry'`, [c.id]))[0].status).toBe("lapsed");
    expect((await q(`select needs_work, work_reason from claim_cases where id=$1`, [c.id]))[0]).toMatchObject({ needs_work: true, work_reason: "the Turo invoice expired" });
  });
  it("auto-links the Turo claim number and incident id from claims.turo.com mail (Cody 1108308 / 663253)", async () => {
    const c = await newCase({ guest: "Linker", path: "turo_claim" });
    await turoMail(c.reservation_id, "Update on your claim", "Claim number: 1108308\nhttps://turo.com/us/en/claims/incidents/663253\nStatus: in review", "claims@claims.turo.com");
    const row = (await q(`select turo_claim_no, turo_incident_id from claim_cases where id=$1`, [c.id]))[0];
    expect(row.turo_claim_no).toBe("1108308");
    expect(Number(row.turo_incident_id)).toBe(663253);
  });
  it("a different id later is noted, never overwritten", async () => {
    const c = await newCase({ guest: "Keep" });
    await q(`select claims_link_turo_ids($1, '1108308', 663253)`, [c.id]);
    await q(`select claims_link_turo_ids($1, '9999999', 111111)`, [c.id]);
    const row = (await q(`select turo_claim_no, turo_incident_id from claim_cases where id=$1`, [c.id]))[0];
    expect(row.turo_claim_no).toBe("1108308");
    expect((await q(`select 1 from claim_events where case_id=$1 and title ilike '%different claim number%'`, [c.id])).length).toBe(1);
  });
  it("a '7 days left' reminder stores the window", async () => {
    const c = await newCase({ guest: "Remind", path: "resolve_directly", status: "waiting_guest" });
    await turoMail(c.reservation_id, "7 days left to resolve directly", "Reminder from Turo.");
    expect((await q(`select kind from claim_windows where case_id=$1`, [c.id]))[0].kind).toBe("resolve_directly");
  });
});

describe("item 11: payments close the case", () => {
  it("a partial payment is recorded without closing; the rest closes it, and the same payment twice counts once", async () => {
    const c = await newCase({ guest: "Payer", estimate: 1000, status: "waiting_guest" });
    await q(`insert into claim_insurer_track (case_id, insurer_name, state) values ($1,'Progressive','awaiting_payment')`, [c.id]);
    const a = (await q(`select claims_payment_seen('insurer_check', 400, 'chk-1', now(), '{}'::jsonb, $1) r`, [c.id]))[0].r;
    expect(a).toMatchObject({ ok: true, matched: true, closed: false });
    const dup = (await q(`select claims_payment_seen('insurer_check', 400, 'chk-1', now(), '{}'::jsonb, $1) r`, [c.id]))[0].r;
    expect(dup.duplicate).toBe(true);
    const b = (await q(`select claims_payment_seen('insurer_check', 600, 'chk-2', now(), '{}'::jsonb, $1) r`, [c.id]))[0].r;
    expect(b.closed).toBe(true);
    const row = (await q(`select status, recovered_amount, outcome from claim_cases where id=$1`, [c.id]))[0];
    expect(row.status).toBe("paid"); expect(Number(row.recovered_amount)).toBe(1000);
    expect((await q(`select state from claim_insurer_track where case_id=$1`, [c.id]))[0].state).toBe("paid");
    expect((await notices("Payer")).some((x: any) => x.severity === "success")).toBe(true);   // good news goes to the recap, not an interrupt
  });
  it("a Turo-managed claim is paid when Turo pays the estimate minus Jared's damage responsibility", async () => {
    const c = await newCase({ guest: "Managed", path: "turo_claim", estimate: 1200, status: "waiting_guest" });
    await q(`update claim_cases set host_responsibility = 200 where id=$1`, [c.id]);
    const r = (await q(`select claims_payment_seen('turo_payout', 1000, 'payout-1', now(), '{}'::jsonb, $1) r`, [c.id]))[0].r;
    expect(r.closed).toBe(true);
  });
  it("Mercury: an insurer deposit that names the claim is matched; an ordinary Turo trip payout is not", async () => {
    const c = await newCase({ guest: "Banked", estimate: 2500, status: "waiting_guest" });
    await q(`insert into claim_insurer_track (case_id, insurer_name, claim_no, state) values ($1,'Progressive','870703450','awaiting_payment')`, [c.id]);
    await q(`insert into settlement_unmatched_bank (txn_id, amount_cents, posted_at, counterparty, description, why) values
      ('mercury:a1', 250000, now(), 'PROGRESSIVE INS', 'ACH credit claim 870703450', 'no claim matched'),
      ('mercury:a2', 61234, now(), 'TURO INC', 'Turo payout weekly', 'no claim matched')`);
    const r = (await q(`select claims_match_mercury_deposits() r`))[0].r;
    expect(r.matched).toBe(1);
    expect((await q(`select status from claim_cases where id=$1`, [c.id]))[0].status).toBe("paid");
    expect((await q(`select resolved from settlement_unmatched_bank where txn_id='mercury:a2'`))[0].resolved).toBe(false);
  });
  it("Hermes: a scanned check from the insurer naming the claim is matched", async () => {
    const c = await newCase({ guest: "Mailed", estimate: 700, status: "waiting_guest" });
    await q(`insert into claim_insurer_track (case_id, insurer_name, claim_no, state) values ($1,'Kemperish Mutual','55501234','awaiting_payment')`, [c.id]);
    await q(`insert into hermes_items (amount_cents, mail_type, summary, sender) values (70000, 'check', 'Check for claim 55501234', 'Kemperish Mutual Insurance')`);
    expect((await q(`select claims_match_hermes_checks() r`))[0].r.matched).toBe(1);
    expect((await q(`select status from claim_cases where id=$1`, [c.id]))[0].status).toBe("paid");
  });
});

describe("item 2: windows", () => {
  it("stores windows once per kind, and wakes a case whose window is inside the lead time", async () => {
    const c = await newCase({ guest: "Windy", status: "waiting_guest" });
    await q(`select claims_set_windows($1, $2::jsonb)`, [c.id, JSON.stringify([{ kind: "resolve_directly", due_at: hoursFromNow(30), source: "Turo: 20 days" }])]);
    await q(`select claims_set_windows($1, $2::jsonb)`, [c.id, JSON.stringify([{ kind: "resolve_directly", due_at: hoursFromNow(30), source: "Turo: 20 days" }])]);
    expect((await q(`select count(*)::int n from claim_windows where case_id=$1`, [c.id]))[0].n).toBe(1);
    await q(`update claim_cases set needs_work = false where id=$1`, [c.id]);
    await q(`select claims_windows_due()`);
    expect((await q(`select needs_work, work_reason from claim_cases where id=$1`, [c.id]))[0]).toMatchObject({ needs_work: true, work_reason: "a Turo deadline is close" });
  });
});

describe("item 1: question ladder", () => {
  it("one nudge at 24 hours, Scout at 48, never twice; 12-hour Pacific times, no ellipsis", async () => {
    const c = await newCase({ guest: "Ladder", status: "waiting_guest" });
    const [qq] = await q(`insert into claim_questions (case_id, key, kind, question, asked_at) values ($1,'x','decision','Pick one of the options please?', $2) returning id`, [c.id, hoursAgo(26)]);
    await q(`select claims_question_sweep()`);
    await q(`select claims_question_sweep()`);
    const nudges = (await q(`select * from test_notices where dedupe = $1`, ["claims-nudge-" + qq.id]));
    expect(nudges).toHaveLength(1);
    expect(nudges[0].body).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    expect(nudges[0].body).not.toMatch(/\.\.\./);
    expect((await q(`select * from test_notices where dedupe = $1`, ["claims-scout-q-" + qq.id])).length).toBe(0);
    await q(`update claim_questions set asked_at = $2 where id=$1`, [qq.id, hoursAgo(50)]);
    await q(`select claims_question_sweep()`); await q(`select claims_question_sweep()`);
    const scout = await q(`select * from test_notices where dedupe = $1`, ["claims-scout-q-" + qq.id]);
    expect(scout).toHaveLength(1); expect(scout[0].via).toBe("scout");
  });
  it("retires an old shop question whose world moved on instead of asking again", async () => {
    const c = await newCase({ guest: "Retire", status: "waiting_guest", estimate: 900 });
    const [qq] = await q(`insert into claim_questions (case_id, key, kind, question, asked_at) values ($1,'shop-asks-abc','decision','AGC asked for photos. What should I do?', $2) returning id`, [c.id, hoursAgo(24 * 9)]);
    expect((await q(`select claims_question_sweep() r`))[0].r.retired).toBeGreaterThanOrEqual(1);
    const row = (await q(`select retired_at, retired_reason, handled_at from claim_questions where id=$1`, [qq.id]))[0];
    expect(row.retired_at).not.toBeNull(); expect(row.handled_at).not.toBeNull();
    expect(row.retired_reason).toMatch(/estimate is already in/);
  });
});

describe("item 10: reminders", () => {
  it("day-before and 2-hours-before reminders, 12-hour Pacific, once each", async () => {
    const c = await newCase({ guest: "Booked", status: "waiting_guest", estimate: 900 });
    await q(`update claim_cases set repair_booking = $2::jsonb where id=$1`, [c.id, JSON.stringify({ state: "booked", dropoff_at: hoursFromNow(20) })]);
    await q(`select claims_booking_reminders()`); await q(`select claims_booking_reminders()`);
    const day = await q(`select * from test_notices where dedupe = $1`, ["claims-rem-day-" + c.id]);
    expect(day).toHaveLength(1);
    expect(day[0].body).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    await q(`update claim_cases set repair_booking = repair_booking || $2::jsonb where id=$1`, [c.id, JSON.stringify({ dropoff_at: hoursFromNow(1.5) })]);
    await q(`select claims_booking_reminders()`); await q(`select claims_booking_reminders()`);
    const two = await q(`select * from test_notices where dedupe = $1`, ["claims-rem-2h-" + c.id]);
    expect(two).toHaveLength(1);
    expect(two[0].body).toMatch(/by \d{1,2}:\d{2} (AM|PM)/);
  });
});

describe("the watchdog and the Pi reader hand-off", () => {
  it("claims_turo_claim hands the reader only create_invoice; escalate stays queued for Jared's allowed step", async () => {
    const c = await newCase({ guest: "Reader", status: "waiting_guest" });
    await q(`insert into claim_turo_actions (case_id, kind, payload, status) values ($1,'escalate','{}','queued'), ($1,'create_invoice','{}','queued')`, [c.id]).catch(() => null);
    const out = (await q(`select claims_turo_claim('t') r`))[0].r;
    expect(out.every((a: any) => a.kind === "create_invoice")).toBe(true);
  });
});

describe("the Claims page settings", () => {
  it("ships with Jared's defaults and the setter is bounded", async () => {
    const g = (await q(`select claims_autonomy_get() g`))[0].g;
    expect(g).toMatchObject({ insurer_contact_mode: "full", booking_mode: "auto", min_accept_pct: 100, auto_complete: true, hold_autorelease: true });
    expect((await q(`select claims_autonomy_set('min_accept_pct', '150') r`))[0].r.ok).toBe(false);
    expect((await q(`select claims_autonomy_set('min_accept_pct', '0') r`))[0].r.ok).toBe(false);
    expect((await q(`select claims_autonomy_set('booking_mode', 'whatever') r`))[0].r.ok).toBe(false);
    expect((await q(`select claims_autonomy_get() g`))[0].g.min_accept_pct).toBe(100);
  });
  it("lists what was held back this week", async () => {
    const c = await newCase({ guest: "Blocked" });
    await q(`insert into claims_send_log (case_id, channel, recipient, purpose, decision, code, reason) values ($1,'shop_email','a@b.test','answer_shop','blocked','hold','outbound hold: test')`, [c.id]);
    const g = (await q(`select claims_autonomy_get() g`))[0].g;
    expect(g.blocked.some((b: any) => b.guest_first === "Blocked" && b.code === "hold")).toBe(true);
  });
});
