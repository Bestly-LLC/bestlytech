-- Local alerts v2 (Sky Sync), 2026-10-28. Private/internal use only: feeds Jared's home projector wall + /admin Sky map.
-- Applied to project rcqfqhguwpmaarseifqg through the Supabase MCP; this file is the repo record.
-- One category registry (citizen_categories) and one source registry (citizen_sources) are the single definition for BOTH the wall
-- and the admin Sky map: both read the same snapshot JSON (citizen_snapshot_json) and render only what it says (icon, color, label,
-- subtitle, placement, fade). Backward compatible: citizen_ingest keeps its signature; v1 callers (citizen/nws/chp) keep their ping rule.

-- ---------------------------------------------------------------- registries
create table if not exists public.citizen_categories (
  id         text primary key,
  label      text not null,
  color      text not null,
  icon       text not null,                 -- inner SVG markup, 24x24 viewBox, stroke icons (Lucide, ISC)
  ord        int  not null,
  default_on boolean not null default true,
  ttl_min    int  not null default 120,     -- non-persistent items fade out between 75% and 100% of this age
  ping_rule  text
);
alter table public.citizen_categories enable row level security;
revoke all on public.citizen_categories from anon, authenticated;

insert into public.citizen_categories (id, label, color, icon, ord, ttl_min, ping_rule) values
 ('fire_medical','Fire & medical','#FF453A','<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',10,120,'new within 0.25 mi'),
 ('police','Police','#0A84FF','<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',20,90,'set by the feed (police helicopter circling, scanner)'),
 ('sheriff_city','Sheriff & city','#64D2FF','<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',30,360,'urgent notice or within 0.5 mi'),
 ('earthquake','Earthquakes','#BF5AF2','<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',40,180,'M3.5+ within 50 mi, or M5+ within 150 mi'),
 ('wildfire','Wildfire & smoke','#FF9F0A','<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',50,240,'fire within 10 mi, or AQI over 150 at home'),
 ('power','Power outages','#FFD60A','<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',60,240,'show only'),
 ('closures','Closures & events','#FF375F','<path d="M16.05 10.966a5 2.5 0 0 1-8.1 0"/><path d="m16.923 14.049 4.48 2.04a1 1 0 0 1 .001 1.831l-8.574 3.9a2 2 0 0 1-1.66 0l-8.574-3.91a1 1 0 0 1 0-1.83l4.484-2.04"/><path d="M16.949 14.14a5 2.5 0 1 1-9.9 0L10.063 3.5a2 2 0 0 1 3.874 0z"/><path d="M9.194 6.57a5 2.5 0 0 0 5.61 0"/>',70,1440,'real conflict with a Turo pickup/return or Blue Steel''s spot in the next 24 hr'),
 ('transit','Metro','#30D158','<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',80,240,'only while Blue Steel is out on a Turo trip'),
 ('weather','Weather alerts','#7D7AFF','<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>',90,240,'severe or extreme'),
 ('traffic','Traffic (CHP)','#AC8E68','<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',100,120,'new within 0.25 mi')
on conflict (id) do update set label = excluded.label, color = excluded.color, icon = excluded.icon, ord = excluded.ord,
  ttl_min = excluded.ttl_min, ping_rule = excluded.ping_rule;

create table if not exists public.citizen_sources (
  source     text primary key,
  category   text not null references public.citizen_categories(id),
  label      text not null,
  every_s    int  not null default 120,     -- how often the collector polls
  stale_s    int  not null default 600,     -- no good poll for this long = source is down (Sky Sync alerts, toggle goes quiet)
  max_ft     int  not null default 5280,    -- items farther than this from home are dropped
  persistent boolean not null default false, -- shown for as long as the source keeps listing it
  active     boolean not null default true,  -- false = not running (blocked / not set up); excluded from health
  internal_only boolean not null default true,
  note       text
);
alter table public.citizen_sources enable row level security;
revoke all on public.citizen_sources from anon, authenticated;

