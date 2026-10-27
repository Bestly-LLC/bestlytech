import { describe, expect, it, vi } from "vitest";

// commandCenter imports the browser Supabase client; these are pure helpers, so stub it out.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { agendaByDay, evAt, normalizeWxEvents, time12, type WxEvent } from "./commandCenter";

// Luyue's 2026-10-27 trip as the wall sends it: pickup 9:00 AM (hour before), return 11:30 PM (hour after), both at home.
const pickup: WxEvent = { title: "Turo pickup · Luyue", start: "2026-10-27T15:00:00+00:00", end: "2026-10-27T16:00:00+00:00", source: "turo", turo: "pickup", location: "Home" };
const ret: WxEvent = { title: "Turo return · Luyue", start: "2026-10-28T06:30:00+00:00", end: "2026-10-28T07:30:00+00:00", source: "turo", turo: "return", location: "Home" };
const laxPickup: WxEvent = { ...pickup, location: "LAX" };

describe("Turo items on the weather", () => {
  it("labels a pickup and a return with the real reservation time", () => {
    const [p, r] = normalizeWxEvents([pickup, ret]);
    expect(time12(evAt(p))).toBe("9:00 AM");
    expect(time12(evAt(r))).toBe("11:30 PM");
  });

  it("draws a home pickup as the hour starting at pickup, keeps the hour before for LAX", () => {
    const [home, lax] = normalizeWxEvents([pickup, laxPickup]);
    expect(new Date(home.start).getTime()).toBe(Date.parse("2026-10-27T16:00:00Z"));
    expect(new Date(home.end).getTime()).toBe(Date.parse("2026-10-27T17:00:00Z"));
    expect(lax.start).toBe(pickup.start);
    expect(lax.end).toBe(pickup.end);
    expect(time12(evAt(lax))).toBe("9:00 AM");
  });

  it("files events on the day they actually happen", () => {
    const days = agendaByDay(normalizeWxEvents([ret, pickup]));
    expect(days.get("2026-10-27")?.map((e) => e.title)).toEqual(["Turo pickup · Luyue", "Turo return · Luyue"]);
  });

  it("leaves calendar items alone", () => {
    const cal: WxEvent = { title: "Happy Hour", start: "2026-10-31T01:00:00Z", end: "2026-10-31T03:00:00Z", source: "calendar" };
    expect(normalizeWxEvents([cal])[0]).toBe(cal);
    expect(evAt(cal)).toBe(cal.start);
  });
});
