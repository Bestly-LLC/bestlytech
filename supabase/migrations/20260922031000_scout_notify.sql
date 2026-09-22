-- Scout talks to Jared outside the chat: the admin bell for everything,
-- a phone push (ntfy, quiet hours respected) for what needs him.

create or replace function public.scout_notify(
  p_title text, p_body text default null, p_severity text default 'info',
  p_push boolean default false, p_url text default '/admin?scout=open', p_dedupe text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sev text := case when p_severity in ('critical','warning','info') then p_severity else 'info' end;
  v_recent int;
  v_pushed boolean := false;
begin
  if p_dedupe is not null and exists (select 1 from admin_notifications where dedupe_key = p_dedupe) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  -- At most 6 Scout pushes an hour, so a loop can never spam his phone.
  if p_push then
    select count(*) into v_recent from admin_notifications
      where kind = 'scout.push' and created_at > now() - interval '1 hour';
    if v_recent < 6 then
      perform bestly_ntfy('Scout: ' || left(p_title, 180), coalesce(p_body, ''),
        case v_sev when 'critical' then 5 when 'warning' then 4 else 3 end, array['eyes']);
      v_pushed := true;
    end if;
  end if;
  perform admin_notify(case when v_pushed then 'scout.push' else 'scout' end, p_title, coalesce(p_body, ''),
                       p_url, 'scout', v_sev, p_dedupe);
  return jsonb_build_object('ok', true, 'pushed', v_pushed, 'push_capped', p_push and not v_pushed);
end $$;
revoke all on function public.scout_notify(text, text, text, boolean, text, text) from public, anon, authenticated;

-- A proposed Mac job is a decision waiting on him: push it. A finished one goes to the bell.
create or replace function public.mac_jobs_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform scout_notify('Tap Run to let me: ' || new.title, coalesce(new.why, 'A job for the Mac mini is waiting for your OK.'),
                         'info', true, '/admin?scout=open', 'mac_job.proposed.' || new.id);
  elsif new.status in ('done','failed') and old.status = 'running' then
    perform scout_notify(case when new.status = 'done' then 'Done on the Mac mini: ' else 'Failed on the Mac mini: ' end || new.title,
                         right(coalesce(new.output, ''), 400),
                         case when new.status = 'done' then 'info' else 'warning' end, false,
                         '/admin?scout=open', 'mac_job.finished.' || new.id);
  end if;
  return new;
exception when others then
  raise warning 'mac_jobs_notify: %', sqlerrm;
  return new;
end $$;
revoke all on function public.mac_jobs_notify() from public, anon, authenticated;
create trigger mac_jobs_notify after insert or update of status on public.mac_jobs
  for each row execute function public.mac_jobs_notify();

-- Morning nudge, 9am Pacific: one push listing what is waiting on him, only if something is.
create or replace function public.scout_digest() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_urgent int; v_waiting int; v_jobs int; v_inc int; v_lines text := '';
begin
  select count(*) filter (where rank <= 1), count(*) filter (where rank between 2 and 3)
    into v_urgent, v_waiting from admin_today();
  select count(*) into v_jobs from mac_jobs where status = 'proposed';
  select count(*) into v_inc from monitor_issues where status = 'open' and needs_jared is not null;
  if v_urgent + v_jobs + v_inc = 0 and v_waiting = 0 then
    return jsonb_build_object('ok', true, 'sent', false);
  end if;
  if v_urgent > 0 then v_lines := v_lines || v_urgent || ' broken or stopped. '; end if;
  if v_inc > 0 then v_lines := v_lines || v_inc || ' incident(s) need you. '; end if;
  if v_jobs > 0 then v_lines := v_lines || v_jobs || ' job(s) waiting for Run. '; end if;
  if v_waiting > 0 then v_lines := v_lines || v_waiting || ' waiting on a decision.'; end if;
  return scout_notify('Morning. ' || (v_urgent + v_jobs + v_inc + v_waiting) || ' thing(s) waiting on you',
                      trim(v_lines), case when v_urgent > 0 then 'warning' else 'info' end,
                      v_urgent + v_jobs + v_inc > 0, '/admin?scout=open',
                      'scout.digest.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'));
end $$;
revoke all on function public.scout_digest() from public, anon, authenticated;
select cron.schedule('scout-digest', '0 16 * * *', $$select public.scout_digest()$$);
