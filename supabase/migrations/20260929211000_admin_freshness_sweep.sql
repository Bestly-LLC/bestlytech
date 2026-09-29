-- Admin freshness (2026-09-29): one definition of "fresh", applied every 10 minutes, watched hourly by Scout.
-- Plan: docs/admin-freshness-2026-09-29-opusplan.md. Nothing is deleted; aged rows become 'expired' / read.

create or replace function public.admin_freshness_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  n int;
  s jsonb := '{}'::jsonb;
begin
  -- Picks belong to their day. Yesterday's stay until today's morning picks exist; older ones always go.
  -- (Scout's morning run still sees unfinished work as candidates and re-picks it fresh.)
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'pick' and status in ('open', 'snoozed')
     and (day < v_today - 1
          or (day < v_today and exists (select 1 from scout_daily t where t.kind = 'pick' and t.day = v_today)));
  get diagnostics n = row_count; s := s || jsonb_build_object('picks', n);

  -- The wrap is only today's.
  update scout_daily set status = 'done', done_at = now()
   where kind = 'wrap' and status = 'open' and day < v_today;
  get diagnostics n = row_count; s := s || jsonb_build_object('wraps', n);

  -- Email reply drafts: 3 days after the mail they answer; a newer draft for the same subject replaces an older one.
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'draft' and status = 'open' and day < v_today - 3;
  get diagnostics n = row_count; s := s || jsonb_build_object('drafts_old', n);
  update scout_daily d set status = 'expired', done_at = now()
   where d.kind = 'draft' and d.status = 'open'
     and exists (select 1 from scout_daily e where e.kind = 'draft' and e.status = 'open' and e.id <> d.id
                   and lower(e.title) = lower(d.title) and (e.created_at, e.id) > (d.created_at, d.id));
  get diagnostics n = row_count; s := s || jsonb_build_object('drafts_dup', n);

  -- Meeting to-dos are real work: only near-identical duplicates (same owner, within 3 days) collapse to the newest,
  -- and to-dos untouched for 21 days age out.
  update scout_daily d set status = 'expired', done_at = now(),
         action = coalesce(d.action, '{}'::jsonb) || jsonb_build_object('expired_why', 'duplicate', 'dup_of', e.id)
    from scout_daily e
   where d.kind = 'call' and e.kind = 'call' and d.status = 'open' and e.status = 'open' and d.id <> e.id
     and lower(coalesce(d.action->>'owner', 'jared')) = lower(coalesce(e.action->>'owner', 'jared'))
     and abs(d.day - e.day) <= 3
     and (e.created_at, e.id) > (d.created_at, d.id)
     and extensions.similarity(lower(d.title), lower(e.title)) >= 0.6;
  get diagnostics n = row_count; s := s || jsonb_build_object('calls_dup', n);
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'call' and status = 'open' and day < v_today - 21;
  get diagnostics n = row_count; s := s || jsonb_build_object('calls_old', n);

  -- Bell: FYIs clear themselves. Silent after 1 h, success/info after 12 h, warnings after 3 days, anything after 7 days.
  -- (A problem card is also cleared the moment its issue resolves - bestly_raise already does that for monitor cards.)
  update admin_notifications set read_at = now()
   where read_at is null
     and ((silent and created_at < now() - interval '1 hour')
          or (severity in ('success', 'info') and created_at < now() - interval '12 hours')
          or (severity = 'warning' and created_at < now() - interval '3 days')
          or created_at < now() - interval '7 days');
  get diagnostics n = row_count; s := s || jsonb_build_object('bell_read', n);

  insert into admin_freshness_runs (stats) values (s);
  delete from admin_freshness_runs where at < now() - interval '14 days';
  return s;
end $$;
revoke all on function public.admin_freshness_sweep() from public, anon, authenticated;

-- Hourly Scout watchdog: the sweep must be running and the admin must actually be fresh; self-heals by sweeping.
create or replace function public.admin_freshness_watch()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_last timestamptz := (select max(at) from admin_freshness_runs);
  v_old_picks int; v_old_bell int; v_ha_hour int; v_guard jsonb; v_heal jsonb := null; v_bad text[] := '{}';
begin
  if v_last is null or v_last < now() - interval '30 minutes' then
    v_heal := admin_freshness_sweep();
    v_bad := v_bad || format('the 10-minute cleanup had not run since %s', coalesce(to_char(v_last at time zone 'America/Los_Angeles', 'FMHH12:MI AM'), 'ever'));
  end if;
  select count(*) into v_old_picks from scout_daily where kind = 'pick' and status = 'open' and day < v_today - 1;
  select count(*) into v_old_bell from admin_notifications where read_at is null and severity in ('success', 'info') and created_at < now() - interval '1 day';
  select count(*) into v_ha_hour from scout_daily where source_key like 'ha:%' and created_at > now() - interval '1 hour';
  select stats->'guard' into v_guard from ha_todo_sync_status where id = 1;
  if v_old_picks > 0 or v_old_bell > 0 then
    v_heal := admin_freshness_sweep();
    v_bad := v_bad || format('%s old picks / %s old FYIs were still showing', v_old_picks, v_old_bell);
  end if;
  if v_ha_hour > 30 then
    v_bad := v_bad || format('the Home Assistant to-do sync created %s to-dos in the last hour (a loop)', v_ha_hour);
  end if;
  if jsonb_typeof(v_guard) = 'array' and jsonb_array_length(v_guard) > 0 then
    v_bad := v_bad || format('the Home Assistant sync stopped touching %s to-do(s) that kept flipping', jsonb_array_length(v_guard));
  end if;
  if array_length(v_bad, 1) > 0 then
    perform bestly_raise('admin.freshness', 'problem', 'warning', 'Admin to-dos or alerts went stale',
      'Freshness check: ' || array_to_string(v_bad, '; ') || '. The cleanup ran again on its own.'
        || case when v_ha_hour > 30 or (jsonb_typeof(v_guard) = 'array' and jsonb_array_length(v_guard) > 0)
                then ' The Home Assistant loop needs a look: send this to Claude.' else '' end,
      'admin', null, v_heal is not null);
  else
    perform bestly_raise('admin.freshness', 'resolved', 'info', 'Admin to-dos and alerts are fresh',
      'Old picks, drafts and FYIs clear themselves on schedule.', 'admin', null, false);
  end if;
  return jsonb_build_object('last_run', v_last, 'old_picks', v_old_picks, 'old_bell', v_old_bell, 'ha_hour', v_ha_hour, 'healed', v_heal);
end $$;
revoke all on function public.admin_freshness_watch() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('admin-freshness-sweep', 'admin-freshness-watch');
select cron.schedule('admin-freshness-sweep', '*/10 * * * *', $$select public.admin_freshness_sweep()$$);
select cron.schedule('admin-freshness-watch', '17 * * * *', $$select public.admin_freshness_watch()$$);
