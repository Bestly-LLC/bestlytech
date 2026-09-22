-- Fix ladder: every open monitor incident climbs auto-fix -> free AI (Mac mini, Ollama) -> Scout
-- (paid, autopilot: no action that needs a yes) -> a ready-to-paste prompt for Claude.
-- When anything fixes it, the bell says "Fixed: <what>" with what did it.

-- 0. A real bug the ladder found first: mac_agent_watchdog inserted severity 'error', which the
--    bell's check constraint refuses, so the cron job failed every 15 minutes. monitor_tick already
--    raises agent.<name> for a stranded Mac (with push + one bell card), so the watchdog only clears now.
create or replace function public.mac_agent_watchdog()
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in select * from public.mac_agents loop
    if extract(epoch from (now() - coalesce(a.last_seen_at, a.created_at))) / 60.0 <= 45 then
      update public.admin_notifications set read_at = now()
       where kind = 'mac_agent' and entity_key = a.name and read_at is null;
    end if;
  end loop;
end $$;

-- 1. Ladder state on the incident itself.
alter table public.monitor_issues
  add column if not exists fix_stage text not null default 'auto',
  add column if not exists fix_log jsonb not null default '[]'::jsonb,
  add column if not exists fix_note text,
  add column if not exists ai_diagnosis text,
  add column if not exists scout_ask text,
  add column if not exists claude_prompt text,
  add column if not exists fix_next_at timestamptz;
do $$ begin
  alter table public.monitor_issues add constraint monitor_issues_fix_stage_check
    check (fix_stage in ('auto','free_ai','scout','needs_yes','claude','fixed'));
exception when duplicate_object then null; end $$;
update public.monitor_issues set fix_stage = 'fixed' where status = 'resolved' and fix_stage = 'auto';

create or replace function public.fix_log_add(p_key text, p_by text, p_text text, p_ok boolean default null)
returns void language sql security definer set search_path = public as $$
  update monitor_issues
     set fix_log = fix_log || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'text', left(p_text, 1200), 'ok', p_ok))
   where key = p_key;
$$;
revoke all on function public.fix_log_add(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.fix_log_add(text, text, text, boolean) to service_role;

-- 2. Opening resets the ladder; resolving writes the "what fixed it" note.
create or replace function public.monitor_issue_ladder()
returns trigger language plpgsql set search_path = public as $$
declare last_ok text; last_by text;
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    new.fix_stage := 'auto'; new.fix_log := '[]'::jsonb; new.fix_note := null; new.ai_diagnosis := null;
    new.scout_ask := null; new.claude_prompt := null; new.fix_next_at := now();
  elsif tg_op = 'UPDATE' and new.status = 'resolved' and old.status = 'open' then
    select e->>'text', e->>'by' into last_ok, last_by
      from jsonb_array_elements(new.fix_log) with ordinality x(e, i)
     where (e->>'ok')::boolean is true order by i desc limit 1;
    new.fix_stage := 'fixed';
    new.fix_note := coalesce(
      case when last_ok is not null then initcap(replace(coalesce(last_by,'auto'),'_',' ')) || ': ' || last_ok end,
      case when coalesce(new.heal_attempts,0) > 0
           then 'Auto-fix retried it ' || new.heal_attempts || ' time' || case when new.heal_attempts = 1 then '' else 's' end || ' until it cleared.' end,
      'It cleared on its own (the check passes again). Nothing needed from you.');
  end if;
  return new;
end $$;
drop trigger if exists trg_monitor_issue_ladder on public.monitor_issues;
create trigger trg_monitor_issue_ladder before insert or update of status on public.monitor_issues
  for each row execute function public.monitor_issue_ladder();

-- 3. Bell cards say where the ladder is. "Fixed: X" + what fixed it; open cards end with the next step.
create or replace function public.monitor_bell_words()
returns trigger language plpgsql set search_path = public as $$
declare iss public.monitor_issues;
begin
  if new.kind <> 'monitor' or new.entity_key not like 'monitor:%' then return new; end if;
  select * into iss from monitor_issues where key = substr(new.entity_key, 9);
  if iss.key is null then return new; end if;
  if new.severity = 'success' then
    if tg_op = 'INSERT' then
      new.title := left('Fixed: ' || coalesce(iss.title, new.title), 200);
      new.body := left(coalesce(iss.fix_note, new.body, ''), 600);
    end if;
    return new;
  end if;
  new.body := regexp_replace(coalesce(new.body, ''), ' · Next: .*$', '');
  new.body := left(new.body || case iss.fix_stage
      when 'needs_yes' then ' · Next: Scout found the fix and needs your yes. Open to approve.'
      when 'claude' then ' · Next: every AI tried. Open to copy a ready prompt for Claude.'
      when 'free_ai' then ' · Next: the free AI is looking at it.'
      when 'scout' then ' · Next: Scout is working on it.'
      else '' end, 600);
  return new;
end $$;
drop trigger if exists trg_monitor_bell_words on public.admin_notifications;
create trigger trg_monitor_bell_words before insert or update of body, severity on public.admin_notifications
  for each row execute function public.monitor_bell_words();

-- 4. Free AI jobs for the Mac mini worker (same key as the partner assistant).
create table if not exists public.fix_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  issue_key text not null,
  prompt text not null,
  status text not null default 'pending' check (status in ('pending','claimed','done','error')),
  answer text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz
);
alter table public.fix_ai_jobs enable row level security;
create index if not exists fix_ai_jobs_pending on public.fix_ai_jobs (created_at) where status = 'pending';

