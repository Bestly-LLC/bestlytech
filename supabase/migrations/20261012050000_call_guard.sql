-- 2026-10-12 Call Guard: the safety layer for AI outbound calls (docs/call-guard-opusplan.md).
-- Every AI outbound call comes from a *_next_call_batch() that uses call_gate() / call_line_ok(). Mobile, unverified, unknown and
-- stale lines are never dialed; VoIP only when the business itself published the number; mobile only with a call_consents row.
-- Fail closed: the nightly self-test turns calling_enabled OFF for both sellers if any check fails.
-- This migration NEVER sets calling_enabled to true. Nothing here places a call or sends a text.
--
-- UNDO for rg_next_call_batch (the definition that was live before this migration, saved by pg_get_functiondef 2026-10-12):
--
-- CREATE OR REPLACE FUNCTION public.rg_next_call_batch(p_limit integer DEFAULT 10)
--  RETURNS TABLE(lead_id uuid, company text, phone text, timezone text, contact_name text, contact_title text, pitch_angle text, category text, state text, attempt integer)
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
--   with s as (select * from rg_settings where id),
--   today as (select count(*) n from rg_calls where queued_at > now() - interval '24 hours' and not is_test and direction = 'outbound'),
--   ever as (select count(distinct lead_id) n from rg_calls where not is_test and direction = 'outbound')
--   select l.id, l.company, l.phone, l.timezone, l.contacts->0->>'name', l.contacts->0->>'title',
--          l.pitch, l.category, l.state, l.call_attempts + 1
--     from rg_leads l, s, today, ever
--    where s.calling_enabled
--      and l.phone is not null
--      and l.line_type in ('landline','voip')
--      and not l.dnc
--      and not exists (select 1 from rg_dnc d where d.phone = l.phone)
--      and l.call_status not in ('booked','not_interested','do_not_call','wrong_number','in_progress')
--      and l.call_attempts < s.max_attempts
--      and case when l.next_call_at is not null then now() >= l.next_call_at - interval '10 minutes'
--               else (l.last_called_at is null or rg_business_days_between(l.last_called_at, now(), l.timezone) >= s.min_gap_bdays) end
--      and extract(isodow from (now() at time zone l.timezone)) < 6
--      and extract(hour from (now() at time zone l.timezone)) >= s.window_start_hour
--      and extract(hour from (now() at time zone l.timezone)) <  s.window_end_hour
--      and not exists (select 1 from rg_holidays h where h.day = (now() at time zone l.timezone)::date)
--      and today.n < s.daily_cap
--      and (s.pilot_limit is null or ever.n < s.pilot_limit or exists (select 1 from rg_calls c where c.lead_id = l.id and not c.is_test and c.direction = 'outbound'))
--    order by (l.next_call_at is not null) desc, l.next_call_at, l.priority desc
--    limit greatest(0, least(p_limit, (select daily_cap from s) - (select n from today)));
-- $function$

-- ---------------------------------------------------------------------------------------------- helpers
-- Last 10 digits, so +1 (555) 010-0142, 5550100142 and +15550100142 are the same person.
create or replace function public.call_phone_key(p_phone text) returns text
language sql immutable parallel safe set search_path to 'public' as $$
  select case when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 7
              then right(regexp_replace(p_phone, '\D', '', 'g'), 10) end
$$;

-- null = the line may be dialed. Otherwise a short reason.
create or replace function public.call_line_ok(p_line_type text, p_phone_source text, p_checked_at timestamptz) returns text
language sql stable set search_path to 'public' as $$
  select case
    when lower(coalesce(p_line_type, '')) = 'mobile'     then 'mobile'
    when lower(coalesce(p_line_type, '')) = 'unverified' then 'unverified'
    when lower(coalesce(p_line_type, '')) not in ('landline', 'voip') then 'unknown'
    when p_checked_at is null or p_checked_at < now() - interval '90 days' then 'line-check-stale'
    when lower(p_line_type) = 'voip' and lower(coalesce(p_phone_source, '')) not in ('website', 'osm', 'directory', 'sec', 'wikidata')
         then 'voip-not-business-listed'
  end
