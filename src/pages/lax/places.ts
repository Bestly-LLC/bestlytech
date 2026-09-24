/**
 * Per-trip-kind facts shared by the Home and LAX trip pages, so both pages run the same components
 * (key card, next steps, Send to car, car guide) with the right place names.
 */
export type TripKind = "home" | "lax";

export type Charger = { name: string; street: string; full: string; lat: number; lon: number; note: string; tip: string; action: "nav_charger" | "nav_charger_lax" };

export const CHARGERS: Record<TripKind, Charger> = {
  home: {
    name: "Tesla Diner", street: "7001 Santa Monica Blvd", full: "7001 Santa Monica Blvd, West Hollywood, CA 90038",
    lat: 34.0909484, lon: -118.3418798, action: "nav_charger",
    note: "80 fast stalls, open 24/7, free parking while you charge.",
    tip: "The Sunset Blvd Supercharger charges for parking. The Diner doesn't.",
  },
  lax: {
    name: "Culver City Supercharger", street: "6000 Sepulveda Blvd", full: "6000 Sepulveda Blvd, Culver City, CA 90230",
    lat: 33.98681, lon: -118.390323, action: "nav_charger_lax",
    note: "16 stalls at Westfield Culver City, about 10 minutes from the garage.",
    tip: "Charge on the way back to the garage so you return with enough.",
  },
};

const android = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
export const chargerMaps = (c: Charger) => android()
  ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`
  : `https://maps.apple.com/?q=${encodeURIComponent(c.name)}&address=${encodeURIComponent(c.full)}&ll=${c.lat},${c.lon}`;

/** Where the car waits and goes back, in the words the next-steps card uses. */
export type Place = { parked: string; returnTo: string; returnSoon: string };
export const homePlace = (address: string): Place => ({
  parked: `It's parked on N Kings Rd by ${address.split(",")[0]}.`,
  returnTo: "Back on N Kings Rd near the building. Changes go through the Turo app.",
  returnSoon: "Park on N Kings Rd near the building, legal spot. Watch the sweeping signs.",
});
export const laxPlace = (garage: string, level: string): Place => ({
  parked: `It's in the garage at ${garage.split(",")[0]}, level ${level}. Tap Pickup at the bottom for the shuttle steps.`,
  returnTo: `Back to ${garage.split(",")[0]}, level ${level}, through the carshare return lane. Changes go through the Turo app.`,
  returnSoon: `Carshare return lane on 98th St, park on ${level} only, then the shuttle to LAX. Allow 1 hour before your terminal.`,
});
