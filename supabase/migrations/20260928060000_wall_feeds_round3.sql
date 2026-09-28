-- Wall round 3 (W3): data feeds for the strip widgets, the new-Turo-booking event, sign-wall reset + emoji cleanup.
-- Plan: docs/wall-round3-2026-09-27-opusplan.md (W3 + the wall_pi_feeds contract).
--
-- Feeds live in wall_feeds (one row per kind). Who fills what:
--   edge fn wall-feeds (cron wall-feeds-tick, every 30 min): news, air, deliveries, leo, mail wording
--   SQL wall_feeds_refresh() (cron wall-feeds-refresh, every 5 min): turo, energy, mail bullets
--   Pi /opt/bestly/feeds (systemd timer, every 30 min): USPS digest pieces (IMAP + OCR) -> wall_pi_mail_put, habits -> wall_pi_feed_put
--   Mac mini ~/.bestly/wall-feeds/appstore.py (launchd, every 2 h): appstore -> wall_pi_feed_put
-- Watchdog: wall_feeds_watch() (cron wall-feeds-watch, every 10 min) -> Scout incident wall.feeds.<kind>.

/* ───────────────────────── tables ───────────────────────── */

create table if not exists public.wall_feeds (
  kind          text primary key,
  data          jsonb,
  at            timestamptz,               -- last good refresh
  error         text,
  error_at      timestamptz,
  interval_min  int not null default 30,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.wall_feeds enable row level security;
revoke all on public.wall_feeds from anon, authenticated;

insert into public.wall_feeds (kind, interval_min) values
  ('news', 30), ('mail', 30), ('deliveries', 30), ('appstore', 120), ('turo', 30),
  ('air', 30), ('energy', 5), ('habits', 30), ('leo', 1440)
on conflict (kind) do nothing;

-- USPS Informed Delivery mail pieces. ocr = the scan's text, only until the free AI turns it into a short
-- summary ("DMV letter"); then ocr is nulled. Images are never stored.
create table if not exists public.wall_mail_pieces (
  key            text primary key,          -- <digest message-id>#<n>
  day            date not null,             -- the digest's delivery day (LA)
  kind           text not null default 'mail',
  ocr            text,
  summary        text,
  created_at     timestamptz not null default now(),
  summarized_at  timestamptz
);
create index if not exists wall_mail_pieces_day on public.wall_mail_pieces (day);
alter table public.wall_mail_pieces enable row level security;
revoke all on public.wall_mail_pieces from anon, authenticated;

-- Backup of every signature / emoji removed by the admin (reset, delete, hide-with-emoji). Restorable.
create table if not exists public.wall_signatures_archive (
  archive_id   bigserial primary key,
  kind         text not null check (kind in ('signature', 'emoji')),
  orig_id      bigint not null,
  row          jsonb not null,
  reason       text,
  archived_at  timestamptz not null default now(),
  restored_at  timestamptz
);
alter table public.wall_signatures_archive enable row level security;
revoke all on public.wall_signatures_archive from anon, authenticated;

/* ───────────────────────── feed plumbing ───────────────────────── */

create or replace function public.wall_feed_set(p_kind text, p_data jsonb, p_error text default null, p_meta jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into wall_feeds (kind) values (p_kind) on conflict (kind) do nothing;
  if p_error is null then
    update wall_feeds set data = p_data, at = now(), error = null, error_at = null,
           meta = case when p_meta is null then meta else meta || p_meta end, updated_at = now()
     where kind = p_kind;
  else
    update wall_feeds set error = left(p_error, 500), error_at = now(),
           meta = case when p_meta is null then meta else meta || p_meta end, updated_at = now()
     where kind = p_kind;
  end if;
end $$;
revoke execute on function public.wall_feed_set(text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.wall_feed_set(text, jsonb, text, jsonb) to service_role;

-- Pi / Mac agents post the feeds only they can reach (Home Assistant, App Store Connect key on the Mac).
create or replace function public.wall_pi_feed_put(p_token text, p_kind text, p_data jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if p_kind not in ('habits', 'appstore') then raise exception 'unknown feed'; end if;
  if pg_column_size(p_data) > 20000 then raise exception 'too big'; end if;
  perform wall_feed_set(p_kind, p_data, p_error);
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.wall_pi_feed_put(text, text, jsonb, text) from public;
grant execute on function public.wall_pi_feed_put(text, text, jsonb, text) to anon, authenticated, service_role;

/* ───────────────────────── mail (USPS Informed Delivery) ───────────────────────── */

-- Bullets for the rolling 7 days: a piece that came Tuesday stays through the next Monday.
create or replace function public.wall_feeds_build_mail() returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Los_Angeles')::date; since date := today - 6;
        digests jsonb; cnt int; bullets jsonb; n_today int; out jsonb;
begin
  select coalesce(meta->'digests', '{}'::jsonb) into digests from wall_feeds where kind = 'mail';
  -- piece count: the digest's own number (it counts pieces USPS didn't photograph too), else the photos we have
  select coalesce(sum(greatest(coalesce((v->>'mailpieces')::int, 0),
                   (select count(*) from wall_mail_pieces p where p.day = d.key::date and p.kind = 'mail'))), 0)
    into cnt from jsonb_each(digests) d(key, v) where d.key::date >= since;
  cnt := greatest(cnt, (select count(*) from wall_mail_pieces where day >= since and kind = 'mail'));
  select coalesce((digests->today::text->>'mailpieces')::int, (select count(*) from wall_mail_pieces where day = today and kind = 'mail'))
    into n_today;
  -- one bullet per piece, newest first; same sender twice in the window -> "×2"
  select coalesce(jsonb_agg(b order by last_day desc), '[]'::jsonb) into bullets from (
    select case when count(*) > 1 then s || ' ×' || count(*) else s end
             || ' · ' || to_char(max(day), 'Dy') as b, max(day) as last_day
      from (select day, coalesce(nullif(summary, ''), 'Letter') as s from wall_mail_pieces
             where day >= since and kind = 'mail') x
     group by s
     order by max(day) desc limit 8) q;
  out := jsonb_build_object('bullets', bullets, 'count', cnt, 'today', coalesce(n_today, 0), 'since', since,
                            'pending', (select count(*) from wall_mail_pieces where day >= since and summary is null));
  return out;
end $$;
revoke execute on function public.wall_feeds_build_mail() from public, anon, authenticated;

-- The Pi posts each digest: {key, day, mailpieces, packages, pieces:[{n, ocr}], parcels:[{from, eta, status}]}.
create or replace function public.wall_pi_mail_put(p_token text, p_digests jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb; p jsonb; dg jsonb; n int := 0; parcels jsonb := '[]'::jsonb;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if p_error is not null then perform wall_feed_set('mail', null, p_error); return jsonb_build_object('ok', true); end if;
  if jsonb_typeof(p_digests) <> 'array' or jsonb_array_length(p_digests) > 20 then raise exception 'bad digests'; end if;
  select coalesce(meta->'digests', '{}'::jsonb) into dg from wall_feeds where kind = 'mail';
  for d in select * from jsonb_array_elements(p_digests) loop
    dg := dg || jsonb_build_object(d->>'day', jsonb_build_object('mailpieces', (d->>'mailpieces')::int, 'packages', (d->>'packages')::int));
    for p in select * from jsonb_array_elements(coalesce(d->'pieces', '[]'::jsonb)) loop
      insert into wall_mail_pieces (key, day, ocr) values (left(d->>'key', 200) || '#' || (p->>'n'), (d->>'day')::date, left(p->>'ocr', 1500))
      on conflict (key) do nothing;
      n := n + 1;
    end loop;
    if jsonb_typeof(d->'parcels') = 'array' then parcels := parcels || (d->'parcels'); end if;
  end loop;
  -- keep 10 days of digest counts
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into dg from jsonb_each(dg) e(k, v)
   where k::date >= (now() at time zone 'America/Los_Angeles')::date - 10;
  delete from wall_mail_pieces where day < (now() at time zone 'America/Los_Angeles')::date - 10;
  update wall_feeds set meta = meta || jsonb_build_object('digests', dg, 'usps_parcels', parcels, 'pi_at', now()) where kind = 'mail';
  perform wall_feed_set('mail', wall_feeds_build_mail());
  return jsonb_build_object('ok', true, 'pieces', n, 'need_summary', (select count(*) from wall_mail_pieces where summary is null));
end $$;
revoke execute on function public.wall_pi_mail_put(text, jsonb, text) from public;
grant execute on function public.wall_pi_mail_put(text, jsonb, text) to anon, authenticated, service_role;

-- Edge fn wall-feeds reads the pieces that still need wording and writes the summaries (ocr dropped).
create or replace function public.wall_mail_pieces_pending() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'day', day, 'ocr', ocr) order by day), '[]'::jsonb)
    from (select * from wall_mail_pieces where summary is null and ocr is not null order by day desc limit 12) q
$$;
create or replace function public.wall_mail_pieces_done(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    update wall_mail_pieces set summary = left(nullif(btrim(r->>'summary'), ''), 60), ocr = null, summarized_at = now()
     where key = r->>'key' and summary is null;
    n := n + 1;
  end loop;
  perform wall_feed_set('mail', wall_feeds_build_mail());
  return jsonb_build_object('ok', true, 'n', n);
end $$;
revoke execute on function public.wall_mail_pieces_pending() from public, anon, authenticated;
revoke execute on function public.wall_mail_pieces_done(jsonb) from public, anon, authenticated;
grant execute on function public.wall_mail_pieces_pending() to service_role;
grant execute on function public.wall_mail_pieces_done(jsonb) to service_role;

/* ───────────────────────── turo earnings ───────────────────────── */

create or replace function public.wall_feeds_turo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare tz text := 'America/Los_Angeles';
        d0 timestamptz := date_trunc('day', now() at time zone tz) at time zone tz;               -- LA midnight today
        w0 timestamptz := date_trunc('week', now() at time zone tz) at time zone tz;              -- LA Monday 12 AM
        today numeric; week numeric; last_pay record; unpaid numeric; unpaid_end timestamptz; nxt record;
begin
  -- earnings spread evenly over each trip's hours; today / this week = the hours that fall inside them
  with t as (select earnings, starts_at s, ends_at e from turo_trips
              where earnings is not null and ends_at > starts_at
                and coalesce(status, '') not ilike '%cancel%' and coalesce(status, '') <> 'test')
  select coalesce(sum(earnings * greatest(0, extract(epoch from (least(e, d0 + interval '1 day') - greatest(s, d0)))) / extract(epoch from (e - s))), 0),
         coalesce(sum(earnings * greatest(0, extract(epoch from (least(e, w0 + interval '7 days') - greatest(s, w0)))) / extract(epoch from (e - s))), 0)
    into today, week from t;
  -- last payout Turo emailed ("We've sent your earnings payment of $X")
  select (regexp_match(body_text, 'earnings payment of \$([0-9,]+\.[0-9]{2})'))[1] as amt, sent_at into last_pay
    from bestly_mail where from_addr ilike '%turo.com' and subject ilike '%earnings are on the way%'
   order by sent_at desc limit 1;
  -- next payout (estimate): trips that ended since the last payout; else the next trip to end
  select sum(earnings), max(ends_at) into unpaid, unpaid_end from turo_trips
   where ends_at <= now() and ends_at > coalesce(last_pay.sent_at, now() - interval '7 days') - interval '12 hours'
     and earnings is not null and coalesce(status, '') not ilike '%cancel%' and coalesce(status, '') <> 'test';
  if unpaid is null then
    select earnings, ends_at into nxt from turo_trips
     where ends_at > now() and earnings is not null and coalesce(status, '') not ilike '%cancel%' and coalesce(status, '') <> 'test'
     order by ends_at limit 1;
    unpaid := nxt.earnings; unpaid_end := nxt.ends_at;
  end if;
  return jsonb_build_object(
    'today', round(today, 2), 'week', round(week, 2),
    'next_payout', round(unpaid, 2),
    -- Turo sends payouts about a day after a trip ends (then 1-3 business days to the bank)
    'next_payout_at', case when unpaid_end is not null then greatest(unpaid_end + interval '1 day', now()) end,
    'next_payout_estimate', true,
    'last_payout', case when last_pay.amt is not null then replace(last_pay.amt, ',', '')::numeric end,
    'last_payout_at', last_pay.sent_at);
end $$;
revoke execute on function public.wall_feeds_turo() from public, anon, authenticated;

/* ───────────────────────── energy (estimate) ───────────────────────── */
-- Watts now = projector by mode (Capsule 3 GTV: ~22 W showing the board, ~18 W ambient, ~0.5 W asleep;
-- 52 Wh battery ≈ 2.5 h of video ≈ 21 W) + its charging watts (watchdog health.watts) + Pi 5 (~6 W)
-- + Desk HomePod idle (~1.5 W). Integrated every 5 min. Rate: LADWP R-1A Tier 1, 26.4 ¢/kWh June-Sept,
-- 24.6 ¢/kWh Oct-May (2026 published rates via heliosenergyglobal.com/guides/ladwp-rates-explained, checked 2026-09-27).
create or replace function public.wall_feeds_energy_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare ws wall_state; f wall_feeds; m jsonb; tz text := 'America/Los_Angeles';
        mode text; fresh boolean; w_proj numeric; w_chg numeric; w numeric; rate numeric;
        day text := to_char(now() at time zone tz, 'YYYY-MM-DD'); mon text := to_char(now() at time zone tz, 'YYYY-MM');
        last_at timestamptz; last_w numeric; dt_h numeric; day_wh numeric; mon_wh numeric; out jsonb;
begin
  select * into ws from wall_state where id = 1;
  select * into f from wall_feeds where kind = 'energy';
  m := coalesce(f.meta, '{}'::jsonb);
  fresh := ws.status_at > now() - interval '10 minutes';
  mode := case when not coalesce(fresh, false) then 'off'
               else coalesce(ws.status->>'page_mode', ws.state->>'mode', 'board') end;
  w_proj := case when mode = 'off' then 0.5 when mode = 'ambient' then 18 else 22 end;
  w_chg := case when fresh and coalesce((ws.status->'health'->>'charging')::boolean, false)
                then least(65, greatest(0, coalesce((ws.status->'health'->>'watts')::numeric, 0))) else 0 end;
  w := round(w_proj + w_chg + 6 + 1.5, 1);
  rate := case when extract(month from now() at time zone tz) between 6 and 9 then 26.4 else 24.6 end;
  last_at := (m->>'last_at')::timestamptz; last_w := (m->>'last_w')::numeric;
  -- trapezoid since the last sample; a gap over 20 min counts only 20 min (never invent hours)
  dt_h := case when last_at is null then 0 else least(extract(epoch from (now() - last_at)), 1200) / 3600.0 end;
  day_wh := case when m->>'day' = day then coalesce((m->>'day_wh')::numeric, 0) else 0 end
            + dt_h * (coalesce(last_w, w) + w) / 2;
  mon_wh := case when m->>'month' = mon then coalesce((m->>'month_wh')::numeric, 0) else 0 end
            + dt_h * (coalesce(last_w, w) + w) / 2;
  m := m || jsonb_build_object('day', day, 'day_wh', round(day_wh, 3), 'month', mon, 'month_wh', round(mon_wh, 3),
                               'last_at', now(), 'last_w', w, 'since', coalesce(m->>'since', now()::text));
  out := jsonb_build_object('watts', w, 'rate_c_kwh', rate,
           'today_usd', round(day_wh / 1000 * rate / 100, 2), 'month_usd', round(mon_wh / 1000 * rate / 100, 2),
           'today_kwh', round(day_wh / 1000, 3), 'month_kwh', round(mon_wh / 1000, 3),
           'projector', mode, 'estimate', true, 'since', m->>'since');
  perform wall_feed_set('energy', out, null, m);
  return out;
end $$;
revoke execute on function public.wall_feeds_energy_tick() from public, anon, authenticated;

/* ───────────────────────── refresh (SQL feeds) ───────────────────────── */

create or replace function public.wall_feeds_refresh() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb;
begin
  begin perform wall_feed_set('turo', wall_feeds_turo()); r := r || '{"turo":"ok"}';
  exception when others then perform wall_feed_set('turo', null, sqlerrm); r := r || jsonb_build_object('turo', sqlerrm); end;
  begin perform wall_feeds_energy_tick(); r := r || '{"energy":"ok"}';
  exception when others then perform wall_feed_set('energy', null, sqlerrm); r := r || jsonb_build_object('energy', sqlerrm); end;
  -- rebuild mail bullets so the rolling window rolls over at midnight even if the Pi is quiet
  -- (does not touch "at": freshness of mail = the Pi's last post)
  begin update wall_feeds set data = wall_feeds_build_mail() where kind = 'mail' and data is not null;
  exception when others then null; end;
  return r;
end $$;
revoke execute on function public.wall_feeds_refresh() from public, anon, authenticated;

/* ───────────────────────── the Pi's read ───────────────────────── */

create or replace function public.wall_pi_feeds(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m jsonb;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  -- a part is null when it never loaded, is marked unavailable, or is older than 6x its refresh interval
  select jsonb_object_agg(kind,
           case when data is null or jsonb_typeof(data) = 'null' or data->>'available' = 'false'
                     or at is null or at < now() - make_interval(mins => interval_min * 6) then null else data end)
    into m from wall_feeds;
  return jsonb_build_object(
    'news', m->'news', 'mail', m->'mail', 'deliveries', m->'deliveries', 'appstore', m->'appstore',
    'turo', m->'turo', 'air', m->'air', 'energy', m->'energy', 'habits', m->'habits', 'leo', m->'leo',
    'at', now());
end $$;
revoke execute on function public.wall_pi_feeds(text) from public;
grant execute on function public.wall_pi_feeds(text) to anon, authenticated, service_role;

/* ───────────────────────── watchdog ───────────────────────── */

create or replace function public.wall_feeds_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare f wall_feeds; bad boolean; why text; out jsonb := '{}'::jsonb; kick boolean := false;
        who jsonb := '{"news":"the wall-feeds function","air":"the wall-feeds function","leo":"the wall-feeds function",
                        "deliveries":"the wall-feeds function","turo":"the 5-minute database refresh","energy":"the 5-minute database refresh",
                        "mail":"the Pi mail reader (/opt/bestly/feeds, bestly-wall-feeds.timer)","habits":"the Pi feed reader (bestly-wall-feeds.timer)",
                        "appstore":"the Mac mini App Store check (launchd tech.bestly.wall-appstore)"}';
begin
  for f in select * from wall_feeds loop
    bad := coalesce(f.at, f.created_at) < now() - make_interval(mins => f.interval_min * 3)
           or (f.error is not null and f.error_at > coalesce(f.at, '-infinity') and coalesce(f.at, f.created_at) < now() - make_interval(mins => f.interval_min));
    if bad then
      why := case when f.at is null then 'has not loaded yet' else 'last updated ' || to_char(f.at at time zone 'America/Los_Angeles', 'Mon FMDD FMHH12:MI AM') end;
      perform bestly_raise('wall.feeds.' || f.kind, 'problem', 'warning',
        'Wall ' || f.kind || ' feed is stale',
        'The wall''s ' || f.kind || ' widget ' || why || ' (should refresh every ' || f.interval_min || ' min). Fed by '
          || coalesce(who->>f.kind, 'a feed job') || '.' || coalesce(' Last error: ' || f.error, ''),
        'wall', null, false);
      out := out || jsonb_build_object(f.kind, 'stale');
      if f.kind in ('news', 'air', 'leo', 'deliveries') then kick := true; end if;
      if f.kind in ('turo', 'energy') then perform wall_feeds_refresh(); end if;
    else
      perform bestly_raise('wall.feeds.' || f.kind, 'resolved', 'info', 'Wall ' || f.kind || ' feed is back', null, 'wall');
    end if;
  end loop;
  -- self-heal: re-run the edge function right away instead of waiting for its next half hour
  if kick then perform invoke_edge_function('wall-feeds', '{"op":"tick","why":"watchdog"}'::jsonb, 120000); end if;
  return out;
end $$;
revoke execute on function public.wall_feeds_watch() from public, anon, authenticated;

/* ───────────────────────── new Turo booking -> wall ───────────────────────── */

create or replace function public.wall_turo_booking_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare car text; days int;
begin
  if coalesce(new.status, '') ilike '%cancel%' or coalesce(new.status, '') = 'test' or new.ends_at < now() then return new; end if;
  select coalesce(v.display_name, 'the Tesla') into car from turo_vehicle_state v where v.vin = new.vin;
  days := greatest(1, ceil(extract(epoch from (new.ends_at - new.starts_at)) / 86400.0))::int;
  perform wall_sig_broadcast('turo_booking', jsonb_build_object(
    'id', new.reservation_id, 'guest', new.guest_first, 'car', coalesce(car, 'the Tesla'),
    'starts_at', new.starts_at, 'ends_at', new.ends_at, 'days', days, 'earnings', new.earnings));
  return new;
exception when others then return new;   -- never block Turo ingest
end $$;
drop trigger if exists wall_turo_booking on public.turo_trips;
create trigger wall_turo_booking after insert on public.turo_trips
  for each row execute function public.wall_turo_booking_notify();

-- wall_pi_trips: same as before + new:true for 10 min after a booking first appears (and that trip is
-- included even if it starts after the 36 h window, so the Pi can show the pop-up as a backup to the event).
create or replace function public.wall_pi_trips(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'at', now(),
    'trips', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.reservation_id, 'vin', t.vin, 'guest', t.guest_first,
        'start', t.starts_at, 'end', t.ends_at, 'in_progress', t.in_progress, 'checked_out', t.checked_out,
        'status', t.status, 'airport', t.airport_code, 'address', t.pickup_address, 'city', t.pickup_city,
        'lat', t.pickup_lat, 'lon', t.pickup_lon,
        'extras', coalesce(g.tags->'extras', '[]'::jsonb), 'flags', coalesce(g.tags->'flags', '[]'::jsonb),
        'new', t.first_seen_at > now() - interval '10 minutes',
        'booking', case when t.first_seen_at > now() - interval '10 minutes' then jsonb_build_object(
            'car', coalesce((select v.display_name from turo_vehicle_state v where v.vin = t.vin), 'the Tesla'),
            'days', greatest(1, ceil(extract(epoch from (t.ends_at - t.starts_at)) / 86400.0))::int,
            'earnings', t.earnings) end) order by t.starts_at)
      from turo_trips t
      cross join lateral (select turo_trip_tags(t.reservation_id) as tags) g
      where ((t.ends_at > now() - interval '4 hours' and t.starts_at < now() + interval '36 hours')
             or (t.first_seen_at > now() - interval '10 minutes' and t.ends_at > now()))
        and coalesce(t.status, '') not ilike '%cancel%'), '[]'::jsonb),
    'cars', coalesce((select jsonb_agg(jsonb_build_object(
        'vin', v.vin, 'name', v.display_name, 'lat', v.latitude, 'lon', v.longitude, 'locked', v.locked,
        'online', v.connection_state, 'at', v.observed_at,
        'shift', coalesce(v.raw->'fleet_api'->>'shift_state', v.raw->>'shift_state'),
        'speed', coalesce(v.raw->'fleet_api'->>'speed', v.raw->>'speed')))
      from turo_vehicle_state v), '[]'::jsonb),
    'tesla', (select jsonb_build_object('lat', (raw->>'latitude')::float8, 'lon', (raw->>'longitude')::float8,
        'locked', locked, 'online', online, 'at', observed_at, 'shift', raw->>'shift_state', 'speed', raw->>'speed')
      from tesla_fleet_state where id = 1));
