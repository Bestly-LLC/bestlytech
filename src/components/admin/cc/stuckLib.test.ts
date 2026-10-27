import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Nums, fixAllLabel, parseStuck, spanText } from "./stuckLib";

describe("StuckCards helpers", () => {
  it("adapts the fix-all label to how many blocks are left", () => {
    expect(fixAllLabel(1)).toBe("Fix it");
    expect(fixAllLabel(2)).toBe("Fix both");
    expect(fixAllLabel(3)).toBe("Fix all three");
    expect(fixAllLabel(4)).toBe("Fix all four");
  });

  it("joins a number to its unit with a no-break space", () => {
    const now = Date.parse("2026-10-27T21:00:00Z");
    expect(spanText("2026-10-26T16:00:00Z", now)).toBe("29 hrs");
    expect(spanText("2026-10-27T20:15:00Z", now)).toBe("45 min");
    expect(spanText("2026-10-27T19:00:00Z", now)).toBe("2 hrs");
    expect(spanText("2026-10-27T20:00:00Z", now)).toBe("1 hr");
    expect(spanText(null, now)).toBeNull();
  });

  it("wraps numbers and times so they never split across lines", () => {
    const html = renderToStaticMarkup(createElement(Nums, { text: "Today, 2:06 PM and $1,647.81 owed" }));
    expect(html).toContain('<span class="whitespace-nowrap">2:06 PM</span>');
    expect(html).toContain('<span class="whitespace-nowrap">$1,647.81</span>');
  });

  it("drops anything that is not a well-formed item, and tolerates a non-array feed", () => {
    expect(parseStuck(null)).toEqual([]);
    expect(parseStuck({ nope: true })).toEqual([]);
    const items = parseStuck([
      { kind: "stuck", item_id: "claim:1", title: "Cody's claim", employee_name: "Claims Closer", blocks: [{ id: "hold", label: "Paused by the watchdog", fix_action: "hold", fix_label: "Release" }, { bad: true }] },
      { kind: "weird", item_id: "x", title: "y" },
      null,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].blocks).toHaveLength(1);
    expect(items[0].blocks[0].fix_action).toBe("hold");
  });
});
