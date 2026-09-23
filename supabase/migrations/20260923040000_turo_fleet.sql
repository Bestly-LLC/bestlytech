-- Turo Watch, fleet side: who has the car, when it comes back, and what the car is doing.
--
-- Until now Turo Watch only knew about PRICES. These two tables give it the other half:
--
--   turo_trips          one row per reservation (NOT per feed item - see the note below)
--   turo_vehicle_state  the latest telemetry snapshot per VIN, from TezLab
--
-- Where the data comes from:
--   Trips come from GET https://turo.com/api/v2/feeds/upcoming-trips?appMode=HOST, fetched from
--   inside Jared's logged-in Chrome, exactly like the pricing calls in scripts/turo_watch.py.
--   Turo has no public API and no server-side token, so this can never be pulled by an edge
--   function on its own - something holding the session has to push it in.
--
--   THE TRAP: that feed returns one item PER EVENT, not per trip. Every reservation appears
--   twice, as OWNER_TRIP_START and OWNER_TRIP_END, and a trip already under way shows only its
--   END item. Anything writing here must de-duplicate by reservation_id first, which is why
--   reservation_id is the primary key rather than a surrogate.

create table if not exists public.turo_trips (
  reservation_id   bigint primary key,
  vehicle_id       bigint not null,
  vin              text,                      -- joins a trip to turo_vehicle_state / TezLab
  guest_first      text,
  guest_last       text,
  guest_url        text,
  guest_image      text,
  guest_all_star   boolean not null default false,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  local_start      text,                      -- Turo's own local wall-clock, kept verbatim so the
  local_end        text,                      -- UI never has to guess the listing's timezone
  time_zone        text,
  in_progress      boolean not null default false,
  checked_out      boolean not null default false,
  pickup_address   text,
  pickup_city      text,
  pickup_lat       double precision,
  pickup_lon       double precision,
  airport_code     text,
  -- Money and mileage are NOT in the upcoming-trips feed; they need a reservation-detail
  -- endpoint that has not been found yet. Nullable on purpose rather than absent, so the
  -- overage work can land without another migration.
  earnings         numeric,
  miles_included   int,
  odometer_start   int,
  odometer_end     int,
  status           text,
  raw              jsonb,                     -- the whole feed item, so a new field needs no migration
  first_seen_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists turo_trips_ends_idx on public.turo_trips (ends_at);
create index if not exists turo_trips_active_idx on public.turo_trips (in_progress) where in_progress;

create table if not exists public.turo_vehicle_state (
  vin              text primary key,
  display_name     text,
  observed_at      timestamptz not null,      -- TezLab's reading time, NOT our write time
  battery_pct      int,
  range_epa        numeric,
  range_real       numeric,                   -- TezLab Real World Range; prefer this in the UI
  odometer         int,
  latitude         double precision,
  longitude        double precision,
  locked           boolean,
  charging_state   text,
  plugged_in       boolean,
  inside_temp      numeric,                   -- a hot cabin already cost one headrest
  outside_temp     numeric,
  connection_state text,
  software_version text,
  raw              jsonb,
  updated_at       timestamptz not null default now()
);

alter table public.turo_trips enable row level security;
alter table public.turo_vehicle_state enable row level security;

do $$
declare t text;
begin
  foreach t in array array['turo_trips', 'turo_vehicle_state'] loop
    -- Admin reads in the browser. Writes arrive only through the turo-ingest edge function
    -- on the service role, so no insert/update policy is granted to anyone here.
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin_read') then
      execute format('create policy %1$s_admin_read on public.%1$s for select to authenticated using (public.has_role(auth.uid(), ''admin''))', t);
    end if;
  end loop;
end $$;

comment on table public.turo_trips is
  'One row per Turo reservation. Written by turo-ingest from the upcoming-trips HOST feed, which emits one item per event (OWNER_TRIP_START / OWNER_TRIP_END) - always de-duplicate by reservation_id.';
comment on table public.turo_vehicle_state is
  'Latest TezLab telemetry per VIN. One row per car, overwritten in place; observed_at is TezLab''s reading time, so a stale car is visible rather than silently fresh.';
