// Claims Closer v2: booking the repair (phase 6), answered questions (phase 7) and the insurer / third party steps (phase 5).
// docs/claims-closer-v2-opusplan.md. Free AI only (paid: "never"). Nothing here spends Jared's money: Ava never agrees to pay or
// authorizes work, and the parking garage is only contacted after Jared answers yes.
//
//   booking   waits for Jared's "Book it" tap (claims_book sets repair_booking.state = 'requested'). Then: pick drop-off times the car
//             is free (no turo_trips overlap), Ava calls the chosen shop and offers them, the call summary is read with free AI, a
//             confirmed time goes on Jared's calendar and he gets one alert. Two failed calls -> a question for Jared.
//   answers   claim_questions answered on the Claims page (or by Scout) are acted on once (handled_at).
//   insurer   the guest's insurer + policy number are pulled out of their reply; the parking garage question is raised once.
import type { Ctx } from "./estimates.ts";
import { sendMail, photoAttachments } from "./estimates.ts";
import { canSend, logSend, queueTuroAction } from "./send.ts";
import { laInstant, spokenTime } from "./time.ts";
import { bookingSlots } from "./autonomy.ts";
import { insurerContactAnswer, insurerOfferAnswer } from "./insurer.ts";
import { parseContactNote } from "./insurer-text.ts";
import { pathExhaustedAnswer, teslaTotalAnswer } from "./engine.ts";
import { INTENT_PROMPT, classifyByRules, composeShopAnswer, composeShopClose, groupAnswers, intentFromModel, parseShopAsk, planAnswer, questionStale, type Intent } from "./answers.ts";

type Row = Record<string, any>;
const SLUG = "claims-closer";

// ---------------------------------------------------------------- time helpers (Los Angeles): time.ts
const TZ = "America/Los_Angeles";
const HOUR = 36e5;
const carName = (c: Row) => String(c.car ?? "2020 Tesla Model 3").replace(/\s+\(.*\)$/, "");

/** Drop-off times (8:30 AM Pacific, weekdays, starting tomorrow) when the car has no booked Turo trip for the repair days plus the buffer (booking_buffer_hours, default 4). */
export async function freeDropoffs(ctx: Ctx, c: Row, days: number, count = 3, horizonDays = 14): Promise<number[]> {
  const [{ data: trips }, { data: st }] = await Promise.all([
    ctx.db.from("turo_trips").select("starts_at, ends_at, vin, status").gt("ends_at", new Date().toISOString()),
    ctx.db.from("claims_autonomy_settings").select("booking_buffer_hours").eq("id", true).maybeSingle(),
  ]);
  return bookingSlots((trips ?? []) as Row[], { now: Date.now(), days, count, horizonDays, bufferHours: Number(st?.booking_buffer_hours ?? 4), vin: c.vin });
}

// ---------------------------------------------------------------- the call
async function avaCall(ctx: Ctx, c: Row, o: { phone: string; name: string; purpose: string; first_line: string }, allowedAmounts: number[] = []): Promise<{ ok: boolean; call_id?: string; error?: string; retryable?: boolean; blocked?: boolean }> {
  const d = await canSend(ctx, c, { channel: "ava_call", recipient: o.phone, purpose: "book_repair", text: `${o.first_line}\n${o.purpose}`, allowedAmounts });
  if (!d.ok) return { ok: false, blocked: true, error: `blocked: ${d.reason}`, retryable: true };
  const r = await fetch(`${ctx.supabaseUrl}/functions/v1/ava-assistant`, {
    method: "POST", headers: { Authorization: `Bearer ${ctx.serviceKey}`, apikey: ctx.serviceKey, "Content-Type": "application/json" },
    // Jared (2026-10-06): shop calls go out in his voice (still disclosed as his AI assistant); no clone = her own voice
    body: JSON.stringify({ action: "call", ...o, voice: "jared", voice_fallback: true, allow_booking: true,
      jared_first_line: o.first_line.replace(/^Hi, it's Ava, Jared Best's AI assistant, on a recorded line\./, "Hi, it's Jared Best's AI assistant, using his voice, on a recorded line.") }),
  }).catch(() => null);
  const j = await r?.json().catch(() => ({}));
  const out = r?.ok && j?.ok ? { ok: true, call_id: j.call_id } : { ok: false, error: String(j?.error ?? `ava-assistant ${r?.status ?? "no answer"}`).slice(0, 200), retryable: j?.retryable === true };
  await logSend(ctx, c, { channel: "ava_call", recipient: o.phone, purpose: "book_repair", text: o.purpose }, out.ok ? "sent" : "failed", undefined, out);
  return out;
}

