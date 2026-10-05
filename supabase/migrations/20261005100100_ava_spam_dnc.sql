-- Spam intel + Do Not Call evidence for personal Ava (2026-10-05). Jared's cell is on the National Do Not Call Registry;
-- a telemarketer who calls a registered number 2+ times in 12 months may owe $500 a call ($1,500 if willful),
-- 47 U.S.C. 227(c)(5). Ava plays curious for up to 2 minutes to learn who is calling; this keeps what she learns.
--
--   ava_calls.is_spam / robocall / spam_*       data collected by the agent after a call
--   ava_calls.spam_company_id                   the company this call was merged into
--   ava_calls.evidence_*                        the private copy of the recording (bucket ava-evidence, kept 4+ years, no purge)
--   ava_spam_companies                          one row per company: numbers, calls in 12 months, status, notes
--   ava_calls_spam_trg                          after a spam call lands: match or create the company, recount, and at 2 calls
--                                               set status 'threshold' + one Scout alert per company
--   ava_spam_recount                            watchdog: refresh the 12-month counts (calls age out)
-- Complaint text and the demand letter are built by edge fn actions (fixed template, no AI) and never sent automatically.

-- ---------- companies ----------
create table if not exists public.ava_spam_companies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                       -- normalized company name, else 'cb:<callback>' / 'cid:<caller id>'
  name text,
  website text,
  callback_numbers text[] not null default '{}',  -- E.164
  caller_ids text[] not null default '{}',        -- E.164
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  calls_12mo integer not null default 0,
  status text not null default 'tracking' check (status in ('tracking', 'threshold', 'letter_drafted', 'complaint_filed', 'settled', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ava_spam_companies enable row level security;
create policy "admin ava_spam_companies" on public.ava_spam_companies for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
grant select, update on public.ava_spam_companies to authenticated;

-- ---------- call columns ----------
alter table public.ava_calls add column if not exists is_spam boolean not null default false;
alter table public.ava_calls add column if not exists robocall boolean not null default false;
alter table public.ava_calls add column if not exists spam_company text;
alter table public.ava_calls add column if not exists spam_website text;
alter table public.ava_calls add column if not exists spam_callback_number text;
alter table public.ava_calls add column if not exists spam_caller_name text;
alter table public.ava_calls add column if not exists spam_offer text;
alter table public.ava_calls add column if not exists spam_company_id uuid references public.ava_spam_companies (id) on delete set null;
alter table public.ava_calls add column if not exists evidence_path text;
alter table public.ava_calls add column if not exists evidence_at timestamptz;
alter table public.ava_calls add column if not exists evidence_tries integer not null default 0;
alter table public.ava_calls add column if not exists evidence_error text;
create index if not exists ava_calls_spam_company_idx on public.ava_calls (spam_company_id) where spam_company_id is not null;
create index if not exists ava_calls_spam_idx on public.ava_calls (created_at desc) where is_spam;

-- ---------- evidence bucket: private, admins read, only the edge function writes, nothing is purged ----------
insert into storage.buckets (id, name, public, file_size_limit) values ('ava-evidence', 'ava-evidence', false, 52428800) on conflict (id) do nothing;
create policy "ava evidence: admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'ava-evidence' and public.has_role(auth.uid(), 'admin'));

-- ---------- matching helpers ----------
create or replace function public.ava_norm_company(p text) returns text language sql immutable set search_path to 'public'
as $function$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'),
    '\m(incorporated|inc|llc|l l c|corp|corporation|co|company|ltd|limited|the)\M', ' ', 'g'), '\s+', ' ', 'g')), '')
$function$;

create or replace function public.ava_digits10(p text) returns text language sql immutable set search_path to 'public'
as $function$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 10 then right(regexp_replace(p, '\D', '', 'g'), 10) end
$function$;

