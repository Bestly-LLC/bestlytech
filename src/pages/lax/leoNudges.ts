/**
 * What the mini Leo's speech bubble says (delivery trip page, 2026-10-12). A pure function of what the page knows, so it can be
 * unit-tested and never goes stale: nothing here reads the DOM, the clock or the network.
 *
 *   leoNudges(ctx)     -> the lines, most relevant first, always opening with "Need help? Tap me!"
 *   leoNudgeItems(ctx) -> the same lines with what the guest "says" to Leo when they tap that bubble, and the section it belongs to.
 *
 * Ranking: each line has a base score for how much the guest probably needs it right now (the room number Jared is waiting on
 * beats a restaurant idea). A line whose section is the one on screen gets +100, so it jumps to the front (after the opener).
 *
 * Rules that must hold (Jared / Leo):
 *  - Climate is only offered from 1 hour before pickup until the trip ends, and only when the car's controls are on. Never days ahead.
 *  - 12-hour times, US units (°F, mi). A number and its unit never wrap apart (no line here needs one; see glueUnits if one does).
 *  - Short lines that fit a 220px bubble in 2 to 3 rows. No ellipses anywhere.
 */
import type { DeliveryKey } from "./places";

export type NudgeSection = "delivery" | "how" | "key" | "car" | "charging" | "return";
export type NudgeKey = "off" | "soon" | "held" | "making" | "ready" | "added" | "ended" | "problem";

export type NudgeCtx = {
  /** Date.now() */
  now: number;
  /** Trip start / end as ISO strings (pickup and return time). */
  startsAt?: string | null;
  endsAt?: string | null;
  ended?: boolean;
  /** Kind of place: hotel, pod, train or custom. */
  kind: "hotel" | "pod" | "train" | "custom";
  /** What Jared still needs from the guest: room, front_desk, eta, parking. Empty when everything is in. */
  missing: DeliveryKey[];
  /** The phone key: "held" is "soon" with Jared's check-in still pending. */
  key?: NudgeKey | null;
  /** The car, when we know it. Temperatures in °F, battery in percent. */
  cabinF?: number | null;
  outsideF?: number | null;
  batteryPct?: number | null;
  rangeMi?: number | null;
  /** The A/C buttons work right now (the car is reachable and the trip allows it). */
  controlsOn?: boolean;
  /** The page section on screen right now, if any. */
  section?: NudgeSection | null;
};

export type NudgeItem = {
  text: string;
  /** What the guest asks Leo when they tap this bubble: their first message to him. */
  send: string;
  section?: NudgeSection;
  score: number;
};

export const OPENER = "Need help? Tap me!";

const HOT_F = 75, COLD_F = 60, LOW_BATTERY = 30;
const CLIMATE_LEAD_MIN = 60;     // Leo only offers climate within an hour before pickup, or during the trip
const RETURN_WINDOW_MIN = 180;   // "heading back?" starts 3 hours before the trip ends

const losAngelesHour = (ms: number): number => {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }).format(new Date(ms)));
  return h === 24 ? 0 : h;
};

