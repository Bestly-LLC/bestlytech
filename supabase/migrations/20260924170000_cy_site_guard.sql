-- Cookie Yeti CY-GUARD-01 (extension 1.2.5). Applied via MCP on 2026-09-24; kept here for the record.
-- The extension reports scroll jumps / popups it keeps reopening (cy_report_site_issue); 3 reports in 7 days
-- switch the site off for every user for 14 days (doubling on repeat, max 180). The extension pulls the
-- off-list every 12 h (cy_site_guard_list). bestly.tech is permanently off. Scout: bestly_raise alerts
-- 'cy:site-guard' (a site switched off) and 'cy:guard-spike' (hourly watchdog, >= 40 reports/hour).

create table if not exists public.cy_site_guard_reports (
  id bigserial primary key,
  domain text not null,
  reason text not null,
  version text,
  platform text,
  created_at timestamptz not null default now()
);
create index if not exists cy_sgr_domain_time on public.cy_site_guard_reports(domain, created_at desc);
alter table public.cy_site_guard_reports enable row level security;

create table if not exists public.cy_site_guard (
  domain text primary key,
  off_until timestamptz not null,
  reason text,
  strikes int not null default 1,
  source text not null default 'learned' check (source in ('learned','manual')),
  updated_at timestamptz not null default now()
);
alter table public.cy_site_guard enable row level security;

insert into public.cy_site_guard(domain, off_until, reason, source)
values ('bestly.tech','infinity','Bestly own site - never touch','manual')
on conflict (domain) do update set off_until='infinity', source='manual', reason=excluded.reason, updated_at=now();

create or replace function public.cy_report_site_issue(p_domain text, p_reason text, p_version text default null, p_platform text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d text := lower(regexp_replace(trim(coalesce(p_domain,'')), '^www\.', ''));
  r text := left(coalesce(p_reason,'unknown'), 40);
  n int; g public.cy_site_guard; days int; newly boolean := false;
begin
  if d !~ '^[a-z0-9.-]+\.[a-z]{2,}$' or length(d) > 253 then return jsonb_build_object('ok',false); end if;
  if r !~ '^[a-z_]+$' then r := 'unknown'; end if;
  select count(*) into n from cy_site_guard_reports where domain = d and created_at > now() - interval '1 hour';
  if n >= 60 then return jsonb_build_object('ok',true,'throttled',true); end if;
  insert into cy_site_guard_reports(domain, reason, version, platform)
  values (d, r,
    case when coalesce(p_version,'') ~ '^[0-9][0-9.]{0,19}$' then p_version end,
    case when p_platform in ('chrome','safari') then p_platform end);
  select count(*) into n from cy_site_guard_reports where domain = d and created_at > now() - interval '7 days';
  select * into g from cy_site_guard where domain = d;
  if n >= 3 and (g.domain is null or (g.source = 'learned' and g.off_until < now())) then
    days := least(180, 14 * power(2, coalesce(g.strikes, 0))::int);
    insert into cy_site_guard(domain, off_until, reason, strikes, source)
    values (d, now() + make_interval(days => days), r, 1, 'learned')
    on conflict (domain) do update set off_until = excluded.off_until, reason = excluded.reason,
      strikes = cy_site_guard.strikes + 1, updated_at = now();
    newly := true;
    perform bestly_raise('cy:site-guard', 'problem', 'info',
      'Cookie Yeti switched itself off on ' || d,
      'Users hit ' || r || ' on ' || d || ' (' || n || ' reports in 7 days). Cookie Yeti now leaves this site alone for ' || days || ' days, then retries. Look at it in the Cookie Yeti admin if it is a big site.',
      'cookie-yeti', null, true);
  end if;
  return jsonb_build_object('ok', true, 'site_off', newly);
end $$;

create or replace function public.cy_site_guard_list()
returns table(domain text, off_until timestamptz) language sql stable security definer set search_path = public as $$
  select domain, off_until from cy_site_guard where off_until > now();
$$;

revoke all on function public.cy_report_site_issue(text,text,text,text) from public;
revoke all on function public.cy_site_guard_list() from public;
grant execute on function public.cy_report_site_issue(text,text,text,text) to anon, authenticated;
grant execute on function public.cy_site_guard_list() to anon, authenticated;

create or replace function public.cy_site_guard_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; top text;
begin
  select count(*) into n from cy_site_guard_reports where created_at > now() - interval '1 hour';
  select string_agg(domain || ' (' || c || ')', ', ') into top from (
    select domain, count(*) c from cy_site_guard_reports where created_at > now() - interval '1 hour'
    group by 1 order by 2 desc limit 5) t;
  if n >= 40 then
    perform bestly_raise('cy:guard-spike','problem','warning',
      'Cookie Yeti is tripping its page guard a lot',
      n || ' scroll-jump / popup-loop reports in the last hour. Top sites: ' || coalesce(top,'-') || '. Sites that keep tripping switch themselves off automatically; check whether the latest release broke something.',
      'cookie-yeti', null, false);
  else
    perform bestly_raise('cy:guard-spike','resolved');
  end if;
  delete from cy_site_guard_reports where created_at < now() - interval '90 days';
  return jsonb_build_object('last_hour', n);
end $$;
revoke all on function public.cy_site_guard_watch() from public, anon, authenticated;

select cron.schedule('cy-site-guard-watch', '17 * * * *', 'select public.cy_site_guard_watch()');
-- Privacy policy promise (bestly.tech/privacy-policy §15.3): analytics kept at most 24 months.
select cron.schedule('cy-analytics-retention', '23 4 * * *', $q$delete from public.product_events where created_at < now() - interval '24 months'$q$);
