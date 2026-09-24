// turo-ingest - the only way trips and vehicle telemetry get into Turo Watch.
//
// Turo has no public API and no server-side token: the upcoming-trips feed is only readable
// from inside a browser that holds Jared's session. So this function cannot go and fetch -
// whatever holds the session (a Claude session driving his Chrome, or the Mac runner) pushes
// here instead, and this owns the messy part: de-duplicating the feed and writing it safely.
//
//   POST { trips: [<raw upcomingTripItems>], vehicle: <raw TezLab status> }
//   headers: x-worker-key  (the same Mac worker key the rest of the fleet tooling uses)
//   -> { ok, trips: {seen, written}, vehicle: "written" | "skipped", pruned }
//
// THE DE-DUPLICATION, because it is the whole reason this is server-side rather than inline:
// the feed returns one item PER EVENT, not per trip. Every reservation shows up twice, as
// OWNER_TRIP_START and OWNER_TRIP_END, and a trip already under way shows only its END item.
// Merging by reservationId and OR-ing inProgress across the pair is what turns 5 feed items
// into 3 real trips. Get this wrong and the dashboard double-counts every booking.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-worker-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const iso = (n: unknown) => (typeof n === "number" && n > 0 ? new Date(n).toISOString() : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  // Worker key, or an admin's own session. Same shape as vault-intake.
  const wk = req.headers.get("x-worker-key") ?? "";
  let allowed = !!wk && !!(await db.rpc("partner_ai_key_ok", { p_key: wk })).data;
  if (!allowed) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    if (u?.user) {
      const { data: isAdmin } = await db.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
      allowed = !!isAdmin;
    }
  }
  if (!allowed) return J({ ok: false, error: "unauthorized" }, 401);

  let body: { trips?: Record<string, any>[]; vehicle?: Record<string, any> };
  try {
    body = await req.json();
  } catch {
    return J({ ok: false, error: "expected JSON" }, 400);
  }

  const result: Record<string, unknown> = { ok: true };

  // ---------------------------------------------------------------- trips
  if (Array.isArray(body.trips)) {
    const byId = new Map<number, Record<string, unknown>>();

    for (const it of body.trips) {
      const id = Number(it?.reservationId);
      if (!Number.isFinite(id) || id <= 0) continue;

      const a = it.actor ?? {};
      const loc = it.location ?? {};
      const veh = it.vehicle ?? {};
      const start = it.interval?.start ?? {};
      const end = it.interval?.end ?? {};

      const row = {
        reservation_id: id,
        vehicle_id: Number(veh.id) || 0,
        vin: veh.vin ?? null,
        guest_first: a.firstName ?? null,
        guest_last: a.lastName ?? null,
        guest_url: a.url ?? null,
        guest_image: a.image?.originalImageUrl ?? a.image?.url ?? null,
        guest_all_star: !!a.allStarHost,
        starts_at: iso(start.epochMillis),
        ends_at: iso(end.epochMillis),
        local_start: start.localDate && start.localTime ? `${start.localDate} ${start.localTime}` : null,
        local_end: end.localDate && end.localTime ? `${end.localDate} ${end.localTime}` : null,
        time_zone: it.timeZone ?? loc.timeZone ?? null,
        in_progress: !!it.inProgress,
        checked_out: !!it.hasGuestCheckedOut,
        pickup_address: loc.address ?? null,
        pickup_city: loc.city ?? null,
        pickup_lat: typeof loc.latitude === "number" ? loc.latitude : null,
        pickup_lon: typeof loc.longitude === "number" ? loc.longitude : null,
        airport_code: loc.airportCode ?? null,
        status: it.upcomingTripFeedItemType ?? null,
        raw: it,
        updated_at: new Date().toISOString(),
      };
      if (!row.starts_at || !row.ends_at) continue;

      // The merge. Two items for one trip: keep the fullest picture of each field, and never
      // let a START item's inProgress:false overwrite the END item's true.
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, row);
      } else {
        byId.set(id, {
          ...prev,
          ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
          in_progress: (prev.in_progress as boolean) || row.in_progress,
          checked_out: (prev.checked_out as boolean) || row.checked_out,
          // status is per-event and therefore meaningless once merged
          status: row.in_progress || prev.in_progress ? "IN_PROGRESS" : "BOOKED",
        });
      }
    }

    const rows = [...byId.values()];
    if (rows.length) {
      const { error } = await db.from("turo_trips").upsert(rows, { onConflict: "reservation_id" });
      if (error) return J({ ok: false, step: "trips", error: error.message }, 500);
    }

    // A trip that vanishes from the feed was cancelled or finished. Only ever prune the
    // future: past trips are history and some of them are claim evidence.
    const keep = rows.map((r) => r.reservation_id as number);
    let pruned = 0;
    if (keep.length) {
      const { data: gone } = await db
        .from("turo_trips")
        .delete()
        .gt("ends_at", new Date().toISOString())
        .not("reservation_id", "in", `(${keep.join(",")})`)
        .select("reservation_id");
      pruned = gone?.length ?? 0;
    }
    result.trips = { seen: body.trips.length, written: rows.length };
    result.pruned = pruned;
  }

  // -------------------------------------------------------------- vehicle
  const v = body.vehicle;
  if (v && typeof v.vin === "string") {
    const { error } = await db.from("turo_vehicle_state").upsert(
      {
        vin: v.vin,
        display_name: v.display_name ?? null,
        // TezLab's own reading time, so a car that has not reported in is visibly stale
        // rather than looking fresh because we happened to write the row just now.
        observed_at: v.last_updated ?? new Date().toISOString(),
        battery_pct: v.battery?.level_pct ?? null,
        range_epa: v.battery?.range ?? null,
        range_real: v.battery?.real_world_range ?? null,
        odometer: v.odometer ?? null,
        latitude: v.location?.latitude ?? null,
        longitude: v.location?.longitude ?? null,
        locked: v.doors?.locked ?? null,
        charging_state: v.charging_state ?? null,
        plugged_in: v.plugged_in ?? null,
        inside_temp: v.climate?.inside_temp ?? null,
        outside_temp: v.climate?.outside_temp ?? null,
        connection_state: v.connection_state ?? null,
        software_version: v.software_version ?? null,
        raw: v,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "vin" },
    );
    if (error) return J({ ok: false, step: "vehicle", error: error.message }, 500);
    result.vehicle = "written";
  } else {
    result.vehicle = "skipped";
  }

  return J(result);
});