create or replace function public.ava_site_domain(p text) returns text language sql immutable set search_path to 'public'
as $function$
  select case when d like '%.%' then d end from (
    select nullif(split_part(split_part(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^[a-z]+://', ''), '^www\.', ''), '/', 1), '?', 1), '') as d) x
$function$;

-- ---------- the trigger: a spam call lands -> company row, recount, threshold ----------
create or replace function public.ava_calls_spam_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_name text := nullif(btrim(coalesce(new.spam_company, '')), '');
  v_norm text := ava_norm_company(new.spam_company);
  v_dom text := ava_site_domain(new.spam_website);
  v_cb text := ava_digits10(new.spam_callback_number);
  v_cid text := ava_digits10(new.phone);
  v_skip text[] := array['8164299495', '8165007236'];   -- her line and Jared's cell are never a spammer's number
  v_nums text[];
  v_e164 text[];
  v_id uuid; v_n integer; v_status text; v_cname text; v_ord text; v_key text;
begin
  if not new.is_spam or new.direction is distinct from 'inbound' then return new; end if;
  if v_cb is not null and v_cb = any (v_skip) then v_cb := null; end if;
  if v_cid is not null and v_cid = any (v_skip) then v_cid := null; end if;
  v_nums := array_remove(array_remove(array[v_cb, v_cid], null), '');
  v_e164 := array(select '+1' || x from unnest(v_nums) x);

  select c.id into v_id from ava_spam_companies c
   where (v_norm is not null and (c.key = v_norm or ava_norm_company(c.name) = v_norm))
      or (v_dom is not null and ava_site_domain(c.website) = v_dom)
      or (cardinality(v_e164) > 0 and (c.callback_numbers && v_e164 or c.caller_ids && v_e164))
   order by c.first_seen limit 1;

  if v_id is null then
    v_key := coalesce(v_norm, case when v_cb is not null then 'cb:' || v_cb end, case when v_cid is not null then 'cid:' || v_cid end, 'call:' || new.id::text);
    insert into ava_spam_companies (key, name, website, first_seen, last_seen)
    values (v_key, v_name, nullif(btrim(coalesce(new.spam_website, '')), ''), new.created_at, new.created_at)
    on conflict (key) do nothing
    returning id into v_id;
    if v_id is null then select id into v_id from ava_spam_companies where key = v_key; end if;
  end if;

  update ava_spam_companies c set
    name = coalesce(c.name, v_name),
    website = coalesce(c.website, nullif(btrim(coalesce(new.spam_website, '')), '')),
    callback_numbers = case when v_cb is null then c.callback_numbers else array(select distinct x from unnest(c.callback_numbers || ('+1' || v_cb)) x) end,
    caller_ids = case when v_cid is null then c.caller_ids else array(select distinct x from unnest(c.caller_ids || ('+1' || v_cid)) x) end,
    first_seen = least(c.first_seen, new.created_at),
    last_seen = greatest(c.last_seen, new.created_at),
    updated_at = now()
   where c.id = v_id;

  update ava_calls set spam_company_id = v_id where id = new.id and spam_company_id is distinct from v_id;

  select count(*) into v_n from ava_calls where spam_company_id = v_id and is_spam and direction = 'inbound' and created_at > now() - interval '12 months';
  update ava_spam_companies set calls_12mo = v_n, updated_at = now() where id = v_id returning status, name into v_status, v_cname;

  if v_n >= 2 and v_status = 'tracking' then
    update ava_spam_companies set status = 'threshold', updated_at = now() where id = v_id and status = 'tracking';
    v_ord := case v_n when 2 then '2nd' when 3 then '3rd' else v_n::text || 'th' end;
    perform scout_notify('Ava (assistant): ' || v_ord || ' call from ' || coalesce(v_cname, 'an unknown company') || '. You may have a Do Not Call claim.',
      'Only calls that came through your cell count against the registry, so check they show Forwarded. Open Spam and Do Not Call on /admin/ava for the evidence, the complaint text and a draft letter.',
      'warning', true, 'https://bestly.tech/admin/ava', 'ava-dnc-threshold-' || v_id::text);
  end if;
  return new;
exception when others then
  -- spam bookkeeping must never break call logging
  raise warning 'ava_calls_spam_trg failed: %', sqlerrm;
  return new;
end $function$;
create trigger ava_calls_spam after insert or update of is_spam, spam_company, spam_website, spam_callback_number on public.ava_calls
  for each row execute function public.ava_calls_spam_trg();

-- spam-intel calls last up to 2 minutes on purpose: the long-call watch skips them
create or replace function public.ava_calls_reply_guard_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare s ava_settings;
begin
  if new.transcript is not null and (tg_op = 'INSERT' or old.transcript is distinct from new.transcript) then
    perform ava_reply_guard('ava', new.id, new.call_no, new.transcript);
    if new.voice = 'jared' then
      perform ava_impersonation_check(new.id, new.call_no, new.transcript);
    end if;
    select * into s from ava_settings where id;
    if new.direction = 'inbound' and new.contact_id is null and not new.is_spam and new.phone is distinct from coalesce(s.jared_cell, '+18165007236') then
      perform ava_long_call_check('ava', new.id, new.call_no, new.duration_sec,
        coalesce(new.message, '') <> '' or coalesce(new.callback_wanted, false) or new.callback_number is not null,
        coalesce(new.duration_sec, 0) / 60.0 * s.cost_voice_per_min + ceil(coalesce(new.duration_sec, 0) / 60.0) * s.cost_phone_per_min + coalesce(new.llm_cost, 0));
    end if;
  end if;
  return new;
end $function$;

-- ---------- watchdog: counts age out of the 12-month window ----------
create or replace function public.ava_spam_recount() returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n integer;
begin
  with x as (
    update ava_spam_companies c set
      calls_12mo = (select count(*) from ava_calls a where a.spam_company_id = c.id and a.is_spam and a.direction = 'inbound' and a.created_at > now() - interval '12 months'),
      updated_at = now()
     where c.calls_12mo is distinct from (select count(*) from ava_calls a where a.spam_company_id = c.id and a.is_spam and a.direction = 'inbound' and a.created_at > now() - interval '12 months')
    returning c.id)
  select count(*) into n from x;
  return n;
end $function$;
revoke execute on function public.ava_spam_recount() from public, anon, authenticated;

create or replace function public.ava_watch()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_stuck int; s ava_settings;
begin
  select * into s from ava_settings where id;
  with x as (update ava_calls set status = 'failed', summary = coalesce(summary, '[watchdog: no report after 30 min]')
              where status in ('queued', 'in_progress') and created_at < now() - interval '30 minutes' returning id)
  select count(*) into v_stuck from x;
  if s.agent_id is null or s.phone_number_id is null then
    perform bestly_raise('ava.assistant', 'problem', 'warning', 'Ava (personal) is not answering her line',
      'Her voice agent or phone number is not set up. Open /admin/ava and run Setup.', 'ava', null, true);
  elsif v_stuck >= 3 then
    perform bestly_raise('ava.assistant', 'problem', 'warning', 'Ava (personal) calls not reporting back',
      format('%s calls never got a post-call report. Check the Ava webhook in ElevenLabs.', v_stuck), 'ava', null, true);
  else
    perform bestly_raise('ava.assistant', 'resolved', 'info', 'Ava (personal) healthy', null, 'ava');
  end if;

  -- forwarding: on for 48 hours and not one call marked as forwarded. Once per time Jared turns it on.
  if s.forward_enabled and s.forward_enabled_at is not null and s.forward_enabled_at < now() - interval '48 hours'
     and not exists (select 1 from ava_calls where forwarded and created_at >= s.forward_enabled_at) then
    perform scout_notify('Ava (assistant): forwarded calls aren''t being detected yet',
      'Missed-call forwarding has been on for over 2 days and no call has been marked Forwarded. If nobody missed-called you, ignore this. '
      || 'If someone did, the phone company may not be passing the forwarding details. The last payloads are saved in the debug log; ask Claude to read it and fix the detection.',
      'info', true, 'https://bestly.tech/admin/ava', 'ava-forward-undetected-' || to_char(s.forward_enabled_at, 'YYYYMMDDHH24MISS'));
  end if;

  perform ava_spam_recount();

  -- line check: Telnyx routing, incoming calls on, init webhook set. Heals itself by re-running setup. Also retries evidence copies.
  begin perform invoke_edge_function('ava-assistant', '{"action":"health"}'::jsonb, 150000);
  exception when others then null; end;
  return jsonb_build_object('stuck_fixed', v_stuck);
end $function$;