function bookingPurpose(c: Row, shop: Row, est: Row, slots: number[], ref: string, days: number) {
  const times = slots.map(spokenTime);
  return `Jared decided to have ${shop.name} repair his ${carName(c)}: the passenger-side front bumper corner (scrapes, a paint chip and a pushed-in bumper cover). `
    + `They gave an estimate (reference ${ref}, emailed from jared@bestly.tech${est.amount ? `, total about $${Math.round(Number(est.amount)).toLocaleString("en-US")}` : ""}). `
    + `You are calling to book the drop-off. Ask for the person who schedules repairs. Offer these drop-off times, in this order: ${times.join("; ")}. `
    + `If one works, say it back once, then ask how many days the repair will take and when the car will be ready. `
    + `If none works, ask for their earliest drop-off times and repeat them back, and say you will pass them to Jared; do not accept a time that was not offered. `
    + `Never agree to pay anything, never authorize extra work, never give payment details. If asked about the claim, say it is a car-sharing damage repair and Jared will follow up. Keep it short (about ${days} day repair).`;
}

const EXTRACT = `You read the summary and transcript of a phone call where an assistant tried to book a car repair drop-off at a body shop.
Reply ONLY JSON: {"booked": bool, "dropoff_local": "YYYY-MM-DD HH:MM"|null, "days": number|null, "ready_local": "YYYY-MM-DD HH:MM"|null,
 "alt_times": ["YYYY-MM-DD HH:MM"], "reached_human": bool, "voicemail": bool, "notes": string}
booked = true ONLY if the shop clearly agreed to one specific drop-off date and time. dropoff_local = that time in Los Angeles local time, 24-hour clock.
alt_times = other drop-off times the shop said they could do. Resolve weekdays like "Friday" from the call date given. Never invent a time that is not in the call. notes <= 200 chars.`;

