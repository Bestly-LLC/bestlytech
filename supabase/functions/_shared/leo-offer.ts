// COPY of src/pages/lax/leoOffer.ts — keep identical
export type LeoOffer = "reminder_email" | "key_status" | "key_fix" | "key" | "cool" | "pickup_guide"
  | "supercharger" | "charging_help" | "return_checklist" | "thanks" | "none";
export type OfferCtx = { first?: string | null; startsAt?: string | null; endsAt?: string | null; ended?: boolean;
  keyState?: string | null; controlsState?: string | null; insideF?: number | null; climateOn?: boolean | null;
  hasEmail?: boolean; tab?: "pickup" | "return" | null; canAct?: boolean; now?: number };
const TZ = "America/Los_Angeles";
const t12 = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const day = (iso: string, now: number) => {
  const d = (x: number) => new Date(x).toLocaleDateString("en-CA", { timeZone: TZ });
  const t = Date.parse(iso);
  return d(t) === d(now) ? "today" : d(t) === d(now + 864e5) ? "tomorrow"
    : new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
};
export const minutesTo = (iso?: string | null, now = Date.now()) => (iso ? Math.round((Date.parse(iso) - now) / 60000) : null);
/** First name only if it is a clean short word (never cut it; drop it instead). */
const cleanFirst = (f?: string | null) => { const w = (f ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-zÀ-ÿ'-]{1,20}$/.test(w) && w.toLowerCase() !== "demo" ? w : ""; };

export function leoOffer(c: OfferCtx): { offer: LeoOffer; line: string; mtp: number | null } {
  const now = c.now ?? Date.now(), k = c.keyState ?? null;
  const mtp = minutesTo(c.startsAt, now), mtr = minutesTo(c.endsAt, now);
  const ctlOn = c.controlsState === "on" && c.canAct !== false;
  const r = (offer: LeoOffer, line: string) => ({ offer, line, mtp });
  if (c.ended || c.controlsState === "ended") return r("thanks", "Thanks for driving with us. Hope the trip was great!");
  if (k === "problem") return r("key_fix", "Your key hit a snag. Want me to send a fresh one?");
  if (k === "soon" || k === "making") return c.hasEmail
    ? r("key_status", "Your key comes once your host checks your license. Want me to check where it's at?")
    : r("reminder_email", "Your key comes once your host checks your license. Want a reminder email when it's ready?");
  if (k === "ready") return r("key", "Your key is ready. Want your key?");
  // Climate turns off after 20 min: only offer within 30 min of pickup or later, and only when controls are on.
  if (ctlOn && !c.climateOn && mtp != null && mtp <= 30 && (mtp >= -15 || (c.insideF ?? 0) >= 78) && (mtr == null || mtr > 30))
    return r("cool", (c.insideF ?? 0) >= 78 ? `It's ${Math.round(c.insideF!)}°F in the car. Want me to cool it down?` : "Want me to cool the car down before you get in?");
  if (c.startsAt && (mtp! > 0 || c.tab === "pickup"))
    return r("pickup_guide", mtp! > 0 ? `Pickup is ${day(c.startsAt, now)} at ${t12(c.startsAt)}. Want the pickup guide?` : "Want the pickup guide?");
  if (c.endsAt && mtr != null && mtr <= 180) return r("return_checklist", `Your return is ${day(c.endsAt, now)} at ${t12(c.endsAt)}. Want the return checklist?`);
  if (c.startsAt || c.tab === "return") return c.canAct === false ? r("charging_help", "Need help with charging or directions?") : r("supercharger", "Need a Supercharger or directions?");
  return r("none", "What can I help with?");
}
export function leoOpening(c: OfferCtx) {
  const o = leoOffer(c), f = cleanFirst(c.first);
  return { ...o, text: `${f ? `Hi ${f}, I'm Leo.` : "Hi, I'm Leo, your trip helper."} ${o.line}` };
}
