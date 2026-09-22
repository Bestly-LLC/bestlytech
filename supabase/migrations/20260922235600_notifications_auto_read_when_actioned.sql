-- A bell that still shows things Jared has already dealt with is noise. Two rules.

-- 1. A newer notification about the same thing supersedes the older unread ones:
--    "Fixed: cron X is failing" arrives and the alert under it goes quiet on its
--    own. 'scout' is a catch-all bucket for unrelated notes, so it is left alone.
create or replace function public.admin_notifications_supersede()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.entity_key is null or new.entity_key = 'scout' then return new; end if;
  update admin_notifications
     set read_at = now()
   where entity_key = new.entity_key
     and kind = new.kind
     and id <> new.id
     and read_at is null;
  return new;
end $$;

drop trigger if exists admin_notifications_supersede on public.admin_notifications;
create trigger admin_notifications_supersede
  after insert on public.admin_notifications
  for each row execute function public.admin_notifications_supersede();

-- 2. "Tap Run to let me: <job>" is answered the moment the job leaves 'proposed' -
--    he tapped Run, or it was cancelled or expired. Either way the ask is spent.
create or replace function public.mac_job_clears_its_nudge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and old.status = 'proposed' then
    update admin_notifications
       set read_at = now()
     where read_at is null
       and kind in ('scout', 'scout.push')
       and title = 'Tap Run to let me: ' || new.title;
  end if;
  return new;
end $$;

drop trigger if exists mac_job_clears_its_nudge on public.mac_jobs;
create trigger mac_job_clears_its_nudge
  after update on public.mac_jobs
  for each row execute function public.mac_job_clears_its_nudge();
