-- Bestly In-House Cloud — customer intake schema
-- Funnel: lead → brief → discovery call → deal → deployment
-- See docs/customer-intake-opusplan.md

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Helper: auto-touch updated_at on row update
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cloud_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. cloud_leads — Stage 1 capture (public form submission)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cloud_leads (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Contact
  contact_name        text not null,
  contact_email       text not null,
  contact_phone       text,
  company_name        text not null,
  company_website     text,

  -- Qualification (matches brochure size bands)
  user_count_band     text not null check (user_count_band in ('5','25','50','100','200+')),
  primary_pain        text check (primary_pain in ('cost','sovereignty','brand','ai-privacy','lock-in','other')),
  primary_pain_detail text,
  urgency             text check (urgency in ('renewal-30','renewal-90','renewal-180','exploring')),

  -- Source / attribution
  source              text default 'website',
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  referrer            text,

  -- Status
  status              text not null default 'new'
                          check (status in ('new','contacted','qualified','disqualified','converted')),
  notes               text,

  -- Privacy
  ip_address          inet,
  user_agent          text
);

create index if not exists idx_cloud_leads_status  on public.cloud_leads(status);
create index if not exists idx_cloud_leads_created on public.cloud_leads(created_at desc);

drop trigger if exists trg_cloud_leads_updated_at on public.cloud_leads;
create trigger trg_cloud_leads_updated_at
  before update on public.cloud_leads
  for each row execute function public.cloud_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. cloud_briefs — Stage 2 pre-call brief (one per lead)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cloud_briefs (
  id                       uuid primary key default gen_random_uuid(),
  lead_id                  uuid not null unique references public.cloud_leads(id) on delete cascade,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  submitted_at             timestamptz,

  -- Magic-link token for /brief/[token]
  access_token             text not null unique default encode(gen_random_bytes(24), 'hex'),

  -- Current stack — slugs from brochure's 13:
  --   drive, video-chat, mail, docs, calendar, ai, shield, vpn,
  --   backup, projects, forms, passwords, sign
  current_apps             jsonb not null default '[]'::jsonb,

  -- Spend / compliance
  annual_saas_spend_band   text check (annual_saas_spend_band in ('<25k','25-75k','75-150k','150-300k','300k+','unsure')),
  compliance_frameworks    jsonb not null default '[]'::jsonb,

  -- Network / location
  office_city              text,
  office_state             text,
  office_country           text default 'US',
  has_static_ip            text check (has_static_ip in ('yes','no','unsure')),
  has_it_lead              text check (has_it_lead in ('yes','no','unsure')),
  domain_owned             text check (domain_owned in ('yes','no','unsure')),
  preferred_subdomain      text,

  -- Open-ended
  biggest_unknown          text
);

create index if not exists idx_cloud_briefs_token on public.cloud_briefs(access_token);
create index if not exists idx_cloud_briefs_lead  on public.cloud_briefs(lead_id);

