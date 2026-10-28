// Item 9 (Jared, 2026-10-28): when the guest names a personal insurer, Claims Closer runs that track end to end:
//   open the third-party claim -> send the estimate and photos -> answer the adjuster -> chase on a schedule until it is paid.
// Same for an outside claim that is not a Turo case (Kemper). Email goes from jared@bestly.tech with his Bestly signature (sendMail), never Gmail;
// calls go through Ava. All of it sits behind claims_autonomy_settings.insurer_contact_mode ('full' = Jared's answer; 'draft_only' prepares, sends nothing),
// and every send passes canSend (hold, return gate, guards). It never states a deductible or plan cap, never speaks for Turo, never mentions reviews, and
// never accepts less than min_accept_pct of the chosen estimate (Jared, 2026-10-28: 100). Anything below goes to Jared as buttons.
import type { Ctx } from "./estimates.ts";
import { avaCall, carName, photoAttachments, sendMail, summaryPdf } from "./estimates.ts";
import { MAX_CHASES, chaseDelayHours } from "./autonomy.ts";
import { INSURER_SYS, acceptOfferEmail, chaseCallScript, chaseEmail, documentsEmail, holdForFullEmail, offerPlan, openClaimCallScript, openClaimEmail, sendEstimateEmail, verifyInsurerRead } from "./insurer-text.ts";
import { DAY, HOUR, fmtPT } from "./time.ts";

type Row = Record<string, any>;
const SLUG = "claims-closer";
const b64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };

async function settings(ctx: Ctx): Promise<Row> {
  const { data } = await ctx.db.from("claims_autonomy_settings").select("*").eq("id", true).maybeSingle();
  return data ?? { insurer_contact_mode: "draft_only", min_accept_pct: 100 };
}

async function estimateBundle(ctx: Ctx, c: Row) {
  const photos = await photoAttachments(ctx, c.id);
  const { data: e } = c.chosen_estimate_id ? await ctx.db.from("claim_estimates").select("*, claim_shops(name, address, phone)").eq("id", c.chosen_estimate_id).maybeSingle() : { data: null };
  const attachments = [...photos.list];
  if (e) { try { const pdf = await summaryPdf(ctx, c, e, e.claim_shops ?? {}); attachments.push({ filename: "repair-estimate-summary.pdf", content: b64(pdf) }); } catch { /* photos still go */ } }
  return { attachments, photos: photos.list.length, shop: e?.claim_shops?.name ?? null as string | null, estimate: c.estimate_amount != null ? Number(c.estimate_amount) : null };
}

const track = async (ctx: Ctx, caseId: string) => (await ctx.db.from("claim_insurer_track").select("*").eq("case_id", caseId).maybeSingle()).data as Row | null;
const patch = (ctx: Ctx, id: string, p: Row) => ctx.db.from("claim_insurer_track").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);

