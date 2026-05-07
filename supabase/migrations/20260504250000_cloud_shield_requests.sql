-- Per-deal allowlist-request queue. End-users at a client company hit a
-- Shield/Pi-hole block, click "Report this block" on the block page, and
-- land at /shield/request/<deal.shield_request_token> to submit.
-- Operator reviews on /admin/cloud/:id, approves or rejects, action gets
-- recorded here. Approved entries are pushed to the client's pi-hole
-- allowlist via a follow-up sync (out of scope for this migration).

alter table public.cloud_deals
  add column if not exists shield_request_token text unique;

create index if not exists idx_cloud_deals_shield_token
  on public.cloud_deals(shield_request_token);

create table if not exists public.cloud_shield_requests (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references public.cloud_deals(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  requested_url   text not null,
  requester_name  text,
  requester_email text,
  reason          text,

  status          text not null default 'pending'
                       check (status in ('pending','approved','rejected','duplicate')),
  reviewed_by     text,
  reviewed_at     timestamptz,
  decision_notes  text,

  ip_address      inet,
  user_agent      text
);

create index if not exists idx_shield_requests_deal_status
  on public.cloud_shield_requests(deal_id, status, created_at desc);

drop trigger if exists trg_shield_requests_updated_at on public.cloud_shield_requests;
create trigger trg_shield_requests_updated_at
  before update on public.cloud_shield_requests
  for each row execute function public.cloud_touch_updated_at();

alter table public.cloud_shield_requests enable row level security;

drop policy if exists shield_requests_admin_all on public.cloud_shield_requests;
create policy shield_requests_admin_all on public.cloud_shield_requests
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

create or replace view public.v_cloud_shield_pending as
select
  r.id,
  r.deal_id,
  r.created_at,
  r.requested_url,
  r.requester_name,
  r.requester_email,
  r.reason,
  r.status,
  d.company_name,
  d.lead_id
from public.cloud_shield_requests r
join public.cloud_deals d on d.id = r.deal_id
where r.status = 'pending'
order by r.created_at desc;

comment on column public.cloud_deals.shield_request_token is 'Random hex token that gates /shield/request/:token. Distributed in pi-hole block page footer at install time.';
comment on table public.cloud_shield_requests is 'End-user requests to allowlist a blocked URL. Reviewed by operator in /admin/cloud/:id.';