insert into public.citizen_sources (source, category, label, every_s, stale_s, max_ft, persistent, active, note) values
 ('citizen',  'fire_medical', 'Citizen (gone, HTTP 410)',            3600, 14400,  5280, false, false, 'Endpoint removed Oct 28 2026; tolerant adapter retries hourly'),
 ('nws',      'weather',      'NWS alerts',                           300,   900,   5280, true,  true,  'Official api.weather.gov'),
 ('chp',      'traffic',      'CHP incidents',                        120,   600,   5280, false, true,  'Official CHP CAD XML'),
 ('lafd',     'fire_medical', 'LAFD alerts',                          300,  1500,   7920, false, true,  'Official lafd.org/alerts (major incidents)'),
 ('pulsepoint','fire_medical','PulsePoint (blocked by bot wall)',     180,   900,   5280, false, false, 'api.pulsepoint.org sits behind an AWS WAF challenge that refuses non-browser and headless clients; not bypassed'),
 ('nixle',    'sheriff_city', 'Sheriff West Hollywood (Nixle)',       600,  2400,  15840, false, true,  'Public agency page on local.nixle.com'),
 ('wehocity', 'sheriff_city', 'City of West Hollywood alerts',        600,  7200,  15840, false, false, 'weho.org blocks scripts; needs an email subscription that Hermes can read'),
 ('usgs',     'earthquake',   'USGS earthquakes',                     300,   900, 792000, false, true,  'Official USGS GeoJSON'),
 ('calfire',  'wildfire',     'CAL FIRE incidents',                   600,  1800, 132000, true,  true,  'Official incidents.fire.ca.gov'),
 ('aqi',      'wildfire',     'Air quality at home',                  600,  1800,      0, false, true,  'Open-Meteo US AQI (same source as the wall air widget)'),
 ('sce',      'power',        'SCE outages',                          300,  1200,  15840, true,  true,  'Unofficial: SCE outage map ArcGIS layer; internal only'),
 ('closures', 'closures',     'Closures and events',                  600,  2400,  26400, true,  true,  'Caltrans lane closures (official) + West Hollywood events'),
 ('metro',    'transit',      'LA Metro service alerts',              300,  1200,   7920, true,  false, 'Official GTFS-RT alerts need a free Swiftly/Metro API key (Vault: lametro_api_key)'),
 ('heli',     'police',       'Police helicopter',                     60,   600,   7920, false, true,  'Agent B: news-chopper-watch'),
 ('scanner',  'police',       'Scanner AI',                            60,   900,   7920, false, true,  'Agent B: LAPD West dispatch transcripts')
on conflict (source) do update set category = excluded.category, label = excluded.label, every_s = excluded.every_s, stale_s = excluded.stale_s,
  max_ft = excluded.max_ft, persistent = excluded.persistent, note = excluded.note;
-- 'active' is operational state: only set on first insert (adapters flip it when they go live)

-- ---------------------------------------------------------------- incidents: new columns
alter table public.citizen_incidents drop constraint if exists citizen_incidents_source_check;
alter table public.citizen_incidents
  add column if not exists category   text,
  add column if not exists sub        text,
  add column if not exists place      text not null default 'point',
  add column if not exists persistent boolean not null default false,
  add column if not exists ttl_min    int,
  add column if not exists expires_at timestamptz,
  add column if not exists meta       jsonb not null default '{}'::jsonb;
update public.citizen_incidents set category = case source when 'chp' then 'traffic' when 'nws' then 'weather' else 'fire_medical' end where category is null;
update public.citizen_incidents set place = 'ring', persistent = true where source = 'nws';
alter table public.citizen_incidents alter column category set not null;
alter table public.citizen_feed_state add column if not exists note text;

