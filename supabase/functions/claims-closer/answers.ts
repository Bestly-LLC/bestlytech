// What Claims Closer does with an answer Jared gives. Pure (no Deno, no network): the edge function supplies the facts, this decides.
//
// RULE (Jared, 2026-10-28, after "Skip we got an estimate from tesla" was emailed to three body shops word for word):
//   Jared's answers are INSTRUCTIONS TO CLAIMS CLOSER, never outgoing text. Nothing he types is forwarded or quoted to a shop, guest, insurer or Turo.
//   Claims Closer works out what he meant (button value, rules, then the free LLM ladder), then writes its own message in its own voice, or sends nothing.
//
//   intent        what Claims Closer does
//   proceed       answer the shop itself, from the record (VIN, the photos already on file, "Found you online"). Whatever it can't answer it leaves alone.
//   skip          close that shop's thread: one short fixed line ("Thanks, we're all set on this one."), estimate request marked closed. No reason, no
//                 competing shop, no amount.
//   wait          do nothing now; the question comes back after 24 hours (nudge ladder).
//   provide_info  Jared told us a fact. It is saved as a note for Claims Closer; Claims Closer answers from its own record. The sentence is never used.
//   other         saved as a note. Nothing is sent.
import { mentionsCompetingSource, moneyGuard, overlapsAnswers, planGuard, reviewGuard } from "./guards.ts";

type Row = Record<string, any>;

export type Intent = "proceed" | "skip" | "wait" | "provide_info" | "other";
export const SHOP_ASK_BUTTONS = [
  { value: "answer", label: "Answer it for me" },
  { value: "drop", label: "Drop this shop" },
  { value: "wait", label: "Wait" },
] as const;

/** the short fixed line sent to a shop whose thread is closed; same words every time, written by us */
export const SHOP_CLOSE_LINE = "Thanks, we're all set on this one.";

const BUTTON_INTENT: Record<string, Intent> = { answer: "proceed", drop: "skip", wait: "wait", yes: "proceed", no: "skip", retry: "proceed", done: "other", by_hand: "other", walk_in: "other" };

