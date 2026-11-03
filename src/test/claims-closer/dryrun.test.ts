// Dry runs of the two cases that started this work, against the real migrations (Cody) and the real handlers (Willie). Nothing is sent: the network is captured
// and asserted empty, and the database is an in-memory copy shaped like production.
import { describe, expect, it } from "vitest";
import { makeDb } from "./pg";
import { answeredQuestions } from "../../../supabase/functions/claims-closer/booking.ts";
import { autoBookStep, deadlineStep, teslaStep } from "../../../supabase/functions/claims-closer/engine.ts";
import { insurerStep, outsideClaimsStep } from "../../../supabase/functions/claims-closer/insurer.ts";
import { FakeDb, captureNetwork, makeCtx } from "./fakeDb";

const H = 36e5;
const ago = (h: number) => new Date(Date.now() - h * H).toISOString();
const iso = (h: number) => new Date(Date.now() + h * H).toISOString();

describe("Cody (reservation 62622707): what the sweep would do tonight", () => {
  it("links the Turo ids, recognises the paid $122.33 invoice as the Supercharging reimbursement (not damage), taps Complete trip, and releases the hold", async () => {
    const { q } = await makeDb();
    // Cody's case as it is in production: waiting_return, held for a message during the live trip, Complete trip never tapped
    const [c] = await q(`insert into claim_cases (reservation_id, guest_first, guest_last, vin, path, status, outbound_hold, outbound_hold_reason, outbound_hold_at, trip_end, opened_at, last_progress_at, estimate_amount)
      values (62622707, 'Cody', 'T', 'VINCODY', 'turo_claim', 'waiting_return', true, 'a message reached the guest while the trip was still live', $1, $2, $3, $1, null) returning *`, [ago(40), ago(46), ago(60)]);
    await q(`insert into turo_trips (reservation_id, starts_at, ends_at, vin, status) values (62622707, $1, $2, 'VINCODY', 'BOOKED')`, [ago(120), ago(46)]);
    await q(`insert into lax_guest_links (reservation_id, token) values (62622707, 'tokcody')`);
    // Blue Steel: parked about 65 m from home, reading 3 minutes old
    await q(`insert into turo_vehicle_state (vin, display_name, latitude, longitude, observed_at) values ('VINCODY','Blue Steel', 34.084241 + 0.000585, -118.371793, now() - interval '3 minutes')`);
    // the paid invoice mail Turo sent: a Supercharging reimbursement
    await q(`with m as (insert into bestly_mail (from_addr, subject, body_text) values ('no-reply@turo.com','Reimbursement invoice','Reimbursement invoice\nTotal charge - $122.33\nincidental charges: Supercharging during the trip\nuntil October 31 at 11:55 AM\nhttps://turo.com/invoices?invoiceId=777\nhttps://turo.com/reservation/62622707') returning *) select claims_mail_seen(m) from m`);
    await q(`with m as (insert into bestly_mail (from_addr, subject, body_text) values ('no-reply@turo.com','Your guest paid the reimbursement invoice','Total charge - $122.33\nincidental charges: Supercharging\nThe invoice has been paid.\nhttps://turo.com/invoices?invoiceId=777\nhttps://turo.com/reservation/62622707') returning *) select claims_mail_seen(m) from m`);
    // the migration's backfill, replayed for this row (at apply time it runs against production's real row)
    await q(`select claims_link_turo_ids(id, '1108308', 663253) from claim_cases where reservation_id = 62622707`);

    const before = (await q(`select claims_gate($1) g`, [c.id]))[0].g;
    expect(before.ok).toBe(false);                                   // held AND not complete: why nothing moved since Oct 26

    const sweep = (await q(`select claims_autonomy_sweep() s`))[0].s;
    expect(sweep.auto_complete).toBeGreaterThanOrEqual(1);
    expect(sweep.holds.released).toBeGreaterThanOrEqual(1);

    const row = (await q(`select * from claim_cases where id=$1`, [c.id]))[0];
    expect(row.turo_claim_no).toBe("1108308"); expect(Number(row.turo_incident_id)).toBe(663253);
    expect(row.invoices).toHaveLength(1);
    expect(row.invoices[0]).toMatchObject({ amount: 122.33, paid: true, kind: "incidental" });
    expect(row.recovered_amount).toBeNull();                          // the Supercharging reimbursement is not the damage claim
    expect(row.outbound_hold).toBe(false);
    const link = (await q(`select * from lax_guest_links where reservation_id=62622707`))[0];
    expect(link.host_completed_source).toBe("auto");
    expect(link.host_completed_evidence.car.where).toBe("home");
    expect(link.host_completed_evidence.car.dist_home_m).toBeLessThan(100);
    const after = (await q(`select claims_gate($1) g`, [c.id]))[0].g;
    expect(after.ok).toBe(true);                                      // the held draft can go out on the next tick
    const notices = await q(`select title from test_notices order by id`);
    expect(notices.map((n: any) => n.title).join("|")).toMatch(/trip complete/i);
    expect(notices.map((n: any) => n.title).join("|")).toMatch(/Released the hold/);
  });
});

