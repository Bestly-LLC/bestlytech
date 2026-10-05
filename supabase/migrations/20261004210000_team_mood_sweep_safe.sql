-- 2026-10-04 Watchdog for team moods: a mood error must never stop the roll call (team_watch) that runs right after it
-- in the same org-chart-watch cron job. Failures raise team.moods.error to Scout / the Fix Ladder; it resolves itself on
-- the next good sweep.
create or replace function public.team_mood_sweep_safe() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  r := team_mood_sweep();
  if exists (select 1 from monitor_issues where key = 'team.moods.error' and status = 'open') then
    perform bestly_raise('team.moods.error', 'resolved', 'info', 'Team moods are updating again');
  end if;
  return r;
exception when others then
  perform bestly_raise('team.moods.error', 'problem', 'warning', 'Team moods stopped updating',
    'team_mood_sweep failed: ' || left(sqlerrm, 300) || '. The roll call still ran. Moods and strikes on the Team page are stale until this is fixed.',
    'team', null, false);
  return jsonb_build_object('error', left(sqlerrm, 300));
end $$;
revoke all on function public.team_mood_sweep_safe() from public, anon, authenticated;

select cron.schedule('org-chart-watch', '7-59/10 * * * *',
  $$select public.team_mood_sweep_safe(); select public.team_watch(); select public.team_welcome_sweep(); select public.hire_training_sweep();$$);
