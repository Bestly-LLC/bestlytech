-- C2 (2026-09-27): the demo trip pages (/t/demo-home, /t/demo-lax) faked the A/C buttons for everyone, so a host
-- showing friends the app saw "Climate on" while the real car did nothing. For the host (signed-in admin, or the
-- host link's demo pass, same check as the real demo key), the A/C buttons now drive Blue Steel for real, but never
-- while a guest trip is on (2 h before pickup to 1 h after return). Everyone else still gets the pretend version
-- (these functions return null for them). Commands carry args.demo_page (NOT args.demo, which is the demo-key flow).

create or replace function public.demo_car_command(p_pass text, p_action text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int; jid bigint; g text;
begin
  if not demo_key_ok(p_pass) then return null; end if;  -- not the host: the page stays pretend
  if p_action not in ('cool', 'warm', 'seat', 'off', 'refresh') then return jsonb_build_object('ok', false, 'error', 'Unknown action'); end if;
  select guest_first into g from turo_trips where now() between starts_at - interval '2 hours' and ends_at + interval '1 hour'
    and coalesce(status, '') not in ('test', 'CANCELLED', 'CANCELED') order by starts_at limit 1;
  if found then
    return jsonb_build_object('ok', false, 'error', coalesce(g, 'A guest') || ' has the car right now, so the demo won''t touch it.');
  end if;
  if p_action = 'refresh' then
    if tesla_fresh_reading() then return jsonb_build_object('ok', true, 'cached', true); end if;
  else
    if exists (select 1 from tesla_fleet_commands where action in ('cool', 'warm', 'seat', 'off') and status in ('queued', 'running') and created_at > now() - interval '3 minutes') then
      return jsonb_build_object('ok', false, 'error', 'Still working on the last one. Try again in a moment.');
    end if;
    select count(*) into n from tesla_fleet_commands where args ? 'demo_page' and created_at > now() - interval '1 day';
    if n >= 20 then return jsonb_build_object('ok', false, 'error', 'That''s the demo limit for today.'); end if;
  end if;
  insert into tesla_fleet_commands (reservation_id, action, args) values (null, p_action, jsonb_build_object('demo_page', true)) returning id into jid;
  return jsonb_build_object('ok', true, 'id', jid);
end $function$;

create or replace function public.demo_car_job(p_pass text, p_id bigint)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when demo_key_ok(p_pass) then
    (select jsonb_build_object('status', c.status, 'stage', c.stage, 'result', c.result) from tesla_fleet_commands c where c.id = p_id and c.args ? 'demo_page')
  end;
$function$;

revoke execute on function public.demo_car_command(text, text) from public;
revoke execute on function public.demo_car_job(text, bigint) from public;
grant execute on function public.demo_car_command(text, text) to anon, authenticated;
grant execute on function public.demo_car_job(text, bigint) to anon, authenticated;