$$;

-- ---------------------------------------------------------------------------------------------- consent
create table if not exists public.call_consents (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  phone_key    text generated always as (public.call_phone_key(phone)) stored,
  seller       text not null check (seller in ('bestly', 'roofguard')),
  source       text not null,
  consent_text text not null,
  captured_at  timestamptz not null default now(),
  form_ref     text,
  revoked_at   timestamptz
);
comment on table public.call_consents is 'Written consent to be called or texted (TCPA). A live row (revoked_at null) lets a number past the line-type check, mobile included. It never beats a do-not-call. Service role only.';
create index if not exists call_consents_live_idx on public.call_consents (seller, phone_key) where revoked_at is null;
alter table public.call_consents enable row level security;
revoke all on public.call_consents from anon, authenticated;

-- Vera (Privacy Clerk) deletes per person only from this map.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason)
values ('call_consents', 'phone', 'phone', 'delete', null)
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------------------------- do-not-call, per seller
create or replace function public.call_is_dnc(p_seller text, p_phone text) returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare k text := public.call_phone_key(p_phone);
begin
  if k is null then return false; end if;
  if p_seller = 'roofguard' then
    return exists (select 1 from rg_dnc d where public.call_phone_key(d.phone) = k)
        or exists (select 1 from rg_leads l where public.call_phone_key(l.phone) = k and (l.dnc or l.call_status = 'do_not_call'));
  elsif p_seller = 'bestly' then
    return exists (select 1 from hunter_optouts o where public.call_phone_key(o.phone) = k)
        or exists (select 1 from maya_leads m where public.call_phone_key(m.phone) = k and (m.dnc or m.status = 'opted_out'));
  end if;
  return true;   -- unknown seller: treat as blocked
end $$;

-- ---------------------------------------------------------------------------------------------- the gate
-- Everything except the clock: seller DNC, then consent or line type. null = OK.
create or replace function public.call_gate_lead(p_seller text, p_phone text, p_line_type text, p_phone_source text, p_checked_at timestamptz) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare k text := public.call_phone_key(p_phone); v text;
begin
  if p_seller not in ('bestly', 'roofguard') then return 'unknown-seller'; end if;
  if k is null then return 'no-phone'; end if;
  if public.call_is_dnc(p_seller, p_phone) then return 'dnc'; end if;       -- asked not to be called: beats consent
  if exists (select 1 from call_consents c where c.seller = p_seller and c.phone_key = k and c.revoked_at is null) then return null; end if;
  return public.call_line_ok(p_line_type, p_phone_source, p_checked_at);
end $$;

-- The clock is injectable so the self-test can ask about a Saturday. Business hours only: weekdays 9 AM to 5 PM in the
-- business's own time zone, no holidays (rg_holidays).
create or replace function public.call_gate_at(p_now timestamptz, p_seller text, p_phone text, p_line_type text, p_phone_source text, p_checked_at timestamptz, p_timezone text) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare v text; loc timestamp;
begin
  v := public.call_gate_lead(p_seller, p_phone, p_line_type, p_phone_source, p_checked_at);
  if v is not null then return v; end if;
  begin
    loc := p_now at time zone coalesce(p_timezone, '');
  exception when others then
    return 'bad-timezone';
  end;
  if extract(isodow from loc) >= 6 then return 'weekend'; end if;
  if extract(hour from loc) < 9 or extract(hour from loc) >= 17 then return 'outside-hours'; end if;
  if exists (select 1 from rg_holidays h where h.day = loc::date) then return 'holiday'; end if;
  return null;
end $$;

create or replace function public.call_gate(p_seller text, p_phone text, p_line_type text, p_phone_source text, p_checked_at timestamptz, p_timezone text) returns text
language sql stable security definer set search_path to 'public' as $$
  select public.call_gate_at(now(), p_seller, p_phone, p_line_type, p_phone_source, p_checked_at, p_timezone)
$$;

