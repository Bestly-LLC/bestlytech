-- Vera, the Privacy Clerk (docs/privacy-clerk-opusplan.md).
-- Carries out the privacy requests Maya takes on the phone: confirm it was the person, find their data in every Bestly
-- system, let Jared approve in one tap, delete / blank / keep per the data map, tell the person, keep a hashed audit record.
--
-- Applied to rcqfqhguwpmaarseifqg in parts (privacy_clerk_01, _02, _04, _05, _06); this file is the same SQL in one piece.
-- Also done by hand on the live project, kept here for the record: the private storage bucket 'privacy-exports' (insert into
-- storage.buckets), the cron job below (created through cron.schedule, job id 218), and the team_onboard call for slug
-- 'privacy-clerk' (Vera, reports to security-auditor). privacy_execute / privacy_redact are in the next file, not yet applied.
-- Public-facing access goes only through the privacy-verify edge function (service role). Nothing here is callable by anon.
--
-- NOTE on admin checks: team_is_admin() is SECURITY DEFINER owned by postgres, so inside it current_user is always
-- 'postgres' and it returns true for ANY signed-in user. Vera's admin RPCs therefore also require privacy_is_admin(),
-- which looks at session_user / the JWT role / the admin role instead.

-- ---------------------------------------------------------------- admin check
create or replace function public.privacy_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select session_user in ('postgres', 'supabase_admin')
      or coalesce(auth.role(), '') = 'service_role'
      or coalesce(public.has_role(auth.uid(), 'admin'::app_role), false)
$$;
revoke all on function public.privacy_is_admin() from public, anon;
grant execute on function public.privacy_is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------- the data map
create table if not exists public.privacy_data_map (
  table_name text not null,
  column_name text not null,
  match_kind text not null check (match_kind in ('email', 'phone')),
  action text not null check (action in ('delete', 'blank', 'keep', 'review')),
  reason text,
  enabled boolean not null default true,
  primary key (table_name, column_name)
);
alter table public.privacy_data_map enable row level security;
revoke all on public.privacy_data_map from anon;
create policy privacy_data_map_admin on public.privacy_data_map for all to authenticated
  using (public.privacy_is_admin()) with check (public.privacy_is_admin());
comment on table public.privacy_data_map is
  'Where personal data lives. delete = remove the row; blank = null the personal columns; keep = never touched (reason shown); review = Jared ticks it, then it is treated as delete. Any new table holding an email or phone gets rows here in the same migration (Vera flags it daily otherwise).';

