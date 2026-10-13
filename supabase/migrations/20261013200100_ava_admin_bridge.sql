-- 2026-10-13 Ava <-> /admin bridge (docs/ava-admin-bridge-opusplan.md).
-- When Jared calls Ava she can read admin status, read metrics and start/pause call operations, by voice.
-- One edge function (ava-admin, verify_jwt false, own auth): GET /status, POST /calls, GET /metrics, service-only /selftest.
-- Three auth layers: bearer secret (Vault: ava_admin_bridge_secret, mirrored to an ElevenLabs workspace secret of the same
-- name), a live-call check against ElevenLabs, and a caller gate (Jared's two numbers). Nothing here dials or starts anything
-- by itself: call_ops goes through the paths that already exist (hunter_campaign_set, rg_settings.calling_enabled,
-- pipeline_send, ava-assistant action "call").
-- Owner of every alert from this bridge: Ava (notification_owners prefix 'ava.admin-bridge').

-- ------------------------------------------------------------------ 1. the secret (Vault only, never in a table or a log)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ava_admin_bridge_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'ava_admin_bridge_secret',
      'Ava admin bridge: bearer for /functions/v1/ava-admin; mirrored to the ElevenLabs workspace secret ava_admin_bridge_secret');
  end if;
end $$;

create or replace function public.ava_bridge_secret() returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ava_admin_bridge_secret' limit 1
$$;
revoke all on function public.ava_bridge_secret() from public, anon, authenticated;
grant execute on function public.ava_bridge_secret() to service_role;

-- ------------------------------------------------------------------ 2. audit log + idempotency + state
create table if not exists public.ava_admin_bridge_log (
  id              bigint generated always as identity primary key,
  ts              timestamptz not null default now(),
  conversation_id text,
  caller_id       text,                       -- phone (privacy_data_map below)
  op              text not null,              -- status | metrics | start_campaign | pause_campaign | resume_campaign | place_call | selftest | auth
  args            jsonb not null default '{}'::jsonb,   -- never a full phone number: place_call keeps to_last4 only
  ok              boolean not null,
  reason_code     text,
  ms              integer,
  idem_key        text,                       -- conversation_id|action|target, writes only: a repeat inside 2 minutes replays this row
  say             text,
  data            jsonb
);
create index if not exists ava_admin_bridge_log_ts on public.ava_admin_bridge_log (ts desc);
create index if not exists ava_admin_bridge_log_idem on public.ava_admin_bridge_log (idem_key, ts desc) where idem_key is not null;
alter table public.ava_admin_bridge_log enable row level security;
revoke all on public.ava_admin_bridge_log from anon, authenticated;
grant select on public.ava_admin_bridge_log to authenticated;
drop policy if exists ava_admin_bridge_log_admin_read on public.ava_admin_bridge_log;
create policy ava_admin_bridge_log_admin_read on public.ava_admin_bridge_log for select to authenticated
  using (coalesce(public.has_role(auth.uid(), 'admin'::app_role), false));

create table if not exists public.ava_admin_bridge_state (
  id                boolean primary key default true check (id),
  el_secret_id      text,                     -- ElevenLabs workspace secret id (not the value)
  tool_ids          text[] not null default '{}',   -- admin_status, call_ops, admin_metrics
  agent_id          text,
  prompt_marker     text not null default 'Admin bridge',
  last_selftest_at  timestamptz not null default now(),
  ok                boolean,
  p95_ms            integer,
  detail            jsonb not null default '{}'::jsonb,
  last_recovered_at timestamptz,
  updated_at        timestamptz not null default now()
);
insert into public.ava_admin_bridge_state (id, agent_id) values (true, 'agent_0301m44te1qffk08jd2cqwtgy1th') on conflict (id) do nothing;
alter table public.ava_admin_bridge_state enable row level security;
revoke all on public.ava_admin_bridge_state from anon, authenticated;
grant select on public.ava_admin_bridge_state to authenticated;
drop policy if exists ava_admin_bridge_state_admin_read on public.ava_admin_bridge_state;
create policy ava_admin_bridge_state_admin_read on public.ava_admin_bridge_state for select to authenticated
  using (coalesce(public.has_role(auth.uid(), 'admin'::app_role), false));

