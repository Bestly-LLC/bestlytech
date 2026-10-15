// Offline test for card-scan's validation and rate limits, against an in-memory store.
//   node --experimental-strip-types --test supabase/functions/card-scan/logic.test.ts
//   (also runs under: deno test --no-lock supabase/functions/card-scan/logic.test.ts)
import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, type Row, type Store, cleanDevice, logScan, parseScan } from "./logic.ts";

function memStore(): Store & { rows: (Row & { id: string; at: number })[]; clock: { now: number } } {
  const clock = { now: 1_000_000_000_000 };
  const rows: (Row & { id: string; at: number })[] = [];
  return {
    rows, clock,
    async findRecent(d, s, since) { return rows.filter((r) => r.device_id === d && r.src === s && r.at > Date.parse(since)).at(-1)?.id ?? null; },
    async countSince(since, f) {
      return rows.filter((r) => r.at > Date.parse(since) && (!f.ipHash || r.ip_hash === f.ipHash) && (!f.deviceId || r.device_id === f.deviceId)).length;
    },
    async insert(row) { const id = `id${rows.length + 1}`; rows.push({ ...row, id, at: clock.now }); return id; },
  };
}
const ok = { src: "card", kind: "home", device: "iPhone Safari", device_id: "abcdef1234567890" };

test("validation", () => {
  assert.ok(parseScan(ok));
  for (const bad of [null, [], "x", {}, { ...ok, src: "Card" }, { ...ok, src: "a".repeat(25) }, { ...ok, src: "x;drop" }, { ...ok, src: 5 },
    { ...ok, kind: "other" }, { ...ok, kind: undefined }]) assert.equal(parseScan(bad), null, JSON.stringify(bad));
  assert.equal(parseScan({ ...ok, device_id: "short" })!.device_id, null); // bad id: logged, no dedupe
  assert.equal(parseScan({ ...ok, device_id: "x".repeat(41) })!.device_id, null);
  assert.equal(parseScan({ ...ok, device_id: { $ne: 1 } })!.device_id, null);
  assert.equal(cleanDevice("<script>alert(1)</script>iPhone"), "scriptalert(1)scriptiPhone"); // <, >, / dropped
  assert.equal(cleanDevice("a".repeat(100))!.length, 40);
  assert.equal(cleanDevice("\u0000\n"), null);
  assert.equal(cleanDevice({}), null);
});

test("bad body writes nothing and returns 400", async () => {
  const s = memStore();
  assert.deepEqual(await logScan({ src: "BAD", kind: "home" }, "ip1", s, s.clock.now), { status: 400 });
  assert.equal(s.rows.length, 0);
});

test("repeat scan from the same browser reuses the row and costs no budget", async () => {
  const s = memStore();
  const a = await logScan(ok, "ip1", s, s.clock.now);
  for (let i = 0; i < 50; i++) assert.deepEqual(await logScan(ok, "ip1", s, s.clock.now), a);
  assert.equal(s.rows.length, 1);
  s.clock.now += LIMITS.DEDUPE_MS + 1; // a day-later style rescan counts again
  const b = await logScan(ok, "ip1", s, s.clock.now);
  assert.equal(s.rows.length, 2);
  assert.notDeepEqual(a, b);
});

test("per-IP cap: rotating device ids from one address stops at the cap, other addresses unaffected", async () => {
  const s = memStore();
  let last: unknown;
  for (let i = 0; i < 20; i++) last = await logScan({ ...ok, device_id: `dev${String(i).padStart(10, "0")}` }, "flooder", s, s.clock.now);
  assert.equal(s.rows.filter((r) => r.ip_hash === "flooder").length, LIMITS.PER_IP);
  assert.deepEqual(last, { status: 429 });
  assert.equal((await logScan({ ...ok, device_id: "otherguest00001" }, "ip2", s, s.clock.now)).status, 200);
});

test("per-device cap: one device id rotating src stops at the cap even from fresh IPs", async () => {
  const s = memStore();
  const out = [];
  for (let i = 0; i < 6; i++) out.push((await logScan({ ...ok, src: `card-${i}` }, `ip${i}`, s, s.clock.now)).status);
  assert.deepEqual(out, [200, 200, 200, 429, 429, 429]);
});

test("window expires: caps lift after 10 minutes", async () => {
  const s = memStore();
  for (let i = 0; i < 8; i++) await logScan({ ...ok, device_id: `dev${String(i).padStart(10, "0")}` }, "ip1", s, s.clock.now);
  assert.equal(s.rows.length, LIMITS.PER_IP);
  s.clock.now += LIMITS.WINDOW_MS + 1;
  assert.equal((await logScan({ ...ok, device_id: "freshdevice0001" }, "ip1", s, s.clock.now)).status, 200);
});

test("browser with no usable device id still logs, without dedupe", async () => {
  const s = memStore();
  const body = { ...ok, device_id: undefined };
  const r = await logScan(body, "ip1", s, s.clock.now);
  assert.equal(r.status, 200);
  assert.equal(s.rows[0].device_id, null);
});

test("global hourly ceiling drops quietly with a null id", async () => {
  const s = memStore();
  for (let i = 0; i < LIMITS.GLOBAL; i++) s.rows.push({ id: `g${i}`, at: s.clock.now - 1000, src: "card", kind: "home", device: null, device_id: null, ip_hash: `h${i}` });
  assert.deepEqual(await logScan(ok, "newip", s, s.clock.now), { status: 200, id: null });
  assert.equal(s.rows.length, LIMITS.GLOBAL);
});