-- ---------------------------------------------------------------------------------------------- Reese: only the line_type condition changes
create or replace function public.rg_next_call_batch(p_limit integer DEFAULT 10)
 RETURNS TABLE(lead_id uuid, company text, phone text, timezone text, contact_name text, contact_title text, pitch_angle text, category text, state text, attempt integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with s as (select * from rg_settings where id),
  today as (select count(*) n from rg_calls where queued_at > now() - interval '24 hours' and not is_test and direction = 'outbound'),
  ever as (select count(distinct lead_id) n from rg_calls where not is_test and direction = 'outbound')
  select l.id, l.company, l.phone, l.timezone, l.contacts->0->>'name', l.contacts->0->>'title',
         l.pitch, l.category, l.state, l.call_attempts + 1
    from rg_leads l, s, today, ever
   where s.calling_enabled
     and l.phone is not null
     and public.call_line_ok(l.line_type, l.phone_source, l.line_type_checked_at) is null
     and not l.dnc
     and not exists (select 1 from rg_dnc d where d.phone = l.phone)
     and l.call_status not in ('booked','not_interested','do_not_call','wrong_number','in_progress')
     and l.call_attempts < s.max_attempts
     and case when l.next_call_at is not null then now() >= l.next_call_at - interval '10 minutes'
              else (l.last_called_at is null or rg_business_days_between(l.last_called_at, now(), l.timezone) >= s.min_gap_bdays) end
     and extract(isodow from (now() at time zone l.timezone)) < 6
     and extract(hour from (now() at time zone l.timezone)) >= s.window_start_hour
     and extract(hour from (now() at time zone l.timezone)) <  s.window_end_hour
     and not exists (select 1 from rg_holidays h where h.day = (now() at time zone l.timezone)::date)
     and today.n < s.daily_cap
     and (s.pilot_limit is null or ever.n < s.pilot_limit or exists (select 1 from rg_calls c where c.lead_id = l.id and not c.is_test and c.direction = 'outbound'))
   order by (l.next_call_at is not null) desc, l.next_call_at, l.priority desc
   limit greatest(0, least(p_limit, (select daily_cap from s) - (select n from today)));
$function$;

-- ---------------------------------------------------------------------------------------------- Maya: the only allowed source for a Maya dialer
create table if not exists public.maya_call_settings (
  id                boolean primary key default true check (id),
  calling_enabled   boolean not null default false,
  window_start_hour integer not null default 9  check (window_start_hour between 9 and 16),
  window_end_hour   integer not null default 17 check (window_end_hour between 10 and 17),
  max_attempts      integer not null default 3,
  min_gap_bdays     integer not null default 2,
  daily_cap         integer not null default 20,
  pilot_limit       integer,
  updated_at        timestamptz not null default now(),
  updated_by        text
);
comment on table public.maya_call_settings is 'Maya outbound calling switches. calling_enabled stays false until a lawyer signs off and a Maya dialer exists. Hours can only narrow 9 AM to 5 PM, never widen.';
insert into public.maya_call_settings (id) values (true) on conflict (id) do nothing;
alter table public.maya_call_settings enable row level security;
drop policy if exists "admin reads maya call settings" on public.maya_call_settings;
create policy "admin reads maya call settings" on public.maya_call_settings for select to authenticated using (public.team_is_admin());
revoke all on public.maya_call_settings from anon;

create or replace function public.maya_next_call_batch(p_limit integer default 10)
returns table(lead_id uuid, company text, phone text, timezone text, owner_name text, category text, state text, attempt integer)
language sql stable security definer set search_path to 'public' as $$
  with s as (select * from maya_call_settings where id),
  today as (select count(*) n from maya_leads where last_called_at > now() - interval '24 hours'),
  ever as (select count(*) n from maya_leads where last_called_at is not null)
  select l.id, l.company, l.phone, l.timezone, l.owner_name, l.category, l.state, l.call_attempts + 1
    from maya_leads l, s, today, ever
   where s.calling_enabled
     and l.status = 'queued'
     and l.phone is not null
     and not l.dnc
     and l.call_attempts < s.max_attempts
     and case when l.next_call_at is not null then now() >= l.next_call_at - interval '10 minutes'
              else (l.last_called_at is null or rg_business_days_between(l.last_called_at, now(), l.timezone) >= s.min_gap_bdays) end
     and public.call_gate('bestly', l.phone, l.line_type, l.phone_source, l.line_type_checked_at, l.timezone) is null
     and extract(hour from (now() at time zone l.timezone)) >= s.window_start_hour
     and extract(hour from (now() at time zone l.timezone)) <  s.window_end_hour
     and today.n < s.daily_cap
     and (s.pilot_limit is null or ever.n < s.pilot_limit or l.last_called_at is not null)
   order by (l.next_call_at is not null) desc, l.next_call_at, l.fit_score desc nulls last, l.created_at
   limit greatest(0, least(p_limit, (select daily_cap from s) - (select n from today)));
$$;

-- ---------------------------------------------------------------------------------------------- self-test and its log
create table if not exists public.call_guard_runs (
  id       bigserial primary key,
  ran_at   timestamptz not null default now(),
  ok       boolean not null,
  checks   integer not null default 0,
  failures jsonb not null default '[]'::jsonb
);
alter table public.call_guard_runs enable row level security;
drop policy if exists "admin reads call guard runs" on public.call_guard_runs;
create policy "admin reads call guard runs" on public.call_guard_runs for select to authenticated using (public.team_is_admin());
revoke all on public.call_guard_runs from anon;

-- Synthetic phones only (555-01xx is reserved for fiction). Rows it inserts are rolled back inside the function.
create or replace function public.call_gate_selftest() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  tz  text := 'America/Los_Angeles';
  d_ok date; d_sat date; t_ok timestamptz; t_sat timestamptz; t_late timestamptz;
  fresh timestamptz := now() - interval '1 day';
  old   timestamptz := now() - interval '91 days';
  items jsonb := '[]'::jsonb; x jsonb; fails jsonb := '[]'::jsonb;
  p1 text := '+15555550141'; p2 text := '+15555550142'; p3 text := '+15555550143'; p4 text := '+15555550144';
  def text;
begin
  select g::date into d_ok from generate_series(current_date + 1, current_date + 21, interval '1 day') g
   where extract(isodow from g) < 6 and not exists (select 1 from rg_holidays h where h.day = g::date) order by g limit 1;
  select g::date into d_sat from generate_series(current_date + 1, current_date + 7, interval '1 day') g where extract(isodow from g) = 6 limit 1;
  t_ok   := (d_ok  + time '12:00') at time zone tz;
  t_late := (d_ok  + time '20:00') at time zone tz;
  t_sat  := (d_sat + time '12:00') at time zone tz;

  items := items || jsonb_build_array(
    jsonb_build_object('n', 'mobile is blocked',                   'got', public.call_gate_at(t_ok,  'roofguard', p1, 'mobile',     'website', fresh, tz), 'want', 'mobile'),
    jsonb_build_object('n', 'unverified is blocked',               'got', public.call_gate_at(t_ok,  'roofguard', p1, 'unverified', 'website', null,  tz), 'want', 'unverified'),
    jsonb_build_object('n', 'unknown is blocked',                  'got', public.call_gate_at(t_ok,  'roofguard', p1, 'unknown',    'website', fresh, tz), 'want', 'unknown'),
    jsonb_build_object('n', 'a line checked 91 days ago is stale', 'got', public.call_gate_at(t_ok,  'roofguard', p1, 'landline',   'website', old,   tz), 'want', 'line-check-stale'),
    jsonb_build_object('n', 'a landline never checked is blocked', 'got', public.call_gate_at(t_ok,  'roofguard', p1, 'landline',   'website', null,  tz), 'want', 'line-check-stale'),
    jsonb_build_object('n', 'VoIP found by search is blocked',     'got', public.call_gate_at(t_ok,  'roofguard', p1, 'voip',       'search',  fresh, tz), 'want', 'voip-not-business-listed'),
    jsonb_build_object('n', 'VoIP with no source is blocked',      'got', public.call_gate_at(t_ok,  'roofguard', p1, 'voip',       null,      fresh, tz), 'want', 'voip-not-business-listed'),
    jsonb_build_object('n', 'VoIP from the business website is OK','got', public.call_gate_at(t_ok,  'roofguard', p1, 'voip',       'website', fresh, tz), 'want', null),
    jsonb_build_object('n', 'VoIP from OpenStreetMap is OK',       'got', public.call_gate_at(t_ok,  'bestly',    p1, 'voip',       'osm',     fresh, tz), 'want', null),
    jsonb_build_object('n', 'landline is OK',                      'got', public.call_gate_at(t_ok,  'roofguard', p1, 'landline',   'website', fresh, tz), 'want', null),
    jsonb_build_object('n', 'Saturday is blocked',                 'got', public.call_gate_at(t_sat, 'roofguard', p1, 'landline',   'website', fresh, tz), 'want', 'weekend'),
    jsonb_build_object('n', '8 PM is blocked',                     'got', public.call_gate_at(t_late,'roofguard', p1, 'landline',   'website', fresh, tz), 'want', 'outside-hours'),
    jsonb_build_object('n', 'a bad time zone is blocked',          'got', public.call_gate_at(t_ok,  'roofguard', p1, 'landline',   'website', fresh, 'Mars/Base'), 'want', 'bad-timezone'),
    jsonb_build_object('n', 'an unknown seller is blocked',        'got', public.call_gate_at(t_ok,  'acme',      p1, 'landline',   'website', fresh, tz), 'want', 'unknown-seller'),
    jsonb_build_object('n', 'a missing phone is blocked',          'got', public.call_gate_at(t_ok,  'roofguard', null, 'landline',  'website', fresh, tz), 'want', 'no-phone'));

  -- checks that need synthetic rows; everything inside is rolled back
  begin
    insert into rg_holidays (day, name) values (d_ok, 'selftest') on conflict (day) do nothing;
    items := items || jsonb_build_array(jsonb_build_object('n', 'a holiday is blocked', 'got', public.call_gate_at(t_ok, 'roofguard', p1, 'landline', 'website', fresh, tz), 'want', 'holiday'));

    insert into rg_dnc (phone) values (p2);
    items := items || jsonb_build_array(
      jsonb_build_object('n', 'RoofGuard do-not-call is blocked',          'got', public.call_gate_at(t_ok, 'roofguard', p2, 'landline', 'website', fresh, tz), 'want', 'dnc'),
      jsonb_build_object('n', 'do-not-call matches a differently typed number', 'got', public.call_gate_at(t_ok, 'roofguard', '(555) 555-0142', 'landline', 'website', fresh, tz), 'want', 'dnc'),
      jsonb_build_object('n', 'RoofGuard do-not-call does not block Bestly', 'got', public.call_gate_at(t_ok, 'bestly', p2, 'landline', 'website', fresh, tz), 'want', null));

    insert into hunter_optouts (phone, source_caller) values (p3, 'selftest');
    items := items || jsonb_build_array(
      jsonb_build_object('n', 'Bestly opt-out is blocked',                 'got', public.call_gate_at(t_ok, 'bestly', p3, 'landline', 'osm', fresh, tz), 'want', 'dnc'),
      jsonb_build_object('n', 'Bestly opt-out does not block RoofGuard',   'got', public.call_gate_at(t_ok, 'roofguard', p3, 'landline', 'website', fresh, tz), 'want', null));

    insert into call_consents (phone, seller, source, consent_text) values (p4, 'bestly', 'selftest', 'selftest');
    items := items || jsonb_build_array(
      jsonb_build_object('n', 'consent lets a mobile through',             'got', public.call_gate_at(t_ok, 'bestly', p4, 'mobile', 'website', fresh, tz), 'want', null),
      jsonb_build_object('n', 'consent for Bestly does not cover RoofGuard','got', public.call_gate_at(t_ok, 'roofguard', p4, 'mobile', 'website', fresh, tz), 'want', 'mobile'));
    update call_consents set revoked_at = now() where phone = p4;
    items := items || jsonb_build_array(jsonb_build_object('n', 'a revoked consent no longer counts', 'got', public.call_gate_at(t_ok, 'bestly', p4, 'mobile', 'website', fresh, tz), 'want', 'mobile'));
    update call_consents set revoked_at = null where phone = p4;
    insert into hunter_optouts (phone, source_caller) values (p4, 'selftest');
    items := items || jsonb_build_array(jsonb_build_object('n', 'consent does not beat do-not-call', 'got', public.call_gate_at(t_ok, 'bestly', p4, 'mobile', 'website', fresh, tz), 'want', 'dnc'));

    raise exception 'call_gate_selftest_rollback';
  exception when others then
    if sqlerrm <> 'call_gate_selftest_rollback' then
      fails := fails || to_jsonb('the synthetic-data checks could not run: ' || sqlerrm);
    end if;
  end;

  -- the dialers must still be wired to the gate (someone pasting back an old definition would silently undo it)
  select pg_get_functiondef('public.rg_next_call_batch(integer)'::regprocedure) into def;
  items := items || jsonb_build_array(jsonb_build_object('n', 'rg_next_call_batch uses call_line_ok', 'got', case when def like '%call_line_ok(%' then 'ok' end, 'want', 'ok'));
  select pg_get_functiondef('public.maya_next_call_batch(integer)'::regprocedure) into def;
  items := items || jsonb_build_array(jsonb_build_object('n', 'maya_next_call_batch uses call_gate', 'got', case when def like '%call_gate(%' then 'ok' end, 'want', 'ok'));

  for x in select * from jsonb_array_elements(items) loop
    if (x->>'got') is distinct from (x->>'want') then
      fails := fails || to_jsonb((x->>'n') || ': got ' || coalesce(x->>'got', 'OK (null)') || ', wanted ' || coalesce(x->>'want', 'OK (null)'));
    end if;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(fails) = 0, 'checks', jsonb_array_length(items), 'failures', fails, 'at', now());
