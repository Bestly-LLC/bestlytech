-- Ava answers both lines, part 4 (Spark, 2026-10-04): incoming-call list, follow-up actions and cron, line-health in both watchdogs.

-- 3. RoofGuard: incoming calls and call-backs for the Calls tab ------------------------------------------------------
create or replace function public.rg_inbound_calls(p_limit integer DEFAULT 100)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select c.id, c.call_no, c.direction, c.lead_id, l.company, c.to_number as phone, c.caller_name, c.message, c.urgent,
           c.callback_wanted, c.callback_number, c.read_at, c.summary, c.duration_sec, c.status,
           coalesce(c.ended_at, c.queued_at) as at,
           (select coalesce(jsonb_agg(jsonb_build_object('role', t->>'role', 'text', t->>'message', 't', (t->>'time_in_call_secs')::int) order by ord), '[]'::jsonb)
              from jsonb_array_elements(coalesce(c.transcript, '[]'::jsonb)) with ordinality as e(t, ord)
             where coalesce(t->>'message', '') <> '') as transcript
      from rg_calls c join rg_leads l on l.id = c.lead_id
     where c.direction in ('inbound', 'callback') and c.deleted_at is null and c.moved_to_ava_at is null
     order by coalesce(c.ended_at, c.queued_at) desc
     limit greatest(1, least(p_limit, 300))) x), '[]'::jsonb);
end $function$;
revoke execute on function public.rg_inbound_calls(integer) from public, anon;
grant execute on function public.rg_inbound_calls(integer) to authenticated;

