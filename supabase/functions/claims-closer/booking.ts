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
import { sendMail } from "./estimates.ts";

type Row = Record<string, any>;
const SLUG = "claims-closer";
const TZ = "America/Los_Angeles";
const HOUR = 36e5;

// ---------------------------------------------------------------- time helpers (Los Angeles)
function laInstant(dateIso: string, h: number, m: number): number {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  const asLA = new Date(new Date(guess).toLocaleString("en-US", { timeZone: TZ })).getTime();
  return guess + (guess - asLA);
}
const laDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
const laWeekday = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
const spokenTime = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const carName = (c: Row) => String(c.car ?? "2020 Tesla Model 3").replace(/\s+\(.*\)$/, "");

/** Drop-off times (8:30 AM Pacific, weekdays, starting tomorrow) when the car has no Turo trip for the repair days. */
export async function freeDropoffs(ctx: Ctx, c: Row, days: number, count = 3, horizonDays = 14): Promise<number[]> {
  const { data: trips } = await ctx.db.from("turo_trips").select("starts_at, ends_at, vin, status").gt("ends_at", new Date().toISOString());
  const mine = ((trips ?? []) as Row[]).filter((t) => t.status !== "CANCELLED" && (!t.vin || !c.vin || t.vin === c.vin));
  const out: number[] = [];
  const tomorrow = Date.parse(laDate(Date.now() + 24 * HOUR) + "T12:00:00Z");
  for (let i = 0; i < horizonDays && out.length < count; i++) {
    const day = laDate(tomorrow + i * 24 * HOUR);
    const wd = laWeekday(laInstant(day, 12, 0));
    if (wd === "Sat" || wd === "Sun") continue;
    const drop = laInstant(day, 8, 30);
    const pick = drop + days * 24 * HOUR + 2 * HOUR;
    if (mine.some((t) => Date.parse(t.starts_at) < pick && Date.parse(t.ends_at) > drop - 2 * HOUR)) continue;
    if (out.length && drop - out[out.length - 1] < 20 * HOUR) continue;
    out.push(drop);
  }
  return out;
}

// ---------------------------------------------------------------- the call
async function avaCall(ctx: Ctx, o: { phone: string; name: string; purpose: string; first_line: string }): Promise<{ ok: boolean; call_id?: string; error?: string; retryable?: boolean }> {
  const r = await fetch(`${ctx.supabaseUrl}/functions/v1/ava-assistant`, {
    method: "POST", headers: { Authorization: `Bearer ${ctx.serviceKey}`, apikey: ctx.serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "call", ...o }),
  }).catch(() => null);
  const j = await r?.json().catch(() => ({}));
  return r?.ok && j?.ok ? { ok: true, call_id: j.call_id } : { ok: false, error: String(j?.error ?? `ava-assistant ${r?.status ?? "no answer"}`).slice(0, 200), retryable: j?.retryable === true };
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
  const r = await avaCall(ctx, { phone: shop.phone, name: shop.name, purpose: bookingPurpose(c, shop, est, slots, est.ref ?? "", days),
    first_line: `Hi, it's Ava, Jared Best's AI assistant, on a recorded line. I'm calling to book a drop-off for a repair he asked about.` });
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
export async function answeredQuestions(ctx: Ctx, c: Row, notes: string[]): Promise<void> {
  const { data: qs } = await ctx.db.from("claim_questions").select("*").eq("case_id", c.id).not("answered_at", "is", null).is("handled_at", null);
  for (const q of (qs ?? []) as Row[]) {
    const a = String(q.answer ?? "").trim();
    const key = String(q.key ?? "");
    let done = true;
    try {
      if (/^turo-(action|stuck)-/.test(key)) {
        const actionId = key.replace(/^turo-(action|stuck)-/, "");
        if (a === "retry") {
          const { data: old } = await ctx.db.from("claim_turo_actions").select("kind, payload").eq("id", actionId).maybeSingle();
          if (old) {
            await ctx.db.from("claim_turo_actions").insert({ case_id: c.id, kind: old.kind, payload: old.payload });
            await ctx.db.from("turo_reader_state").update({ poke_at: new Date().toISOString() }).eq("id", 1);
            await ctx.event(c, "turo_action", `Trying the Turo ${String(old.kind).replace("_", " ")} again`, { by: "answer" });
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
      } else if (key.startsWith("shop-asks-") && a) {
        const estId = key.replace("shop-asks-", "");
        const { data: e } = await ctx.db.from("claim_estimates").select("*, claim_shops(name, email)").eq("id", estId).maybeSingle();
        const to = e?.claim_shops?.email;
        if (to) {
          const r = await sendMail(ctx, { to, subject: `Re: Photo estimate request [${e.ref}]`, key: `claims-est-answer-${q.id}`, text: `Hi ${e.claim_shops.name} team,\n\n${a}\n\nThanks,\nJared` });
          if (r.ok) { await ctx.db.from("claim_estimates").update({ status: "requested", requested_at: new Date().toISOString() }).eq("id", estId); await ctx.event(c, "estimate", `Answered ${e.claim_shops.name}'s question`, {}); }
          else done = false;
        }
      } else if (key === "garage-claim") {
        if (/^yes/i.test(a)) {
          const r = await garageEmail(ctx, c);
          if (r.ok) { await ctx.event(c, "third_party", "Emailed the garage operator (ABM Parking) about the damage", { mail_id: r.id }); await ctx.notify("Told the garage operator about the damage", "I emailed ABM Parking (they run the Fig at 7th garage) with the photos and asked how to file a claim. Replies come to your inbox.", `claims-garage-sent-${c.id}`, "success"); }
          else { done = false; notes.push(`garage email failed: ${r.error}`); }
        } else await ctx.event(c, "third_party", "Jared said no to contacting the garage", {});
      }
    } catch (e) { done = false; notes.push(`answer step failed: ${String(e).slice(0, 80)}`); }
    if (done) await ctx.db.from("claim_questions").update({ handled_at: new Date().toISOString() }).eq("id", q.id);
  }
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
  return await sendMail(ctx, { to: "contactparking@abm.com", subject: `Damage claim: ${carName(c)} at The Fig at 7th garage (945 W 8th St)`, key: `claims-garage-${c.id}`, attachments,
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