describe("Willie (reservation 59754331): what every step does while his hold is on", () => {
  it("sends nothing at all, retires the three old shop questions, invents no Tesla estimate, and asks Jared one question about the closed routes", async () => {
    const db = new FakeDb(); const net = captureNetwork();
    const c: any = db.seed("claim_cases", [{ reservation_id: 59754331, guest_first: "Willie", guest_last: "W", status: "waiting_guest", history: false, path: "resolve_directly", vin: "5YJ3E1EA0LF000002", car: "2020 Tesla Model 3",
      opened_at: ago(24 * 22), trip_end: ago(24 * 21), escalate_by: ago(24 * 1), estimate_amount: null, chosen_estimate_id: null, turo_claim_no: "1096164", turo_incident_id: 653528, turo_status: "EXPIRED",
      invoices: [{ amount: 500, paid: false, kind: "damage" }], insurer: {}, outbound_hold: true, outbound_hold_reason: "Jared 10/28 1:53 PM: answers were relayed verbatim to shops; hold all outbound until the answer-relay fix ships", repair_booking: null }])[0];
    db.seed("claims_autonomy_settings", [{ id: true, insurer_contact_mode: "full", booking_mode: "auto", min_accept_pct: 100, deadline_lead_hours: 72, booking_buffer_hours: 4 }]);
    db.rpcs.claims_gate = () => ({ ok: false, live: false, reason: "held by the watchdog" });
    db.rpcs.claims_ask = (a) => db.seed("claim_questions", [{ case_id: a.p_case, key: a.p_key, kind: a.p_kind, question: a.p_question, options: a.p_options ?? [], asked_at: iso(0), answer: null, answered_at: null, handled_at: null, meta: {} }])[0].id;
    db.rpcs.claims_set_windows = (a) => { for (const w of a.p_windows) db.seed("claim_windows", [{ case_id: a.p_case, ...w }]); return { ok: true }; };
    const shops = db.seed("claim_shops", [{ name: "AGC Collision Center", email: "e@agc.test" }, { name: "Pristine Collision Center", email: "e@pristine.test" }, { name: "Pristine Collision Center Hollywood", email: "e@ph.test" }]);
    const ests = shops.map((s, i) => db.seed("claim_estimates", [{ case_id: c.id, shop_id: s.id, ref: `CC-${i}`, status: "needs_visit", requested_at: ago(24 * 20), line_items: {} }])[0]);
    const qs = ests.map((e) => db.seed("claim_questions", [{ case_id: c.id, key: `shop-asks-${e.id}`, kind: "decision", question: "A shop replied and needs: better photos, VIN. What should I do?", options: [],
      answer: "Skip we got an estimate from tesla", answered_at: ago(0.5), answered_by: "jared", asked_at: ago(24 * 20), handled_at: null, meta: {} }])[0]);
    db.seed("claim_windows", [{ case_id: c.id, kind: "resolve_directly", due_at: ago(24), status: "lapsed" }]);
    const { ctx, notices } = makeCtx(db);
    const st = db.tables.claims_autonomy_settings[0];
    const notes: string[] = [];

    await answeredQuestions(ctx, c, notes);
    await teslaStep(ctx, c, notes);
    await deadlineStep(ctx, c, st, notes);
    await insurerStep(ctx, c, notes);
    await autoBookStep(ctx, c, st, notes);
    await outsideClaimsStep(ctx, notes);

    expect(net.mails).toHaveLength(0); expect(net.calls).toHaveLength(0);                       // nothing left the building
    expect(qs.every((q) => q.retired_at && q.handled_at)).toBe(true);                           // the old questions are retired, not relayed
    expect(db.tables.claim_estimates.every((e) => e.status === "closed")).toBe(true);           // "Skip" closes the shop threads quietly
    expect(db.tables.claim_estimates.filter((e) => e.oem || /tesla/i.test(String(e.notes ?? ""))).length).toBe(0);   // no Tesla estimate invented
    expect(db.tables.claim_cases[0].outbound_hold).toBe(true);                                  // Jared's hold row is untouched
    expect(db.tables.claim_cases[0].outbound_hold_reason).toMatch(/answer-relay fix ships/);
    expect(db.tables.claim_turo_actions ?? []).toHaveLength(0);                                 // no Turo action either
    expect(db.tables.claim_questions.filter((x) => /^path-exhausted-/.test(x.key))).toHaveLength(1);   // the one real decision for Jared
    expect(notices.every((n) => !/tesla/i.test(n.body))).toBe(true);
  });
});
