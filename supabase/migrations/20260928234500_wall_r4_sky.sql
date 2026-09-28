-- Wall round 4, W1 (sky + aircraft), 2026-09-28.
-- 1. wall_news_helis: LA TV news helicopters by ICAO hex (the ceiling tag says "KTLA 5 · News", drawn blue).
--    Seeded only with registrations confirmed by a public source; hex = the FAA Mode S code for the N-number
--    (computed from the N-number and cross-checked against adsbdb + the live adsb.lol feed).
-- 2. wall_pi_news_helis(p_token): the Pi reads the table (same agent-token check as wall_pi_trips).
-- 3. wall_clean_r4sky: new state keys homePos {x,y} (0..1 of the sky) and airFocus {hex, until}; chained into wall_admin_set.
-- 4. "Flip the sky" removed: it never did anything (airRot is always set, and airRot wins), and "Wall faces" already
--    turns the map. Key dropped from wall_state and from the geometry-undo key list.

create table if not exists public.wall_news_helis (
  hex        text primary key check (hex ~ '^[0-9a-f]{6}$'),
  reg        text not null,
  station    text not null,
  channel    text,
  notes      text,
  updated_at timestamptz not null default now()
);
alter table public.wall_news_helis enable row level security;
revoke all on public.wall_news_helis from anon, authenticated;

insert into public.wall_news_helis (hex, reg, station, channel, notes) values
  ('acd27a', 'N925TV', 'KTLA', '5',  'Sky5, AS350 B2. Sources: gtla.live (Sky5 N925TV, KTLA news), 2012 FAA accident report N925TV Hollywood.'),
  ('a05388', 'N12YJ',  'KTLA', '5',  'Sky5 backup, AS350 B2 (Helicopters Inc). Source: gtla.live "Sky5 (backup) N12YJ".'),
  ('a97a67', 'N71HD',  'KABC', '7',  'AIR7HD, AS350 B2, Helinet. Sources: gtla.live (AIR7 N71HD KABC), Aviation Safety Network 2019 (Helinet operating as ABC7).'),
  ('a2f3d4', 'N29HD',  'KABC', '7',  'AIR7 backup, AS350 B3, Helinet. Source: gtla.live "AIR7 (backup) N29HD", photo caption "ABC7 (N29HD)".'),
  ('a638f5', 'N50Q',   'FOX 11 / KCAL', '11', 'SkyFOX 11 / SkyCAL, Bell 407, Helicopters Inc (shared news helicopter). Sources: gtla.live, spotter videos "SkyFOX 11 ... N50Q", "FOX & KCAL News N50Q".'),
  ('a480ad', 'N39CL',  'FOX 11 / KCAL', '11', 'SkyCAL / SkyFOX 11, Bell 407, Helicopters Inc. Sources: gtla.live "SkyCAL/SkyFOX 11 N39CL", spotter video "News Helicopter N39CL".'),
  ('ab4ea1', 'N828AP', 'ABC News', null,  'ABC NewsCopter, AS350 B2, Helinet. Source: gtla.live "ABC NewsCopter N828AP".')
on conflict (hex) do update set reg = excluded.reg, station = excluded.station, channel = excluded.channel,
  notes = excluded.notes, updated_at = now();
-- Not seeded: KNBC/KVEA NewsChopper4 N358TV (a40442) was destroyed in the Chatsworth crash on 2026-09-15.

create or replace function public.wall_pi_news_helis(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object('at', now(), 'helis', coalesce((select jsonb_agg(jsonb_build_object(
      'hex', h.hex, 'reg', h.reg, 'station', h.station, 'channel', h.channel) order by h.station, h.reg)
    from wall_news_helis h), '[]'::jsonb));
end $$;

create or replace function public.wall_clean_r4sky(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare out jsonb := '{}'::jsonb; h jsonb; f jsonb;
begin
  -- where "home" sits on the sky, 0..1 of the sky box; null = the middle (the whole sky re-projects around it)
  if p ? 'homePos' then
    h := p->'homePos';
    if jsonb_typeof(h) = 'null' then out := out || '{"homePos": null}'::jsonb;
    elsif jsonb_typeof(h) = 'object' and jsonb_typeof(h->'x') = 'number' and jsonb_typeof(h->'y') = 'number'
          and (h->>'x')::numeric between 0 and 1 and (h->>'y')::numeric between 0 and 1 then
      out := out || jsonb_build_object('homePos', jsonb_build_object('x', round((h->>'x')::numeric, 4), 'y', round((h->>'y')::numeric, 4)));
    end if;
  end if;
  -- aircraft to hold on the sign-wall name tag until "until" (ms since epoch)
  if p ? 'airFocus' then
    f := p->'airFocus';
    if jsonb_typeof(f) = 'null' then out := out || '{"airFocus": null}'::jsonb;
    elsif jsonb_typeof(f) = 'object' and coalesce(f->>'hex', '') ~ '^~?[0-9a-fA-F]{6}$' and jsonb_typeof(f->'until') = 'number'
          and (f->>'until')::numeric between 0 and 99999999999999 then
      out := out || jsonb_build_object('airFocus', jsonb_build_object('hex', lower(f->>'hex'), 'until', round((f->>'until')::numeric)));
    end if;
  end if;
  return out;
end $$;

-- chain it into wall_admin_set without clobbering other workers' cleaners (patch the live definition in place)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.wall_admin_set(jsonb)'::regprocedure);
  if position('wall_clean_r4sky' in d) = 0 then
    if position('|| wall_clean_widgets(coalesce(p_patch, ''{}''::jsonb))' in d) = 0 then
      raise exception 'wall_admin_set anchor not found';
    end if;
    d := replace(d, '|| wall_clean_widgets(coalesce(p_patch, ''{}''::jsonb))',
                    '|| wall_clean_widgets(coalesce(p_patch, ''{}''::jsonb))
                       || wall_clean_r4sky(coalesce(p_patch, ''{}''::jsonb))');
    execute d;
  end if;
end $$;

-- "Flip the sky" is gone (see header)
create or replace function public.wall_geo_keys() returns text[] language sql immutable set search_path to 'public' as
$$ select array['corners','mask','air','wing','airAspect','airRot','airBearing'] $$;
update public.wall_state set state = state - 'airFlip' where id = 1 and state ? 'airFlip';