-- Any new table holding a phone gets a privacy_data_map row in the same migration (CLAUDE.md).
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason) values
  ('ava_admin_bridge_log', 'caller_id', 'phone', 'blank', 'Audit log of Ava''s admin line; the caller number is blanked, the row stays as the record of what was asked')
on conflict (table_name, column_name) do nothing;

-- ------------------------------------------------------------------ 3. read helpers (service role only; the edge function builds the spoken line)
create or replace function public.ava_bridge_health() returns jsonb
language sql stable security definer set search_path = public as $$
  with n as (select title from public.admin_today_rows())
  select jsonb_build_object(
    'issues_error', (select count(*) from public.monitor_issues where status = 'open' and severity = 'error'),
    'issues_open',  (select count(*) from public.monitor_issues where status = 'open'),
    'top_issue',    (select title from public.monitor_issues where status = 'open' order by (severity = 'error') desc, opened_at desc limit 1),
    'needs_n',      (select count(*) from n),
    'needs',        (select coalesce(jsonb_agg(title), '[]'::jsonb) from (select title from n limit 3) t),
    'maya_on',      (select count(*) from public.hunter_campaigns where owner = 'maya' and enabled),
    'maya_total',   (select count(*) from public.hunter_campaigns where owner = 'maya'),
    'reese_on',     coalesce((select calling_enabled from public.rg_settings where id), false),
    'ava_line_ok',  (select ok from public.ava_line_health where source = 'ava'),
    'hunter_bad',   (select count(*) from public.hunter_health where not ok))
$$;

create or replace function public.ava_bridge_lookup(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := left(btrim(coalesce(p_q, '')), 80); d text := regexp_replace(left(btrim(coalesce(p_q, '')), 80), '\D', '', 'g'); lk text; res jsonb;
begin
  if q = '' then return '[]'::jsonb; end if;
  lk := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
    select * from (
      select jsonb_build_object('kind', 'client', 'name', t.display_name, 'status', case when t.active then 'active' else 'inactive' end, 'extra', t.domain) x, 1 o
        from public.tenants t where t.display_name ilike lk or t.domain ilike lk or t.brand ilike lk
      union all
      select jsonb_build_object('kind', 'contact', 'name', c.name, 'status', c.relationship, 'extra', null), 2
        from public.ava_contacts c
       where (length(d) >= 7 and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), least(length(d), 10)) = right(d, least(length(d), 10)))
          or (length(d) < 7 and c.name ilike lk)
      union all
      select jsonb_build_object('kind', 'lead', 'name', m.company, 'status', m.status, 'last_at', m.last_called_at, 'extra', 'Maya, ' || coalesce(m.call_attempts, 0) || ' tries'), 3
        from public.maya_leads m
       where (length(d) >= 7 and right(regexp_replace(coalesce(m.phone, ''), '\D', '', 'g'), least(length(d), 10)) = right(d, least(length(d), 10)))
          or (length(d) < 7 and m.company ilike lk)
      union all
      select jsonb_build_object('kind', 'lead', 'name', r.company, 'status', r.call_status, 'last_at', r.last_called_at, 'extra', 'Reese, ' || coalesce(r.call_attempts, 0) || ' tries'), 4
        from public.rg_leads r
       where (length(d) >= 7 and right(regexp_replace(coalesce(r.phone, ''), '\D', '', 'g'), least(length(d), 10)) = right(d, least(length(d), 10)))
          or (length(d) < 7 and r.company ilike lk)
    ) u order by o limit 6) s;
  return res;
end $$;

