-- Turo reviews + All-Star coach (Stella) and fleet maintenance manager (Mae). Plan: docs/turo-reviews-maintenance-opusplan.md
-- 2026-10-07. Everything runs on the Pi with the free AI ladder; Claude only built it.
--   * turo_reviews          every Turo review (69 + Turo system rows), draft/response state, status machine
--   * turo_host_stats       daily snapshot of /business/reviews + /business/performance
--   * turo_allstar_rules    the All-Star rules, with the Turo page they came from and when we checked
--   * turo_guest_ratings    host-to-guest rating deadlines (trip end + 10 days), draft, open-claim skip
--   * fleet_maintenance     one row per tracked item (front/rear tires, wipers, cabin filter, ...)
--   * fleet_maint_events    tread readings, TPMS snapshots, guest flags, recommendations, Costco bookings
--   * reputation_settings / fleet_maint_settings  the switches (auto-post is OFF until Jared turns it on)
-- All tables are RLS-on with no policies: the Pi uses the service key, the admin tabs read through admin-guarded RPCs.

-- ------------------------------------------------------------------ tables
create table if not exists public.turo_reviews (
  id uuid primary key default gen_random_uuid(),
  review_key text not null unique,                 -- md5 of guest|date|vehicle|first 80 chars of text
  reservation_id bigint,
  guest_first text,
  vehicle text,
  plate text,
  review_date date,
  stars int,
  flags jsonb not null default '[]'::jsonb,        -- guest category flags ("Brakes", "Other", "Car location" ...)
  text text,
  kind text not null default 'review' check (kind in ('review', 'system')),
  system_event text,                               -- 'host_cancel' for the automatic Turo row
  respond_available boolean not null default false, -- Turo showed "Leave a public response"
  has_response boolean not null default false,
  response_text text,
  status text not null default 'new' check (status in ('new', 'redraft', 'auto_ready', 'auto_posted', 'needs_jared', 'approved', 'posted', 'skipped', 'failed')),
  needs_reason text,
  draft text,
  draft_by text,
  draft_at timestamptz,
  jared_notes text,
  posted_at timestamptz,
  post_error text,
  by_agent text not null default 'stella',
  trip jsonb,                                      -- trip facts used for the draft (pickup, nights, car)
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists turo_reviews_status_idx on public.turo_reviews (status, review_date desc);
create index if not exists turo_reviews_res_idx on public.turo_reviews (reservation_id);

create table if not exists public.turo_host_stats (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  -- /business/reviews (last 365 days)
  avg_rating numeric, pct_5star numeric, ratings int, trips_365 int, unrated_pct numeric,
  cat jsonb,                                       -- {"Maintenance":82,"Cleanliness":78,...}
  flags jsonb,                                     -- {"Brakes":1,"Other":2,"Car location":1}
  host_cancels_365 int,
  -- /business/performance (the numbers Turo itself uses for All-Star)
  all_star boolean, all_star_status text, next_assessment text, window_label text,
  five_star_rate numeric, maintenance_rate numeric, cleanliness_rate numeric, cancellation_rate numeric, completed_trips int,
  response_rate numeric, response_time text,
  raw jsonb
);
create index if not exists turo_host_stats_at_idx on public.turo_host_stats (taken_at desc);

create table if not exists public.turo_allstar_rules (
  metric text primary key,
  label text not null,
  op text not null check (op in ('>=', '<=')),
  threshold numeric not null,
  unit text not null default '%',
  note text,
  source_url text not null,
  checked_at timestamptz not null default now()
);

create table if not exists public.turo_guest_ratings (
  reservation_id bigint primary key,
  guest_first text,
  trip_ends_at timestamptz,
  deadline date not null,
  status text not null default 'watching' check (status in ('watching', 'draft_ready', 'rated', 'skipped_claim', 'skipped', 'expired')),
  rated boolean not null default false,
  rated_at timestamptz,
  claim_open boolean not null default false,
  draft text,
  draft_at timestamptz,
  notified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.fleet_maintenance (
  id uuid primary key default gen_random_uuid(),
  vin text not null,
  item text not null,                              -- front_tires | rear_tires | wipers | cabin_filter | washer_fluid | brakes
  label text not null,
  installed_on date,
  installed_miles int,
  vendor text,
  receipt_ref text,
  last_check timestamptz,
  est_remaining_pct numeric,
  est_remaining_mi int,
  tread_32nds numeric,                             -- best current estimate, 32nds of an inch
  tread_source text,                               -- 'model' | 'photo' | 'manual'
  due_by date,
  status text not null default 'unknown' check (status in ('ok', 'watch', 'due', 'overdue', 'unknown')),
  notes text,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (vin, item)
);

create table if not exists public.fleet_maint_events (
  id bigint generated always as identity primary key,
  vin text,
  at timestamptz not null default now(),
  kind text not null check (kind in ('tread', 'tpms', 'guest_flag', 'recommendation', 'booking', 'note', 'done')),
  item text,
  value jsonb,
  text text,
  reservation_id bigint,
  by_agent text,
  dedupe text unique
);
create index if not exists fleet_maint_events_at_idx on public.fleet_maint_events (at desc);

create table if not exists public.reputation_settings (
  id boolean primary key default true check (id),
  auto_post_5star boolean not null default false,  -- Jared decided 5-star replies auto-post; stays OFF until he flips it after seeing the first drafts
  ask_lax text,
  ask_home text,
  reply_style text,
  seen_signed_out_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.reputation_settings (id) values (true) on conflict do nothing;

create table if not exists public.fleet_maint_settings (
  id boolean primary key default true check (id),
  costco_mode text not null default 'dry_run' check (costco_mode in ('dry_run', 'live')),
  warn_32nds numeric not null default 4,
  replace_32nds numeric not null default 3,
  new_32nds numeric not null default 10,
  wear_drive_per_1000mi numeric not null default 0.20,   -- 32nds lost per 1,000 mi on the drive (rear) axle
  wear_free_per_1000mi numeric not null default 0.12,    -- ... on the front axle
  tire_vendor text not null default 'Costco Culver City',
  costco_waitwhile text not null default 'https://waitwhile.com/locations/costcotire-00479',
  min_gap_hours numeric not null default 24,             -- a booking must clear the next trip by this much
  appointment_hours numeric not null default 3,
  updated_at timestamptz not null default now()
);
insert into public.fleet_maint_settings (id) values (true) on conflict do nothing;

alter table public.turo_reviews enable row level security;
alter table public.turo_host_stats enable row level security;
alter table public.turo_allstar_rules enable row level security;
alter table public.turo_guest_ratings enable row level security;
alter table public.fleet_maintenance enable row level security;
alter table public.fleet_maint_events enable row level security;
alter table public.reputation_settings enable row level security;
alter table public.fleet_maint_settings enable row level security;

-- ------------------------------------------------------------------ All-Star rules (looked up 2026-10-07, not guessed)
-- Sources: Turo Help "All-Star Host program" + the host's own Performance page (turo.com/us/en/business/performance).
-- NOTE the two disagree on the window: help says the preceding 365 days at the quarterly assessment; the Performance page
-- shows the program "refreshed" with metrics reset and a 1/1/26 - 12/31/26 window. The Performance numbers are what Turo
-- shows him, so the coach uses those, and says which window it is reading.
insert into public.turo_allstar_rules (metric, label, op, threshold, unit, note, source_url) values
 ('five_star', 'Five-star rate', '>=', 85, '%', 'All completed trips, unrated trips count as NOT five-star.', 'https://help.turo.com/en_us/all-star-host-program-r18TBExV5.md'),
 ('maintenance', 'Maintenance rate', '>=', 80, '%', 'Guest skips the category but gives 5 stars overall = counts as 5 (since Oct 8, 2024).', 'https://help.turo.com/en_us/all-star-host-program-r18TBExV5.md'),
 ('cleanliness', 'Cleanliness rate', '>=', 80, '%', 'Same auto-5 rule as maintenance.', 'https://help.turo.com/en_us/all-star-host-program-r18TBExV5.md'),
 ('cancellation', 'Cancellation rate', '<=', 3, '%', 'Host cancellations over all trips. Never host-cancel.', 'https://help.turo.com/en_us/all-star-host-program-r18TBExV5.md'),
 ('trips', 'Completed trips', '>=', 20, 'trips', '20 completed trips, or 80 trip days across 5 trips. Open account with no active policy violations.', 'https://help.turo.com/en_us/all-star-host-program-r18TBExV5.md'),
 ('assessment', 'Assessment', '>=', 1, 'quarterly', 'Assessed once a quarter (mid Jan / Apr / Jul / Oct). Status holds for the whole quarter even if numbers dip after. Performance page shows next assessment Oct 15, 2026 and window 1/1/26 - 12/31/26.', 'https://turo.com/us/en/business/performance')
on conflict (metric) do update set label = excluded.label, op = excluded.op, threshold = excluded.threshold, unit = excluded.unit,
  note = excluded.note, source_url = excluded.source_url, checked_at = now();

-- ------------------------------------------------------------------ notifications signed by the employee
-- Jared (2026-10-06, Stella/Mae plan): only an under-5 review, All-Star at risk, maintenance due with a bookable gap, or a guest-rating
-- draft interrupts. Those four set autonomy.allow for this one call (his explicit decision); everything else is held for the 7 PM recap.
create or replace function public.rep_notify(p_agent text, p_title text, p_body text default null, p_kind text default 'recap',
  p_url text default 'https://bestly.tech/admin/turo?tab=reviews', p_dedupe text default null) returns text
language plpgsql security definer set search_path to 'public' as $$
declare v text; v_name text := case p_agent when 'mae' then 'Mae' else 'Stella' end;
  v_title text := v_name || ': ' || left(p_title, 170);
  v_key text := coalesce(nullif(p_dedupe, ''), md5(lower(v_title || '|' || coalesce(p_body, ''))));
begin
  if p_kind in ('under5', 'allstar_risk', 'maint_due', 'guest_rating_ready') then
    perform set_config('autonomy.allow', '1', true);
    v := notify_route(v_title, coalesce(p_body, ''), 'time-sensitive', v_name, p_url, null, v_key, null, null, false, now());
  else
    insert into autonomy_held (title, body, source, level) values (left(v_title, 200), left(coalesce(p_body, ''), 500), v_name, 'active');
    begin
      insert into admin_notifications (kind, title, body, url, severity, dedupe_key, silent)
      values (p_agent, left(v_title, 200), left(coalesce(p_body, ''), 500), p_url, 'info', v_key, true)
      on conflict (dedupe_key) do nothing;
    exception when others then null; end;
    v := 'held';
  end if;
  return v;
exception when others then
  begin perform admin_notify(p_agent, v_title, p_body, p_url, null, 'warning', v_key); exception when others then null; end;
  return 'bell';
end $$;
revoke all on function public.rep_notify(text, text, text, text, text, text) from anon, authenticated, public;
grant execute on function public.rep_notify(text, text, text, text, text, text) to service_role;

-- ------------------------------------------------------------------ Stella: sync what the reader saw
-- p = array of {guest_first, vehicle, plate, review_date, stars, flags[], text, kind, system_event, respond_available, has_response, response_text}
create or replace function public.rep_sync_reviews(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v_key text; v_id uuid; v_new int := 0; v_upd int := 0; v_res bigint; v_status text; v_flags jsonb; v_trip jsonb; t turo_trips;
  v_date date; v_text text; v_has boolean; v_kind text;
begin
  for r in select * from jsonb_array_elements(p) loop
    v_date := (r->>'review_date')::date; v_text := nullif(btrim(coalesce(r->>'text', '')), ''); v_has := coalesce((r->>'has_response')::boolean, false);
    v_kind := coalesce(r->>'kind', 'review'); v_flags := coalesce(r->'flags', '[]'::jsonb);
    v_key := md5(lower(coalesce(r->>'guest_first', '') || '|' || v_date::text || '|' || coalesce(r->>'vehicle', '') || '|' || left(coalesce(v_text, ''), 80)));
    -- match the trip: same first name, trip ended within 3 days before to 1 day after the review date
    v_res := null; v_trip := null;
    if v_kind = 'review' then
      select * into t from turo_trips x
       where lower(x.guest_first) = lower(r->>'guest_first')
         and (x.ends_at at time zone 'America/Los_Angeles')::date between v_date - 3 and v_date + 1
       order by abs((x.ends_at at time zone 'America/Los_Angeles')::date - v_date) limit 1;
      if found then
        v_res := t.reservation_id;
        v_trip := jsonb_build_object('airport', t.airport_code, 'lax', t.airport_code = 'LAX', 'starts_at', t.starts_at, 'ends_at', t.ends_at,
          'nights', greatest(1, floor(extract(epoch from (t.ends_at - t.starts_at)) / 86400.0)::int), 'pickup_city', t.pickup_city, 'vin', t.vin);
      end if;
    end if;
    select id into v_id from turo_reviews where review_key = v_key;
    if v_id is null then
      v_status := case
        when v_kind = 'system' then 'skipped'
        when v_has then 'posted'                       -- already answered (before Stella)
        when v_text is null or not coalesce((r->>'respond_available')::boolean, false) then 'skipped'   -- Turo only lets you answer written reviews
        else 'new' end;
      insert into turo_reviews (review_key, reservation_id, guest_first, vehicle, plate, review_date, stars, flags, text, kind, system_event,
                                respond_available, has_response, response_text, status, by_agent, trip)
      values (v_key, v_res, r->>'guest_first', r->>'vehicle', r->>'plate', v_date, nullif(r->>'stars', '')::int, v_flags, v_text, v_kind, r->>'system_event',
              coalesce((r->>'respond_available')::boolean, false), v_has, nullif(r->>'response_text', ''), v_status,
              case when v_has then 'earlier reviewer' else 'stella' end, v_trip);
      v_new := v_new + 1;
    else
      update turo_reviews set stars = coalesce(nullif(r->>'stars', '')::int, stars), flags = v_flags, text = coalesce(v_text, text),
             reservation_id = coalesce(reservation_id, v_res), trip = coalesce(trip, v_trip),
             respond_available = coalesce((r->>'respond_available')::boolean, respond_available),
             has_response = v_has or has_response, response_text = coalesce(nullif(r->>'response_text', ''), response_text),
             status = case when (v_has or has_response) and status in ('new', 'redraft', 'auto_ready', 'needs_jared', 'approved') then 'posted' else status end,
             posted_at = case when (v_has or has_response) and status in ('new', 'redraft', 'auto_ready', 'needs_jared', 'approved') then coalesce(posted_at, now()) else posted_at end,
             updated_at = now()
       where id = v_id;
      v_upd := v_upd + 1;
    end if;
  end loop;
  return jsonb_build_object('new', v_new, 'updated', v_upd);
end $$;
revoke all on function public.rep_sync_reviews(jsonb) from anon, authenticated, public;
grant execute on function public.rep_sync_reviews(jsonb) to service_role;

create or replace function public.rep_save_stats(p jsonb) returns bigint
language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint;
begin
  insert into turo_host_stats (avg_rating, pct_5star, ratings, trips_365, unrated_pct, cat, flags, host_cancels_365,
    all_star, all_star_status, next_assessment, window_label, five_star_rate, maintenance_rate, cleanliness_rate, cancellation_rate, completed_trips,
    response_rate, response_time, raw)
  values (nullif(p->>'avg_rating', '')::numeric, nullif(p->>'pct_5star', '')::numeric, nullif(p->>'ratings', '')::int, nullif(p->>'trips_365', '')::int,
    nullif(p->>'unrated_pct', '')::numeric, p->'cat', p->'flags', nullif(p->>'host_cancels_365', '')::int,
    nullif(p->>'all_star', '')::boolean, p->>'all_star_status', p->>'next_assessment', p->>'window_label',
    nullif(p->>'five_star_rate', '')::numeric, nullif(p->>'maintenance_rate', '')::numeric, nullif(p->>'cleanliness_rate', '')::numeric,
    nullif(p->>'cancellation_rate', '')::numeric, nullif(p->>'completed_trips', '')::int, nullif(p->>'response_rate', '')::numeric, p->>'response_time', p)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.rep_save_stats(jsonb) from anon, authenticated, public;
grant execute on function public.rep_save_stats(jsonb) to service_role;

-- ------------------------------------------------------------------ the All-Star coach: the math, shared by the Pi and the page
-- A rate k/N is only shown to one decimal, so find the whole-number N (close to completed trips) that reproduces it.
create or replace function public._rate_nk(p_rate numeric, p_n int) returns jsonb
language plpgsql immutable as $$
declare n int; k int; best jsonb;
begin
  if p_rate is null or p_n is null then return null; end if;
  for n in select g from generate_series(greatest(5, p_n - 15), p_n + 5) g order by abs(g - p_n), g loop
    k := round(p_rate * n / 100.0)::int;
    if round(k * 100.0 / n, 1) = round(p_rate, 1) then return jsonb_build_object('n', n, 'k', k); end if;
  end loop;
  return jsonb_build_object('n', p_n, 'k', round(p_rate * p_n / 100.0)::int, 'approx', true);
end $$;

create or replace function public.allstar_coach() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare s turo_host_stats; m jsonb := '[]'::jsonb; nk jsonb; n int; k int; thr numeric; allowed numeric; need int; v_rate numeric; v_metric text; v_label text;
  v_risk boolean := false; v_lines text[] := '{}'; v_cancel_n int; v_cancel_k int;
begin
  select * into s from turo_host_stats order by taken_at desc limit 1;
  if s.id is null then return jsonb_build_object('has_data', false); end if;
  foreach v_metric in array array['five_star', 'maintenance', 'cleanliness'] loop
    v_rate := case v_metric when 'five_star' then s.five_star_rate when 'maintenance' then s.maintenance_rate else s.cleanliness_rate end;
    select threshold, label into thr, v_label from turo_allstar_rules where metric = v_metric;
    nk := _rate_nk(v_rate, s.completed_trips);
    if nk is null or thr is null then continue; end if;
    n := (nk->>'n')::int; k := (nk->>'k')::int;
    allowed := floor(k * 100.0 / thr - n);                       -- extra trips that are NOT 5-star before the rate falls under the line
    need := case when v_rate >= thr then 0 else ceil((thr * n - 100.0 * k) / (100.0 - thr))::int end;  -- extra 5-star trips to get back to the line
    m := m || jsonb_build_array(jsonb_build_object('metric', v_metric, 'label', v_label, 'rate', v_rate, 'threshold', thr, 'ok', v_rate >= thr,
        'trips_used', n, 'five_star_trips', k, 'misses_allowed', greatest(allowed, 0), 'five_stars_needed', need,
        'at_risk', v_rate >= thr and allowed <= 1));
    if v_rate < thr then
      v_risk := true; v_lines := v_lines || format('%s is %s%%, under the %s%% line: %s more 5-star trips fixes it.', v_label, v_rate, thr, need);
    elsif allowed <= 1 then
      v_risk := true; v_lines := v_lines || format('%s is %s%% (line %s%%): %s more %s trip before it drops under. Every trip needs a 5.', v_label, v_rate, thr,
        case when allowed <= 0 then 'any' else allowed::text end, 'non-5-star');
    end if;
  end loop;
  -- cancellations: host cancels / all trips must stay <= 3%
  select threshold into thr from turo_allstar_rules where metric = 'cancellation';
  if s.cancellation_rate is not null and s.completed_trips is not null then
    v_cancel_n := s.completed_trips + greatest(coalesce(s.host_cancels_365, 1), 1);
    v_cancel_k := greatest(coalesce(s.host_cancels_365, round(s.cancellation_rate * v_cancel_n / 100.0)::int), 0);
    allowed := floor((thr / 100.0 * v_cancel_n - v_cancel_k) / (1 - thr / 100.0));
    m := m || jsonb_build_array(jsonb_build_object('metric', 'cancellation', 'label', 'Cancellation rate', 'rate', s.cancellation_rate, 'threshold', thr,
        'ok', s.cancellation_rate <= thr, 'host_cancels', v_cancel_k, 'cancels_allowed', greatest(allowed, 0), 'at_risk', s.cancellation_rate > thr or allowed <= 0));
    if s.cancellation_rate > thr or allowed <= 0 then
      v_risk := true; v_lines := v_lines || format('Cancellation rate is %s%% (line %s%%): do not host-cancel anything.', s.cancellation_rate, thr);
    end if;
  end if;
  select threshold into thr from turo_allstar_rules where metric = 'trips';
  m := m || jsonb_build_array(jsonb_build_object('metric', 'trips', 'label', 'Completed trips', 'rate', s.completed_trips, 'threshold', thr, 'ok', coalesce(s.completed_trips, 0) >= thr, 'at_risk', false));
  return jsonb_build_object('has_data', true, 'taken_at', s.taken_at, 'all_star', s.all_star, 'status', s.all_star_status, 'next_assessment', s.next_assessment,
    'window', s.window_label, 'metrics', m, 'at_risk', v_risk, 'message', array_to_string(v_lines, ' '));
end $$;
revoke all on function public.allstar_coach() from anon, public;
grant execute on function public.allstar_coach() to authenticated, service_role;

-- ------------------------------------------------------------------ guest ratings (host rates guest): trip end + 10 days; skip if a claim is open
create or replace function public.rep_guest_sync() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare t record; v_open boolean; n_new int := 0; n_skip int := 0; n_due jsonb;
begin
  for t in select * from turo_trips where ends_at < now() and ends_at > now() - interval '14 days' and status not in ('BOOKED', 'IN_PROGRESS') and status not ilike '%CANCEL%' loop
    v_open := exists (select 1 from claim_cases c where c.reservation_id = t.reservation_id and c.status not in ('paid', 'closed'));
    insert into turo_guest_ratings (reservation_id, guest_first, trip_ends_at, deadline, claim_open, status)
    values (t.reservation_id, t.guest_first, t.ends_at, ((t.ends_at at time zone 'America/Los_Angeles')::date + 10), v_open, case when v_open then 'skipped_claim' else 'watching' end)
    on conflict (reservation_id) do nothing;
    if found then n_new := n_new + 1; end if;
  end loop;
  -- a claim opened later also stops the draft; a claim that closed lets it resume
  update turo_guest_ratings g set claim_open = exists (select 1 from claim_cases c where c.reservation_id = g.reservation_id and c.status not in ('paid', 'closed')),
    status = case
      when g.rated then 'rated'
      when exists (select 1 from claim_cases c where c.reservation_id = g.reservation_id and c.status not in ('paid', 'closed')) then 'skipped_claim'
      when g.status = 'skipped_claim' then 'watching' else g.status end,
    updated_at = now()
   where g.status in ('watching', 'skipped_claim', 'draft_ready');
  update turo_guest_ratings set status = 'expired' where status in ('watching', 'draft_ready', 'skipped_claim') and deadline < (now() at time zone 'America/Los_Angeles')::date and not rated;
  select coalesce(jsonb_agg(jsonb_build_object('reservation_id', reservation_id, 'guest_first', guest_first, 'deadline', deadline)), '[]'::jsonb) into n_due
    from turo_guest_ratings where status = 'watching' and not rated and not claim_open and draft is null
      and deadline - 1 <= (now() at time zone 'America/Los_Angeles')::date;      -- 1 day before the deadline (or already inside it)
  return jsonb_build_object('new', n_new, 'need_draft', n_due);
end $$;
revoke all on function public.rep_guest_sync() from anon, authenticated, public;
grant execute on function public.rep_guest_sync() to service_role;

-- ------------------------------------------------------------------ admin RPCs (Reviews tab)
create or replace function public.reputation_admin() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'coach', allstar_coach(),
    'stats', (select to_jsonb(s) from (select * from turo_host_stats order by taken_at desc limit 1) s),
    'series', coalesce((select jsonb_agg(to_jsonb(x) order by x.taken_at) from (select taken_at, five_star_rate, maintenance_rate, cleanliness_rate, avg_rating from turo_host_stats order by taken_at desc limit 40) x), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(r) order by r.metric) from turo_allstar_rules r), '[]'::jsonb),
    'settings', (select to_jsonb(s) from reputation_settings s where id),
    'queue', coalesce((select jsonb_agg(to_jsonb(r) order by (case when r.stars is not null and r.stars < 5 then 0 else 1 end), r.review_date desc)
                from turo_reviews r where r.status in ('new', 'redraft', 'auto_ready', 'needs_jared', 'approved', 'failed') and r.kind = 'review'), '[]'::jsonb),
    'posted', coalesce((select jsonb_agg(to_jsonb(r) order by r.review_date desc) from (select * from turo_reviews where status in ('posted', 'auto_posted') and kind = 'review' and has_response order by review_date desc limit 25) r), '[]'::jsonb),
    'counts', jsonb_build_object('total', (select count(*) from turo_reviews where kind = 'review'), 'with_text', (select count(*) from turo_reviews where kind = 'review' and text is not null),
        'answered', (select count(*) from turo_reviews where kind = 'review' and has_response)),
    'ratings', coalesce((select jsonb_agg(to_jsonb(g) order by g.deadline) from turo_guest_ratings g where g.status in ('watching', 'draft_ready', 'skipped_claim')), '[]'::jsonb),
    'job', (select jsonb_build_object('stella_reviews', (select to_jsonb(j) from pi_jobs j where job = 'stella_reviews'), 'stella_queue', (select to_jsonb(j) from pi_jobs j where job = 'stella_queue'))),
    'reader', (select jsonb_build_object('seen_at', seen_at, 'signed_in', signed_in, 'last_error', last_error) from turo_reader_state where id = 1));
end $$;
revoke all on function public.reputation_admin() from anon, public;
grant execute on function public.reputation_admin() to authenticated;

create or replace function public.review_set(p_id uuid, p_action text, p_text text default null, p_notes text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r turo_reviews;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into r from turo_reviews where id = p_id;
  if r.id is null then raise exception 'review not found'; end if;
  if p_action = 'notes' then
    update turo_reviews set jared_notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now() where id = p_id;
  elsif p_action = 'draft' then          -- Jared edited the words
    update turo_reviews set draft = btrim(p_text), draft_by = 'jared', draft_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'redraft' then        -- Stella rewrites it on the next 10-minute pass, using his notes
    update turo_reviews set status = 'redraft', jared_notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), jared_notes), post_error = null, updated_at = now() where id = p_id;
  elsif p_action = 'approve' then        -- the tap: Stella posts it on the next pass
    if coalesce(btrim(coalesce(p_text, r.draft)), '') = '' then raise exception 'nothing to post'; end if;
    update turo_reviews set draft = btrim(coalesce(p_text, r.draft)), status = 'approved', post_error = null, updated_at = now() where id = p_id;
  elsif p_action = 'skip' then
    update turo_reviews set status = 'skipped', updated_at = now() where id = p_id;
  elsif p_action = 'reopen' then
    update turo_reviews set status = 'needs_jared', post_error = null, updated_at = now() where id = p_id;
  elsif p_action = 'posted_by_hand' then -- he answered it on Turo himself
    update turo_reviews set status = 'posted', has_response = true, posted_at = now(), by_agent = 'jared', updated_at = now() where id = p_id;
  else raise exception 'unknown action %', p_action;
  end if;
  return (select to_jsonb(x) from turo_reviews x where id = p_id);
