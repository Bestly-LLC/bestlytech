import { describe, expect, it } from "vitest";
import { isKitchen, lightsState, walkInState, type HaStatus } from "./ha";

const ok: HaStatus = {
  catalog: true, fresh: true, scene_cooking: true, room_sensor: true, room_exists: true,
  kitchen_sensor_exists: true, kitchen_sensor_online: true, settings: { lights: true, kitchen_auto: true },
};

describe("Home Assistant toggles heal themselves", () => {
  it("both are available when Home Assistant has the scene and a live room sensor", () => {
    expect(lightsState(ok)).toEqual({ available: true, why: null });
    expect(walkInState(ok)).toEqual({ available: true, why: null });
  });
  it("falls back to an honest label when the scene goes missing", () => {
    const s = lightsState({ ...ok, scene_cooking: false });
    expect(s.available).toBe(false);
    expect(s.why).toBe("Not available yet: Home Assistant has no Cooking scene.");
  });
  it("names the Kitchen presence sensor when it is offline", () => {
    const s = walkInState({ ...ok, kitchen_sensor_online: false, room_sensor: false });
    expect(s.available).toBe(false);
    expect(s.why).toBe("Not available yet: the Kitchen presence sensor is offline.");
  });
  it("names a missing room sensor", () => {
    expect(walkInState({ ...ok, room_exists: false, room_sensor: false }).why).toBe("Not available yet: Home Assistant has no room sensor.");
  });
  it("treats a failed or stale status as unavailable, never as on", () => {
    expect(lightsState(null).available).toBe(false);
    expect(walkInState(undefined).available).toBe(false);
    expect(lightsState({ ...ok, fresh: false }).why).toContain("has not reported in lately");
    expect(walkInState({ ...ok, catalog: false }).available).toBe(false);
  });
  it("labels never end in an ellipsis", () => {
    for (const s of [lightsState(null), walkInState(null), lightsState({ ...ok, fresh: false })]) expect(s.why).not.toMatch(/\.\.\.|…/);
  });
  it("reads the kitchen from the room sensor", () => {
    expect(isKitchen("Kitchen")).toBe(true);
    expect(isKitchen(" kitchen ")).toBe(true);
    expect(isKitchen("Desk")).toBe(false);
    expect(isKitchen("unknown")).toBe(false);
    expect(isKitchen(undefined)).toBe(false);
  });
});
