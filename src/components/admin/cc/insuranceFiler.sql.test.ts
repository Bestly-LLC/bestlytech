// The Insurance Filer lives in Postgres (supabase/migrations/20261029140000_insurance_filer.sql), so this runs that SQL for real in an
// in-memory Postgres (PGlite) over stubs of the live tables. Nothing here touches Supabase, Turo, Progressive or any mailbox.
// Cody's case below uses the real facts from the live database (read-only), so "Cody's packet" is what the filer would actually use.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(root, p), "utf8");

let db: PGlite;
let onboardCall: Row[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const q = async (sql: string, params?: unknown[]): Promise<Row[]> => (await db.query<Row>(sql, params)).rows;
const val = async (sql: string, params?: unknown[]) => (await q(`select (${sql}) as v`, params))[0].v;
const calls = (fn: string) => q("select args from test_calls where fn = $1 order by id", [fn]).then((r) => r.map((x) => x.args));

const CASE = "a63df83f-4b4f-42ae-8e8e-8b8e78134c27";
const MAC = "good-mac";
const PI = "good-pi";

const DAMAGE = {
  answers: {
    "Was anyone injured?": "No", "Do you have the keys?": "Yes", "Is the car driveable?": "Yes", "Did any airbags deploy?": "No",
    "How was the damage caused?": "Collision", "Was a police report filed?": "No", "When did the incident occur?": "10/26/26",
    "Did water get inside the car?": "No",
    "Where did the incident occur?": "Country: US | Street address: 750 B St | City: San Diego, Ca | State: - | Postal code: 92101",
    "Did the vehicle lose any fluids?": "No", "What parts of the vehicle were damaged?": "Passenger-side Body",
    "Where is the vehicle currently located?": "Vehicle returned to host", "Did you incur any costs related to the damage?": "No",
    "Was there another person involved in the incident?": "No", "Who was driving the vehicle when the damage occurred?": "Someone else",
    "Is there any additional information you’d like to add?": "Driver was Essence Bonner harris\nPhone number 414 364 4998",
    "Please describe the damage to the vehicle as best you can.": "Passenger door scratches",
    "In your own words, please describe how the damage happened.": "The car rubbed against a barrier",
  },
  submitted: "Submitted by Cody 10/26/2026 8:25 AM PDT",
};

const MAIL_SNAPSHEET = {
  from: "support@claims.turo.com",
  subject: "Update for Turo Claim 1108308 on Reservation 62622707 for your 2020 Tesla Model 3",
  body: "Hello Jared, Thank you for sending over the photos and details regarding the damage to your Tesla Model 3. To help ensure your vehicle is repaired properly, we recommend using a Tesla-certified repair facility. Please find a list below: https://www.tesla.com/support/collision-support We’ve officially submitted your photos to Snapsheet, our trusted appraisal partner, to begin the appraisal process. Once we receive the estimate we will be in touch.",
};
const MAIL_UPDATE = {
  from: "support@claims.turo.com",
  subject: "Update on your claim for your 2020 Tesla Model 3 (Reservation ID: 62622707)",
  body: "Hi Jared, Thank you for letting us know that you would like the Turo Claims Team to help resolve your damage claim. A Claims Associate will review the information within the next 1 to 2 business days and be in contact with the next steps. For this trip, you selected the Max earn plan. This plan comes with a host damage responsibility amount of 2,750.00. Repairs can be done through the CrashBay network.",
};

async function mail(o: { from: string; name?: string | null; subject: string; body: string; attach?: boolean; at?: string }) {
  const r = await q(
    "insert into bestly_mail (message_id, from_addr, from_name, subject, body_text, has_attach, sent_at) values ($1,$2,$3,$4,$5,$6, coalesce($7::timestamptz, now())) returning id",
    [`<${Math.random().toString(36).slice(2)}@test>`, o.from, o.name ?? null, o.subject, o.body, o.attach ?? false, o.at ?? null]);
  return r[0].id as string;
}
const claimMail = async (m: typeof MAIL_SNAPSHEET) => {
  const id = await mail(m);
  await q("insert into claim_events (case_id, reservation_id, kind, title, detail, mail_id) values ($1, 62622707, 'mail', $2, $3, $4)",
    [CASE, m.subject, JSON.stringify({ kind: "claim_mail", from: m.from, excerpt: m.body.slice(0, 600) }), id]);
  return id;
};

/** Cody's case as it stands in the live database. */
async function seedCody(opts: { insurerEvent?: boolean; mails?: boolean } = {}) {
  await q(
    `insert into claim_cases (id, reservation_id, guest_first, guest_last, vin, status, history, turo_claim_no, turo_incident_id, damage_report, insurer)
     values ($1, 62622707, 'Cody', 'James', '5YJ3E1EAXLF658422', 'waiting_guest', false, '1108308', 663253, $2, $3)`,
    [CASE, JSON.stringify(DAMAGE), opts.insurerEvent === false ? null : JSON.stringify({ at: "2026-10-26T16:20:04.060Z", name: "Progressive", source: "guest reply", claim_no: null, policy_no: "870703450" })]);
  await q(
    `insert into turo_trips (reservation_id, guest_first, guest_last, guest_phone, vin, raw)
     values (62622707, 'Cody', 'James', '(303) 999-8482', '5YJ3E1EAXLF658422', $1)`,
    [JSON.stringify({ vehicle: { year: "2020", make: "Tesla", model: "Model 3", name: "Blue Steel", registration: { state: "CA", licensePlate: "8ZOG117" } } })]);
  await q("insert into claim_events (case_id, reservation_id, kind, title, detail, at) values ($1, 62622707, 'guest_msg', 'Cody replied', $2, '2026-10-26T16:18:54Z')",
    [CASE, JSON.stringify({ body: "Progressive 870703450 Essence Bonner harris", message_id: "m1" })]);
  if (opts.insurerEvent !== false) {
    await q("insert into claim_events (case_id, reservation_id, kind, title, detail, at) values ($1, 62622707, 'insurer', 'Cody''s insurer: Progressive (policy 870703450)', '{}', '2026-10-26T16:20:04Z')", [CASE]);
  }
  if (opts.mails) { await claimMail(MAIL_SNAPSHEET); await claimMail(MAIL_UPDATE); }
}
const enable = () => q("update ins_settings set enabled = true where id");
const oc = async () => (await q("select * from outside_claims where kind = 'guest_insurer'"))[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("src/components/admin/cc/__fixtures__/stuck-stubs.sql"));
  await db.exec(read("src/components/admin/cc/__fixtures__/insurance-stubs.sql"));
  await db.exec(read("supabase/migrations/20261027220000_stuck_card.sql"));
  await db.exec(read("supabase/migrations/20261028190000_stuck_fix_buttons.sql"));
  await db.exec(read("supabase/migrations/20261029140000_insurance_filer.sql"));
  onboardCall = (await calls("team_onboard"))[0] ?? [];
}, 180_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    truncate ins_mail_links, ins_amounts, ins_events, ins_drafts, ins_approvals, ins_photos, ins_jobs, outside_claims, claim_events, claim_cases,
             turo_trips, bestly_mail, ava_errands, test_calls restart identity cascade;
    update ins_settings set enabled = false, consent_before_tap = true where id;
  `);
});

describe("migration", () => {
  it("applies, passes its own self-test, and the rollout switch starts off", async () => {
    expect(await val("(select enabled from ins_settings where id)")).toBe(false);
    const st = await val("ins_selftest()");
    expect(st.checks.filter((c: Row) => !c.ok)).toEqual([]);
    expect(st.ok).toBe(true);
  });

  it("creates the private photo bucket, the team card, and no live cron line", async () => {
    expect(await q("select public from storage.buckets where id = 'insurance-photos'")).toEqual([{ public: false }]);
    expect(onboardCall[0]).toMatchObject({ slug: "insurance-filer", tool_of: "claims-closer" });
    const jobs = (await q("select jobname from cron.job")).map((r) => r.jobname);
    expect(jobs).not.toContain("ins-sweep");
    expect(jobs).not.toContain("ins-watch");
    expect(jobs).toContain("claims-mail-unmatched-watch");
  });

  it("keeps the Turo mail matcher as the live database has it", async () => {
    expect(await val("claims_res_from_mail('Update for Turo Claim 1108308 on Reservation 62622707 for your 2020 Tesla Model 3', '')")).toBe(62622707);
    expect(await val("claims_res_from_mail('Update on your claim (Reservation ID: 62622707)', '')")).toBe(62622707);
  });
});

describe("opening a case", () => {
  it("does nothing while the switch is off, then opens Cody's case on the sweep", async () => {
    await seedCody();
    expect(await val("ins_open_case($1::uuid)", [CASE])).toBeNull();
    expect(await q("select id from outside_claims where kind = 'guest_insurer'")).toHaveLength(0);
    await enable();
    const r = await val("ins_sweep()");
    expect(r.opened).toBe(1);
    const o = await oc();
    expect(o).toMatchObject({ kind: "guest_insurer", case_id: CASE, reservation_id: 62622707, insurer: "Progressive", insurer_slug: "progressive", policy_no: "870703450", ins_stage: "photos", status: "waiting" });
    expect(o.title).toBe("Progressive claim for Cody James's trip");
    // a second sweep does not open a second card
    await val("ins_sweep()");
    expect(await q("select id from outside_claims where kind = 'guest_insurer'")).toHaveLength(1);
  });

  it("opens on its own when an 'insurer' event arrives (the trigger)", async () => {
    await enable();
    await seedCody({ insurerEvent: false });
    expect(await q("select id from outside_claims where kind = 'guest_insurer'")).toHaveLength(0);
    await q("update claim_cases set insurer = $1 where id = $2", [JSON.stringify({ name: "Progressive", policy_no: "870703450" }), CASE]);
    expect(await q("select id from outside_claims where kind = 'guest_insurer'")).toHaveLength(1);
  });

  it("queues the photo steps and goes on to the form once they report", async () => {
    await seedCody(); await enable(); await val("ins_sweep()");
    const jobs = await q("select kind, runner, status from ins_jobs order by kind");
    expect(jobs).toEqual([{ kind: "copy_evidence", runner: "edge", status: "queued" }, { kind: "photos", runner: "pi", status: "queued" }]);
    const edge = await val("ins_edge_take()");
    await val("ins_job_done($1::uuid, 'done', '{\"added\":4}'::jsonb)", [edge.job.id]);
    expect((await oc()).ins_stage).toBe("photos");                       // the Pi has not reported yet
    const pi = await val("ins_pi_take($1)", [PI]);
    expect(pi.job).toMatchObject({ case_id: CASE, reservation_id: 62622707, incident_id: 663253 });
    await val("ins_pi_done($1, $2::uuid, 'done', '{\"added\":0}'::jsonb)", [PI, pi.job.id]);
    expect((await oc()).ins_stage).toBe("filling");
    expect(await q("select kind, runner, status from ins_jobs where kind = 'fill'")).toEqual([{ kind: "fill", runner: "mac", status: "queued" }]);
  });

  it("goes ahead without the Pi's photos after the wait", async () => {
    await seedCody(); await enable(); await val("ins_sweep()");
    await q("update ins_jobs set created_at = now() - interval '45 minutes'");
    await val("ins_sweep()");
    expect((await oc()).ins_stage).toBe("filling");
  });

  it("asks for a claims contact when the insurer is not in the registry", async () => {
    await seedCody({ insurerEvent: false }); await enable();
    await q("update claim_cases set insurer = $1 where id = $2", [JSON.stringify({ name: "Pacific Mutual", policy_no: "A1" }), CASE]);
    await q("update ins_jobs set status = 'done'");
    await val("ins_sweep()");
    expect((await oc()).ins_stage).toBe("needs_contact");
    const items = await val("ins_waiting_items()");
    expect(items[0]).toMatchObject({ pill: "YOUR CALL", needs_you: { kind: "contact" } });
    await val("ins_registry_add('Pacific Mutual', '8005551212', null, array['pacificmutual.example'])");
    expect((await oc()).ins_stage).not.toBe("needs_contact");
  });
});

describe("the packet", () => {
  it("builds Cody's facts from the live data and lists what it does not know", async () => {
    await seedCody({ mails: true }); await enable(); await val("ins_sweep()");
    const pk = await val("ins_build_packet($1::uuid)", [CASE]);
    const v = pk.values;
    expect(v).toMatchObject({
      "reporter.name": "Jared Best", "reporter.phone": "(816) 500-7236", "reporter.email": "jared@bestly.tech",
      "insurer.name": "Progressive", "policy.number": "870703450", "policy.holder": "Essence Bonner Harris",
      "driver.name": "Essence Bonner Harris", "guest.name": "Cody James", "guest.phone": "(303) 999-8482",
      "vehicle.year": "2020", "vehicle.make": "Tesla", "vehicle.model": "Model 3", "vehicle.plate": "8ZOG117", "vehicle.plate_state": "CA", "vehicle.vin": "5YJ3E1EAXLF658422",
      "loss.date": "10/26/2026", "loss.address": "750 B St", "loss.city": "San Diego", "loss.state": "CA", "loss.zip": "92101", "loss.type": "Collision",
      "loss.description": "The car rubbed against a barrier", "loss.damage": "Passenger door scratches", "loss.injuries": "No", "loss.police": "No",
      "turo.claim_no": "1108308",
    });
    expect(v["driver.phone"].replace(/\D/g, "")).toBe("4143644998");
    expect(v["turo.disclosure"]).toContain("1108308");
    expect(v["turo.disclosure"]).toContain("62622707");
    const unknown = pk.unknown.map((u: Row) => u.key);
    expect(unknown).toEqual(expect.arrayContaining(["loss.time", "vehicle.color", "reporter.address", "estimate.amount"]));
    expect(pk.inferred).toEqual(["policy.holder"]);
    // nothing about the host's responsibility is in anything that leaves the building
    expect(JSON.stringify(pk)).not.toMatch(/2,?750/);
  });

  it("changes its hash when a fact changes, so an old approval goes stale", async () => {
    await seedCody(); await enable(); await val("ins_sweep()");
    const a = await val("ins_build_packet($1::uuid)->>'hash'", [CASE]);
    await q("update claim_cases set insurer = insurer || '{\"policy_no\":\"999\"}'::jsonb where id = $1", [CASE]);
    const b = await val("ins_build_packet($1::uuid)->>'hash'", [CASE]);
    expect(a).not.toBe(b);
  });
});

describe("filing, one tap", () => {
  async function toApproval() {
    await seedCody({ mails: true }); await enable(); await val("ins_sweep()");
    await q("update ins_jobs set status = 'done'");
    await val("ins_sweep()");
    const t = await val("ins_mac_take($1)", [MAC]);
    return t.job;
  }
  const fillResult = {
    url: "https://fnol.progressive.com/begin", reached: "review", consent_clicked: true,
    consent: ["I Agree and Continue: agrees to Assured's privacy policy and terms (arbitration), and texts to (816) 500-7236"],
    screens: [{ n: 1, question: "Is everyone currently safe?", answer: "Yes", shot: "shots/1.png" }],
    filled: [{ key: "reporter.name", value: "Jared Best" }], left_blank: [{ key: "vehicle.color", why: "Turo does not store the color" }], shots: ["shots/1.png"], photos_uploaded: 0,
  };

  it("hands the Mac a fill job with the packet and never a submit before the tap", async () => {
    const job = await toApproval();
    expect(job).toMatchObject({ kind: "fill", dry: false, consent_before_tap: true, insurer_name: "Progressive" });
    expect(job.packet.values["policy.number"]).toBe("870703450");
    expect(job.insurer.slug).toBe("progressive");
    await expect(val("ins_mac_take('wrong')")).rejects.toThrow(/not allowed/);
    expect((await val("ins_mac_take($1)", [MAC])).job).toBeNull();          // nothing else is waiting
    expect(await q("select kind from ins_jobs where kind = 'submit'")).toHaveLength(0);
  });

  it("turns the fill into ONE approval, pushes it, and waits", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify(fillResult)]);
    const o = await oc();
    expect(o.ins_stage).toBe("needs_approval");
    const ap = await q("select * from ins_approvals where kind = 'file_claim'");
    expect(ap).toHaveLength(1);
    expect(ap[0].code).toMatch(/^i[a-hj-km-np-z2-9]{6}$/);
    expect(ap[0].summary.left_blank[0].key).toBe("vehicle.color");
    expect(ap[0].summary.consent[0]).toContain("texts to");
    const push = await calls("notify_route");
    expect(push).toHaveLength(1);
    expect(push[0]).toMatchObject({ source: "Claims Closer" });
    expect(push[0].title).toContain("Send the Progressive claim");
    // the Command Center item says YOUR CALL and links to the approval
    const item = (await val("ins_waiting_items()"))[0];
    expect(item).toMatchObject({ pill: "YOUR CALL", needs_you: { kind: "approval", link: `/y/${ap[0].code}`, link_label: "Review and send" } });
    expect(await q("select id from ins_jobs where kind = 'submit'")).toHaveLength(0);
  });

  it("a stale or wrong hash cannot approve; the right one queues the submit; the Mac only gets it after that", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify(fillResult)]);
    const ap = (await q("select * from ins_approvals"))[0];
    expect(await val("ins_approval_decide_core($1, 'approve', 'not-the-hash', null::uuid)", [ap.code])).toMatchObject({ ok: false, reason: "stale" });
    expect((await val("ins_mac_take($1)", [MAC])).job).toBeNull();
    expect(await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash])).toMatchObject({ ok: true, status: "approved" });
    expect((await oc()).ins_stage).toBe("submitting");
    // a second tap on the same link does nothing
    expect(await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash])).toMatchObject({ ok: false, reason: "already_approved" });
    const sub = (await val("ins_mac_take($1)", [MAC])).job;
    expect(sub).toMatchObject({ kind: "submit", approved_hash: ap.hash });
    expect(sub.packet.hash).toBe(ap.hash);                     // nothing changed since the tap, so the Mac may click send
    expect((await val("ins_mac_take($1)", [MAC])).job).toBeNull();
  });

  it("captures the claim number, drafts the Turo reply and the Tesla message, and starts the follow-up clock", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify(fillResult)]);
    const ap = (await q("select * from ins_approvals"))[0];
    await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash]);
    const sub = (await val("ins_mac_take($1)", [MAC])).job;
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, sub.id, JSON.stringify({ claim_no: "26-1234567", confirmation_text: "Thanks. Your claim number is 26-1234567" })]);
    const o = await oc();
    expect(o).toMatchObject({ ins_stage: "filed", claim_no: "26-1234567", status: "waiting" });
    expect(o.filed_at).not.toBeNull();
    expect(o.reply_due_at).not.toBeNull();
    expect((await q("select insurer from claim_cases where id = $1", [CASE]))[0].insurer.claim_no).toBe("26-1234567");
    // Turo reply: to Turo's claims address, claim number + disclosure of who has what, waits for a tap
    const d = (await q("select * from ins_drafts where kind = 'turo_reply'"))[0];
    expect(d).toMatchObject({ to_addr: "support@claims.turo.com", status: "awaiting" });
    expect(d.body).toContain("26-1234567");
    expect(d.body).toContain("1108308");
    expect(d.body).toContain("has not assigned an adjuster yet");
    expect(d.body).toContain("Claims Closer, for Jared Best");
    expect(d.body).not.toMatch(/2,?750/);
    // Tesla Service message: claim number, insurer, policyholder; no estimate yet, so it says so
    const item = (await val("ins_waiting_items()"))[0];
    const tesla = item.copy.find((c: Row) => c.id === "tesla");
    expect(tesla.label).toContain("no estimate yet");
    expect(tesla.text).toContain("26-1234567");
    expect(tesla.text).toContain("Progressive");
    expect(tesla.text).toContain("Essence Bonner Harris");
    expect(tesla.text).toContain("Tesla-certified");
    expect(tesla.text).not.toMatch(/2,?750/);
  });

  it("a submit that dies midway is never retried, and tells Jared to check", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify(fillResult)]);
    const ap = (await q("select * from ins_approvals"))[0];
    await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash]);
    const sub = (await val("ins_mac_take($1)", [MAC])).job;
    await q("update ins_jobs set claimed_at = now() - interval '2 hours' where id = $1", [sub.id]);
    await val("ins_watch()");
    expect((await oc()).ins_stage).toBe("paused");
    expect((await q("select status, attempts from ins_jobs where id = $1", [sub.id]))[0]).toEqual({ status: "failed", attempts: 1 });
    expect((await val("ins_mac_take($1)", [MAC])).job).toBeNull();
    const raised = (await calls("bestly_raise")).filter((c) => c.kind === "problem");
    expect(raised.some((c) => /stopped partway/.test(c.title))).toBe(true);
  });

  it("a CAPTCHA turns the approval into a hand-off with every answer ready, and the claim number is entered by hand", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'blocked', $3::jsonb)", [MAC, job.id, JSON.stringify({ ...fillResult, blocked_reason: "Progressive put up a bot check, which I do not bypass." })]);
    const ap = (await q("select * from ins_approvals"))[0];
    expect(ap.summary.manual).toBe(true);
    expect(await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash])).toMatchObject({ ok: false, reason: "manual_only" });
    expect(await val("ins_approval_decide_core($1, 'filed', $2, null::uuid)", [ap.code, ap.hash])).toMatchObject({ ok: false, reason: "need_claim_number" });
    expect(await val("ins_approval_decide_core($1, 'filed', $2, null::uuid, '26-777')", [ap.code, ap.hash])).toMatchObject({ ok: true, status: "filed" });
    expect((await oc()).claim_no).toBe("26-777");
  });

  it("a fact that changes between the tap and the send shows up as a different hash for the Mac to refuse on", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify(fillResult)]);
    const ap = (await q("select * from ins_approvals"))[0];
    await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash]);
    await q("update claim_cases set insurer = insurer || '{\"policy_no\":\"111\"}'::jsonb where id = $1", [CASE]);
    const sub = (await val("ins_mac_take($1)", [MAC])).job;
    expect(sub.approved_hash).toBe(ap.hash);
    expect(sub.packet.hash).not.toBe(ap.hash);
  });

  it("a send the Mac refused before clicking goes back to filling for a new tap, and is not treated as 'unknown'", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify(fillResult)]);
    const ap = (await q("select * from ins_approvals"))[0];
    await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash]);
    const sub = (await val("ins_mac_take($1)", [MAC])).job;
    await val("ins_mac_done_t($1, $2::uuid, 'failed', $3::jsonb, 'stale')", [MAC, sub.id, JSON.stringify({ not_sent: true, blocked_reason: "The facts changed after you approved." })]);
    expect((await oc()).ins_stage).not.toBe("paused");
    expect((await q("select kind from ins_events where kind = 'send_aborted'"))).toHaveLength(1);
    expect((await q("select kind from ins_jobs where kind = 'fill' and status = 'queued'"))).toHaveLength(1);
  });

  it("declining pauses the case and the Mac gets nothing", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify(fillResult)]);
    const ap = (await q("select * from ins_approvals"))[0];
    await val("ins_approval_decide_core($1, 'decline', $2, null::uuid)", [ap.code, ap.hash]);
    expect((await oc()).ins_stage).toBe("paused");
    expect((await val("ins_mac_take($1)", [MAC])).job).toBeNull();
    expect((await val("ins_waiting_items()"))[0]).toMatchObject({ pill: "YOUR CALL", needs_you: { kind: "check" } });
  });

  it("fills again when the facts change under a waiting approval", async () => {
    const job = await toApproval();
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify(fillResult)]);
    await q("update claim_cases set insurer = insurer || '{\"policy_no\":\"870703451\"}'::jsonb where id = $1", [CASE]);
    await val("ins_sweep()");
    expect((await q("select status from ins_approvals"))[0].status).toBe("superseded");
    expect((await q("select status from ins_jobs where kind = 'fill' order by created_at desc limit 1"))[0].status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// After the claim is filed: insurer mail, replies, Turo/Snapsheet mail, nudges, the bridge call, the watchdog
// ---------------------------------------------------------------------------------------------------------------------------------
const FILL = {
  url: "https://fnol.progressive.com/begin", reached: "review", consent_clicked: true, consent: ["I Agree and Continue"],
  screens: [], filled: [], left_blank: [], shots: [], photos_uploaded: 0,
};
/** Cody's case taken all the way to "filed" with claim number 26-1234567. Returns the outside_claims id. */
async function filedCase(): Promise<string> {
  await seedCody(); await enable(); await val("ins_sweep()");
  await q("update ins_jobs set status = 'done'");
  await val("ins_sweep()");
  const fill = (await val("ins_mac_take($1)", [MAC])).job;
  await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, fill.id, JSON.stringify(FILL)]);
  const ap = (await q("select * from ins_approvals where kind = 'file_claim'"))[0];
  await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash]);
  const sub = (await val("ins_mac_take($1)", [MAC])).job;
  await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, sub.id, JSON.stringify({ claim_no: "26-1234567" })]);
  return (await oc()).id;
}
const ADJ = { from: "Maria Lopez <mlopez@progressive.com>", name: "Maria Lopez" };
const adjMail = (extra: Partial<{ subject: string; body: string; attach: boolean; from: string }> = {}) =>
  mail({ from: extra.from ?? "mlopez@progressive.com", name: ADJ.name, subject: extra.subject ?? "Claim 26-1234567: photos needed",
         body: extra.body ?? "Hello Jared, I am the adjuster on claim 26-1234567. Please send photos of the damage. My direct line: 619-555-0142.", attach: extra.attach });

describe("insurer mail and the one-tap reply", () => {
  it("matches by claim number, learns the adjuster, and writes a reply draft that waits for the free-AI step", async () => {
    const id = await filedCase();
    const mid = await adjMail();
    expect(await q("select matched_by from ins_mail_links where mail_id = $1", [mid])).toEqual([{ matched_by: "claim_no" }]);
    const o = await oc();
    expect(o).toMatchObject({ id, status: "replied", adjuster_email: "mlopez@progressive.com", adjuster_name: "Maria Lopez" });
    expect(o.adjuster_phone).toContain("619");
    const d = (await q("select * from ins_drafts where kind = 'adjuster_reply'"))[0];
    expect(d).toMatchObject({ status: "writing", to_addr: "mlopez@progressive.com" });
    expect(d.subject).toMatch(/^Re: /);
    // the first adjuster contact makes the Turo reply say who the adjuster is (the first Turo reply has not gone yet, so it is not duplicated)
    expect((await q("select count(*)::int n from ins_drafts where kind = 'turo_reply'"))[0].n).toBe(1);
    // the same mail seen twice does not make a second draft
    await val("ins_mail_seen((select b from bestly_mail b where id = $1::uuid))", [mid]);
    expect((await q("select count(*)::int n from ins_drafts where kind = 'adjuster_reply'"))[0].n).toBe(1);
  });

  it("matches by policy number, then by the insurer's domain; never marketing or an unrelated sender", async () => {
    await filedCase();
    const a = await mail({ from: "claims@somewhere.example", subject: "About policy 870703450", body: "We have your policy 870703450 on file." });
    expect(await q("select matched_by from ins_mail_links where mail_id = $1", [a])).toEqual([{ matched_by: "policy" }]);
    await q("delete from ins_mail_links");
    const b = await mail({ from: "adjuster@claims.progressive.com", subject: "Your vehicle damage", body: "We received the accident details and need photos of the collision." });
    expect(await q("select matched_by from ins_mail_links where mail_id = $1", [b])).toEqual([{ matched_by: "domain" }]);
    const c = await mail({ from: "marketing@progressive.com", subject: "Save on your auto policy", body: "A claim-free discount awaits." });
    const d = await mail({ from: "someone@elsewhere.example", subject: "Lunch?", body: "No claim here." });
    expect(await q("select 1 from ins_mail_links where mail_id = any($1::uuid[])", [[c, d]])).toHaveLength(0);
  });

  it("does not match when two open claims would both fit", async () => {
    await filedCase();
    await q(`insert into outside_claims (slug, title, insurer, reply_domain, kind, ins_stage, policy_no, insurer_slug, status)
             values ('second', 'Second', 'Progressive', 'progressive.com', 'guest_insurer', 'filed', '999', 'progressive', 'waiting')`);
    const m = await mail({ from: "adjuster@progressive.com", subject: "Collision claim", body: "We need photos of the collision damage." });
    expect(await q("select 1 from ins_mail_links where mail_id = $1", [m])).toHaveLength(0);
  });

  it("the guard keeps plan terms and the host responsibility figure out of every draft", async () => {
    await filedCase(); await adjMail();
    const d = (await q("select id from ins_drafts where kind = 'adjuster_reply'"))[0];
    expect(await val("ins_draft_ready($1::uuid, null, 'Our Max earn plan covers this.')", [d.id])).toBeNull();
    expect((await q("select status from ins_drafts where id = $1", [d.id]))[0].status).toBe("failed");
    expect((await calls("notify_route")).length).toBeGreaterThanOrEqual(0);
  });

  it("parks a good draft for one tap with the photos attached, and a send is only handed to the Mac after the tap", async () => {
    const id = await filedCase();
    await q("insert into ins_photos (oc_id, source, bytes, mime, storage_path) values ($1,'after',200000,'image/jpeg','a/1.jpg'),($1,'return',300000,'image/jpeg','a/2.jpg'),($1,'estimate_doc',90000,'application/pdf','a/e.pdf'),($1,'shot',1000,'image/png','a/s.png')", [id]);
    await adjMail();
    const d = (await q("select id from ins_drafts where kind = 'adjuster_reply'"))[0];
    const code = await val("ins_draft_ready($1::uuid, 'Re: Claim 26-1234567: photos needed', $2)", [d.id, "Hello Maria,\n\nPhotos of the passenger-side door are attached, with the repair estimate.\n\n" + "Thank you,\nClaims Closer, for Jared Best"]);
    expect(code).toMatch(/^i/);
    const row = (await q("select * from ins_drafts where id = $1", [d.id]))[0];
    expect(row.status).toBe("awaiting");
    expect(row.attachments.map((a: Row) => a.source)).toEqual(["estimate_doc", "after", "return"]);      // the estimate first, never the screenshots
    expect((await val("ins_mac_take($1)", [MAC])).job).toBeNull();                                      // no tap yet
    const ap = (await q("select * from ins_approvals where draft_id = $1", [d.id]))[0];
    await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash]);
    const job = (await val("ins_mac_take($1)", [MAC])).job;
    expect(job).toMatchObject({ kind: "send_mail", sender: "jared@bestly.tech" });
    expect(job.draft).toMatchObject({ to: "mlopez@progressive.com" });
    expect(job.attachments).toHaveLength(3);
    // confirmed in Sent: the draft is sent and the clock restarts
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify({ verified: true, attachments: 3 })]);
    expect((await q("select status, verified from ins_drafts where id = $1", [d.id]))[0]).toEqual({ status: "sent", verified: true });
    expect((await oc()).status).toBe("waiting");
  });

  it("lets Jared fix a word: the hash moves with the text, the guard still runs, the old hash no longer approves", async () => {
    await filedCase(); await adjMail();
    const d = (await q("select id from ins_drafts where kind = 'adjuster_reply'"))[0];
    await val("ins_draft_ready($1::uuid, null, 'Hello Maria,\n\nHere are the photos.\n\nThank you,\nClaims Closer, for Jared Best')", [d.id]);
    const ap = (await q("select * from ins_approvals where draft_id = $1", [d.id]))[0];
    const bad = await val("ins_draft_edit($1, null, $2)", [ap.code, "Hello Maria,\n\nThe host damage responsibility is $2,750 and the plan covers it."]);
    expect(bad).toMatchObject({ ok: false, reason: "blocked" });
    const ok = await val("ins_draft_edit($1, null, $2)", [ap.code, "Hello Maria,\n\nHere are the photos of the passenger-side door."]);
    expect(ok.ok).toBe(true);
    expect(ok.body).toMatch(/Claims Closer, for Jared Best$/);                      // the signature is put back if it was deleted
    expect(ok.hash).not.toBe(ap.hash);
    expect(await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash])).toMatchObject({ ok: false, reason: "stale" });
    expect(await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ok.hash])).toMatchObject({ ok: true });
    expect((await val("ins_mac_take($1)", [MAC])).job.draft.body).toMatch(/passenger-side door/);
  });

  it("a send that is not confirmed in Sent is never retried and tells Jared", async () => {
    await filedCase(); await adjMail();
    const d = (await q("select id from ins_drafts where kind = 'adjuster_reply'"))[0];
    await val("ins_draft_ready($1::uuid, null, 'Hello Maria,\n\nHere are the photos.\n\nThank you,\nClaims Closer, for Jared Best')", [d.id]);
    const ap = (await q("select * from ins_approvals where draft_id = $1", [d.id]))[0];
    await val("ins_approval_decide_core($1, 'approve', $2, null::uuid)", [ap.code, ap.hash]);
    const job = (await val("ins_mac_take($1)", [MAC])).job;
    await val("ins_mac_done_t($1, $2::uuid, 'done', $3::jsonb)", [MAC, job.id, JSON.stringify({ verified: false })]);
    expect((await q("select status from ins_drafts where id = $1", [d.id]))[0].status).toBe("failed");
    expect((await val("ins_mac_take($1)", [MAC])).job).toBeNull();
    expect((await calls("notify_route")).some((c) => /Check Sent/.test(c.title))).toBe(true);
  });
});

describe("Turo and Snapsheet mail", () => {
  it("puts Snapsheet and Turo updates on the timeline, keeps the host responsibility internal, and records the Tesla-certified rule", async () => {
    await seedCody(); await enable(); await val("ins_sweep()");
    await mail({ ...MAIL_SNAPSHEET, name: "Turo Claims" });
    await mail({ ...MAIL_UPDATE, name: "Turo Claims" });
    const kinds = (await q("select kind from ins_events order by at, id")).map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["appraisal_started", "turo_review", "turo_network"]));
    const o = await oc();
    expect(o.internal).toMatchObject({ tesla_certified_required: true, host_responsibility_seen: 2750 });
    const item = (await val("ins_waiting_items()"))[0];
    expect(item.blocks.find((b: Row) => b.id === "shop").detail).toContain("Tesla-certified");
    expect(item.blocks.find((b: Row) => b.id === "internal").label).toContain("internal");
    // nothing that leaves the building mentions it
    expect(JSON.stringify(item.timeline)).not.toMatch(/2,?750/);
    expect(JSON.stringify(await val("ins_build_packet($1::uuid)", [CASE]))).not.toMatch(/2,?750/);
  });

  it("reads the host responsibility from claim_cases first when it is there, and never hard-codes a number", async () => {
    await seedCody(); await enable(); await val("ins_sweep()");
    await q("alter table claim_cases add column if not exists host_responsibility numeric");
    await q("update claim_cases set host_responsibility = 1500 where id = $1", [CASE]);
    const item = (await val("ins_waiting_items()"))[0];
    expect(item.blocks.find((b: Row) => b.id === "internal").detail).toMatch(/1,?500/);
    expect(JSON.stringify(item)).not.toMatch(/2,?750/);
  });

  it("a finalized estimate goes on the timeline, queues the attachment fetch, and readies the Tesla Service message", async () => {
    const id = await filedCase();
    expect((await val("ins_tesla_message($1::uuid)", [id])).has_estimate).toBe(false);
    await mail({ from: "support@claims.turo.com", subject: "Update for Turo Claim 1108308 on Reservation 62622707",
                 body: "Snapsheet has finalized the estimate for your Tesla Model 3. Estimate total: $1,845.20. Payment instructions will follow.", attach: true });
    expect((await q("select detail from ins_events where kind = 'estimate_final'"))[0].detail.amount).toBe(1845.2);
    expect((await q("select kind, runner from ins_jobs where kind = 'attach_fetch'"))[0]).toEqual({ kind: "attach_fetch", runner: "mac" });
    const t = await val("ins_tesla_message($1::uuid)", [id]);
    expect(t.has_estimate).toBe(true);
    expect(t.text).toMatch(/1,?845/);
    expect(t.text).toContain("Tesla-certified");
    expect(t.text).toContain("before any parts are ordered");       // OEM parts only when fully covered: confirm coverage first
    const item = (await val("ins_waiting_items()"))[0];
    expect(item.copy.find((c: Row) => c.id === "tesla").label).toBe("Message for Tesla Service");
  });

  it("tracks money per source and does not count the Supercharging invoice as a claim payment", async () => {
    const id = await filedCase();
    await mail({ from: "support@claims.turo.com", subject: "Update for Turo Claim 1108308 on Reservation 62622707",
                 body: "We've issued a payment of $1,200.00 to your account for this claim." });
    expect(await q("select source, amount::float, confirmed from ins_amounts where oc_id = $1", [id])).toEqual([{ source: "turo", amount: 1200, confirmed: false }]);
    await q("insert into claim_events (case_id, reservation_id, kind, title, detail) values ($1, 62622707, 'mail', 'Invoice paid', $2)",
      [CASE, JSON.stringify({ kind: "invoice_paid", excerpt: "Reimbursement invoice. On-trip charging. Total charge - $122.33. Paid Oct 28." })]);
    const tl = await val("ins_timeline($1::uuid)", [id]);
    const settled = tl.filter((t: Row) => t.kind === "settled");
    expect(settled).toHaveLength(1);
    expect(settled[0].text).toMatch(/122\.33/);
    expect(settled[0].text).toContain("Not part of this claim");
    expect((await q("select count(*)::int n from ins_amounts"))[0].n).toBe(1);
    const recv = (await val("ins_waiting_items()"))[0].blocks.find((b: Row) => b.id === "received").detail;
    expect(recv).toContain("not confirmed");
    expect(await val("ins_amount_add($1::uuid, 'insurer', 800, 'check')", [id])).toBeTruthy();
  });
});

describe("a quiet adjuster", () => {
  const quiet = async (id: string) => {
    await q("update outside_claims set adjuster_email = 'mlopez@progressive.com', adjuster_name = 'Maria Lopez', adjuster_phone = '(619) 555-0142', last_outbound_at = now() - interval '8 days', last_inbound_at = null, reply_due_at = now() - interval '5 days' where id = $1", [id]);
    await q("update ins_drafts set status = 'dismissed'");
    await q("update ins_approvals set status = 'declined'");
  };

  it("writes a nudge after two business days, then queues the bridge call after a second quiet stretch; nothing is sent or dialed", async () => {
    const id = await filedCase(); await quiet(id);
    expect(await val("ins_follow_up($1::uuid)", [id])).toBe("nudge");
    const n = (await q("select * from ins_drafts where kind = 'nudge'"))[0];
    expect(n).toMatchObject({ status: "awaiting", to_addr: "mlopez@progressive.com" });
    expect(n.body).toContain("26-1234567");
    expect(n.body).toContain("Claims Closer, for Jared Best");
    expect(await val("ins_follow_up($1::uuid)", [id])).toBe("draft_open");        // one at a time
    expect((await q("select count(*)::int n from ava_errands"))[0].n).toBe(0);
    // the nudge is tapped and sent, and goes quiet too
    await q("update ins_drafts set status = 'sent', sent_at = now() - interval '8 days' where id = $1", [n.id]);
    await q("update ins_approvals set status = 'approved' where draft_id = $1", [n.id]);
    expect(await val("ins_follow_up($1::uuid)", [id])).toBe("errand");
    const e = (await q("select * from ava_errands"))[0];
    expect(e.details).toMatch(/^\[bridge\]/);
    expect(e.phone).toBe("6195550142");
    const o = await oc();
    expect(o).toMatchObject({ status: "escalated", errand_id: e.id });
    const item = (await val("ins_waiting_items()"))[0];
    expect(item).toMatchObject({ pill: "YOUR CALL", needs_you: { kind: "call", call: { phone: "6195550142", company: "Progressive" } } });
    expect(typeof item.needs_you.open).toBe("boolean");
    expect(item.needs_you.open).toBe(await val("ins_biz_open()"));
    expect(await val("ins_follow_up($1::uuid)", [id])).not.toBe("errand");        // not queued twice
    expect((await q("select count(*)::int n from ava_errands"))[0].n).toBe(1);
  });

  it("does not nudge when they wrote last, or before the wait is over", async () => {
    const id = await filedCase(); await quiet(id);
    await q("update outside_claims set last_inbound_at = now() - interval '1 day' where id = $1", [id]);
    await q("update outside_claims set last_outbound_at = now() - interval '9 days' where id = $1", [id]);
    expect(await val("ins_follow_up($1::uuid)", [id])).toBe("their_turn_is_over");
    await q("update outside_claims set last_inbound_at = null, last_outbound_at = now() where id = $1", [id]);
    expect(await val("ins_follow_up($1::uuid)", [id])).toBe("quiet_ok");
  });

  it("business days skip weekends", async () => {
    // Friday 10/30/2026 4:00 PM Pacific + 2 business days lands on Tuesday
    // (the clocks go back on Sunday 11/1, so the same wall-clock time is 12:00 AM UTC the next day)
    expect(await val("(ins_add_biz('2026-10-30T23:00:00Z'::timestamptz, 2) at time zone 'America/Los_Angeles')::text")).toBe("2026-11-03 16:00:00");
  });
});

describe("the watchdog", () => {
  it("requeues a stalled fill, gives up on a stalled-three-times job, and raises under Claims Closer", async () => {
    await seedCody(); await enable(); await val("ins_sweep()");
    await q("update ins_jobs set status = 'done'");
    await val("ins_sweep()");
    const fill = (await val("ins_mac_take($1)", [MAC])).job;
    await q("update ins_jobs set claimed_at = now() - interval '2 hours' where id = $1", [fill.id]);
    const r = await val("ins_watch()");
    expect(r.requeued).toBe(1);
    expect((await q("select status from ins_jobs where id = $1", [fill.id]))[0].status).toBe("queued");
    await q("update ins_jobs set status = 'claimed', attempts = 3, claimed_at = now() - interval '2 hours' where id = $1", [fill.id]);
    expect((await val("ins_watch()")).failed).toBe(1);
    const raised = await calls("bestly_raise");
    expect(raised.some((c) => /keeps stalling/.test(c.title))).toBe(true);
    // every raise this module makes is under the claims. prefix owned by Claims Closer
    expect(raised.every((c) => /^claims\./.test(c.key))).toBe(true);
  });

  it("raises when the Mac mini sits on work, and resolves when it is clear", async () => {
    await seedCody(); await enable(); await val("ins_sweep()");
    await q("update ins_jobs set status = 'done'");
    await val("ins_sweep()");
    await q("update ins_jobs set created_at = now() - interval '2 hours' where kind = 'fill'");
    await val("ins_watch()");
    expect((await calls("bestly_raise")).some((c) => c.key === "claims.ins_mac_idle" && c.kind === "problem")).toBe(true);
    await q("update ins_jobs set status = 'done'");
    await q("truncate test_calls");
    await val("ins_watch()");
    expect((await calls("bestly_raise")).some((c) => c.key === "claims.ins_mac_idle" && c.kind === "resolved")).toBe(true);
  });

  it("opens a card for a guest insurer that has none (self-heal) and does nothing while off", async () => {
    await seedCody({ insurerEvent: false });
    await q("update claim_cases set insurer = $1 where id = $2", [JSON.stringify({ name: "Progressive", policy_no: "870703450" }), CASE]);
    expect(await val("ins_watch()")).toEqual({ enabled: false });
    await enable();
    await q("delete from outside_claims");
    const r = await val("ins_watch()");
    expect(r.open_cases).toBe(1);
    expect(r.selftest_ok).toBe(true);
  });

  it("raises on an insurer email that nothing matched, heals it when the matcher can, and ignores Turo and our own mail", async () => {
    await filedCase();
    const old = "now() - interval '1 hour'";
    // mentions a claim and comes from the insurer's domain, but is marketing-looking to the matcher, so it stays unmatched
    const stuck = await mail({ from: "no-reply@progressive.com", subject: "Your claim status", body: "Your claim is being reviewed." });
    await q(`update bestly_mail set ingested_at = ${old} where id = $1`, [stuck]);
    const turo = await mail({ from: "support@claims.turo.com", subject: "Claim update", body: "Your claim." });
    await q(`update bestly_mail set ingested_at = ${old} where id = $1`, [turo]);
    const r = await val("ins_mail_unmatched_watch()");
    expect(r.unmatched).toBe(1);
    expect((await calls("bestly_raise")).some((c) => /could not match an insurer email/.test(c.title))).toBe(true);
    // the live Turo watcher is still there beside ours
    expect(await val("(select count(*) from cron.job where jobname = 'claims-mail-unmatched-watch')::int")).toBe(1);
  });
});

describe("the rest of the Waiting card", () => {
  it("leaves the Kemper row and the stuck feed self-test alone", async () => {
    await seedCody(); await enable(); await val("ins_sweep()");
    await q(`insert into outside_claims (slug, title, insurer, reply_domain, kind, status, reply_due_at, last_sent_at)
             values ('kemper', 'Kemper check', 'Kemper', 'kemper.com', 'other', 'waiting', now() + interval '2 days', now())`);
    const feed = await val("stuck_items_core()");
    const waiting = feed.filter((i: Row) => i.kind === "waiting");
    expect(waiting.map((w: Row) => w.title).sort()).toEqual(["Kemper check", "Progressive claim for Cody James's trip"]);
    expect((await val("stuck_feed_selftest()")).problems).toEqual([]);
    // an old Kemper-shaped check never touches a guest insurer row
    await q("update outside_claims set reply_due_at = now() - interval '3 days' where kind = 'guest_insurer'");
    await val("outside_claims_check()");
    expect((await oc()).status).toBe("waiting");
  });

  it("rolls back: the undo section is present and names every table, bucket and cron it adds", async () => {
    const sql = read("supabase/migrations/20261029140000_insurance_filer.sql");
    const undo = sql.slice(sql.indexOf("UNDO"));
    for (const t of ["ins_settings", "ins_insurers", "ins_jobs", "ins_photos", "ins_approvals", "ins_drafts", "ins_events", "ins_amounts", "ins_mail_links", "insurance-photos", "ins-sweep", "ins-watch"]) {
      expect(undo).toContain(t);
    }
    expect(sql).not.toMatch(/\|\|\s*'[^']*'::text\[\]/);       // no text[] || 'literal'
  });
});