// ---------------------------------------------------------------- phase 6
export async function bookingStep(ctx: Ctx, c: Row, notes: string[]): Promise<void> {
  const rb = (c.repair_booking ?? {}) as Row;
  const state = String(rb.state ?? "");
  if (!["requested", "calling"].includes(state)) return;
  const { data: shop } = await ctx.db.from("claim_shops").select("*").eq("id", c.chosen_shop_id).maybeSingle();
  const { data: est } = await ctx.db.from("claim_estimates").select("*").eq("id", c.chosen_estimate_id).maybeSingle();
  if (!shop || !est) return;
  const save = (patch: Row, next?: number) => ctx.db.from("claim_cases").update({ repair_booking: { ...rb, ...patch }, ...(next ? { next_check_at: new Date(Date.now() + next).toISOString() } : {}) }).eq("id", c.id);
  const days = Math.min(7, Math.max(1, Number(est.line_items?.days ?? 3) || 3));

  if (state === "calling") {
    const { data: call } = await ctx.db.from("ava_calls").select("status, summary, transcript, created_at, ended_at").eq("id", rb.call_id).maybeSingle();
    const age = call ? Date.now() - Date.parse(call.created_at) : 0;
    if (!call || (call.status !== "completed" && age < 25 * 60_000)) { await ctx.db.from("claim_cases").update({ next_check_at: new Date(Date.now() + 3 * 60_000).toISOString() }).eq("id", c.id); return; }
    let x: Row | null = null;
    if (call.status === "completed") {
      try {
        const r = await ctx.llm({ task: "extract", system: EXTRACT, json: true, job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 45_000, maxTokens: 500,
          user: `CALL DATE (Los Angeles): ${new Date(call.created_at).toLocaleString("en-US", { timeZone: TZ, dateStyle: "full", timeStyle: "short" })}\nOFFERED: ${(rb.slots_offered ?? []).map((ms: number) => spokenTime(ms)).join("; ")}\nSUMMARY: ${call.summary ?? ""}\nTRANSCRIPT: ${JSON.stringify(call.transcript ?? "").slice(0, 6000)}`,
          validate: (j: Row) => typeof j === "object" && j ? null : "not an object" });
        x = r.json;
      } catch (e) { if (!(e instanceof ctx.LlmUnavailable)) throw e; await ctx.db.from("claim_cases").update({ next_check_at: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", c.id); return; }
    }
    // a time only counts if it is one Ava offered (she may not accept anything else) and the car is still free then
    const m = x?.booked && typeof x.dropoff_local === "string" ? /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(x.dropoff_local.trim()) : null;
    const when = m ? laInstant(m[1], Number(m[2]), Number(m[3])) : null;
    const offered = ((rb.slots_offered ?? []) as number[]);
    const hit = when !== null && offered.some((o) => Math.abs(o - when) < 15 * 60_000);
    if (hit && when! > Date.now()) {
      const repairDays = Math.min(14, Math.max(1, Number(x?.days ?? days) || days));
      const ready = typeof x?.ready_local === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x.ready_local) ? laInstant(x.ready_local.slice(0, 10), Number(x.ready_local.slice(11, 13)), Number(x.ready_local.slice(14, 16))) : when! + repairDays * 24 * HOUR;
      await ctx.db.from("claim_cases").update({ repair_booking: { ...rb, state: "booked", dropoff_at: new Date(when!).toISOString(), pickup_at: new Date(ready).toISOString(), days: repairDays, booked_at: new Date().toISOString(), notes: String(x?.notes ?? "").slice(0, 300) }, next_check_at: null, needs_work: true, work_reason: "repair booked" }).eq("id", c.id);
      await ctx.event(c, "booking", `Booked ${shop.name}: drop off ${ctx.fmt(new Date(when!).toISOString())}`, { call_id: rb.call_id, dropoff_at: new Date(when!).toISOString() });
      let calNote = "";
      const cal = await fetch(`${ctx.supabaseUrl}/functions/v1/ava-assistant`, { method: "POST", headers: { Authorization: `Bearer ${ctx.serviceKey}`, apikey: ctx.serviceKey, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "calendar_add", uid: `claims-repair-${c.id}@bestly.tech`, start: new Date(when!).toISOString(), end: new Date(when! + 45 * 60_000).toISOString(),
          summary: `Drop off the Tesla at ${shop.name}`, description: `Repair of the ${carName(c)} (Turo claim ${c.turo_claim_no ?? ""}). ${shop.address ?? ""} ${shop.phone ?? ""}. Estimate ${ctx.money(Number(est.amount))}. Ready about ${ctx.fmt(new Date(ready).toISOString())}.` }) }).then((r) => r.json()).catch(() => null);
      calNote = cal?.ok ? " It is on your calendar." : " It is not on your calendar yet.";
      await ctx.notify(`Repair booked: ${ctx.fmt(new Date(when!).toISOString())}`, `${shop.name}, ${shop.address ?? ""}. Ready about ${ctx.fmt(new Date(ready).toISOString())}.${calNote} I will remind you the evening before and that morning.`, `claims-booked-${c.id}`, "warning");
      notes.push(`booked ${shop.name}`);
      return;
    }
    // not booked
    const tries = Number(rb.tries ?? 1);
    const alts = ((x?.alt_times ?? []) as string[]).filter((t) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)).map((t) => laInstant(t.slice(0, 10), Number(t.slice(11, 13)), Number(t.slice(14, 16)))).filter((t) => t > Date.now());
    await ctx.event(c, "booking", `Call to ${shop.name} did not book a time`, { tries, notes: x?.notes ?? call.summary?.slice(0, 200) ?? "no answer", alt: alts });
    if (tries >= 2 || alts.length) {
      await save({ state: "failed", last_note: String(x?.notes ?? "").slice(0, 200) });
      const altTxt = alts.length ? ` They offered ${alts.slice(0, 2).map((t) => ctx.fmt(new Date(t).toISOString())).join(" or ")}.` : "";
      await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: `booking-${tries}-${Date.now().toString(36)}`,
        p_question: `I could not lock in a drop-off at ${shop.name} (${tries} call${tries === 1 ? "" : "s"}).${altTxt} What should I do?`,
        p_options: [...alts.slice(0, 2).map((t) => ({ value: `alt:${t}`, label: `Take ${ctx.fmt(new Date(t).toISOString())}` })), { value: "retry", label: "Call again" }, { value: "by_hand", label: "I will book it" }] });
      return;
    }
    await save({ state: "requested", tries }, 3 * HOUR);
    notes.push("booking call did not land; will try once more");
    return;
  }

  // state === 'requested': place the call
  if (rb.last_try_at && Date.now() - Date.parse(rb.last_try_at) < 2 * HOUR && Number(rb.tries ?? 0) > 0) { await ctx.db.from("claim_cases").update({ next_check_at: new Date(Date.parse(rb.last_try_at) + 2 * HOUR).toISOString() }).eq("id", c.id); return; }
  const slots = Array.isArray(rb.offer) && rb.offer.length ? (rb.offer as number[]).filter((t) => t > Date.now()) : await freeDropoffs(ctx, c, days);
  if (!slots.length) {
    await save({ state: "failed" });
    await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: "booking-noslots", p_question: `The car has a Turo trip on every weekday in the next two weeks, so I found no free ${days}-day window for the repair. Want me to book anyway on the least busy days, or will you pick?`,
      p_options: [{ value: "by_hand", label: "I will pick" }] });
    return;
  }
  const r = await avaCall(ctx, c, { phone: shop.phone, name: shop.name, purpose: bookingPurpose(c, shop, est, slots, est.ref ?? "", days),
    first_line: `Hi, it's Ava, Jared Best's AI assistant, on a recorded line. I'm calling to book a drop-off for a repair he asked about.` }, est.amount ? [Math.round(Number(est.amount)), Number(est.amount)] : []);
  if (r.blocked) { notes.push(`booking call held: ${r.error}`); await ctx.db.from("claim_cases").update({ next_check_at: new Date(Date.now() + 30 * 60_000).toISOString() }).eq("id", c.id); return; }
  const tries = Number(rb.tries ?? 0) + 1;
  if (r.ok) {
    await save({ state: "calling", call_id: r.call_id, tries, last_try_at: new Date().toISOString(), slots_offered: slots, offer: null }, 4 * 60_000);
    await ctx.event(c, "booking", `Ava is calling ${shop.name} to book the drop-off`, { call_id: r.call_id, offered: slots.map((s) => new Date(s).toISOString()) });
    notes.push(`Ava calling ${shop.name}`);
  } else {
    await save({ tries, last_try_at: new Date().toISOString(), last_note: r.error }, r.retryable ? 70 * 60_000 : 2 * HOUR);
    await ctx.event(c, "booking", `Could not place the call to ${shop.name}`, { error: r.error });
    if (tries >= 3) {
      await save({ state: "failed" });
      await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: `booking-nocall-${tries}`, p_question: `Ava could not place the booking call to ${shop.name} (${r.error}). Call ${shop.phone} yourself?`, p_options: [{ value: "by_hand", label: "I will book it" }, { value: "retry", label: "Try again" }] });
    }
  }
}

