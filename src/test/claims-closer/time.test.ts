import { describe, expect, it } from "vitest";
import { laInstant, laTime, laTimeLong, fmtPT } from "../../../supabase/functions/claims-closer/time.ts";
describe("Pacific time", () => {
  it("PDT and PST", () => { expect(new Date(laInstant("2026-10-23", 21, 30)).toISOString()).toBe("2026-10-24T04:30:00.000Z"); expect(new Date(laInstant("2026-11-02", 9, 0)).toISOString()).toBe("2026-11-02T17:00:00.000Z"); });
  it("Turo wording", () => { expect(new Date(laTime("October 29 at 12:43 PM", Date.parse("2026-10-28T00:00:00Z"))!).toISOString()).toBe("2026-10-29T19:43:00.000Z"); });
  it("long form from the 7-days-left reminder", () => expect(new Date(laTimeLong("file a claim with Turo by Friday, October 23, 2026 at 9:30 PM.")!).toISOString()).toBe("2026-10-24T04:30:00.000Z"));
  it("12-hour output", () => expect(fmtPT("2026-10-28T20:45:00Z")).toBe("Wed, Oct 28, 1:45 PM"));
});
