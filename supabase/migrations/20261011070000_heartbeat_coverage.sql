-- Heartbeat coverage (Worker B, 2026-10-11).
-- Jared asked "are all AI employees working?". Team page could only vouch for ~105 of 126 active agents.
-- The Team page reads bestly_agents.pulse through team_pulses(); agent_beats is just one of its sources.
-- This migration (1) repairs pulse specs that pointed nowhere, (2) gives weekly agents a realistic 8-day gap,
-- (3) adds team_beat_bridge() so a weekly cron/Pi/table check-in survives the 3-day cron.job_run_details window,
-- (4) records the last real run of Claude scheduled tasks (they cannot beat themselves when the usage limit stops them),
-- (5) marks agents with no job anywhere as "no job found" (health stays unknown; Team Watch never alerts on unknown).
-- No cron, function, task or data is deleted. No new alert path: nothing here calls bestly_raise.

-- 1. Broken pulse specs ---------------------------------------------------------------------------------------------
-- plug-puller used "job" with src pi_job (the reader wants "key"); charge-watch / turo-handoff-close used "key" with src cron.
update bestly_agents set pulse = '{"src":"pi_job","key":"charge_stop","gap":15}'::jsonb, updated_at = now() where slug = 'plug-puller';
update bestly_agents set pulse = '{"src":"cron","job":"car-charge-tick","gap":10,"also":["car-charge-watchdog"]}'::jsonb, updated_at = now() where slug = 'charge-watch';
update bestly_agents set pulse = '{"src":"cron","job":"turo-handoff-tick","gap":10}'::jsonb, updated_at = now() where slug = 'turo-handoff-close';
-- home-narrator waited on a beat nothing writes; its two every-minute database schedules are the real evidence.
update bestly_agents set pulse = '{"src":"cron","job":"ha-incident-live","gap":10,"also":["ha-push-dispatch"]}'::jsonb, updated_at = now() where slug = 'home-narrator';
-- cy-pipeline: "on Make.com" had pulse none, but cy-autofix-sweep runs every 15 min in the database.
update bestly_agents set pulse = pulse || '{"src":"cron","job":"cy-autofix-sweep","gap":40}'::jsonb, updated_at = now() where slug = 'cy-pipeline';
-- wall-tv-app / wall-mac-renderer used src "pi", which team_pulses() does not know. The wall row reports the foreground app.
update bestly_agents set pulse = jsonb_build_object('src','at','table','wall_state','col','status_at','where','id = 1','gap',10,
         'ok', $q$(status->>'top') like 'tech.bestly.wall%'$q$,
         'sum', $q$'Foreground: ' || coalesce(status->>'top','unknown')$q$), updated_at = now() where slug = 'wall-tv-app';

-- 2. Realistic gaps for weekly agents (8 days = 11520 min; their last beat can be up to 7 days + the run time old) ----------
update bestly_agents set pulse = pulse || '{"gap":11520}'::jsonb, updated_at = now()
 where slug in ('improver','hr','cost-cutter','turo-car-facts','mercury-sync','pi-cy-maker','rg-review','ava-contacts');

-- Team Watch owns the bridge schedule below so the Roster Scanner does not flag it as nobody's.
update bestly_agents set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also','[]'::jsonb) || '["team-beat-bridge"]'::jsonb), updated_at = now()
 where slug = 'team-watch' and not coalesce(pulse->'also','[]'::jsonb) ? 'team-beat-bridge';

-- 3. The bridge -------------------------------------------------------------------------------------------------------
-- Copies "last proven check-in" (as team_pulses() already computes it) into agent_beats, only when newer. agent_beats is a
-- durable cache, so a weekly job still shows as working on day 4 when cron.job_run_details no longer has its run.
-- Never writes for src none/beat, never writes a null time, never invents a run.
create or replace function public.team_beat_bridge() returns jsonb
language plpgsql security definer set search_path to 'public', 'cron' as $$
declare r record; v_n int := 0; v_rows int;
begin
  for r in
    select p.slug, p.last_at, p.last_ok, p.summary
      from team_pulses() p join bestly_agents a on a.slug = p.slug
     where a.status in ('active','new') and a.kind = 'agent'
       and coalesce(a.pulse->>'src','none') not in ('none','beat')
       and p.last_at is not null
  loop
    insert into agent_beats (slug, at, ok, summary)
    values (r.slug, r.last_at, coalesce(r.last_ok, true), left(coalesce(nullif(r.summary,''), 'Ran on its schedule'), 500))
    on conflict (slug) do update set at = excluded.at, ok = excluded.ok, summary = excluded.summary
      where agent_beats.at < excluded.at;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end loop;
  return jsonb_build_object('ok', true, 'copied', v_n);
end $$;
revoke all on function public.team_beat_bridge() from public, anon, authenticated;

select cron.schedule('team-beat-bridge', '11,41 * * * *', $$select public.team_beat_bridge()$$);

-- 4. Claude scheduled tasks: record the last real outcome from the scheduler (list_triggers), never a guess -----------------
insert into agent_beats (slug, at, ok, summary) values
 ('mercury-sync',       '2026-10-05 15:04:42+00', true,  'Claude task ran OK (from the scheduler history; the task has no check-in step yet)'),
 ('job-finder',         '2026-10-10 14:02:39+00', false, 'Claude task did not run: Claude usage limit reached'),
 ('model-y-hunt',       '2026-10-10 14:57:13+00', false, 'Claude task did not run: Claude usage limit reached'),
 ('roofguard-outreach', '2026-10-09 16:11:28+00', false, 'Claude task did not run: Claude usage limit reached'),
 ('icloud-cleanup',     '2026-10-10 13:05:14+00', false, 'Claude task did not run: Claude usage limit reached')
on conflict (slug) do update set at = excluded.at, ok = excluded.ok, summary = excluded.summary where agent_beats.at < excluded.at;
-- these three had pulse none; a daily/weekday beat gap lets the page say "ran and failed" instead of "unknown"
update bestly_agents set pulse = '{"src":"beat","gap":1500}'::jsonb, updated_at = now() where slug in ('job-finder','model-y-hunt') and coalesce(pulse->>'src','none') = 'none';
update bestly_agents set pulse = '{"src":"beat","gap":4400}'::jsonb, updated_at = now() where slug = 'roofguard-outreach' and coalesce(pulse->>'src','none') = 'none';

-- 5. No job found anywhere (checked 2026-10-11: pi_jobs, cron.job, mac_agents, edge schedules, every enabled Claude task) -----
--    health stays "unknown"; Team Watch only alerts on red, so this cannot flood. Whoever builds the job adds a real pulse.
update bestly_agents set pulse = coalesce(pulse,'{}'::jsonb) || '{"note":"no job found (checked 2026-10-11)"}'::jsonb, updated_at = now()
 where slug in ('elevenlabs-voice','laundry-watch','wall-mac-renderer','team-watch-ping','turo-watch-report');

select public.scout_notify('Team: 5 employees have no job I can find',
  'Elevenlabs Voice, Laundry Watch, Wall Renderer (Mac mini), Team Watch Backup and Turo Watch Report show no schedule, Pi job, database job or enabled Claude task. They stay grey on the Team page until someone gives them a job to check in from.',
  'info', false, '/admin/team', 'team.noschedule.20261011');