-- ---------------------------------------------------------------- helpers
create or replace function public.citizen_dist_text(p_ft integer)
returns text language sql immutable set search_path = public as $$
  select case when p_ft < 1000 then (round(p_ft / 10.0) * 10)::int::text || chr(160) || 'ft'
              when p_ft < 52800 then to_char(round(p_ft / 528.0) / 10.0, 'FM0.0') || chr(160) || 'mi'
              else round(p_ft / 5280.0)::int::text || chr(160) || 'mi' end $$;

create or replace function public.citizen_dir(p_lat double precision, p_lng double precision)
returns text language sql immutable set search_path = public as $$
  select (array['N','NE','E','SE','S','SW','W','NW'])[1 + (round(
    ((degrees(atan2((p_lng + 118.3698) * cos(radians(34.0835)), (p_lat - 34.0835))) + 360)::numeric % 360) / 45))::int % 8] $$;

create or replace function public.citizen_t12(p_at timestamptz)
returns text language sql immutable set search_path = public as $$
  select to_char(p_at at time zone 'America/Los_Angeles', 'FMHH12:MI') || chr(160) || to_char(p_at at time zone 'America/Los_Angeles', 'AM') $$;

-- ---------------------------------------------------------------- ingest (same signature as v1)
create or replace function public.citizen_ingest(
  p_token text, p_source text, p_ok boolean, p_error text default null,
  p_items jsonb default '[]'::jsonb, p_next_try timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_key text; v_lat double precision; v_lng double precision; v_ft int; v_level text; v_sev smallint;
  v_occ timestamptz; v_ins boolean; v_title text; v_short text; v_addr text; v_ups jsonb; v_cat text; v_place text; v_sub text;
  v_pers boolean; v_ttl int; v_exp timestamptz; v_meta jsonb; v_flag boolean; v_force boolean; v_old boolean;
  v_new text[] := '{}'; v_pinged text[] := '{}'; v_pid bigint; v_txt text; v_sevtxt text; v_area boolean; v_src citizen_sources;
  v_ctgy citizen_categories;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if p_source <> 'collector' then
    select * into v_src from citizen_sources where source = p_source;
    if v_src.source is null then raise exception 'bad source'; end if;
  end if;
  insert into citizen_feed_state(source) values (p_source) on conflict do nothing;
  if not p_ok then
    update citizen_feed_state set
      fail_count = fail_count + 1, last_try_at = now(), next_try_at = p_next_try, last_error = left(coalesce(p_error, 'failed'), 200),
      status = case when coalesce(p_error, '') like 'gone%' then 'gone' when coalesce(p_error, '') like 'setup%' then 'setup'
                    when fail_count + 1 >= 3 then 'failing' else 'degraded' end,
      updated_at = now()
     where source = p_source;
    return jsonb_build_object('ok', true, 'recorded', 'failure');
  end if;
  update citizen_feed_state set status = 'ok', fail_count = 0, ok_at = now(), last_try_at = now(), next_try_at = p_next_try,
    last_error = null, updated_at = now() where source = p_source;
  if p_source = 'collector' then return jsonb_build_object('ok', true); end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'items must be an array'; end if;
  if jsonb_array_length(p_items) > 300 then raise exception 'too many items'; end if;
  v_old := p_source in ('citizen', 'chp', 'nws');       -- v1 ping rule: new, within 0.25 mi

  for it in select value from jsonb_array_elements(p_items) loop
    begin
      v_key := p_source || ':' || left(regexp_replace(coalesce(it->>'key', ''), '[^A-Za-z0-9_.:-]', '', 'g'), 80);
      if v_key = p_source || ':' then continue; end if;
      v_cat := coalesce(nullif(it->>'category', ''), v_src.category);
      select * into v_ctgy from citizen_categories where id = v_cat;
      if v_ctgy.id is null then v_cat := v_src.category; select * into v_ctgy from citizen_categories where id = v_cat; end if;
      v_place := case when it->>'place' in ('point', 'ring', 'note') then it->>'place'
                      when coalesce((it->>'area')::boolean, false) then 'ring' else 'point' end;
      v_area := v_place = 'ring';
      v_lat := nullif(it->>'lat', '')::double precision; v_lng := nullif(it->>'lng', '')::double precision;
      if v_lat is null or v_lng is null then
        if v_place = 'point' then continue; end if;
        v_lat := 34.0835; v_lng := -118.3698;
      end if;
      if v_lat not between -90 and 90 or v_lng not between -180 and 180 then continue; end if;
      v_ft := case when v_area then 0 else citizen_dist_ft(v_lat, v_lng) end;
      if v_ft > v_src.max_ft and not (v_area or v_place = 'note') then continue; end if;
      v_level := case when it->>'level' in ('low','moderate','high','critical') then it->>'level' else 'low' end;
      v_sev := case v_level when 'critical' then 3 when 'high' then 2 when 'moderate' then 1 else 0 end;
      v_pers := coalesce((it->>'persistent')::boolean, v_src.persistent);
      v_ttl := coalesce(nullif(it->>'ttl_min', '')::int, v_ctgy.ttl_min);
      v_occ := case when (it->>'occurred_ms') ~ '^[0-9]{10,14}$' then to_timestamp((it->>'occurred_ms')::double precision / 1000) else now() end;
      if v_occ > now() + interval '5 minutes' then v_occ := now(); end if;
      if not v_pers and v_occ < now() - make_interval(mins => v_ttl) then continue; end if;
      v_exp := case when (it->>'expires_ms') ~ '^[0-9]{10,14}$' then to_timestamp((it->>'expires_ms')::double precision / 1000) end;
      v_title := left(coalesce(nullif(it->>'title', ''), 'Incident'), 90);
      v_short := left(coalesce(nullif(it->>'short', ''), v_title), 34);
      v_addr  := left(coalesce(it->>'address', ''), 120);
      v_sub := nullif(left(coalesce(it->>'sub', ''), 40), '');
      if v_sub is null then
        v_sub := case when v_area then 'Area alert' || chr(160) || '·' || chr(160) || citizen_t12(v_occ)
                      when v_place = 'note' and v_ft = 0 then citizen_t12(v_occ)
                      else citizen_dist_text(v_ft) || case when v_ft >= 5280 then chr(160) || citizen_dir(v_lat, v_lng) else '' end
                           || chr(160) || '·' || chr(160) || citizen_t12(v_occ) end;
      end if;
      v_meta := case when jsonb_typeof(it->'meta') = 'object' then it->'meta' else '{}'::jsonb end;
      v_ups   := case when jsonb_typeof(it->'updates') = 'array' then
                   (select coalesce(jsonb_agg(jsonb_build_object('t', u->'t', 'text', left(coalesce(u->>'text', ''), 160))), '[]'::jsonb)
                      from (select u from jsonb_array_elements(it->'updates') u limit 12) q)
                 else '[]'::jsonb end;
      insert into citizen_incidents(key, title, short, lat, lng, address, level, severity, first_seen, updated_at, last_seen, updates, source, dist_ft,
                                    category, sub, place, persistent, ttl_min, expires_at, meta)
      values (v_key, v_title, v_short, v_lat, v_lng, v_addr, v_level, v_sev, v_occ, now(), now(), v_ups, p_source, v_ft,
              v_cat, v_sub, v_place, v_pers, v_ttl, v_exp, v_meta)
      on conflict (key) do update set
        title = excluded.title, short = excluded.short, address = excluded.address, level = excluded.level, severity = excluded.severity,
        category = excluded.category, place = excluded.place, persistent = excluded.persistent, ttl_min = excluded.ttl_min,
        expires_at = excluded.expires_at, meta = excluded.meta,
        sub = case when it ? 'sub' then excluded.sub else citizen_incidents.sub end,
        updated_at = case when excluded.updates is distinct from citizen_incidents.updates or excluded.level <> citizen_incidents.level
                          then now() else citizen_incidents.updated_at end,
        last_seen = now(), updates = excluded.updates, dist_ft = excluded.dist_ft, closed_at = null
      returning (xmax = 0), ping_id into v_ins, v_pid;
      if v_ins then v_new := v_new || v_key; end if;
      -- Ping: ONCE per incident (ping_id is set the first time). Updates never re-ping. An incident may become pingable later
      -- (a conflict appears, a quake is upgraded) if the adapter says so; it still pings only once.
      v_flag := coalesce((it->>'ping')::boolean, v_old);
      v_force := coalesce((it->>'ping_force')::boolean, false);
      if v_pid is null and v_flag and (v_ins or it ? 'ping')
         and (not v_old or v_ft <= 1320)
         and (v_area or v_force or v_occ > now() - interval '20 minutes') then
        v_pid := nextval('citizen_ping_seq');
        update citizen_incidents set ping_id = v_pid, pinged_at = now() where key = v_key;
        v_pinged := v_pinged || v_key;
        v_txt := v_sub || case when v_addr <> '' then ' · ' || v_addr else '' end;
        v_sevtxt := case v_level when 'critical' then 'critical' when 'high' then 'warning' else 'info' end;
        begin
          perform admin_notify('skysync', 'Sky Sync: ' || v_short, v_txt, '/admin/sky', 'sky-sync', v_sevtxt, 'citizen:' || v_key);
        exception when others then raise warning 'citizen bell failed: %', sqlerrm; end;
        begin
          perform push_web_send('Sky Sync: ' || v_short, v_txt, v_sevtxt, '/admin/sky', 'sky-sync-' || left(v_key, 60));
        exception when others then raise warning 'citizen push failed: %', sqlerrm; end;
      end if;
    exception when others then
      raise warning 'citizen_ingest skipped one item: %', sqlerrm;
    end;
  end loop;

  -- anything this source no longer lists (and hasn't been seen for 7 min) has ended
  update citizen_incidents set closed_at = now()
   where source = p_source and closed_at is null and last_seen < now() - interval '7 minutes';
  return jsonb_build_object('ok', true, 'new', to_jsonb(v_new), 'pinged', to_jsonb(v_pinged));
end $$;

-- ---------------------------------------------------------------- snapshot (the ONE payload both the wall and /admin render)
create or replace function public.citizen_snapshot_json()
returns jsonb language sql stable security definer set search_path = public as $$
  with vis as (
    select i.*, c.ttl_min as c_ttl, coalesce(i.ttl_min, c.ttl_min) as ttl
      from citizen_incidents i
      join citizen_sources s on s.source = i.source
      join citizen_categories c on c.id = i.category
     where i.closed_at is null
       and i.last_seen > now() - greatest(interval '12 minutes', (s.every_s * 2.5)::float8 * interval '1 second')
       and (i.expires_at is null or i.expires_at > now())
       and (i.persistent or i.first_seen > now() - make_interval(mins => coalesce(i.ttl_min, c.ttl_min)))
  ), reg as (
    select c.*,
      (select count(*) from vis where vis.category = c.id) as n,
      case when exists (select 1 from citizen_sources s join citizen_feed_state f on f.source = s.source
                         where s.category = c.id and s.active and f.status = 'ok' and f.ok_at > now() - s.stale_s * interval '1 second') then 'ok'
           when exists (select 1 from citizen_sources s join citizen_feed_state f on f.source = s.source
                         where s.category = c.id and f.status = 'setup') then 'setup'
           else 'paused' end as state
    from citizen_categories c
  )
  select jsonb_build_object(
    'at', (extract(epoch from now()) * 1000)::bigint,
    'home', jsonb_build_array(34.0835, -118.3698),
    'rev', 2,
    'hash', (select md5(string_agg(id || '|' || label || '|' || color || '|' || icon || '|' || ord::text || '|' || default_on::text, '~' order by ord)) from citizen_categories),
    'paused', coalesce((select status <> 'ok' from citizen_feed_state where source = 'citizen'), true),
    'citizen', coalesce((select jsonb_build_object('status', status, 'fail_count', fail_count) from citizen_feed_state where source = 'citizen'),
                        jsonb_build_object('status', 'unknown', 'fail_count', 0)),
    'sources', coalesce((select jsonb_object_agg(f.source, jsonb_build_object('status', f.status, 'ok_s', round(extract(epoch from now() - f.ok_at))::int))
                           from citizen_feed_state f where f.source <> 'collector'), '{}'::jsonb),
    'cats', (select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'color', color, 'icon', icon, 'ord', ord,
                                                 'default_on', default_on, 'n', n, 'state', state) order by ord) from reg),
    'ping_max', coalesce((select max(ping_id) from citizen_incidents), 0),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', key, 'cat', category, 'title', title, 'short', short, 'sub', sub, 'lat', lat, 'lng', lng, 'address', address,
        'level', level, 'severity', severity, 'source', source, 'dist_ft', dist_ft, 'place', place,
        'first_seen', (extract(epoch from first_seen) * 1000)::bigint, 'updated_at', (extract(epoch from updated_at) * 1000)::bigint,
        'fade0', case when persistent then null else (extract(epoch from first_seen + make_interval(mins => ttl) * 0.75) * 1000)::bigint end,
        'fade1', case when persistent then null else (extract(epoch from first_seen + make_interval(mins => ttl)) * 1000)::bigint end,
        'ping_id', ping_id, 'pinged_at', case when pinged_at is null then null else (extract(epoch from pinged_at) * 1000)::bigint end,
        'n_updates', jsonb_array_length(updates),
        'last_update', case when jsonb_array_length(updates) > 0 then updates->(jsonb_array_length(updates) - 1)->>'text' end)
        order by severity desc, dist_ft, first_seen desc)
      from (select * from vis order by severity desc, dist_ft, first_seen desc limit 80) vis), '[]'::jsonb)) $$;
