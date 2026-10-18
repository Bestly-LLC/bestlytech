-- Lane M (2026-10-18): the call recorder on the Mac mini gets a dead-man switch. The Mac watches the calls and tells Scout when
-- something is wrong, but if the Mac (or the agent) is simply gone nothing can tell Scout. This runs on the server every 5 minutes:
-- no poll from the agent for 15 minutes raises recorder.offline (owner: Scout Notetaker, by the 'recorder' prefix in
-- notification_owners), and the first poll after that resolves it.
-- Rollback: select cron.unschedule('recorder-offline-watch'); drop function public.recorder_offline_watch();
create or replace function public.recorder_offline_watch() returns void
language plpgsql security definer set search_path = public as $$
declare
  seen timestamptz;
  mins numeric;
  since text;
begin
  select last_seen_at into seen from public.meeting_recorder_state where id = 1;
  mins := extract(epoch from (now() - coalesce(seen, 'epoch'::timestamptz))) / 60.0;
  if mins >= 15 then
    since := coalesce(to_char(seen at time zone 'America/Los_Angeles', 'FMHH12:MI AM on Mon FMDD'), 'a long time ago');
    perform public.bestly_raise(
      'recorder.offline', 'problem', 'error',
      'The call recorder on the Mac mini is not answering',
      'Scout has not heard from the recorder on the Mac mini since ' || since || ' (' || round(mins)::int || ' minutes ago). '
        || 'Until it is back, calls will not be recorded: not by Scout, and not by the Start Recording button either. '
        || 'Check that the Mac mini is on and logged in.',
      'recorder', null, false);
  else
    perform public.bestly_raise('recorder.offline', 'resolved', 'info', 'The call recorder is answering again', null, 'recorder', null, false);
  end if;
end $$;

select cron.schedule('recorder-offline-watch', '2-59/5 * * * *', 'select public.recorder_offline_watch()');