export async function insurerStep(ctx: Ctx, c: Row, notes: string[]): Promise<void> {
  if (!c.insurer?.name || ["paid", "closed"].includes(String(c.status)) || c.history) return;
  const st = await settings(ctx);
  let t = await track(ctx, c.id);
  if (!t) {
    await ctx.db.from("claim_insurer_track").insert({ case_id: c.id, insurer_name: String(c.insurer.name).slice(0, 60), policy_no: c.insurer.policy_no ?? null, policy_holder: c.insurer.policy_holder ?? null, claim_no: c.insurer.claim_no ?? null, state: "identified" });
    await ctx.event(c, "insurer", `Started the insurer track with ${c.insurer.name}${c.insurer.policy_no ? ` (policy ${c.insurer.policy_no})` : ""}`, { progress: true });
    t = await track(ctx, c.id);
  }
  if (!t || ["paid", "denied"].includes(t.state)) return;
  if (st.insurer_contact_mode !== "full") { notes.push("insurer track is draft only"); return; }
  if (!c.insurer.policy_no) return;   // never open a claim without the policy number the guest gave

  // 1. what the adjuster wrote
  await readInsurerMail(ctx, c, t, st, notes);
  t = (await track(ctx, c.id))!;
  if (["paid", "denied"].includes(t.state)) return;

  // 2. open the claim
  if (t.state === "identified") {
    if (c.estimate_amount == null) { notes.push("insurer: waiting for the estimate before opening the claim"); return; }
    if (!t.adjuster_email && !t.adjuster_phone) {
      await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: `insurer-contact-${c.id}`, p_options: [{ value: "mine", label: "I will handle the insurer" }],
        p_question: `I have ${t.insurer_name} (policy ${t.policy_no}) but no claims email or phone to open the third-party claim. Type the claims email or phone as a note and I will use it only as the address; nothing you type is sent to them.` });
      notes.push("insurer: need a claims contact"); return;
    }
    const b = await estimateBundle(ctx, c);
    if (t.adjuster_email) {
      const m = openClaimEmail(c, t, { estimate: b.estimate, shop: b.shop, lossDate: c.trip_end ? new Date(c.trip_end).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric" }) : null, photos: b.photos });
      const r = await sendMail(ctx, c, { channel: "insurer_email", purpose: "open_claim", to: t.adjuster_email, subject: m.subject, text: m.text, key: `claims-ins-open-${t.id}`, attachments: b.attachments, allowedAmounts: b.estimate != null ? [b.estimate] : [] });
      if (r.ok) { await patch(ctx, t.id, { state: "claim_opening", last_contact_at: new Date().toISOString(), next_chase_at: new Date(Date.now() + chaseDelayHours(0) * HOUR).toISOString(),
          notes: [...(t.notes ?? []), { at: new Date().toISOString(), note: "opened by email with the estimate and photos attached", estimate_sent: true }] });
        await ctx.event(c, "insurer", `Opened the third-party claim with ${t.insurer_name} by email, with the estimate and photos`, { to: t.adjuster_email, progress: true }); notes.push("opened the claim with the insurer"); }
      else if (!r.blocked) notes.push(`insurer email failed: ${r.error}`);
      else notes.push(`insurer email held: ${r.error}`);
    } else {
      const r = await avaCall(ctx, c, { channel: "adjuster_call", why: "open_claim", phone: t.adjuster_phone, name: t.insurer_name, purpose: openClaimCallScript(c, t, { estimate: b.estimate }), allowedAmounts: b.estimate != null ? [b.estimate] : [],
        first_line: `Hi, it's Jared Best's AI assistant, on a recorded line. I'm calling to open a third-party property damage claim.` });
      if (r.ok) { await patch(ctx, t.id, { state: "claim_opening", last_contact_at: new Date().toISOString(), next_chase_at: new Date(Date.now() + chaseDelayHours(0) * HOUR).toISOString() });
        await ctx.event(c, "insurer", `Ava is calling ${t.insurer_name} to open the claim`, { call_id: r.call_id, progress: true }); notes.push("calling the insurer"); }
      else notes.push(r.blocked ? `insurer call held: ${r.error}` : `insurer call failed: ${r.error}`);
    }
    return;
  }

  // 3. claim number known, estimate not yet sent on its own
  if (t.state === "claim_open" && c.estimate_amount != null && t.adjuster_email) {
    const b = await estimateBundle(ctx, c);
    const m = sendEstimateEmail(c, t, { estimate: b.estimate!, shop: b.shop, photos: b.photos });
    const r = await sendMail(ctx, c, { channel: "insurer_email", purpose: "send_estimate", to: t.adjuster_email, subject: m.subject, text: m.text, key: `claims-ins-est-${t.id}`, attachments: b.attachments, allowedAmounts: [b.estimate!] });
    if (r.ok) { await patch(ctx, t.id, { state: "estimate_sent", last_contact_at: new Date().toISOString(), next_chase_at: new Date(Date.now() + chaseDelayHours(0) * HOUR).toISOString() });
      await ctx.event(c, "insurer", `Sent ${t.insurer_name} the estimate and photos`, { progress: true }); notes.push("sent the estimate to the insurer"); }
    return;
  }

  // 4. chase until paid
  if (["claim_opening", "claim_open", "estimate_sent", "awaiting_payment"].includes(t.state) && t.next_chase_at && Date.parse(t.next_chase_at) <= Date.now()) {
    const n = Number(t.chase_count ?? 0);
    if (n >= MAX_CHASES) {
      await patch(ctx, t.id, { state: "stalled" });
      await ctx.notify(`${t.insurer_name} is not answering on ${c.guest_first ?? "a"} claim`, `I chased ${MAX_CHASES} times since ${fmtPT(t.created_at)} with no payment. Decision for you: keep chasing by phone yourself, or I move this to a Turo claim if the window is still open.`, `claims-ins-stalled-${t.id}`, "warning");
      await ctx.event(c, "insurer", `Insurer chase stalled after ${MAX_CHASES} tries`, { progress: true }); return;
    }
    let sent = false;
    if (t.adjuster_email) {
      const m = chaseEmail(c, t, n + 1);
      sent = (await sendMail(ctx, c, { channel: "insurer_email", purpose: "chase", to: t.adjuster_email, subject: m.subject, text: m.text, key: `claims-ins-chase-${t.id}-${n + 1}` })).ok;
    } else if (t.adjuster_phone) {
      sent = (await avaCall(ctx, c, { channel: "adjuster_call", why: "chase", phone: t.adjuster_phone, name: t.insurer_name, purpose: chaseCallScript(c, t), first_line: `Hi, it's Jared Best's AI assistant, on a recorded line. I'm calling for a status update on a claim.` })).ok;
    }
    if (sent) {
      await patch(ctx, t.id, { chase_count: n + 1, last_contact_at: new Date().toISOString(), next_chase_at: new Date(Date.now() + chaseDelayHours(n + 1) * HOUR).toISOString() });
      await ctx.event(c, "insurer", `Chased ${t.insurer_name} (#${n + 1})`, { progress: true }); notes.push(`chased the insurer (#${n + 1})`);
    }
  }
}

