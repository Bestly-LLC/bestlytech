-- Ava's performance review (Spark, 2026-10-05). Ava is Jared's first real employee: she has to earn her keep.
--   * Deal economics are editable settings (Jared's real cut per deal is not known yet; 2% residual is a stand-in).
--   * rg_deals: real signed deals. Real money is shown separately from the assumed pipeline, never mixed.
--   * rg_pip: improvement plans. Opened automatically (or by Jared), closed passed / failed / cancelled.
--   * rg_review_calc(): the one place the rules live. Verdict ladder:
--       ramping -> on_track -> coaching -> plan_due -> on_plan -> stop_review
--     Ava never gets switched off by this code: a "stop_review" is a recommendation Jared decides on.
--   * rg_review_tick(): Mondays 6:20 AM PT. Opens/evaluates plans and tells Jared, signed by Performance Review.

-- ------------------------------------------------------------------ settings
alter table public.rg_settings add column if not exists deal_cut_pct numeric not null default 0.02 check (deal_cut_pct >= 0 and deal_cut_pct <= 1);
alter table public.rg_settings add column if not exists rate_per_sqft numeric not null default 0.20 check (rate_per_sqft >= 0);
alter table public.rg_settings add column if not exists avg_roof_sqft int not null default 50000 check (avg_roof_sqft >= 0);
alter table public.rg_settings add column if not exists close_rate numeric not null default 0.20 check (close_rate >= 0 and close_rate <= 1);
alter table public.rg_settings add column if not exists horizon_months int not null default 12 check (horizon_months between 1 and 120);
alter table public.rg_settings add column if not exists review_started_on date not null default '2026-10-05';
alter table public.rg_settings add column if not exists pip_weeks int not null default 4 check (pip_weeks between 1 and 12);
alter table public.rg_settings add column if not exists dry_spell_dials int not null default 250 check (dry_spell_dials >= 50);

-- ------------------------------------------------------------------ deals and plans
create table if not exists public.rg_deals (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  signed_on   date not null default current_date,
  sqft        int,
  monthly_cut numeric,          -- what Jared actually earns per month; null = use the settings formula
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.rg_deals enable row level security;
revoke all on public.rg_deals from anon, authenticated;
drop policy if exists rg_deals_admin on public.rg_deals;
create policy rg_deals_admin on public.rg_deals for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create table if not exists public.rg_pip (
  id              uuid primary key default gen_random_uuid(),
  started_on      date not null default (now() at time zone 'America/Los_Angeles')::date,
  ends_on         date not null,
  target_per_week numeric not null,
  trigger         text not null default 'auto' check (trigger in ('auto', 'manual')),
  reason          text,
  baseline        jsonb,
  status          text not null default 'active' check (status in ('active', 'passed', 'failed', 'cancelled')),
  closed_on       date,
  outcome         text,
  created_at      timestamptz not null default now()
);
create unique index if not exists rg_pip_one_active on public.rg_pip ((status)) where status = 'active';
alter table public.rg_pip enable row level security;
revoke all on public.rg_pip from anon, authenticated;
drop policy if exists rg_pip_admin_read on public.rg_pip;
create policy rg_pip_admin_read on public.rg_pip for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- ------------------------------------------------------------------ the rules (internal, no auth check)
create or replace function public.rg_review_calc() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s rg_settings;
  v_wk date := date_trunc('week', now() at time zone 'America/Los_Angeles')::date;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_goal numeric; v_floor numeric;
  v_weeks jsonb; v_live int; v_miss_streak int := 0; v_last jsonb; v_prev jsonb;
  v_pip rg_pip; v_pip_avg numeric; v_pip_weeks int; v_dry int; v_total_booked int; v_total_dials int;
  v_verdict text; v_reason text; v_next text;
  v_cut numeric; v_deals int; v_mrr_real numeric; v_spend numeric; v_cost_wk numeric;
  v_exp_deals numeric; v_exp_mrr numeric; v_vpm numeric; v_cpm numeric; v_wk_value numeric;
  v_costs jsonb; v_months int;
begin
  select * into s from rg_settings where id;
  v_goal := s.weekly_goal; v_floor := round(s.weekly_goal * 2.0 / 3.0, 1);

  -- every full week since she started, with enough dials to count (20+)
  select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'dials', d, 'booked', b,
           'result', case when b >= v_goal then 'met' when b >= v_floor then 'close' else 'miss' end) order by wk), '[]'::jsonb)
    into v_weeks
    from (select wk, count(*) d, count(*) filter (where booked) b from rg_ava_calls()
           where wk < v_wk and wk >= date_trunc('week', s.review_started_on)::date group by wk having count(*) >= 20) z;
  v_live := jsonb_array_length(v_weeks);
  v_last := case when v_live >= 1 then v_weeks->(v_live - 1) end;
  v_prev := case when v_live >= 2 then v_weeks->(v_live - 2) end;
  if v_last is not null and v_last->>'result' = 'miss' then
    v_miss_streak := 1;
    if v_prev is not null and v_prev->>'result' = 'miss' then v_miss_streak := 2; end if;
  end if;

  select count(*) filter (where booked), count(*) into v_total_booked, v_total_dials from rg_ava_calls();
  -- dials since her last meeting
  select count(*) into v_dry from rg_ava_calls() c
   where c.at > coalesce((select max(at) from rg_ava_calls() where booked), '-infinity'::timestamptz);

  select * into v_pip from rg_pip where status = 'active';
  if v_pip.id is not null then
    select avg(b), count(*) into v_pip_avg, v_pip_weeks from (
      select count(*) filter (where booked) b from rg_ava_calls()
       where wk >= date_trunc('week', v_pip.started_on)::date and wk < v_wk group by wk having count(*) >= 20) z;
  end if;

  -- verdict ladder
  if v_pip.id is not null then
    if v_today >= v_pip.ends_on then
      if coalesce(v_pip_avg, 0) >= v_pip.target_per_week then
        v_verdict := 'plan_passed'; v_reason := format('She averaged %s meetings a week on the plan (target %s).', round(v_pip_avg, 1), v_pip.target_per_week);
        v_next := 'Close the plan as passed.';
      else
        v_verdict := 'stop_review'; v_reason := format('The plan ended with %s meetings a week against a target of %s.', round(coalesce(v_pip_avg, 0), 1), v_pip.target_per_week);
        v_next := 'Decide: stop Ava, or extend the plan once with a changed script.';
      end if;
    else
      v_verdict := 'on_plan';
      v_reason := format('Improvement plan: %s meetings a week needed until %s.', v_pip.target_per_week, to_char(v_pip.ends_on, 'FMMon FMDD'));
      v_next := 'Let the plan run. Review the calls with the fewest answers.';
    end if;
  elsif v_dry >= s.dry_spell_dials then
    v_verdict := 'plan_due'; v_reason := format('%s dials in a row with no meeting. At her assumed rate that is very unlikely to be luck.', v_dry);
    v_next := 'Start an improvement plan, or check the lead list and script first.';
  elsif v_live < 2 then
    v_verdict := 'ramping'; v_reason := 'First two full weeks: no penalties yet.'; v_next := 'Keep calling. Fix anything that looks broken.';
  elsif v_miss_streak >= 2 then
    v_verdict := 'plan_due'; v_reason := format('Two weeks in a row under %s meetings.', v_floor); v_next := 'Start an improvement plan.';
  elsif v_last->>'result' = 'met' then
    v_verdict := 'on_track'; v_reason := 'Hit the weekly goal last week.'; v_next := 'Keep going.';
  elsif v_last->>'result' = 'close' then
    v_verdict := 'coaching'; v_reason := 'Last week was short of the goal but above the floor.'; v_next := 'Read last week''s calls and tune the opener.';
  else
    v_verdict := 'coaching'; v_reason := format('Last week was under %s meetings. One more and a plan opens.', v_floor); v_next := 'Read last week''s calls and fix the biggest drop-off.';
  end if;

  -- money
  v_cut := s.avg_roof_sqft * s.rate_per_sqft * s.deal_cut_pct;
  select count(*), coalesce(sum(coalesce(monthly_cut, v_cut)), 0) into v_deals, v_mrr_real from rg_deals;
  v_months := 1 + (extract(year from age(now(), s.number_bought_on)) * 12 + extract(month from age(now(), s.number_bought_on)))::int;
  select coalesce(sum(rg_call_cost(x, s)), 0) + s.cost_number_monthly * (v_months + 1) into v_spend
    from rg_calls x where not x.is_test and x.lead_id is distinct from s.demo_lead_id and x.lead_id is distinct from s.personal_lead_id;
  select coalesce(sum(rg_call_cost(x, s)), 0) / 4.0 + s.cost_number_monthly / 4.33 into v_cost_wk
    from rg_calls x where not x.is_test and x.queued_at > now() - interval '28 days'
     and x.lead_id is distinct from s.demo_lead_id and x.lead_id is distinct from s.personal_lead_id;
  v_exp_deals := greatest(v_deals, v_total_booked * s.close_rate);
  v_exp_mrr := v_exp_deals * v_cut;
  v_vpm := s.close_rate * v_cut * s.horizon_months;
  v_cpm := v_spend / nullif(v_total_booked, 0);
  v_wk_value := v_goal * v_vpm;

  return jsonb_build_object(
    'verdict', v_verdict, 'reason', v_reason, 'next', v_next,
    'floor', v_floor, 'goal', v_goal, 'weeks', v_weeks, 'live_weeks', v_live, 'miss_streak', v_miss_streak,
    'dry_dials', v_dry, 'dry_limit', s.dry_spell_dials,
    'pip', case when v_pip.id is null then null else jsonb_build_object(
        'id', v_pip.id, 'started_on', v_pip.started_on, 'ends_on', v_pip.ends_on, 'target', v_pip.target_per_week,
        'trigger', v_pip.trigger, 'reason', v_pip.reason, 'avg', round(v_pip_avg, 1), 'weeks_done', coalesce(v_pip_weeks, 0),
        'days_left', greatest(0, v_pip.ends_on - v_today)) end,
    'econ', jsonb_build_object('deal_cut_pct', s.deal_cut_pct, 'rate_per_sqft', s.rate_per_sqft, 'avg_roof_sqft', s.avg_roof_sqft,
        'close_rate', s.close_rate, 'horizon_months', s.horizon_months, 'pip_weeks', s.pip_weeks, 'dry_spell_dials', s.dry_spell_dials,
        'review_started_on', s.review_started_on),
    'roi', jsonb_build_object(
        'monthly_per_deal', round(v_cut, 2), 'spend_total', round(v_spend, 2), 'spend_per_week', round(v_cost_wk, 2),
        'meetings', v_total_booked, 'dials', v_total_dials, 'cost_per_meeting', round(v_cpm, 2),
        'value_per_meeting', round(v_vpm, 2), 'deals_real', v_deals, 'mrr_real', round(v_mrr_real, 2),
        'deals_assumed', round(v_exp_deals, 1), 'mrr_assumed', round(v_exp_mrr, 2),
        'value_per_week_at_goal', round(v_wk_value, 2),
        'breakeven_meetings', ceil(v_spend / nullif(v_vpm, 0)),
        'payback_months', case when v_mrr_real > 0 then round(v_spend / v_mrr_real, 1) end,
        'payback_months_assumed', case when v_exp_mrr > 0 then round(v_spend / v_exp_mrr, 1) end,
        'paid_back', v_mrr_real * 1 >= v_spend and v_deals > 0));
