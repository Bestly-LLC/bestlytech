import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Nums, actionLine, buttonLabel, fixAllLabel, moreButtons, parseStuck, primaryLabel, spanText } from "./stuckLib";

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

const agent = (fix: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  kind: "stuck", item_id: "agent:x", title: "Bank Feed", employee_name: "Bank Feed", blocks: [{ id: "beat", label: "Mercury's key stopped working", detail: "Paste a new one." }],
  fix: { kind: "auth", label: "Mercury's key stopped working", tail: "Paste a new one.", link: "/admin/cost-cutter#mercury-tokens", link_label: "Update key", retry: false, primary: "key", ...fix },
  ...extra,
});

describe("fix buttons", () => {
  it("reads the server's verdict and the latest action", () => {
    const [it] = parseStuck([agent({}, { action: { id: "a1", kind: "scout", status: "needs_yes", note: "Scout found a fix but needs your yes: x", thread_id: "t1", auto: false, by: "Bank Feed" } })]);
    expect(it.fix).toMatchObject({ kind: "auth", primary: "key", link: "/admin/cost-cutter#mercury-tokens" });
    expect(it.action).toMatchObject({ status: "needs_yes", kind: "scout", thread_id: "t1" });
  });

  it("never shows a Retry button where there is no retry", () => {
    const [it] = parseStuck([agent({ kind: "transient", primary: "retry", retry: false })]);
    expect(it.fix?.primary).toBe("scout");
  });

  it("falls back to Scout for a verdict it does not know, and to settings for a missing link", () => {
    const [it] = parseStuck([agent({ kind: "wat", primary: "dance", link: null })]);
    expect(it.fix).toMatchObject({ kind: "other", primary: "scout", link: "/admin/settings" });
  });

  it("an old feed with no verdict still parses (claims, and a page ahead of the database)", () => {
    const [it] = parseStuck([{ kind: "stuck", item_id: "claim:1", title: "A claim" }]);
    expect(it.fix).toBeNull();
    expect(it.action).toBeNull();
    expect(it.undo ?? null).toBeNull();
  });

  it("labels the big button by the verdict", () => {
    const fx = (primary: string, retry = false) => parseStuck([agent({ primary, retry, kind: primary === "key" ? "auth" : "transient" })])[0].fix!;
    expect(primaryLabel(fx("key"))).toBe("Update key");
    expect(primaryLabel(fx("retry", true))).toBe("Retry now");
    expect(primaryLabel(fx("scout"))).toBe("Have Scout fix it");
  });

  it("More holds whatever the big button is not, then the prompt, then Snooze", () => {
    const fx = (o: Record<string, unknown>) => parseStuck([agent(o)])[0].fix!;
    expect(moreButtons(fx({ primary: "key", retry: false }))).toEqual(["scout", "prompt", "snooze"]);
    expect(moreButtons(fx({ primary: "key", retry: true }))).toEqual(["scout", "retry", "prompt", "snooze"]);
    expect(moreButtons(fx({ primary: "retry", retry: true, kind: "transient" }))).toEqual(["scout", "prompt", "snooze"]);
    expect(moreButtons(fx({ primary: "scout", retry: true, kind: "other" }))).toEqual(["retry", "prompt", "snooze"]);
    expect(moreButtons(fx({ primary: "scout", retry: false, kind: "other" }))).toEqual(["prompt", "snooze"]);
    expect(moreButtons(null)).toEqual(["prompt", "snooze"]);   // a claim
  });

  it("keeps the number with its unit on the Snooze button", () => {
    expect(buttonLabel.snooze).toBe("Snooze 1 day");
  });

  it("says what happened in plain words, using the server's reason when it gave one", () => {
    const a = { id: "a", kind: "retry" as const, status: "failed" as const, note: null, thread_id: null, auto: false, by: null };
    expect(actionLine({ ...a, note: "It ran again and failed. A temporary error: HTTP 503." })).toContain("HTTP 503");
    expect(actionLine({ ...a, status: "working" })).toBe("Trying again right now.");
    expect(actionLine({ ...a, status: "working", kind: "scout" })).toBe("Scout is looking into it.");
    expect(actionLine({ ...a, status: "needs_yes" })).toContain("needs your yes");
    expect(actionLine(a)).toBe("That did not work.");
  });

  it("never uses an emoji, the word Nextcloud or an ellipsis in a button or a status line", () => {
    const said = [...Object.values(buttonLabel), actionLine({ id: "a", kind: "retry", status: "done", note: null, thread_id: null, auto: false, by: null })].join(" ");
    expect(said).not.toMatch(/nextcloud|\.\.\.|…|\p{Extended_Pictographic}/iu);
  });
});
