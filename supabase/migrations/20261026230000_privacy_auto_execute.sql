-- Vera, part 3: fully automatic privacy requests (Jared approved 2026-10-26: "verified requests get deleted without your tap").
-- Runs AFTER 20261011010100_privacy_clerk_execute_redact.sql (privacy_execute / privacy_redact), which was reviewed line by line:
-- every delete and update there is scoped to one case's exact email / last-10-digit phone, skips unmapped tables and
-- columns, stops at 25 rows per table, and rolls back when the executed counts differ from the scan. It needed no change.
-- This file does what that one cannot:
--   1. the switch (privacy_clerk_state.auto_execute, default on) and privacy_auto_approve()
--   2. a concrete default for every "review" row, the 9 unmapped columns, and the billing tables (privacy_unmapped() returns 0)
--   3. two row filters so one person's delete cannot reach a signed deal or a recorded STOP (privacy_extra)
--   4. privacy_collect(): the call ids and uploaded-file paths that must be removed OUTSIDE the database, saved before the rows go
--   5. admin RPCs for the switch, and the case view reports it

-- ---------------------------------------------------------------- 1. the switch
alter table public.privacy_clerk_state add column if not exists auto_execute boolean not null default true;
alter table public.privacy_clerk_state add column if not exists auto_changed_at timestamptz;
alter table public.privacy_cases add column if not exists auto_approved boolean not null default false;
alter table public.privacy_cases add column if not exists pending_calls text[] not null default '{}';
alter table public.privacy_cases add column if not exists pending_files text[] not null default '{}';

-- The clerk calls this once a case is verified and scanned. Same guards as a tap: not the owner, no blast, fresh scan stored
-- so privacy_execute compares like with like. Returns {approved:false, reason} instead of raising so the clerk can explain.
create or replace function public.privacy_auto_approve(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c public.privacy_cases; st boolean; fresh jsonb;
begin
  select coalesce(auto_execute, false) into st from public.privacy_clerk_state where id;
  if not coalesce(st, false) then return jsonb_build_object('approved', false, 'reason', 'manual'); end if;
  select * into c from public.privacy_cases where id = p_case for update;
  if not found then raise exception 'no such case'; end if;
  if c.status not in ('verified', 'ready') then return jsonb_build_object('approved', false, 'reason', 'status ' || c.status); end if;
  if c.action not in ('delete', 'export') then return jsonb_build_object('approved', false, 'reason', 'action'); end if;
  if public.privacy_is_owner(c.email, c.phone) then return jsonb_build_object('approved', false, 'reason', 'owner'); end if;
  fresh := public.privacy_scan(p_case);
  if jsonb_array_length(coalesce(fresh->'blast', '[]'::jsonb)) > 0 then
    return jsonb_build_object('approved', false, 'reason', 'blast', 'scan', fresh);
  end if;
  update public.privacy_cases set
    scan = fresh || jsonb_build_object('conversations', coalesce(c.scan->'conversations', to_jsonb(0))),
    scanned_at = now(), status = 'approved', approved_at = now(), review_ticked = '{}', auto_approved = true,
    attempts = 0, last_error = null, updated_at = now()
  where id = c.id;
  return jsonb_build_object('approved', true, 'scan', fresh);
end $$;

create or replace function public.admin_privacy_auto() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (team_is_admin() and privacy_is_admin()) then raise exception 'not allowed'; end if;
  return (select jsonb_build_object('auto', coalesce(auto_execute, false), 'changed_at', auto_changed_at) from public.privacy_clerk_state where id);
end $$;

create or replace function public.admin_privacy_set_auto(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (team_is_admin() and privacy_is_admin()) then raise exception 'not allowed'; end if;
  update public.privacy_clerk_state set auto_execute = coalesce(p_on, false), auto_changed_at = now() where id;
  if coalesce(p_on, false) then
    -- anything already waiting for a tap goes through on her next check
    perform invoke_edge_function('privacy-clerk', '{}'::jsonb, 60000);
  end if;
  return jsonb_build_object('auto', coalesce(p_on, false));
end $$;

-- the case view also reports whether it went through on its own
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
    'export_ready', c.export_path is not null, 'redacted', c.redacted_at is not null, 'last_error', c.last_error,
    'auto_approved', c.auto_approved);
end $$;

-- ---------------------------------------------------------------- 3. row filters (used by scan, execute and export)
-- A lead that became a signed deal keeps its row (the deal references it and the contract is a 7-year record).
-- A recorded STOP in the outreach ledger is never deleted: it is how we know not to contact them again.
create or replace function public.privacy_extra(p_table text, p_export boolean) returns text
language sql immutable set search_path = public as $$
  select case
    when p_table = 'support_tickets' then ' and not (kind = ''privacy'' and status = ''open'')'
    when p_table = 'cloud_leads' and not p_export then ' and not exists (select 1 from public.cloud_deals d where d.lead_id = cloud_leads.id)'
    when p_table = 'rg_outreach_ledger' and not p_export then ' and status <> ''opted_out'''
    else '' end
$$;
create or replace function public.privacy_extra(p_table text) returns text
language sql immutable set search_path = public as $$ select public.privacy_extra(p_table, false) $$;

-- export must show everything, kept rows included
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
                   g.table_name, array_to_string(conds, ' or '), public.privacy_extra(g.table_name, true)) into rws;
    if jsonb_array_length(rws) > 0 then
      out := out || jsonb_build_object(g.table_name, jsonb_build_object(
        'how_we_handle_it', (select string_agg(distinct pm.action, ', ') from public.privacy_data_map pm where pm.table_name = g.table_name),
        'why_kept', (select string_agg(distinct pm.reason, '; ') from public.privacy_data_map pm where pm.table_name = g.table_name and pm.action = 'keep'),
        'rows', rws));
    end if;
  end loop;
  return jsonb_build_object('reference', c.ticket_code, 'generated_at', now(), 'data', out);
