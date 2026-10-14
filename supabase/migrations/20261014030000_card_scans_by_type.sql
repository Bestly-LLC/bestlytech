-- In-car card scans broken down by card type: Home, LAX, Delivery (2026-10-13).
-- Type = 'delivery' for the cream delivery card (src delivery), else the trip page kind (home / lax).
-- Undo: bestly_memory house/turo/card-scans-bytype-undo-2026-10-13.
create or replace function public.card_scan_type(p_src text, p_kind text) returns text
language sql immutable set search_path to 'public' as $$
  select case when p_src = 'delivery' then 'delivery' when p_kind = 'lax' then 'lax' else 'home' end
$$;

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
    'by_type', (select jsonb_object_agg(t.type, jsonb_build_object('scans', coalesce(c.scans, 0), 'signed', coalesce(c.signed, 0)))
                  from (values ('home'), ('lax'), ('delivery')) t(type)
                  left join (select card_scan_type(src, kind) as type, count(*) as scans, count(signed_in_at) as signed
                               from card_scans where cleared_at is null and src not in ('watchdog','host') group by 1) c using (type)),
    'recent', coalesce((select jsonb_agg(r order by r.scanned_at desc) from (
        select s.scanned_at, s.signed_in_at, s.kind, s.device, s.src, s.reservation_id, t.guest_first,
               case when s.src = 'host' then null else card_scan_type(s.src, s.kind) end as type
          from card_scans s left join turo_trips t on t.reservation_id = s.reservation_id
         where s.src <> 'watchdog' and s.cleared_at is null
         order by s.scanned_at desc limit greatest(1, least(p_limit, 50))) r), '[]'::jsonb)
  );
end $function$;
