-- Cookie Yeti extension release tracker.
--
-- Building and uploading happen on Jared's Mac (source + Xcode live there), so the Mac-side Claude
-- writes progress here and the admin shows it on the Cookie Yeti page and in the bell.
--   cy_extension_releases   one row per store channel: mac, ios, chrome
--   notifications           on every status change, and once when the first installed extension
--                           calls report-pattern-loop (proof the fail-safe is out in the wild)

create table if not exists public.cy_extension_releases (
  channel text primary key check (channel in ('mac', 'ios', 'chrome')),
  version text,
  status text not null default 'not_started'
    check (status in ('not_started', 'building', 'uploaded', 'in_review', 'approved', 'live', 'rejected', 'blocked')),
  detail text,
  needs_jared text,
  store_url text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.cy_extension_releases enable row level security;
drop policy if exists cy_extension_releases_admin_read on public.cy_extension_releases;
create policy cy_extension_releases_admin_read on public.cy_extension_releases
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
drop policy if exists cy_extension_releases_admin_update on public.cy_extension_releases;
create policy cy_extension_releases_admin_update on public.cy_extension_releases
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
grant select, update on public.cy_extension_releases to authenticated;

insert into public.cy_extension_releases (channel, status, detail, updated_by) values
  ('mac', 'not_started', 'Click-loop fail-safe release. Waiting for the Mac session.', 'seed'),
  ('ios', 'not_started', 'Click-loop fail-safe release. Waiting for the Mac session.', 'seed'),
  ('chrome', 'not_started', 'Click-loop fail-safe release. Waiting for the Mac session.', 'seed')
on conflict (channel) do nothing;

create or replace function public.cy_extension_release_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  label text := case new.channel when 'mac' then 'Mac' when 'ios' then 'iOS' else 'Chrome' end;
  words text := case new.status
    when 'building' then 'is building'
    when 'uploaded' then 'is uploaded'
    when 'in_review' then 'is in review'
    when 'approved' then 'is approved'
    when 'live' then 'is live'
    when 'rejected' then 'was rejected'
    when 'blocked' then 'is blocked'
    else 'is not started' end;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and (new.status is distinct from old.status or new.needs_jared is distinct from old.needs_jared) then
    insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key)
    values (
      'cy_release',
      case when new.needs_jared is not null and new.needs_jared <> '' then 'Cookie Yeti ' || label || ' needs you'
           else 'Cookie Yeti ' || label || coalesce(' ' || new.version, '') || ' ' || words end,
      coalesce(nullif(new.needs_jared, ''), new.detail),
      '/admin/cookie-yeti',
      'cy_release:' || new.channel,
      case when new.status in ('rejected', 'blocked') or coalesce(new.needs_jared, '') <> '' then 'warning'
           when new.status in ('approved', 'live') then 'success' else 'info' end,
      'cy_release:' || new.channel || ':' || new.status || ':' || coalesce(new.version, '') || ':' || md5(coalesce(new.needs_jared, ''))
    )
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists cy_extension_release_notify on public.cy_extension_releases;
create trigger cy_extension_release_notify before update on public.cy_extension_releases
  for each row execute function public.cy_extension_release_notify();

-- First loop report from an installed extension = the fail-safe is really out there.
create or replace function public.cy_failsafe_first_seen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('paused_by_loop_report', 'loop_report_no_match') then
    insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key)
    values ('cy_release', 'Cookie Yeti fail-safe is working in the wild',
            'An installed extension caught a click loop on ' || coalesce(new.domain, 'a site') || ' and paused it for everyone.',
            '/admin/cookie-yeti', 'cy_release:failsafe', 'success', 'cy_failsafe_first_seen')
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists cy_failsafe_first_seen on public.ai_generation_log;
create trigger cy_failsafe_first_seen after insert on public.ai_generation_log
  for each row when (new.status in ('paused_by_loop_report', 'loop_report_no_match'))
  execute function public.cy_failsafe_first_seen();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'cy_extension_releases') then
    alter publication supabase_realtime add table public.cy_extension_releases;
  end if;
end $$;