end $function$;

/* ───────────────────────── sign wall: emojis follow their signature ───────────────────────── */

-- The emoji a guest picked belongs to the signature (wall_emojis.signature_id) or, for older rows, to the
-- session that signed it (wall_sign_sessions.emoji_id + signature_ids).
create or replace function public.wall_emoji_drop_for_sig(p_sig bigint, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare e wall_emojis; n int := 0;
begin
  for e in select * from wall_emojis
            where signature_id = p_sig
               or id in (select emoji_id from wall_sign_sessions where emoji_id is not null and p_sig = any(signature_ids)) loop
    insert into wall_signatures_archive (kind, orig_id, row, reason)
    values ('emoji', e.id, to_jsonb(e) || jsonb_build_object('for_signature', p_sig), p_reason);
    delete from wall_emojis where id = e.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.wall_emoji_drop_for_sig(bigint, text) from public, anon, authenticated;

-- Show again -> put its emoji back (if nobody took that emoji meanwhile).
create or replace function public.wall_emoji_restore_for_sig(p_sig bigint) returns int
language plpgsql security definer set search_path = public as $$
declare a wall_signatures_archive; e wall_emojis; n int := 0;
begin
  for a in select * from wall_signatures_archive
            where kind = 'emoji' and restored_at is null and (row->>'for_signature')::bigint = p_sig and reason = 'hide' loop
    e := jsonb_populate_record(null::wall_emojis, a.row);
    if not exists (select 1 from wall_emojis where emoji = e.emoji or emoji_key = e.emoji_key or id = e.id) then
      insert into wall_emojis (id, emoji, emoji_key, x, y, size, created_at, placed_by, signature_id)
      values (e.id, e.emoji, e.emoji_key, e.x, e.y, e.size, e.created_at, e.placed_by,
              case when exists (select 1 from wall_signatures where id = e.signature_id) then e.signature_id end);
      perform wall_emoji_layout(e.id);
      n := n + 1;
    end if;
    update wall_signatures_archive set restored_at = now() where archive_id = a.archive_id;
  end loop;
  return n;
end $$;
revoke execute on function public.wall_emoji_restore_for_sig(bigint) from public, anon, authenticated;

create or replace function public.wall_admin_sign_action(p_action text, p_id bigint default null::bigint)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r public.wall_signatures; pts jsonb; names text[] := array['Maya','Jordan','Sam','Alex','Riley','Taylor','Jamie','Chris'];
        cols text[] := array['#FFD166','#FF6B9A','#7BDFF2','#B8F2E6','#C3A6FF','#FFFFFF','#FF9F6B','#9BF6A1'];
        nm text; seed numeric; emo int := 0; s bigint;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_action = 'hide' then
    update wall_signatures set hidden = true where id = p_id;
    emo := wall_emoji_drop_for_sig(p_id, 'hide');
  elsif p_action = 'show' then
    update wall_signatures set hidden = false where id = p_id;
    emo := wall_emoji_restore_for_sig(p_id);
  elsif p_action = 'delete' then
    emo := wall_emoji_drop_for_sig(p_id, 'delete');
    insert into wall_signatures_archive (kind, orig_id, row, reason)
      select 'signature', id, to_jsonb(ws), 'delete' from wall_signatures ws where id = p_id;
    delete from wall_signatures where id = p_id;
  elsif p_action = 'clear' then
    for s in select id from wall_signatures where not hidden loop emo := emo + wall_emoji_drop_for_sig(s, 'hide'); end loop;
    update wall_signatures set hidden = true where not hidden;
  elsif p_action = 'test' then
    nm := names[1 + floor(random() * array_length(names, 1))::int];
    seed := random() * 6;
    -- a loopy cursive-looking scribble, plus an underline flourish
    select jsonb_agg(v) into pts from (
      select unnest(array[round(60 + g * 8.2)::int,
                          round(470 - 190 * sin(g / 3.1 + seed) * (0.55 + 0.45 * sin(g / 17.0)) + 60 * cos(g / 1.6))::int]) v
        from generate_series(0, 105) g) q;
    insert into wall_signatures (name, strokes, color, aspect, is_test)
    values (nm, jsonb_build_array(pts,
             (select jsonb_agg(v) from (select unnest(array[round(120 + g * 32)::int, round(820 + 30 * sin(g / 3.0))::int]) v from generate_series(0, 24) g) u)),
            cols[1 + floor(random() * array_length(cols, 1))::int], 2.2, true) returning * into r;
    perform wall_sig_broadcast('sign', jsonb_build_object('sig', wall_sig_json(r)));
    return jsonb_build_object('ok', true, 'id', r.id, 'name', nm, 'ping', (select 'wallsign-' || left(md5('wall-' || channel || ':sign'), 20) from wall_state where id = 1));
  else raise exception 'unknown action';
  end if;
  perform wall_sig_broadcast('signs_changed', jsonb_build_object('at', now()));
  if emo > 0 then perform wall_sig_broadcast('emojis_changed', jsonb_build_object('at', now())); end if;
  return jsonb_build_object('ok', true, 'emojis', emo, 'ping', (select 'wallsign-' || left(md5('wall-' || channel || ':sign'), 20) from wall_state where id = 1));
end $function$;

-- Admin list: each signature with its emoji (if any).
create or replace function public.wall_admin_signs()
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(wall_sig_json(s) || jsonb_build_object('emoji',
                      (select e.emoji from wall_emojis e
                        where e.signature_id = s.id
                           or e.id in (select emoji_id from wall_sign_sessions ss where ss.emoji_id is not null and s.id = any(ss.signature_ids))
                        limit 1)) order by s.created_at desc)
                     from (select * from wall_signatures order by created_at desc limit 100) s), '[]'::jsonb);