end $$;

-- ---------------------------------------------------------------- 4. things that live outside the database
-- Call recordings sit in ElevenLabs and uploaded ID documents sit in Storage; deleting the row loses the id. Save the ids
-- of THIS person's rows (same exact email / phone match, only tables the map says to delete) before privacy_execute runs.
create or replace function public.privacy_collect(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.privacy_cases; p10 text; calls text[] := '{}'; files text[] := '{}'; r text[]; x record; cond text; conds text[]; m record;
begin
  select * into c from public.privacy_cases where id = p_case for update;
  if not found then raise exception 'no such case'; end if;
  if public.privacy_is_owner(c.email, c.phone) then raise exception 'OWNER_GUARD: this request names one of Jared''s own addresses or numbers'; end if;
  if c.executed_at is not null then return jsonb_build_object('calls', c.pending_calls, 'files', c.pending_files); end if;
  p10 := public.privacy_phone10(c.phone);

  for x in select * from (values
      ('agent_calls', 'phone', 'phone'), ('ava_calls', 'phone', 'phone'), ('ava_calls', 'counterpart_phone', 'phone'),
      ('rg_calls', 'to_number', 'phone'), ('rg_calls', 'counterpart_phone', 'phone'),
      ('contact_submissions', 'email', 'email'), ('contact_submissions', 'phone', 'phone')) v(tbl, col, kind) loop
    if not exists (select 1 from public.privacy_data_map pm where pm.enabled and pm.action = 'delete' and pm.table_name = x.tbl and pm.column_name = x.col) then continue; end if;
    if not exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = x.tbl and ic.column_name = x.col) then continue; end if;
    cond := public.privacy_cond(x.col, x.kind, c.email, p10);
    if cond is null then continue; end if;
    execute format('select coalesce(array_agg(distinct conversation_id), ''{}'') from public.%I where conversation_id is not null and %s', x.tbl, cond) into r;
    calls := calls || r;
  end loop;
  select coalesce(array_agg(distinct k), '{}') into calls from unnest(calls) k where k ~ '^conv_[A-Za-z0-9]+$';

  conds := '{}';
  for m in select * from public.privacy_data_map pm where pm.enabled and pm.action = 'delete' and pm.table_name = 'seller_intakes' loop
    if not exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = m.table_name and ic.column_name = m.column_name) then continue; end if;
    cond := public.privacy_cond(m.column_name, m.match_kind, c.email, p10);
    if cond is not null then conds := conds || cond; end if;
  end loop;
  if coalesce(array_length(conds, 1), 0) > 0 then
    execute format('select coalesce(array_agg(distinct d.file_path), ''{}'') from public.intake_documents d where d.intake_id in (select id from public.seller_intakes where %s)', array_to_string(conds, ' or ')) into files;
  end if;

  update public.privacy_cases set pending_calls = calls, pending_files = files, updated_at = now() where id = p_case;
  return jsonb_build_object('calls', calls, 'files', files);
end $$;