// ---------------------------------------------------------------- phase 7: act on answers (once)
// RULE (Jared, 2026-10-28): an answer is an INSTRUCTION TO CLAIMS CLOSER. Nothing he types is ever forwarded or quoted to a shop, guest, insurer or Turo.
// Claims Closer reads what he meant (button, rules, then the free LLM ladder), then writes its own message in its own words, or sends nothing.
// Several questions that got the same answer are ONE decision. Questions that went stale (over 7 days, the world moved on) are retired, not acted on.
export async function answeredQuestions(ctx: Ctx, c: Row, notes: string[]): Promise<void> {
  const { data: qs } = await ctx.db.from("claim_questions").select("*").eq("case_id", c.id).not("answered_at", "is", null).is("handled_at", null);
  const all = (qs ?? []) as Row[];
  const now = Date.now();
  const { data: win } = await ctx.db.from("claim_windows").select("kind, status").eq("case_id", c.id);
  const { data: ests } = await ctx.db.from("claim_estimates").select("id, status, ref, shop_id, claim_shops(name, email, contact_name)").eq("case_id", c.id);
  const estById = new Map<string, Row>(((ests ?? []) as Row[]).map((e) => [e.id, e]));
  const resolveClosed = ((win ?? []) as Row[]).some((w) => w.kind === "resolve_directly" && ["lapsed", "moot"].includes(w.status)) || (c.path === "resolve_directly" && !!c.escalate_by && Date.parse(c.escalate_by) < now);
  const estimateObtained = c.estimate_amount != null || !!c.chosen_estimate_id;
  const staleOf = (q: Row) => questionStale(q, { now, caseClosed: ["paid", "closed"].includes(String(c.status)), estimateObtained, resolveWindowClosed: resolveClosed,
    shopThreadOpen: q.meta?.estimate_id ? ["requested", "replied", "needs_visit"].includes(String(estById.get(q.meta.estimate_id)?.status ?? "")) : null });

  // 1. shop questions: one decision per (case, answer)
  const shopQs = all.filter((q) => /^shop-asks-/.test(String(q.key ?? "")));
  for (const group of groupAnswers(shopQs)) {
    try { await handleShopGroup(ctx, c, group, estById, staleOf, notes); }
    catch (e) { notes.push(`answer step failed: ${String(e).slice(0, 80)}`); }
  }

  // 2. everything else (button-style questions)
  for (const q of all.filter((x) => !/^shop-asks-/.test(String(x.key ?? "")))) {
    const a = String(q.answer ?? "").trim();
    const key = String(q.key ?? "");
    let done = true;
    const st = staleOf(q);
    try {
      if (st.stale) {
        await ctx.db.from("claim_questions").update({ retired_at: new Date().toISOString(), retired_reason: st.reason, handled_at: new Date().toISOString() }).eq("id", q.id);
        await ctx.event(c, "question", `Retired an old question (${st.reason}); no action taken`, { question_id: q.id });
        continue;
      }
      if (/^turo-(action|stuck)-/.test(key)) {
        const actionId = key.replace(/^turo-(action|stuck)-/, "");
        if (a === "retry") {
          const { data: old } = await ctx.db.from("claim_turo_actions").select("kind, payload").eq("id", actionId).maybeSingle();
          if (old) {
            const r = await queueTuroAction(ctx, c, old.kind, old.payload ?? {}, [Number(old.payload?.amount ?? 0), Number(old.payload?.estimate_total ?? 0)].filter(Boolean));
            if (r.ok) await ctx.event(c, "turo_action", `Trying the Turo ${String(old.kind).replace("_", " ")} again`, { by: "answer" });
            else notes.push(`Turo retry held: ${r.error}`);
          }
        } else if (a === "done" || a === "by_hand") {
          await ctx.db.from("claim_cases").update({ turo_invoice: { by_hand: true, at: new Date().toISOString() }, needs_work: true, work_reason: "invoice handled by Jared" }).eq("id", c.id);
        }
      } else if (key.startsWith("booking")) {
        const rb = (c.repair_booking ?? {}) as Row;
        if (a === "retry") await ctx.db.from("claim_cases").update({ repair_booking: { state: "requested", tries: 0, shop_id: c.chosen_shop_id }, needs_work: true }).eq("id", c.id);
        else if (a.startsWith("alt:")) {
          const t = Date.parse(a.slice(4));
          if (Number.isFinite(t) && t > Date.now()) await ctx.db.from("claim_cases").update({ repair_booking: { state: "requested", tries: 0, shop_id: c.chosen_shop_id, offer: [t] }, needs_work: true }).eq("id", c.id);
        } else if (a === "by_hand") await ctx.db.from("claim_cases").update({ repair_booking: { ...rb, state: "by_hand" }, needs_work: false }).eq("id", c.id);
      } else if (key.startsWith("path-exhausted-")) {
        await pathExhaustedAnswer(ctx, c, a);
      } else if (key.startsWith("tesla-total-")) {
        if (a !== "none" && !(await teslaTotalAnswer(ctx, c, a))) { await ctx.event(c, "note", "Saved Jared's note; there was no dollar total in it, so no Tesla estimate was added", { question_id: q.id }); }
      } else if (key.startsWith("insurer-offer-")) {
        await insurerOfferAnswer(ctx, c, q, a, notes);
      } else if (key.startsWith("insurer-contact-")) {
        await insurerContactAnswer(ctx, c, a, parseContactNote);
      } else if (key === "garage-claim") {
        if (/^yes/i.test(a)) {
          const r = await garageEmail(ctx, c);
          if (r.ok) { await ctx.event(c, "third_party", "Emailed the garage operator (ABM Parking) about the damage", { mail_id: r.id }); await ctx.notify("Told the garage operator about the damage", "I emailed ABM Parking (they run the Fig at 7th garage) with the photos and asked how to file a claim. Replies come to your inbox.", `claims-garage-sent-${c.id}`, "success"); }
          else if (r.blocked) { notes.push(`garage email held: ${r.error}`); }
          else { done = false; notes.push(`garage email failed: ${r.error}`); }
        } else await ctx.event(c, "third_party", "Jared said no to contacting the garage", {});
      } else if (a && !/^(yes|no|retry|done|by_hand|wait|walk_in)$/i.test(a)) {
        // a free-text note on a question that has no free-text handler: keep it as a note, send nothing
        await ctx.event(c, "note", "Saved Jared's note for Claims Closer; nothing was sent to anyone", { question_id: q.id });
      }
    } catch (e) { done = false; notes.push(`answer step failed: ${String(e).slice(0, 80)}`); }
    if (done) await ctx.db.from("claim_questions").update({ handled_at: new Date().toISOString() }).eq("id", q.id);
  }
}