async function readInsurerMail(ctx: Ctx, c: Row, t: Row, st: Row, notes: string[]) {
  const domain = String(t.adjuster_email ?? "").split("@")[1];
  if (!domain && !t.claim_no) return;
  const { data: mails } = await ctx.db.from("bestly_mail").select("id, from_addr, subject, body_text, sent_at, has_attach").gte("sent_at", t.created_at).order("sent_at", { ascending: true }).limit(40);
  const { data: seen } = await ctx.db.from("claim_events").select("mail_id").eq("case_id", c.id).eq("kind", "insurer_mail");
  const done = new Set(((seen ?? []) as Row[]).map((e) => e.mail_id));
  for (const m of (mails ?? []) as Row[]) {
    if (done.has(m.id) || /turo\.com|bestly\.tech/i.test(String(m.from_addr ?? ""))) continue;
    const mine = (domain && String(m.from_addr ?? "").toLowerCase().includes(domain.toLowerCase())) || (t.claim_no && String(m.body_text ?? m.subject ?? "").includes(t.claim_no));
    if (!mine) continue;
    const text = `${m.subject ?? ""}\n${String(m.body_text ?? "").replace(/\r/g, "").split(/\n\s*(On .{5,80} wrote:|-----Original Message-----)/)[0].slice(0, 4000)}`;
    let x;
    try {
      const r = await ctx.llm({ task: "extract", system: INSURER_SYS, user: `INSURER: ${t.insurer_name}\nMAIL:\n${text}`, json: true, job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 45_000, maxTokens: 400, validate: (j: Row) => typeof j === "object" && j ? null : "not an object" });
      x = verifyInsurerRead(r.json, text);
    } catch (e) { if (e instanceof ctx.LlmUnavailable) return; throw e; }
    await ctx.db.from("claim_events").insert({ case_id: c.id, reservation_id: c.reservation_id, kind: "insurer_mail", title: `${t.insurer_name} wrote: ${x.kind.replace("_", " ")}`, detail: { kind: x.kind, amount: x.amount, progress: true }, mail_id: m.id });
    const upd: Row = { last_inbound_at: m.sent_at };
    if (x.claim_no && !t.claim_no) { upd.claim_no = x.claim_no; t.claim_no = x.claim_no; if (["identified", "claim_opening"].includes(t.state)) upd.state = ((t.notes ?? []) as Row[]).some((n) => n.estimate_sent) ? "estimate_sent" : "claim_open"; }
    if (x.adjuster_email && !t.adjuster_email) upd.adjuster_email = x.adjuster_email;
    if (x.adjuster_phone && !t.adjuster_phone) upd.adjuster_phone = x.adjuster_phone;
    if (x.adjuster_name && !t.adjuster_name) upd.adjuster_name = x.adjuster_name;
    await patch(ctx, t.id, upd); Object.assign(t, upd);
    if (x.claim_no) await ctx.db.from("claim_cases").update({ insurer: { ...(c.insurer ?? {}), claim_no: x.claim_no } }).eq("id", c.id);

    const estimate = c.estimate_amount != null ? Number(c.estimate_amount) : null;
    if (x.kind === "offer" && x.amount !== null && estimate) {
      const d = offerPlan(x.amount, estimate, Number(st.min_accept_pct ?? 100));
      if (d.decision === "accept" && t.adjuster_email) {
        const em = acceptOfferEmail(c, t, x.amount);
        const r = await sendMail(ctx, c, { channel: "insurer_email", purpose: "accept_offer", to: t.adjuster_email, subject: em.subject, text: em.text, key: `claims-ins-accept-${m.id}`, allowedAmounts: [x.amount] });
        if (r.ok) { await patch(ctx, t.id, { state: "awaiting_payment", last_contact_at: new Date().toISOString(), next_chase_at: new Date(Date.now() + chaseDelayHours(0) * HOUR).toISOString() });
          await ctx.event(c, "insurer", `Accepted ${t.insurer_name}'s offer of ${ctx.money(x.amount)} (${d.pct}% of the estimate)`, { progress: true });
          await ctx.db.from("claim_decisions").insert({ case_id: c.id, kind: "settlement", chosen: "accept", why: `The offer was ${d.pct}% of the chosen estimate; min_accept_pct is ${st.min_accept_pct}.`, options: [], inputs: { offer: x.amount, estimate, pct: d.pct, mail_id: m.id } }); notes.push("accepted the insurer offer"); }
      } else {
        // under min_accept_pct: Jared decides. Buttons, never a counter-offer on our own.
        const qid = await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: `insurer-offer-${m.id}`,
          p_question: `${t.insurer_name} offered ${ctx.money(x.amount)}, ${d.pct}% of the ${ctx.money(estimate)} estimate. I do not accept less than ${st.min_accept_pct}% on my own. What should I do?`,
          p_options: [{ value: "accept", label: `Accept ${ctx.money(x.amount)}` }, { value: "hold", label: "Ask them to look again at the full estimate" }, { value: "mine", label: "I will handle it" }] });
        if (qid.data) await ctx.db.from("claim_questions").update({ meta: { mail_id: m.id, amount: x.amount, estimate } }).eq("id", qid.data);
        notes.push("insurer offer is below the minimum; asked Jared");
      }
    } else if (x.kind === "request" && t.adjuster_email) {
      const b = await estimateBundle(ctx, c);
      const can = x.asks.filter((a) => a === "photos" || a === "estimate");
      const cant = x.asks.filter((a) => !["photos", "estimate"].includes(a));
      if (can.length) {
        const em = documentsEmail(c, t, { estimate: b.estimate, photos: b.photos, sent: [...(can.includes("photos") ? [`${b.photos} photo${b.photos === 1 ? "" : "s"} of the damage`] : []), ...(can.includes("estimate") ? ["the repair estimate summary"] : [])] });
        const r = await sendMail(ctx, c, { channel: "insurer_email", purpose: "send_documents", to: t.adjuster_email, subject: em.subject, text: em.text, key: `claims-ins-docs-${m.id}`, attachments: b.attachments, allowedAmounts: b.estimate != null ? [b.estimate] : [] });
        if (r.ok) await ctx.event(c, "insurer", `Sent ${t.insurer_name} what they asked for (${can.join(", ")})`, { progress: true });
      }
      if (cant.length) await ctx.notify(`${t.insurer_name}'s adjuster is waiting on you`, `They asked for ${cant.join(", ")} on ${c.guest_first ?? "a"} claim. I do not have those; reply from jared@bestly.tech and I will keep the thread going.`, `claims-ins-asks-${m.id}`, "warning");
    } else if (x.kind === "payment_issued") {
      await patch(ctx, t.id, { state: "awaiting_payment", next_chase_at: new Date(Date.now() + 5 * DAY).toISOString() });
      await ctx.notify(`${t.insurer_name} says payment is on its way`, "A check or deposit was issued. I will mark the claim paid when it lands (Hermes for mail, Mercury for deposits).", `claims-ins-pay-${m.id}`, "success");
    } else if (x.kind === "denial") {
      await patch(ctx, t.id, { state: "denied" });
      await ctx.notify(`${t.insurer_name} denied ${c.guest_first ?? "the"} claim`, "Money decision: I can file with Turo if the window is still open, or you can absorb it. I am checking the Turo window now.", `claims-ins-denied-${m.id}`, "warning");
      await ctx.db.from("claim_cases").update({ needs_work: true, work_reason: "insurer denied" }).eq("id", c.id);
    }
    done.add(m.id);
  }
}

