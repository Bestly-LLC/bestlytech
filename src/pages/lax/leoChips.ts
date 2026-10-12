/**
 * The tap-to-ask buttons under Leo's first line (Jared's picks, 2026-10-11). Which set shows depends on where the trip is:
 * before pickup, at pickup, during the trip, or returning (last 3 hours, same window as the greeting's return offer).
 * Climate buttons follow the cabin temperature and only show when the page's car controls are open, so Leo is never
 * asked for something the trip doesn't allow yet. Pure: no imports beyond the greeting's time helper.
 */
import { minutesTo } from "./leoOffer";

export type ChipCtx = {
  keyState?: string | null; stage?: "pickup" | "return" | null; startsAt?: string | null; endsAt?: string | null;
  ended?: boolean; controlsState?: string | null; insideF?: number | null; now?: number;
};

const HOT_F = 75, COLD_F = 60;

export function leoChips(c: ChipCtx | undefined, home: boolean): string[] {
  if (!c || c.ended || c.controlsState === "ended") return [];
  const now = c.now ?? Date.now();
  const mtp = minutesTo(c.startsAt, now), mtr = minutesTo(c.endsAt, now);
  const k = c.keyState ?? null;
  const keyNotReady = !k || k === "soon" || k === "making";
  const out: string[] = [];

  if (c.stage === "return") {
    if (mtr != null && mtr <= 180) {
      out.push("Show the return steps", "How much charge do I need?", home ? "Take me to the return spot" : "Take me to the garage", "Can I extend my trip?");
    } else {
      out.push("How far can I go?", "Find a Supercharger", "How do I use valet?", "How do I turn on self-driving?", "How much was charging?");
    }
    return out;
  }

  // Before pickup: more than an hour out and no key to add yet.
  if (mtp != null && mtp > 60 && k !== "ready" && k !== "problem") {
    if (keyNotReady) out.push("When do I get my key?");
    out.push("Can I add a driver?", "Is self-driving included?", "Show me the Tesla videos");
    return out;
  }

  // At pickup.
  if (k === "problem") out.push("My key isn't working");
  else if (k === "ready") out.push("Help me add my key");
  if (c.controlsState === "on" && c.insideF != null) {
    if (c.insideF >= HOT_F) out.push("Turn on the A/C");
    else if (c.insideF <= COLD_F) out.push("Warm up the car", "Heat my seat");
  }
  out.push(home ? "Where is the car?" : "How do I get to the car?");
  if (!home) out.push("Show the lobby QR code");
  if (c.controlsState === "on") out.push("Is the car locked?");
  // Key already here but pickup is still hours away: fill in with the before-pickup questions.
  if (mtp != null && mtp > 60) out.push("Can I add a driver?", "Is self-driving included?");
  return out.slice(0, 5);
}