create or replace function public.rg_mark_read(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update rg_calls set read_at = now() where id = p_id and read_at is null;
end $function$;
revoke execute on function public.rg_mark_read(uuid) from public, anon;
grant execute on function public.rg_mark_read(uuid) to authenticated;

-- 4. Follow-up actions (Jared's taps) and the cron that dials approved ones --------------------------------------------
-- Nothing dials while a follow-up is 'proposed'. call_now / approve are the only ways out, and both need an admin.
create or replace function public.ava_followup_act(p_id uuid, p_action text, p_at timestamptz DEFAULT null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare f ava_followups;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  select * into f from ava_followups where id = p_id for update;
  if f.id is null then raise exception 'No such follow-up'; end if;
  if p_action = 'call_now' then
    if f.status not in ('proposed', 'approved') then raise exception 'This follow-up is already %', f.status; end if;
    update ava_followups set status = 'dialing', due_at = now(), dialed_at = now(), updated_at = now() where id = p_id;
    perform invoke_edge_function(case f.source when 'ava' then 'ava-assistant' else 'roofguard-caller' end,
                                 jsonb_build_object('action', 'callback', 'id', p_id), 60000);
  elsif p_action = 'approve' then
    if f.status not in ('proposed', 'approved') then raise exception 'This follow-up is already %', f.status; end if;
    if p_at is null or p_at < now() - interval '1 minute' then raise exception 'Pick a time in the future'; end if;
    update ava_followups set status = 'approved', due_at = p_at, reminded_at = null, updated_at = now() where id = p_id;
  elsif p_action = 'dismiss' then
    if f.status not in ('proposed', 'approved') then raise exception 'This follow-up is already %', f.status; end if;
    update ava_followups set status = 'dismissed', updated_at = now() where id = p_id;
  elsif p_action = 'cancel' then
    if f.status <> 'approved' then raise exception 'Only a scheduled follow-up can be cancelled'; end if;
    update ava_followups set status = 'proposed', due_at = null, reminded_at = null, updated_at = now() where id = p_id;
  else
    raise exception 'unknown action %', p_action;
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from ava_followups where id = p_id));
end $function$;
revoke execute on function public.ava_followup_act(uuid, text, timestamptz) from public, anon;
grant execute on function public.ava_followup_act(uuid, text, timestamptz) to authenticated;

create or replace function public.ava_followups_tick()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  f record; v_reset int := 0; v_missed int := 0; v_reminded int := 0; v_dialed int := 0;
begin
  -- self-heal: a call that was started but never reported goes back to proposed so Jared sees it again
  with x as (update ava_followups set status = 'proposed', due_at = null, updated_at = now(),
               note = coalesce(note || ' ', '') || '[call did not go out; tap Call back now to retry]'
              where status = 'dialing' and dialed_at < now() - interval '15 minutes' returning id)
  select count(*) into v_reset from x;
  if v_reset > 0 then
    perform scout_notify('Ava follow-up call did not go out', v_reset || ' follow-up call(s) never connected. They are back in the list to retry.',
                         'warning', true, 'https://bestly.tech/admin/ava', 'ava-followup-stuck-' || to_char(now(), 'YYYYMMDDHH24'));
  end if;

  -- approved but over 4 hours late: back to proposed, never dialed at a stale time
  with x as (update ava_followups set status = 'proposed', due_at = null, updated_at = now(),
               note = coalesce(note || ' ', '') || '[missed its time]'
              where status = 'approved' and due_at < now() - interval '4 hours' returning id)
  select count(*) into v_missed from x;

  -- a heads-up 15 minutes before an approved call
  for f in select * from ava_followups where status = 'approved' and reminded_at is null and due_at > now() and due_at <= now() + interval '15 minutes' loop
    perform scout_notify('Ava calls ' || coalesce(f.name, f.phone) || ' back at ' || to_char(f.due_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || ' PT',
                         coalesce(f.reason, 'Scheduled call back'), 'info', true,
                         case f.source when 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end,
                         'ava-followup-remind-' || f.id);
    update ava_followups set reminded_at = now(), updated_at = now() where id = f.id;
    v_reminded := v_reminded + 1;
  end loop;

  -- approved and due: dial (3 per tick at most)
  for f in select * from ava_followups where status = 'approved' and due_at <= now() order by due_at limit 3 loop
    update ava_followups set status = 'dialing', dialed_at = now(), updated_at = now() where id = f.id;
    perform invoke_edge_function(case f.source when 'ava' then 'ava-assistant' else 'roofguard-caller' end,
                                 jsonb_build_object('action', 'callback', 'id', f.id), 60000);
    v_dialed := v_dialed + 1;
  end loop;
  return jsonb_build_object('reset', v_reset, 'missed', v_missed, 'reminded', v_reminded, 'dialed', v_dialed);
end $function$;
revoke execute on function public.ava_followups_tick() from public, anon, authenticated;
select cron.schedule('ava-followups', '*/5 * * * *', $$ select public.ava_followups_tick(); $$);

-- 5. Line watchdog: the 10-minute watchers also ask each Ava's edge function to check her line (no AI in the check) ---
create or replace function public.ava_watch()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_stuck int; s ava_settings;
begin
  select * into s from ava_settings where id;
  with x as (update ava_calls set status = 'failed', summary = coalesce(summary, '[watchdog: no report after 30 min]')
              where status in ('queued', 'in_progress') and created_at < now() - interval '30 minutes' returning id)
  select count(*) into v_stuck from x;
  if s.agent_id is null or s.phone_number_id is null then
    perform bestly_raise('ava.assistant', 'problem', 'warning', 'Ava (personal) is not answering her line',
      'Her voice agent or phone number is not set up. Open /admin/ava and run Setup.', 'ava', null, true);
  elsif v_stuck >= 3 then
    perform bestly_raise('ava.assistant', 'problem', 'warning', 'Ava (personal) calls not reporting back',
      format('%s calls never got a post-call report. Check the Ava webhook in ElevenLabs.', v_stuck), 'ava', null, true);
  else
    perform bestly_raise('ava.assistant', 'resolved', 'info', 'Ava (personal) healthy', null, 'ava');
  end if;
  -- line check: Telnyx routing, incoming calls on, init webhook set. Heals itself by re-running setup.
  begin perform invoke_edge_function('ava-assistant', '{"action":"health"}'::jsonb, 150000);
  exception when others then null; end;
  return jsonb_build_object('stuck_fixed', v_stuck);
end $function$;

create or replace function public.rg_watch()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_reset   int;
  v_left    int;
  v_last    timestamptz;
  v_recent  record;
  v_kicked  boolean := false;
begin
  update rg_leads set enrich_status = 'pending', claimed_at = null
   where enrich_status = 'working' and claimed_at < now() - interval '15 minutes';
  get diagnostics v_reset = row_count;

  select count(*) into v_left from rg_leads
   where enrich_status = 'pending' or (enrich_status = 'error' and enrich_attempts < 3);
  select max(started_at) into v_last from rg_enrich_runs;

  select coalesce(sum(claimed),0) claimed, coalesce(sum(errors),0) errors, count(*) runs
    into v_recent
    from rg_enrich_runs where started_at > now() - interval '1 hour';

  if v_left > 0 and (v_last is null or v_last < now() - interval '20 minutes') then
    perform invoke_edge_function('roofguard-enrich', '{"source":"watchdog"}'::jsonb, 150000);
    v_kicked := true;
  end if;

  if v_left > 0 and v_last is not null and v_last < now() - interval '45 minutes' then
    perform bestly_raise('roofguard.enrich', 'problem', 'warning',
      'RoofGuard phone finder stalled',
      format('No finder run in %s min with %s leads still to look up. Watchdog re-kicks every 10 min, but runs are not landing.',
             round(extract(epoch from now() - v_last) / 60), v_left),
      'roofguard', null, false);
  elsif v_recent.claimed >= 20 and v_recent.errors::numeric / v_recent.claimed > 0.5 then
    perform bestly_raise('roofguard.enrich', 'problem', 'warning',
      'RoofGuard phone finder failing',
      format('%s of %s lookups errored in the last hour. Retries are automatic (3 per lead).',
             v_recent.errors, v_recent.claimed),
      'roofguard', null, false);
  elsif v_recent.runs > 0 or v_left = 0 then
    perform bestly_raise('roofguard.enrich', 'resolved', 'info',
      'RoofGuard phone finder healthy again', null, 'roofguard');
  end if;

  -- line check: Telnyx routing, incoming calls on, init webhook set. Heals itself by re-running setup.
  begin perform invoke_edge_function('roofguard-caller', '{"action":"health"}'::jsonb, 150000);
  exception when others then null; end;

  return jsonb_build_object('reset', v_reset, 'left', v_left, 'kicked', v_kicked, 'last_run', v_last);
end $function$;
