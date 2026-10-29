import { describe, expect, it } from "vitest";
import {
  applyEdits, buildTimeline, checkConfig, denyAdded, describeAction, describeConfig, describeTrigger, digestEvidence, entityTargets, fileSections, fmt12,
  guessEntities, historyLines, houseRuleProblems, lineDiff, localToUtc, minimalEdit, newUnknownEntities, normalizeDiagnosis, parseWhen, riskReasons, stripHaTags,
} from "./lib.ts";

const names = new Map([
  ["light.bathroom", "Bathroom Light"], ["light.shower_ceiling", "Shower Ceiling"], ["input_boolean.sexy_time", "Sexy Time"],
  ["binary_sensor.bath_motion", "Bathroom Motion"],
]);
// Thursday Oct 29 2026, 7:00 AM Pacific (PDT, UTC-7)
const NOW = new Date("2026-10-29T14:00:00Z");

describe("time", () => {
  it("writes 12-hour Pacific times with plain spaces", () => {
    expect(fmt12("2026-10-29T13:02:10+00:00")).toBe("6:02 AM");
    expect(fmt12("2026-10-29T13:02:10+00:00", { sec: true })).toBe("6:02:10 AM");
    expect(fmt12("2026-10-29T22:30:00Z")).toBe("3:30 PM");
    expect(fmt12("2026-10-29T13:02:10Z", { date: true })).toBe("Oct 29, 6:02 AM");
    expect(fmt12("nonsense")).toBe("");
    expect(fmt12(null)).toBe("");
    expect(fmt12("2026-10-29T13:02:10Z")).not.toMatch(/[  ]/);
  });
  it("turns a Pacific wall time into the right instant across DST", () => {
    expect(localToUtc(2026, 10, 29, 6, 0).toISOString()).toBe("2026-10-29T13:00:00.000Z");
    expect(localToUtc(2026, 12, 1, 6, 0).toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
  it("reads when from a sentence", () => {
    const a = parseWhen("I walked into the bathroom at 6 AM and the lights ramped up", NOW)!;
    expect(a.start.toISOString()).toBe("2026-10-29T12:40:00.000Z");
    expect(a.end.toISOString()).toBe("2026-10-29T14:00:00.000Z");        // not past now
    const y = parseWhen("yesterday at 9:30 pm the lamp came on", NOW)!;
    expect(y.start.toISOString()).toBe("2026-10-29T04:10:00.000Z");
    const later = parseWhen("at 8 pm", NOW)!;                             // 8 PM today has not happened yet -> yesterday
    expect(later.start.toISOString()).toBe("2026-10-29T02:40:00.000Z");
    expect(parseWhen("just now", NOW)!.note).toBe("the last 25 minutes");
    expect(parseWhen("this morning", NOW)!.start.toISOString()).toBe("2026-10-29T11:00:00.000Z");
    expect(parseWhen("the lights are weird", NOW)).toBeNull();
  });
});

describe("devices", () => {
  const cat = [["light.bathroom", "Bathroom Light", "", "Bathroom"], ["light.kitchen", "Kitchen Light", "", "Kitchen"], ["sensor.bathroom_temp", "Bath temp", "", "Bathroom"]];
  it("finds the devices a sentence is about", () => {
    expect(guessEntities("the bathroom lights ramp to 100%", cat)).toEqual(["light.bathroom"]);
    expect(guessEntities("nothing here", cat)).toEqual([]);
    expect(guessEntities("bathroom", cat, ["light.kitchen"])[0]).toBe("light.kitchen");
  });
});

describe("plain lines", () => {
  it("describes triggers, conditions and actions", () => {
    expect(describeTrigger({ trigger: "time", at: "06:00:00" }, names)).toBe("at 6:00 AM");
    expect(describeTrigger({ platform: "state", entity_id: "light.shower_ceiling", to: "on", for: { minutes: 5 } }, names)).toBe("Shower Ceiling turns on for 5 min");
    expect(describeTrigger({ trigger: "sun", event: "sunset", offset: "-00:30:00" }, names)).toContain("sunset");
    expect(describeAction({ action: "light.turn_on", target: { entity_id: "light.bathroom" }, data: { brightness_pct: 100, transition: 300 } }, names))
      .toBe("turns on Bathroom Light (100% brightness, fading over 300 sec)");
    expect(describeAction({ delay: { minutes: 5 } }, names)).toBe("waits 5 min");
  });
  it("writes one line for a whole automation", () => {
    const line = describeConfig({
      triggers: [{ trigger: "state", entity_id: "binary_sensor.bath_motion", to: "on" }],
      conditions: [{ condition: "state", entity_id: "input_boolean.sexy_time", state: "off" }],
      actions: [{ action: "light.turn_on", target: { entity_id: "light.bathroom" }, data: { brightness_pct: 20 } }, { delay: "00:05:00" }],
    }, names);
    expect(line).toBe("When Bathroom Motion turns on, only if Sexy Time is off, then turns on Bathroom Light (20% brightness), then waits 5 min.");
    expect(describeConfig({ sequence: [{ action: "scene.turn_on", target: { entity_id: "scene.warm" } }] }, names, "script")).toBe("Sets Warm.");
    expect(describeConfig(null, names)).toBe("");
  });
  it("finds the devices an automation acts on", () => {
    expect(entityTargets({ actions: [{ action: "light.turn_on", target: { entity_id: ["light.a", "light.b"] } }, { action: "x", entity_id: "switch.c" }] })).toEqual(["light.a", "light.b", "switch.c"]);
  });
});

describe("diff and edits", () => {
  it("shows only what changed and counts the rest", () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const b = a.replace("line 10", "line ten");
    const d = lineDiff(a, b);
    expect(d.filter((x) => x.t === "-")).toEqual([{ t: "-", s: "line 10" }]);
    expect(d.filter((x) => x.t === "+")).toEqual([{ t: "+", s: "line ten" }]);
    expect(d.some((x) => x.t === "=" && /unchanged/.test(x.s))).toBe(true);
    expect(lineDiff("a\nb", "a\nb").every((x) => x.t !== "+" && x.t !== "-")).toBe(true);
  });
  const file = "automation:\n  - id: a\n    alias: A\n    actions:\n      - action: light.turn_on\n        data:\n          brightness_pct: 100\n  - id: b\n    alias: B\n    actions:\n      - action: light.turn_on\n        data:\n          brightness_pct: 100\n";
  it("makes the smallest edit that points at one place", () => {
    const block = "  - id: b\n    alias: B\n    actions:\n      - action: light.turn_on\n        data:\n          brightness_pct: 100";
    const next = block.replace("100", "30");
    const r = minimalEdit(file, block, next);
    expect(r.error).toBeUndefined();
    const e = r.edits![0];
    expect(file.split(e.old).length - 1).toBe(1);
    const applied = applyEdits(file, r.edits!);
    expect(applied.text).toBe(file.replace(block, next));
    expect(e.old.length).toBeLessThan(block.length + 1);
  });
  it("refuses when the region is not unique or nothing changes", () => {
    expect(minimalEdit(file, "          brightness_pct: 100", "x").error).toBeTruthy();
    const block = "  - id: b\n    alias: B";
    expect(minimalEdit(file, block, block).error).toBeTruthy();
  });
  it("applyEdits needs each old text exactly once", () => {
    expect(applyEdits("a b a", [{ old: "a", new: "x" }]).error).toMatch(/appears 2 times/);
    expect(applyEdits("a b", [{ old: "z", new: "x" }]).error).toMatch(/not found/);
    expect(applyEdits("a b", [{ old: "b", new: "c" }]).text).toBe("a c");
  });
  it("splits a package file into top-level sections", () => {
    const secs = fileSections("# top\nadaptive_lighting:\n  - name: x\n    lights: [light.a]\n\nautomation:\n  - id: a\n");
    expect(secs.map((s) => s.key)).toEqual(["adaptive_lighting", "automation"]);
    expect(secs[0].text).toContain("light.a");
  });
});

describe("safety checks", () => {
  it("only blocks what a fix ADDS", () => {
    expect(denyAdded("action: shell_command.x", "action: shell_command.x\n# fine")).toBeNull();
    expect(denyAdded("a", "action: shell_command.x")).toMatch(/shell_command/);
    expect(denyAdded("token: !secret a", "token: !secret a\nother: !secret b")).toMatch(/!secret/);
    expect(denyAdded("token: !secret a", "token: x")).toBeNull();
  });
  it("finds invented entities but not services or ones that were already there", () => {
    const known = new Set(["light.bathroom"]);
    const svc = { light: ["turn_on", "turn_off"] };
    expect(newUnknownEntities("light.old_thing", "light.old_thing light.bathroom light.turn_on light.made_up", known, svc)).toEqual(["light.made_up"]);
  });
  it("flags risky changes", () => {
    expect(riskReasons("action: lock.unlock\n", "action: light.turn_on\n")).toContain("it touches a lock");
    expect(riskReasons("action: lock.unlock\n", "action: lock.unlock\n")).toEqual([]);
    expect(riskReasons("climate.set_temperature\n    data:\n      temperature: 90", "x")).toContain("it sets the thermostat outside 60 to 85 degrees F");
    const old = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    expect(riskReasons("l0\nl1", old)).toContain("it removes more than half of the automation");
  });
  it("never lets a fix quietly remove the trigger or the action", () => {
    expect(checkConfig("automation", { alias: "x", actions: [{ delay: 1 }] })[0]).toMatch(/no trigger/);
    expect(checkConfig("automation", { triggers: [{ trigger: "time", at: "06:00:00" }] })[0]).toMatch(/does nothing/);
    expect(checkConfig("automation", { trigger: [{ platform: "time" }], action: [{ delay: 1 }] })).toEqual([]);
    expect(checkConfig("script", { sequence: [] })[0]).toMatch(/does nothing/);
    expect(checkConfig("automation", {})[0]).toMatch(/empty/);
  });
  it("strips Home Assistant tags so a plain parser can read a file", () => {
    expect(stripHaTags("token: !secret my_token\nx: !include a.yaml\n- !input foo")).toBe("token: my_token\nx: a.yaml\n- foo");
  });
  it("holds the house rules in what Jared reads", () => {
    expect(houseRuleProblems(["At 06:02 the light turned on"])).toHaveLength(1);
    expect(houseRuleProblems(["At 6:02 AM the light turned on", "It was 68 degrees F"])).toEqual([]);
    expect(houseRuleProblems(["It was 20 °C"])).toHaveLength(1);
  });
});

describe("evidence", () => {
  const ev = {
    window: { start: "2026-10-29T12:50:00+00:00", end: "2026-10-29T14:00:00+00:00" },
    entities: { "light.bathroom": { name: "Bathroom Light", state: "on", brightness_pct: 100, area: "Bathroom" } },
    history: { "light.bathroom": [["2026-10-29T13:02:10+00:00", "on", 20, 2700, null], ["2026-10-29T13:03:10+00:00", "on", 40, 3100, null], ["2026-10-29T13:09:10+00:00", "on", 100, 4000, null]] },
    logbook: [
      { when: "2026-10-29T13:02:10+00:00", name: "Bathroom Light", message: "turned on", entity_id: "light.bathroom", context_name: "Bathroom Motion" },
      { when: "2026-10-29T13:03:00+00:00", name: "Wake lights", message: "triggered", entity_id: "automation.wake_lights" },
    ],
    fired_in_window: [{ entity_id: "automation.wake_lights", name: "Wake lights", last_triggered: "2026-10-29T13:03:00+00:00" }],
    referrers: [
      { kind: "automation", entity_id: "automation.wake_lights", name: "Wake lights", where: "package", file: "withings_wake_lights", id: "wake", hits: ["light.bathroom"], fired: true, last_triggered: "2026-10-29T13:03:00+00:00", block: "  - id: wake\n    # a note\n    actions:\n      - action: light.turn_on\n        data:\n          transition: 360\n          brightness_pct: 100" },
      { kind: "automation", entity_id: "automation.other", name: "Other", where: "ui", id: "o", hits: [], fired: false, cfg: { alias: "Other" }, hash: "0123456789abcdef" },
    ],
    traces: [{ entity_id: "automation.wake_lights", started: "2026-10-29T13:03:00+00:00", state: "stopped", steps: [{ path: "action/0", do: "light.turn_on transition 360" }] }],
    package_files: { withings_wake_lights: { sha256: "x", text: "adaptive_lighting:\n  - name: bath\n    lights:\n      - light.bathroom\n\nautomation:\n  - id: wake\n" } },
    notes: [],
  };
  it("builds a story the model can read, with 12-hour times", () => {
    const d = digestEvidence("why did it ramp up", ev, names);
    expect(d.text).toContain("6:02:10 AM");
    expect(d.text).toContain("K1 automation \"Wake lights\" (in file withings_wake_lights) RAN in the window");
    expect(d.text).toContain("transition: 360");
    expect(d.text).not.toContain("# a note");
    expect(d.text).toContain("trace 6:03:00 AM");
    expect(d.text).toContain("S1 section \"adaptive_lighting\"");
    expect(d.suspects.map((s) => s.key)).toEqual(["K1", "K2"]);
    expect(d.suspects[1].hash).toBe("0123456789abcdef");
    expect(d.text.length).toBeLessThan(11_000);
  });
  it("makes a timeline for Jared", () => {
    const t = buildTimeline(ev, names);
    expect(t[0].t).toBe("6:02:10 AM");
    expect(t.map((x) => x.text).join(" | ")).toContain("started by Bathroom Motion");
    expect(t.map((x) => x.text).join(" | ")).toContain("Bathroom Light is on at 100% brightness");
    expect(t.every((x, i) => i === 0 || x.at >= t[i - 1].at)).toBe(true);
  });
  it("samples long histories", () => {
    const s = Array.from({ length: 100 }, (_, i) => [`2026-10-29T13:${String(i % 60).padStart(2, "0")}:00+00:00`, "on", i, null, null]);
    expect(historyLines(s as never, 10)).toHaveLength(10);
  });
  it("checks the model's diagnosis", () => {
    const keys = new Set(["K1", "K2"]);
    const ok = normalizeDiagnosis({ story: ["At 6:02 AM the light came on."], culprit: "k1", confidence: "HIGH", also: ["K2", "K9"], cause: "x" }, keys);
    expect(ok).toMatchObject({ culprit: "K1", confidence: "high", also: ["K2"] });
    expect(normalizeDiagnosis({ story: [], culprit: "K1" }, keys)).toMatch(/story/);
    expect(normalizeDiagnosis({ story: ["a"], culprit: "K7", confidence: "high" }, keys)).toMatchObject({ culprit: null });
    expect(normalizeDiagnosis("x", keys)).toMatch(/JSON/);
  });
});