-- Seed (each pair is skipped if the column does not exist).
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason)
select v.t, v.c, v.k, v.a, v.r
from (values
  ('activation_codes','email','email','delete',null),
  ('activation_code_attempts','email','email','delete',null),
  ('contact_submissions','email','email','delete',null),
  ('waitlist_subscribers','email','email','delete',null),
  ('device_registrations','email','email','delete',null),
  ('granted_access','email','email','delete',null),
  ('hire_requests','email','email','delete',null),
  ('cloud_leads','contact_email','email','delete',null),
  ('cloud_leads','contact_phone','phone','delete',null),
  ('email_unsubscribe_tokens','email','email','delete',null),
  ('mail_contacts','email','email','delete',null),
  ('webauthn_challenges','email','email','delete',null),
  ('shop_abandoned_checkouts','email','email','delete',null),
  ('guest_entry_attempts','phone_digits','phone','delete',null),
  ('email_send_log','recipient_email','email','blank','Send log kept without the address'),
  ('notify_outbox','to_email','email','blank','Send log kept without the address'),
  ('shop_notifications','to_email','email','blank','Send log kept without the address'),
  ('shield_url_reports','reporter_email','email','blank','Send log kept without the address'),
  ('cloud_shield_requests','requester_email','email','blank','Send log kept without the address'),
  ('webhook_events','email','email','blank','Send log kept without the address'),
  ('support_tickets','email','email','blank','Send log kept without the address'),
  ('support_tickets','phone','phone','blank','Send log kept without the address'),
  ('suppressed_emails','email','email','keep','Keeps you off our email list'),
  ('rg_dnc','phone','phone','keep','Keeps you off our call list'),
  ('shop_orders','email','email','keep','Sales tax records (4 years)'),
  ('shop_orders','phone','phone','keep','Sales tax records (4 years)'),
  ('hoku_orders','email','email','keep','Sales tax records (4 years)'),
  ('hoku_orders','phone','phone','keep','Sales tax records (4 years)'),
  ('subscriptions','email','email','keep','Billing record; cancel the plan separately'),
  ('spam_claims','contact_email','email','keep','Legal claim records'),
  ('spam_report_targets','email','email','keep','Legal claim records'),
  ('ava_calls','phone','phone','review','Your call'),
  ('ava_calls','counterpart_phone','phone','review','Your call'),
  ('ava_contacts','phone','phone','review','Your call'),
  ('ava_followups','phone','phone','review','Your call'),
  ('ava_live_watch','phone','phone','review','Your call'),
  ('rg_calls','counterpart_phone','phone','review','Your call'),
  ('rg_calls','meeting_email','email','review','Your call'),
  ('rg_calls','to_number','phone','review','Your call'),
  ('rg_leads','phone','phone','review','Your call'),
  ('rg_followups','to_number','phone','review','Your call'),
  ('turo_trips','guest_phone','phone','review','Your call'),
  ('lax_guest_links','email','email','review','Your call'),
  ('approval_clients','contact_email','email','review','Your call'),
  ('client_people','email','email','review','Your call'),
  ('partners','email','email','review','Your call'),
  ('claim_shops','email','email','review','Your call'),
  ('claim_shops','phone','phone','review','Your call'),
  ('seller_intakes','client_email','email','review','Your call'),
  ('seller_intakes','client_phone','phone','review','Your call'),
  ('cloud_deals','primary_contact_email','email','review','Your call')
) as v(t, c, k, a, r)
where exists (select 1 from information_schema.columns ic
               where ic.table_schema = 'public' and ic.table_name = v.t and ic.column_name = v.c)
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------- cases + state
create table if not exists public.privacy_cases (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique references public.support_tickets(code),
  action text,
  email text,
  phone text,
  email_hash text,
  phone_hash text,
  token text unique,
  token_expires_at timestamptz,
  verify_sent_at timestamptz,
  reminded_at timestamptz,
  verified_at timestamptz,
  verified_ip text,
  scan jsonb,
  scanned_at timestamptz,
  review_ticked text[] not null default '{}',
  approved_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  export_path text,
  export_expires_at timestamptz,
  downloaded_at timestamptz,
  confirm_sent_at timestamptz,
  done_at timestamptz,
  redacted_at timestamptz,
  status text not null default 'awaiting_verification'
    check (status in ('awaiting_verification','no_email','verified','ready','approved','done','could_not_verify','needs_jared','cancelled')),
  note text,
  attempts int not null default 0,
  last_error text,
  hits int not null default 0,
  hits_window_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.privacy_cases enable row level security;
revoke all on public.privacy_cases from anon;
create policy privacy_cases_admin on public.privacy_cases for all to authenticated
  using (public.privacy_is_admin()) with check (public.privacy_is_admin());
create index if not exists privacy_cases_status_idx on public.privacy_cases (status);

create table if not exists public.privacy_clerk_state (
  id boolean primary key default true check (id),
  last_tick_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_map_check_on date
);
insert into public.privacy_clerk_state (id) values (true) on conflict do nothing;
alter table public.privacy_clerk_state enable row level security;
revoke all on public.privacy_clerk_state from anon;
create policy privacy_clerk_state_admin on public.privacy_clerk_state for select to authenticated
  using (public.privacy_is_admin());

-- ---------------------------------------------------------------- helpers
create or replace function public.privacy_new_token() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a constant text := '23456789abcdefghjkmnpqrstuvwxyz'; b bytea; t text; i int;
begin
  loop
    b := gen_random_bytes(8); t := '';
    for i in 0..7 loop t := t || substr(a, (get_byte(b, i) % length(a)) + 1, 1); end loop;
    exit when not exists (select 1 from public.privacy_cases where token = t);
  end loop;
  return t;
end $$;

-- Owner guard: Vera never scans or deletes for Jared's own addresses and numbers.
create or replace function public.privacy_is_owner(p_email text, p_phone text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e text := lower(btrim(coalesce(p_email, ''))); d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if e <> '' then
    if e like '%@bestly.tech' then return true; end if;
    if exists (select 1 from public.bestly_mail where lower(mailbox) = e) then return true; end if;
    if exists (select 1 from public.partners p where lower(btrim(p.email)) = e and p.user_id is not null
                 and coalesce(public.has_role(p.user_id, 'admin'::app_role), false)) then return true; end if;
  end if;
  if length(d) >= 10 and right(d, 10) in ('8165007236', '8164299495', '2136410074', '4242349256') then return true; end if;
  return false;
end $$;

-- Exact matching (plan rule 6). Returns a SQL condition for one column, or null when the person has no value of that kind.
create or replace function public.privacy_cond(p_col text, p_kind text, p_email text, p_p10 text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_kind = 'email' and nullif(btrim(coalesce(p_email, '')), '') is not null
      then format('lower(btrim(%I::text)) = %L', p_col, lower(btrim(p_email)))
    when p_kind = 'phone' and p_p10 is not null
      then format('(length(regexp_replace(%1$I::text, ''\D'', '''', ''g'')) >= 10 and right(regexp_replace(%1$I::text, ''\D'', '''', ''g''), 10) = %2$L)', p_col, p_p10)
  end
$$;

-- Extra row filter per table. The privacy tickets still being worked are never blanked.
create or replace function public.privacy_extra(p_table text) returns text
language sql immutable set search_path = public as $$
  select case when p_table = 'support_tickets' then ' and not (kind = ''privacy'' and status = ''open'')' else '' end
$$;

-- What a map row does for a given set of ticked review items: 'delete', 'blank' or null (keep / unticked review).
create or replace function public.privacy_mode(p_action text, p_table text, p_col text, p_ticked text[]) returns text
language sql immutable set search_path = public as $$
  select case
    when p_action = 'delete' then 'delete'
    when p_action = 'blank' then 'blank'
    when p_action = 'review' and (p_table || '.' || p_col) = any (coalesce(p_ticked, '{}')) then 'delete'
  end
$$;

create or replace function public.privacy_phone10(p_phone text) returns text
language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
              then right(regexp_replace(p_phone, '\D', '', 'g'), 10) end
$$;

-- ---------------------------------------------------------------- open a case for a privacy ticket
create or replace function public.privacy_open_case(p_code text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare t public.support_tickets; v_id uuid; v_email text; v_status text; v_note text;
begin
  select * into t from public.support_tickets where code = p_code and kind = 'privacy';
  if not found then return null; end if;
  select id into v_id from public.privacy_cases where ticket_code = p_code;
  if found then return v_id; end if;

  v_email := nullif(lower(btrim(coalesce(t.email, ''))), '');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; v_note := 'The email on the ticket does not look like an email address.'; end if;

  if t.privacy_action is null then
    v_status := 'needs_jared'; v_note := 'Maya did not record what they want done (delete, copy, correct or stop selling).';
  elsif public.privacy_is_owner(v_email, t.phone) then
    v_status := 'needs_jared'; v_note := 'This request names one of your own addresses or numbers, so I will not touch it.';
  elsif v_email is null then
    v_status := 'no_email'; v_note := coalesce(v_note, 'No email was left, so I cannot send a confirmation link.');
  else
    v_status := 'awaiting_verification';
  end if;

  insert into public.privacy_cases (ticket_code, action, email, phone, token, token_expires_at, status, note)
  values (p_code, t.privacy_action, v_email, nullif(btrim(coalesce(t.phone, '')), ''), public.privacy_new_token(), now() + interval '14 days', v_status, v_note)
  on conflict (ticket_code) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.privacy_cases where ticket_code = p_code; end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- scan
create or replace function public.privacy_scan(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.privacy_cases; p10 text; m record; g record; cond text; conds text[]; n bigint; r bigint;
  items jsonb := '[]'; tabs jsonb := '[]'; blast jsonb := '[]';
  tot bigint := 0; plc int := 0; keep_plc int := 0; rev_plc int := 0;
begin
  select * into c from public.privacy_cases where id = p_case;
  if not found then raise exception 'no such case'; end if;
  if public.privacy_is_owner(c.email, c.phone) then
    return jsonb_build_object('owner', true, 'items', '[]'::jsonb, 'tables', '[]'::jsonb, 'total', 0, 'places', 0, 'keep_places', 0, 'review_places', 0, 'blast', '[]'::jsonb);
  end if;
  p10 := public.privacy_phone10(c.phone);

  for m in select * from public.privacy_data_map pm where pm.enabled
            order by case pm.action when 'delete' then 1 when 'blank' then 2 when 'review' then 3 else 4 end, pm.table_name, pm.column_name loop
    if not exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = m.table_name and ic.column_name = m.column_name) then continue; end if;
    cond := public.privacy_cond(m.column_name, m.match_kind, c.email, p10);
    if cond is null then continue; end if;
    execute format('select count(*) from public.%I where (%s)%s', m.table_name, cond, public.privacy_extra(m.table_name)) into n;
    if n > 0 then
      items := items || jsonb_build_object('table', m.table_name, 'column', m.column_name, 'action', m.action, 'reason', m.reason, 'count', n);
    end if;
  end loop;

  -- distinct rows per table and action (a row matched by both its email and its phone counts once)
  for g in select pm.table_name, pm.action from public.privacy_data_map pm where pm.enabled group by 1, 2 order by 2, 1 loop
    conds := '{}';
    for m in select * from public.privacy_data_map pm where pm.enabled and pm.table_name = g.table_name and pm.action = g.action loop
      if not exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = m.table_name and ic.column_name = m.column_name) then continue; end if;
      cond := public.privacy_cond(m.column_name, m.match_kind, c.email, p10);
      if cond is not null then conds := conds || cond; end if;
    end loop;
    if coalesce(array_length(conds, 1), 0) = 0 then continue; end if;
    execute format('select count(*) from public.%I where (%s)%s', g.table_name, array_to_string(conds, ' or '), public.privacy_extra(g.table_name)) into r;
    if r > 0 then
      tabs := tabs || jsonb_build_object('table', g.table_name, 'action', g.action, 'rows', r);
      if g.action in ('delete', 'blank') then
        tot := tot + r; plc := plc + 1;
        if r > 25 then blast := blast || jsonb_build_object('table', g.table_name, 'rows', r); end if;
      elsif g.action = 'keep' then keep_plc := keep_plc + 1;
      else rev_plc := rev_plc + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('owner', false, 'items', items, 'tables', tabs, 'total', tot, 'places', plc,
                            'keep_places', keep_plc, 'review_places', rev_plc, 'blast', blast);
end $$;

-- ---------------------------------------------------------------- export (everything mapped, all actions)
create or replace function public.privacy_export(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c public.privacy_cases; p10 text; g record; m record; cond text; conds text[]; rws jsonb; out jsonb := '{}';
begin
  select * into c from public.privacy_cases where id = p_case;
  if not found then raise exception 'no such case'; end if;
  if public.privacy_is_owner(c.email, c.phone) then raise exception 'OWNER_GUARD: this request names one of Jared''s own addresses or numbers'; end if;
  p10 := public.privacy_phone10(c.phone);
  for g in select pm.table_name from public.privacy_data_map pm where pm.enabled group by 1 order by 1 loop
    conds := '{}';
    for m in select * from public.privacy_data_map pm where pm.enabled and pm.table_name = g.table_name loop
      if not exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = m.table_name and ic.column_name = m.column_name) then continue; end if;
      cond := public.privacy_cond(m.column_name, m.match_kind, c.email, p10);
      if cond is not null then conds := conds || cond; end if;
    end loop;
    if coalesce(array_length(conds, 1), 0) = 0 then continue; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I where (%s)%s limit 1000) t',
                   g.table_name, array_to_string(conds, ' or '), public.privacy_extra(g.table_name)) into rws;
    if jsonb_array_length(rws) > 0 then
      out := out || jsonb_build_object(g.table_name, jsonb_build_object(
        'how_we_handle_it', (select string_agg(distinct pm.action, ', ') from public.privacy_data_map pm where pm.table_name = g.table_name),
        'why_kept', (select string_agg(distinct pm.reason, '; ') from public.privacy_data_map pm where pm.table_name = g.table_name and pm.action = 'keep'),
        'rows', rws));
    end if;
  end loop;
  return jsonb_build_object('reference', c.ticket_code, 'generated_at', now(), 'data', out);
end $$;

-- ---------------------------------------------------------------- map completeness (columns that look personal but are not on the map)
create or replace function public.privacy_unmapped() returns table (table_name text, column_name text)
language sql stable security definer set search_path = public as $$
  select c.table_name::text, c.column_name::text
    from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.data_type in ('text', 'character varying')
     and (c.column_name ~* 'e_?mail' or c.column_name ~* '(phone|mobile|cell)')
     and c.column_name !~* '(_id|_url|_provider|_source|_by|_masked)$'
     and c.table_name !~* '_settings$'
     and c.table_name <> 'privacy_cases'
     and not exists (select 1 from public.privacy_data_map pm where pm.table_name = c.table_name and pm.column_name = c.column_name)
   order by 1, 2
$$;

-- ---------------------------------------------------------------- admin RPCs
create or replace function public.admin_privacy_case(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.privacy_cases;
begin
  if not (team_is_admin() and privacy_is_admin()) then raise exception 'not allowed'; end if;
  select * into c from public.privacy_cases where ticket_code = p_code;
  if not found then return null; end if;
  return jsonb_build_object(
    'status', c.status, 'action', c.action, 'has_email', (c.email is not null or c.email_hash is not null),
    'has_phone', (c.phone is not null or c.phone_hash is not null),
    'created_at', c.created_at, 'verify_sent_at', c.verify_sent_at, 'reminded_at', c.reminded_at, 'verified_at', c.verified_at,
    'scanned_at', c.scanned_at, 'approved_at', c.approved_at, 'executed_at', c.executed_at, 'done_at', c.done_at,
    'scan', c.scan, 'review_ticked', c.review_ticked, 'note', c.note, 'result', c.result,
    'export_ready', c.export_path is not null, 'redacted', c.redacted_at is not null, 'last_error', c.last_error);
end $$;

create or replace function public.admin_privacy_approve(p_code text, p_review text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.privacy_cases; bad text;
begin
  if not (team_is_admin() and privacy_is_admin()) then raise exception 'not allowed'; end if;
  select * into c from public.privacy_cases where ticket_code = p_code for update;
  if not found then raise exception 'no privacy case for %', p_code; end if;
  if c.status <> 'ready' then raise exception 'this case is "%", not ready for approval', c.status; end if;
  if c.action not in ('delete', 'export') then raise exception 'only delete and export requests are approved here'; end if;
  if c.action = 'delete' and (to_regprocedure('public.privacy_execute(uuid)') is null or to_regprocedure('public.privacy_redact(uuid)') is null) then
    raise exception 'Deleting is not switched on yet. Vera''s delete step (privacy_execute and privacy_redact) has not been installed.';
  end if;
  select t into bad from unnest(coalesce(p_review, '{}')) t
   where not exists (select 1 from jsonb_array_elements(coalesce(c.scan->'items', '[]'::jsonb)) i
                      where i->>'action' = 'review' and (i->>'table') || '.' || (i->>'column') = t) limit 1;
  if bad is not null then raise exception 'unknown item to review: %', bad; end if;
  update public.privacy_cases set status = 'approved', approved_at = now(),
         review_ticked = case when c.action = 'delete' then coalesce(p_review, '{}') else '{}' end,
         attempts = 0, last_error = null, updated_at = now()
   where id = c.id;
  perform invoke_edge_function('privacy-clerk', jsonb_build_object('run', 'execute', 'code', p_code), 60000);
  return jsonb_build_object('ok', true, 'status', 'approved');
end $$;

create or replace function public.admin_privacy_resend(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.privacy_cases;
begin
  if not (team_is_admin() and privacy_is_admin()) then raise exception 'not allowed'; end if;
  select * into c from public.privacy_cases where ticket_code = p_code for update;
  if not found then raise exception 'no privacy case for %', p_code; end if;
  if c.status not in ('awaiting_verification', 'could_not_verify') or c.email is null then
    raise exception 'a new link can only be sent while we are waiting for them to confirm';
  end if;
  update public.privacy_cases set token = public.privacy_new_token(), token_expires_at = now() + interval '14 days',
         verify_sent_at = null, reminded_at = null, status = 'awaiting_verification', attempts = 0, last_error = null, updated_at = now()
   where id = c.id;
  perform invoke_edge_function('privacy-clerk', jsonb_build_object('run', 'case', 'code', p_code), 60000);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_privacy_cancel(p_code text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.privacy_cases;
begin
  if not (team_is_admin() and privacy_is_admin()) then raise exception 'not allowed'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'a note is required'; end if;
  select * into c from public.privacy_cases where ticket_code = p_code for update;
  if not found then raise exception 'no privacy case for %', p_code; end if;
  if c.status in ('done', 'cancelled') or c.executed_at is not null then raise exception 'this case is already finished'; end if;
  update public.privacy_cases set status = 'cancelled', note = btrim(p_note), done_at = now(), updated_at = now() where id = c.id;
  update public.support_tickets set status = 'done', resolved_at = now(),
         note = concat_ws(E'\n', note, 'Vera: request cancelled. ' || btrim(p_note)) where code = p_code;
  -- privacy_redact lives in the next migration file; until it is installed the clerk redacts cancelled cases on a later tick
  if to_regprocedure('public.privacy_redact(uuid)') is not null then execute 'select public.privacy_redact($1)' using c.id; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_privacy_mark_verified(p_code text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.privacy_cases;
begin
  if not (team_is_admin() and privacy_is_admin()) then raise exception 'not allowed'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'a note is required'; end if;
  select * into c from public.privacy_cases where ticket_code = p_code for update;
  if not found then raise exception 'no privacy case for %', p_code; end if;
  if c.status not in ('awaiting_verification', 'no_email', 'could_not_verify') then raise exception 'this case is "%" and cannot be marked verified', c.status; end if;
  update public.privacy_cases set status = 'verified', verified_at = now(), verified_ip = null,
         note = 'You verified them yourself: ' || btrim(p_note), attempts = 0, last_error = null, updated_at = now()
   where id = c.id;
  perform invoke_edge_function('privacy-clerk', jsonb_build_object('run', 'case', 'code', p_code), 60000);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.privacy_new_token() from public, anon, authenticated;
revoke all on function public.privacy_is_owner(text, text) from public, anon, authenticated;
revoke all on function public.privacy_cond(text, text, text, text) from public, anon, authenticated;
revoke all on function public.privacy_extra(text) from public, anon, authenticated;
revoke all on function public.privacy_mode(text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.privacy_phone10(text) from public, anon, authenticated;
revoke all on function public.privacy_open_case(text) from public, anon, authenticated;
revoke all on function public.privacy_scan(uuid) from public, anon, authenticated;
revoke all on function public.privacy_export(uuid) from public, anon, authenticated;
revoke all on function public.privacy_unmapped() from public, anon, authenticated;
grant execute on function public.privacy_new_token() to service_role;
grant execute on function public.privacy_is_owner(text, text) to service_role;
grant execute on function public.privacy_cond(text, text, text, text) to service_role;
grant execute on function public.privacy_extra(text) to service_role;
grant execute on function public.privacy_mode(text, text, text, text[]) to service_role;
grant execute on function public.privacy_phone10(text) to service_role;
grant execute on function public.privacy_open_case(text) to service_role;
grant execute on function public.privacy_scan(uuid) to service_role;
grant execute on function public.privacy_export(uuid) to service_role;
grant execute on function public.privacy_unmapped() to service_role;

revoke all on function public.admin_privacy_case(text) from public, anon;
revoke all on function public.admin_privacy_approve(text, text[]) from public, anon;
revoke all on function public.admin_privacy_resend(text) from public, anon;
revoke all on function public.admin_privacy_cancel(text, text) from public, anon;
revoke all on function public.admin_privacy_mark_verified(text, text) from public, anon;
grant execute on function public.admin_privacy_case(text) to authenticated, service_role;
grant execute on function public.admin_privacy_approve(text, text[]) to authenticated, service_role;
grant execute on function public.admin_privacy_resend(text) to authenticated, service_role;
grant execute on function public.admin_privacy_cancel(text, text) to authenticated, service_role;
grant execute on function public.admin_privacy_mark_verified(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- cron: every 10 minutes at minute 2
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'privacy-clerk') then
    perform cron.schedule('privacy-clerk', '2-59/10 * * * *', $cron$select public.invoke_edge_function('privacy-clerk', '{}'::jsonb, 60000)$cron$);
  end if;
end $$;
