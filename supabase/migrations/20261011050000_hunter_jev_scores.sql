-- Hunter Phase 1.5: Jev scoring tables (2026-10-11).
-- Every lead a caller may dial gets one row of odds: how likely a call reaches the decision maker, how the call is likely
-- to end, who picks up, when to call, and how well the product fits. Maya's leads (maya_leads) and Reese's (rg_leads) are
-- both scored, but a score row holds only the lead id and the numbers, never a phone, email or name, so RoofGuard stays
-- separable and nothing here needs a privacy_data_map row (the map only matches email and phone columns).
--
--   hunter_lead_scores   one row per (owner, lead), refreshed when older than 7 days
--   hunter_call_outcomes what really happened on each call (Phase 4 fills it, for calibration)
--   hunter_settings      two new nightly caps: scores by Jev and scores by the free AI ladder

create table if not exists public.hunter_lead_scores (
  id             uuid primary key default gen_random_uuid(),
  owner          text not null check (owner in ('maya','reese')),
  lead_table     text not null check (lead_table in ('maya_leads','rg_leads')),
  lead_id        uuid not null,
  scorer         text not null check (scorer in ('jev','free_ai')),
  model          text,
  p_reach_dm     numeric(5,4) not null check (p_reach_dm between 0 and 1),
  outcome_probs  jsonb not null,
  dm_role        text not null check (dm_role in ('owner','manager','office_manager','unknown')),
  best_window    text not null check (best_window in ('morning','midday','afternoon','late')),
  p_fit          numeric(5,4) not null check (p_fit between 0 and 1),
  priority       numeric(5,4) generated always as (round(p_reach_dm * p_fit, 4)) stored,
  reason         text not null,
  inputs         jsonb not null default '{}'::jsonb,   -- exactly what the scorer was shown (no phone, email or person name)
  latency_ms     int,
  tokens_in      int,
  scored_at      timestamptz not null default now(),
  unique (owner, lead_id),
  check ((owner = 'maya' and lead_table = 'maya_leads') or (owner = 'reese' and lead_table = 'rg_leads'))
);
create index if not exists hunter_lead_scores_priority_idx on public.hunter_lead_scores (owner, priority desc);
create index if not exists hunter_lead_scores_scored_idx on public.hunter_lead_scores (scored_at desc);

create table if not exists public.hunter_call_outcomes (
  id               bigserial primary key,
  owner            text not null check (owner in ('maya','reese')),
  lead_id          uuid not null,
  actual_outcome   text not null check (actual_outcome in ('decision_maker','gatekeeper','voicemail','no_answer','wrong_number')),
  called_at        timestamptz not null default now(),
  conversation_id  text,
  created_at       timestamptz not null default now()
);
create unique index if not exists hunter_call_outcomes_conv_uq on public.hunter_call_outcomes (owner, conversation_id) where conversation_id is not null;
create index if not exists hunter_call_outcomes_lead_idx on public.hunter_call_outcomes (owner, lead_id);

alter table public.hunter_lead_scores   enable row level security;
alter table public.hunter_call_outcomes enable row level security;
do $$ declare t text; begin
  foreach t in array array['hunter_lead_scores','hunter_call_outcomes'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin_read') then
      execute format($p$create policy %I on public.%I for select to authenticated using (public.has_role(auth.uid(), 'admin'))$p$, t || '_admin_read', t);
    end if;
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

alter table public.hunter_settings add column if not exists score_cap_jev  int not null default 500  check (score_cap_jev  between 0 and 5000);
alter table public.hunter_settings add column if not exists score_cap_free int not null default 150  check (score_cap_free between 0 and 2000);

insert into public.hunter_sources (slug, name, enabled, notes) values
  ('lead_scorer', 'Lead scoring', true, 'Scores every lead a caller may dial: odds of reaching the decision maker, best window, fit. Jev when a key is saved, otherwise the free AI ladder.'),
  ('jev', 'Jev (TypeSafe AI)', true, 'Fast typed-odds model. Not connected until a key is pasted on the Jev card.')
on conflict (slug) do nothing;
