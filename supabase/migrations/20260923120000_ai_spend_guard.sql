-- Paid AI spend guard. Found 2026-09-23: the "Paid AI" switch only gated Scout's chat. scout-daily
-- (morning picks, reply drafts, to-dos from calls, nightly reflect) called Claude with no check, and in
-- chat "keep going" silently counted as a yes to paid AI and a thread's yes never expired.
--
-- Now every paid Claude call is logged here with its real token counts and cost, and checked against a
-- daily cap before it runs:
--   background (scout-daily, runs by itself): cheapest model, capped at background_cap_usd a day
--   chat (Scout, only after he taps "Yes, use paid AI" or has the Paid AI switch on): chat_cap_usd a day
-- A thread's yes lasts one hour (paid_ok_until), and one thread runs one paid reply at a time (busy_until).

create table if not exists public.ai_spend (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  fn text not null,                      -- 'scout-daily' | 'admin-chat' | ...
  scope text not null check (scope in ('background','chat')),
  job text,                              -- morning | drafts | call | reflect | chat
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10,5) not null default 0,
  ref text                               -- thread id / recording id
);
create index if not exists ai_spend_at on public.ai_spend (at desc);
alter table public.ai_spend enable row level security;
drop policy if exists "Admins read ai spend" on public.ai_spend;
create policy "Admins read ai spend" on public.ai_spend for select to authenticated using (has_role(auth.uid(), 'admin'));
grant select on public.ai_spend to authenticated;

alter table public.scout_settings add column if not exists background_cap_usd numeric(8,2) not null default 1.00;
alter table public.scout_settings add column if not exists chat_cap_usd numeric(8,2) not null default 5.00;
alter table public.admin_chat_threads add column if not exists paid_ok_until timestamptz;
alter table public.admin_chat_threads add column if not exists busy_until timestamptz;

-- The old flag never expired. Old yeses are over.
update public.admin_chat_threads set paid_ok = false where paid_ok;

-- Spend so far today (Los Angeles day), and whether another call of this scope is allowed.
create or replace function public.ai_budget(p_scope text)
returns jsonb language sql stable security definer set search_path = public as $$
  with d as (select (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles') as since),
  s as (select coalesce(sum(cost_usd) filter (where scope = p_scope), 0) spent,
               coalesce(sum(cost_usd), 0) total
          from ai_spend, d where at >= d.since),
  c as (select coalesce((select case when p_scope = 'chat' then chat_cap_usd else background_cap_usd end from scout_settings where id), 1.00) cap)
  select jsonb_build_object('scope', p_scope, 'spent', round(s.spent, 4), 'cap', c.cap,
                            'ok', s.spent < c.cap, 'total_today', round(s.total, 4))
    from s, c;
$$;
revoke all on function public.ai_budget(text) from public, anon;
grant execute on function public.ai_budget(text) to authenticated, service_role;

create or replace function public.scout_prefs()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('auto_run', auto_run, 'paid_ai_ok', paid_ai_ok,
                    'background_cap_usd', background_cap_usd, 'chat_cap_usd', chat_cap_usd) from scout_settings where id),
                  '{"auto_run": false, "paid_ai_ok": false}'::jsonb);
$$;
