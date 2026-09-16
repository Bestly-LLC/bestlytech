-- Admin CRM: every lead from every funnel in one list, plus a notifications feed.
--
-- Leads come from three funnels and stay in their own tables (single source of truth):
--   cloud        cloud_leads (+ latest cloud_deals row)     detail /admin/cloud/<lead id>
--   marketplace  seller_intakes                             detail /admin/submissions/<id>
--   hire         hire_requests                              detail /admin/leads?tab=hire&open=<id>
-- v_crm_leads maps each funnel's own statuses onto one pipeline:
--   new -> contacted -> proposal -> won, plus lost and archived.
-- CRM-only fields (star, follow-up date, note) live in crm_lead_meta, keyed by '<funnel>:<id>'.
-- Only non-sensitive columns are exposed (no SSN/ID/bank fields from seller_intakes).

create table if not exists public.crm_lead_meta (
  lead_key text primary key check (lead_key ~ '^(cloud|marketplace|hire):[0-9a-f-]{36}$'),
  starred boolean not null default false,
  follow_up_on date,
  note text check (note is null or length(note) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.crm_lead_meta enable row level security;
drop policy if exists "Admins manage crm lead meta" on public.crm_lead_meta;
create policy "Admins manage crm lead meta" on public.crm_lead_meta
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
grant select, insert, update, delete on public.crm_lead_meta to authenticated;

create or replace view public.v_crm_leads with (security_invoker = true) as
with cloud as (
  select
    'cloud:' || l.id as lead_key,
    'cloud'::text as funnel,
    l.id as source_id,
    coalesce(nullif(d.primary_contact_name, ''), l.contact_name) as name,
    coalesce(nullif(d.primary_contact_email, ''), l.contact_email) as email,
    l.contact_phone as phone,
    coalesce(nullif(d.company_name, ''), l.company_name) as company,
    concat_ws(' · ',
      case when l.user_count_band is not null then l.user_count_band || ' users' end,
      case l.primary_pain when 'ai-privacy' then 'AI privacy' when 'lock-in' then 'Vendor lock-in' else initcap(l.primary_pain) end,
      case l.urgency when 'renewal-30' then 'Renewal in 30d' when 'renewal-90' then 'Renewal in 90d' when 'renewal-180' then 'Renewal in 180d' when 'exploring' then 'Exploring' end
    ) as summary,
    case
      when l.status = 'disqualified' then 'lost'
      when coalesce(d.current_stage, 0) >= 5 or l.status = 'converted' then 'won'
      when d.current_stage between 3 and 4 then 'proposal'
      when d.current_stage between 1 and 2 or l.status in ('contacted', 'qualified') then 'contacted'
      else 'new'
    end as stage,
    case when d.current_stage is not null then 'Deal stage ' || d.current_stage else initcap(l.status) end as funnel_status,
    d.id is not null as has_deal,
    d.deployment_fee_cents as value_cents,
    coalesce(nullif(l.utm_source, ''), nullif(l.source, '')) as origin,
    l.created_at,
    greatest(l.updated_at, d.updated_at, d.stage_changed_at, l.created_at) as last_activity_at,
    '/admin/cloud/' || l.id as detail_url
  from public.cloud_leads l
  left join lateral (
    select * from public.cloud_deals cd where cd.lead_id = l.id order by cd.current_stage desc, cd.updated_at desc limit 1
  ) d on true
),
marketplace as (
  select
    'marketplace:' || s.id,
    'marketplace'::text,
    s.id,
    coalesce(nullif(trim(s.client_name), ''), nullif(trim(concat_ws(' ', s.contact_first_name, s.contact_last_name)), ''), 'Unnamed seller'),
    coalesce(nullif(s.client_email, ''), nullif(s.business_email, '')),
    coalesce(nullif(s.client_phone, ''), nullif(s.business_phone, '')),
    coalesce(nullif(s.business_legal_name, ''), nullif(s.brand_name, '')),
    concat_ws(' · ',
      nullif(array_to_string(coalesce(s.selected_platforms, case when s.platform is not null then array[s.platform] end), ', '), ''),
      nullif(s.product_category, '')
    ),
    case s.status
      when 'Draft' then 'new'
      when 'Submitted' then 'new'
      when 'In Review' then 'contacted'
      when 'Issues Flagged' then 'contacted'
      when 'Approved' then 'won'
      when 'Archived' then 'archived'
      else 'new'
    end,
    s.status,
    false,
    null::bigint,
    case when s.setup_by_representative then 'Set up by a rep' end,
    s.created_at,
    greatest(s.updated_at, s.created_at),
    '/admin/submissions/' || s.id
  from public.seller_intakes s
),
hire as (
  select
    'hire:' || h.id,
    'hire'::text,
    h.id,
    h.name,
    h.email,
    null::text,
    nullif(h.company, ''),
    concat_ws(' · ', nullif(h.project_type, ''), nullif(h.budget_range, ''), nullif(h.timeline, '')),
    case h.status
      when 'contacted' then 'contacted'
      when 'proposal' then 'proposal'
      when 'accepted' then 'won'
      when 'declined' then 'lost'
      when 'archived' then 'archived'
      else 'new'
    end,
    initcap(h.status),
    false,
    null::bigint,
    nullif(h.referral_source, ''),
    h.created_at,
    h.created_at,
    '/admin/leads?tab=hire&open=' || h.id
  from public.hire_requests h
),
all_leads as (
  select * from cloud union all select * from marketplace union all select * from hire
)
select a.*, coalesce(m.starred, false) as starred, m.follow_up_on, m.note
from all_leads a
left join public.crm_lead_meta m on m.lead_key = a.lead_key;

grant select on public.v_crm_leads to authenticated;

-- Move a lead along the shared pipeline by writing its own funnel's status.
-- Cloud leads that already have a deal are moved on the deal page (stages 1-8), not here.
create or replace function public.crm_set_stage(p_key text, p_stage text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_funnel text := split_part(p_key, ':', 1);
  v_id uuid;
  v_status text;
  v_n int;
begin
  if not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_stage not in ('new', 'contacted', 'proposal', 'won', 'lost', 'archived') then
    raise exception 'unknown stage %', p_stage using errcode = '22023';
  end if;
  begin v_id := split_part(p_key, ':', 2)::uuid; exception when others then
    raise exception 'bad lead key' using errcode = '22023';
  end;

  if v_funnel = 'hire' then
    v_status := case p_stage when 'won' then 'accepted' when 'lost' then 'declined' else p_stage end;
    update hire_requests set status = v_status where id = v_id;
  elsif v_funnel = 'marketplace' then
    v_status := case p_stage
      when 'new' then 'Submitted' when 'contacted' then 'In Review' when 'proposal' then 'In Review'
      when 'won' then 'Approved' else 'Archived' end;
    update seller_intakes set status = v_status where id = v_id;
  elsif v_funnel = 'cloud' then
    if exists (select 1 from cloud_deals where lead_id = v_id) then
      raise exception 'This lead has a deal. Move it on the deal page.' using errcode = '22023';
    end if;
    v_status := case p_stage
      when 'new' then 'new' when 'contacted' then 'contacted' when 'proposal' then 'qualified'
      when 'won' then 'converted' else 'disqualified' end;
    update cloud_leads set status = v_status where id = v_id;
  else
    raise exception 'unknown funnel %', v_funnel using errcode = '22023';
  end if;

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'lead not found' using errcode = 'P0002'; end if;
  return (select stage from v_crm_leads where lead_key = p_key);
end $$;
revoke all on function public.crm_set_stage(text, text) from public, anon;
grant execute on function public.crm_set_stage(text, text) to authenticated;

-- ── Notifications ───────────────────────────────────────────────────────────────────────
create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  title text not null,
  body text,
  url text,
  entity_key text,
  severity text not null default 'info' check (severity in ('info', 'success', 'warning')),
  dedupe_key text unique,
  read_at timestamptz
);
create index if not exists admin_notifications_created_idx on public.admin_notifications (created_at desc);
create index if not exists admin_notifications_unread_idx on public.admin_notifications (created_at desc) where read_at is null;
alter table public.admin_notifications enable row level security;
drop policy if exists "Admins read notifications" on public.admin_notifications;
create policy "Admins read notifications" on public.admin_notifications
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
drop policy if exists "Admins mark notifications" on public.admin_notifications;
create policy "Admins mark notifications" on public.admin_notifications
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
drop policy if exists "Admins delete notifications" on public.admin_notifications;
create policy "Admins delete notifications" on public.admin_notifications
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
grant select, update, delete on public.admin_notifications to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'admin_notifications') then
    alter publication supabase_realtime add table public.admin_notifications;
  end if;
end $$;

create or replace function public.admin_notify(
  p_kind text, p_title text, p_body text, p_url text, p_entity_key text,
  p_severity text default 'info', p_dedupe_key text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key)
  values (p_kind, left(p_title, 200), left(p_body, 500), p_url, p_entity_key, p_severity, p_dedupe_key)
  on conflict (dedupe_key) do nothing;
exception when others then
  -- A notification must never block the insert or update that triggered it.
  raise warning 'admin_notify failed: %', sqlerrm;
end $$;
revoke all on function public.admin_notify(text, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.trg_notify_cloud_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform admin_notify('lead_new',
    'New cloud lead: ' || coalesce(nullif(NEW.company_name, ''), NEW.contact_name),
    concat_ws(' · ', NEW.contact_name, case when NEW.user_count_band is not null then NEW.user_count_band || ' users' end, NEW.urgency),
    '/admin/cloud/' || NEW.id, 'cloud:' || NEW.id, 'info', 'cloud_lead:' || NEW.id);
  return NEW;
end $$;

create or replace function public.trg_notify_cloud_deal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce(nullif(NEW.company_name, ''), 'a cloud deal');
  link text := '/admin/cloud/' || NEW.lead_id;
begin
  if NEW.deposit_paid_at is not null and OLD.deposit_paid_at is null then
    perform admin_notify('deal_deposit', 'Deposit paid: ' || who,
      case when NEW.deployment_fee_cents is not null then 'Deployment fee $' || to_char(NEW.deployment_fee_cents / 100.0, 'FM999,999,990') end,
      link, 'cloud:' || NEW.lead_id, 'success', 'deal_deposit:' || NEW.id);
  end if;
  if NEW.sow_signed_at is not null and OLD.sow_signed_at is null then
    perform admin_notify('deal_signed', 'SOW signed: ' || who, 'Next: deposit and tech intake.', link, 'cloud:' || NEW.lead_id, 'success', 'deal_sow:' || NEW.id);
  end if;
  if NEW.intake_submitted_at is not null and OLD.intake_submitted_at is null then
    perform admin_notify('deal_intake', 'Tech intake submitted: ' || who, 'Ready for provisioning.', link, 'cloud:' || NEW.lead_id, 'info', 'deal_intake:' || NEW.id);
  end if;
  if NEW.current_stage = 8 and coalesce(OLD.current_stage, 0) <> 8 then
    perform admin_notify('deal_live', who || ' is live', 'Deployment finished.', link, 'cloud:' || NEW.lead_id, 'success', 'deal_live:' || NEW.id);
  end if;
  return NEW;
end $$;

create or replace function public.trg_notify_seller_intake() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'Submitted' and (TG_OP = 'INSERT' or OLD.status is distinct from 'Submitted') then
    perform admin_notify('intake_submitted',
      'Marketplace intake: ' || coalesce(nullif(trim(NEW.business_legal_name), ''), nullif(trim(NEW.client_name), ''), 'a seller'),
      concat_ws(' · ', nullif(trim(NEW.client_name), ''), nullif(array_to_string(NEW.selected_platforms, ', '), ''), nullif(NEW.product_category, '')),
      '/admin/submissions/' || NEW.id, 'marketplace:' || NEW.id, 'info', 'intake_submitted:' || NEW.id || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  end if;
  return NEW;
end $$;

create or replace function public.trg_notify_hire_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform admin_notify('hire_new',
    'Hire request: ' || coalesce(nullif(NEW.company, ''), NEW.name),
    concat_ws(' · ', NEW.name, nullif(NEW.project_type, ''), nullif(NEW.budget_range, '')),
    '/admin/leads?tab=hire&open=' || NEW.id, 'hire:' || NEW.id, 'info', 'hire:' || NEW.id);
  return NEW;
end $$;

create or replace function public.trg_notify_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform admin_notify('contact_new',
    'Message from ' || coalesce(nullif(NEW.name, ''), NEW.email),
    coalesce(nullif(NEW.subject, ''), left(NEW.message, 140)),
    '/admin/contacts?open=' || NEW.id, 'contact:' || NEW.id, 'info', 'contact:' || NEW.id);
  return NEW;
end $$;

create or replace function public.trg_notify_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform admin_notify('waitlist_new', 'Waitlist signup: ' || NEW.email,
    nullif(array_to_string(NEW.products, ', '), ''),
    '/admin/waitlist', 'waitlist:' || NEW.id, 'info', 'waitlist:' || NEW.id);
  return NEW;
exception when others then
  return NEW;
end $$;

create or replace function public.trg_notify_cy_needs_you() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.autofix_outcome in ('blocked', 'no_banner_seen', 'ai_failed', 'ai_wrong')
     and OLD.autofix_outcome is distinct from NEW.autofix_outcome then
    perform admin_notify('cy_needs_you', 'Cookie Yeti needs a hand: ' || NEW.domain,
      coalesce(NEW.autofix_note, 'Auto-Fix tried everything it can.'),
      '/admin/cookie-yeti?tab=autofix', 'cy:' || NEW.domain, 'warning',
      'cy_needs_you:' || NEW.domain || ':' || to_char(now(), 'YYYYMMDD'));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_notify_cloud_lead on public.cloud_leads;
create trigger trg_notify_cloud_lead after insert on public.cloud_leads for each row execute function public.trg_notify_cloud_lead();
drop trigger if exists trg_notify_cloud_deal on public.cloud_deals;
create trigger trg_notify_cloud_deal after update on public.cloud_deals for each row execute function public.trg_notify_cloud_deal();
drop trigger if exists trg_notify_seller_intake on public.seller_intakes;
create trigger trg_notify_seller_intake after insert or update of status on public.seller_intakes for each row execute function public.trg_notify_seller_intake();
drop trigger if exists trg_notify_hire_request on public.hire_requests;
create trigger trg_notify_hire_request after insert on public.hire_requests for each row execute function public.trg_notify_hire_request();
drop trigger if exists trg_notify_contact on public.contact_submissions;
create trigger trg_notify_contact after insert on public.contact_submissions for each row execute function public.trg_notify_contact();
drop trigger if exists trg_notify_waitlist on public.waitlist_subscribers;
create trigger trg_notify_waitlist after insert on public.waitlist_subscribers for each row execute function public.trg_notify_waitlist();
drop trigger if exists trg_notify_cy_needs_you on public.missed_banner_reports;
create trigger trg_notify_cy_needs_you after update of autofix_outcome on public.missed_banner_reports for each row execute function public.trg_notify_cy_needs_you();

-- Friendlier wording for the cloud lead notification body.
create or replace function public.trg_notify_cloud_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform admin_notify('lead_new',
    'New cloud lead: ' || coalesce(nullif(NEW.company_name, ''), NEW.contact_name),
    concat_ws(' · ', NEW.contact_name,
      case when NEW.user_count_band is not null then NEW.user_count_band || ' users' end,
      case NEW.urgency when 'renewal-30' then 'renewal in 30 days' when 'renewal-90' then 'renewal in 90 days'
        when 'renewal-180' then 'renewal in 180 days' when 'exploring' then 'exploring' end),
    '/admin/cloud/' || NEW.id, 'cloud:' || NEW.id, 'info', 'cloud_lead:' || NEW.id);
  return NEW;
end $$;