end $$;

-- Nightly job body. Runs the self-test, logs it, and fails closed.
create or replace function public.call_guard_nightly(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; msg text;
begin
  -- cron fires at both 9:10 and 10:10 UTC; only the run that lands at 2 AM Pacific works (Daylight Saving proof)
  if not p_force and extract(hour from now() at time zone 'America/Los_Angeles') <> 2 then
    return jsonb_build_object('skipped', 'not 2 AM Pacific');
  end if;
  begin
    r := public.call_gate_selftest();
  exception when others then
    r := jsonb_build_object('ok', false, 'checks', 0, 'failures', jsonb_build_array('the self-test itself crashed: ' || sqlerrm));
  end;
  insert into call_guard_runs (ok, checks, failures) values ((r->>'ok')::boolean, coalesce((r->>'checks')::int, 0), coalesce(r->'failures', '[]'::jsonb));
  delete from call_guard_runs where ran_at < now() - interval '60 days';

  if (r->>'ok')::boolean then
    perform public.bestly_raise('call-guard.selftest', 'resolved', 'info', 'Call Guard: my safety checks pass again', null, 'security');
  else
    update rg_settings set calling_enabled = false, updated_at = now(), updated_by = 'call-guard' where id and calling_enabled;
    update maya_call_settings set calling_enabled = false, updated_at = now(), updated_by = 'call-guard' where id and calling_enabled;
    msg := left('Outbound calling for RoofGuard and Maya is switched off. Failed: ' || (select string_agg(f, '; ') from jsonb_array_elements_text(r->'failures') f), 500);
    -- p_healed true: switching calling off is the self-heal, so this lands in the bell and the 7 PM recap, not a phone push
    perform public.bestly_raise('call-guard.selftest', 'problem', 'error', 'Call Guard: my safety checks failed, outbound calling is blocked until fixed', msg, 'security', null, true);
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------- admin report (the two cards)
create or replace function public.call_guard_report() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare rg jsonb; my jsonb; lr record;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;

  with r as (
    select coalesce(public.call_gate_lead('roofguard', l.phone, l.line_type, l.phone_source, l.line_type_checked_at), 'ok') reason
      from rg_leads l where l.phone is not null and l.call_status not in ('booked', 'not_interested', 'wrong_number')),
  g as (select reason, count(*) n from r group by reason)
  select jsonb_build_object(
    'calling_enabled', coalesce((select calling_enabled from rg_settings where id), false),
    'total', coalesce((select sum(n) from g), 0),
    'callable', coalesce((select n from g where reason = 'ok'), 0),
    'skipped', coalesce((select jsonb_object_agg(reason, n) from g where reason <> 'ok'), '{}'::jsonb)) into rg;

  with r as (
    select coalesce(public.call_gate_lead('bestly', l.phone, l.line_type, l.phone_source, l.line_type_checked_at), 'ok') reason
      from maya_leads l where l.phone is not null and l.status in ('new', 'checked', 'queued')),
  g as (select reason, count(*) n from r group by reason)
  select jsonb_build_object(
    'calling_enabled', coalesce((select calling_enabled from maya_call_settings where id), false),
    'total', coalesce((select sum(n) from g), 0),
    'callable', coalesce((select n from g where reason = 'ok'), 0),
    'skipped', coalesce((select jsonb_object_agg(reason, n) from g where reason <> 'ok'), '{}'::jsonb)) into my;

  select * into lr from call_guard_runs order by ran_at desc limit 1;
  return jsonb_build_object('roofguard', rg, 'bestly', my,
    'selftest', case when lr.id is null then null else jsonb_build_object('at', lr.ran_at, 'ok', lr.ok, 'checks', lr.checks, 'failures', lr.failures) end);
end $$;

-- ---------------------------------------------------------------------------------------------- grants (nothing here is for the public key)
revoke all on function public.call_phone_key(text) from public, anon, authenticated;
revoke all on function public.call_line_ok(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.call_is_dnc(text, text) from public, anon, authenticated;
revoke all on function public.call_gate_lead(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.call_gate_at(timestamptz, text, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.call_gate(text, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.maya_next_call_batch(integer) from public, anon, authenticated;
revoke all on function public.call_gate_selftest() from public, anon, authenticated;
revoke all on function public.call_guard_nightly(boolean) from public, anon, authenticated;
revoke all on function public.call_guard_report() from public, anon;
grant execute on function public.call_phone_key(text), public.call_line_ok(text, text, timestamptz), public.call_is_dnc(text, text),
  public.call_gate_lead(text, text, text, text, timestamptz), public.call_gate_at(timestamptz, text, text, text, text, timestamptz, text),
  public.call_gate(text, text, text, text, timestamptz, text), public.maya_next_call_batch(integer), public.call_gate_selftest(),
  public.call_guard_nightly(boolean) to service_role;
grant execute on function public.call_guard_report() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------- Team card and nightly job
-- Call Guard reports to Ares (security-auditor). Alerts with prefix call-guard are signed by it.
select public.team_onboard('[{
  "slug": "call-guard",
  "name": "Call Guard",
  "role": "Call Compliance",
  "what_it_does": "Stands between every AI outbound call and the phone. Never lets Reese or Maya dial a cell phone, an unchecked line, a line checked more than 90 days ago, or an internet line the business did not publish itself, unless the person gave written consent. Honors do-not-call for each seller, keeps to weekdays 9 AM to 5 PM in the business''s own time zone, and tests itself every night. If a test fails it switches outbound calling off by itself.",
  "reports_to": "security-auditor",
  "runs_on": "cloud",
  "schedule": "nightly about 2:10 AM Pacific",
  "icon": "shield-check",
  "admin_url": "/admin/roofguard#setup",
  "welcome": false,
  "pulse": {"src": "cron", "job": "call-guard-nightly", "gap": 1560, "issues": ["call-guard.selftest"]},
  "owns": ["call-guard"]
}]'::jsonb);

-- 9:10 and 10:10 UTC; call_guard_nightly() only works on the one that lands at 2 AM Pacific, so Daylight Saving never shifts it.
select cron.unschedule(jobid) from cron.job where jobname = 'call-guard-nightly';
select cron.schedule('call-guard-nightly', '10 9,10 * * *', $$select public.call_guard_nightly()$$);
