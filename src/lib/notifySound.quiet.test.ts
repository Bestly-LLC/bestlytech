import { describe, it, expect, vi, afterEach } from "vitest";

// Fresh module per test: the gate keeps module state.
async function load() {
  vi.resetModules();
  return await import("./notifySound");
}

afterEach(() => vi.useRealTimers());

describe("quiet hours sound gate", () => {
  it("leaves the partner portal alone until the admin opts in", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T09:35:00Z")); // 1:35 AM PST
    const m = await load();
    expect(m.notifyQuietNow(false)).toBe(false);
  });

  it("is quiet at 1:35 AM LA by the clock when the server has not answered", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T09:35:00Z")); // 1:35 AM PST
    const m = await load(); m.enableJaredQuietHours();
    expect(m.notifyQuietNow(false)).toBe(true);
    expect(m.notifyQuietNow(true)).toBe(false); // emergency still sounds
  });

  it("is quiet at 1:35 AM PDT too (the DST night)", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T08:35:00Z")); // 1:35 AM PDT
    const m = await load(); m.enableJaredQuietHours();
    expect(m.notifyQuietNow(false)).toBe(true);
  });

  it("is not quiet at 7:05 AM or 10:59 PM LA", async () => {
    vi.useFakeTimers();
    let m = await load(); m.enableJaredQuietHours();
    vi.setSystemTime(new Date("2026-11-06T15:05:00Z")); // 7:05 AM PST
    expect(m.notifyQuietNow(false)).toBe(false);
    vi.setSystemTime(new Date("2026-11-06T06:59:00Z")); // 10:59 PM PST
    m = await load(); m.enableJaredQuietHours();
    expect(m.notifyQuietNow(false)).toBe(false);
  });

  it("follows the server's answer while it is fresh, then falls back to the clock", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T20:00:00Z")); // noon PST
    const m = await load();
    m.setNotifyQuiet(true, true); // e.g. Do Not Disturb
    expect(m.notifyQuietNow(false)).toBe(true);
    expect(m.notifyQuietNow(true)).toBe(false);
    m.setNotifyQuiet(true, false); // emergencies switched off too
    expect(m.notifyQuietNow(true)).toBe(true);
    vi.setSystemTime(new Date("2026-11-06T20:04:00Z")); // answer is 4 minutes old
    expect(m.notifyQuietNow(false)).toBe(false); // noon by the clock
  });
});
