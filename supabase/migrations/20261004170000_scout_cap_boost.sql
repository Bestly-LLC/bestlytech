-- 2026-10-04 Chat Router (hired from The Recruiter's suggestions, built in a Claude session).
-- What Chat Router turned out to be: Scout already answers on free AI first and only uses paid Claude while the
-- Paid AI switch is on, capped at $5/day. The real problem was the cap: Scout stopped cold ("Paid AI hit today's cap,
-- so I stopped") and "Override this" did nothing. Now:
--   * at the cap Scout keeps going on the free AI (with tools) instead of stopping (admin-chat v31), and
--   * "Raise today's cap by $5" (or "override") adds $5 for today only, logged, max +$20/day over the base cap.
-- chat_cap_today() = scout_settings.chat_cap_usd + today's boosts; everything that reads the chat cap uses it.

create table if not exists public.scout_cap_boosts (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  day       date not null default (now() at time zone 'America/Los_Angeles')::date,
  extra_usd numeric not null check (extra_usd > 0 and extra_usd <= 20),
  by_user   uuid,
  reason    text
);
create index if not exists scout_cap_boosts_day_idx on public.scout_cap_boosts (day);
alter table public.scout_cap_boosts enable row level security;
revoke all on public.scout_cap_boosts from anon, authenticated;

create or replace function public.chat_cap_today() returns numeric
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select chat_cap_usd from scout_settings where id), 5)
       + coalesce((select sum(extra_usd) from scout_cap_boosts where day = (now() at time zone 'America/Los_Angeles')::date), 0)
$$;
revoke all on function public.chat_cap_today() from public, anon;
grant execute on function public.chat_cap_today() to authenticated, service_role;

-- raise today's chat cap (Jared's tap in Scout). Returns the new spend/cap.
create or replace function public.scout_cap_boost(p_extra numeric default 5, p_by uuid default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_today numeric;
begin
  select coalesce(sum(extra_usd), 0) into v_today from scout_cap_boosts where day = (now() at time zone 'America/Los_Angeles')::date;
  if v_today + p_extra > 20 then
    return jsonb_build_object('ok', false, 'error', 'max_boost', 'boosted_today', v_today) || scout_paid_spend();
  end if;
  insert into scout_cap_boosts (extra_usd, by_user, reason) values (p_extra, p_by, left(coalesce(p_reason, 'raise cap'), 200));
  return jsonb_build_object('ok', true, 'boosted_today', v_today + p_extra) || scout_paid_spend();
end $$;
revoke all on function public.scout_cap_boost(numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.scout_cap_boost(numeric, uuid, text) to service_role;

create or replace function public.scout_paid_spend() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with d as (select (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles') as since)
  select jsonb_build_object(
    'spent', round(coalesce((select sum(cost_usd) from ai_spend, d where at >= d.since and scope = 'chat'), 0), 2),
    'cap', public.chat_cap_today());
$$;

create or replace function public.ai_budget(p_scope text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with d as (select (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles') as since),
  s as (select coalesce(sum(cost_usd) filter (where scope = p_scope), 0) spent,
               coalesce(sum(cost_usd), 0) total
          from ai_spend, d where at >= d.since),
  c as (select case when p_scope = 'chat' then public.chat_cap_today()
                    else coalesce((select background_cap_usd from scout_settings where id), 1.00) end cap),
  -- v30: Scout's background jobs only spend while the Paid AI switch is ON. Chat scope is enforced
  -- by Scout itself (admin-chat); Spark/Cookie Yeti are not governed by the switch.
  g as (select p_scope = 'background' as governed,
               coalesce((public.scout_paid_state_ro()->>'on')::boolean, false) as switch_on)
  select jsonb_build_object('scope', p_scope, 'spent', round(s.spent, 4), 'cap', c.cap,
                            'ok', s.spent < c.cap and (not g.governed or g.switch_on),
                            'switch_off', g.governed and not g.switch_on,
                            'total_today', round(s.total, 4))
    from s, c, g;
$$;

create or replace function public.scout_prefs() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare st jsonb := public.scout_paid_tick();
begin
  return coalesce((select jsonb_build_object(
      'auto_run', auto_run,
      'paid_ai_ok', (st->>'on')::boolean,
      'paid_ai_until', st->'until',
      'paid_ai_off_reason', st->'off_reason',
      'paid_spent', st->'spent',
      'background_cap_usd', background_cap_usd, 'chat_cap_usd', public.chat_cap_today()) from scout_settings where id),
    '{"auto_run": false, "paid_ai_ok": false}'::jsonb);
end $$;