create or replace function public.fix_ai_claim(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.fix_ai_jobs;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update fix_ai_jobs set status = 'pending', claimed_at = null where status = 'claimed' and claimed_at < now() - interval '6 minutes';
  select * into j from fix_ai_jobs where status = 'pending' order by created_at limit 1 for update skip locked;
  if j.id is null then return null; end if;
  update fix_ai_jobs set status = 'claimed', claimed_at = now() where id = j.id;
  return jsonb_build_object('id', j.id, 'prompt', j.prompt);
end $$;

create or replace function public.fix_ai_write(p_key text, p_id uuid, p_answer text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update fix_ai_jobs set status = case when p_error is null then 'done' else 'error' end,
         answer = left(coalesce(p_answer, p_error), 8000), done_at = now()
   where id = p_id;
end $$;
revoke all on function public.fix_ai_claim(text) from public;
revoke all on function public.fix_ai_write(text, uuid, text, text) from public;
grant execute on function public.fix_ai_claim(text) to anon, authenticated, service_role;
grant execute on function public.fix_ai_write(text, uuid, text, text) to anon, authenticated, service_role;

-- 5. The climb runs every 10 minutes (and on "Try again now" from the alert pane).
select cron.unschedule('fix-ladder') where exists (select 1 from cron.job where jobname = 'fix-ladder');
select cron.schedule('fix-ladder', '3-59/10 * * * *',
  $$ select public.invoke_edge_function('fix-ladder', '{"op":"tick"}'::jsonb, 150000) $$);

-- 6. The last error a cron job printed, for the ladder's context (and the Claude prompt).
create or replace function public.fix_cron_last_error(p_job text)
returns text language sql security definer set search_path = public, cron as $$
  select left(d.return_message, 1500) from cron.job j join cron.job_run_details d on d.jobid = j.jobid
   where j.jobname = p_job and d.status = 'failed' order by d.end_time desc nulls last limit 1;
$$;
revoke all on function public.fix_cron_last_error(text) from public, anon, authenticated;
grant execute on function public.fix_cron_last_error(text) to service_role;

-- 7. Playbook helper: the missing-grant fix (only for RLS tables and views).
create or replace function public.fix_grant_select(p_table text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = p_table
               and (c.relkind = 'v' or (c.relkind = 'r' and c.relrowsecurity))) then
    execute format('grant select on public.%I to authenticated', p_table);
    return true;
  end if;
  return false;
end $$;
revoke all on function public.fix_grant_select(text) from public, anon, authenticated;
grant execute on function public.fix_grant_select(text) to service_role;
