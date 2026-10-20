-- Hermes, Mail Clerk (2026-10-19, Jared) -- part 4 of 4: Team card, Pi job row, watchdog

-- Team page: extend the existing Hermes card (it was the iCloud inbox cleaner). One employee, two mail jobs. ---------------------
update public.bestly_agents set
  role = 'Mail Clerk',
  what_it_does = 'Sorts the mail. Reads the iPostal1 alerts for the Los Angeles virtual mailbox the moment they land, so you never see them: names the sender, types it (bill, check, government, bank, legal, junk, package), files it and logs it. Free reading and sorting only. Any paid iPostal1 step (open and scan, shred, forward, recycle, check deposit, package handling) waits for your one tap in Needs you. Pings you only for money, government or legal mail. Also keeps jaredbest@icloud.com clean every morning: moves confirmed promo mail to the Trash (recoverable for 30 days) and queues the Hide My Email alias behind each dead sender. Took over the iCloud job on 2026-10-14; took over iPostal1 on 2026-10-19.',
  dept = 'mail', reports_to = 'mail-bridge', runs_on = 'pi',
  schedule = 'every 5 min; iCloud daily at 6:05 AM PT',
  icon = 'mail-x', admin_url = '/admin/team?hermes=1', sort = 71,
  pulse = '{"gap": 20, "key": "hermes_mailroom", "src": "pi_job", "alert": true, "also": ["inbox-cleaner"]}'::jsonb,
  updated_at = now()
where slug = 'hermes';

insert into public.notification_owners (prefix, agent_slug, note)
select x, 'hermes', 'Hermes mail clerk (2026-10-19)' from unnest(array['hermes', 'ipostal1', 'mailroom']) x
 where not exists (select 1 from public.notification_owners o where o.prefix = x);

insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('hermes_mailroom', 'Hermes (Mail Clerk): reads the Mailroom folder (iPostal1 alerts), files and labels them, runs only the actions Jared approved, restarts its mail guard if that stops', 20, true)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min;

-- Watchdog (wired to Scout). The Pi job restarts a dead guard itself; this is the second pair of eyes when that fails. -----------
create or replace function public.hermes_watch() returns text
language plpgsql security definer set search_path to 'public' as $$
declare s public.hermes_state; r record; v_out text := ''; n int;
begin
  select * into s from public.hermes_state where id;
  if not s.enabled then return 'off'; end if;

  -- the mail guard keeps iPostal1 mail out of the inbox; the Mailroom job restarts it at 10 minutes, we shout at 20
  if s.baseline_at < now() - interval '30 minutes' and (s.guard_beat_at is null or s.guard_beat_at < now() - interval '20 minutes') then
    perform public.scout_notify(p_title => 'Scout: Hermes'' mail guard is still down after a restart',
      p_body => 'iPostal1 emails may show up in your inbox until it is back. The Pi service is bestly-hermes-guard.',
      p_severity => 'error', p_push => true, p_url => '/admin/team?hermes=1',
      p_dedupe => 'hermes-guard-' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDDHH24'));
    v_out := v_out || 'guard-stale ';
  end if;

  -- a click that never reported back: do not retry a paid action blind
  update public.hermes_actions set status = 'failed', finished_at = now(), lease_until = null,
         error = 'Hermes lost contact while this was running, so the result is not confirmed'
   where status = 'running' and lease_until < now();
  get diagnostics n = row_count;
  if n > 0 then v_out := v_out || n || ' stuck '; end if;

  -- asks nobody tapped for two weeks, and approvals that never ran in a day, expire
  update public.hermes_actions set status = 'expired', finished_at = now()
   where (status = 'proposed' and proposed_at < now() - interval '14 days')
      or (status = 'approved' and decided_at < now() - interval '24 hours');
  update public.hermes_items i set status = 'filed' where i.status = 'asked'
     and not exists (select 1 from public.hermes_actions a where a.item_id = i.id and a.status in ('proposed','approved','running'));

  -- Ares: an iPostal1 sign-in or security notice with no Hermes login around it is somebody else
  for r in
    select i.id, i.received_at from public.hermes_items i
     where i.event = 'security' and i.verified and not i.is_test and coalesce(i.details->>'backfill', 'false') <> 'true'
       and i.details->>'ares' is null and i.created_at > now() - interval '3 days' and i.created_at < now() - interval '10 minutes'
  loop
    if exists (select 1 from public.hermes_logins l where l.at between r.received_at - interval '30 minutes' and r.received_at + interval '15 minutes') then
      update public.hermes_items set details = details || '{"ares":"was_hermes"}' where id = r.id;
    else
      update public.hermes_items set details = details || '{"ares":"alerted"}' where id = r.id;
      perform public.hermes_alert('hermes:ares:' || r.id::text, 'Ares: Suspicious iPostal1 account alert. Check it was you',
        'iPostal1 sent a sign-in or security notice at ' || to_char(r.received_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM')
        || ' and Hermes did not sign in around then.', '/admin/security', false);
      v_out := v_out || 'ares-alert ';
    end if;
  end loop;

  -- three refused or failed sign-ins in a row from Hermes: say so once a day (the Needs you row already asks for a new login)
  return coalesce(nullif(btrim(v_out), ''), 'ok');
end $$;
revoke all on function public.hermes_watch() from public, anon, authenticated;
grant execute on function public.hermes_watch() to service_role;

do $c$
begin
  if not exists (select 1 from cron.job where jobname = 'hermes-watch') then
    perform cron.schedule('hermes-watch', '*/5 * * * *', 'select public.hermes_watch()');
  end if;
end
$c$;
