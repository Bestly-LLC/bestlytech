-- Part B of Leo's early-return check-in (NOT applied yet). Part A is supabase/migrations/20261012060000_leo_early_return.sql (applied 2026-10-11).
-- Apply with no DROP statements (the apply tool cancels them).

-- leo_health_tick: unchanged except the last step (early-return watch), wrapped so it can never break the rest.
create or replace function public.leo_health_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  diag_n int; diag_recent int; diag_kinds text;
  calls int; errs int; errs_recent int; no_trip int; sess_fail int; open_fail int;
  tools_bad boolean; blocked boolean; diag_bad boolean; opened timestamptz; why text; healed boolean := false; er jsonb := '{}'::jsonb;
begin
  select count(*), count(*) filter (where at > now() - interval '10 minutes'), string_agg(distinct kind, ', ')
    into diag_n, diag_recent, diag_kinds
    from public.leo_client_diag
   where at > now() - interval '30 minutes' and kind in ('start', 'sdk', 'csp', 'audio_locked', 'page_action') and coalesce(token, '') not like 'demo%';
  diag_bad := diag_n >= 5 and diag_recent >= 1;
  if diag_bad then
    perform public.bestly_raise('leo.health.screen', 'problem', 'warning', 'Leo: guests are hitting trouble starting a voice chat',
      diag_n || ' failures (' || diag_kinds || ') from guests'' phones and browsers in the last 30 minutes. They can still type to me or message the host.', 'agents', null, false);
  else
    perform public.bestly_raise('leo.health.screen', 'resolved', 'info', 'Leo: voice chat starts normally again', 'No new failures from guests'' devices.', 'agents', null, true);
  end if;

  select count(*) filter (where code in ('ok', 'refused', 'error')),
         count(*) filter (where code = 'error'),
         count(*) filter (where code = 'error' and at > now() - interval '10 minutes'),
         count(*) filter (where code = 'no_trip'),
         count(*) filter (where code = 'session'),
         count(*) filter (where tool = 'session_open' and code = 'error')
    into calls, errs, errs_recent, no_trip, sess_fail, open_fail
    from public.leo_tool_log where at > now() - interval '30 minutes' and not demo and channel <> 'phone_test';
  tools_bad := (calls >= 5 and errs::numeric / calls >= 0.4 and errs_recent >= 1) or (errs >= 3 and errs_recent >= 1)
            or (no_trip >= 3) or (sess_fail >= 3) or (open_fail >= 2);
  blocked := (calls >= 5 and errs = calls) or no_trip >= 3 or sess_fail >= 3 or open_fail >= 2;
  if tools_bad then
    why := case when no_trip >= 3 then no_trip || ' tool calls arrived without a trip key (the call-start wiring may have drifted)'
                when sess_fail >= 3 then sess_fail || ' tool calls could not be verified against a live call'
                when open_fail >= 2 then 'the voice platform refused ' || open_fail || ' guest sessions'
                else errs || ' of ' || calls || ' tool calls failed' end;
    select opened_at into opened from public.monitor_issues where key = 'leo.health.tools' and status = 'open';
    if blocked and opened is not null and opened < now() - interval '60 minutes' then
      perform public.bestly_raise('leo.health.tools', 'problem', 'error', 'Leo: voice chat still down for guests',
        'Guests have been blocked for over an hour: ' || why || '. I already re-checked my phone line and demo car; this needs a person.', 'agents', 'Open Leo in the admin and check the tool log', false);
    else
      perform public.bestly_raise('leo.health.tools', 'problem', 'warning', 'Leo: my tools are failing for some guests',
        why || ' in the last 30 minutes. ' || case when blocked then 'Guests are blocked, so I am retrying my own checks.' else 'Most guests still get through.' end, 'agents', null, false);
    end if;
    if not exists (select 1 from public.monitor_events where key = 'leo.health.tools' and title like '%self-heal%' and created_at > now() - interval '30 minutes') then
      begin
        perform public.leo_phone_watch_tick();
        perform public.invoke_edge_function('trip-voice', '{"op":"selftest"}'::jsonb, 30000);
        insert into public.monitor_events (key, kind, severity, title, body, pushed)
          values ('leo.health.tools', 'problem', 'info', 'Leo: self-heal ran', 'Re-checked the phone webhook and ran the demo-car self-test.', false);
        healed := true;
      exception when others then null;
      end;
    end if;
  else
    perform public.bestly_raise('leo.health.tools', 'resolved', 'info', 'Leo: my tools are working again', 'Tool calls are succeeding.', 'agents', null, true);
  end if;

  begin er := public.leo_early_return_watch(); exception when others then er := jsonb_build_object('error', left(sqlerrm, 120)); end;

  return jsonb_build_object('ok', not (diag_bad or tools_bad), 'screen_failures_30m', diag_n, 'tool_calls_30m', calls, 'tool_errors_30m', errs,
    'no_trip_30m', no_trip, 'session_fail_30m', sess_fail, 'blocked', blocked, 'self_heal_ran', healed, 'early_return', er);
end $$;

grant execute on function public.leo_health_tick() to service_role;

-- ---------- cron + team card ----------
do $g$ begin perform cron.unschedule(jobid) from cron.job where jobname = 'leo-early-return'; end $g$;
select cron.schedule('leo-early-return', '*/10 * * * *', $c$select public.leo_early_return_detect()$c$);

-- Update Leo's existing card (same slug): add the new job to his pulse and what he does.
select public.team_onboard($j$[
 {"slug":"leo","name":"Leo","role":"Turo trip helper (voice)","reports_to":"jared","dept":"turo","runs_on":"cloud","icon":"phone-call","welcome":false,
  "schedule":"answers calls; Switchboard checks his line every 10 min; health watchdog every 10 min; early-return check every 10 min (8 AM to 9 PM Pacific only); demo car self-test hourly at :23","admin_url":"/admin/agents/leo","sort":62,
  "what_it_does":"Talks with Turo guests by voice from the Talk to Leo button on their trip page and by phone: checks their Tesla key and sends a fresh one (never while the key is held for the license and check-in), checks extra drivers, runs the car buttons (climate, lock, Supercharger navigation), answers Supercharging and return-charge questions, opens things on their trip page, alerts Jared when a guest needs him, and files tickets. On the phone he can only look up the trip, take a message and set up the reminder email, because caller ID can be faked; car and key actions need the trip page link. Every 10 minutes he checks that guests can start a voice chat and that his tools are succeeding, retries his own phone webhook and demo-car test if not, and tells you (signed Leo) only if guests stay blocked for over an hour. Every hour at :23 he runs his own test on the demo car and checks that unlock is still refused on real trips. Early return: every 10 minutes (never 9 PM to 8 AM Pacific) he checks whether a guest's car has been parked back at Kings Rd for 20 minutes with 90+ minutes left on the trip. If so he calls the guest once (or texts, once texting is approved) and asks if they are finished. Yes gets the steps to end the trip in the Turo app; no gets a thank-you. The key is never revoked: it follows the Turo reservation. Outcomes land in the 7 PM recap, not as a push. Switchboard watches his line and tools.",
  "pulse":{"src":"at","table":"agent_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"agent_slug = 'leo'","gap":30,"alert":true,"on_demand":true,
           "also":["agent-watch","leo-phone-watch","leo-demo-parity","leo-client-diag-trim","leo-health","leo-early-return"]},
  "owns":["leo","leo.","agent.line.leo","leo.early_return"]}
]$j$::jsonb);