end $function$;

-- Badge number = how many real (non-test) signatures are on the wall's record up to this one, so the
-- count stays 01, 02, 03... even when test signatures or deleted rows leave gaps in the ids.
create or replace function public.wall_sign_tap(p_token text, p_name text, p_strokes jsonb, p_color text, p_aspect real, p_device text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s wall_sign_sessions; res jsonb;
begin
  select * into s from wall_sign_sessions where token = p_token for update;
  if s.token is null or s.expires_at < now() then raise exception 'tap a coaster again'; end if;
  if coalesce(array_length(s.signature_ids, 1), 0) >= 3 then raise exception 'that''s plenty for one tap'; end if;
  res := wall_sign(p_name, p_strokes, p_color, p_aspect, p_device);
  update wall_sign_sessions set signature_ids = signature_ids || (res->>'id')::bigint where token = p_token;
  return res || jsonb_build_object('badge_no',
    (select count(*) from wall_signatures where not is_test and id <= (res->>'id')::bigint));
end $function$;

-- Reset the wall to one signature (Jared's): everything else + every emoji not his is archived and removed,
-- his signature becomes No. 1 and the id sequence restarts after it.
create or replace function public.wall_sign_reset_keep(p_keep bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k wall_signatures; nsig int; nemo int;
begin
  if not (has_role(auth.uid(), 'admin') or auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin')) then
    raise exception 'admin only'; end if;
  select * into k from wall_signatures where id = p_keep;
  if k.id is null then raise exception 'signature % not found', p_keep; end if;
  insert into wall_signatures_archive (kind, orig_id, row, reason)
    select 'emoji', e.id, to_jsonb(e), 'reset' from wall_emojis e
     where coalesce(e.signature_id, -1) <> p_keep
       and e.id not in (select emoji_id from wall_sign_sessions where emoji_id is not null and p_keep = any(signature_ids));
  get diagnostics nemo = row_count;
  delete from wall_emojis e where coalesce(e.signature_id, -1) <> p_keep
     and e.id not in (select emoji_id from wall_sign_sessions where emoji_id is not null and p_keep = any(signature_ids));
  insert into wall_signatures_archive (kind, orig_id, row, reason)
    select 'signature', id, to_jsonb(ws), 'reset' from wall_signatures ws where id <> p_keep;
  get diagnostics nsig = row_count;
  delete from wall_signatures where id <> p_keep;
  if p_keep <> 1 then
    update wall_emojis set signature_id = null where signature_id = p_keep;
    update wall_signatures set id = 1 where id = p_keep;
    update wall_emojis set signature_id = 1 where signature_id is null and id in
      (select emoji_id from wall_sign_sessions where emoji_id is not null and p_keep = any(signature_ids));
    update wall_sign_sessions set signature_ids = array_replace(signature_ids, p_keep, 1::bigint) where p_keep = any(signature_ids);
  end if;
  perform setval('public.wall_signatures_id_seq', 1, true);   -- next signature = No. 2
  perform wall_sig_broadcast('signs_changed', jsonb_build_object('at', now()));
  perform wall_sig_broadcast('emojis_changed', jsonb_build_object('at', now()));
  return jsonb_build_object('ok', true, 'kept', k.name, 'archived_signatures', nsig, 'archived_emojis', nemo);
end $$;
revoke execute on function public.wall_sign_reset_keep(bigint) from public, anon;
grant execute on function public.wall_sign_reset_keep(bigint) to authenticated, service_role;

/* ───────────────────────── crons ───────────────────────── */

select cron.unschedule(jobname) from cron.job where jobname in ('wall-feeds-refresh', 'wall-feeds-tick', 'wall-feeds-watch');
select cron.schedule('wall-feeds-refresh', '*/5 * * * *', $c$ select public.wall_feeds_refresh() $c$);
select cron.schedule('wall-feeds-tick', '1,31 * * * *', $c$ select public.invoke_edge_function('wall-feeds', '{"op":"tick"}'::jsonb, 120000) $c$);
select cron.schedule('wall-feeds-watch', '7-59/10 * * * *', $c$ select public.wall_feeds_watch() $c$);