/** Jared's button on an insurer-offer question. His choice selects one of OUR emails; the words are ours. */
export async function insurerOfferAnswer(ctx: Ctx, c: Row, q: Row, answer: string, notes: string[]) {
  const t = await track(ctx, c.id); if (!t) return;
  const amount = Number(q.meta?.amount), estimate = Number(q.meta?.estimate ?? c.estimate_amount);
  if (answer === "accept" && t.adjuster_email && amount > 0) {
    const em = acceptOfferEmail(c, t, amount);
    const r = await sendMail(ctx, c, { channel: "insurer_email", purpose: "accept_offer", to: t.adjuster_email, subject: em.subject, text: em.text, key: `claims-ins-accept-${q.meta?.mail_id}`, allowedAmounts: [amount] });
    if (r.ok) { await patch(ctx, t.id, { state: "awaiting_payment", last_contact_at: new Date().toISOString(), next_chase_at: new Date(Date.now() + chaseDelayHours(0) * HOUR).toISOString() }); await ctx.event(c, "insurer", `Accepted ${t.insurer_name}'s offer of ${ctx.money(amount)} on Jared's say-so`, { progress: true }); notes.push("accepted the offer"); }
  } else if (answer === "hold" && t.adjuster_email && estimate > 0) {
    const em = holdForFullEmail(c, t, estimate);
    const r = await sendMail(ctx, c, { channel: "insurer_email", purpose: "hold_for_full", to: t.adjuster_email, subject: em.subject, text: em.text, key: `claims-ins-hold-${q.meta?.mail_id}`, allowedAmounts: [estimate] });
    if (r.ok) await ctx.event(c, "insurer", `Asked ${t.insurer_name} to look again at the full estimate`, { progress: true });
  }
}