create or replace function public.ava_bridge_find(p_kind text, p_q text, p_agent text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := left(btrim(coalesce(p_q, '')), 80); d text := regexp_replace(left(btrim(coalesce(p_q, '')), 80), '\D', '', 'g'); lk text; res jsonb;
begin
  if q = '' then return '[]'::jsonb; end if;
  lk := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if p_kind = 'lead' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select jsonb_build_object('lead_table', lead_table, 'id', id, 'owner', owner, 'company', company, 'status', status, 'phone', phone) x
        from public.pipeline_all
       where (length(d) >= 7 and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), least(length(d), 10)) = right(d, least(length(d), 10)))
          or (length(d) < 7 and company ilike lk)
       order by priority desc nulls last limit 4) s;
  elsif p_kind = 'contact' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select jsonb_build_object('name', name, 'phone', phone, 'relationship', relationship) x
        from public.ava_contacts
       where (length(d) >= 7 and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), least(length(d), 10)) = right(d, least(length(d), 10)))
          or (length(d) < 7 and name ilike lk)
       order by inner_circle desc nulls last, name limit 4) s;
  elsif p_kind = 'campaign' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select jsonb_build_object('slug', slug, 'name', name, 'enabled', enabled, 'daily_target', daily_target, 'owner', owner) x
        from public.hunter_campaigns
       where (p_agent is null or owner = p_agent)
         and (lower(q) in ('all', 'everything', 'every campaign', 'all campaigns') or slug ilike lk or name ilike lk or area ilike lk)
       order by name limit 6) s;
  else
    return '[]'::jsonb;
  end if;
  return res;
end $$;

create or replace function public.ava_bridge_metrics(p_range text default 'today') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  mid timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  t0 timestamptz; t1 timestamptz := now(); res jsonb;
begin
  if p_range = 'yesterday' then t0 := mid - interval '1 day'; t1 := mid;
  elsif p_range = '7d' then t0 := mid - interval '6 days';
  elsif p_range = '30d' then t0 := mid - interval '29 days';
  else p_range := 'today'; t0 := mid; end if;
  select jsonb_build_object(
    'range', p_range, 'from', t0, 'to', t1,
    'ai_spend', (select coalesce(round(sum(cost_usd), 2), 0) from public.ai_spend where at >= t0 and at < t1),
    'agents', jsonb_build_object(
      'maya', jsonb_build_object(
        'calls',  (select count(*) from public.agent_calls where agent_slug = 'maya' and started_at >= t0 and started_at < t1),
        'mins',   (select coalesce(round(sum(duration_secs) / 60.0), 0) from public.agent_calls where agent_slug = 'maya' and started_at >= t0 and started_at < t1),
        'cost',   (select coalesce(round(sum(cost), 2), 0) from public.agent_calls where agent_slug = 'maya' and started_at >= t0 and started_at < t1),
        'booked', (select count(*) from public.pipeline_all where owner = 'maya' and booked_at >= t0 and booked_at < t1),
        'qualified', (select count(*) from public.pipeline_all where owner = 'maya' and status = 'qualified'),
        'queued', (select count(*) from public.pipeline_all where owner = 'maya' and status = 'queued')),
      'leo', jsonb_build_object(
        'calls',  (select count(*) from public.agent_calls where agent_slug = 'leo' and started_at >= t0 and started_at < t1),
        'mins',   (select coalesce(round(sum(duration_secs) / 60.0), 0) from public.agent_calls where agent_slug = 'leo' and started_at >= t0 and started_at < t1),
        'cost',   (select coalesce(round(sum(cost), 2), 0) from public.agent_calls where agent_slug = 'leo' and started_at >= t0 and started_at < t1)),
      'ava', jsonb_build_object(
        'calls',  (select count(*) from public.ava_calls where deleted_at is null and created_at >= t0 and created_at < t1),
        'mins',   (select coalesce(round(sum(duration_sec) / 60.0), 0) from public.ava_calls where deleted_at is null and created_at >= t0 and created_at < t1),
        'cost',   (select coalesce(round(sum(llm_cost), 2), 0) from public.ava_calls where deleted_at is null and created_at >= t0 and created_at < t1)),
      'reese', jsonb_build_object(
        'calls',  (select count(*) from public.rg_calls where deleted_at is null and coalesce(is_test, false) = false and queued_at >= t0 and queued_at < t1),
        'mins',   (select coalesce(round(sum(duration_sec) / 60.0), 0) from public.rg_calls where deleted_at is null and coalesce(is_test, false) = false and queued_at >= t0 and queued_at < t1),
        'booked', (select count(*) from public.pipeline_all where owner = 'reese' and booked_at >= t0 and booked_at < t1),
        'qualified', (select count(*) from public.pipeline_all where owner = 'reese' and status = 'qualified'),
        'queued', (select count(*) from public.pipeline_all where owner = 'reese' and status = 'queued')))
  ) into res;
  return res;