end $$;
revoke execute on function public.rg_review_calc() from public, anon, authenticated;

create or replace function public.rg_ava_review() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return rg_review_calc() || jsonb_build_object(
    'deals', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'company', company, 'signed_on', signed_on, 'sqft', sqft,
                'monthly_cut', monthly_cut, 'note', note) order by signed_on desc, created_at desc), '[]'::jsonb) from rg_deals),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'started_on', started_on, 'ends_on', ends_on, 'target', target_per_week,
                'trigger', trigger, 'reason', reason, 'status', status, 'closed_on', closed_on, 'outcome', outcome) order by created_at desc), '[]'::jsonb)
              from (select * from rg_pip order by created_at desc limit 6) p));
end $$;
revoke execute on function public.rg_ava_review() from public, anon;
grant execute on function public.rg_ava_review() to authenticated;

-- ------------------------------------------------------------------ Jared's controls (admin only)
create or replace function public.rg_econ_set(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update rg_settings set
    deal_cut_pct   = coalesce((p->>'deal_cut_pct')::numeric, deal_cut_pct),
    rate_per_sqft  = coalesce((p->>'rate_per_sqft')::numeric, rate_per_sqft),
    avg_roof_sqft  = coalesce((p->>'avg_roof_sqft')::int, avg_roof_sqft),
    close_rate     = coalesce((p->>'close_rate')::numeric, close_rate),
    horizon_months = coalesce((p->>'horizon_months')::int, horizon_months),
    pip_weeks      = coalesce((p->>'pip_weeks')::int, pip_weeks),
    dry_spell_dials = coalesce((p->>'dry_spell_dials')::int, dry_spell_dials)
  where id;
end $$;
revoke execute on function public.rg_econ_set(jsonb) from public, anon;
grant execute on function public.rg_econ_set(jsonb) to authenticated;

create or replace function public.rg_deal_add(p_company text, p_signed_on date default null, p_sqft int default null, p_monthly_cut numeric default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if coalesce(trim(p_company), '') = '' then raise exception 'Company name needed'; end if;
  insert into rg_deals (company, signed_on, sqft, monthly_cut, note)
  values (trim(p_company), coalesce(p_signed_on, current_date), p_sqft, p_monthly_cut, nullif(trim(coalesce(p_note, '')), ''));
end $$;
revoke execute on function public.rg_deal_add(text, date, int, numeric, text) from public, anon;
grant execute on function public.rg_deal_add(text, date, int, numeric, text) to authenticated;

create or replace function public.rg_deal_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  delete from rg_deals where id = p_id;
end $$;
revoke execute on function public.rg_deal_delete(uuid) from public, anon;
grant execute on function public.rg_deal_delete(uuid) to authenticated;

-- open a plan now (also used by the Monday check)
create or replace function public.rg_pip_open_internal(p_trigger text, p_reason text, p_target numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s rg_settings; v_id uuid; v_today date := (now() at time zone 'America/Los_Angeles')::date; c jsonb;
begin
  select * into s from rg_settings where id;
  if exists (select 1 from rg_pip where status = 'active') then return null; end if;
  c := rg_review_calc();
  insert into rg_pip (started_on, ends_on, target_per_week, trigger, reason, baseline)
  values (v_today, v_today + s.pip_weeks * 7, coalesce(p_target, ceil(s.weekly_goal * 2.0 / 3.0)), p_trigger, p_reason,
          jsonb_build_object('weeks', c->'weeks', 'dry_dials', c->'dry_dials', 'roi', c->'roi'))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.rg_pip_open_internal(text, text, numeric) from public, anon, authenticated;

create or replace function public.rg_pip_open(p_reason text default null, p_target numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  v_id := rg_pip_open_internal('manual', coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Opened by Jared'), p_target);
  if v_id is null then raise exception 'A plan is already running'; end if;
  perform bestly_raise('rgreview.plan', 'problem', 'warning', 'Performance Review: improvement plan started for RoofGuard Ava',
    'Plan runs until ' || (select to_char(ends_on, 'FMMon FMDD') from rg_pip where id = v_id) || '. Target: ' || (select target_per_week::text from rg_pip where id = v_id) || ' meetings a week.',
    'sales', null, true);
  return v_id;
end $$;
revoke execute on function public.rg_pip_open(text, numeric) from public, anon;
grant execute on function public.rg_pip_open(text, numeric) to authenticated;

create or replace function public.rg_pip_close(p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if p_status not in ('passed', 'failed', 'cancelled') then raise exception 'bad status'; end if;
  update rg_pip set status = p_status, closed_on = (now() at time zone 'America/Los_Angeles')::date,
         outcome = nullif(trim(coalesce(p_note, '')), '') where status = 'active';
  perform bestly_raise('rgreview.plan', 'resolved', 'info', 'Performance Review: improvement plan closed (' || p_status || ')');
  perform bestly_raise('rgreview.stop', 'resolved', 'info', 'Performance Review: decision made');
end $$;
revoke execute on function public.rg_pip_close(text, text) from public, anon;
grant execute on function public.rg_pip_close(text, text) to authenticated;

-- ------------------------------------------------------------------ Monday check
create or replace function public.rg_review_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; v_id uuid;
begin
  c := rg_review_calc();
  if c->>'verdict' = 'plan_due' then
    v_id := rg_pip_open_internal('auto', c->>'reason');
    if v_id is not null then
      perform bestly_raise('rgreview.plan', 'problem', 'warning', 'Performance Review: RoofGuard Ava is on an improvement plan',
        (c->>'reason') || ' Plan runs ' || (select pip_weeks from rg_settings where id) || ' weeks, target '
          || (select target_per_week::text from rg_pip where id = v_id) || ' meetings a week. Open the scorecard to see it.', 'sales', null, false);
    end if;
  elsif c->>'verdict' = 'plan_passed' then
    update rg_pip set status = 'passed', closed_on = (now() at time zone 'America/Los_Angeles')::date, outcome = c->>'reason' where status = 'active';
    perform bestly_raise('rgreview.plan', 'resolved', 'info', 'Performance Review: RoofGuard Ava passed her plan', c->>'reason');
  elsif c->>'verdict' = 'stop_review' then
    perform bestly_raise('rgreview.stop', 'problem', 'warning', 'Performance Review: your decision on RoofGuard Ava',
      (c->>'reason') || ' ' || (c->>'next'), 'sales', 'Decide whether to stop or extend', false);
  end if;
  return jsonb_build_object('verdict', c->>'verdict');
end $$;
revoke execute on function public.rg_review_tick() from public, anon, authenticated;

create or replace function public.rg_review_tick_safe() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := rg_review_tick();
  if exists (select 1 from monitor_issues where key = 'rgreview.tick' and status = 'open') then
    perform bestly_raise('rgreview.tick', 'resolved', 'info', 'Performance Review: weekly check is working again');
  end if;
  return r;
exception when others then
  perform bestly_raise('rgreview.tick', 'problem', 'warning', 'Performance Review: my weekly check broke',
    'rg_review_tick failed: ' || left(sqlerrm, 300) || '. Ava''s review is not being updated until this is fixed.', 'sales', null, false);
  return jsonb_build_object('error', left(sqlerrm, 300));
end $$;
revoke execute on function public.rg_review_tick_safe() from public, anon, authenticated;

select cron.schedule('roofguard-review', '20 13 * * 1', $$ select public.rg_review_tick_safe(); $$);  -- Mon 6:20 AM PT

-- ------------------------------------------------------------------ team card: Performance Review (a tool of The Recruiter)
select public.team_onboard($j$[
 {"slug":"rg-review","name":"Performance Review","role":"Reviews Ava against her ROI","tool_of":"hr","runs_on":"cloud","icon":"clipboard-check","dept":"sales",
  "schedule":"Mondays 6:20 AM",
  "what_it_does":"Treats RoofGuard Ava like an employee: checks her meetings and cost every Monday, opens a 4-week improvement plan after two weak weeks (or 250 dials with no meeting), and asks Jared to decide when a plan fails.",
  "pulse":{"src":"cron","job":"roofguard-review","gap":10100,"alert":true},
  "owns":["rgreview"]}
]$j$::jsonb);
