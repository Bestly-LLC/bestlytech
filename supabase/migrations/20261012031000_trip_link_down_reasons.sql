-- 2026-10-11: link-down pages. When a guest's trip link stops working, the page says why (one short line)
-- and puts Leo front and center. lax_guest_public now returns a reason and the page kind (home / lax):
--   unknown  no link with this token
--   changed  the link exists but its trip left the Turo feed (changed, rebooked or canceled)
--   ended    the trip ended more than 14 days ago
-- The page itself adds "fixing" when it can't reach us at all.
-- Leo on a dead link gets a limited session (trip_voice_sessions.channel = 'page_unknown'): take a message for the
-- host only, same scope as an unmatched phone caller. See supabase/functions/trip-voice.

alter table public.trip_voice_sessions drop constraint if exists trip_voice_sessions_channel_check;
alter table public.trip_voice_sessions add constraint trip_voice_sessions_channel_check
  check (channel = any (array['page', 'phone', 'phone_unknown', 'phone_test', 'page_unknown']));

do $mig$
declare src text;
begin
  src := pg_get_functiondef('public.lax_guest_public(text)'::regprocedure);
  src := replace(src,
    $a$  if l.reservation_id is null then return jsonb_build_object('ok', false); end if;$a$,
    $b$  if l.reservation_id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;$b$);
  src := replace(src,
    $a$  if t.reservation_id is null or t.ends_at < now() - interval '14 days' then return jsonb_build_object('ok', false, 'ended', true); end if;$a$,
    $b$  if t.reservation_id is null then
    return jsonb_build_object('ok', false, 'ended', true, 'reason', 'changed',
      'kind', (select e.detail->>'kind' from lax_guest_events e
                where e.reservation_id = l.reservation_id and e.detail ? 'kind' order by e.at desc limit 1));
  end if;
  if t.ends_at < now() - interval '14 days' then
    return jsonb_build_object('ok', false, 'ended', true, 'reason', 'ended', 'kind', lax_trip_kind(t.airport_code));
  end if;$b$);
  if position('''reason'', ''changed''' in src) = 0 or position('''reason'', ''unknown''' in src) = 0 then
    raise exception 'lax_guest_public anchors not found';
  end if;
  execute src;
end $mig$;
