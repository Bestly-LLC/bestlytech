-- The timeline is the traced history you would actually put in front of Turo, so it now says who
-- each line is attributed to, and it carries the drives with the basis for each. A drive whose
-- basis is only 'booking' proves the car was out during their booking and nothing about who was
-- driving; 'key' means a named Tesla account held a live digital key across that drive.
create or replace function public.lax_guest_timeline(p_reservation bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'at', at, 'detail', detail, 'device', device, 'actor', actor) order by at desc)
       from (select * from lax_guest_events
              where reservation_id = p_reservation and kind not in ('ask') and actor <> 'host'
              order by at desc limit 120) e), '[]'::jsonb),
    'host_events', (select count(*) from lax_guest_events
                     where reservation_id = p_reservation and actor = 'host' and device is not null),
    'drives', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', drive_id, 'at', started_at, 'ended_at', ended_at, 'miles', miles,
                 'max_mph', max_mph, 'from', from_name, 'to', to_name, 'basis', basis, 'driver', driver_name)
                 order by started_at desc)
       from trip_drive_attribution(p_reservation)), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('at', u.created_at, 'q', u.content, 'a', a.content, 'source', a.source, 'unanswered', u.unanswered, 'urgent', u.urgent) order by u.created_at desc)
       from lax_ask_msgs u
       left join lateral (select content, source from lax_ask_msgs a where a.reservation_id = u.reservation_id and a.role = 'assistant'
                           and a.created_at >= u.created_at order by a.created_at limit 1) a on true
       where u.reservation_id = p_reservation and u.role = 'user'), '[]'::jsonb));
end $function$;
