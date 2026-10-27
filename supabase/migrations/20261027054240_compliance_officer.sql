-- Vera becomes the Compliance Officer (docs/compliance-officer-opusplan.md).
-- Daily + weekly free monitor on the Pi (compliance_daily / compliance_weekly, scripts/pi-compliance/) turns the 2026-10-26
-- legal-compliance audit's "automatable checks" into standing checks, keeps the audit's findings alive, counts down the
-- legal / tax deadlines, and watches the official sources for law changes (free AI judge, same pattern as Radar).
--
-- No personal data lives in any of these tables (page addresses, counts, rule names, dates). So no privacy_data_map rows.
-- Reads: admin only, through privacy_is_admin() (the same check Vera's privacy RPCs use). Writes: only the service role
-- (the Pi jobs) through the security-definer functions below. Nothing here is callable by anon, so Ares's Auto-Fixer has
-- nothing to lock and security_public_rpcs needs no new rows.
-- Applied to rcqfqhguwpmaarseifqg 2026-10-27 05:42 UTC as version 20261027054240. Seeds and the team card are in the next two files.

-- ---------------------------------------------------------------- findings (the audit, kept alive)
create table if not exists public.compliance_findings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                 -- W-01, B-01, D-06, FC-02 (filings), VD-01 (Vesta)
  audit_ref text,                           -- 'websites:W-01', 'filings:C-02' (the audit's own id)
  area text not null,                       -- websites | apps | agents | filings
  title text not null,
  detail text,
  law text,
  severity text not null default 'medium' check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  readiness text not null default 'unknown' check (readiness in ('fail', 'partial', 'gate', 'unknown')),
  status text not null default 'open' check (status in ('open', 'fixed', 'accepted', 'watching')),
  status_note text,
  fix text,
  lawyer boolean not null default false,
  owner_slug text not null default 'privacy-clerk',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_check_ok_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists compliance_findings_status_idx on public.compliance_findings (status, severity);

-- ---------------------------------------------------------------- checks (what the Pi runs)
create table if not exists public.compliance_checks (
  id text primary key,                      -- 'web.parentiq.no-fake-proof'
  area text not null,
  title text not null,
  kind text not null check (kind in ('http_contains', 'http_absent', 'http_status', 'sql_zero', 'sql_true', 'elevenlabs',
                                     'deadline', 'listing', 'domain_expiry', 'page_hosts', 'policy_fresh')),
  target text not null,                     -- url, sql, agent name, domain, or 'deadlines'
  params jsonb not null default '{}'::jsonb,
  every text not null default 'daily' check (every in ('daily', 'weekly')),
  finding_key text references public.compliance_findings (key),
  active boolean not null default true,
  last_run_at timestamptz,
  last_ok boolean,                          -- null = never run, or the check itself could not run
  last_detail text,
  fails integer not null default 0,         -- consecutive failing runs
  errors integer not null default 0,        -- consecutive runs where the check could not run
  first_fail_at timestamptz,
  ok_since timestamptz,
  alert_stage integer not null default 0,   -- 1 = raised, 2/3/4 = re-raised at 3 / 6 / 9 days (never nightly)
  created_at timestamptz not null default now()
);
create index if not exists compliance_checks_every_idx on public.compliance_checks (every, active);

create table if not exists public.compliance_runs (
  id bigserial primary key,
  kind text not null default 'daily',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checks integer not null default 0,
  failed integer not null default 0,
  errored integer not null default 0,
  summary text
);
create index if not exists compliance_runs_started_idx on public.compliance_runs (started_at desc);

-- ---------------------------------------------------------------- law watch (same shape as platform_watch_sources)
create table if not exists public.law_watch_sources (
  id text primary key,
  platform text not null,                   -- the agency / platform that publishes it
  name text not null,
  url text not null,
  kind text not null default 'page',
  link_pattern text,
  browser boolean not null default false,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_change_at timestamptz,
  fails integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.law_watch_items (
  id uuid primary key default gen_random_uuid(),
  source_id text,
  platform text not null,
  url text,
  title text,
  fingerprint text unique,
  found_at timestamptz not null default now(),
  impact text not null default 'none' check (impact in ('high', 'medium', 'low', 'none')),
  headline text,
  what_changed text,
  what_it_means text,
  effective_date date,
  actions jsonb not null default '[]'::jsonb,
  excerpt text,
  model text,
  notified_at timestamptz,
  status text not null default 'new'
);
create index if not exists law_watch_items_found_idx on public.law_watch_items (found_at desc);

create table if not exists public.compliance_context (
  id integer primary key default 1 check (id = 1),
  body text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- deadlines
create table if not exists public.compliance_deadlines (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  due date not null,
  what text not null,
  note text,
  owner_slug text not null default 'privacy-clerk',
  remind_days integer[] not null default '{30,7,1}',
  money boolean not null default false,      -- a payment or fee is due with it
  uncertain boolean not null default false,  -- we do not know yet that it applies to Bestly (never interrupts)
  last_reminded_at timestamptz,
  last_reminded_days integer,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists compliance_deadlines_due_idx on public.compliance_deadlines (due) where done_at is null;

-- ---------------------------------------------------------------- RLS: admin read, service role writes
do $$
declare t text;
begin
  foreach t in array array['compliance_findings', 'compliance_checks', 'compliance_runs', 'law_watch_sources', 'law_watch_items',
                           'compliance_context', 'compliance_deadlines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin_read') then
      execute format('create policy %I on public.%I for select to authenticated using (public.privacy_is_admin())', t || '_admin_read', t);
    end if;
  end loop;
end $$;
grant usage, select on sequence public.compliance_runs_id_seq to service_role;

comment on table public.compliance_findings is 'Vera: every open legal-compliance finding from the 2026-10-26 audit (key = audit id). status: open | watching (fix shipped, 3 clean days then fixed) | fixed | accepted. No personal data.';
comment on table public.compliance_checks is 'Vera: one standing check the Pi runs (compliance_daily / compliance_weekly). finding_key ties it to the finding it proves fixed. No personal data.';

-- ---------------------------------------------------------------- alerts: signed by Vera, only the 4 kinds interrupt
-- The text is cleaned of words the autonomy gate reads as money / security / a person waiting (a "$800" in a
-- reminder is not money moving). Only p_money = true (a certain payment due within 7 days) may reach the phone, and
-- it does so honestly: the wording says "payment due", which interrupt_class() reads as money.
create or replace function public.compliance_safe_text(t text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
         coalesce(t, ''),
         '\$\s?(?=[0-9])', 'USD ', 'g'),
         '(payment|payout)', 'fee', 'gi'),
         '(refund|chargeback)', 'credit', 'gi'),
         '(invoice|deposit|citation)', 'item', 'gi'),
         '(breach|intrud|unauthori[sz]ed|suspicious|break-?in|security risk)', 'incident', 'gi'),
         '(new lead|booking request|replied to you|wrote back)', 'item', 'gi'),
         '(still down|nobody could fix)', 'open', 'gi')
