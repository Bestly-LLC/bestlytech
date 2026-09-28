-- Wall round 4 (W5): Turo booking pop-up at the same moment as the iPhone + HomePod.
-- Turo's push reaches the iPhone instantly; our own copy of the booking only arrives when the Mac's Turo sync next reads the
-- trips feed (every 3 min, and only while Chrome allows it). So the iPhone's Turo shortcut calls one short link
-- (www.bestly.tech/wp/<key> -> edge fn wall-turo-ping -> wall_turo_ping) and the wall strip fires within ~1-2 s.
-- When the feed catches up later, the insert trigger sees the recent ping and does not pop the same booking up twice.

create table if not exists public.wall_turo_pings (
  id bigserial primary key,
  at timestamptz not null default now(),
  text text,
  guest text,
  car text,
  matched bigint,           -- reservation_id the feed later matched it to
  source text not null default 'shortcut'
);
alter table public.wall_turo_pings enable row level security;
revoke all on public.wall_turo_pings from anon, authenticated;

-- the link key lives in Vault (never in git); create it once
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'wall_turo_ping_key') then
    perform vault.create_secret(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12), 'wall_turo_ping_key',
      'Short key in the iPhone Turo shortcut link www.bestly.tech/wp/<key> (wall pop-up in sync with the Turo push)');
  end if;
end $$;

create or replace function public.wall_turo_ping(p_key text, p_text text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare k text; t text; g text; c text; m text[]; r public.wall_turo_pings; car text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'wall_turo_ping_key';
  if k is null or coalesce(p_key, '') <> k then raise exception 'bad key'; end if;
  if (select count(*) from wall_turo_pings where at > now() - interval '10 minutes') >= 6 then
    return jsonb_build_object('ok', false, 'error', 'slow down');
  end if;
  t := left(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]<>]', ' ', 'g'), 500);
  -- best effort, from Turo's push text ("Maria booked your Tesla Model 3 ..."); anything missing just shows generically
  m := regexp_match(t, '([A-Z][[:alpha:]''.-]{1,20})(?: [A-Z]\.?)? (?:has )?booked', 'i');
  if m is not null and lower(m[1]) not in ('you', 'trip', 'guest', 'new', 'turo', 'been', 'just') then g := initcap(m[1]); end if;
  m := regexp_match(t, 'your ([[:alnum:] -]{3,40}?)(?: for | from | on |[.!,]|$)', 'i');
  if m is not null then c := btrim(m[1]); end if;
  select coalesce(v.display_name, 'the Tesla') into car from turo_vehicle_state v order by v.observed_at desc nulls last limit 1;
  insert into wall_turo_pings (text, guest, car) values (nullif(t, ''), g, coalesce(c, car)) returning * into r;
  perform wall_sig_broadcast('turo_booking', jsonb_build_object(
    'id', 'ping-' || r.id, 'guest', g, 'car', coalesce(c, car, 'the Tesla'), 'starts_at', null, 'ends_at', null,
    'days', null, 'earnings', null, 'ping', true));
  return jsonb_build_object('ok', true, 'id', r.id, 'guest', g, 'car', coalesce(c, car));
end $$;
revoke all on function public.wall_turo_ping(text, text) from public, anon, authenticated;
grant execute on function public.wall_turo_ping(text, text) to service_role;

-- the feed trigger: skip the pop-up when the iPhone already fired it for this booking (recent unmatched ping)
create or replace function public.wall_turo_booking_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare car text; days int; v_ping bigint;
begin
  if coalesce(new.status, '') ilike '%cancel%' or coalesce(new.status, '') = 'test' or new.ends_at < now() then return new; end if;
  select id into v_ping from wall_turo_pings where matched is null and at > now() - interval '45 minutes' order by at desc limit 1;
  if v_ping is not null then
    update wall_turo_pings set matched = new.reservation_id where id = v_ping;
    return new;
  end if;
  select coalesce(v.display_name, 'the Tesla') into car from turo_vehicle_state v where v.vin = new.vin;
  days := greatest(1, ceil(extract(epoch from (new.ends_at - new.starts_at)) / 86400.0))::int;
  perform wall_sig_broadcast('turo_booking', jsonb_build_object(
    'id', new.reservation_id, 'guest', new.guest_first, 'car', coalesce(car, 'the Tesla'),
    'starts_at', new.starts_at, 'ends_at', new.ends_at, 'days', days, 'earnings', new.earnings));
  return new;
exception when others then return new;
end $function$;