/** Rules first. confident=false means "ask the model" (or, failing that, treat it as a note and send nothing). */
export function classifyByRules(answer: string, options: { value: string }[] = []): { intent: Intent; confident: boolean; via: "button" | "rules" | "none" } {
  const a = String(answer ?? "").trim();
  if (!a) return { intent: "other", confident: true, via: "none" };
  if (options.some((o) => o.value === a) || BUTTON_INTENT[a.toLowerCase()] && /^[a-z_]+$/.test(a)) {
    return { intent: BUTTON_INTENT[a.toLowerCase()] ?? "other", confident: true, via: "button" };
  }
  const t = a.toLowerCase();
  // skip / close this shop: "skip", "drop them", "we got an estimate from X", "no need", "forget it", "all set"
  if (/\b(skip|drop (it|them|this|that)|close (it|them|this|that|the)|cancel|never ?mind|forget (it|them|this)|no need|not needed|don'?t (bother|answer|reply|respond)|ignore|all set|already (got|have|received)|we got (an? )?(estimate|quote)|got (an? )?(estimate|quote)|have (an? )?(estimate|quote)|pass on)\b/.test(t)) return { intent: "skip", confident: true, via: "rules" };
  if (/\b(wait|hold off|hold on|not yet|later|pause|tomorrow|next week)\b/.test(t)) return { intent: "wait", confident: true, via: "rules" };
  if (/^(yes|yep|yeah|sure|ok|okay|go ahead|do it|proceed|please do|answer (it|them)|reply|respond|send (it|them))\b/.test(t)) return { intent: "proceed", confident: true, via: "rules" };
  if (/\b(vin|photos?|pictures?|it'?s|it is|was|were|because|dirt|scuff|damage|the car|insurance|insurer|policy)\b/.test(t) && t.split(/\s+/).length >= 3) return { intent: "provide_info", confident: false, via: "rules" };
  return { intent: "other", confident: false, via: "none" };
}

export const INTENT_PROMPT = `You read one short note a car owner typed to his claims assistant. Say what he wants done. Reply ONLY JSON {"intent": "proceed"|"skip"|"wait"|"provide_info"|"other"}.
proceed = go ahead and answer the shop/person. skip = drop it, close it, no longer needed, got what we need elsewhere. wait = hold off. provide_info = he is telling you a fact. other = anything else or unclear. When unsure answer "other".`;

export function intentFromModel(json: any): Intent {
  const v = String(json?.intent ?? "");
  return (["proceed", "skip", "wait", "provide_info", "other"] as string[]).includes(v) ? (v as Intent) : "other";
}

// ---------------------------------------------------------------- answering a shop from our own record
export type ShopAsk = { vin: boolean; photos: boolean; howHeard: boolean; insurance: boolean; unclear: string[] };

/** what a shop asked for (the asks_for text the reply reader stored), by keyword. Anything that is not in a known box is "unclear" and never guessed. */
export function parseShopAsk(asksFor: string): ShopAsk {
  const t = String(asksFor ?? "").toLowerCase();
  const out: ShopAsk = { vin: /\bvin\b|vehicle identification/.test(t), photos: /\b(photos?|pictures?|images?|pics?|better angles?)\b/.test(t),
    howHeard: /(hear|heard|found|referr?ed|referral|how did you).{0,25}(us|about)|how you heard/.test(t), insurance: /\b(insur\w*|policy|claim number|adjuster)\b/.test(t), unclear: [] };
  const rest = t.replace(/\bvin\b|vehicle identification( number)?|better|more|additional|photos?|pictures?|images?|pics?|angles?|how (did )?you (hear|heard)( about us)?|\band\b|[,.;:]/g, " ").replace(/\s+/g, " ").trim();
  if (rest.length > 12 && /(dirt|damage|clarify|confirm|rim|tire|fender|scuff|bumper|sensor|alignment|frame)/.test(rest)) out.unclear.push(rest.slice(0, 80));
  return out;
}

export type SelfAnswer = { text: string | null; attachPhotos: boolean; answered: string[]; left: string[] };

/** Our own words. Only facts that are on the case record. No amounts, no insurer, no Turo, nothing Jared typed. */
export function composeShopAnswer(shopName: string, ask: ShopAsk, facts: { vin?: string | null; photoCount?: number; contactFirst?: string | null }): SelfAnswer {
  const lines: string[] = []; const answered: string[] = []; const left: string[] = [];
  if (ask.vin) { if (facts.vin) { lines.push(`The VIN is ${facts.vin}.`); answered.push("vin"); } else left.push("vin"); }
  let attach = false;
  if (ask.photos) { if ((facts.photoCount ?? 0) > 0) { lines.push("I attached the photos I have of the damage again."); answered.push("photos"); attach = true; } else left.push("photos"); }
  if (ask.howHeard) { lines.push("Found you online."); answered.push("how_heard"); }
  if (ask.insurance) left.push("insurance");
  for (const u of ask.unclear) left.push(u);
  if (!lines.length) return { text: null, attachPhotos: false, answered, left };
  const hi = facts.contactFirst ? `Hi ${facts.contactFirst},` : `Hi ${String(shopName).replace(/\s+\(.*\)$/, "")} team,`;
  return { text: `${hi}\n\n${lines.join(" ")}\n\nThank you.`, attachPhotos: attach, answered, left };
}

export function composeShopClose(shopName: string, contactFirst?: string | null): string {
  const hi = contactFirst ? `Hi ${contactFirst},` : `Hi ${String(shopName).replace(/\s+\(.*\)$/, "")} team,`;
  return `${hi}\n\n${SHOP_CLOSE_LINE}`;
}

// ---------------------------------------------------------------- the last check before any answer-derived message goes out
export type OutboundCheck = { ok: boolean; reason?: string };
export function checkAnswerDerived(text: string, o: { answers: string[]; otherShopNames?: string[]; allowedAmounts?: number[] }): OutboundCheck {
  const hit = overlapsAnswers(text, o.answers);
  if (hit.hit) return { ok: false, reason: "copies words Jared typed" };
  if (!moneyGuard(text, o.allowedAmounts ?? [])) return { ok: false, reason: "carries a dollar amount" };
  if (!planGuard(text)) return { ok: false, reason: "speaks for Turo or states a plan figure" };
  if (!reviewGuard(text).ok) return { ok: false, reason: "mentions reviews" };
  if (mentionsCompetingSource(text, o.otherShopNames)) return { ok: false, reason: "names a competing source" };
  return { ok: true };
}

// ---------------------------------------------------------------- stale questions
export const STALE_DAYS = 7;
/** A question Jared never answered, or answered late, about something that has moved on is retired, not acted on. */
export function questionStale(q: Row, facts: { now: number; caseClosed: boolean; estimateObtained: boolean; resolveWindowClosed: boolean; shopThreadOpen: boolean | null }): { stale: boolean; reason?: string } {
  const ageDays = (facts.now - Date.parse(q.asked_at)) / 864e5;
  if (facts.caseClosed) return { stale: true, reason: "the case is closed" };
  if (ageDays <= STALE_DAYS) return { stale: false };
  const key = String(q.key ?? "");
  if (facts.estimateObtained && /^shop-asks-|^estimate-|^claims-est/.test(key)) return { stale: true, reason: `asked ${Math.floor(ageDays)} days ago and the estimate is already in` };
  if (/^shop-asks-/.test(key) && facts.shopThreadOpen === false) return { stale: true, reason: `asked ${Math.floor(ageDays)} days ago and that shop's thread is already closed` };
  if (facts.resolveWindowClosed && /^shop-asks-|^estimate-/.test(key)) return { stale: true, reason: `asked ${Math.floor(ageDays)} days ago and Turo's resolve-directly window has closed` };
  if (/^(estimate-deadline|estimate-spread)/.test(key) && facts.resolveWindowClosed) return { stale: true, reason: "the estimate deadline has passed" };
  return { stale: false };
}

// ---------------------------------------------------------------- one answer, many questions: one decision
export type Decision = { intent: Intent; answer: string; questionIds: string[]; effects: Effect[]; why: string };
export type Effect =
  | { type: "close_shop"; estimateId: string; shop: string; sendLine: boolean }
  | { type: "answer_shop"; estimateId: string; shop: string }
  | { type: "retire"; questionId: string; reason: string }
  | { type: "defer"; questionId: string }
  | { type: "note"; questionId: string };

/** Group answered-but-unhandled questions by case and by the (normalized) answer text, so "Skip ..." typed once is one decision. */
export function groupAnswers(qs: Row[]): Row[][] {
  const g = new Map<string, Row[]>();
  for (const q of qs) {
    const k = `${q.case_id}|${String(q.answer ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;
    g.set(k, [...(g.get(k) ?? []), q]);
  }
  return [...g.values()];
}

/**
 * Decide what a group of questions that got the same answer means. Pure: no sends, no writes. `staleBy` maps question id -> stale reason.
 * `estimateIdOf` maps a question to the shop estimate it was about (null for non-shop questions).
 */
export function planAnswer(group: Row[], intent: Intent, o: { staleBy: Record<string, string | undefined>; estimateIdOf: (q: Row) => { id: string; shop: string } | null }): Decision {
  const effects: Effect[] = [];
  const answer = String(group[0]?.answer ?? "");
  for (const q of group) {
    const reason = o.staleBy[q.id];
    const est = o.estimateIdOf(q);
    if (reason) {
      // a stale question is retired; a "drop" on a shop still closes that shop's thread quietly (no line, nothing relayed)
      if (intent === "skip" && est) effects.push({ type: "close_shop", estimateId: est.id, shop: est.shop, sendLine: false });
      effects.push({ type: "retire", questionId: q.id, reason });
      continue;
    }
    if (intent === "skip" && est) effects.push({ type: "close_shop", estimateId: est.id, shop: est.shop, sendLine: true });
    else if (intent === "proceed" && est) effects.push({ type: "answer_shop", estimateId: est.id, shop: est.shop });
    else if (intent === "wait") effects.push({ type: "defer", questionId: q.id });
    else effects.push({ type: "note", questionId: q.id });
  }
  const why = `Jared's note was read as "${intent}" and applied to ${group.length} question${group.length === 1 ? "" : "s"} as one decision. His words were not sent to anyone.`;
  return { intent, answer, questionIds: group.map((q) => q.id), effects, why };
}