/** Turn the note into an intent: button value, then rules, then the free LLM ladder. Anything unclear is "other" (nothing is sent). */
async function readIntent(ctx: Ctx, c: Row, q: Row): Promise<{ intent: Intent; via: string }> {
  const r = classifyByRules(String(q.answer ?? ""), (q.options ?? []) as { value: string }[]);
  if (r.confident) return { intent: r.intent, via: r.via };
  try {
    const m = await ctx.llm({ task: "extract", system: INTENT_PROMPT, user: `QUESTION: ${String(q.question).slice(0, 300)}\nNOTE: ${String(q.answer).slice(0, 300)}`, json: true,
      job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 30_000, maxTokens: 60, validate: (j: Row) => typeof j === "object" && j ? null : "not an object" });
    return { intent: intentFromModel(m.json), via: "model" };
  } catch (e) { if (!(e instanceof ctx.LlmUnavailable)) throw e; }
  return { intent: r.intent === "provide_info" ? "provide_info" : "other", via: "fallback" };
}

async function handleShopGroup(ctx: Ctx, c: Row, group: Row[], estById: Map<string, Row>, staleOf: (q: Row) => { stale: boolean; reason?: string }, notes: string[]) {
  const first = group[0];
  const { intent, via } = await readIntent(ctx, c, first);
  const staleBy: Record<string, string | undefined> = {};
  for (const q of group) { const s = staleOf(q); if (s.stale) staleBy[q.id] = s.reason; }
  const plan = planAnswer(group, intent, { staleBy, estimateIdOf: (q) => { const e = estById.get(String(q.meta?.estimate_id ?? String(q.key).replace(/^shop-asks-/, ""))); return e ? { id: e.id, shop: e.claim_shops?.name ?? "the shop" } : null; } });
  const out: string[] = []; let retry = false;
  for (const fx of plan.effects) {
    if (fx.type === "retire") {
      await ctx.db.from("claim_questions").update({ retired_at: new Date().toISOString(), retired_reason: fx.reason }).eq("id", fx.questionId);
      out.push("retired one old question");
    } else if (fx.type === "close_shop") {
      const e = estById.get(fx.estimateId)!; const shop = e.claim_shops ?? {};
      await ctx.db.from("claim_estimates").update({ status: "closed", notes: "closed by Claims Closer on Jared's instruction" }).eq("id", fx.estimateId);
      let sent = false;
      if (fx.sendLine && shop.email) {
        const r = await sendMail(ctx, c, { to: shop.email, subject: `Re: Photo estimate request [${e.ref}]`, key: `claims-est-close-${fx.estimateId}`, text: composeShopClose(shop.name, shop.contact_name ? String(shop.contact_name).split(/\s+/)[0] : null), purpose: "close_shop", derivedFromAnswer: true });
        sent = r.ok; if (r.error && !r.blocked) retry = true;
      }
      await ctx.event(c, "estimate", `Closed ${fx.shop}'s estimate request${sent ? " with a one-line thank you" : ""}`, { estimate_id: fx.estimateId, sent_line: sent });
      out.push(`closed ${fx.shop}`);
    } else if (fx.type === "answer_shop") {
      const e = estById.get(fx.estimateId)!; const shop = e.claim_shops ?? {};
      const q = group.find((g) => (g.meta?.estimate_id ?? String(g.key).replace(/^shop-asks-/, "")) === fx.estimateId)!;
      const photos = await photoAttachments(ctx, c.id);
      const mine = composeShopAnswer(shop.name ?? "", parseShopAsk(String(q.meta?.asks_for ?? q.question ?? "")), { vin: c.vin, photoCount: photos.list.length, contactFirst: shop.contact_name ? String(shop.contact_name).split(/\s+/)[0] : null });
      if (!mine.text || !shop.email) {
        await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "fyi", p_key: `shop-unanswered-${fx.estimateId}`, p_options: [],
          p_question: `${fx.shop} asked something I can't answer from the case record (${mine.left.join(", ") || "no email on file"}), so I sent nothing. Drop that shop or wait; I won't relay what you type.` });
        out.push(`left ${fx.shop} unanswered`);
      } else {
        const r = await sendMail(ctx, c, { to: shop.email, subject: `Re: Photo estimate request [${e.ref}]`, key: `claims-est-answer-${q.id}`, text: mine.text, attachments: mine.attachPhotos ? photos.list : [], purpose: "answer_shop", derivedFromAnswer: true });
        if (r.ok) { await ctx.event(c, "estimate", `Answered ${fx.shop}'s question`, { estimate_id: fx.estimateId, answered: mine.answered }); out.push(`answered ${fx.shop}`); }
        else if (!r.blocked) retry = true;
        // NOTE: the estimate row is left exactly as it was. (It used to be reset to 'requested' with requested_at = now, which restarted the 24 h / 48 h follow-up clocks.)
      }
    } else if (fx.type === "defer") {
      await ctx.db.from("claim_questions").update({ answered_at: null, answer: null, answered_by: null, snoozed_until: new Date(Date.now() + 24 * 36e5).toISOString() }).eq("id", fx.questionId);
      out.push("will ask again tomorrow");
    } else {
      await ctx.event(c, "note", "Saved Jared's note for Claims Closer; nothing was sent to anyone", { question_id: fx.questionId });
    }
  }
  if (!retry) {
    const deferred = new Set(plan.effects.filter((f) => f.type === "defer").map((f) => (f as { questionId: string }).questionId));
    const ids = group.filter((q) => !deferred.has(q.id)).map((q) => q.id);
    if (ids.length) await ctx.db.from("claim_questions").update({ handled_at: new Date().toISOString() }).in("id", ids);
  }
  await ctx.db.from("claim_decisions").insert({ case_id: c.id, kind: "answer", chosen: intent, why: plan.why, options: [], inputs: { question_ids: plan.questionIds, read_by: via, effects: plan.effects.map((f) => f.type), words_sent: false } });
  if (out.length) { notes.push(out.join("; ")); await ctx.notify(`Handled your note on ${group.length} shop question${group.length === 1 ? "" : "s"}`, `Read as "${intent}": ${out.join("; ")}. What you typed was not sent to anyone.`, `claims-answer-${group.map((g) => g.id).sort()[0]}`, "success"); }
}

