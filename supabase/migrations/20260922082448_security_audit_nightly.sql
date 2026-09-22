
-- Nightly security audit: runs, findings, and an insert-only audit trail.
create table if not exists public.security_audit_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','green','yellow','red','failed')),
  trigger text not null default 'scheduled' check (trigger in ('scheduled','manual')),
  checks_total int not null default 0,
  checks_passed int not null default 0,
  checks_warn int not null default 0,
  checks_failed int not null default 0,
  checks_skipped int not null default 0,
  new_findings int not null default 0,
  fixed_findings int not null default 0,
  open_red int not null default 0,
  open_yellow int not null default 0,
  inventory jsonb not null default '{}'::jsonb,
  summary text
);

create table if not exists public.security_findings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  layer text not null,
  asset text not null,
  check_name text not null,
  severity text not null check (severity in ('red','yellow')),
  status text not null default 'open' check (status in ('open','fixed','dismissed')),
  title text not null,
  detail text,
  proposed_fix text,
  evidence jsonb not null default '{}'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  nights_open int not null default 1,
  last_run_id uuid references public.security_audit_runs(id) on delete set null,
  dismissed_reason text,
  updated_at timestamptz not null default now()
);
create index if not exists security_findings_open_idx on public.security_findings(status, severity);

create table if not exists public.security_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  run_id uuid,
  finding_key text,
  actor text not null check (actor in ('audit','jared','scout')),
  action text not null,
  asset text,
  before jsonb,
  after jsonb,
  note text
);
create index if not exists security_audit_log_at_idx on public.security_audit_log(at desc);

-- The trail can only grow.
create or replace function public.security_audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'security_audit_log is append-only';
end $$;
drop trigger if exists trg_security_audit_log_immutable on public.security_audit_log;
create trigger trg_security_audit_log_immutable before update or delete on public.security_audit_log
  for each row execute function public.security_audit_log_immutable();
drop trigger if exists trg_security_audit_log_no_truncate on public.security_audit_log;
create trigger trg_security_audit_log_no_truncate before truncate on public.security_audit_log
  for each statement execute function public.security_audit_log_immutable();

alter table public.security_audit_runs enable row level security;
alter table public.security_findings enable row level security;
alter table public.security_audit_log enable row level security;

drop policy if exists "Admins read security runs" on public.security_audit_runs;
create policy "Admins read security runs" on public.security_audit_runs for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));
drop policy if exists "Admins read security findings" on public.security_findings;
create policy "Admins read security findings" on public.security_findings for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));
drop policy if exists "Admins read security log" on public.security_audit_log;
create policy "Admins read security log" on public.security_audit_log for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));

revoke all on public.security_audit_runs, public.security_findings, public.security_audit_log from anon;
revoke insert, update, delete, truncate on public.security_audit_runs, public.security_findings, public.security_audit_log from authenticated;
grant select on public.security_audit_runs, public.security_findings, public.security_audit_log to authenticated;

-- ── Writer API (called by the nightly job as the service role / postgres) ──

