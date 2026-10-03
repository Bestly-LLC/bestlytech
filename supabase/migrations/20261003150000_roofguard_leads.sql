-- RoofGuard caller, Phase 1: lead store, phone finder queue, watchdog (Spark, 2026-10-03)
--
-- rg_leads         one row per company from Jared's RoofGuard sheet (1,161 rows), with the
--                  cleaned pitch angle, a 0-100 call priority, and the phone the finder found
-- rg_enrich_runs   one row per roofguard-enrich batch, so the watchdog can tell "working" from "stuck"
-- rg_claim_batch   hands the enrich function the next N leads (skip locked, so overlapping runs never collide)
-- rg_watch         watchdog on pg_cron: resets stuck rows, re-kicks a stalled finder, raises/clears
--                  roofguard.enrich through bestly_raise (bell + push + fix ladder)
-- rg_stats         the counts the /admin/roofguard page shows
--
-- Dialing rules live with the data: line_type stays 'unverified' until a line-type lookup runs,
-- and the dialer (Phase 2) only dials line_type in ('landline','voip') with dnc = false.

create table if not exists public.rg_leads (
  id                  uuid primary key default gen_random_uuid(),
  state               text not null,
  timezone            text not null,
  risk_tier           text not null check (risk_tier in ('LOW','MEDIUM','HIGH')),
  company             text not null,
  contacts            jsonb not null default '[]'::jsonb,
  additional_contacts text,
  notes               text,
  category            text not null default 'generic',
  pitch               text not null,
  pitch_source        text not null default 'category' check (pitch_source in ('bespoke','category','edited')),
  pitch_original      text,
  site_model          text,
  roof_volume         text,
  footprint           text,
  escalate            boolean not null default false,
  priority            int not null default 50 check (priority between 0 and 100),
  -- phone finder
  website             text,
  wikidata_id         text,
  phone               text,            -- E.164, +1XXXXXXXXXX
  phone_source        text,            -- wikidata | website | manual
  phone_source_url    text,
  phone_confidence    int check (phone_confidence between 0 and 100),
  phone_candidates    jsonb not null default '[]'::jsonb,
  line_type           text not null default 'unverified' check (line_type in ('unverified','landline','voip','mobile','unknown')),
  enrich_status       text not null default 'pending' check (enrich_status in ('pending','working','found','not_found','error')),
  enrich_attempts     int not null default 0,
  enrich_error        text,
  claimed_at          timestamptz,
  enriched_at         timestamptz,
  -- calling (Phase 2 fills these)
  call_status         text not null default 'not_called',
  call_attempts       int not null default 0,
  last_called_at      timestamptz,
  dnc                 boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (state, company)
);
create index if not exists rg_leads_enrich_idx on public.rg_leads (enrich_status, priority desc);
create index if not exists rg_leads_priority_idx on public.rg_leads (priority desc);

create table if not exists public.rg_enrich_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  claimed     int not null default 0,
  found       int not null default 0,
  not_found   int not null default 0,
  errors      int not null default 0,
  note        text
);
create index if not exists rg_enrich_runs_started_idx on public.rg_enrich_runs (started_at desc);

create or replace function public.rg_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger rg_leads_touch before update on public.rg_leads for each row execute function public.rg_touch();

alter table public.rg_leads enable row level security;
alter table public.rg_enrich_runs enable row level security;
create policy rg_leads_admin_all on public.rg_leads for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy rg_enrich_runs_admin_read on public.rg_enrich_runs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Next N leads for the finder: pending first, then errors due a retry (max 3 tries), best priority first.
create or replace function public.rg_claim_batch(p_limit int default 15)
returns setof public.rg_leads
language sql security definer set search_path = public as $$
  update rg_leads l set enrich_status = 'working', claimed_at = now(), enrich_attempts = l.enrich_attempts + 1
   where l.id in (
     select id from rg_leads
      where (enrich_status = 'pending')
         or (enrich_status = 'error' and enrich_attempts < 3 and coalesce(enriched_at, claimed_at) < now() - interval '30 minutes')
      order by (enrich_status = 'pending') desc, priority desc
      limit greatest(1, least(p_limit, 50))
      for update skip locked)
  returning l.*;
