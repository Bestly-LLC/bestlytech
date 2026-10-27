export type LeoOffer = "reminder_email" | "key_status" | "key_fix" | "key" | "cool" | "pickup_guide"
  | "supercharger" | "charging_help" | "return_checklist" | "thanks" | "none";
export type OfferCtx = { first?: string | null; startsAt?: string | null; endsAt?: string | null; ended?: boolean;
  keyState?: string | null; controlsState?: string | null; insideF?: number | null; climateOn?: boolean | null;
  hasEmail?: boolean; tab?: "pickup" | "return" | null; canAct?: boolean; now?: number; linkDown?: LinkDownReason | null };
/** Why a trip link stopped working (lax_guest_public reason, plus "fixing" when the page can't reach us). */
export type LinkDownReason = "changed" | "ended" | "unknown" | "fixing";
const LINK_DOWN_LINE: Record<LinkDownReason, string> = {
  changed: "This trip was changed or canceled, so its link stopped working. If you rebooked, sign in below for your new page, or tell me what you need and I'll pass it to your host.",
  ended: "This trip is over. Left something in the car or need a receipt? Tell me and I'll pass it to your host.",
  unknown: "I can't find a trip for this link. Sign in below with your phone number, or tell me what you need and I'll pass it to your host.",
  fixing: "Something on our side isn't loading right now. Tell me what you need and I'll pass it to your host right away.",
};
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
  if (c.linkDown) return r("none", LINK_DOWN_LINE[c.linkDown]);
  if (c.ended || c.controlsState === "ended") return r("thanks", "Thanks for driving Blue Steel. Hope the trip was great!");
  if (k === "problem") return r("key_fix", "Your phone key didn't go through. Want me to send a new one?");
  if (k === "soon" || k === "making") return c.hasEmail
    ? r("key_status", "Your phone key shows up here after Jared checks your license. Want me to check on it?")
    : r("reminder_email", "Your phone key shows up here after Jared checks your license. Want an email when it's ready?");
  if (k === "ready") return r("key", "Your phone key is ready. Want me to pull it up?");
  // Same window as the page's climate buttons: offer cooling only while controls are on (about an hour before pickup, never days ahead).
  if (ctlOn && !c.climateOn && mtp != null && (mtp >= -15 || (c.insideF ?? 0) >= 78) && (mtr == null || mtr > 30))
    return r("cool", (c.insideF ?? 0) >= 78 ? `It's ${Math.round(c.insideF!)}°F in the car. Want me to cool it to 68°F before you get in?` : "Want me to start the A/C so it's cool when you get in?");
  if (c.startsAt && (mtp! > 0 || c.tab === "pickup"))
    return r("pickup_guide", mtp! > 0 ? `Pickup is ${day(c.startsAt, now)} at ${t12(c.startsAt)}. Want me to show you how to find the car?` : "Want step-by-step help finding the car?");
  if (c.endsAt && mtr != null && mtr <= 180) return r("return_checklist", `Your return is ${day(c.endsAt, now)} at ${t12(c.endsAt)}. Want the quick return steps?`);
  if (c.startsAt || c.tab === "return") return c.canAct === false ? r("charging_help", "Need help with charging or anything about the car?") : r("supercharger", "Need a Supercharger or anything for the car?");
  return r("none", "What can I help with?");
}
/** Every way Leo opens (page chat, page call, phone) says he is an AI and that calls are recorded (CA Penal Code 632). Keep identical in the shared copy. */
export const LEO_INTRO = "I'm Leo, the AI trip helper. Calls are recorded.";
export const LEO_NOTICE = "Leo is an AI. Calls are recorded.";
export function leoOpening(c: OfferCtx) {
  const o = leoOffer(c), f = cleanFirst(c.first);
  return { ...o, text: `${f ? `Hi ${f}, ${LEO_INTRO}` : `Hi, ${LEO_INTRO}`} ${o.line}` };
}
