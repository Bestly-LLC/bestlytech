-- Scout v30: the Paid AI switch is the ONE master control, and it always tells the truth.
-- APPLIED LIVE 2026-10-03 ~3:20 PM PT (piecewise via SQL); this file is the record.
--
-- Found 2026-10-03: the switch showed OFF while Scout spent $7.37 on Claude in a day. Tapping
-- "Yes, use paid AI" gave that one chat a hidden 1-hour pass (admin_chat_threads.paid_ok_until)
-- that the switch never showed, and Scout itself told Jared "paid_ai_ok is already off".
--
-- Now:
--   * scout_settings.paid_ai_ok is the only thing that lets Scout spend. No hidden per-chat passes.
--   * "Yes, use paid AI" flips the switch ON for one hour (paid_ai_until) - you see it flip.
--   * It flips itself OFF when that hour ends or the daily chat cap is hit (scout_paid_tick, every
--     minute, and on every scout_prefs read), with the reason on the switch.
--   * Turning it OFF kills any leftover per-chat pass at once.
--   * ai_budget('background') says no while it is OFF (Scout's background jobs). Chat scope is enforced
--     in admin-chat / free-llm.ts for Scout's functions. Spark (studio-chat) and Cookie Yeti are NOT governed.
--   * Watchdog scout_paid_watch (every 10 min): paid Scout spend while the switch was OFF = leak ->
--     force OFF, clear passes, raise ai.paid.leak to Scout. Also re-runs a missed tick.

alter table public.scout_settings add column if not exists paid_ai_until timestamptz;   -- null = on until turned off
alter table public.scout_settings add column if not exists paid_ai_off_reason text;     -- you | hour_up | cap | watchdog
alter table public.scout_settings add column if not exists paid_ai_changed_at timestamptz;

create table if not exists public.scout_paid_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  is_on boolean not null,
  until timestamptz,
  reason text,
  by_user uuid
);
create index if not exists scout_paid_log_at on public.scout_paid_log (at desc);
alter table public.scout_paid_log enable row level security;
drop policy if exists "Admins read paid log" on public.scout_paid_log;
create policy "Admins read paid log" on public.scout_paid_log for select to authenticated using (has_role(auth.uid(), 'admin'));
grant select on public.scout_paid_log to authenticated;
insert into public.scout_paid_log (is_on, until, reason)
select paid_ai_ok, paid_ai_until, 'v30 start' from public.scout_settings where id
  and not exists (select 1 from public.scout_paid_log);

-- Functions whose paid calls the switch governs.
create or replace function public.scout_paid_fns() returns text[] language sql immutable as $$
  select array['admin-chat','voice-ask','fix-ladder','scout-daily','todo-check','free-llm']::text[];
$$;

create or replace function public.scout_paid_spend() returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles') as since)
  select jsonb_build_object(
    'spent', round(coalesce((select sum(cost_usd) from ai_spend, d where at >= d.since and scope = 'chat'), 0), 2),
    'cap', coalesce((select chat_cap_usd from scout_settings where id), 5));
$$;

create or replace function public.scout_paid_state_ro() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'on', s.paid_ai_ok and (s.paid_ai_until is null or s.paid_ai_until > now())
          and (public.scout_paid_spend()->>'spent')::numeric < (public.scout_paid_spend()->>'cap')::numeric,
    'until', case when s.paid_ai_ok then s.paid_ai_until end,
    'off_reason', case when s.paid_ai_ok then null else s.paid_ai_off_reason end,
    'changed_at', s.paid_ai_changed_at,
    'spent', (public.scout_paid_spend()->>'spent')::numeric,
    'cap', (public.scout_paid_spend()->>'cap')::numeric)
  from scout_settings s where s.id;
$$;
revoke all on function public.scout_paid_state_ro() from public, anon;
grant execute on function public.scout_paid_state_ro() to authenticated, service_role;