end $$;
revoke all on function public.review_set(uuid, text, text, text) from anon, public;
grant execute on function public.review_set(uuid, text, text, text) to authenticated;

create or replace function public.rating_set(p_reservation bigint, p_action text, p_text text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_action = 'rated' then
    update turo_guest_ratings set rated = true, rated_at = now(), status = 'rated', updated_at = now() where reservation_id = p_reservation;
  elsif p_action = 'skip' then
    update turo_guest_ratings set status = 'skipped', updated_at = now() where reservation_id = p_reservation;
  elsif p_action = 'draft' then
    update turo_guest_ratings set draft = btrim(p_text), draft_at = now(), status = 'draft_ready', updated_at = now() where reservation_id = p_reservation;
  elsif p_action = 'redraft' then
    update turo_guest_ratings set draft = null, status = 'watching', updated_at = now() where reservation_id = p_reservation;
  else raise exception 'unknown action %', p_action;
  end if;
  return (select to_jsonb(g) from turo_guest_ratings g where reservation_id = p_reservation);
end $$;
revoke all on function public.rating_set(bigint, text, text) from anon, public;
grant execute on function public.rating_set(bigint, text, text) to authenticated;

create or replace function public.reputation_setting_set(p_key text, p_val text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_key = 'auto_post_5star' then update reputation_settings set auto_post_5star = (p_val = 'true'), updated_at = now() where id;
  elsif p_key = 'ask_lax' then update reputation_settings set ask_lax = p_val, updated_at = now() where id;
  elsif p_key = 'ask_home' then update reputation_settings set ask_home = p_val, updated_at = now() where id;
  else raise exception 'unknown setting %', p_key;
  end if;
  return (select to_jsonb(s) from reputation_settings s where id);
end $$;
revoke all on function public.reputation_setting_set(text, text) from anon, public;
grant execute on function public.reputation_setting_set(text, text) to authenticated;

-- ------------------------------------------------------------------ admin RPCs (Maintenance tab)
create or replace function public.maint_admin() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare w car_watch;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into w from car_watch where id = 1;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from fleet_maint_settings s where id),
    'items', coalesce((select jsonb_agg(to_jsonb(m) order by case m.item when 'front_tires' then 1 when 'rear_tires' then 2 else 3 end, m.item) from fleet_maintenance m), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (select * from fleet_maint_events where kind <> 'tpms' order by at desc limit 40) e), '[]'::jsonb),
    'tpms', coalesce((select jsonb_agg(to_jsonb(e) order by e.at) from (select at, value from fleet_maint_events where kind = 'tpms' order by at desc limit 60) e), '[]'::jsonb),
    'car', jsonb_build_object('tires', w.health->'tires', 'odometer', w.health->'odometer', 'at', w.health_at, 'low_psi', w.settings->'tire_low_psi'),
    'trips', coalesce((select jsonb_agg(jsonb_build_object('reservation_id', t.reservation_id, 'guest_first', t.guest_first, 'starts_at', t.starts_at, 'ends_at', t.ends_at, 'status', t.status) order by t.starts_at)
              from turo_trips t where t.ends_at > now() - interval '1 day' and t.starts_at < now() + interval '21 days'), '[]'::jsonb),
    'job', (select to_jsonb(j) from pi_jobs j where job = 'mae_fleet'));