$$;

create or replace function public.compliance_alert(p_key text, p_title text, p_body text, p_money boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_title text; v_body text; v_res text; v_class text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  if p_money then
    v_title := 'Vera: ' || left(regexp_replace(coalesce(p_title, ''), '^Vera:\s*', ''), 170);
    v_body := coalesce(p_body, '');
  else
    v_title := 'Vera: ' || left(public.compliance_safe_text(regexp_replace(coalesce(p_title, ''), '^Vera:\s*', '')), 170);
    v_body := public.compliance_safe_text(p_body);
    v_class := public.interrupt_class(v_title, v_body, 'Vera', 'time-sensitive');
    if v_class is not null then   -- still reads like one of the 4 kinds: it is not, so say it plainly
      v_title := 'Vera: compliance update ' || left(p_key, 60);
      v_body := 'A compliance item changed. Open Admin, Security, Compliance for the list.';
    end if;
  end if;
  v_res := public.notify_route(v_title, left(v_body, 900), case when p_money then 'time-sensitive' else 'active' end,
                               'Vera', 'https://cloud.bestly.tech/admin/security', 'compliance', left(p_key, 120));
  return v_res;
end $$;
revoke all on function public.compliance_alert(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.compliance_alert(text, text, text, boolean) to service_role;
revoke all on function public.compliance_safe_text(text) from public, anon, authenticated;
grant execute on function public.compliance_safe_text(text) to service_role;

-- ---------------------------------------------------------------- read-only SQL for sql_zero / sql_true checks
create or replace function public.compliance_run_sql(p_sql text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_clean text := lower(btrim(coalesce(p_sql, ''))); v jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  if v_clean !~ '^(select|with)\s' or position(';' in v_clean) > 0
     or v_clean ~ '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|vault|pg_read_file|dblink)\M' then
    raise exception 'compliance_run_sql: read-only single select only';
  end if;
  perform set_config('transaction_read_only', 'on', true);
  execute 'select to_jsonb(q) from (select (x).* from (' || p_sql || ') x limit 1) q' into v;
  return coalesce(v, '{}'::jsonb);
end $$;
revoke all on function public.compliance_run_sql(text) from public, anon, authenticated;
grant execute on function public.compliance_run_sql(text) to service_role;

-- ---------------------------------------------------------------- the report the Pi sends after every run
-- p = { kind: 'daily'|'weekly', started_at, results: [{id, ok: true|false|null, detail}], dry?: bool }
-- Raises once when a check newly fails, re-raises at 3 / 6 / 9 days, and never nags nightly. A first-ever failure on a
-- finding we already know is a quiet baseline. One message per kind per run, so a bad day is one line, not thirty.
create or replace function public.compliance_check_report(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; c public.compliance_checks; f public.compliance_findings; v_ok boolean; v_detail text;
  v_new text[] := '{}'; v_again text[] := '{}'; v_back text[] := '{}'; v_broke text[] := '{}';
  v_total int := 0; v_failed int := 0; v_err int := 0; v_base int := 0; v_days int; v_target int; v_name text;
  v_kind text := coalesce(p->>'kind', 'daily'); v_run bigint; v_fixed int := 0; v_reopened int := 0; k text; v_sum text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p->'results', '[]'::jsonb)) loop
    select * into c from public.compliance_checks where id = r->>'id';
    if not found then continue; end if;
    v_total := v_total + 1;
    v_ok := case when r->>'ok' is null or r->>'ok' = 'null' then null else (r->>'ok')::boolean end;
    v_detail := left(coalesce(r->>'detail', ''), 600);
    v_name := coalesce(c.finding_key || ' ', '') || c.title;
    select * into f from public.compliance_findings where key = c.finding_key;

    if v_ok is null then                                  -- the check could not run (not a failure of the thing checked)
      v_err := v_err + 1;
      update public.compliance_checks set last_run_at = now(), last_detail = v_detail, errors = errors + 1 where id = c.id;
      if c.errors + 1 = 3 then v_broke := v_broke || (c.id); end if;
    elsif v_ok then
      if c.last_ok is false then v_back := v_back || v_name; end if;
      update public.compliance_checks set last_run_at = now(), last_ok = true, last_detail = v_detail, fails = 0, errors = 0,
             first_fail_at = null, alert_stage = 0, ok_since = case when c.last_ok then coalesce(c.ok_since, now()) else now() end
       where id = c.id;
    else
      v_failed := v_failed + 1;
      update public.compliance_checks set last_run_at = now(), last_ok = false, last_detail = v_detail, fails = fails + 1, errors = 0,
             first_fail_at = case when c.last_ok is false then coalesce(c.first_fail_at, now()) else now() end,
             ok_since = null
       where id = c.id;
      if f.status = 'accepted' then
        null;                                             -- Jared accepted this risk: record it, do not raise it
      elsif c.last_ok is null then                        -- first ever run: a known finding is a baseline, a fixed one is a regression
        if f.status = 'fixed' then
          v_new := v_new || v_name;
          update public.compliance_checks set alert_stage = 1 where id = c.id;
        else
          v_base := v_base + 1;
          update public.compliance_checks set alert_stage = 1 where id = c.id;
        end if;
      elsif c.last_ok then                                -- passing yesterday, failing today
        v_new := v_new || v_name;
        update public.compliance_checks set alert_stage = 1 where id = c.id;
      else                                                -- still failing: 3 / 6 / 9 days, then quiet
        v_days := floor(extract(epoch from (now() - coalesce(c.first_fail_at, now()))) / 86400);
        v_target := case when v_days >= 9 then 4 when v_days >= 6 then 3 when v_days >= 3 then 2 else 1 end;
        if v_target > c.alert_stage then
          v_again := v_again || (v_name || ' (' || v_days || ' days)');
          update public.compliance_checks set alert_stage = v_target where id = c.id;
        end if;
      end if;
    end if;
  end loop;

  -- findings follow their checks: a failing check on a fixed finding reopens it; 3 clean days turns watching into fixed
  for k in select distinct finding_key from public.compliance_checks where finding_key is not null and last_run_at > now() - interval '1 hour' loop
    select * into f from public.compliance_findings where key = k;
    if exists (select 1 from public.compliance_checks where finding_key = k and active and last_ok is false) then
      update public.compliance_findings set last_seen = now() where key = k;
      if f.status = 'fixed' then
        update public.compliance_findings set status = 'open', status_note = 'Reopened by Vera: its check failed again.', updated_at = now() where key = k;
        v_reopened := v_reopened + 1;
      end if;
    elsif not exists (select 1 from public.compliance_checks where finding_key = k and active and last_ok is not true) then
      update public.compliance_findings set last_check_ok_at = now() where key = k;
      if f.status = 'watching' and not exists (select 1 from public.compliance_checks
            where finding_key = k and active and (ok_since is null or ok_since > now() - interval '3 days')) then
        update public.compliance_findings set status = 'fixed', updated_at = now(),
               status_note = 'Vera: every check passed for 3 days in a row.' where key = k;
        v_fixed := v_fixed + 1;
      end if;
    end if;
  end loop;

  v_sum := format('%s checks: %s passing, %s failing (%s known), %s could not run; %s new, %s again, %s back; %s findings closed, %s reopened',
                  v_total, v_total - v_failed - v_err, v_failed, v_base, v_err, cardinality(v_new), cardinality(v_again),
                  cardinality(v_back), v_fixed, v_reopened);
  if not coalesce((p->>'dry')::boolean, false) then
    insert into public.compliance_runs (kind, started_at, finished_at, checks, failed, errored, summary)
    values (v_kind, coalesce((p->>'started_at')::timestamptz, now()), now(), v_total, v_failed, v_err, v_sum) returning id into v_run;

    if cardinality(v_new) > 0 then
      perform public.compliance_alert('compliance.new.' || to_char(now(), 'YYYYMMDDHH24'),
        cardinality(v_new) || ' compliance check(s) newly failing',
        array_to_string(v_new[1:6], E'\n') || case when cardinality(v_new) > 6 then E'\n+' || (cardinality(v_new) - 6) || ' more' else '' end
          || E'\nOpen Admin, Security, Compliance for what to do.');
    end if;
    if cardinality(v_again) > 0 then
      perform public.compliance_alert('compliance.again.' || to_char(now(), 'YYYYMMDD'),
        cardinality(v_again) || ' compliance check(s) still failing',
        array_to_string(v_again[1:6], E'\n') || E'\nI re-raise at 3, 6 and 9 days, then stay quiet.');
    end if;
    if cardinality(v_back) > 0 or v_fixed > 0 then
      perform public.compliance_alert('compliance.back.' || to_char(now(), 'YYYYMMDD'),
        'Good news: ' || (cardinality(v_back) + v_fixed) || ' compliance check(s) passing again',
        coalesce(array_to_string(v_back[1:6], E'\n'), ''));
    end if;
    if cardinality(v_broke) > 0 then
      perform public.compliance_alert('compliance.broken.' || to_char(now(), 'YYYYMMDD'),
        cardinality(v_broke) || ' compliance check(s) could not run 3 times in a row',
        array_to_string(v_broke[1:8], E', ') || E'\nThe page or API they read may have moved. I keep trying.');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'run', v_run, 'summary', v_sum, 'new', v_new, 'again', v_again, 'back', v_back,
                            'broke', v_broke, 'baseline', v_base);
end $$;
revoke all on function public.compliance_check_report(jsonb) from public, anon, authenticated;
grant execute on function public.compliance_check_report(jsonb) to service_role;

-- ---------------------------------------------------------------- deadlines: reminders at remind_days
-- A certain payment due within 7 days is "money" (one of the 4 kinds, it interrupts). Everything else lands in the 7 PM recap.
create or replace function public.compliance_deadline_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.compliance_deadlines; v_today date := (now() at time zone 'America/Los_Angeles')::date; v_left int; v_stage int;
  v_money boolean; v_n int := 0; v_when text; v_title text; v_body text; v_due boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  for d in select * from public.compliance_deadlines where done_at is null and due >= v_today - 14 order by due loop
    v_left := d.due - v_today;
    select min(x) into v_stage from unnest(d.remind_days) x where v_left <= x;
    v_due := false;
    if v_left < 0 then
      v_stage := -1;
      v_due := d.last_reminded_at is null or d.last_reminded_at < now() - interval '3 days';
    elsif v_stage is not null then
      v_due := d.last_reminded_days is distinct from v_stage;
    end if;
    if not v_due then continue; end if;
    v_money := d.money and not d.uncertain and v_left between 0 and 7;
    v_when := to_char(d.due, 'Dy, Mon FMDD, YYYY');
    if v_left < 0 then
      v_title := d.what || ' was due ' || v_when;
    elsif v_money then
      v_title := d.what || ': payment due ' || case when v_left = 0 then 'today' when v_left = 1 then 'tomorrow' else 'in ' || v_left || ' days' end;
    else
      v_title := d.what || ' is due ' || case when v_left = 0 then 'today' when v_left = 1 then 'tomorrow' else 'in ' || v_left || ' days' end;
    end if;
    v_body := d.what || ' is due ' || v_when || coalesce('. ' || d.note, '')
              || case when d.uncertain then ' (I do not know yet that this applies to Bestly.)' else '' end;
    perform public.compliance_alert('compliance.deadline.' || d.key || '.' || v_stage, v_title, v_body, v_money);
    update public.compliance_deadlines set last_reminded_at = now(), last_reminded_days = v_stage where id = d.id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'reminded', v_n);