revoke all on function public.citizen_snapshot_json() from public, anon, authenticated;

-- ---------------------------------------------------------------- status for Sky Sync (freshness, per source)
create or replace function public.citizen_status(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'at', (extract(epoch from now()) * 1000)::bigint,
    'sources', coalesce((select jsonb_object_agg(f.source, jsonb_build_object(
        'status', f.status, 'fail_count', f.fail_count, 'last_error', f.last_error,
        'ok_age_s', case when f.ok_at is null then null else round(extract(epoch from now() - f.ok_at))::int end,
        'try_age_s', case when f.last_try_at is null then null else round(extract(epoch from now() - f.last_try_at))::int end,
        'next_try_in_s', case when f.next_try_at is null then null else round(extract(epoch from f.next_try_at - now()))::int end,
        'category', s.category, 'label', s.label, 'active', coalesce(s.active, true), 'every_s', s.every_s, 'stale_s', s.stale_s))
        from citizen_feed_state f left join citizen_sources s on s.source = f.source), '{}'::jsonb),
    'configured', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'category', category, 'label', label, 'active', active,
        'every_s', every_s, 'stale_s', stale_s) order by source) from citizen_sources), '[]'::jsonb),
    'open_incidents', (select count(*) from citizen_incidents where closed_at is null and last_seen > now() - interval '12 minutes'));