end $$;
revoke all on function public.maint_admin() from anon, public;
grant execute on function public.maint_admin() to authenticated;

-- p_action: tread {front, rear, note} 32nds | done {item, installed_on, miles, vendor} | note {text} | costco_mode {mode} | psi {fl,fr,rl,rr}
create or replace function public.maint_set(p_action text, p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_vin text := '5YJ3E1EAXLF658422'; v_odo numeric; w car_watch;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into w from car_watch where id = 1;
  v_odo := (w.health->>'odometer')::numeric;
  if p_action = 'tread' then
    if p_data ? 'front' and nullif(p_data->>'front', '') is not null then
      update fleet_maintenance set tread_32nds = (p_data->>'front')::numeric, tread_source = 'manual', last_check = now(), updated_at = now() where vin = v_vin and item = 'front_tires';
      insert into fleet_maint_events (vin, kind, item, value, text, by_agent) values (v_vin, 'tread', 'front_tires', jsonb_build_object('tread_32nds', (p_data->>'front')::numeric, 'odometer', v_odo), p_data->>'note', 'jared');
    end if;
    if p_data ? 'rear' and nullif(p_data->>'rear', '') is not null then
      update fleet_maintenance set tread_32nds = (p_data->>'rear')::numeric, tread_source = 'manual', last_check = now(), updated_at = now() where vin = v_vin and item = 'rear_tires';
      insert into fleet_maint_events (vin, kind, item, value, text, by_agent) values (v_vin, 'tread', 'rear_tires', jsonb_build_object('tread_32nds', (p_data->>'rear')::numeric, 'odometer', v_odo), p_data->>'note', 'jared');
    end if;
  elsif p_action = 'done' then
    update fleet_maintenance set installed_on = coalesce((p_data->>'installed_on')::date, current_date), installed_miles = coalesce((p_data->>'miles')::int, v_odo::int),
      vendor = coalesce(p_data->>'vendor', vendor), status = 'ok', tread_32nds = case when item like '%tires' then (select new_32nds from fleet_maint_settings where id) else tread_32nds end,
      tread_source = case when item like '%tires' then 'model' else tread_source end, last_check = now(), updated_at = now(), due_by = null
     where vin = v_vin and item = p_data->>'item';
    insert into fleet_maint_events (vin, kind, item, value, text, by_agent) values (v_vin, 'done', p_data->>'item', p_data, p_data->>'note', 'jared');
  elsif p_action = 'note' then
    insert into fleet_maint_events (vin, kind, item, text, by_agent) values (v_vin, 'note', p_data->>'item', p_data->>'text', 'jared');
  elsif p_action = 'costco_mode' then
    update fleet_maint_settings set costco_mode = p_data->>'mode', updated_at = now() where id;
  else raise exception 'unknown action %', p_action;
  end if;
  return maint_admin();
end $$;
revoke all on function public.maint_set(text, jsonb) from anon, public;
grant execute on function public.maint_set(text, jsonb) to authenticated;

-- ------------------------------------------------------------------ tire facts (Jared, 2026-10-06) + derived mileage baselines
-- Odometer on the two Costco receipts was not in Gmail (only the Dec 11, 2024 4:00 PM Culver City appointment reminder, no receipt).
-- Baselines are DERIVED: the Fleet API odometer on 2026-10-06 (82,585 mi) minus the miles TezLab recorded since each date
-- (45,864 mi since 12/11/24, 20,444 mi since 2/11/26). A tread photo or the receipt overrides them.
insert into public.fleet_maintenance (vin, item, label, installed_on, installed_miles, vendor, receipt_ref, status, tread_source, notes, meta) values
 ('5YJ3E1EAXLF658422', 'front_tires', 'Front tires (Michelin Primacy MXM4, 12/11/24 pair)', '2024-12-11', 36721, 'Costco Culver City', 'receipt 12/11/2024 (not found in email)', 'unknown', 'model',
  'Mounted on the REAR 12/11/24, moved to the FRONT 2/11/26. Odometer at install is derived (82,585 - 45,864), not read from the receipt.',
  '{"segments":[{"axle":"rear","from_miles":36721,"to_miles":62141},{"axle":"front","from_miles":62141}],"baseline":"derived"}'::jsonb),
 ('5YJ3E1EAXLF658422', 'rear_tires', 'Rear tires (Michelin Primacy MXM4, 2/11/26 pair)', '2026-02-11', 62141, 'Costco Culver City', 'receipt 2/11/2026 (not found in email)', 'unknown', 'model',
  'New pair 2/11/26 on the rear (drive axle on this RWD car). Odometer at install is derived (82,585 - 20,444), not read from the receipt.',
  '{"segments":[{"axle":"rear","from_miles":62141}],"baseline":"derived"}'::jsonb),
 ('5YJ3E1EAXLF658422', 'wipers', 'Wiper blades', null, null, null, null, 'unknown', null, 'Install date not known. Tell Mae when they were last changed, or it assumes 12 months and reminds before LA rain season.', '{"life_months":12}'::jsonb),
 ('5YJ3E1EAXLF658422', 'cabin_filter', 'Cabin air filter', null, null, null, null, 'unknown', null, 'Install date not known. Model 3 cabin filter: about 12 months or 15,000 mi.', '{"life_months":12,"life_miles":15000}'::jsonb),
 ('5YJ3E1EAXLF658422', 'washer_fluid', 'Washer fluid', null, null, null, null, 'unknown', null, 'Tesla does not report the level. Mae reminds before rain season.', '{"life_months":6}'::jsonb),
 ('5YJ3E1EAXLF658422', 'brakes', 'Brakes', null, null, null, null, 'ok', null, 'Guest flagged Brakes once in the last 365 days. Mae checks each flag against car data.', '{}'::jsonb)
on conflict (vin, item) do nothing;

-- ------------------------------------------------------------------ jobs + team
insert into public.pi_jobs (job, description, max_gap_min, enabled) values
 ('stella_reviews', 'Stella: reads Turo reviews + Performance (All-Star) on the Pi Turo browser, drafts replies, runs the All-Star coach. 10:03 AM and 6:03 PM.', 1100, true),
 ('stella_queue', 'Stella: every 10 min - redrafts, posts approved replies (auto-post only if switched on), guest-rating deadline watch + drafts.', 40, true),
 ('mae_fleet', 'Mae: hourly - tire wear + TPMS leak watch, guest flag checks, recommendations between trips, Costco booker (dry run).', 150, true)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, enabled = true;

select public.team_onboard($j$[
 {"slug":"stella","name":"Stella","role":"Reputation Manager","reports_to":"turo-reader","dept":"turo","runs_on":"pi","icon":"star","sort":59,
  "schedule":"reviews 10:03 AM and 6:03 PM; queue every 10 min","admin_url":"/admin/turo?tab=reviews",
  "what_it_does":"Reads every Turo review and your Performance page, answers the good ones in your voice, holds anything under 5 stars for your tap, and warns you before your All-Star status is at risk. Drafts the guest ratings you owe, a day before they are due.",
  "pulse":{"src":"pi_job","key":"stella_queue","gap":40,"alert":true,"also":["stella_reviews"],"issues":["stella."]},
  "owns":["stella","turo.review","turo.allstar"]},
 {"slug":"stella-reader","name":"Review Reader","role":"Reads Turo reviews and performance","tool_of":"stella","runs_on":"pi","icon":"book-open","schedule":"10:03 AM and 6:03 PM",
  "what_it_does":"Opens your ratings and performance pages in the Pi's signed-in Turo browser and copies every review, star count and the All-Star numbers into the database.","pulse":{"src":"pi_job","key":"stella_reviews","gap":1100}},
 {"slug":"stella-writer","name":"Reply Writer","role":"Drafts review replies","tool_of":"stella","runs_on":"pi","icon":"pen-line","schedule":"every 10 min",
  "what_it_does":"Writes a 2 to 3 line reply with the trip details, ending Hope to host you again soon. Free AI first. Under 5 stars it waits for your Approve & post.","pulse":{"src":"pi_job","key":"stella_queue","gap":40}},
 {"slug":"stella-coach","name":"All-Star Coach","role":"Watches your All-Star numbers","tool_of":"stella","runs_on":"pi","icon":"line-chart","schedule":"10:03 AM and 6:03 PM",
  "what_it_does":"Compares your five-star, maintenance, cleanliness and cancellation rates to Turo's All-Star lines and warns you with the math before one is at risk.","pulse":{"src":"pi_job","key":"stella_reviews","gap":1100}},
 {"slug":"stella-ratings","name":"Guest Rating Watch","role":"Guest rating deadlines","tool_of":"stella","runs_on":"pi","icon":"clipboard-check","schedule":"every 10 min",
  "what_it_does":"Tracks the 10-day window to rate each guest, drafts a rating the day before it closes, and skips any trip with an open claim.","pulse":{"src":"pi_job","key":"stella_queue","gap":40}},
 {"slug":"mae","name":"Mae","role":"Fleet Maintenance Manager","reports_to":"turo-reader","dept":"turo","runs_on":"pi","icon":"wrench","sort":60,
  "schedule":"every hour","admin_url":"/admin/turo?tab=maintenance",
  "what_it_does":"Keeps Blue Steel's tires, wipers and filters on schedule. Tracks tread from miles driven and your photos, watches tire pressure for slow leaks, checks guest maintenance flags, and tells you what to fix and when there is a gap between trips. Books Costco tire appointments around your trips.",
  "pulse":{"src":"pi_job","key":"mae_fleet","gap":150,"alert":true,"issues":["mae."]},
  "owns":["mae","fleet.maint"]},
 {"slug":"mae-tires","name":"Tire Tracker","role":"Tread and pressure","tool_of":"mae","runs_on":"pi","icon":"activity","schedule":"every hour",
  "what_it_does":"Estimates tread for the front and rear pairs from miles driven since install, corrects it from your tread photos, and watches the four pressures for a tire that keeps dropping.","pulse":{"src":"pi_job","key":"mae_fleet","gap":150}},
 {"slug":"mae-flags","name":"Flag Checker","role":"Guest maintenance flags","tool_of":"mae","runs_on":"pi","icon":"scan-eye","schedule":"every hour",
  "what_it_does":"When a guest flags brakes or something else, checks the car's own data and says whether it looks real or a one-off.","pulse":{"src":"pi_job","key":"mae_fleet","gap":150}},
 {"slug":"mae-costco","name":"Costco Booker","role":"Books tire appointments","tool_of":"mae","runs_on":"pi","icon":"calendar-check","schedule":"when tires are due",
  "what_it_does":"Finds the first Costco Culver City tire slot that clears your next trip by 24 hours. Dry run only until you have seen the first one; it never books over a trip.","pulse":{"src":"pi_job","key":"mae_fleet","gap":150}}
]$j$::jsonb);