-- ---------------------------------------------------------------- 2. the map: no more "review", nothing unmapped
-- action: delete = remove the row; blank = null the personal columns, keep the row; keep = never touched, reason shown to the person.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason) values
  -- was "review"
  ('approval_clients', 'contact_email', 'email', 'blank', 'Client account stays; the contact email is removed'),
  ('approval_staff', 'email', 'email', 'keep', 'Staff account for someone who works with Bestly: work and payroll records'),
  ('ava_calls', 'counterpart_phone', 'phone', 'delete', 'Call log and transcript; removed with the number'),
  ('ava_calls', 'phone', 'phone', 'delete', 'Call log and transcript; removed with the number'),
  ('ava_contacts', 'phone', 'phone', 'delete', 'Address-book entry; removed with the number'),
  ('ava_followups', 'callback_phone', 'phone', 'delete', 'Call-back reminder; removed with the number'),
  ('ava_followups', 'phone', 'phone', 'delete', 'Call-back reminder; removed with the number'),
  ('ava_live_watch', 'phone', 'phone', 'delete', 'Live call monitor row; removed with the number'),
  ('claim_shops', 'email', 'email', 'blank', 'Shop listing stays; the contact email is removed'),
  ('claim_shops', 'phone', 'phone', 'blank', 'Shop listing stays; the contact number is removed'),
  ('client_people', 'email', 'email', 'delete', 'Client contact entry; removed on request'),
  ('cloud_deals', 'primary_contact_email', 'email', 'keep', 'Signed contract and payment records: tax law, 7 years'),
  ('lax_guest_links', 'email', 'email', 'blank', 'Trip record stays; the guest email is removed'),
  ('partner_google', 'email', 'email', 'blank', 'Connection stays; the displayed email is removed'),
  ('partners', 'email', 'email', 'keep', 'Partner agreement and commission payments: tax records, 7 years'),
  ('rg_calls', 'counterpart_phone', 'phone', 'delete', 'Sales call recording and transcript; removed with the number'),
  ('rg_calls', 'meeting_email', 'email', 'delete', 'Sales call recording and transcript; removed with the email'),
  ('rg_calls', 'to_number', 'phone', 'delete', 'Sales call recording and transcript; removed with the number'),
  ('rg_followups', 'to_number', 'phone', 'delete', 'Call-back reminder; removed with the number'),
  ('rg_leads', 'phone', 'phone', 'delete', 'Sales lead; removed on request'),
  ('rg_outreach_ledger', 'email', 'email', 'delete', 'Prospect entry removed; a recorded STOP request is kept so we never contact them again'),
  ('rg_outreach_ledger', 'phone', 'phone', 'delete', 'Prospect entry removed; a recorded STOP request is kept so we never contact them again'),
  ('seller_intakes', 'amazon_email', 'email', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'amazon_phone', 'phone', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'bank_email', 'email', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'business_email', 'email', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'business_phone', 'phone', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'client_email', 'email', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'client_phone', 'phone', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'phone_number', 'phone', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'shopify_email', 'email', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'shopify_phone', 'phone', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'tiktok_bank_email', 'email', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'tiktok_email', 'email', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('seller_intakes', 'tiktok_phone', 'phone', 'delete', 'Onboarding form with ID and bank details; removed on request, with any uploaded documents'),
  ('turo_trips', 'guest_phone', 'phone', 'blank', 'Trip and earnings record kept for taxes (7 years); the phone number is removed'),
  -- the unmapped columns
  ('ad_inquiries', 'email', 'email', 'delete', 'Advertising inquiry (marketing lead); removed on request'),
  ('hunter_optouts', 'email', 'email', 'keep', 'Keeps you off our email list'),
  ('hunter_optouts', 'phone', 'phone', 'keep', 'Keeps you off our call list'),
  ('lax_guest_links', 'sms_phone', 'phone', 'blank', 'Trip record stays; the guest phone number is removed'),
  ('leo_sms_optouts', 'phone_hash', 'phone', 'keep', 'Keeps you off our text list (stored only as a scrambled code)'),
  ('maya_leads', 'email', 'email', 'delete', 'Sales lead (marketing); removed on request'),
  ('maya_leads', 'phone', 'phone', 'delete', 'Sales lead (marketing); removed on request'),
  ('studio_magic_links', 'email', 'email', 'delete', 'Sign-in link; removed on request'),
  ('studio_signups', 'email', 'email', 'delete', 'Sign-up form (marketing lead); removed on request'),
  -- billing records: kept, with the reason shown to the person (these two were set to delete by mistake)
  ('maya_billing_actions', 'email', 'email', 'keep', 'Billing and refund records: tax and payment-dispute law, 7 years'),
  ('maya_verifications', 'email', 'email', 'keep', 'Identity checks on billing changes: part of the billing audit trail, 7 years'),
  -- proof of phone consent has to be kept to defend a call complaint (TCPA, 4 years); it was set to delete
  ('call_consents', 'phone', 'phone', 'keep', 'Proof you agreed to be called: phone consent law, 4 years'),
  ('call_consents', 'phone_key', 'phone', 'keep', 'Proof you agreed to be called: phone consent law, 4 years')
on conflict (table_name, column_name) do update
  set match_kind = excluded.match_kind, action = excluded.action, reason = excluded.reason, enabled = true;

-- ---------------------------------------------------------------- grants (nothing here is callable by anon)
revoke all on function public.privacy_auto_approve(uuid) from public, anon, authenticated;
revoke all on function public.privacy_collect(uuid) from public, anon, authenticated;
revoke all on function public.privacy_export(uuid) from public, anon, authenticated;
revoke all on function public.privacy_extra(text, boolean) from public, anon, authenticated;
revoke all on function public.admin_privacy_auto() from public, anon;
revoke all on function public.admin_privacy_set_auto(boolean) from public, anon;
revoke all on function public.admin_privacy_case(text) from public, anon;
grant execute on function public.privacy_auto_approve(uuid) to service_role;
grant execute on function public.privacy_collect(uuid) to service_role;
grant execute on function public.privacy_export(uuid) to service_role;
grant execute on function public.privacy_extra(text, boolean) to service_role;
grant execute on function public.admin_privacy_auto() to authenticated;
grant execute on function public.admin_privacy_set_auto(boolean) to authenticated;
grant execute on function public.admin_privacy_case(text) to authenticated;