create or replace function public.security_run_start(p_trigger text default 'scheduled', p_inventory jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into security_audit_runs(trigger, inventory) values (coalesce(p_trigger,'scheduled'), coalesce(p_inventory,'{}'::jsonb))
  returning id into v_id;
  insert into security_audit_log(run_id, actor, action, note) values (v_id, 'audit', 'run_started', p_trigger);
  return v_id;
end $$;

-- Record one check result. p_result: pass | red | yellow | skip.
-- Fail = upsert finding; pass = close any open finding with that key.
create or replace function public.security_check(
  p_run uuid, p_key text, p_result text, p_layer text, p_asset text, p_check text,
  p_title text default null, p_detail text default null, p_fix text default null, p_evidence jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare f security_findings; v_out text;
begin
  if p_result not in ('pass','red','yellow','skip') then raise exception 'bad result %', p_result; end if;
  update security_audit_runs set checks_total = checks_total + 1,
    checks_passed = checks_passed + (p_result='pass')::int,
    checks_failed = checks_failed + (p_result='red')::int,
    checks_warn = checks_warn + (p_result='yellow')::int,
    checks_skipped = checks_skipped + (p_result='skip')::int
  where id = p_run;

  select * into f from security_findings where key = p_key for update;

  if p_result = 'pass' then
    if f.id is not null and f.status = 'open' then
      update security_findings set status='fixed', resolved_at=now(), last_run_id=p_run, updated_at=now() where id=f.id;
      update security_audit_runs set fixed_findings = fixed_findings + 1 where id = p_run;
      insert into security_audit_log(run_id, finding_key, actor, action, asset, before, after)
        values (p_run, p_key, 'audit', 'fixed', p_asset, jsonb_build_object('severity',f.severity,'status','open'), jsonb_build_object('status','fixed'));
      return 'fixed';
    end if;
    return 'pass';
  end if;

  if p_result = 'skip' then
    -- "Couldn't check" is itself a yellow finding, so a blind spot never reads as a pass.
    return public.security_check(p_run, p_key || ':unreachable', 'yellow', p_layer, p_asset, p_check,
      coalesce(p_title, 'Couldn''t check: ' || p_check), p_detail, p_fix, p_evidence);
  end if;

  if f.id is null then
    insert into security_findings(key, layer, asset, check_name, severity, title, detail, proposed_fix, evidence, last_run_id)
    values (p_key, p_layer, p_asset, p_check, p_result, coalesce(p_title,p_check), p_detail, p_fix, coalesce(p_evidence,'{}'::jsonb), p_run);
    update security_audit_runs set new_findings = new_findings + 1 where id = p_run;
    insert into security_audit_log(run_id, finding_key, actor, action, asset, after, note)
      values (p_run, p_key, 'audit', 'opened', p_asset, jsonb_build_object('severity',p_result,'title',coalesce(p_title,p_check)), p_detail);
    return 'opened';
  end if;

  if f.status = 'dismissed' then
    update security_findings set last_seen=now(), last_run_id=p_run, updated_at=now() where id=f.id;
    return 'dismissed';
  end if;

  if f.status = 'fixed' then
    update security_findings set status='open', severity=p_result, title=coalesce(p_title,f.title), detail=p_detail,
      proposed_fix=p_fix, evidence=coalesce(p_evidence,'{}'::jsonb), first_seen=now(), last_seen=now(), resolved_at=null,
      nights_open=1, last_run_id=p_run, updated_at=now() where id=f.id;
    update security_audit_runs set new_findings = new_findings + 1 where id = p_run;
    insert into security_audit_log(run_id, finding_key, actor, action, asset, before, after)
      values (p_run, p_key, 'audit', 'reopened', p_asset, jsonb_build_object('status','fixed'), jsonb_build_object('severity',p_result));
    return 'reopened';
  end if;

  -- still open
  v_out := 'still_open';
  if f.severity = 'yellow' and p_result = 'red' then
    v_out := 'worsened';
    insert into security_audit_log(run_id, finding_key, actor, action, asset, before, after)
      values (p_run, p_key, 'audit', 'worsened', p_asset, jsonb_build_object('severity','yellow'), jsonb_build_object('severity','red'));
  end if;
  update security_findings set severity=p_result, title=coalesce(p_title,f.title), detail=p_detail, proposed_fix=p_fix,
    evidence=coalesce(p_evidence,'{}'::jsonb), last_seen=now(),
    nights_open = f.nights_open + case when f.last_run_id is distinct from p_run then 1 else 0 end,
    last_run_id=p_run, updated_at=now() where id=f.id;
  return v_out;
end $$;

create or replace function public.security_run_finish(p_run uuid, p_summary text default null, p_failed boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_red int; v_yellow int; v_new_red int; v_stuck_red int; v_status text; r security_audit_runs;
begin
  select count(*) filter (where severity='red'), count(*) filter (where severity='yellow')
    into v_red, v_yellow from security_findings where status='open';
  select count(*) into v_new_red from security_findings
    where status='open' and severity='red' and first_seen >= (select started_at from security_audit_runs where id=p_run);
  select count(*) into v_stuck_red from security_findings
    where status='open' and severity='red' and nights_open >= 3 and nights_open % 3 = 0 and last_run_id = p_run;

  v_status := case when p_failed then 'failed' when v_red > 0 then 'red' when v_yellow > 0 then 'yellow' else 'green' end;
  update security_audit_runs set finished_at=now(), status=v_status, open_red=v_red, open_yellow=v_yellow,
    summary=p_summary where id=p_run returning * into r;
  insert into security_audit_log(run_id, actor, action, after, note)
    values (p_run, 'audit', 'run_finished', jsonb_build_object('status',v_status,'open_red',v_red,'open_yellow',v_yellow,
      'new',r.new_findings,'fixed',r.fixed_findings,'checks',r.checks_total), p_summary);

  -- Alerts ride the existing monitor pipeline (ntfy push + admin banner).
  if v_red > 0 and (v_new_red > 0 or v_stuck_red > 0) then
    perform bestly_raise('security.red', 'problem', 'error',
      v_red || ' security ' || case when v_red=1 then 'problem' else 'problems' end || ' need you',
      coalesce(p_summary, 'Nightly security audit found red findings.'),
      'security', 'Open bestly.tech/admin/security and review the red findings.');
  elsif v_red = 0 then
    perform bestly_raise('security.red', 'resolved', 'info', 'No red security findings', null, 'security');
  end if;
  if p_failed then
    perform bestly_raise('security.run', 'problem', 'warning', 'Nightly security audit failed', p_summary, 'security', null);
  else
    perform bestly_raise('security.run', 'resolved', 'info', 'Nightly security audit ran', null, 'security');
  end if;

  return jsonb_build_object('status',v_status,'open_red',v_red,'open_yellow',v_yellow,'new',r.new_findings,'fixed',r.fixed_findings,'checks',r.checks_total);
end $$;

-- ── Operator actions from the admin (logged as Jared) ──
create or replace function public.security_finding_set_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare f security_findings;
begin
  if not has_role(auth.uid(), 'admin'::app_role) then raise exception 'not allowed'; end if;
  if p_status not in ('open','dismissed','fixed') then raise exception 'bad status'; end if;
  select * into f from security_findings where id = p_id for update;
  if f.id is null then raise exception 'not found'; end if;
  update security_findings set status=p_status,
    dismissed_reason = case when p_status='dismissed' then p_note else dismissed_reason end,
    resolved_at = case when p_status in ('fixed','dismissed') then now() else null end,
    updated_at=now() where id=p_id;
  insert into security_audit_log(finding_key, actor, action, asset, before, after, note)
    values (f.key, 'jared', case p_status when 'dismissed' then 'dismissed' when 'fixed' then 'marked_fixed' else 'reopened' end,
      f.asset, jsonb_build_object('status',f.status), jsonb_build_object('status',p_status), p_note);
end $$;

revoke execute on function public.security_run_start(text, jsonb) from public, anon, authenticated;
revoke execute on function public.security_check(uuid,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.security_run_finish(uuid,text,boolean) from public, anon, authenticated;
revoke execute on function public.security_finding_set_status(uuid,text,text) from public, anon;
grant execute on function public.security_finding_set_status(uuid,text,text) to authenticated;