export function leoNudgeItems(c: NudgeCtx): NudgeItem[] {
  const start = c.startsAt ? +new Date(c.startsAt) : NaN;
  const end = c.endsAt ? +new Date(c.endsAt) : NaN;
  const minToStart = Number.isFinite(start) ? Math.round((start - c.now) / 60000) : NaN;
  const minToEnd = Number.isFinite(end) ? Math.round((end - c.now) / 60000) : NaN;
  const ended = !!c.ended || (Number.isFinite(minToEnd) && minToEnd < -30);
  const onTrip = !ended && Number.isFinite(minToStart) && minToStart <= 0 && (!Number.isFinite(minToEnd) || minToEnd > 0);
  const beforeHandoff = !ended && (!Number.isFinite(start) || c.now < start + 45 * 60e3);
  const climateWindow = !ended && ((Number.isFinite(minToStart) && minToStart <= CLIMATE_LEAD_MIN) || onTrip) && (!Number.isFinite(minToEnd) || minToEnd > 0);

  const out: NudgeItem[] = [];
  const add = (text: string, send: string, score: number, section?: NudgeSection) => out.push({ text, send, score, section });

  if (ended) {
    add("Left something in the car? Tell me.", "I think I left something in the car.", 80);
  } else {
    // 1. What Jared is waiting on.
    if (beforeHandoff) {
      if (c.missing.includes("room")) {
        if (c.kind === "pod") add("What's your pod number? I'll tell Jared.", "I want to tell you my pod number.", 90, "delivery");
        else if (c.kind === "custom") add("Any unit number? I'll tell Jared.", "I want to tell you my unit number.", 60, "delivery");
        else add("What's your room number? I'll tell Jared.", "I want to tell you my room number.", 90, "delivery");
      }
      if (c.missing.includes("front_desk")) add("What did the front desk say about parking?", "I want to tell you what the front desk said about parking.", 85, "delivery");
      if (c.missing.includes("parking")) add("Any parking notes for Jared?", "I want to give Jared some parking notes.", 85, "delivery");
      if (c.missing.includes("eta")) add("When does your train get in?", "I want to tell you when my train gets in.", 90, "delivery");
    }

    // 2. The phone key.
    switch (c.key) {
      case "ready": add("Your key's ready. Want help adding it?", "Yes, please help me add my key.", 80, "key"); break;
      case "making": add("Your key's on its way. Want me to check?", "Is my key on its way?", 70, "key"); break;
      case "held": add("Your key turns on right after Jared's photos.", "When does my key turn on?", 70, "key"); break;
      case "soon": add("Your key turns on after Jared's check-in.", "When does my key turn on?", 55, "key"); break;
      case "problem": add("Trouble with your key? I can fix it.", "My phone key isn't working. Can you help?", 85, "key"); break;
    }

    // 3. Climate: only about an hour before pickup, or during the trip, and only when the A/C buttons work.
    if (c.controlsOn && climateWindow && c.cabinF != null) {
      if (c.cabinF >= HOT_F) add("Looks hot in there. Want me to cool it down?", "It's hot in the car. Can you cool it down?", 75, "car");
      else if (c.cabinF <= COLD_F) add("Chilly in there. Want me to warm it up?", "It's cold in the car. Can you warm it up?", 75, "car");
    }

    // 4. Charging.
    if (c.batteryPct != null && c.batteryPct < LOW_BATTERY && onTrip) add("Need a Supercharger nearby?", "Where is the nearest Supercharger?", 72, "charging");
    else if (c.section === "charging") add("Need a Supercharger nearby?", "Where is the nearest Supercharger?", 50, "charging");

    // 5. Heading back.
    if ((Number.isFinite(minToEnd) && minToEnd > 0 && minToEnd <= RETURN_WINDOW_MIN) || c.section === "return") {
      add("Heading back? I'll walk you through the return.", "Walk me through the return.", 60, "return");
    }

    // 6. Evening, during the trip.
    if (onTrip) {
      const h = losAngelesHour(c.now);
      if (h >= 17 && h <= 21) add("Hungry? I know good spots nearby.", "Where should I eat nearby?", 30);
    }

    // 7. Quiet fillers, only for the section on screen, so there's always something relevant there.
    switch (c.section) {
      case "how": add("Want the quick version of how delivery works?", "How does delivery work?", 40, "how"); break;
      case "delivery": if (!c.missing.length) add("Need to change where to meet Jared?", "I need to change something about my delivery.", 40, "delivery"); break;
      case "car": add("Want me to check on the car?", "Can you check on the car for me?", 40, "car"); break;
      case "key": if (!c.key || c.key === "off" || c.key === "added") add("Any questions about your phone key?", "I have a question about my phone key.", 40, "key"); break;
    }
  }

  // The section on screen jumps to the front.
  const ranked = out
    .map((n, i) => ({ n, i, s: n.score + (c.section && n.section === c.section ? 100 : 0) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.n);

  // One line per text, at most five after the opener (a bubble that nags is worse than none).
  const seen = new Set<string>([OPENER]);
  const list = ranked.filter((n) => (seen.has(n.text) ? false : (seen.add(n.text), true))).slice(0, 5);
  return [{ text: OPENER, send: "Hi Leo, I need some help with my trip.", score: 1000 }, ...list];
}

export function leoNudges(c: NudgeCtx): string[] {
  return leoNudgeItems(c).map((n) => n.text);
}

/** Keeps a number glued to its unit if a line ever has one ("30 %" and "75 °F" never split across rows). */
export const glueUnits = (s: string): string => s.replace(/(\d)\s+(%|°F|mi|min|hr|kWh|mph|ft)\b/g, "$1 $2");