end $$;

-- ------------------------------------------------------------------ 4. who may call these: the edge function (service role) only
do $$
declare f text;
begin
  foreach f in array array['ava_bridge_health()', 'ava_bridge_lookup(text)', 'ava_bridge_find(text,text,text)', 'ava_bridge_metrics(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ------------------------------------------------------------------ 5. dead-man check: if the hourly self-test stops reporting, Ava says so
create or replace function public.ava_admin_bridge_deadman() returns void
language plpgsql security definer set search_path = public as $$
declare s public.ava_admin_bridge_state;
begin
  select * into s from public.ava_admin_bridge_state where id;
  if s.last_selftest_at < now() - interval '150 minutes' then
    perform public.bestly_raise('ava.admin-bridge.stale', 'problem', 'warning', 'her admin line has stopped checking itself',
      'The hourly self-test for the Ava admin bridge has not reported since ' || to_char(s.last_selftest_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM') ||
      ' Pacific. The function may be down; she can still take calls but cannot read the business.', 'ava');
  else
    perform public.bestly_raise('ava.admin-bridge.stale', 'resolved', 'info', 'her admin line is checking itself again', null, 'ava');
  end if;
end $$;
revoke all on function public.ava_admin_bridge_deadman() from public, anon, authenticated;
grant execute on function public.ava_admin_bridge_deadman() to service_role;

-- ------------------------------------------------------------------ 6. the watchdog: hourly at :17, off the hour
select cron.schedule('ava-admin-bridge-selftest', '17 * * * *',
  $c$select public.invoke_edge_function('ava-admin/selftest', '{}'::jsonb, 45000); select public.ava_admin_bridge_deadman();$c$);

-- ------------------------------------------------------------------ 7. team: Ava owns the alerts and lists the schedule; the bridge is her tool
insert into public.notification_owners (prefix, agent_slug, note)
select 'ava.admin-bridge', 'ava', 'Ava admin bridge (2026-10-13)'
 where not exists (select 1 from public.notification_owners where prefix = 'ava.admin-bridge');
update public.notification_owners set agent_slug = 'ava' where prefix = 'ava.admin-bridge' and agent_slug is distinct from 'ava';

update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '"ava-admin-bridge-selftest"'::jsonb),
       updated_at = now()
 where slug = 'ava' and not (coalesce(pulse->'also', '[]'::jsonb) ? 'ava-admin-bridge-selftest');

select public.team_onboard('[{
  "slug": "ava-admin-bridge",
  "name": "Admin Bridge",
  "role": "Ava''s line into the admin",
  "what_it_does": "Lets Ava answer Jared when he calls and asks about the business: what needs him, how the agents did today, and start or pause Maya''s campaigns or place one call. Only Jared''s two numbers get in, every action is read back and needs a yes, calls through it are capped at 20 a day, and every action rings a quiet note signed Ava. Checks itself hourly at :17 (the tools are still on Ava, the shared secret still matches, the answers are fast); fixes what it can and tells Jared as Ava if it cannot. Log of the last actions is on /admin/ava.",
  "tool_of": "ava",
  "runs_on": "cloud",
  "schedule": "live on every call Jared makes to Ava; self-test hourly at :17",
  "icon": "plug",
  "admin_url": "/admin/ava",
  "sort": 60,
  "pulse": {"src": "cron", "job": "ava-admin-bridge-selftest", "gap": 130}
}]'::jsonb);
