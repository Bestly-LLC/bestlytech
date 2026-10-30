import { describe, expect, it } from "vitest";
import { realNeeds, upcoming, type TodayRow } from "./homeLogic";
import { parseStuck, moreButtons } from "./stuckLib";

const row = (i: number, title: string, source = "Security", severity = "error"): TodayRow => ({
  key: `k${i}`, source, severity, title, detail: null, action_label: null, url: null, since: `2026-10-29T0${i % 10}:00:00Z`, item_count: null, rank: i,
});

describe("realNeeds folds Ares's findings", () => {
  it("turns 40 findings into one row and drops the outage row that repeats them", () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => row(i, `Ares couldn't fix: finding ${i}`)),
      row(50, "Still down after an hour: 10 security problems need you", "Down"),
      row(51, "Still down after an hour: Video GPU box did not start", "Down"),
      row(52, "AWS credit under $100", "Alerts", "warning"),
    ];
    const out = realNeeds(rows);
    expect(out).toHaveLength(3);
    expect(out[0].title).toBe("Ares couldn't fix 40 security findings");
    expect(out[0].url).toBe("/admin/security");
    expect(out.map((r) => r.title)).not.toContain("Still down after an hour: 10 security problems need you");
  });
  it("leaves two findings alone", () => {
    const out = realNeeds([row(1, "Ares couldn't fix: a"), row(2, "Ares couldn't fix: b")]);
    expect(out).toHaveLength(2);
  });
});

describe("My day's next item", () => {
  const now = new Date("2026-10-30T06:30:00Z").getTime();
  it("does not repeat the same meeting as its own 'then', and sees the weather's calendar", () => {
    const next = { title: "Eli x Jared ", start: "2026-11-02T20:00:00Z", end: null, join_url: null, calendar: "Personal" };
    const ups = upcoming(
      { next, events: [{ ...next }, { ...next, title: "Centering You", start: "2026-11-03T17:00:00Z" }] },
      { events: [
        { title: "Happy Hour with Mitch and Gerry", start: "2026-10-31T01:00:00Z", end: "2026-10-31T02:00:00Z" },
        { title: "Turo return · Craig", start: "2026-10-30T16:30:00Z", end: "2026-10-30T17:30:00Z", source: "turo", turo: "return" },
        { title: "All day thing", start: "2026-10-30T07:00:00Z", end: "2026-10-31T07:00:00Z", all_day: true },
      ], updated_at: null, calendar_at: null, err: null },
      now,
    );
    expect(ups.map((u) => u.title)).toEqual(["Happy Hour with Mitch and Gerry", "Eli x Jared", "Centering You"]);
  });
});

describe("a fix only a person can run", () => {
  it("carries the command through and keeps Scout in More", () => {
    const [it0] = parseStuck([{ kind: "stuck", item_id: "agent:edge-guard", title: "Edge Guard", blocks: [],
      fix: { kind: "auth", primary: "key", label: "x", command: "npx wrangler login", command_note: "Run once." } }]);
    expect(it0.fix?.command).toBe("npx wrangler login");
    expect(moreButtons(it0.fix)).toContain("scout");
  });
});