async function garageEmail(ctx: Ctx, c: Row) {
  const { data: ev } = await ctx.db.from("claim_evidence").select("storage_path, bytes").eq("case_id", c.id).eq("kind", "after").order("taken_at").limit(6);
  const attachments: { filename: string; content: string }[] = []; let total = 0;
  for (const e of (ev ?? []) as Row[]) {
    if (total + Number(e.bytes ?? 0) > 6_000_000) continue;
    const { data: blob } = await ctx.db.storage.from("claim-evidence").download(e.storage_path);
    if (!blob) continue;
    const buf = new Uint8Array(await blob.arrayBuffer()); total += buf.length;
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    attachments.push({ filename: `damage-${attachments.length + 1}.jpg`, content: btoa(bin) });
  }
  const trip = c.trip_end ? ctx.fmt(c.trip_end) : "early October";
  return await sendMail(ctx, c, { channel: "garage_email", purpose: "garage_claim", to: "contactparking@abm.com", subject: `Damage claim: ${carName(c)} at The Fig at 7th garage (945 W 8th St)`, key: `claims-garage-${c.id}`, attachments,
    text: `Hello,\n\nMy ${carName(c)} was rented through a car-sharing platform, and the renter reports it was scraped while parked in The Fig at 7th garage (945 W 8th St, Los Angeles) during the rental that ended ${trip}. I attached photos of the damage.\n\nCould you tell me how to file a claim with the garage operator, and whether there is an incident report or camera footage for that period? Please reply to this email.\n\nThank you,\nJared Best` });
}