/** Jared typed an email or phone for the insurer: it becomes the address, nothing else. */
export async function insurerContactAnswer(ctx: Ctx, c: Row, answer: string, parse: (s: string) => { email: string | null; phone: string | null }) {
  const t = await track(ctx, c.id); if (!t) return;
  if (answer === "mine") { await patch(ctx, t.id, { state: "stalled", notes: [...(t.notes ?? []), { at: new Date().toISOString(), note: "Jared is handling the insurer" }] }); return; }
  const { email, phone } = parse(answer);
  if (email || phone) { await patch(ctx, t.id, { ...(email ? { adjuster_email: email } : {}), ...(phone ? { adjuster_phone: phone } : {}) }); await ctx.db.from("claim_cases").update({ needs_work: true, work_reason: "insurer contact added" }).eq("id", c.id); await ctx.event(c, "insurer", `Saved a claims ${email ? "email" : "phone"} for ${t.insurer_name}`, {}); }
}

// ---------------------------------------------------------------- outside claims (not a Turo case): Kemper
export type OutsideNext = "wait" | "chase_email" | "chase_call" | "need_contact" | "stalled" | "done";
export function outsideClaimNext(o: Row, now: number): OutsideNext {
  if (["paid", "closed"].includes(String(o.state))) return "done";
  if (Number(o.chase_count ?? 0) >= MAX_CHASES) return "stalled";
  if (o.next_chase_at && Date.parse(o.next_chase_at) > now) return "wait";
  if (o.reply_due_at && Date.parse(o.reply_due_at) > now && !o.next_chase_at) return "wait";
  if (o.adjuster_email) return "chase_email";
  if (o.adjuster_phone) return "chase_call";
  return "need_contact";
}