end $$;

-- The same payload for a token-holder: the parity check (Sky Sync) compares what the wall server cached with what the admin map gets.
create or replace function public.citizen_parity_view(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return citizen_snapshot_json();
end $$;

-- ---------------------------------------------------------------- per-category toggles live in the wall state: alertCats {id: bool}
create or replace function public.wall_clean_toggles(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $function$
declare out jsonb := '{}'::jsonb; k text; r jsonb;
begin
  foreach k in array array['skyStars','skyMoon','skySun','skyPlanets','airLabels','airCard','airCardHeli','airplay','skyStarLabels','skyGrid','presence',
                           'airLabelsSmall','airCardPin','leftDate',
                           'issTag','skyHome','atc','skyLandmarks','skyRoads','skyTraffic',
                           'skyCars','skyCarLabels','skyOverscan','skyTiles','skyAlerts'] loop
    if jsonb_typeof(p->k) = 'boolean' then out := out || jsonb_build_object(k, p->k); end if;
  end loop;
  if jsonb_typeof(p->'alertCats') = 'object' then
    out := out || jsonb_build_object('alertCats', coalesce((select jsonb_object_agg(key, value) from jsonb_each(p->'alertCats')
             where key ~ '^[a-z_]{2,20}$' and jsonb_typeof(value) = 'boolean'), '{}'::jsonb));
  end if;
  if jsonb_typeof(p->'airRadiusMi') = 'number' and (p->>'airRadiusMi')::numeric between 2 and 25 then
    out := out || jsonb_build_object('airRadiusMi', round((p->>'airRadiusMi')::numeric)::int);
  end if;
  if jsonb_typeof(p->'skyTerrain') = 'string' and (p->>'skyTerrain') in ('off','teal','sand','indigo') then
    out := out || jsonb_build_object('skyTerrain', p->>'skyTerrain');
  end if;
  if jsonb_typeof(p->'skyLocal') = 'string' and (p->>'skyLocal') in ('full','fade','raster') then
    out := out || jsonb_build_object('skyLocal', p->>'skyLocal');
  end if;
  if p ? 'radio' then
    r := p->'radio';
    if jsonb_typeof(r) = 'null' then out := out || '{"radio": null}'::jsonb;
    elsif jsonb_typeof(r) = 'object' and coalesce(r->>'url', '') ~ '^https?://[^\s"<>]{3,}$' and length(r->>'url') <= 500 then
      out := out || jsonb_build_object('radio', jsonb_build_object(
        'on', coalesce(case when jsonb_typeof(r->'on') = 'boolean' then (r->>'on')::boolean end, true),
        'name', left(coalesce(r->>'name', 'Radio'), 60),
        'url', r->>'url',
        'favicon', case when coalesce(r->>'favicon', '') ~ '^https?://[^\s"<>]{3,}$' and length(r->>'favicon') <= 500 then r->>'favicon' end,
        'ts', case when jsonb_typeof(r->'ts') = 'number' then r->'ts' else to_jsonb((extract(epoch from now()) * 1000)::bigint) end));
    elsif jsonb_typeof(r) = 'object' and jsonb_typeof(r->'on') = 'boolean' and not (r->>'on')::boolean then
      out := out || jsonb_build_object('radio', jsonb_build_object('on', false, 'name', left(coalesce(r->>'name', ''), 60), 'url', null, 'favicon', null,
        'ts', case when jsonb_typeof(r->'ts') = 'number' then r->'ts' else to_jsonb((extract(epoch from now()) * 1000)::bigint) end));
    end if;
  end if;
  if (out->'radio'->>'on') = 'true' then
    out := out || '{"atc": false}'::jsonb;
  elsif (out->>'atc') = 'true' and not (out ? 'radio') then
    out := out || jsonb_build_object('radio', jsonb_build_object('on', false, 'name', '', 'url', null, 'favicon', null,
      'ts', to_jsonb((extract(epoch from now()) * 1000)::bigint)));
  end if;
  return out;
end $function$;

grant execute on function public.citizen_ingest(text, text, boolean, text, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.wall_citizen_snapshot(text) to anon, authenticated;
grant execute on function public.citizen_status(text) to anon, authenticated;
grant execute on function public.citizen_parity_view(text) to anon, authenticated;
