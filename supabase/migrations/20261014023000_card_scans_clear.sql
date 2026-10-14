-- In-car card scans: a Clear button for Jared's own test scans (2026-10-13).
-- Clearing only hides rows (cleared_at); nothing is erased. Undo: update card_scans set cleared_at = null;
-- Old card_scans_admin saved in bestly_memory house/turo/card-scans-clear-undo-2026-10-13.

alter table public.card_scans add column if not exists cleared_at timestamptz;

create or replace function public.card_scans_admin(p_limit integer default 12)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'week',   (select count(*) from card_scans where cleared_at is null and src not in ('watchdog','host') and scanned_at > now() - interval '7 days'),
    'month',  (select count(*) from card_scans where cleared_at is null and src not in ('watchdog','host') and scanned_at > now() - interval '30 days'),
    'all',    (select count(*) from card_scans where cleared_at is null and src not in ('watchdog','host')),
    'signed', (select count(*) from card_scans where cleared_at is null and src not in ('watchdog','host') and signed_in_at is not null),
    'trips',  (select count(distinct reservation_id) from card_scans where cleared_at is null and reservation_id is not null and src <> 'host'),
    'trips_30d', (select count(*) from turo_trips where starts_at between now() - interval '30 days' and now()),
    'last',   (select max(scanned_at) from card_scans where cleared_at is null and src not in ('watchdog','host')),
    'cleared_at', (select max(cleared_at) from card_scans),
    'recent', coalesce((select jsonb_agg(r order by r.scanned_at desc) from (
        select s.scanned_at, s.signed_in_at, s.kind, s.device, s.src, s.reservation_id, t.guest_first
          from card_scans s left join turo_trips t on t.reservation_id = s.reservation_id
         where s.src <> 'watchdog' and s.cleared_at is null
         order by s.scanned_at desc limit greatest(1, least(p_limit, 50))) r), '[]'::jsonb)
  );
end $function$;

-- Hides every scan shown so far. Returns how many were hidden.
create or replace function public.card_scans_clear()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  update card_scans set cleared_at = now() where cleared_at is null and src <> 'watchdog';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'cleared', n);
end $function$;
revoke all on function public.card_scans_clear() from public, anon;
grant execute on function public.card_scans_clear() to authenticated;
