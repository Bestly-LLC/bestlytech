-- Shield (Pi-hole / DNS filter) URL review queue.
-- End users on a Bestly Cloud deployment hit a blocked domain that they
-- believe should be allowed. They submit it here. Operator reviews and
-- decides allow / deny / escalate.

create table if not exists public.shield_url_reports (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  reported_url    text not null,
  reported_domain text generated always as (
    coalesce(
      (regexp_match(reported_url, '^(?:https?://)?([^/?#]+)'))[1],
      reported_url
    )
  ) stored,
  reason          text,
  reporter_email  text,
  reporter_org    text,
  user_agent      text,
  ip_address      inet,

  deal_id         uuid references public.cloud_deals(id) on delete set null,

  status          text not null default 'new'
                      check (status in ('new','reviewing','allowed','denied','duplicate')),
  reviewed_at     timestamptz,
  reviewed_by     text,
  decision_note   text
);

create index if not exists idx_shield_reports_status  on public.shield_url_reports(status);
create index if not exists idx_shield_reports_created on public.shield_url_reports(created_at desc);
create index if not exists idx_shield_reports_domain  on public.shield_url_reports(reported_domain);
create index if not exists idx_shield_reports_deal    on public.shield_url_reports(deal_id) where deal_id is not null;

drop trigger if exists trg_shield_reports_updated_at on public.shield_url_reports;
create trigger trg_shield_reports_updated_at
  before update on public.shield_url_reports
  for each row execute function public.cloud_touch_updated_at();

alter table public.shield_url_reports enable row level security;

drop policy if exists shield_reports_insert_anon on public.shield_url_reports;
create policy shield_reports_insert_anon on public.shield_url_reports
  for insert to anon with check (true);

drop policy if exists shield_reports_admin_all on public.shield_url_reports;
create policy shield_reports_admin_all on public.shield_url_reports
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

comment on table public.shield_url_reports is 'End-user reports of URLs they think Shield is wrongly blocking. Reviewed by operator.';