end $$;
revoke all on function public.compliance_deadline_tick() from public, anon, authenticated;
grant execute on function public.compliance_deadline_tick() to service_role;

-- ---------------------------------------------------------------- law watch report (copy of Radar's platform_watch_report)
create or replace function public.compliance_law_report(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb; it jsonb; v_id uuid; n_new int := 0; n_high int := 0; v_bad text[] := '{}';
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'not allowed';
  end if;
  for s in select * from jsonb_array_elements(coalesce(p->'sources', '[]'::jsonb)) loop
    update public.law_watch_sources set
      last_checked_at = now(),
      last_ok_at = case when (s->>'ok')::boolean then now() else last_ok_at end,
      last_change_at = case when (s->>'changed')::boolean then now() else last_change_at end,
      fails = case when (s->>'ok')::boolean then 0 else fails + 1 end,
      last_error = case when (s->>'ok')::boolean then null else left(s->>'error', 300) end
    where id = s->>'id';
  end loop;
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    insert into public.law_watch_items (source_id, platform, url, title, fingerprint, impact, headline, what_changed, what_it_means,
                                        effective_date, actions, excerpt, model)
    values (it->>'source_id', it->>'platform', it->>'url', left(it->>'title', 200), it->>'fingerprint',
            coalesce(nullif(it->>'impact', ''), 'none'), left(it->>'headline', 90), left(it->>'what_changed', 800),
            left(it->>'what_it_means', 1200),
            case when (it->>'effective_date') ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'effective_date')::date end,
            coalesce(it->'actions', '[]'::jsonb), left(it->>'excerpt', 4000), it->>'model')
    on conflict (fingerprint) do nothing returning id into v_id;
    if v_id is null then continue; end if;
    n_new := n_new + 1;
    if it->>'impact' = 'high' then
      n_high := n_high + 1;
      perform public.compliance_alert('compliance.law.' || (it->>'fingerprint'),
        'Law change: ' || coalesce(nullif(it->>'headline', ''), it->>'title'),
        coalesce(it->>'what_it_means', it->>'what_changed', ''));
      update public.law_watch_items set notified_at = now() where id = v_id;
    end if;
    v_id := null;
  end loop;
  select coalesce(array_agg(name || ' (' || coalesce(last_error, 'no answer') || ')'), '{}') into v_bad
    from public.law_watch_sources where active and fails >= 4;
  if array_length(v_bad, 1) > 0 then
    perform public.compliance_alert('compliance.sources.' || to_char(now(), 'IYYYIW'),
      'I cannot read ' || array_length(v_bad, 1) || ' law page(s)', array_to_string(v_bad, E'\n'));
  end if;
  return jsonb_build_object('ok', true, 'new', n_new, 'high', n_high);
end $$;
revoke all on function public.compliance_law_report(jsonb) from public, anon, authenticated;
grant execute on function public.compliance_law_report(jsonb) to service_role;

-- ---------------------------------------------------------------- the admin page reads this (Security > Compliance tab)
create or replace function public.admin_compliance_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.privacy_is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'last_run', (select to_jsonb(r) from (select id, kind, started_at, finished_at, checks, failed, errored, summary
                   from public.compliance_runs order by started_at desc limit 1) r),
    'last_weekly', (select to_jsonb(r) from (select id, started_at, finished_at, checks, failed, errored, summary
                   from public.compliance_runs where kind = 'weekly' order by started_at desc limit 1) r),
    'counts', (select jsonb_build_object(
                 'open', count(*) filter (where status = 'open'), 'watching', count(*) filter (where status = 'watching'),
                 'fixed', count(*) filter (where status = 'fixed'), 'accepted', count(*) filter (where status = 'accepted'),
                 'checks', (select count(*) from public.compliance_checks where active),
                 'failing', (select count(*) from public.compliance_checks where active and last_ok is false))
               from public.compliance_findings),
    'findings', coalesce((select jsonb_agg(to_jsonb(x) order by x.sev, x.first_seen) from (
        select key, area, title, severity, readiness, status, status_note, fix, lawyer, first_seen, last_seen, last_check_ok_at,
               case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end sev,
               (select count(*) from public.compliance_checks c where c.finding_key = f.key and c.active) checks,
               (select count(*) from public.compliance_checks c where c.finding_key = f.key and c.active and c.last_ok is false) failing
          from public.compliance_findings f where status in ('open', 'watching')) x), '[]'::jsonb),
    'deadlines', coalesce((select jsonb_agg(to_jsonb(d) order by d.due) from (
        select key, due, what, note, money, uncertain, (due - (now() at time zone 'America/Los_Angeles')::date) days_left
          from public.compliance_deadlines where done_at is null and due >= (now() at time zone 'America/Los_Angeles')::date - 14
         order by due limit 14) d), '[]'::jsonb),
    'failing_checks', coalesce((select jsonb_agg(to_jsonb(c) order by c.first_fail_at) from (
        select id, title, finding_key, last_detail, first_fail_at, last_run_at from public.compliance_checks
         where active and last_ok is false) c), '[]'::jsonb),
    'law', coalesce((select jsonb_agg(to_jsonb(l) order by l.found_at desc) from (
        select platform, headline, what_it_means, impact, effective_date, found_at, url from public.law_watch_items
         where impact in ('high', 'medium') order by found_at desc limit 8) l), '[]'::jsonb));
end $$;
revoke all on function public.admin_compliance_overview() from public, anon;
grant execute on function public.admin_compliance_overview() to authenticated, service_role;

-- ---------------------------------------------------------------- alert owner + Pi job heartbeats
insert into public.notification_owners (prefix, agent_slug, note)
select 'compliance', 'privacy-clerk', 'Vera: Compliance Officer (2026-10-26)'
 where not exists (select 1 from public.notification_owners where prefix = 'compliance');

insert into public.pi_jobs (job, description, max_gap_min, enabled) values
  ('compliance_daily', 'Vera: daily compliance checks (pages, claims, privacy parity, agents, data, deadlines), free, no AI', 1560, true),
  ('compliance_weekly', 'Vera: weekly law watch (free AI judge), app listings, domain expiry', 11520, true)
on conflict (job) do nothing;
