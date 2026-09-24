-- A Mac job that fails and is then fixed by Scout's next try left its "Failed on the Mac mini" bell
-- unread forever. admin_today() kept ranking it, and scout-daily picked it as a to-do a day later
-- ("Resolve git conflict in hoku-clean and push headers" - fixed 30 seconds after it failed).
-- Now: when a job finishes done, unread failure bells from the same chat in the last 24h about the
-- same thing (title word overlap) are marked read. Different work in the same chat is left alone.

create or replace function public.mac_job_title_words(p text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct w), '{}') from (
    select regexp_replace(w, 's$', '') w
    from regexp_split_to_table(lower(coalesce(p, '')), '[^a-z0-9]+') w
    where length(w) >= 4
      and w not in ('find','check','with','from','then','that','this','what','where','which','into',
                    'bestly','tech','again','first','make','sure','look','show','list','read')
  ) x $$;

create or replace function public.mac_job_clear_superseded(p_job uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  j record; v_n int := 0; b record; mine text[]; theirs text[]; hit int;
begin
  select id, thread_id, title, finished_at into j from mac_jobs where id = p_job and status = 'done';
  if j.id is null or j.thread_id is null then return 0; end if;
  mine := mac_job_title_words(j.title);
  for b in
    select n.id, f.title
    from admin_notifications n
    join mac_jobs f on n.dedupe_key = 'mac_job.finished.' || f.id
    where n.read_at is null and f.status = 'failed' and f.thread_id = j.thread_id
      and f.id <> j.id and f.created_at <= coalesce(j.finished_at, now())
      and f.created_at > coalesce(j.finished_at, now()) - interval '24 hours'
  loop
    theirs := mac_job_title_words(b.title);
    select count(*) into hit from unnest(theirs) w where w = any(mine);
    if hit >= least(2, greatest(1, ceil(cardinality(theirs) / 2.0)::int)) then
      update admin_notifications set read_at = now() where id = b.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.mac_job_clear_superseded(uuid) from public, anon, authenticated;
revoke all on function public.mac_job_title_words(text) from public, anon, authenticated;

create or replace function public.mac_jobs_notify()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ran_for numeric;
begin
  if tg_op = 'INSERT' then
    -- This one is an actual request for his attention: it cannot run without a tap.
    perform scout_notify('Tap Run to let me: ' || new.title,
                         coalesce(new.why, 'A job for the Mac mini is waiting for your OK.'),
                         'info', true, '/admin?scout=open', 'mac_job.proposed.' || new.id);

  elsif new.status in ('done','failed') and old.status = 'running' then
    ran_for := extract(epoch from (coalesce(new.finished_at, now()) - coalesce(new.started_at, new.created_at)));

    if new.status = 'failed' then
      perform scout_notify('Failed on the Mac mini: ' || new.title,
                           right(coalesce(new.output, ''), 400),
                           'warning', false, '/admin?scout=open', 'mac_job.finished.' || new.id);
    else
      -- A retry that worked retires the failure it replaced.
      perform mac_job_clear_superseded(new.id);
      if ran_for >= 90 then
        -- Long enough that he probably went and did something else.
        perform scout_notify('Done on the Mac mini: ' || new.title,
                             right(coalesce(new.output, ''), 400),
                             'info', false, '/admin?scout=open', 'mac_job.finished.' || new.id);
      end if;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'mac_jobs_notify: %', sqlerrm;
  return new;
end $function$;
