// canSend: the ONE chokepoint every outbound path in Claims Closer goes through (2026-10-28, Jared).
//
// Before this, claim_cases.outbound_hold gated guest drafts only; sendMail() (shop estimate requests, shop follow-ups, the total-in-body ask, the
// shop-question answer relay, the garage email) and Ava calls never looked at it. Now sendMail, avaCall, the Turo action queue and the insurer email/call
// all call canSend(ctx, caseRow, request) first. It re-reads the case and the gate from the database (never trusts the row the caller holds), fails
// CLOSED if any lookup fails, and writes every decision to claims_send_log.
//
// A request is allowed only when ALL of these hold:
//   1. the case exists, is not history, and is not paid/closed
//   2. no outbound hold on the case (the watchdog claims_guard_watch sets it; Jared can set it from chat)
//   3. the return gate is open: reservation ended AND trip complete (claims_gate; a live trip blocks everything)
//   4. a recipient is present and well formed
//   5. insurer channels also need claims_autonomy_settings.insurer_contact_mode = 'full'
//   6. the text passes reviewGuard, planGuard, moneyGuard (only the amounts the caller allows) and shares no run of 4 words / 20 characters with
//      anything Jared typed on this case; text written because of an answer also may not name a competing source
import { moneyGuard, overlapsAnswers, planGuard, reviewGuard, mentionsCompetingSource } from "./guards.ts";

type Row = Record<string, any>;

export type Channel = "shop_email" | "guest_message" | "ava_call" | "turo_action" | "insurer_email" | "adjuster_call" | "garage_email";
export type SendRequest = {
  channel: Channel;
  recipient: string | null;          // email address or phone number
  purpose: string;                   // "estimate_request", "shop_followup", "answer_shop", "close_shop", "book_repair", "garage_claim", ...
  text?: string;                     // what will be said or written (subject + body, or the call script)
  key?: string;                      // idempotency key of the send
  allowedAmounts?: number[];         // dollar figures this message may carry
  derivedFromAnswer?: boolean;       // written because of something Jared answered
};
export type Decision = { ok: boolean; code: "ok" | "no_case" | "history" | "closed" | "hold" | "gate_lookup" | "live_trip" | "gate_closed" | "recipient" | "insurer_mode" | "guard" | "overlap" | "competing"; reason?: string };

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;
const PHONE = /^\+?[0-9][0-9\s().-]{6,}$/;