export async function outsideClaimsStep(ctx: Ctx, notes: string[]): Promise<void> {
  const st = await settings(ctx);
  const { data } = await ctx.db.from("claim_outside_claims").select("*").in("state", ["open", "awaiting_payment"]);
  for (const o of (data ?? []) as Row[]) {
    const next = outsideClaimNext(o, Date.now());
    if (next === "wait" || next === "done") continue;
    const upd = (p: Row) => ctx.db.from("claim_outside_claims").update(p).eq("id", o.id);
    if (next === "need_contact") {
      const sup = String(((o.notes ?? []) as Row[]).map((n) => n.note ?? "").find((t) => /supervisor/i.test(t)) ?? "");
      await ctx.notify(`${o.label}: no adjuster contact on file`, `The reply deadline ${fmtPT(o.reply_due_at)} has passed and I have no email or phone for ${o.insurer_name}. Your decision: add the adjuster's contact so I can chase, or escalate yourself.${sup ? ` Your own note says: ${sup}` : ""}`, `claims-outside-contact-${o.id}`, "warning"); continue;
    }
    if (next === "stalled") { await ctx.notify(`${o.label}: ${o.insurer_name} is not answering`, `I chased ${MAX_CHASES} times. Your call: supervisor escalation by phone or another route.`, `claims-outside-stalled-${o.id}`, "warning"); continue; }
    if (st.insurer_contact_mode !== "full") { notes.push(`outside claim ${o.claim_no}: draft only`); continue; }
    const t = { insurer_name: o.insurer_name, claim_no: o.claim_no, policy_no: null };
    const c = { id: o.id, car: "2020 Tesla Model 3" };
    let sent = false;
    if (next === "chase_email") {
      const m = chaseEmail(c, t, Number(o.chase_count ?? 0) + 1);
      sent = (await sendMail(ctx, o, { outside: true, channel: "insurer_email", purpose: "chase", to: o.adjuster_email, subject: m.subject, text: m.text, key: `claims-outside-chase-${o.id}-${Number(o.chase_count ?? 0) + 1}`, allowedAmounts: o.amount_expected ? [Number(o.amount_expected)] : [] })).ok;
    } else {
      sent = (await avaCall(ctx, o, { channel: "adjuster_call", why: "outside_chase", phone: o.adjuster_phone, name: o.insurer_name, purpose: chaseCallScript(c, t), first_line: `Hi, it's Jared Best's AI assistant, on a recorded line. I'm calling for a status update on a claim.` })).ok;
    }
    if (sent) { await upd({ chase_count: Number(o.chase_count ?? 0) + 1, last_contact_at: new Date().toISOString(), next_chase_at: new Date(Date.now() + chaseDelayHours(Number(o.chase_count ?? 0) + 1) * HOUR).toISOString() }); notes.push(`chased ${o.insurer_name} on ${o.claim_no}`); }
  }
}