create or replace function public.scout_paid_apply(p_on boolean, p_minutes int, p_reason text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_until timestamptz := case when p_on and p_minutes is not null and p_minutes > 0 then now() + make_interval(mins => p_minutes) end;
        v_was boolean;
begin
  select paid_ai_ok into v_was from scout_settings where id for update;
  update scout_settings
     set paid_ai_ok = p_on,
         paid_ai_until = v_until,
         paid_ai_off_reason = case when p_on then null else coalesce(p_reason, 'you') end,
         paid_ai_changed_at = now(),
         updated_at = now(),
         updated_by = coalesce(p_by, updated_by)
   where id;
  if not p_on then
    update admin_chat_threads set paid_ok = false, paid_ok_until = null where paid_ok_until is not null or paid_ok;
  end if;
  if v_was is distinct from p_on or p_on then
    insert into scout_paid_log (is_on, until, reason, by_user) values (p_on, v_until, coalesce(p_reason, case when p_on then 'on' else 'you' end), p_by);
  end if;
  return public.scout_paid_state_ro();
end $$;
revoke all on function public.scout_paid_apply(boolean, int, text, uuid) from public, anon, authenticated;
grant execute on function public.scout_paid_apply(boolean, int, text, uuid) to service_role;

create or replace function public.scout_paid_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; sp jsonb := public.scout_paid_spend(); why text;
begin
  select * into s from scout_settings where id;
  if s.paid_ai_ok then
    if s.paid_ai_until is not null and s.paid_ai_until <= now() then why := 'hour_up';
    elsif (sp->>'spent')::numeric >= (sp->>'cap')::numeric then why := 'cap';
    end if;
    if why is not null then
      perform public.scout_paid_apply(false, null, why, null);
      perform admin_notify('scout',
        case why when 'cap' then 'Paid AI switched off: daily cap hit' else 'Paid AI switched off: your hour is up' end,
        case why when 'cap' then format('Scout spent $%s of the $%s cap today. It is on free AI only until you turn it back on.', sp->>'spent', sp->>'cap')
                 else 'Scout is back on free AI only. Flip the switch or tap "Yes, use paid AI" if you need it again.' end,
        '/admin?scout=open', 'scout', 'info', 'paid-off-' || why || '-' || to_char(now(), 'YYYYMMDDHH24MI'));
    end if;
  end if;
  return public.scout_paid_state_ro();
end $$;
revoke all on function public.scout_paid_tick() from public, anon, authenticated;
grant execute on function public.scout_paid_tick() to service_role;

-- What the admin UI and Scout read. Ticks first, so it is never stale. paid_ai_ok = the truth, not the raw column.
create or replace function public.scout_prefs()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare st jsonb := public.scout_paid_tick();
begin
  return coalesce((select jsonb_build_object(
      'auto_run', auto_run,
      'paid_ai_ok', (st->>'on')::boolean,
      'paid_ai_until', st->'until',
      'paid_ai_off_reason', st->'off_reason',
      'paid_spent', st->'spent',
      'background_cap_usd', background_cap_usd, 'chat_cap_usd', chat_cap_usd) from scout_settings where id),
    '{"auto_run": false, "paid_ai_ok": false}'::jsonb);
end $$;

-- The admin switch.
create or replace function public.scout_paid_ai_set(p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return (public.scout_paid_apply(p_on, null, 'you', auth.uid())->>'on')::boolean;
end $$;

create or replace function public.ai_budget(p_scope text)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles') as since),
  s as (select coalesce(sum(cost_usd) filter (where scope = p_scope), 0) spent,
               coalesce(sum(cost_usd), 0) total
          from ai_spend, d where at >= d.since),
  c as (select coalesce((select case when p_scope = 'chat' then chat_cap_usd else background_cap_usd end from scout_settings where id), 1.00) cap),
  g as (select p_scope = 'background' as governed,
               coalesce((public.scout_paid_state_ro()->>'on')::boolean, false) as switch_on)
  select jsonb_build_object('scope', p_scope, 'spent', round(s.spent, 4), 'cap', c.cap,
                            'ok', s.spent < c.cap and (not g.governed or g.switch_on),
                            'switch_off', g.governed and not g.switch_on,
                            'total_today', round(s.total, 4))
    from s, c, g;
$$;

create or replace function public.scout_paid_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare leak record; s record; n int;
begin
  select * into s from scout_settings where id;
  if s.paid_ai_ok and s.paid_ai_until is not null and s.paid_ai_until < now() - interval '3 minutes' then
    perform public.scout_paid_tick();
    perform bestly_raise('ai.paid.tick', 'problem', 'warning', 'Paid AI switch was late turning off',
      'The every-minute check missed. Scout ran it itself and the switch is off now.', 'scout', null, true);
  end if;
  select count(*) as n, round(sum(a.cost_usd), 2) as usd, string_agg(distinct a.fn, ', ') as fns into leak
    from ai_spend a
   where a.at > now() - interval '15 minutes' and a.cost_usd > 0
     and (a.scope = 'background' or a.fn = any(public.scout_paid_fns()))
     and not coalesce((select l.is_on and (l.until is null or l.until > a.at)
                         from scout_paid_log l where l.at <= a.at order by l.at desc, l.id desc limit 1), false);
  if leak.n > 0 then
    perform public.scout_paid_apply(false, null, 'watchdog', null);
    perform bestly_raise('ai.paid.leak', 'problem', 'warning', 'Scout spent on paid AI while the switch was off',
      format('%s paid call(s), $%s, from %s. Switch forced off and every chat pass cleared.', leak.n, leak.usd, leak.fns),
      'scout', null, false);
  else
    select count(*) into n from ai_spend a
     where a.at > now() - interval '2 hours' and a.cost_usd > 0
       and (a.scope = 'background' or a.fn = any(public.scout_paid_fns()))
       and not coalesce((select l.is_on and (l.until is null or l.until > a.at)
                           from scout_paid_log l where l.at <= a.at order by l.at desc, l.id desc limit 1), false);
    if n = 0 and exists (select 1 from monitor_issues where key = 'ai.paid.leak' and status = 'open') then
      perform bestly_raise('ai.paid.leak', 'resolved', 'info', 'No paid AI leaks for 2 hours', null, 'scout', null, true);
    end if;
  end if;
  return jsonb_build_object('leaks', coalesce(leak.n, 0), 'state', public.scout_paid_state_ro());
end $$;
revoke all on function public.scout_paid_watch() from public, anon, authenticated;
grant execute on function public.scout_paid_watch() to service_role;

-- llm_keys also returns FreeLLM's key and its public tunnel address.
create or replace function public.llm_keys()
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets
   where name in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id','gemini_api_key','openrouter_api_key','freellm_api_key','freellm_base_url');
$$;

select cron.schedule('scout-paid-tick', '* * * * *', $$select public.scout_paid_tick()$$);
select cron.schedule('scout-paid-watch', '*/10 * * * *', $$select public.scout_paid_watch()$$);

-- Today's hidden pass ends now. The switch is the only way in from here.
update public.admin_chat_threads set paid_ok = false, paid_ok_until = null where paid_ok_until is not null or paid_ok;
