-- In-car card QR tracking (Jared, 2026-10-11): the welcome card left with the complimentary water has a QR to
-- bestly.tech/turo-key?src=card. Every scan is logged; when that same visit signs in, the scan is tied to the trip,
-- so /admin/turo shows how many guests scan the card and who. No phone or email is stored here (privacy map not needed).
-- Watchdog: card-qr-watch (hourly, tool of Leo) re-grants the two public RPCs if they get locked and raises
-- card.qr.* to Scout (healed, never Jared's phone).

create table if not exists public.card_scans (
  id uuid primary key default gen_random_uuid(),
  src text not null,                 -- 'card' today ('host' = Jared's own test scans, listed but never counted); room for per-batch codes later (e.g. card-oct26)
  kind text not null default 'home', -- which entry page: home (/turo-key) or lax (/turo-lax)
  device text,                       -- "iPhone Safari" style label
  device_id text,                    -- random per-browser id (lax/track.ts), only to dedupe repeat scans
  scanned_at timestamptz not null default now(),
  signed_in_at timestamptz,
  reservation_id bigint
);
create index if not exists card_scans_at on public.card_scans (scanned_at desc);
alter table public.card_scans enable row level security; -- no policies: only the functions below touch it

-- Public: log a scan. Repeat scans from the same browser within 30 min count once. Returns the scan id.
create or replace function public.card_scan_log(p_src text, p_kind text, p_device text default null, p_device_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_src is null or p_src !~ '^[a-z0-9-]{1,24}$' then return null; end if;
  if coalesce(p_kind, 'home') not in ('home', 'lax') then p_kind := 'home'; end if;
  if (select count(*) from card_scans where scanned_at > now() - interval '1 hour') > 300 then return null; end if; -- flood guard
  if p_device_id is not null then
    select id into v_id from card_scans
     where device_id = left(p_device_id, 40) and src = p_src and scanned_at > now() - interval '30 minutes'
     order by scanned_at desc limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into card_scans (src, kind, device, device_id)
  values (p_src, coalesce(p_kind, 'home'), left(p_device, 40), left(p_device_id, 40))
  returning id into v_id;
  return v_id;
end $$;

-- Public: the same visit signed in (or tapped Continue) — tie the scan to that trip. Only within 3 hours of the scan.
create or replace function public.card_scan_link(p_scan uuid, p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_res bigint;
begin
  if p_scan is null or p_token is null or p_token like 'demo-%' then return false; end if;
  select reservation_id into v_res from lax_guest_links where token = p_token;
  if v_res is null then return false; end if;
  update card_scans set signed_in_at = now(), reservation_id = v_res
   where id = p_scan and signed_in_at is null and scanned_at > now() - interval '3 hours';
  return found;
end $$;

revoke all on function public.card_scan_log(text, text, text, text) from public;
revoke all on function public.card_scan_link(uuid, text) from public;
grant execute on function public.card_scan_log(text, text, text, text) to anon, authenticated;
grant execute on function public.card_scan_link(uuid, text) to anon, authenticated;

insert into public.security_public_rpcs (fn, why) values
  ('card_scan_log', 'In-car card QR: /turo-key logs a scan (no personal data, flood-guarded)'),
  ('card_scan_link', 'In-car card QR: ties a scan to the trip the same visit signed in to (token-bound)')
on conflict (fn) do nothing;

-- Admin: totals + recent scans for the Turo Watch card.
create or replace function public.card_scans_admin(p_limit int default 12)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'week',   (select count(*) from card_scans where src not in ('watchdog','host') and scanned_at > now() - interval '7 days'),
    'month',  (select count(*) from card_scans where src not in ('watchdog','host') and scanned_at > now() - interval '30 days'),
    'all',    (select count(*) from card_scans where src not in ('watchdog','host')),
    'signed', (select count(*) from card_scans where src not in ('watchdog','host') and signed_in_at is not null),
    'trips',  (select count(distinct reservation_id) from card_scans where reservation_id is not null and src <> 'host'),
    'trips_30d', (select count(*) from turo_trips where starts_at between now() - interval '30 days' and now()),
    'last',   (select max(scanned_at) from card_scans where src not in ('watchdog','host')),
    'recent', coalesce((select jsonb_agg(r order by r.scanned_at desc) from (
        select s.scanned_at, s.signed_in_at, s.kind, s.device, s.src, s.reservation_id, t.guest_first
          from card_scans s left join turo_trips t on t.reservation_id = s.reservation_id
         where s.src <> 'watchdog'
         order by s.scanned_at desc limit greatest(1, least(p_limit, 50))) r), '[]'::jsonb)
  );
end $$;
revoke all on function public.card_scans_admin(int) from public, anon;
grant execute on function public.card_scans_admin(int) to authenticated;

-- Watchdog (self-heal): if Ares's auto-fixer or anything else locks the public RPCs, re-grant and tell Scout.
create or replace function public.card_qr_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fixed text[] := '{}';
begin
  if not has_function_privilege('anon', 'public.card_scan_log(text, text, text, text)', 'execute') then
    grant execute on function public.card_scan_log(text, text, text, text) to anon, authenticated; v_fixed := v_fixed || 'card_scan_log'::text;
  end if;
  if not has_function_privilege('anon', 'public.card_scan_link(uuid, text)', 'execute') then
    grant execute on function public.card_scan_link(uuid, text) to anon, authenticated; v_fixed := v_fixed || 'card_scan_link'::text;
  end if;
  insert into security_public_rpcs (fn, why) values
    ('card_scan_log', 'In-car card QR: /turo-key logs a scan (no personal data, flood-guarded)'),
    ('card_scan_link', 'In-car card QR: ties a scan to the trip the same visit signed in to (token-bound)')
  on conflict (fn) do nothing;
  if array_length(v_fixed, 1) > 0 then
    perform bestly_raise('card.qr.locked', 'problem', 'warning',
      'Card QR tracking was locked, unlocked it',
      format('Guests scanning the in-car card could not be counted because %s lost public access. I gave it back and re-listed it as allowed. Nothing for you to do. - Leo', array_to_string(v_fixed, ' and ')),
      'turo', null, true);
  else
    perform bestly_raise('card.qr.locked', 'resolved', 'info', 'Card QR tracking is working');
  end if;
  return jsonb_build_object('ok', true, 'fixed', v_fixed, 'scans_7d', (select count(*) from card_scans where scanned_at > now() - interval '7 days'));
end $$;
revoke all on function public.card_qr_watch() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('card-qr-watch') where exists (select 1 from cron.job where jobname = 'card-qr-watch');
  perform cron.schedule('card-qr-watch', '17 * * * *', $c$select public.card_qr_watch()$c$);
end $$;

select public.team_onboard($j$[
 {"slug":"card-qr-watch","name":"Card QR Watch","role":"Keeps the in-car card's QR counting","tool_of":"leo","runs_on":"cloud","icon":"qr-code","schedule":"hourly at :17",
  "what_it_does":"The welcome card in the car (with the free water) has a QR code to the trip sign-in. Every scan is counted on Turo Watch, and tied to the guest's trip when they sign in. Every hour this checks that guests' phones can still log a scan; if the security auto-fixer or anything else locks it, it unlocks it and tells Scout. It never pings your phone.",
  "pulse":{"src":"cron","job":"card-qr-watch","gap":130},
  "owns":["card.qr"]}
]$j$::jsonb);