drop trigger if exists trg_cloud_briefs_updated_at on public.cloud_briefs;
create trigger trg_cloud_briefs_updated_at
  before update on public.cloud_briefs
  for each row execute function public.cloud_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. cloud_deals — created when a lead is qualified
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cloud_deals (
  id                          uuid primary key default gen_random_uuid(),
  lead_id                     uuid not null references public.cloud_leads(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- Funnel stage 1-8 (see opusplan)
  current_stage               smallint not null default 1
                                  check (current_stage between 1 and 8),
  stage_changed_at            timestamptz not null default now(),

  -- Cached so admin views don't have to join
  company_name                text not null,
  primary_contact_name        text not null,
  primary_contact_email       text not null,

  -- Configuration
  target_user_count           int,
  support_tier                text check (support_tier in ('self','basic','managed','premium')),
  deployment_fee_cents        bigint,
  monthly_support_fee_cents   bigint,

  -- Key dates
  discovery_call_at           timestamptz,
  sow_sent_at                 timestamptz,
  sow_signed_at               timestamptz,
  deposit_paid_at             timestamptz,
  install_scheduled_at        timestamptz,
  go_live_at                  timestamptz,

  -- External system IDs
  cal_event_uuid              text,
  stripe_customer_id          text,
  docusign_envelope_id        text,

  -- Ownership
  assigned_to                 text,
  notes                       text
);

create index if not exists idx_cloud_deals_stage   on public.cloud_deals(current_stage);
create index if not exists idx_cloud_deals_lead    on public.cloud_deals(lead_id);
create index if not exists idx_cloud_deals_updated on public.cloud_deals(updated_at desc);

drop trigger if exists trg_cloud_deals_updated_at on public.cloud_deals;
create trigger trg_cloud_deals_updated_at
  before update on public.cloud_deals
  for each row execute function public.cloud_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. cloud_deal_events — append-only audit timeline
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.cloud_deal_events (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid references public.cloud_deals(id) on delete cascade,
  lead_id         uuid references public.cloud_leads(id) on delete cascade,
  created_at      timestamptz not null default now(),

  event_type      text not null,
  -- 'lead_created','brief_link_sent','brief_submitted','call_scheduled','call_completed',
  -- 'sow_sent','sow_signed','deposit_paid','stage_changed','provisioning_started',
  -- 'installed','went_live','disqualified','note_added'

  event_payload   jsonb,
  triggered_by    text  -- 'system' | admin email | 'client'
);

create index if not exists idx_deal_events_deal on public.cloud_deal_events(deal_id, created_at desc);
create index if not exists idx_deal_events_lead on public.cloud_deal_events(lead_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RLS — anon can ONLY insert leads. Admins can do anything.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.cloud_leads        enable row level security;
alter table public.cloud_briefs       enable row level security;
alter table public.cloud_deals        enable row level security;
alter table public.cloud_deal_events  enable row level security;

-- cloud_leads: anon insert only (form submission)
drop policy if exists cloud_leads_insert_anon on public.cloud_leads;
create policy cloud_leads_insert_anon on public.cloud_leads
  for insert to anon
  with check (true);

drop policy if exists cloud_leads_admin_all on public.cloud_leads;
create policy cloud_leads_admin_all on public.cloud_leads
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- cloud_briefs: admin full. Anon read/update via edge function only (token-bound).
drop policy if exists cloud_briefs_admin_all on public.cloud_briefs;
create policy cloud_briefs_admin_all on public.cloud_briefs
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- cloud_deals: admin only
drop policy if exists cloud_deals_admin_all on public.cloud_deals;
create policy cloud_deals_admin_all on public.cloud_deals
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- cloud_deal_events: admin only
drop policy if exists cloud_deal_events_admin_all on public.cloud_deal_events;
create policy cloud_deal_events_admin_all on public.cloud_deal_events
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Auto-create brief row + event when a lead is inserted
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cloud_after_lead_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Auto-create the brief shell (token + empty fields)
  insert into public.cloud_briefs (lead_id) values (NEW.id);

  -- Audit event
  insert into public.cloud_deal_events (lead_id, event_type, event_payload, triggered_by)
  values (
    NEW.id,
    'lead_created',
    jsonb_build_object(
      'company_name',     NEW.company_name,
      'user_count_band',  NEW.user_count_band,
      'urgency',          NEW.urgency,
      'primary_pain',     NEW.primary_pain
    ),
    'system'
  );

  return NEW;
end
$$;

drop trigger if exists trg_cloud_after_lead_insert on public.cloud_leads;
create trigger trg_cloud_after_lead_insert
  after insert on public.cloud_leads
  for each row execute function public.cloud_after_lead_insert();

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Audit on brief submission
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cloud_log_brief_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.submitted_at is not null and OLD.submitted_at is null then
    insert into public.cloud_deal_events (lead_id, event_type, event_payload, triggered_by)
    values (NEW.lead_id, 'brief_submitted', jsonb_build_object('brief_id', NEW.id), 'client');
  end if;
  return NEW;
end
$$;

drop trigger if exists trg_brief_submitted on public.cloud_briefs;
create trigger trg_brief_submitted
  after update on public.cloud_briefs
  for each row execute function public.cloud_log_brief_submission();

-- ─────────────────────────────────────────────────────────────────────────
-- 9. Audit on deal stage change
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.cloud_log_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.current_stage is distinct from OLD.current_stage then
    NEW.stage_changed_at = now();
    insert into public.cloud_deal_events (deal_id, lead_id, event_type, event_payload, triggered_by)
    values (
      NEW.id,
      NEW.lead_id,
      'stage_changed',
      jsonb_build_object('from', OLD.current_stage, 'to', NEW.current_stage),
      'admin'
    );
  end if;
  return NEW;
end
$$;

drop trigger if exists trg_deal_stage_change on public.cloud_deals;
create trigger trg_deal_stage_change
  before update on public.cloud_deals
  for each row execute function public.cloud_log_stage_change();

-- ─────────────────────────────────────────────────────────────────────────
-- 10. View: pipeline counts by stage (for /admin/deals dashboard)
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.v_cloud_pipeline as
select
  current_stage,
  count(*)::int as deal_count,
  sum(deployment_fee_cents)::bigint as total_deployment_value_cents,
  sum(monthly_support_fee_cents)::bigint as total_monthly_value_cents
from public.cloud_deals
group by current_stage
order by current_stage;

-- ─────────────────────────────────────────────────────────────────────────
-- 11. View: lead funnel for ops dashboard
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.v_cloud_lead_funnel as
select
  l.id,
  l.created_at,
  l.contact_name,
  l.contact_email,
  l.company_name,
  l.user_count_band,
  l.primary_pain,
  l.urgency,
  l.status,
  b.submitted_at as brief_submitted_at,
  d.id as deal_id,
  d.current_stage as deal_stage,
  d.stage_changed_at,
  case
    when d.id is not null then 'deal'
    when b.submitted_at is not null then 'brief-done'
    when b.id is not null then 'brief-pending'
    else 'lead-only'
  end as funnel_state
from public.cloud_leads l
left join public.cloud_briefs b on b.lead_id = l.id
left join public.cloud_deals  d on d.lead_id = l.id
order by l.created_at desc;

comment on table public.cloud_leads is 'Stage 1: public form submissions for In-House Cloud intake. Anon insert allowed; admin reads.';
comment on table public.cloud_briefs is 'Stage 2: pre-discovery brief, one per lead. Token-bound updates from /brief/[token].';
comment on table public.cloud_deals is 'Stage 3+: qualified opportunities tracked through deployment.';
comment on table public.cloud_deal_events is 'Append-only timeline for the operator dashboard.';