// ---------------------------------------------------------------- phase 5: insurer + the parking garage
export async function thirdParties(ctx: Ctx, c: Row, notes: string[]): Promise<void> {
  // the garage: ask Jared once when the guest says it happened in a parking garage; never contacted without a yes
  const gr = JSON.stringify(c.guest_response ?? {}).toLowerCase();
  if (/(parking garage|parking lot|garage|parkabm|valet)/.test(gr)) {
    const place = ((c.guest_response?.answers ?? {}) as Record<string, string>);
    const where = Object.values(place).find((v) => /parking|garage|abm|fig at/i.test(String(v))) ?? "a parking garage";
    await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision", p_key: "garage-claim",
      p_question: `${c.guest_first ?? "The guest"} says the damage happened in a parking garage (${String(where).slice(0, 120)}). Want me to email the garage operator (ABM Parking) with the photos and ask how to file a claim? I will not contact them unless you say yes.`,
      p_options: [{ value: "yes", label: "Yes, email them" }, { value: "no", label: "No" }] });
  }
  // the guest's insurer + policy number, pulled out of what they wrote (never guessed)
  if (!c.insurer || !Object.keys(c.insurer).length) {
    const { data: inbox } = await ctx.db.from("turo_inbox").select("body, role, sent_at").eq("reservation_id", c.reservation_id).eq("role", "GUEST").order("sent_at", { ascending: false }).limit(6);
    const text = ((inbox ?? []) as Row[]).map((m) => String(m.body ?? "")).join("\n---\n").slice(0, 3000);
    if (text && /(insur|policy|geico|state farm|progressive|allstate|farmers|usaa|liberty|nationwide|mercury|travelers|esurance|metlife)/i.test(text)) {
      try {
        const r = await ctx.llm({ task: "extract", json: true, job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 40_000, maxTokens: 300,
          system: `Messages from a car renter. Reply ONLY JSON {"insurer": string|null, "policy_no": string|null, "claim_no": string|null, "phone": string|null}. Only values the renter actually wrote. If they did not name their insurer, insurer is null.`,
          user: text, validate: (j: Row) => typeof j === "object" && j ? null : "not an object" });
        const x = r.json as Row;
        const low = text.toLowerCase();
        if (typeof x.insurer === "string" && x.insurer.length > 2 && low.includes(x.insurer.toLowerCase().slice(0, 5))) {
          const ins = { name: x.insurer.slice(0, 60), policy_no: typeof x.policy_no === "string" && low.includes(x.policy_no.toLowerCase()) ? x.policy_no.slice(0, 40) : null,
            claim_no: typeof x.claim_no === "string" && low.includes(x.claim_no.toLowerCase()) ? x.claim_no.slice(0, 40) : null, source: "guest reply", at: new Date().toISOString() };
          await ctx.db.from("claim_cases").update({ insurer: ins, needs_work: true, work_reason: "guest gave their insurer" }).eq("id", c.id);
          c.insurer = ins;
          await ctx.event(c, "insurer", `${c.guest_first ?? "Guest"}'s insurer: ${ins.name}${ins.policy_no ? ` (policy ${ins.policy_no})` : ""}`, ins);
          await ctx.notify(`${c.guest_first ?? "The guest"} named their insurer: ${ins.name}`, `${ins.policy_no ? `Policy ${ins.policy_no}. ` : "No policy number yet. "}The full repair can go through them now.`, `claims-insurer-${c.id}`, "success");
          notes.push(`insurer ${ins.name}`);
        }
      } catch (e) { if (!(e instanceof ctx.LlmUnavailable)) throw e; }
    }
  }
}