$$;
revoke execute on function public.rg_claim_batch(int) from public, anon, authenticated;

-- Watchdog. Runs every 10 minutes.
--   1. any row stuck in 'working' > 15 min goes back to 'pending' (self-heal)
--   2. if work remains and no run started in 20 min, kick the finder again (self-heal)
--   3. raise roofguard.enrich when the finder is failing (error rate) or still stalled after a kick;
--      clear it when runs are healthy again
create or replace function public.rg_watch()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reset   int;
  v_left    int;
  v_last    timestamptz;
  v_recent  record;
  v_kicked  boolean := false;
begin
  update rg_leads set enrich_status = 'pending', claimed_at = null
   where enrich_status = 'working' and claimed_at < now() - interval '15 minutes';
  get diagnostics v_reset = row_count;

  select count(*) into v_left from rg_leads
   where enrich_status = 'pending' or (enrich_status = 'error' and enrich_attempts < 3);
  select max(started_at) into v_last from rg_enrich_runs;

  select coalesce(sum(claimed),0) claimed, coalesce(sum(errors),0) errors, count(*) runs
    into v_recent
    from rg_enrich_runs where started_at > now() - interval '1 hour';

  if v_left > 0 and (v_last is null or v_last < now() - interval '20 minutes') then
    perform invoke_edge_function('roofguard-enrich', '{"source":"watchdog"}'::jsonb, 150000);
    v_kicked := true;
  end if;

  if v_left > 0 and v_last is not null and v_last < now() - interval '45 minutes' then
    perform bestly_raise('roofguard.enrich', 'problem', 'warning',
      'RoofGuard phone finder stalled',
      format('No finder run in %s min with %s leads still to look up. Watchdog re-kicked it.',
             round(extract(epoch from now() - v_last) / 60), v_left),
      'roofguard', null, true);
  elsif v_recent.claimed >= 20 and v_recent.errors::numeric / v_recent.claimed > 0.5 then
    perform bestly_raise('roofguard.enrich', 'problem', 'warning',
      'RoofGuard phone finder failing',
      format('%s of %s lookups errored in the last hour. Retries are automatic (3 per lead).',
             v_recent.errors, v_recent.claimed),
      'roofguard', null, false);
  elsif v_recent.runs > 0 or v_left = 0 then
    perform bestly_raise('roofguard.enrich', 'resolved', 'info',
      'RoofGuard phone finder healthy again', null, 'roofguard');
  end if;

  return jsonb_build_object('reset', v_reset, 'left', v_left, 'kicked', v_kicked, 'last_run', v_last);
end $$;
revoke execute on function public.rg_watch() from public, anon, authenticated;

create or replace function public.rg_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'total',      (select count(*) from rg_leads),
    'by_status',  (select coalesce(jsonb_object_agg(enrich_status, n), '{}'::jsonb)
                     from (select enrich_status, count(*) n from rg_leads group by 1) s),
    'with_phone', (select count(*) from rg_leads where phone is not null),
    'dialable',   (select count(*) from rg_leads where phone is not null and line_type in ('landline','voip') and not dnc),
    'last_run',   (select to_jsonb(r) from (select * from rg_enrich_runs order by started_at desc limit 1) r),
    'open_issue', (select to_jsonb(i) from (select key, title, body, opened_at from monitor_issues
                     where key = 'roofguard.enrich' and status = 'open') i)
  );
end $$;
revoke execute on function public.rg_stats() from public, anon;
grant execute on function public.rg_stats() to authenticated;

-- Admin "find now" button: kicks one finder batch immediately.
create or replace function public.rg_kick()
returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return invoke_edge_function('roofguard-enrich', '{"source":"admin"}'::jsonb, 150000);
end $$;
revoke execute on function public.rg_kick() from public, anon;
grant execute on function public.rg_kick() to authenticated;