/** Pure decision. `gate` is the claims_gate(case) JSON (or null when the lookup failed). */
export function decideSend(c: Row | null, gate: Row | null, req: SendRequest, env: { answers: string[]; otherShopNames: string[]; insurerMode: string; ownShopName?: string | null }): Decision {
  if (!c) return { ok: false, code: "no_case", reason: "case not found" };
  if (c.history) return { ok: false, code: "history", reason: "history case: nothing is sent" };
  if (["paid", "closed"].includes(String(c.status))) return { ok: false, code: "closed", reason: `case is ${c.status}` };
  if (c.outbound_hold) return { ok: false, code: "hold", reason: `outbound hold: ${c.outbound_hold_reason ?? "no reason recorded"}` };
  if (!gate) return { ok: false, code: "gate_lookup", reason: "gate lookup failed (fails closed)" };
  if (gate.live) return { ok: false, code: "live_trip", reason: "the trip is still live" };
  if (!gate.ok) return { ok: false, code: "gate_closed", reason: String(gate.reason ?? "the return gate is closed") };
  const r = String(req.recipient ?? "").trim();
  const isPhone = req.channel === "ava_call" || req.channel === "adjuster_call";
  if (req.channel !== "turo_action" && req.channel !== "guest_message" && !(isPhone ? PHONE.test(r) : EMAIL.test(r))) return { ok: false, code: "recipient", reason: "no valid recipient" };
  if ((req.channel === "insurer_email" || req.channel === "adjuster_call") && env.insurerMode !== "full") return { ok: false, code: "insurer_mode", reason: "insurer_contact_mode is draft_only" };
  const text = req.text ?? "";
  if (text) {
    if (!reviewGuard(text).ok) return { ok: false, code: "guard", reason: "mentions reviews or ratings" };
    if (!planGuard(text)) return { ok: false, code: "guard", reason: "speaks for Turo or states a plan figure" };
    if (!moneyGuard(text, req.allowedAmounts ?? [])) return { ok: false, code: "guard", reason: "carries a dollar amount that is not allowed here" };
    const o = overlapsAnswers(text, env.answers);
    if (o.hit) return { ok: false, code: "overlap", reason: "shares words with something Jared typed" };
    // the recipient's own name is not a competing source (and "Pristine Collision Center" sits inside "Pristine Collision Center Hollywood")
    const own = String(env.ownShopName ?? "").trim();
    const scrubbed = own ? text.split(new RegExp(own.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig")).join(" ") : text;
    if (req.derivedFromAnswer && mentionsCompetingSource(scrubbed, env.otherShopNames)) return { ok: false, code: "competing", reason: "names a competing source" };
  }
  return { ok: true, code: "ok" };
}

type SendCtx = { db: any; notify: (title: string, body: string, dedupe: string, severity?: string) => Promise<void> };

/** Reads the case, the gate, Jared's recent answers and the settings, decides, and logs. Fails closed. */
export async function canSend(ctx: SendCtx, c: Row, req: SendRequest): Promise<Decision> {
  let d: Decision;
  try {
    const { data: fresh } = await ctx.db.from("claim_cases").select("id, reservation_id, status, history, outbound_hold, outbound_hold_reason").eq("id", c.id).maybeSingle();
    const { data: gate, error: gErr } = await ctx.db.rpc("claims_gate", { p_case: c.id });
    const since = new Date(Date.now() - 21 * 864e5).toISOString();
    const { data: qs } = await ctx.db.from("claim_questions").select("answer").eq("case_id", c.id).not("answer", "is", null).gte("answered_at", since);
    const { data: shops } = await ctx.db.from("claim_shops").select("name, email").eq("active", true);
    const { data: st } = await ctx.db.from("claims_autonomy_settings").select("insurer_contact_mode").eq("id", true).maybeSingle();
    d = decideSend(fresh ?? null, gErr ? null : (gate ?? null), req, {
      answers: ((qs ?? []) as Row[]).map((q) => String(q.answer ?? "")),
      otherShopNames: ((shops ?? []) as Row[]).map((s) => String(s.name ?? "")),
      insurerMode: String(st?.insurer_contact_mode ?? "draft_only"),
      ownShopName: ((shops ?? []) as Row[]).find((s) => s.email && String(s.email).toLowerCase() === String(req.recipient ?? "").toLowerCase())?.name ?? null,
    });
  } catch (e) {
    d = { ok: false, code: "gate_lookup", reason: `check failed: ${String(e).slice(0, 80)} (fails closed)` };
  }
  await logSend(ctx, c, req, d.ok ? "allowed" : "blocked", d);
  if (!d.ok && (d.code === "overlap" || d.code === "competing")) {
    // this should never happen: it means a code path tried to send Jared's words. Tell him once per case per day.
    try { await ctx.notify(`Blocked a message that copied your answer`, `Claims Closer stopped an outgoing ${req.channel.replace("_", " ")} (${req.purpose}) because it repeated what you typed. Nothing was sent.`, `claims-overlap-${c.id}-${new Date().toISOString().slice(0, 10)}`, "warning"); } catch { /* the log row is the record */ }
  }
  return d;
}

export async function logSend(ctx: SendCtx, c: Row, req: SendRequest, decision: "allowed" | "blocked" | "sent" | "failed", d?: Decision, result?: unknown) {
  try {
    if (decision === "blocked") {   // the same block on the same case every 2 minutes is one row an hour, not 30
      const { data: prev } = await ctx.db.from("claims_send_log").select("id").eq("case_id", c.id).eq("channel", req.channel).eq("purpose", req.purpose).eq("decision", "blocked")
        .eq("code", d?.code ?? "").gte("at", new Date(Date.now() - 36e5).toISOString()).limit(1);
      if ((prev ?? []).length) return;
    }
    await ctx.db.from("claims_send_log").insert({ case_id: c.id, reservation_id: c.reservation_id ?? null, channel: req.channel, recipient: req.recipient, purpose: req.purpose,
      decision, code: d?.code ?? null, reason: d?.reason ?? null, excerpt: (req.text ?? "").slice(0, 400), key: req.key ?? null, result: result ?? null });
  } catch { /* logging never blocks the decision */ }
}

/** Queue a Turo reader action (create_invoice, mark_insurer, escalate). The reader posts it to Turo, so it goes through the same chokepoint. */
export async function queueTuroAction(ctx: SendCtx, c: Row, kind: "create_invoice" | "mark_insurer" | "escalate", payload: Row, allowedAmounts: number[] = []): Promise<{ ok: boolean; id?: string; error?: string }> {
  const req: SendRequest = { channel: "turo_action", recipient: null, purpose: kind, text: String(payload.message ?? ""), allowedAmounts, key: `turo-${kind}-${c.id}` };
  const d = await canSend(ctx, c, req);
  if (!d.ok) return { ok: false, error: `blocked: ${d.reason}` };
  const { data, error } = await ctx.db.from("claim_turo_actions").insert({ case_id: c.id, kind, payload, status: "queued" }).select("id").single();
  if (error) return { ok: false, error: String(error.message ?? error).slice(0, 160) };
  await ctx.db.from("turo_reader_state").update({ poke_at: new Date().toISOString() }).eq("id", 1);
  await logSend(ctx, c, req, "sent", undefined, { action_id: data?.id });
  return { ok: true, id: data?.id };
}

/** Outside claims (Kemper-style) have no Turo case, so no hold or return gate; they still go through the recipient, mode and text guards, and are logged. */
export async function canSendOutside(ctx: SendCtx, outside: Row, req: SendRequest): Promise<Decision> {
  let d: Decision;
  try {
    const { data: st } = await ctx.db.from("claims_autonomy_settings").select("insurer_contact_mode").eq("id", true).maybeSingle();
    d = decideSend({ id: outside.id, status: "open", history: false, outbound_hold: false }, { ok: true, live: false }, req, { answers: [], otherShopNames: [], insurerMode: String(st?.insurer_contact_mode ?? "draft_only") });
  } catch (e) { d = { ok: false, code: "gate_lookup", reason: `check failed: ${String(e).slice(0, 80)} (fails closed)` }; }
  try { await ctx.db.from("claims_send_log").insert({ case_id: null, reservation_id: null, channel: req.channel, recipient: req.recipient, purpose: `outside:${req.purpose}`, decision: d.ok ? "allowed" : "blocked", code: d.code, reason: d.reason ?? null, excerpt: (req.text ?? "").slice(0, 400), key: req.key ?? null }); } catch { /* the decision still stands */ }
  return d;
}
