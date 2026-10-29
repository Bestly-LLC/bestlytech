-- Insurance Filer: when a Turo guest's own auto insurance is in play, Claims Closer files and runs that insurance claim end to end.
-- Team card: insurance-filer, a tool of Claims Closer (claims-closer). Jared's part is one tap per step.   Branch: insurance-filer, 2026-10-29.
--
--   1. A case opens by itself: claim_events kind 'insurer' (or claim_cases gaining an insurer) opens a row in outside_claims with
--      kind 'guest_insurer'. The Kemper row stays kind 'other' and keeps working exactly as before.
--   2. The packet (every fact the form needs, each with where it came from, and the fields we do NOT know) is built from claim_cases,
--      turo_trips, the guest's damage report and the guest's own message. Nothing is invented: an unknown field stays blank and is listed.
--   3. Photos: the Pi Turo reader (signed in to Turo) and a server-side copy of the photos already in claim-evidence fill the PRIVATE
--      bucket insurance-photos. Short-lived signed URLs only.
--   4. The Mac mini filer opens the insurer's guest claim page, fills it from the packet, and STOPS BEFORE SUBMIT. One approval (short
--      link bestly.tech/y/<code> + a "Your call" item on the Command Center Waiting card) shows everything. His tap submits.
--   5. Adjuster mail is matched by claim number, policy number or insurer domain. Replies are drafted with free AI only (photos, facts
--      and the finalized estimate attached) and wait for one tap. Nudge after 2 business days of quiet; after 2 more, an Ava errand for a
--      BRIDGE call (Ava gets a human, then hands the call to Jared's cell).  Nothing is ever emailed or dialed without his tap.
--   6. Turo/Snapsheet mail is parsed onto the case timeline; the Tesla Service message and the Turo reply are drafted for one tap.
--   7. Watchdog: ins_selftest() + ins_watch() (owner claims-closer through bestly_raise, self-healing where it can).
--
-- NOTHING HERE RUNS UNTIL ROLLOUT: ins_settings.enabled starts false, every cron line is commented ("enable at rollout").
--
-- UNDO: the last section of this file (all of it is plain SQL; the two rewritten functions are saved to bestly_memory first).
-- House rules kept: no `text[] || 'literal'` (array_append), jsonb arrays guarded by jsonb_typeof, 12-hour times, new tables with
-- emails or phones have privacy_data_map rows, public-key RPCs are in security_public_rpcs.

-- ============================================================================================================================
-- 0. Save the functions this migration rewrites (UNDO restores from this row).
-- ============================================================================================================================
insert into public.bestly_memory (area, key, title, body, kind, tags, source, pinned, active, written_by)
select 'ops', 'build/insurance-filer-2026-10-29-undo-stuck-items-core',
       'UNDO: stuck_items_core / outside_claims_check / stuck_feed_selftest before the Insurance Filer (2026-10-29)',
       'Exact pg_get_functiondef of the three functions before the Insurance Filer patched them. To undo: run each CREATE OR REPLACE below.' || E'\n\n'
         || pg_get_functiondef('public.stuck_items_core()'::regprocedure) || E'\n\n-- ----\n\n'
         || pg_get_functiondef('public.outside_claims_check()'::regprocedure) || E'\n\n-- ----\n\n'
         || pg_get_functiondef('public.stuck_feed_selftest()'::regprocedure),
       'runbook', array['claims-closer', 'insurance-filer', 'undo'], 'chat', false, true, 'claude'
where not exists (select 1 from public.bestly_memory where key = 'build/insurance-filer-2026-10-29-undo-stuck-items-core');

-- ============================================================================================================================
-- 1. The Turo mail matcher, carried AS-IS from the live database (changed live Oct 29, 12:10 AM, by the coordinator).
--    Why: claims_res_from_mail used to need a "#", so "Update for Turo Claim 1108308 on Reservation 62622707" was missed.
--    This block only restates what is already live so a fresh database has it. The insurer matcher below works the same way.
-- ============================================================================================================================
CREATE OR REPLACE FUNCTION public.claims_res_from_mail(p_subject text, p_body text)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select coalesce(
    substring(p_subject from '#\s*(\d{7,})'),
    substring(p_subject from '(?i)reservation\s*(?:id)?\s*[:#]?\s*#?\s*(\d{7,})'),
    substring(p_body from 'reservation/(\d{7,})'),
    substring(p_body from '(?i)reservation\s*(?:id)?\s*[:#]?\s*#?\s*(\d{7,})')
  )::bigint
$function$;

CREATE OR REPLACE FUNCTION public.claims_res_from_claim_no(p_subject text, p_body text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.reservation_id from claim_cases c
   where c.turo_claim_no is not null
     and c.turo_claim_no = coalesce(substring(p_subject from '(?i)claim\s*(?:no\.?|number|#)?\s*(\d{6,8})'),
                                    substring(p_body from '(?i)claim\s*(?:id|no\.?|number|#)?\s*:?\s*(\d{6,8})'))
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.claims_mail_seen(m bestly_mail)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_res bigint; v_subj text := regexp_replace(coalesce(m.subject, ''), '\s+', ' ', 'g'); v_body text := coalesce(m.body_text, '');
        c claim_cases; v_kind text; v_amt numeric; v_due text;
begin
  if coalesce(m.from_addr, '') !~* 'turo\.com' then return; end if;
  v_res := coalesce(claims_res_from_mail(v_subj, v_body), claims_res_from_claim_no(v_subj, v_body));
  if v_res is null then return; end if;

  v_kind := case
    when v_subj ~* 'resolve directly process' then 'resolve_started'
    when m.from_addr ~* 'claims\.turo\.com' and v_subj ~* '(claim|damage)' then 'claim_mail'
    when (v_subj || ' ' || v_body) ~* '(has been charged|has been paid|was paid|accepted the reimbursement invoice|payment received|paid invoice)' then 'invoice_paid'
    when v_subj ~* 'reimbursement invoice' and v_body ~* 'until' then 'invoice_sent'
    when v_subj ~* 'reimbursement|invoice' and v_body ~* 'disput' then 'invoice_disputed'
    else null end;

  select * into c from claim_cases where reservation_id = v_res;
  if c.id is null then
    if v_kind in ('resolve_started', 'claim_mail') then
      perform claims_open_case(v_res, case when v_kind = 'resolve_started' then 'resolve_directly' else 'turo_claim' end, m.id, coalesce(m.sent_at, now()));
      select * into c from claim_cases where reservation_id = v_res;
    else
      return;
    end if;
  end if;

  if exists (select 1 from claim_events where mail_id = m.id and kind = 'mail') then return; end if;
  insert into claim_events (case_id, reservation_id, kind, title, detail, mail_id)
    values (c.id, v_res, 'mail', left(v_subj, 200), jsonb_build_object('kind', v_kind, 'from', m.from_addr, 'excerpt', left(v_body, 600)), m.id);

  if v_kind = 'invoice_sent' then
    v_amt := nullif(replace(substring(v_body from 'Total charge\s*-\s*\$([0-9.,]+)'), ',', ''), '')::numeric;
    v_due := substring(v_body from 'until ([A-Z][a-z]+ \d{1,2} at \d{1,2}:\d{2} ?[AP]M)');
    update claim_cases set invoices = invoices || jsonb_build_array(jsonb_build_object('amount', v_amt, 'due_text', v_due, 'mail_id', m.id, 'paid', false)),
      updated_at = now() where id = c.id;
  elsif v_kind = 'invoice_paid' then
    v_amt := nullif(replace(substring(v_body from 'Total charge\s*-\s*\$([0-9.,]+)'), ',', ''), '')::numeric;
    update claim_cases set invoices = (select coalesce(jsonb_agg(case when v_amt is null or (i->>'amount')::numeric = v_amt then i || jsonb_build_object('paid', true) else i end), '[]'::jsonb)
                                        from jsonb_array_elements(invoices) i),
      updated_at = now() where id = c.id;
  elsif v_kind = 'invoice_disputed' then
    update claim_cases set needs_work = true, work_reason = 'guest disputed an invoice', updated_at = now() where id = c.id;
    perform claims_notify(coalesce(c.guest_first, 'guest') || ' disputed an invoice',
      'You can escalate to Turo from the Claims tab. Cutoff ' || to_char(c.escalate_by at time zone 'America/Los_Angeles', 'Dy Mon DD FMHH12:MI AM') || '.',
      'warning', 'claims-dispute-' || m.id);
  else
    update claim_cases set needs_work = true, work_reason = coalesce(v_kind, 'new Turo mail'), updated_at = now() where id = c.id;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.claims_mail_unmatched_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m bestly_mail; v_n int := 0; v_fixed int := 0;
begin
  for m in
    select b.* from bestly_mail b
     where b.from_addr ~* 'claims\.turo\.com|turo\.com'
       and b.ingested_at between now() - interval '14 days' and now() - interval '15 minutes'
       and (b.subject ~* '(claim|damage|incident|reimbursement|invoice)' or b.from_addr ~* 'claims\.turo\.com')
       and not exists (select 1 from claim_events e where e.mail_id = b.id)
  loop
    begin perform claims_mail_seen(m); exception when others then null; end;   -- self-heal: retry with the current matcher
    if exists (select 1 from claim_events e where e.mail_id = m.id) then
      v_fixed := v_fixed + 1;
      perform bestly_raise('claims.mail_unmatched.' || left(m.id::text, 8), 'resolved', 'info', 'Claims Closer matched the Turo email');
    elsif m.from_addr ~* 'claims\.turo\.com' then
      v_n := v_n + 1;
      perform bestly_raise('claims.mail_unmatched.' || left(m.id::text, 8), 'problem', 'warning',
        'Claims Closer could not match a Turo claims email',
        'Claims Closer here. "' || left(regexp_replace(coalesce(m.subject, ''), '\s+', ' ', 'g'), 160) || '" from Turo Claims ('
          || to_char(m.sent_at at time zone 'America/Los_Angeles', 'Mon FMDD FMHH12:MI AM') || ') did not name a reservation or claim I know. It is not on any case yet.',
        'turo', null, false);
    end if;
  end loop;
  return jsonb_build_object('unmatched', v_n, 'healed', v_fixed);
end $function$;

-- Live already (`claims-mail-unmatched-watch`, every 15 minutes). Registered only if a fresh database does not have it yet.
do $c$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and not exists (select 1 from cron.job where jobname = 'claims-mail-unmatched-watch') then
    perform cron.schedule('claims-mail-unmatched-watch', '*/15 * * * *', 'select public.claims_mail_unmatched_watch();');
  end if;
end $c$;

-- ============================================================================================================================
-- 2. Settings, the insurer registry, and the case columns on outside_claims
-- ============================================================================================================================
create table if not exists public.ins_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,                 -- the rollout switch: nothing opens, queues or pushes while false
  consent_before_tap boolean not null default false,   -- Jared 2026-10-29: never accept an insurer's terms before his tap; his tap accepts them and submits.        -- true: the fill pass clicks the insurer's "I agree and continue" so later screens can be reached; the approval page shows the consent text
  photo_wait_minutes integer not null default 30,         -- go ahead without the Pi's photos after this long
  nudge_business_days integer not null default 2,
  call_after_business_days integer not null default 2,    -- after a nudge goes unanswered this long, queue the bridge call
  owner_name text not null default 'Jared Best',
  owner_phone text not null default '(816) 500-7236',
  owner_email text not null default 'jared@bestly.tech',
  owner_address text,                                     -- not saved yet; the form's address question stays blank and is listed
  updated_at timestamptz not null default now()
);
insert into public.ins_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.ins_insurers (
  slug text primary key,
  name text not null,
  match_names text[] not null default '{}',               -- lower-case names a guest might type
  match_domains text[] not null default '{}',             -- mail from these domains is this insurer
  phone text,                                             -- the claims line (10 digits); null = unknown, the case asks for it
  email text,                                             -- a claims inbox, when the insurer takes email
  claim_url text,
  method text not null default 'call' check (method in ('web', 'email', 'call')),
  filer text,                                             -- the Mac mini module that fills the form (null: no web filer)
  notes text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.ins_insurers (slug, name, match_names, match_domains, phone, claim_url, method, filer, notes) values
  ('progressive', 'Progressive',
   array['progressive', 'progressive insurance', 'progressive casualty', 'progressive auto', 'progressive direct'],
   array['progressive.com', 'email.progressive.com', 'progressiveagent.com'],
   '8007764737', 'https://www.progressive.com/support/report-a-claim/', 'web', 'progressive',
   'Guest claim flow, powered by Assured (fnol.progressive.com). Screens seen live: safety question, then name and phone with an I Agree and Continue consent. Claims line 1-800-776-4737 from their public page; confirm before the first call.')
on conflict (slug) do nothing;

-- outside_claims was built for the Kemper check. The Insurance Filer adds its own rows to it (kind 'guest_insurer') so the Command
-- Center Waiting card, the daily outside-claims check and the errand link keep one home. Existing rows are kind 'other'.
alter table public.outside_claims
  add column if not exists kind text not null default 'other',
  add column if not exists case_id uuid references public.claim_cases(id) on delete set null,
  add column if not exists reservation_id bigint,
  add column if not exists insurer_slug text,
  add column if not exists policy_no text,
  add column if not exists policyholder text,
  add column if not exists driver_name text,
  add column if not exists driver_phone text,
  add column if not exists adjuster_name text,
  add column if not exists adjuster_email text,
  add column if not exists adjuster_phone text,
  add column if not exists filed_at timestamptz,
  add column if not exists ins_stage text,
  add column if not exists packet jsonb,
  add column if not exists packet_hash text,
  add column if not exists photo_set jsonb not null default '{}'::jsonb,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists internal jsonb not null default '{}'::jsonb;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'outside_claims_kind_check') then
    alter table public.outside_claims add constraint outside_claims_kind_check check (kind in ('other', 'guest_insurer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outside_claims_ins_stage_check') then
    alter table public.outside_claims add constraint outside_claims_ins_stage_check
      check (ins_stage is null or ins_stage in ('new', 'photos', 'filling', 'needs_approval', 'submitting', 'filed', 'needs_contact', 'emailing', 'paused', 'closed'));
  end if;
end $c$;
create unique index if not exists outside_claims_guest_case_uidx on public.outside_claims (case_id) where kind = 'guest_insurer';

-- ============================================================================================================================
-- 3. Jobs, photos, approvals, drafts, events, amounts, mail links
-- ============================================================================================================================
create table if not exists public.ins_jobs (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references public.outside_claims(id) on delete cascade,
  kind text not null check (kind in ('copy_evidence', 'photos', 'fill', 'submit', 'send_mail', 'attach_fetch')),
  runner text not null check (runner in ('edge', 'pi', 'mac')),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'failed', 'blocked')),
  dry boolean not null default false,                      -- a rehearsal: fills and reports, can never submit
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts integer not null default 0,
  window_s integer not null default 900,                   -- how long a runner may hold it before the watchdog steps in
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index if not exists ins_jobs_open_idx on public.ins_jobs (runner, status, created_at);
create index if not exists ins_jobs_oc_idx on public.ins_jobs (oc_id, kind, created_at desc);

create table if not exists public.ins_photos (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references public.outside_claims(id) on delete cascade,
  case_id uuid,
  source text not null check (source in ('guest_report', 'checkin', 'return', 'before', 'after', 'estimate_doc', 'shot')),
  turo_uuid text,
  step text,
  description text,
  storage_path text not null,                              -- inside the private bucket insurance-photos
  mime text not null default 'image/jpeg',
  bytes integer,
  width integer,
  height integer,
  taken_at timestamptz,
  created_at timestamptz not null default now(),
  unique (oc_id, storage_path)
);
create index if not exists ins_photos_oc_idx on public.ins_photos (oc_id, source);

create table if not exists public.ins_approvals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                               -- starts with 'i' (Ava's codes never do) so /y/<code> knows which page to open
  oc_id uuid not null references public.outside_claims(id) on delete cascade,
  kind text not null check (kind in ('file_claim', 'send_mail')),
  title text not null,
  summary jsonb not null default '{}'::jsonb,              -- everything the page shows: fields, blanks, consent, photos, screenshots
  hash text not null,                                      -- the page sends it back; a changed packet makes an old tap stale
  job_id uuid references public.ins_jobs(id) on delete set null,
  draft_id uuid,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'expired', 'superseded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 days',
  decided_at timestamptz,
  decided_by uuid,
  push_sent_at timestamptz,
  nudged_at timestamptz
);
create index if not exists ins_approvals_oc_idx on public.ins_approvals (oc_id, status);

create table if not exists public.ins_drafts (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references public.outside_claims(id) on delete cascade,
  kind text not null check (kind in ('adjuster_reply', 'nudge', 'turo_reply', 'first_email')),
  to_addr text not null,
  cc text,
  subject text not null,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,          -- [{photo_id, name, bytes}]
  in_reply_to_mail uuid,
  status text not null default 'draft' check (status in ('writing', 'draft', 'awaiting', 'approved', 'sending', 'sent', 'failed', 'dismissed')),
  approval_id uuid,
  attempts integer not null default 0,
  error text,
  verified boolean,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz
);
create index if not exists ins_drafts_oc_idx on public.ins_drafts (oc_id, status);

create table if not exists public.ins_events (
  id bigserial primary key,
  oc_id uuid not null references public.outside_claims(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  title text not null,
  detail jsonb,
  mail_id uuid
);
create index if not exists ins_events_oc_idx on public.ins_events (oc_id, at);
create unique index if not exists ins_events_mail_uidx on public.ins_events (oc_id, mail_id, kind) where mail_id is not null;

create table if not exists public.ins_amounts (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references public.outside_claims(id) on delete cascade,
  source text not null check (source in ('turo', 'insurer', 'guest', 'tesla', 'other')),
  amount numeric(10, 2) not null,
  note text,
  confirmed boolean not null default false,               -- parsed from an email = false until Jared confirms
  mail_id uuid,
  at timestamptz not null default now()
);
create unique index if not exists ins_amounts_mail_uidx on public.ins_amounts (oc_id, mail_id, source, amount) where mail_id is not null;

create table if not exists public.ins_mail_links (
  mail_id uuid primary key,
  oc_id uuid not null references public.outside_claims(id) on delete cascade,
  matched_by text not null,                               -- claim_no | policy | domain
  at timestamptz not null default now()
);

-- Same rule as outside_claims: the browser may read (admin only through RLS); every write goes through a security-definer function.
do $c$
declare t text;
begin
  foreach t in array array['ins_settings', 'ins_insurers', 'ins_jobs', 'ins_photos', 'ins_approvals', 'ins_drafts', 'ins_events', 'ins_amounts', 'ins_mail_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.team_is_admin())', t || '_admin_read', t);
  end loop;
end $c$;

-- A private bucket. Nothing is ever public; pages get signed URLs from the insurance-filer edge function.
insert into storage.buckets (id, name, public) values ('insurance-photos', 'insurance-photos', false) on conflict (id) do nothing;

-- The new columns hold adjusters' and drivers' emails and phones; the new tables hold addresses and phone numbers.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason)
select v.t, v.c, v.k, v.a, v.r
  from (values
    ('outside_claims', 'adjuster_email', 'email', 'review', 'Your call'),
    ('outside_claims', 'adjuster_phone', 'phone', 'review', 'Your call'),
    ('outside_claims', 'driver_phone', 'phone', 'review', 'Your call'),
    ('ins_drafts', 'to_addr', 'email', 'review', 'Your call'),
    ('ins_drafts', 'cc', 'email', 'review', 'Your call'),
    ('ins_settings', 'owner_email', 'email', 'keep', 'Jared''s own details, used to file his own claims'),
    ('ins_settings', 'owner_phone', 'phone', 'keep', 'Jared''s own details, used to file his own claims'),
    ('ins_insurers', 'email', 'email', 'keep', 'A company claims inbox, not a person'),
    ('ins_insurers', 'phone', 'phone', 'keep', 'A company claims line, not a person')
  ) as v(t, c, k, a, r)
 where not exists (select 1 from public.privacy_data_map p where p.table_name = v.t and p.column_name = v.c);

-- ============================================================================================================================
-- 4. Small helpers: business days and hours (Los Angeles), digits, registry lookup, the case timeline, the one push
-- ============================================================================================================================
create or replace function public.ins_digits(p text) returns text
language sql immutable set search_path = public as $$
  select case when length(d) = 11 and left(d, 1) = '1' then substr(d, 2) else d end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- Mon to Fri, 9:00 AM to 4:30 PM Los Angeles. (No holiday calendar: a call on a holiday just rings out and shows on the card.)
create or replace function public.ins_biz_open(p_ts timestamptz default now()) returns boolean
language sql stable set search_path = public as $$
  select extract(isodow from l) between 1 and 5 and l::time >= time '09:00' and l::time < time '16:30'
    from (select p_ts at time zone 'America/Los_Angeles' as l) x
$$;

create or replace function public.ins_next_biz_open(p_ts timestamptz default now()) returns timestamptz
language plpgsql stable set search_path = public as $$
declare l timestamp := p_ts at time zone 'America/Los_Angeles'; d timestamp;
begin
  if public.ins_biz_open(p_ts) then return p_ts; end if;
  d := date_trunc('day', l) + interval '9 hours';
  if l >= d + interval '7 hours 30 minutes' or extract(isodow from l) > 5 then d := d + interval '1 day'; end if;
  while extract(isodow from d) > 5 loop d := d + interval '1 day'; end loop;
  return d at time zone 'America/Los_Angeles';
end $$;

-- p_n business days after p_ts, same clock time (weekends skipped).
create or replace function public.ins_add_biz(p_ts timestamptz, p_n integer) returns timestamptz
language plpgsql stable set search_path = public as $$
declare l timestamp := p_ts at time zone 'America/Los_Angeles'; n integer := 0;
begin
  while n < greatest(p_n, 0) loop
    l := l + interval '1 day';
    if extract(isodow from l) between 1 and 5 then n := n + 1; end if;
  end loop;
  return l at time zone 'America/Los_Angeles';
end $$;

create or replace function public.ins_registry_find(p_name text, p_from text default null) returns text
language sql stable security definer set search_path = public as $$
  select i.slug from ins_insurers i
   where i.enabled
     and ((nullif(btrim(coalesce(p_name, '')), '') is not null
           and (lower(btrim(p_name)) = any (i.match_names)
                or exists (select 1 from unnest(i.match_names) n where length(n) >= 4 and lower(p_name) like '%' || n || '%')))
          or (p_from is not null and exists (select 1 from unnest(i.match_domains) d
                                              where lower(p_from) ~ ('@([a-z0-9-]+\.)*' || replace(d, '.', '\.') || '>?\s*$'))))
   order by (lower(btrim(coalesce(p_name, ''))) = any (i.match_names)) desc, i.slug
   limit 1
$$;

create or replace function public.ins_event(p_oc uuid, p_kind text, p_title text, p_detail jsonb default null, p_mail uuid default null, p_at timestamptz default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into ins_events (oc_id, at, kind, title, detail, mail_id) values (p_oc, coalesce(p_at, now()), p_kind, left(p_title, 300), p_detail, p_mail)
  on conflict do nothing returning id into v;
  return v;
end $$;

-- The one push (signed Claims Closer; her source is a money-class interrupt). Quiet when the filer is off.
create or replace function public.ins_notify(p_title text, p_body text, p_url text, p_tag text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce((select enabled from ins_settings where id), false) then return 'off'; end if;
  begin
    perform notify_route('Claims Closer: ' || left(p_title, 170), coalesce(p_body, ''), 'time-sensitive', 'Claims Closer',
                         coalesce(p_url, 'https://bestly.tech/admin'), null, p_tag, null, null, false, now());
    return 'sent';
  exception when others then
    return 'failed';
  end;
end $$;

-- ============================================================================================================================
-- 5. The packet: every fact the insurer's form needs, each with where it came from. Unknown stays blank and is listed.
-- ============================================================================================================================
-- Appends one field to the list when it has a value, otherwise to the unknown list. Returns {fl, unk}.
create or replace function public.ins_f(fl jsonb, unk jsonb, p_key text, p_label text, p_group text, p_value text, p_source text, p_conf text, p_why text) returns jsonb
language plpgsql immutable set search_path = public as $$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is not null then
    return jsonb_build_object('fl', fl || jsonb_build_array(jsonb_build_object('key', p_key, 'label', p_label, 'group', p_group,
             'value', btrim(p_value), 'source', p_source, 'confidence', coalesce(p_conf, 'stated'))), 'unk', unk);
  end if;
  return jsonb_build_object('fl', fl, 'unk', unk || jsonb_build_array(jsonb_build_object('key', p_key, 'label', p_label, 'group', p_group, 'why', p_why)));
end $$;

-- One answer out of Turo's damage report (the keys are Turo's own question text).
create or replace function public.ins_ans(p_answers jsonb, p_like text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(e.value), '') from jsonb_each_text(case when jsonb_typeof(p_answers) = 'object' then p_answers else '{}'::jsonb end) e
   where e.key ilike p_like order by e.key limit 1
$$;

-- "Country: US | Street address: 750 B St | City: San Diego, Ca | State: - | Postal code: 92101" -> one part
create or replace function public.ins_loc_part(p_loc text, p_part text) returns text
language sql immutable set search_path = public as $$
  select nullif(nullif(btrim(substring(coalesce(p_loc, '') from p_part || ':\s*([^|]*)')), ''), '-')
$$;

create or replace function public.ins_packet_core(f jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb := coalesce(f->'case', '{}'::jsonb); t jsonb := coalesce(f->'trip', '{}'::jsonb); s jsonb := coalesce(f->'settings', '{}'::jsonb);
  o jsonb := coalesce(f->'oc', '{}'::jsonb); est jsonb := coalesce(f->'estimate', '{}'::jsonb); ph jsonb := coalesce(f->'photos', '{}'::jsonb);
  ans jsonb; ins jsonb := coalesce(c->'insurer', '{}'::jsonb);
  fl jsonb := '[]'::jsonb; unk jsonb := '[]'::jsonb; r jsonb;
  v_loc text; v_city text; v_cityraw text; v_state text; v_dt text; v_date date; v_extra text; v_drv text; v_drvphone text; v_who text;
  v_holder text; v_holder_conf text; v_holder_src text; v_msg text; v_left text; v_guest text; v_gphone text;
  v_year text; v_make text; v_model text; v_plate text; v_pstate text; v_vin text; v_claim text; v_turo text; v_insname text; v_policy text;
  v_vals jsonb := '{}'::jsonb; e jsonb; v_amount numeric; v_final boolean; v_insre text;
begin
  ans := case when jsonb_typeof(c->'guest_response'->'answers') = 'object' then c->'guest_response'->'answers'
              when jsonb_typeof(c->'damage_report'->'answers') = 'object' then c->'damage_report'->'answers'
              else '{}'::jsonb end;
  v_insname := nullif(btrim(coalesce(ins->>'name', o->>'insurer', '')), '');
  v_policy := nullif(btrim(coalesce(ins->>'policy_no', o->>'policy_no', '')), '');
  v_claim := nullif(btrim(coalesce(o->>'claim_no', ins->>'claim_no', '')), '');

  -- who is reporting
  r := ins_f(fl, unk, 'reporter.name', 'Your name (vehicle owner)', 'reporter', s->>'owner_name', 'Saved owner details', 'stated', 'No owner name saved'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'reporter.phone', 'Your phone', 'reporter', s->>'owner_phone', 'Saved owner details', 'stated', 'No owner phone saved'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'reporter.email', 'Your email', 'reporter', s->>'owner_email', 'Saved owner details', 'stated', 'No owner email saved'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'reporter.role', 'Your role in the claim', 'reporter', 'Owner of the car (a Turo host). Not the policyholder.', 'Turo trip record', 'stated', ''); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'reporter.address', 'Your mailing address', 'reporter', s->>'owner_address', 'Saved owner details', 'stated', 'Not saved. Left blank. Add it if the form asks for it.'); fl := r->'fl'; unk := r->'unk';

  -- the policy
  r := ins_f(fl, unk, 'insurer.name', 'Insurance company', 'policy', v_insname, 'Guest message ' || coalesce(ins->>'source', 'reply'), 'stated', 'The guest has not named an insurer'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'policy.number', 'Policy number', 'policy', v_policy, 'Guest message ' || coalesce(ins->>'source', 'reply'), 'stated', 'The guest has not given a policy number'); fl := r->'fl'; unk := r->'unk';
  v_holder := nullif(btrim(coalesce(o->>'policyholder', '')), '');
  if v_holder is not null then
    v_holder_conf := 'stated'; v_holder_src := 'Saved on the case';
  else
    v_msg := f->>'policy_msg';
    if v_msg is not null and v_policy is not null then
      v_insre := regexp_replace(coalesce(v_insname, '~~~'), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g');
      v_left := btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(v_msg, regexp_replace(v_policy, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), ' ', 'g'), v_insre, ' ', 'gi'), '[^A-Za-z\s''-]', ' ', 'g'), '\s+', ' ', 'g'));
      if v_left ~ '^[A-Za-z''-]+( [A-Za-z''-]+)+$' and length(v_left) <= 60 then
        v_holder := initcap(lower(v_left)); v_holder_conf := 'inferred'; v_holder_src := 'Guest sent this name next to the policy number';
      end if;
    end if;
  end if;
  r := ins_f(fl, unk, 'policy.holder', 'Name on the policy', 'policy', v_holder, coalesce(v_holder_src, 'none'), coalesce(v_holder_conf, 'stated'), 'The guest has not said whose name the policy is in'); fl := r->'fl'; unk := r->'unk';
  if v_claim is not null then
    r := ins_f(fl, unk, 'policy.claim_no', 'Insurer claim number', 'policy', v_claim, 'Insurer', 'stated', ''); fl := r->'fl'; unk := r->'unk';
  end if;

  -- driver and guest
  v_guest := nullif(btrim(coalesce(c->>'guest_first', t->>'guest_first', '') || ' ' || coalesce(c->>'guest_last', t->>'guest_last', '')), '');
  v_gphone := nullif(btrim(coalesce(t->>'guest_phone', '')), '');
  v_who := ins_ans(ans, 'Who was driving%');
  v_extra := ins_ans(ans, '%additional information%');
  v_drv := nullif(btrim(substring(coalesce(v_extra, '') from '(?i)driver\s*(?:was|is|:)?\s*([A-Za-z][A-Za-z''. -]{2,60})')), '');
  v_drv := nullif(btrim(regexp_replace(coalesce(v_drv, ''), '(?i)\s+(phone|number|cell|tel).*$', '')), '');
  if v_drv is not null then v_drv := initcap(lower(v_drv)); end if;
  v_drvphone := substring(coalesce(v_extra, '') from '(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})');
  if lower(coalesce(v_who, '')) = 'me' or lower(coalesce(v_who, '')) like 'the renter%' or lower(coalesce(v_who, '')) like 'i %' then
    v_drv := coalesce(v_drv, v_guest); v_drvphone := coalesce(v_drvphone, v_gphone);
  end if;
  r := ins_f(fl, unk, 'driver.name', 'Driver', 'people', v_drv, 'Guest damage report ("additional information")', 'stated', 'The report does not say who was driving'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'driver.phone', 'Driver phone', 'people', v_drvphone, 'Guest damage report ("additional information")', 'stated', 'No driver phone in the report'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'guest.name', 'Renter (Turo guest)', 'people', v_guest, 'Turo trip', 'stated', 'No guest name'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'guest.phone', 'Renter phone', 'people', v_gphone, 'Turo trip', 'stated', 'No guest phone on the trip'); fl := r->'fl'; unk := r->'unk';

  -- the car
  v_year := t->'raw'->'vehicle'->>'year'; v_make := t->'raw'->'vehicle'->>'make'; v_model := t->'raw'->'vehicle'->>'model';
  v_plate := t->'raw'->'vehicle'->'registration'->>'licensePlate'; v_pstate := t->'raw'->'vehicle'->'registration'->>'state';
  v_vin := coalesce(nullif(c->>'vin', ''), t->>'vin');
  r := ins_f(fl, unk, 'vehicle.year', 'Year', 'vehicle', v_year, 'Turo listing', 'stated', 'Not on the trip record'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'vehicle.make', 'Make', 'vehicle', v_make, 'Turo listing', 'stated', 'Not on the trip record'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'vehicle.model', 'Model', 'vehicle', v_model, 'Turo listing', 'stated', 'Not on the trip record'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'vehicle.plate', 'License plate', 'vehicle', v_plate, 'Turo listing', 'stated', 'Not on the trip record'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'vehicle.plate_state', 'Plate state', 'vehicle', v_pstate, 'Turo listing', 'stated', 'Not on the trip record'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'vehicle.vin', 'VIN', 'vehicle', v_vin, 'Turo trip', 'stated', 'No VIN on the case'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'vehicle.color', 'Color', 'vehicle', t->'raw'->'vehicle'->>'color', 'Turo listing', 'stated', 'Turo does not store the color. Left blank.'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'vehicle.drivable', 'Can the car be driven?', 'vehicle', ins_ans(ans, 'Is the car driveable%'), 'Guest damage report', 'stated', 'Not in the report'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'vehicle.location', 'Where the car is now', 'vehicle', ins_ans(ans, 'Where is the vehicle currently%'), 'Guest damage report', 'stated', 'Not in the report'); fl := r->'fl'; unk := r->'unk';

  -- the loss
  v_dt := ins_ans(ans, 'When did the incident occur%');
  v_date := case when v_dt ~ '^\d{1,2}/\d{1,2}/\d{4}$' then to_date(v_dt, 'MM/DD/YYYY')
                 when v_dt ~ '^\d{1,2}/\d{1,2}/\d{2}$' then to_date(v_dt, 'MM/DD/YY') end;
  r := ins_f(fl, unk, 'loss.date', 'Date it happened', 'loss', to_char(v_date, 'MM/DD/YYYY'), 'Guest damage report', 'stated', 'The report has no date'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.time', 'Time it happened', 'loss', null, 'none', 'stated', 'Turo only records the date. Left blank.'); fl := r->'fl'; unk := r->'unk';
  v_loc := ins_ans(ans, 'Where did the incident occur%');
  v_cityraw := ins_loc_part(v_loc, 'City');
  v_city := nullif(btrim(split_part(coalesce(v_cityraw, ''), ',', 1)), '');
  v_state := coalesce(ins_loc_part(v_loc, 'State'), nullif(upper(btrim(split_part(coalesce(v_cityraw, ''), ',', 2))), ''));
  r := ins_f(fl, unk, 'loss.address', 'Street where it happened', 'loss', ins_loc_part(v_loc, 'Street address'), 'Guest damage report', 'stated', 'The report has no street'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.city', 'City', 'loss', v_city, 'Guest damage report', 'stated', 'The report has no city'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.state', 'State', 'loss', v_state, 'Guest damage report', 'stated', 'The report has no state'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.zip', 'ZIP code', 'loss', ins_loc_part(v_loc, 'Postal code'), 'Guest damage report', 'stated', 'The report has no ZIP'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.type', 'What kind of loss', 'loss', ins_ans(ans, 'How was the damage caused%'), 'Guest damage report', 'stated', 'The report does not say'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.description', 'How it happened (guest''s words)', 'loss', ins_ans(ans, 'In your own words%'), 'Guest damage report', 'stated', 'The report has no description'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.damage', 'The damage (guest''s words)', 'loss', ins_ans(ans, 'Please describe the damage%'), 'Guest damage report', 'stated', 'The report has no damage description'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.parts', 'Parts damaged', 'loss', ins_ans(ans, 'What parts of the vehicle%'), 'Guest damage report', 'stated', 'The report does not list parts'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.injuries', 'Anyone hurt?', 'loss', ins_ans(ans, 'Was anyone injured%'), 'Guest damage report', 'stated', 'The report does not say'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.police', 'Police report?', 'loss', ins_ans(ans, 'Was a police report%'), 'Guest damage report', 'stated', 'The report does not say'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.airbags', 'Airbags out?', 'loss', ins_ans(ans, 'Did any airbags%'), 'Guest damage report', 'stated', 'The report does not say'); fl := r->'fl'; unk := r->'unk';
  r := ins_f(fl, unk, 'loss.other_party', 'Another person or car involved?', 'loss', ins_ans(ans, 'Was there another person%'), 'Guest damage report', 'stated', 'The report does not say'); fl := r->'fl'; unk := r->'unk';

  -- the Turo claim, which every insurer contact must disclose
  v_turo := nullif(btrim(coalesce(c->>'turo_claim_no', '')), '');
  if v_turo is not null then
    r := ins_f(fl, unk, 'turo.claim_no', 'Turo claim number', 'turo', v_turo, 'Turo', 'stated', ''); fl := r->'fl'; unk := r->'unk';
    r := ins_f(fl, unk, 'turo.disclosure', 'Other claim on this loss', 'turo', 'Turo opened claim ' || v_turo || ' (reservation ' || coalesce(c->>'reservation_id', '') || ') for this same loss. The car is a Turo rental owned by ' || coalesce(s->>'owner_name', 'the owner') || '.', 'Turo', 'stated', ''); fl := r->'fl'; unk := r->'unk';
  end if;

  -- the estimate (used in adjuster mail, never typed into the first form)
  v_amount := coalesce(nullif(est->>'amount', '')::numeric, nullif(c->>'estimate_amount', '')::numeric);
  v_final := coalesce((est->>'final')::boolean, false);
  if v_amount is not null then
    r := ins_f(fl, unk, 'estimate.amount', case when v_final then 'Repair estimate (final)' else 'Repair estimate (not final)' end, 'estimate',
               to_char(v_amount, 'FM999,999,990.00'), case when v_final then 'Snapsheet' else 'Shop estimate' end, 'stated', ''); fl := r->'fl'; unk := r->'unk';
  else
    unk := unk || jsonb_build_array(jsonb_build_object('key', 'estimate.amount', 'label', 'Repair estimate', 'group', 'estimate', 'why', 'Snapsheet has not finalized it yet. Sent to the adjuster once it is.'));
  end if;

  for e in select x from jsonb_array_elements(fl) x loop
    v_vals := v_vals || jsonb_build_object(e->>'key', e->>'value');
  end loop;

  return jsonb_build_object(
    'version', 1,
    'insurer_slug', f->>'insurer_slug',
    'fields', fl, 'values', v_vals, 'unknown', unk,
    'inferred', (select coalesce(jsonb_agg(x->>'key'), '[]'::jsonb) from jsonb_array_elements(fl) x where x->>'confidence' = 'inferred'),
    'photos', ph,
    'estimate_final', v_final,
    'hash', md5(v_vals::text || '|' || (select coalesce(string_agg(x->>'key', ',' order by x->>'key'), '') from jsonb_array_elements(unk) x)));
end $$;

-- Gathers the rows and builds the packet for one claim_cases row. p_oc is optional so a dry run can build one for any case.
create or replace function public.ins_build_packet(p_case uuid, p_oc uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c claim_cases; t turo_trips; oc outside_claims; s ins_settings; v_msg text; v_est jsonb; v_ph jsonb;
begin
  select * into c from claim_cases where id = p_case;
  if c.id is null then return jsonb_build_object('error', 'no such case'); end if;
  select * into t from turo_trips where reservation_id = c.reservation_id limit 1;
  select * into oc from outside_claims where (id = p_oc) or (p_oc is null and case_id = p_case and kind = 'guest_insurer') limit 1;
  select * into s from ins_settings where id;
  select e.detail->>'body' into v_msg from claim_events e
   where e.case_id = c.id and e.kind = 'guest_msg' and e.detail->>'body' like '%' || coalesce(c.insurer->>'policy_no', '~~none~~') || '%'
   order by e.at desc limit 1;
  select jsonb_build_object('amount', (e.detail->>'amount')::numeric, 'final', true) into v_est
    from ins_events e where e.oc_id = oc.id and e.kind = 'estimate_final' and e.detail ? 'amount' order by e.at desc limit 1;
  select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) into v_ph from (select source, count(*) as n from ins_photos where oc_id = oc.id group by 1) q;
  return ins_packet_core(jsonb_build_object('case', to_jsonb(c), 'trip', to_jsonb(t), 'settings', to_jsonb(s), 'oc', to_jsonb(oc), 'policy_msg', v_msg,
           'estimate', coalesce(v_est, '{}'::jsonb), 'photos', coalesce(v_ph, '{}'::jsonb),
           'insurer_slug', coalesce(oc.insurer_slug, ins_registry_find(c.insurer->>'name'))));
end $$;

-- ============================================================================================================================
-- 6. Opening a case, the job queue, and moving a case one step at a time (ins_advance is idempotent; cron and triggers both call it)
-- ============================================================================================================================
create or replace function public.ins_queue(p_oc uuid, p_kind text, p_runner text, p_payload jsonb default '{}'::jsonb, p_dry boolean default false, p_window integer default 900) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from ins_jobs
   where oc_id = p_oc and kind = p_kind and status in ('queued', 'claimed')
     and coalesce(payload->>'draft_id', '') = coalesce(p_payload->>'draft_id', '') and dry = p_dry
   limit 1;
  if v is not null then return v; end if;
  insert into ins_jobs (oc_id, kind, runner, payload, dry, window_s) values (p_oc, p_kind, p_runner, coalesce(p_payload, '{}'::jsonb), p_dry, p_window) returning id into v;
  return v;
end $$;

-- Backfill: replay the Turo/Snapsheet mail already on the case so the timeline starts complete. Defined in section 8.
create or replace function public.ins_open_case(p_case uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c claim_cases; v_ins jsonb; v_name text; v_oc uuid; v_slug text; v_reg text; v_dom text; v_title text; m bestly_mail;
begin
  select * into c from claim_cases where id = p_case;
  if c.id is null then return null; end if;
  v_ins := coalesce(c.insurer, '{}'::jsonb);
  v_name := nullif(btrim(coalesce(v_ins->>'name', '')), '');
  if v_name is null then return null; end if;

  select id into v_oc from outside_claims where case_id = c.id and kind = 'guest_insurer';
  if v_oc is not null then
    update outside_claims set policy_no = coalesce(policy_no, nullif(v_ins->>'policy_no', '')),
           claim_no = coalesce(claim_no, nullif(v_ins->>'claim_no', '')), updated_at = now()
     where id = v_oc and (policy_no is null or claim_no is null);
    return v_oc;
  end if;
  if not coalesce((select enabled from ins_settings where id), false) then return null; end if;   -- rollout switch

  v_reg := ins_registry_find(v_name);
  select coalesce(match_domains[1], '') into v_dom from ins_insurers where slug = v_reg;
  v_slug := 'ins-' || c.reservation_id;
  v_title := v_name || ' claim for ' || coalesce(nullif(btrim(coalesce(c.guest_first, '') || ' ' || coalesce(c.guest_last, '')), ''), 'the guest') || '''s trip';
  insert into outside_claims (slug, title, insurer, reply_domain, owner_slug, status, emails_sent, kind, case_id, reservation_id, insurer_slug,
                              policy_no, claim_no, ins_stage, if_no_reply)
  values (v_slug, v_title, v_name, coalesce(v_dom, ''), 'claims-closer', 'waiting', 0, 'guest_insurer', c.id, c.reservation_id, v_reg,
          nullif(v_ins->>'policy_no', ''), nullif(v_ins->>'claim_no', ''), 'new',
          'Nudge the adjuster after 2 business days, then queue a bridge call')
  on conflict (slug) do nothing
  returning id into v_oc;
  if v_oc is null then select id into v_oc from outside_claims where slug = v_slug; end if;

  perform ins_event(v_oc, 'opened', 'Opened the ' || v_name || ' claim for ' || coalesce(c.guest_first, 'the guest') || '''s trip (reservation ' || c.reservation_id || ')',
                    jsonb_build_object('policy_no', v_ins->>'policy_no', 'registry', v_reg));
  -- replay the claim mail already stored for this reservation (Snapsheet started, estimate, payment steps)
  for m in select b.* from bestly_mail b join claim_events e on e.mail_id = b.id
            where e.case_id = c.id and e.kind = 'mail' order by b.sent_at loop
    begin perform ins_turo_mail(m); exception when others then null; end;
  end loop;
  perform ins_advance(v_oc);
  return v_oc;
end $$;

-- Cases that gained an insurer while the filer was off, or whose trigger was missed.
create or replace function public.ins_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_open int := 0; v_adv int := 0; o record;
begin
  if not coalesce((select enabled from ins_settings where id), false) then return jsonb_build_object('enabled', false); end if;
  for c in select cc.id from claim_cases cc
            where nullif(btrim(coalesce(cc.insurer->>'name', '')), '') is not null and not coalesce(cc.history, false)
              and not exists (select 1 from outside_claims x where x.case_id = cc.id and x.kind = 'guest_insurer') loop
    begin if ins_open_case(c.id) is not null then v_open := v_open + 1; end if; exception when others then null; end;
  end loop;
  for o in select id from outside_claims where kind = 'guest_insurer' and status <> 'closed' loop
    begin perform ins_advance(o.id); v_adv := v_adv + 1; exception when others then null; end;
  end loop;
  return jsonb_build_object('enabled', true, 'opened', v_open, 'advanced', v_adv);
end $$;

-- Triggers: a new claim_events 'insurer' row, or a case gaining an insurer, opens the case. Wrapped so they can never break Claims Closer.
create or replace function public.ins_claim_event_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'insurer' and new.case_id is not null then
    begin perform ins_open_case(new.case_id); exception when others then null; end;
  end if;
  return null;
end $$;
drop trigger if exists ins_claim_event_trg on public.claim_events;
create trigger ins_claim_event_trg after insert on public.claim_events for each row execute function public.ins_claim_event_trg();

create or replace function public.ins_case_insurer_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(coalesce(new.insurer->>'name', '')), '') is not null and new.insurer is distinct from old.insurer then
    begin perform ins_open_case(new.id); exception when others then null; end;
  end if;
  return null;
end $$;
drop trigger if exists ins_case_insurer_trg on public.claim_cases;
create trigger ins_case_insurer_trg after update of insurer on public.claim_cases for each row execute function public.ins_case_insurer_trg();

-- After the photos step: pick the filing path by the insurer's registry method.
create or replace function public.ins_start_filing(p_oc uuid) returns text
language plpgsql security definer set search_path = public as $$
declare oc outside_claims; reg ins_insurers; s ins_settings; pk jsonb; v_job uuid; v_draft uuid;
begin
  select * into oc from outside_claims where id = p_oc;
  select * into reg from ins_insurers where slug = oc.insurer_slug and enabled;
  select * into s from ins_settings where id;
  pk := ins_build_packet(oc.case_id, oc.id);
  update outside_claims set packet = pk, packet_hash = pk->>'hash',
         photo_set = (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from ins_photos where oc_id = oc.id group by 1) q),
         updated_at = now() where id = oc.id;
  if reg.slug is null then
    update outside_claims set ins_stage = 'needs_contact', updated_at = now() where id = oc.id;
    perform ins_event(oc.id, 'needs_contact', 'No claims contact for ' || oc.insurer || ' yet', jsonb_build_object('why', 'unknown insurer'));
    perform ins_notify('I need a claims contact for ' || oc.insurer, 'The guest''s insurer is not in my list. Add its claims phone or email and I will take it from there.', 'https://bestly.tech/admin', 'ins-contact-' || oc.id);
    return 'needs_contact';
  elsif reg.method = 'web' and reg.filer is not null then
    v_job := ins_queue(oc.id, 'fill', 'mac', jsonb_build_object('packet_hash', pk->>'hash', 'insurer', reg.slug, 'filer', reg.filer, 'claim_url', reg.claim_url), false, 1500);
    update outside_claims set ins_stage = 'filling', updated_at = now() where id = oc.id;
    perform ins_event(oc.id, 'filling', 'Filling in the ' || reg.name || ' claim form (it will stop before sending)');
    return 'filling';
  elsif reg.method = 'email' and reg.email is not null then
    insert into ins_drafts (oc_id, kind, to_addr, subject, body, status)
    values (oc.id, 'first_email', reg.email, 'New auto claim, ' || coalesce(pk->'values'->>'vehicle.year', '') || ' ' || coalesce(pk->'values'->>'vehicle.make', '') || ' ' || coalesce(pk->'values'->>'vehicle.model', '') || ', policy ' || coalesce(oc.policy_no, ''),
            '', 'writing') returning id into v_draft;
    update outside_claims set ins_stage = 'emailing', updated_at = now() where id = oc.id;
    perform ins_event(oc.id, 'emailing', 'Writing the first email to ' || reg.name);
    return 'emailing';
  else
    -- phone-only: the call is Jared's tap (the errand shows Call now). Ava bridges to his cell.
    perform ins_make_errand(oc.id, 'open the claim');
    update outside_claims set ins_stage = 'needs_contact', updated_at = now() where id = oc.id;
    return 'call';
  end if;
end $$;

-- The bridge errand: a normal ava_errands row (so Pipeline shows it too). details starts with [bridge] so the page dials in bridge mode.
create or replace function public.ins_make_errand(p_oc uuid, p_why text) returns uuid
language plpgsql security definer set search_path = public as $$
declare oc outside_claims; reg ins_insurers; v_err uuid; v_phone text; v_who text; v_details text; v_title text;
begin
  select * into oc from outside_claims where id = p_oc;
  if oc.errand_id is not null then return oc.errand_id; end if;
  select * into reg from ins_insurers where slug = oc.insurer_slug;
  v_phone := ins_digits(coalesce(nullif(oc.adjuster_phone, ''), reg.phone));
  if coalesce(v_phone, '') !~ '^\d{10}$' then return null; end if;
  v_who := coalesce(nullif(oc.adjuster_name, ''), reg.name, oc.insurer) || case when oc.adjuster_name is not null then ', ' || oc.insurer else ' claims' end;
  v_title := 'Call ' || oc.insurer || ' about claim ' || coalesce(oc.claim_no, '(not numbered yet)');
  v_details := '[bridge] Ava calls the main line, gets a person, then hands the call to Jared. Goal: ' || p_why || '. '
    || 'Claim ' || coalesce(oc.claim_no, 'not numbered yet') || ', policy ' || coalesce(oc.policy_no, 'unknown') || '. '
    || 'Loss: Tesla Model 3 hit a barrier in San Diego on 10/26/2026, driver ' || coalesce(oc.driver_name, 'unknown') || '. '
    || 'Turo claim ' || coalesce((select turo_claim_no from claim_cases where id = oc.case_id), 'none') || ' is open for the same loss.';
  insert into ava_errands (title, who, phone, details, due_by)
  values (left(v_title, 200), left(v_who, 200), v_phone, left(v_details, 2000), (ins_next_biz_open(now()) at time zone 'America/Los_Angeles')::date)
  returning id into v_err;
  update outside_claims set errand_id = v_err, status = 'escalated', escalated_at = now(), updated_at = now() where id = oc.id;
  perform ins_event(oc.id, 'errand', 'Queued a call to ' || oc.insurer || ' (Ava gets a person, then hands the call to Jared)', jsonb_build_object('errand_id', v_err, 'why', p_why));
  return v_err;
end $$;

create or replace function public.ins_advance(p_oc uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  oc outside_claims; s ins_settings; pk jsonb; v_pending integer; v_since timestamptz; v_stage text;
begin
  select * into s from ins_settings where id;
  if not coalesce(s.enabled, false) then return 'off'; end if;
  select * into oc from outside_claims where id = p_oc and kind = 'guest_insurer' for update;
  if oc.id is null or oc.status = 'closed' then return 'none'; end if;

  if oc.ins_stage is null or oc.ins_stage = 'new' then
    pk := ins_build_packet(oc.case_id, oc.id);
    update outside_claims set packet = pk, packet_hash = pk->>'hash', ins_stage = 'photos', updated_at = now() where id = oc.id;
    perform ins_queue(oc.id, 'copy_evidence', 'edge', '{}'::jsonb, false, 600);
    perform ins_queue(oc.id, 'photos', 'pi', '{}'::jsonb, false, 1800);
    perform ins_event(oc.id, 'photos', 'Gathering the photos');
    return 'photos';
  end if;

  if oc.ins_stage = 'photos' then
    select count(*), min(created_at) into v_pending, v_since from ins_jobs
     where oc_id = oc.id and kind in ('copy_evidence', 'photos') and status in ('queued', 'claimed');
    if v_pending = 0 or exists (select 1 from ins_jobs where oc_id = oc.id and kind in ('copy_evidence', 'photos')
                                  and status in ('queued', 'claimed') and created_at < now() - make_interval(mins => s.photo_wait_minutes)) then
      return ins_start_filing(oc.id);
    end if;
    return 'waiting_photos';
  end if;

  -- The facts changed since the form was filled (a new reply, a claim number): the old approval is stale. Fill again.
  if oc.ins_stage in ('filling', 'needs_approval') then
    pk := ins_build_packet(oc.case_id, oc.id);
    if pk->>'hash' is distinct from oc.packet_hash then
      update ins_approvals set status = 'superseded' where oc_id = oc.id and kind = 'file_claim' and status = 'pending';
      update outside_claims set packet = pk, packet_hash = pk->>'hash', ins_stage = 'photos', updated_at = now() where id = oc.id;
      perform ins_event(oc.id, 'refill', 'The facts changed, so I am filling the form again');
      return ins_start_filing(oc.id);
    end if;
  end if;

  if oc.ins_stage = 'filed' then
    -- a finished call counts as our last outreach; the clock starts again
    if oc.errand_id is not null and exists (select 1 from ava_errands e where e.id = oc.errand_id and e.status in ('done', 'cancelled')) then
      update outside_claims set last_outbound_at = greatest(coalesce(last_outbound_at, now()), coalesce((select done_at from ava_errands where id = oc.errand_id), now())),
             errand_id = null, status = 'waiting',
             reply_due_at = ins_add_biz(now(), (select nudge_business_days from ins_settings where id)), updated_at = now() where id = oc.id;
      perform ins_event(oc.id, 'call_done', 'The call to ' || oc.insurer || ' is done. The clock starts again.');
    else
      perform ins_follow_up(oc.id);
    end if;
  end if;
  return coalesce(oc.ins_stage, 'new');
end $$;

-- A claim number exists: filed, the Turo reply is drafted, the Tesla Service message becomes available.
create or replace function public.ins_set_claim_no(p_oc uuid, p_no text, p_via text) returns boolean
language plpgsql security definer set search_path = public as $$
declare oc outside_claims; c claim_cases; v_no text := nullif(btrim(coalesce(p_no, '')), '');
begin
  select * into oc from outside_claims where id = p_oc;
  if oc.id is null or v_no is null then return false; end if;
  if oc.claim_no is not distinct from v_no and oc.ins_stage = 'filed' then return false; end if;
  update outside_claims set claim_no = v_no, filed_at = coalesce(filed_at, now()), ins_stage = 'filed', status = 'waiting',
         last_outbound_at = coalesce(last_outbound_at, now()), emails_sent = greatest(emails_sent, 1),
         reply_due_at = ins_add_biz(coalesce(last_outbound_at, now()), (select nudge_business_days from ins_settings where id)), updated_at = now()
   where id = oc.id;
  select * into c from claim_cases where id = oc.case_id;
  if c.id is not null then
    update claim_cases set insurer = coalesce(insurer, '{}'::jsonb) || jsonb_build_object('claim_no', v_no), updated_at = now() where id = c.id;
  end if;
  perform ins_event(oc.id, 'filed', oc.insurer || ' claim number ' || v_no || ' (' || coalesce(p_via, 'filed') || ')', jsonb_build_object('claim_no', v_no, 'via', p_via));
  perform ins_draft_turo_reply(oc.id);
  return true;
end $$;

-- ============================================================================================================================
-- 7. Mail: insurer mail is matched by claim number, then policy number, then the insurer's domain (the same idea as the Turo matcher).
-- ============================================================================================================================
create or replace function public.ins_match_mail(p_from text, p_subject text, p_body text) returns table (oc_id uuid, matched_by text)
language sql stable security definer set search_path = public as $$
  with t as (select lower(coalesce(p_subject, '') || ' ' || coalesce(p_body, '')) as txt, lower(coalesce(p_from, '')) as frm),
  open_oc as (select o.* from outside_claims o where o.kind = 'guest_insurer' and o.status <> 'closed'),
  cand as (
    select o.id, 'claim_no'::text as mb, 1 as rk from open_oc o, t where nullif(o.claim_no, '') is not null and strpos(t.txt, lower(o.claim_no)) > 0
    union all
    select o.id, 'policy', 2 from open_oc o, t where nullif(o.policy_no, '') is not null and strpos(t.txt, lower(o.policy_no)) > 0
    union all
    -- domain only: the insurer's mail that is about a claim (never marketing, never a no-reply with no claim words)
    select o.id, 'domain', 3 from open_oc o, t, ins_insurers i
     where i.slug = o.insurer_slug and t.txt ~ '(claim|adjuster|estimate|damage|accident|loss|photos|vehicle|collision)'
       and t.frm !~ '(no-?reply|donotreply|marketing|newsletter)'
       and exists (select 1 from unnest(i.match_domains) d where t.frm ~ ('@([a-z0-9-]+\.)*' || replace(d, '.', '\.') || '>?\s*$'))
    union all
    select o.id, 'domain', 3 from open_oc o, t
     where nullif(o.adjuster_email, '') is not null and t.frm like '%' || lower(split_part(o.adjuster_email, '@', 2)) || '%'
       and split_part(o.adjuster_email, '@', 2) <> '' and t.frm !~ '(no-?reply|donotreply)'
  )
  select c.id, c.mb from cand c
   where c.rk = (select min(rk) from cand)
     and (select count(distinct id) from cand where rk = (select min(rk) from cand)) = 1
   limit 1
$$;

-- A claim number out of free text. Turo's own claim number ("Turo claim 1108308") is cut out first; it must contain a digit.
create or replace function public.ins_claim_no_from_text(p_txt text) returns text
language sql immutable set search_path = public as $$
  select case when x ~ '\d' then x end from (
    select substring(regexp_replace(coalesce(p_txt, ''), '(?i)turo\s+claim\s*(?:no\.?|number|#|id)?\s*:?\s*#?\s*\d+', ' ', 'g')
                     from '(?i)claim\s*(?:number|no\.?|#|id)?\s*(?:is|:)?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{5,16})') as x) q
$$;

create or replace function public.ins_is_noreply(p text) returns boolean
language sql immutable set search_path = public as $$ select lower(coalesce(p, '')) ~ '(no-?reply|donotreply|do-not-reply|mailer-daemon|notifications?@)' $$;

create or replace function public.ins_mail_seen(m bestly_mail) returns void
language plpgsql security definer set search_path = public as $$
declare
  mt record; oc outside_claims; v_txt text; v_no text; v_phone text; v_n integer; v_to text; v_subj text; v_draft uuid;
begin
  if not coalesce((select enabled from ins_settings where id), false) then return; end if;
  if coalesce(m.from_addr, '') ~* 'turo\.com' then perform ins_turo_mail(m); return; end if;
  if coalesce(m.from_addr, '') ~* '@bestly\.tech' then return; end if;     -- our own mail never counts as theirs

  select * into mt from ins_match_mail(m.from_addr, m.subject, m.body_text);
  if mt.oc_id is null then return; end if;
  insert into ins_mail_links (mail_id, oc_id, matched_by) values (m.id, mt.oc_id, mt.matched_by) on conflict (mail_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;                                            -- already handled

  select * into oc from outside_claims where id = mt.oc_id for update;
  v_subj := regexp_replace(coalesce(m.subject, ''), '\s+', ' ', 'g');
  v_txt := coalesce(m.body_text, '');
  update outside_claims set last_inbound_at = coalesce(m.sent_at, now()), replied_at = coalesce(m.sent_at, now()), reply_mail_id = m.id,
         status = case when status = 'escalated' then status else 'replied' end, updated_at = now() where id = oc.id;
  perform ins_event(oc.id, 'adjuster_mail', coalesce(oc.insurer, 'The insurer') || ' wrote: ' || left(v_subj, 140), jsonb_build_object('from', m.from_addr, 'matched_by', mt.matched_by), m.id, m.sent_at);

  -- a claim number in their mail
  v_no := ins_claim_no_from_text(v_txt || ' ' || v_subj);
  if v_no is not null and oc.claim_no is null
     and v_no is distinct from (select turo_claim_no from claim_cases where id = oc.case_id) then perform ins_set_claim_no(oc.id, v_no, 'from their email'); end if;

  -- the adjuster: a person's mailbox on the insurer's side
  if not ins_is_noreply(m.from_addr) and (oc.adjuster_email is null or lower(oc.adjuster_email) = lower(m.from_addr)) then
    v_phone := substring(v_txt from '(?i)(?:phone|direct|office|cell|tel|call)[^0-9]{0,20}(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,6})?)');
    update outside_claims set adjuster_email = lower(m.from_addr), adjuster_name = coalesce(nullif(m.from_name, ''), adjuster_name),
           adjuster_phone = coalesce(v_phone, adjuster_phone), updated_at = now() where id = oc.id;
    if oc.adjuster_email is null then
      perform ins_event(oc.id, 'adjuster', 'Adjuster: ' || coalesce(nullif(m.from_name, ''), m.from_addr), jsonb_build_object('email', lower(m.from_addr), 'phone', v_phone));
      perform ins_draft_turo_reply(oc.id, true);
    end if;
  end if;

  if m.has_attach then perform ins_queue(oc.id, 'attach_fetch', 'mac', jsonb_build_object('message_id', m.message_id, 'subject', v_subj, 'mail_id', m.id, 'from', m.from_addr), false, 900); end if;

  -- a reply is drafted by the edge function (free AI) and waits for one tap. No-reply senders only get a note.
  if not ins_is_noreply(m.from_addr) then
    v_to := lower(coalesce(m.from_addr, ''));
    insert into ins_drafts (oc_id, kind, to_addr, subject, body, in_reply_to_mail, status)
    values (oc.id, 'adjuster_reply', v_to, case when v_subj ~* '^re:' then left(v_subj, 200) else 'Re: ' || left(v_subj, 200) end, '', m.id, 'writing')
    returning id into v_draft;
    perform ins_event(oc.id, 'drafting', 'Writing a reply to ' || coalesce(nullif(m.from_name, ''), m.from_addr), jsonb_build_object('draft_id', v_draft));
    begin perform invoke_edge_function('insurance-filer', jsonb_build_object('op', 'tick'), 90000); exception when others then null; end;
  end if;
end $$;

create or replace function public.ins_mail_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform ins_mail_seen(new); exception when others then null; end;
  return null;
end $$;
-- Named so it fires after claims_mail_trg (triggers run in name order): Claims Closer's case exists before the Turo mail is parsed here.
drop trigger if exists ins_mail_trg on public.bestly_mail;
create trigger ins_mail_trg after insert on public.bestly_mail for each row execute function public.ins_mail_trg();

-- ============================================================================================================================
-- 8. Turo and Snapsheet mail on the case timeline (reads the same way claims_mail_seen does: reservation, else Turo claim number)
-- ============================================================================================================================
create or replace function public.ins_turo_mail(m bestly_mail) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res bigint; oc outside_claims; v_subj text := regexp_replace(coalesce(m.subject, ''), '\s+', ' ', 'g'); v_body text := coalesce(m.body_text, '');
  v_txt text; v_amt numeric; v_hr numeric; v_pay text;
begin
  v_res := coalesce(claims_res_from_mail(v_subj, v_body), claims_res_from_claim_no(v_subj, v_body));
  if v_res is null then return; end if;
  select * into oc from outside_claims where reservation_id = v_res and kind = 'guest_insurer' limit 1;
  if oc.id is null then return; end if;
  v_txt := v_subj || ' ' || v_body;

  if v_txt ~* 'snapsheet' and v_txt ~* '(apprais)' and v_txt ~* '(submitted|begin|start|began|underway)' then
    perform ins_event(oc.id, 'appraisal_started', 'Turo sent your photos to Snapsheet. The appraisal has started.', jsonb_build_object('source', 'Turo'), m.id, m.sent_at);
  end if;

  if v_txt ~* 'estimate' and v_txt ~* '(finaliz|has been completed|is ready|is complete|final estimate)' and v_txt !~* 'once we receive the estimate' then
    v_amt := nullif(replace(substring(v_body from '(?i)estimate[^$]{0,160}\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)'), ',', ''), '')::numeric;
    perform ins_event(oc.id, 'estimate_final', case when v_amt is not null then 'Snapsheet finalized the estimate: ' || stuck_money(v_amt) else 'Snapsheet finalized the estimate' end,
                      jsonb_build_object('amount', v_amt, 'source', 'Snapsheet'), m.id, m.sent_at);
    if m.has_attach then perform ins_queue(oc.id, 'attach_fetch', 'mac', jsonb_build_object('message_id', m.message_id, 'subject', v_subj, 'mail_id', m.id, 'from', m.from_addr, 'estimate', true), false, 900); end if;
  end if;

  if v_txt ~* 'payment' and v_txt ~* '(instruction|how to receive|payment method|direct deposit|select how)' then
    perform ins_event(oc.id, 'payment_instructions', 'Turo sent payment instructions', jsonb_build_object('source', 'Turo'), m.id, m.sent_at);
  end if;
  if v_txt ~* '(has been (sent|issued|deposited)|we.ve (sent|issued)|issued a payment|payment of)' and v_txt !~* '(reimbursement invoice|incidental charges|on-trip charging|supercharg)' then
    v_amt := nullif(replace(substring(v_body from '(?i)(?:payment|payout|reimbursement|deposit)[^$]{0,80}\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)'), ',', ''), '')::numeric;
    if v_amt is not null then
      insert into ins_amounts (oc_id, source, amount, note, confirmed, mail_id, at)
      values (oc.id, 'turo', v_amt, 'From a Turo email. Not confirmed until you check your deposit.', false, m.id, coalesce(m.sent_at, now())) on conflict do nothing;
      perform ins_event(oc.id, 'turo_payment', 'Turo says a payment of ' || stuck_money(v_amt) || ' was issued', jsonb_build_object('amount', v_amt), m.id, m.sent_at);
    end if;
  end if;

  if v_txt ~* 'claims associate will review' then
    perform ins_event(oc.id, 'turo_review', 'Turo: a Claims Associate will review it within 1 to 2 business days', null, m.id, m.sent_at);
  end if;
  if v_txt ~* 'crashbay' then
    perform ins_event(oc.id, 'turo_network', 'Turo mentioned its CrashBay repair network', null, m.id, m.sent_at);
  end if;
  if v_txt ~* 'tesla-certified' then
    update outside_claims set internal = coalesce(internal, '{}'::jsonb) || jsonb_build_object('tesla_certified_required', true) where id = oc.id;
  end if;
  -- Turo's own words about what the host owes. Internal only: shown on the card, never put in a packet, a form or an email.
  v_hr := nullif(replace(substring(v_body from '(?i)damage responsibility[^0-9$]{0,40}\$?\s?([0-9][0-9,]*(?:\.[0-9]{2})?)'), ',', ''), '')::numeric;
  if v_hr is not null then
    update outside_claims set internal = coalesce(internal, '{}'::jsonb) || jsonb_build_object('host_responsibility_seen', v_hr) where id = oc.id;
  end if;
end $$;

-- ============================================================================================================================
-- 9. Drafts: the Turo reply, nudges, adjuster replies. Every one waits for a tap. Signed "Claims Closer".
-- ============================================================================================================================
create or replace function public.ins_pick_attachments(p_oc uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; out jsonb := '[]'::jsonb; total integer := 0; n integer := 0;
begin
  for r in select p.id, p.source, p.bytes, p.mime, p.storage_path from ins_photos p
            where p.oc_id = p_oc and p.source <> 'shot'
            order by case p.source when 'estimate_doc' then 0 when 'after' then 1 when 'guest_report' then 2 when 'return' then 3 when 'checkin' then 4 else 5 end, p.created_at loop
    exit when n >= 10;
    continue when total + coalesce(r.bytes, 0) > 8000000 and r.source <> 'estimate_doc';
    n := n + 1; total := total + coalesce(r.bytes, 0);
    out := out || jsonb_build_array(jsonb_build_object('photo_id', r.id, 'bytes', r.bytes, 'source', r.source,
             'name', case when r.source = 'estimate_doc' then 'repair-estimate' else 'damage-photo-' || n end || case when r.mime = 'application/pdf' then '.pdf' else '.jpg' end));
  end loop;
  return out;
end $$;

create or replace function public.ins_draft_guard(p_oc uuid, p_body text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_hr numeric;
begin
  select (internal->>'host_responsibility_seen')::numeric into v_hr from outside_claims where id = p_oc;
  if p_body ~* '(host (damage )?responsibility|damage responsibility|deductible|out.of.pocket|protection plan|max earn|earn plan)' then
    return 'It mentions Turo plan terms. Those stay internal.';
  end if;
  if v_hr is not null and p_body like '%' || to_char(v_hr, 'FM999,999') || '%' then return 'It contains the host damage responsibility amount. That stays internal.'; end if;
  return null;
end $$;

-- A draft body is ready (written by the edge function with free AI, or by a template): park it for one tap.
create or replace function public.ins_draft_ready(p_draft uuid, p_subject text, p_body text, p_attach jsonb default null) returns text
language plpgsql security definer set search_path = public as $$
declare d ins_drafts; oc outside_claims; v_att jsonb; v_code text; v_problem text; v_summary jsonb;
begin
  select * into d from ins_drafts where id = p_draft for update;
  if d.id is null or d.status not in ('writing', 'draft') then return null; end if;
  select * into oc from outside_claims where id = d.oc_id;
  v_problem := ins_draft_guard(d.oc_id, coalesce(p_body, ''));
  if v_problem is not null then
    update ins_drafts set status = 'failed', error = v_problem, body = left(coalesce(p_body, ''), 6000) where id = d.id;
    perform ins_event(d.oc_id, 'draft_blocked', 'I stopped a draft: ' || v_problem, jsonb_build_object('draft_id', d.id));
    return null;
  end if;
  v_att := coalesce(p_attach, case when d.kind in ('adjuster_reply', 'first_email') then ins_pick_attachments(d.oc_id) else '[]'::jsonb end);
  update ins_drafts set subject = left(coalesce(nullif(btrim(p_subject), ''), subject), 300), body = left(p_body, 8000), attachments = v_att, status = 'awaiting' where id = d.id;
  select * into d from ins_drafts where id = p_draft;
  v_summary := jsonb_build_object('kind', d.kind, 'to', d.to_addr, 'cc', d.cc, 'subject', d.subject, 'body', d.body, 'attachments', d.attachments,
                                  'from', (select owner_email from ins_settings where id), 'about', oc.title);
  v_code := ins_approval_create(d.oc_id, 'send_mail',
              case d.kind when 'turo_reply' then 'Reply to Turo with the claim number' when 'nudge' then 'Nudge the adjuster' when 'first_email' then 'First email to ' || oc.insurer else 'Reply to ' || oc.insurer end,
              v_summary, null, d.id, md5(d.subject || '|' || d.body || '|' || d.attachments::text));
  update ins_drafts set approval_id = (select id from ins_approvals where code = v_code) where id = d.id;
  return v_code;
end $$;

create or replace function public.ins_sig() returns text
language sql immutable as $$ select E'Thank you,\nClaims Closer, for Jared Best' $$;

create or replace function public.ins_draft_turo_reply(p_oc uuid, p_adjuster_update boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  oc outside_claims; c claim_cases; v_to text; v_subj text; v_body text; v_id uuid; v_contact text; v_already boolean;
begin
  select * into oc from outside_claims where id = p_oc;
  select * into c from claim_cases where id = oc.case_id;
  if oc.id is null or c.id is null or oc.claim_no is null then return null; end if;
  select exists (select 1 from ins_drafts where oc_id = oc.id and kind = 'turo_reply' and status in ('writing', 'draft', 'awaiting', 'approved', 'sending')) into v_already;
  if v_already then return null; end if;
  -- an adjuster update only goes if a first reply already went without one
  if p_adjuster_update and not exists (select 1 from ins_drafts where oc_id = oc.id and kind = 'turo_reply' and status = 'sent') then return null; end if;
  if not p_adjuster_update and exists (select 1 from ins_drafts where oc_id = oc.id and kind = 'turo_reply' and status = 'sent') then return null; end if;
  select b.from_addr, b.subject into v_to, v_subj
    from claim_events e join bestly_mail b on b.id = e.mail_id
   where e.case_id = c.id and e.detail->>'kind' = 'claim_mail' and b.from_addr ~* 'turo\.com' order by e.at desc limit 1;
  if v_to is null then v_to := 'support@claims.turo.com'; v_subj := 'Turo claim ' || coalesce(c.turo_claim_no, ''); end if;
  v_contact := case when oc.adjuster_email is not null or oc.adjuster_phone is not null
      then 'Adjuster: ' || coalesce(nullif(oc.adjuster_name, ''), 'name not given') || ', ' || coalesce(oc.adjuster_email, 'no email yet') || ', ' || coalesce(oc.adjuster_phone, 'no phone yet') || '.'
      else oc.insurer || ' has not assigned an adjuster yet. I will send the contact as soon as I have it.' end;
  v_body := 'Hello Turo Claims team,' || E'\n\n'
    || 'This is about Turo claim ' || coalesce(c.turo_claim_no, '') || ' (reservation ' || c.reservation_id || ').' || E'\n'
    || 'The guest''s own insurer is ' || oc.insurer || '. ' || oc.insurer || ' claim number: ' || oc.claim_no || '.' || E'\n'
    || v_contact || E'\n\n' || ins_sig();
  insert into ins_drafts (oc_id, kind, to_addr, subject, body, status) values (oc.id, 'turo_reply', lower(v_to), case when v_subj ~* '^re:' then v_subj else 'Re: ' || v_subj end, v_body, 'draft')
  returning id into v_id;
  perform ins_draft_ready(v_id, null, v_body, '[]'::jsonb);
  return v_id;
end $$;

create or replace function public.ins_make_nudge(p_oc uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare oc outside_claims; c claim_cases; v_id uuid; v_first text; v_body text; v_when text;
begin
  select * into oc from outside_claims where id = p_oc;
  select * into c from claim_cases where id = oc.case_id;
  if oc.adjuster_email is null or oc.claim_no is null then return null; end if;
  v_first := nullif(split_part(btrim(coalesce(oc.adjuster_name, '')), ' ', 1), '');
  v_when := to_char(oc.last_outbound_at at time zone 'America/Los_Angeles', 'FMMonth FMDD');
  v_body := 'Hello ' || coalesce(v_first, 'there') || ',' || E'\n\n'
    || 'I am following up on ' || oc.insurer || ' claim ' || oc.claim_no || '. I last wrote on ' || v_when || '. Could you tell me who is handling it and what you still need from me? I can send photos, the damage details or the repair estimate right away.' || E'\n\n'
    || coalesce('Turo also has a claim open for the same loss (Turo claim ' || c.turo_claim_no || ').' || E'\n\n', '')
    || ins_sig();
  insert into ins_drafts (oc_id, kind, to_addr, subject, body, status) values (oc.id, 'nudge', oc.adjuster_email, 'Claim ' || oc.claim_no || ': checking in', v_body, 'draft')
  returning id into v_id;
  perform ins_draft_ready(v_id, null, v_body, '[]'::jsonb);
  perform ins_event(oc.id, 'nudge', 'No reply for 2 business days. Wrote a nudge for your OK.', jsonb_build_object('draft_id', v_id));
  return v_id;
end $$;

-- Quiet adjuster: nudge after N business days; after a nudge goes quiet too, queue the bridge call. Never sends or dials by itself.
create or replace function public.ins_follow_up(p_oc uuid) returns text
language plpgsql security definer set search_path = public as $$
declare oc outside_claims; s ins_settings; v_nudge_sent timestamptz;
begin
  select * into oc from outside_claims where id = p_oc;
  select * into s from ins_settings where id;
  if oc.id is null or oc.ins_stage <> 'filed' or oc.last_outbound_at is null then return 'skip'; end if;
  if exists (select 1 from ins_drafts where oc_id = oc.id and status in ('writing', 'draft', 'awaiting', 'approved', 'sending') and kind in ('nudge', 'adjuster_reply')) then return 'draft_open'; end if;
  if oc.last_inbound_at is not null and oc.last_inbound_at > oc.last_outbound_at then return 'their_turn_is_over'; end if;   -- they wrote last; the reply is ours
  select max(sent_at) into v_nudge_sent from ins_drafts where oc_id = oc.id and kind = 'nudge' and status = 'sent';
  if v_nudge_sent is null then
    if now() >= ins_add_biz(oc.last_outbound_at, s.nudge_business_days) then
      if oc.adjuster_email is not null then perform ins_make_nudge(oc.id); return 'nudge';
      else perform ins_make_errand(oc.id, 'find out who is handling the claim and get an adjuster contact'); return 'errand_no_adjuster_email'; end if;
    end if;
  elsif oc.errand_id is null and now() >= ins_add_biz(v_nudge_sent, s.call_after_business_days) then
    perform ins_make_errand(oc.id, 'the adjuster has not answered two emails'); return 'errand';
  end if;
  return 'quiet_ok';
end $$;

-- ============================================================================================================================
-- 10. Approvals: one short link per decision. The page needs the signed-in admin and the hash it was shown; a changed packet makes it stale.
--     (No passkey step, unlike Ava's approvals: this is the owner tapping on his own claim. Flagged in the report.)
-- ============================================================================================================================
create or replace function public.ins_approval_create(p_oc uuid, p_kind text, p_title text, p_summary jsonb, p_job uuid, p_draft uuid, p_hash text) returns text
language plpgsql security definer set search_path = public as $$
declare
  a constant text := 'abcdefghjkmnpqrstuvwxyz23456789'; b bytea; v_code text; i integer; v_id uuid; oc outside_claims; v_body text;
begin
  select * into oc from outside_claims where id = p_oc;
  update ins_approvals set status = 'superseded'
   where oc_id = p_oc and kind = p_kind and status = 'pending' and draft_id is not distinct from p_draft;
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex'); v_code := 'i';
    for i in 0..5 loop v_code := v_code || substr(a, (get_byte(b, i) % 31) + 1, 1); end loop;
    exit when not exists (select 1 from ins_approvals where code = v_code);
  end loop;
  insert into ins_approvals (code, oc_id, kind, title, summary, hash, job_id, draft_id)
  values (v_code, p_oc, p_kind, left(p_title, 200), coalesce(p_summary, '{}'::jsonb), p_hash, p_job, p_draft) returning id into v_id;
  v_body := case p_kind
    when 'file_claim' then 'The ' || oc.insurer || ' claim form is filled in and ready. Nothing has been sent. Tap to look it over and send it.'
    else p_title || ' is written and ready. Tap to read it and send it.' end;
  update ins_approvals set push_sent_at = now() where id = v_id and ins_notify(p_title, v_body, 'https://bestly.tech/y/' || v_code, 'ins-approval-' || v_code) <> 'off';
  perform ins_event(p_oc, 'approval', 'Waiting for your OK: ' || p_title, jsonb_build_object('code', v_code, 'kind', p_kind));
  return v_code;
end $$;

create or replace function public.ins_approval_get(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a ins_approvals; oc outside_claims; d ins_drafts; v_stale boolean := false; v_pk jsonb;
begin
  perform public.admin_require_admin();
  select * into a from ins_approvals where code = lower(btrim(p_code));
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if a.status = 'pending' and a.expires_at <= now() then update ins_approvals set status = 'expired' where id = a.id; a.status := 'expired'; end if;
  select * into oc from outside_claims where id = a.oc_id;
  if a.kind = 'file_claim' and a.status = 'pending' then
    v_pk := ins_build_packet(oc.case_id, oc.id); v_stale := (v_pk->>'hash') is distinct from a.hash;
  end if;
  if a.draft_id is not null then select * into d from ins_drafts where id = a.draft_id; end if;
  return jsonb_build_object('ok', true, 'approval', jsonb_build_object(
    'code', a.code, 'kind', a.kind, 'title', a.title, 'status', a.status, 'hash', a.hash, 'created_at', a.created_at, 'expires_at', a.expires_at,
    'seconds_left', greatest(0, floor(extract(epoch from (a.expires_at - now()))))::int, 'stale', v_stale,
    'summary', a.summary,
    'case', jsonb_build_object('title', oc.title, 'insurer', oc.insurer, 'policy_no', oc.policy_no, 'claim_no', oc.claim_no, 'stage', oc.ins_stage),
    'draft', case when d.id is null then null else jsonb_build_object('id', d.id, 'status', d.status, 'to', d.to_addr, 'cc', d.cc, 'subject', d.subject, 'body', d.body, 'attachments', d.attachments, 'error', d.error) end));
end $$;

create or replace function public.ins_approval_decide_core(p_code text, p_decision text, p_hash text, p_uid uuid, p_claim_no text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a ins_approvals; oc outside_claims; d ins_drafts; v_job uuid; v_no text := nullif(btrim(coalesce(p_claim_no, '')), '');
begin
  select * into a from ins_approvals where code = lower(btrim(p_code)) for update;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if a.status = 'pending' and a.expires_at <= now() then update ins_approvals set status = 'expired' where id = a.id; return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if a.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'already_' || a.status); end if;
  if p_hash is distinct from a.hash then return jsonb_build_object('ok', false, 'reason', 'stale'); end if;
  select * into oc from outside_claims where id = a.oc_id for update;

  if p_decision = 'decline' then
    update ins_approvals set status = 'declined', decided_at = now(), decided_by = p_uid where id = a.id;
    if a.kind = 'file_claim' then update outside_claims set ins_stage = 'paused', updated_at = now() where id = oc.id;
    elsif a.draft_id is not null then update ins_drafts set status = 'dismissed' where id = a.draft_id; end if;
    perform ins_event(oc.id, 'declined', 'You said no: ' || a.title);
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  if a.kind = 'file_claim' and p_decision = 'filed' then       -- the page asked for a human check; he filed it by hand
    if v_no is null then return jsonb_build_object('ok', false, 'reason', 'need_claim_number'); end if;
    update ins_approvals set status = 'approved', decided_at = now(), decided_by = p_uid where id = a.id;
    perform ins_set_claim_no(oc.id, v_no, 'filed by hand');
    return jsonb_build_object('ok', true, 'status', 'filed');
  end if;

  if p_decision <> 'approve' then return jsonb_build_object('ok', false, 'reason', 'bad_decision'); end if;

  if a.kind = 'file_claim' then
    if coalesce((a.summary->>'manual')::boolean, false) then return jsonb_build_object('ok', false, 'reason', 'manual_only'); end if;
    v_job := ins_queue(oc.id, 'submit', 'mac', jsonb_build_object('approval_id', a.id, 'packet_hash', a.hash, 'insurer', oc.insurer_slug), false, 900);
    update ins_approvals set status = 'approved', decided_at = now(), decided_by = p_uid, job_id = v_job where id = a.id;
    update outside_claims set ins_stage = 'submitting', updated_at = now() where id = oc.id;
    perform ins_event(oc.id, 'approved', 'You approved sending the ' || oc.insurer || ' claim');
    return jsonb_build_object('ok', true, 'status', 'approved');
  end if;

  select * into d from ins_drafts where id = a.draft_id for update;
  if d.id is null or d.status <> 'awaiting' then return jsonb_build_object('ok', false, 'reason', 'draft_not_waiting'); end if;
  update ins_drafts set status = 'approved', approved_at = now() where id = d.id;
  update ins_approvals set status = 'approved', decided_at = now(), decided_by = p_uid where id = a.id;
  perform ins_queue(oc.id, 'send_mail', 'mac', jsonb_build_object('draft_id', d.id, 'approval_id', a.id), false, 600);
  perform ins_event(oc.id, 'approved', 'You approved the email to ' || d.to_addr, jsonb_build_object('draft_id', d.id));
  return jsonb_build_object('ok', true, 'status', 'approved');
end $$;

create or replace function public.ins_approval_decide(p_code text, p_decision text, p_hash text default null, p_claim_no text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.admin_require_admin();
  return public.ins_approval_decide_core(p_code, p_decision, p_hash, auth.uid(), p_claim_no);
end $$;

-- The dispatcher for /y/<code>: which page is this code for? (Ava's codes never start with 'i'.)
create or replace function public.ins_approval_exists(p_code text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_require_admin();
  return exists (select 1 from ins_approvals where code = lower(btrim(p_code)));
end $$;

-- Jared fixes a word in a draft before he taps. The same guard runs, the hash moves with the text, and the approval stays open for the new text.
create or replace function public.ins_draft_edit(p_code text, p_subject text, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a ins_approvals; d ins_drafts; v_problem text; v_body text := btrim(coalesce(p_body, '')); v_hash text;
begin
  perform public.admin_require_admin();
  select * into a from ins_approvals where code = lower(btrim(p_code)) for update;
  if a.id is null or a.kind <> 'send_mail' or a.draft_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if a.status <> 'pending' or a.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  select * into d from ins_drafts where id = a.draft_id for update;
  if d.id is null or d.status <> 'awaiting' then return jsonb_build_object('ok', false, 'reason', 'draft_not_waiting'); end if;
  if length(v_body) < 20 then return jsonb_build_object('ok', false, 'reason', 'too_short'); end if;
  v_problem := ins_draft_guard(d.oc_id, v_body);
  if v_problem is not null then return jsonb_build_object('ok', false, 'reason', 'blocked', 'problem', v_problem); end if;
  -- keep the signature: it is always Claims Closer
  if v_body !~ 'Claims Closer' then v_body := v_body || E'\n\n' || ins_sig(); end if;
  update ins_drafts set subject = left(coalesce(nullif(btrim(p_subject), ''), subject), 300), body = left(v_body, 8000) where id = d.id;
  select * into d from ins_drafts where id = d.id;
  v_hash := md5(d.subject || '|' || d.body || '|' || d.attachments::text);
  update ins_approvals set hash = v_hash, summary = summary || jsonb_build_object('subject', d.subject, 'body', d.body) where id = a.id;
  perform ins_event(d.oc_id, 'draft_edited', 'You changed the wording of the email to ' || d.to_addr, jsonb_build_object('draft_id', d.id));
  return jsonb_build_object('ok', true, 'hash', v_hash, 'subject', d.subject, 'body', d.body);
end $$;

-- Admin buttons on the card: record what was received, add a contact, resume a paused case.
create or replace function public.ins_amount_add(p_oc uuid, p_source text, p_amount numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_admin();
  insert into ins_amounts (oc_id, source, amount, note, confirmed) values (p_oc, p_source, p_amount, p_note, true);
  perform ins_event(p_oc, 'amount', 'Received ' || stuck_money(p_amount) || ' from ' || p_source, jsonb_build_object('amount', p_amount, 'source', p_source));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ins_registry_add(p_name text, p_phone text default null, p_email text default null, p_domains text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_slug text := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'); o record; n integer := 0;
begin
  perform public.admin_require_admin();
  insert into ins_insurers (slug, name, match_names, match_domains, phone, email, method)
  values (v_slug, btrim(p_name), array[lower(btrim(p_name))], coalesce(p_domains, '{}'), nullif(ins_digits(p_phone), ''), nullif(btrim(coalesce(p_email, '')), ''),
          case when nullif(btrim(coalesce(p_email, '')), '') is not null then 'email' else 'call' end)
  on conflict (slug) do update set phone = coalesce(excluded.phone, ins_insurers.phone), email = coalesce(excluded.email, ins_insurers.email),
        match_domains = case when cardinality(excluded.match_domains) > 0 then excluded.match_domains else ins_insurers.match_domains end;
  for o in select id from outside_claims where kind = 'guest_insurer' and ins_stage = 'needs_contact' and lower(insurer) = lower(btrim(p_name)) loop
    update outside_claims set insurer_slug = v_slug, ins_stage = 'photos', reply_domain = coalesce((select match_domains[1] from ins_insurers where slug = v_slug), reply_domain), updated_at = now() where id = o.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'slug', v_slug, 'resumed', n);
end $$;

create or replace function public.ins_resume(p_oc uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_admin();
  update outside_claims set ins_stage = 'photos', updated_at = now() where id = p_oc and kind = 'guest_insurer' and ins_stage in ('paused', 'needs_contact');
  perform ins_event(p_oc, 'resumed', 'You asked me to pick this back up');
  perform ins_advance(p_oc);
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================================================================
-- 11. Runners: the Mac mini filer (watchdog token), the Pi Turo reader (worker token), and the edge function (service role).
--     A job is only handed out when the thing it does was approved. The Mac cannot be told to submit or send on its own.
-- ============================================================================================================================
create or replace function public.ins_job_done(p_job uuid, p_status text, p_result jsonb default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  j ins_jobs; oc outside_claims; st text := case when p_status in ('done', 'failed', 'blocked') then p_status else 'failed' end; a ins_approvals;
  v_code text; v_summary jsonb; v_pk jsonb; v_manual boolean; d ins_drafts; r jsonb := coalesce(p_result, '{}'::jsonb); v_no text;
begin
  select * into j from ins_jobs where id = p_job for update;
  if j.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if j.status not in ('claimed', 'queued') then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  update ins_jobs set status = st, result = r, error = left(p_error, 500), finished_at = now() where id = j.id;
  select * into oc from outside_claims where id = j.oc_id;

  if j.kind = 'copy_evidence' or j.kind = 'photos' then
    perform ins_event(oc.id, 'photos_' || j.kind, case when st = 'done' then 'Photos gathered (' || coalesce(r->>'added', '0') || ' new)' else 'Photo step did not finish: ' || left(coalesce(p_error, ''), 120) end, r);
    update outside_claims set photo_set = (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from ins_photos where oc_id = oc.id group by 1) q) where id = oc.id;

  elsif j.kind = 'fill' then
    if j.dry then
      perform ins_event(oc.id, 'rehearsal', 'Rehearsal finished. Nothing was sent.', r);
    elsif (j.payload->>'packet_hash') is distinct from oc.packet_hash then
      perform ins_event(oc.id, 'fill_stale', 'A fill finished after the facts changed. Ignoring it.');
    elsif st = 'failed' then
      perform ins_event(oc.id, 'fill_failed', 'The form fill failed: ' || left(coalesce(p_error, ''), 160));
    else
      v_manual := st = 'blocked' or coalesce((r->>'blocked_reason'), '') <> '';
      v_summary := jsonb_build_object('kind', 'file_claim', 'insurer', oc.insurer, 'claim_url', r->'url', 'manual', v_manual, 'blocked_reason', r->'blocked_reason',
                     'fields', coalesce(oc.packet->'fields', '[]'::jsonb), 'unknown', coalesce(oc.packet->'unknown', '[]'::jsonb), 'inferred', coalesce(oc.packet->'inferred', '[]'::jsonb),
                     'filled', coalesce(r->'filled', '[]'::jsonb), 'left_blank', coalesce(r->'left_blank', '[]'::jsonb), 'screens', coalesce(r->'screens', '[]'::jsonb),
                     'shots', coalesce(r->'shots', '[]'::jsonb), 'consent', coalesce(r->'consent', '[]'::jsonb), 'consent_clicked', coalesce(r->'consent_clicked', 'false'::jsonb),
                     'photos', oc.photo_set, 'photos_uploaded', r->'photos_uploaded', 'reached', r->'reached', 'turo_claim_no', (select turo_claim_no from claim_cases where id = oc.case_id));
      v_code := ins_approval_create(oc.id, 'file_claim', case when v_manual then 'Finish the ' || oc.insurer || ' claim by hand' else 'Send the ' || oc.insurer || ' claim' end,
                                    v_summary, j.id, null, oc.packet_hash);
      update outside_claims set ins_stage = 'needs_approval', updated_at = now() where id = oc.id;
    end if;

  elsif j.kind = 'submit' then
    select * into a from ins_approvals where id = (j.payload->>'approval_id')::uuid;
    v_no := nullif(btrim(coalesce(r->>'claim_no', '')), '');
    if coalesce((r->>'not_sent')::boolean, false) then
      -- the Mac stopped BEFORE clicking send (the facts changed after the tap, or the form did not look the same). Nothing went out: fill again.
      update outside_claims set ins_stage = 'photos', updated_at = now() where id = oc.id;
      perform ins_event(oc.id, 'send_aborted', 'I did not send: ' || left(coalesce(r->>'blocked_reason', p_error, 'the facts changed after your tap'), 200) || ' I am filling the form again for a new OK.', r);
    elsif st = 'done' and v_no is not null then
      perform ins_set_claim_no(oc.id, v_no, 'filed by Claims Closer');
      perform ins_event(oc.id, 'confirmation', 'Sent. ' || oc.insurer || ' gave claim number ' || v_no, jsonb_build_object('confirmation', r->'confirmation_text', 'shots', r->'shots'));
    elsif st = 'done' then
      update outside_claims set ins_stage = 'filed', filed_at = coalesce(filed_at, now()), last_outbound_at = coalesce(last_outbound_at, now()), updated_at = now() where id = oc.id;
      perform ins_event(oc.id, 'filed_no_number', 'Sent, but I could not read a claim number off the confirmation page. Check the screenshot.', r);
      perform ins_notify('Sent to ' || oc.insurer || ', no claim number yet', 'The claim went in but I could not read the number. Open the card and read it off the confirmation screenshot.', 'https://bestly.tech/admin', 'ins-nonumber-' || oc.id);
    else
      -- the outcome of a submit is unknown. Never retried automatically: it may have gone through.
      update outside_claims set ins_stage = 'paused', updated_at = now() where id = oc.id;
      perform ins_event(oc.id, 'submit_unknown', 'The send did not finish and I cannot tell if it went through. Check ' || oc.insurer || ' before trying again.', jsonb_build_object('error', p_error));
      perform ins_notify('Check ' || oc.insurer || ' before I try again', 'The claim send stopped partway. It may or may not have gone through. I will not retry on my own.', 'https://bestly.tech/admin', 'ins-submit-' || oc.id);
    end if;

  elsif j.kind = 'send_mail' then
    select * into d from ins_drafts where id = (j.payload->>'draft_id')::uuid;
    if st = 'done' and coalesce((r->>'verified')::boolean, false) then
      update ins_drafts set status = 'sent', sent_at = now(), verified = true where id = d.id;
      update outside_claims set last_outbound_at = now(), emails_sent = emails_sent + case when d.kind = 'turo_reply' then 0 else 1 end,
             status = case when status = 'escalated' then status else 'waiting' end,
             reply_due_at = ins_add_biz(now(), (select nudge_business_days from ins_settings where id)), updated_at = now() where id = oc.id and d.kind <> 'turo_reply';
      perform ins_event(oc.id, 'sent', 'Sent to ' || d.to_addr || ' with ' || coalesce(r->>'attachments', '0') || ' attachment(s). It is in Sent.', jsonb_build_object('draft_id', d.id, 'subject', d.subject));
    else
      update ins_drafts set status = 'failed', error = left(coalesce(p_error, 'Mail.app did not confirm the message in Sent'), 300), verified = false where id = d.id;
      perform ins_event(oc.id, 'send_failed', 'The email to ' || d.to_addr || ' did not confirm. It may or may not have gone. Check Sent before sending again.', jsonb_build_object('draft_id', d.id, 'error', p_error));
      perform ins_notify('Check Sent before I resend', 'The email to ' || d.to_addr || ' did not confirm in Sent. I will not resend on my own.', 'https://bestly.tech/admin', 'ins-sendfail-' || d.id);
    end if;

  elsif j.kind = 'attach_fetch' then
    perform ins_event(oc.id, 'attachments', case when st = 'done' then 'Saved ' || coalesce(r->>'saved', '0') || ' attachment(s) from the email' else 'Could not save the email attachments' end, r);
  end if;

  perform ins_advance(oc.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ins_mac_take(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j ins_jobs; oc outside_claims; reg ins_insurers; d ins_drafts; v_photos jsonb; v_pk jsonb;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  select x.* into j from ins_jobs x
   where x.runner = 'mac' and x.status = 'queued'
     and (x.kind in ('fill', 'attach_fetch')
          or (x.kind = 'submit' and x.attempts = 0 and exists (select 1 from ins_approvals a where a.id::text = x.payload->>'approval_id' and a.status = 'approved' and a.kind = 'file_claim'))
          or (x.kind = 'send_mail' and x.attempts = 0 and exists (select 1 from ins_drafts dd where dd.id::text = x.payload->>'draft_id' and dd.status = 'approved')))
   order by case x.kind when 'send_mail' then 0 when 'submit' then 1 when 'attach_fetch' then 2 else 3 end, x.created_at
   limit 1 for update skip locked;
  if j.id is null then return jsonb_build_object('job', null); end if;
  update ins_jobs set status = 'claimed', claimed_at = now(), attempts = attempts + 1 where id = j.id;
  select * into oc from outside_claims where id = j.oc_id;
  select * into reg from ins_insurers where slug = oc.insurer_slug;
  -- a submit always gets the packet as it is right now, next to the hash Jared approved: the Mac refuses to click send if they differ
  v_pk := case when j.kind = 'submit' then ins_build_packet(oc.case_id, oc.id) else coalesce(oc.packet, ins_build_packet(oc.case_id, oc.id)) end;
  if j.kind = 'send_mail' then
    select * into d from ins_drafts where id = (j.payload->>'draft_id')::uuid;
    update ins_drafts set status = 'sending', attempts = attempts + 1 where id = d.id;
    select coalesce(jsonb_agg(jsonb_build_object('photo_id', p.id, 'name', coalesce(x->>'name', 'attachment'), 'path', p.storage_path, 'mime', p.mime, 'bytes', p.bytes)), '[]'::jsonb) into v_photos
      from jsonb_array_elements(case when jsonb_typeof(d.attachments) = 'array' then d.attachments else '[]'::jsonb end) x join ins_photos p on p.id = (x->>'photo_id')::uuid;
    return jsonb_build_object('job', jsonb_build_object('id', j.id, 'kind', j.kind, 'oc_id', oc.id, 'dry', j.dry,
      'draft', jsonb_build_object('id', d.id, 'kind', d.kind, 'to', d.to_addr, 'cc', d.cc, 'subject', d.subject, 'body', d.body), 'attachments', v_photos,
      'sender', (select owner_email from ins_settings where id)));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'source', p.source, 'path', p.storage_path, 'mime', p.mime, 'bytes', p.bytes, 'step', p.step) order by p.created_at), '[]'::jsonb) into v_photos
    from ins_photos p where p.oc_id = oc.id and p.source <> 'shot';
  return jsonb_build_object('job', jsonb_build_object('id', j.id, 'kind', j.kind, 'oc_id', oc.id, 'dry', j.dry, 'payload', j.payload, 'packet', v_pk,
    'insurer', to_jsonb(reg) - 'notes', 'photos', v_photos, 'consent_before_tap', (select consent_before_tap from ins_settings where id),
    'claim_no', oc.claim_no, 'insurer_name', oc.insurer, 'approved_hash', j.payload->>'packet_hash', 'case_id', oc.case_id, 'reservation_id', oc.reservation_id));
end $$;

create or replace function public.ins_mac_done_t(p_token text, p_job uuid, p_status text, p_result jsonb default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return ins_job_done(p_job, p_status, p_result, p_error);
end $$;

-- A rehearsal for any case, approved or not: the packet and the registry row, no job, no side effects.
create or replace function public.ins_mac_packet_t(p_token text, p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pk jsonb; v_slug text;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  pk := ins_build_packet(p_case, null);
  v_slug := coalesce(pk->>'insurer_slug', 'progressive');
  return jsonb_build_object('packet', pk, 'insurer', (select to_jsonb(i) - 'notes' from ins_insurers i where i.slug = v_slug));
end $$;

create or replace function public.ins_mac_beat_t(p_token text, p_ok boolean default true, p_summary text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return agent_beat('insurance-filer', coalesce(p_ok, true), left(p_summary, 500), get_home_hub_agent_key());
end $$;

create or replace function public.ins_pi_take(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j ins_jobs; c claim_cases; oc outside_claims;
begin
  if not tesla_worker_ok(p_token) then raise exception 'not allowed'; end if;
  select x.* into j from ins_jobs x where x.runner = 'pi' and x.kind = 'photos' and x.status = 'queued' order by x.created_at limit 1 for update skip locked;
  if j.id is null then return jsonb_build_object('job', null); end if;
  update ins_jobs set status = 'claimed', claimed_at = now(), attempts = attempts + 1 where id = j.id;
  select * into oc from outside_claims where id = j.oc_id;
  select * into c from claim_cases where id = oc.case_id;
  return jsonb_build_object('job', jsonb_build_object('id', j.id, 'oc_id', oc.id, 'case_id', c.id, 'reservation_id', c.reservation_id, 'incident_id', c.turo_incident_id,
    'known', (select coalesce(jsonb_agg(turo_uuid), '[]'::jsonb) from ins_photos where oc_id = oc.id and turo_uuid is not null)));
end $$;

create or replace function public.ins_pi_done(p_token text, p_job uuid, p_status text, p_result jsonb default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not tesla_worker_ok(p_token) then raise exception 'not allowed'; end if;
  return ins_job_done(p_job, p_status, p_result, p_error);
end $$;

-- The edge function (service role) picks up its own jobs: copying the photos already in claim-evidence.
create or replace function public.ins_edge_take() returns jsonb
language plpgsql security definer set search_path = public as $$
declare j ins_jobs; oc outside_claims;
begin
  select x.* into j from ins_jobs x where x.runner = 'edge' and x.status = 'queued' order by x.created_at limit 1 for update skip locked;
  if j.id is null then return jsonb_build_object('job', null); end if;
  update ins_jobs set status = 'claimed', claimed_at = now(), attempts = attempts + 1 where id = j.id;
  select * into oc from outside_claims where id = j.oc_id;
  return jsonb_build_object('job', jsonb_build_object('id', j.id, 'kind', j.kind, 'oc_id', oc.id, 'case_id', oc.case_id));
end $$;

-- What the writer needs to draft a reply: the facts, their message, what we can attach. Service role only.
create or replace function public.ins_draft_context(p_draft uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d ins_drafts; oc outside_claims; m bestly_mail; c claim_cases;
begin
  select * into d from ins_drafts where id = p_draft;
  select * into oc from outside_claims where id = d.oc_id;
  select * into c from claim_cases where id = oc.case_id;
  select * into m from bestly_mail where id = d.in_reply_to_mail;
  return jsonb_build_object(
    'draft', jsonb_build_object('id', d.id, 'kind', d.kind, 'to', d.to_addr, 'subject', d.subject),
    'case', jsonb_build_object('insurer', oc.insurer, 'claim_no', oc.claim_no, 'policy_no', oc.policy_no, 'adjuster_name', oc.adjuster_name, 'title', oc.title),
    'facts', coalesce(ins_build_packet(oc.case_id, oc.id)->'values', '{}'::jsonb),
    'turo_claim_no', c.turo_claim_no,
    'their_mail', case when m.id is null then null else jsonb_build_object('from', m.from_addr, 'name', m.from_name, 'subject', m.subject, 'sent_at', m.sent_at, 'body', left(coalesce(m.body_text, ''), 6000)) end,
    'we_said', (select coalesce(jsonb_agg(jsonb_build_object('subject', x.subject, 'sent_at', x.sent_at, 'body', left(x.body, 1500)) order by x.sent_at), '[]'::jsonb)
                  from (select subject, sent_at, body from ins_drafts where oc_id = oc.id and status = 'sent' order by sent_at desc limit 3) x),
    'attachments', ins_pick_attachments(oc.id),
    'estimate', (select jsonb_build_object('amount', e.detail->>'amount', 'at', e.at) from ins_events e where e.oc_id = oc.id and e.kind = 'estimate_final' order by e.at desc limit 1));
end $$;

-- ============================================================================================================================
-- 12. What the Command Center card shows: a plain timeline, the Tesla Service message, and the Waiting items.
-- ============================================================================================================================
create or replace function public.ins_timeline(p_oc uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare oc outside_claims; out jsonb;
begin
  select * into oc from outside_claims where id = p_oc;
  select coalesce(jsonb_agg(jsonb_build_object('at', z.at, 'when', stuck_when(z.at), 'text', z.text, 'kind', z.kind, 'tone', z.tone) order by z.at), '[]'::jsonb) into out
  from (
    select y.* from (
      select e.at, e.title as text, e.kind, 'event'::text as tone from ins_events e
       where e.oc_id = p_oc and e.kind in ('opened', 'appraisal_started', 'estimate_final', 'payment_instructions', 'turo_payment', 'turo_review', 'turo_network', 'filed', 'confirmation',
                                          'filed_no_number', 'adjuster_mail', 'adjuster', 'sent', 'send_failed', 'nudge', 'errand', 'amount', 'approved', 'declined', 'submit_unknown',
                                          'needs_contact', 'fill_failed', 'draft_blocked', 'attachments')
      union all
      -- Cody's Supercharging reimbursement was its own Turo invoice and is already paid. It sits on the timeline as settled, not as a claim item.
      select ce.at, 'Supercharging ' || stuck_money(q.amt) || ' paid by ' || coalesce((select guest_first from claim_cases where id = oc.case_id), 'the guest') ||
             '. A separate invoice, already settled. Not part of this claim.', 'settled'::text, 'settled'::text
        from claim_events ce
        join lateral (select nullif(replace(substring(coalesce(b.body_text, ce.detail->>'excerpt', '') from 'Total charge\s*-\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?)'), ',', ''), '')::numeric as amt
                        from (select 1) one left join bestly_mail b on b.id = ce.mail_id) q on true
       where ce.case_id = oc.case_id and ce.kind = 'mail' and ce.detail->>'kind' = 'invoice_paid' and q.amt is not null
         and coalesce(ce.detail->>'excerpt', '') ~* 'on-trip charging|supercharg'
    ) y order by y.at desc limit 16
  ) z;
  return out;
end $$;

create or replace function public.ins_tesla_message(p_oc uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare oc outside_claims; pk jsonb; v jsonb; c claim_cases; v_est numeric; v_txt text;
begin
  select * into oc from outside_claims where id = p_oc;
  if oc.id is null or oc.claim_no is null then return null; end if;
  select * into c from claim_cases where id = oc.case_id;
  pk := coalesce(oc.packet, ins_build_packet(oc.case_id, oc.id)); v := coalesce(pk->'values', '{}'::jsonb);
  select (e.detail->>'amount')::numeric into v_est from ins_events e where e.oc_id = oc.id and e.kind = 'estimate_final' and e.detail ? 'amount' order by e.at desc limit 1;
  v_txt := 'Hello Tesla Service,' || E'\n\n'
    || 'I own a ' || coalesce(v->>'vehicle.year', '') || ' Tesla ' || coalesce(v->>'vehicle.model', 'Model 3') || ' (VIN ' || coalesce(v->>'vehicle.vin', 'unknown') || ', plate ' || coalesce(v->>'vehicle.plate', 'unknown') || '). '
    || 'It was damaged on ' || coalesce(v->>'loss.date', 'unknown date') || ': ' || lower(coalesce(v->>'loss.damage', 'body damage')) || '.' || E'\n'
    || 'The renter''s insurer, ' || oc.insurer || ', opened claim ' || oc.claim_no || case when coalesce(v->>'policy.holder', oc.policyholder) is not null then ' (policyholder ' || coalesce(oc.policyholder, v->>'policy.holder') || ')' else '' end || '.'
    || case when c.turo_claim_no is not null then ' Turo claim ' || c.turo_claim_no || ' is open for the same loss.' else '' end || E'\n'
    || 'Please set up a collision inspection and repair at a Tesla-certified facility.'
    || case when v_est is not null then ' The finalized estimate is ' || stuck_money(v_est) || '.' else '' end || E'\n'
    || 'I will confirm what the claim covers before any parts are ordered.' || E'\n\n'
    || 'Claims Closer, for Jared Best';
  return jsonb_build_object('text', v_txt, 'has_estimate', v_est is not null, 'ready', v_est is not null);
end $$;

create or replace function public.ins_waiting_items() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o outside_claims; items jsonb := '[]'::jsonb; v_who text; blocks jsonb; need jsonb; v_pill text; v_ap ins_approvals; v_err ava_errands; v_copy jsonb; v_t jsonb;
  v_photos text; v_form text; v_next text; v_adj text; v_recv text; v_turo numeric; v_ins numeric; v_unc numeric; v_hr numeric; v_open boolean; v_sub text; v_reg ins_insurers;
  v_n integer;
begin
  for o in select * from outside_claims x where x.kind = 'guest_insurer' and x.status <> 'closed' and x.ins_stage is not null order by x.created_at loop
    v_who := coalesce((select name from bestly_agents where slug = o.owner_slug), 'Claims Closer');
    select * into v_ap from ins_approvals a where a.oc_id = o.id and a.status = 'pending' and a.expires_at > now() order by a.created_at desc limit 1;
    select * into v_err from ava_errands e where e.id = o.errand_id and e.status not in ('done', 'cancelled');
    select * into v_reg from ins_insurers where slug = o.insurer_slug;
    v_open := ins_biz_open(now());

    select count(*) into v_n from ins_photos where oc_id = o.id and source <> 'shot';
    v_photos := case when v_n > 0 then v_n || ' ready' when o.ins_stage in ('new', 'photos') then 'Gathering' else 'None found' end;
    v_form := case o.ins_stage
      when 'new' then 'Not started' when 'photos' then 'Waiting for photos' when 'filling' then 'Being filled in'
      when 'needs_approval' then 'Filled in. Waiting for your OK' when 'submitting' then 'Sending now'
      when 'filed' then 'Sent ' || stuck_when(o.filed_at) when 'emailing' then 'First email is being written'
      when 'needs_contact' then 'Needs a phone call or a claims contact' when 'paused' then 'Paused' else o.ins_stage end;
    v_adj := case when o.adjuster_name is null and o.adjuster_email is null then 'Not assigned yet'
                  else concat_ws(', ', o.adjuster_name, o.adjuster_email, o.adjuster_phone) end;
    select coalesce(sum(amount) filter (where source = 'turo' and confirmed), 0), coalesce(sum(amount) filter (where source = 'insurer' and confirmed), 0),
           coalesce(sum(amount) filter (where not confirmed), 0) into v_turo, v_ins, v_unc from ins_amounts where oc_id = o.id;
    v_recv := 'Turo ' || stuck_money(v_turo) || ', ' || o.insurer || ' ' || stuck_money(v_ins) || case when v_unc > 0 then ' (plus ' || stuck_money(v_unc) || ' from emails, not confirmed)' else '' end;
    v_hr := coalesce((select host_responsibility from claim_cases where id = o.case_id), nullif(o.internal->>'host_responsibility_seen', '')::numeric);

    v_next := case
      when v_ap.id is not null then 'Your OK on: ' || v_ap.title
      when v_err.id is not null then case when v_open then 'Call is queued. Tap Call now.' else 'Call is queued. Lines open ' || stuck_when(ins_next_biz_open(now())) end
      when o.ins_stage = 'filed' and o.reply_due_at is not null then 'If no reply by ' || stuck_when(o.reply_due_at) || ' I write a nudge for your OK'
      when o.ins_stage = 'needs_contact' then 'I need ' || o.insurer || '''s claims line or email'
      when o.ins_stage = 'paused' then 'Paused until you say go'
      else 'Working on it' end;

    blocks := jsonb_build_array(
      jsonb_build_object('id', 'photos', 'label', 'Photos', 'detail', v_photos, 'fix_action', null, 'fix_label', null),
      jsonb_build_object('id', 'form', 'label', 'Claim form', 'detail', v_form, 'fix_action', null, 'fix_label', null),
      jsonb_build_object('id', 'claim_no', 'label', o.insurer || ' claim number', 'detail', coalesce(o.claim_no, 'Not yet'), 'fix_action', null, 'fix_label', null),
      jsonb_build_object('id', 'adjuster', 'label', 'Adjuster', 'detail', v_adj, 'fix_action', null, 'fix_label', null),
      jsonb_build_object('id', 'next', 'label', 'Next step', 'detail', v_next, 'fix_action', null, 'fix_label', null),
      jsonb_build_object('id', 'received', 'label', 'Received so far', 'detail', v_recv, 'fix_action', null, 'fix_label', null));
    if coalesce((o.internal->>'tesla_certified_required')::boolean, false) then
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'shop', 'label', 'Repair shop', 'detail', 'Tesla-certified only. Turo asked for it.', 'fix_action', null, 'fix_label', null));
    end if;
    if v_hr is not null then
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'internal', 'label', 'Host damage responsibility (internal)', 'detail', stuck_money(v_hr), 'fix_action', null, 'fix_label', null));
    end if;

    need := null; v_pill := 'WAITING';
    if v_ap.id is not null then
      v_pill := 'YOUR CALL';
      need := jsonb_build_object('kind', 'approval', 'label', v_ap.title, 'link', '/y/' || v_ap.code, 'link_label', case v_ap.kind when 'file_claim' then 'Review and send' else 'Read and send' end);
    elsif v_err.id is not null then
      v_pill := 'YOUR CALL';
      need := jsonb_build_object('kind', 'call', 'label', 'Call ' || o.insurer, 'open', v_open, 'opens', stuck_when(ins_next_biz_open(now())),
                'call', jsonb_build_object('phone', v_err.phone, 'name', v_err.who, 'company', o.insurer, 'purpose', v_err.title || '. ' || coalesce(left(v_err.details, 600), '')),
                'link', '/admin/pipeline', 'link_label', 'Open errands');
    elsif o.ins_stage = 'needs_contact' then
      v_pill := 'YOUR CALL';
      need := jsonb_build_object('kind', 'contact', 'label', 'Add ' || o.insurer || '''s claims contact', 'link', '/admin/claims', 'link_label', 'Open Claims');
    elsif o.ins_stage = 'paused' then
      v_pill := 'YOUR CALL';
      need := jsonb_build_object('kind', 'check', 'label', 'Check ' || o.insurer || ' before I go on', 'link', '/admin/claims', 'link_label', 'Open Claims');
    end if;

    v_copy := '[]'::jsonb;
    v_t := ins_tesla_message(o.id);
    if v_t is not null then
      v_copy := v_copy || jsonb_build_array(jsonb_build_object('id', 'tesla', 'label', case when (v_t->>'ready')::boolean then 'Message for Tesla Service' else 'Message for Tesla Service (no estimate yet)' end,
                'text', v_t->>'text', 'note', 'Tesla''s chat has no way for me to send it. Paste it into the Tesla app.'));
    end if;

    v_sub := o.insurer || coalesce(' · policy ' || o.policy_no, '') || coalesce(' · claim ' || o.claim_no, '');
    items := items || jsonb_build_array(jsonb_build_object(
      'kind', 'waiting', 'item_id', 'ins:' || o.id, 'employee_slug', o.owner_slug, 'employee_name', v_who,
      'title', o.title, 'subtitle', v_sub, 'stuck_since', coalesce(v_ap.created_at, o.last_outbound_at, o.created_at),
      'pill', v_pill, 'needs_you', need, 'copy', v_copy, 'timeline', ins_timeline(o.id), 'blocks', blocks,
      'footer', case when v_pill = 'YOUR CALL' then 'One tap and it is done. — ' || v_who else 'Nothing for you to do right now. — ' || v_who end));
  end loop;
  return items;
end $$;

-- ============================================================================================================================
-- 13. Patch the existing Waiting card feed (guarded: the migration fails loudly if the live text is not what it expects)
--     - stuck_items_core: the old Waiting loop reads kind 'other' only; ours are added by ins_waiting_items()
--     - outside_claims_check / stuck_feed_selftest: the Kemper check logic ignores our rows
-- ============================================================================================================================
do $patch$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.stuck_items_core()'::regprocedure);
  if position('ins_waiting_items' in v_def) = 0 then
    v_new := replace(v_def, 'from outside_claims o where o.status in (''waiting'', ''escalated'')', 'from outside_claims o where o.kind = ''other'' and o.status in (''waiting'', ''escalated'')');
    v_new := replace(v_new, 'return coalesce((select jsonb_agg(x order by ord) from (', E'items := items || public.ins_waiting_items();\n  return coalesce((select jsonb_agg(x order by ord) from (');
    if position('o.kind = ''other''' in v_new) = 0 or position('ins_waiting_items' in v_new) = 0 then
      raise exception 'stuck_items_core does not have the expected text; the Waiting card was not patched';
    end if;
    execute v_new;
  end if;

  v_def := pg_get_functiondef('public.outside_claims_check()'::regprocedure);
  if position('kind = ''other''' in v_def) = 0 then
    v_new := replace(v_def, 'for r in select * from outside_claims where status = ''waiting'' order by created_at loop', 'for r in select * from outside_claims where kind = ''other'' and status = ''waiting'' order by created_at loop');
    if position('kind = ''other''' in v_new) = 0 then raise exception 'outside_claims_check does not have the expected text; not patched'; end if;
    execute v_new;
  end if;

  v_def := pg_get_functiondef('public.stuck_feed_selftest()'::regprocedure);
  if position('kind = ''other''' in v_def) = 0 then
    v_new := replace(v_def, 'outside_claims where status = ''waiting'' and reply_due_at', 'outside_claims where kind = ''other'' and status = ''waiting'' and reply_due_at');
    if position('kind = ''other''' in v_new) = 0 then raise exception 'stuck_feed_selftest does not have the expected text; not patched'; end if;
    execute v_new;
  end if;
end $patch$;


-- ============================================================================================================================
-- 14. Watchdog (owner: Claims Closer, prefix 'claims.'). Self-heals first: requeue a stuck job, retry the matcher, open a missed case.
-- ============================================================================================================================
create or replace function public.ins_selftest() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  checks jsonb := '[]'::jsonb; ok boolean; pk jsonb; v jsonb; v_def text; f jsonb; n integer;
  function_names text[] := array['ins_claim_event_trg', 'ins_case_insurer_trg', 'ins_mail_trg'];
begin
  -- 1. triggers are there and on
  select count(*) into n from pg_trigger where tgname = any (function_names) and tgenabled = 'O' and not tgisinternal;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'trigger', 'ok', n = 3, 'detail', n || ' of 3 triggers on'));

  -- 2. registry
  select (count(*) = 1) into ok from ins_insurers where slug = 'progressive' and enabled and claim_url is not null and phone ~ '^\d{10}$';
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'registry', 'ok', ok, 'detail', 'Progressive entry with claims line and page'));
  ok := ins_registry_find('Progressive Insurance') = 'progressive' and ins_registry_find(null, 'Sam <sam@email.progressive.com>') = 'progressive'
        and ins_registry_find('Some Other Mutual') is null and ins_registry_find(null, 'x@notprogressive.com') is null;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'registry_match', 'ok', coalesce(ok, false), 'detail', 'name and domain lookup'));

  -- 3. packet builder on a synthetic case that looks like a real Turo damage report
  pk := ins_packet_core(jsonb_build_object(
    'case', jsonb_build_object('guest_first', 'Test', 'guest_last', 'Guest', 'vin', '5YJ3E1EAXLF000000', 'reservation_id', 1, 'turo_claim_no', '9999999',
        'insurer', jsonb_build_object('name', 'Progressive', 'policy_no', '111222333', 'source', 'guest reply'),
        'damage_report', jsonb_build_object('answers', jsonb_build_object(
          'When did the incident occur?', '10/26/26',
          'Where did the incident occur?', 'Country: US | Street address: 750 B St | City: San Diego, Ca | State: - | Postal code: 92101',
          'How was the damage caused?', 'Collision', 'Was anyone injured?', 'No', 'Was a police report filed?', 'No',
          'Is there any additional information you’d like to add?', E'Driver was Pat Lee Sample\nPhone number 414 555 0100',
          'Who was driving the vehicle when the damage occurred?', 'Someone else'))),
    'trip', jsonb_build_object('guest_phone', '(303) 555-0100', 'raw', jsonb_build_object('vehicle', jsonb_build_object('year', '2020', 'make', 'Tesla', 'model', 'Model 3',
        'registration', jsonb_build_object('licensePlate', '8TEST01', 'state', 'CA')))),
    'settings', jsonb_build_object('owner_name', 'Jared Best', 'owner_phone', '(816) 500-7236', 'owner_email', 'jared@bestly.tech'),
    'oc', '{}'::jsonb, 'policy_msg', 'Progressive 111222333 Pat Lee Sample'));
  v := pk->'values';
  ok := v->>'loss.address' = '750 B St' and v->>'loss.city' = 'San Diego' and v->>'loss.state' = 'CA' and v->>'loss.zip' = '92101' and v->>'loss.date' = '10/26/2026'
        and v->>'driver.name' = 'Pat Lee Sample' and ins_digits(v->>'driver.phone') = '4145550100' and v->>'vehicle.plate' = '8TEST01'
        and v->>'policy.holder' = 'Pat Lee Sample' and pk->'inferred' ? 'policy.holder'
        and exists (select 1 from jsonb_array_elements(pk->'unknown') u where u->>'key' = 'loss.time')
        and exists (select 1 from jsonb_array_elements(pk->'unknown') u where u->>'key' = 'vehicle.color')
        and exists (select 1 from jsonb_array_elements(pk->'unknown') u where u->>'key' = 'reporter.address')
        and v::text !~ '2,?750';
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'packet', 'ok', coalesce(ok, false), 'detail', 'facts parsed, unknowns listed, nothing invented'));

  -- 4. mail matching helpers
  ok := ins_claim_no_from_text('Hello. Your claim number is 22-4567890. Turo claim 1108308 is open too.') = '22-4567890'
        and ins_claim_no_from_text('We are looking at Turo claim 1108308 only') is null
        and ins_claim_no_from_text('Your claim status has changed') is null
        and ins_is_noreply('no-reply@progressive.com') and not ins_is_noreply('Sam Adjuster <sam@progressive.com>');
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'mail_matcher', 'ok', coalesce(ok, false), 'detail', 'claim number, no-reply and Turo-number rules'));

  -- 5. business-day clock: Friday 10:00 AM + 2 business days = Tuesday 10:00 AM; Saturday noon is closed, Monday 9:00 AM opens
  ok := ins_add_biz(timestamptz '2026-10-30 10:00 America/Los_Angeles', 2) = timestamptz '2026-11-03 10:00 America/Los_Angeles'
        and not ins_biz_open(timestamptz '2026-10-31 12:00 America/Los_Angeles')
        and ins_next_biz_open(timestamptz '2026-10-31 12:00 America/Los_Angeles') = timestamptz '2026-11-02 09:00 America/Los_Angeles'
        and ins_biz_open(timestamptz '2026-10-29 10:00 America/Los_Angeles');
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'business_days', 'ok', coalesce(ok, false), 'detail', 'two business days and call hours'));

  -- 6. nothing about Turo's plan terms can reach an insurer
  ok := ins_draft_guard(null, 'Your host damage responsibility is 2,750') is not null and ins_draft_guard(null, 'Please see the attached photos') is null;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'draft_guard', 'ok', coalesce(ok, false), 'detail', 'plan terms stay internal'));

  -- 7. the card feed includes us, the Kemper check ignores us
  v_def := pg_get_functiondef('public.stuck_items_core()'::regprocedure);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'card_feed', 'ok', position('ins_waiting_items' in v_def) > 0 and position('o.kind = ''other''' in v_def) > 0, 'detail', 'stuck_items_core patched'));
  v_def := pg_get_functiondef('public.outside_claims_check()'::regprocedure);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'kemper_check', 'ok', position('kind = ''other''' in v_def) > 0, 'detail', 'outside_claims_check skips our rows'));

  -- 8. runners report in their windows
  select count(*) into n from ins_jobs where status = 'claimed' and claimed_at < now() - make_interval(secs => window_s);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'jobs_in_window', 'ok', n = 0, 'detail', n || ' job(s) held past their window'));
  select count(*) into n from ins_jobs where status = 'queued' and runner = 'mac' and created_at < now() - interval '30 minutes' and kind <> 'attach_fetch';
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'mac_picking_up', 'ok', n = 0, 'detail', n || ' Mac job(s) waiting over 30 minutes'));
  select count(*) into n from ins_jobs where status = 'queued' and runner = 'pi' and created_at < now() - interval '60 minutes';
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'pi_picking_up', 'ok', n = 0, 'detail', n || ' Pi job(s) waiting over 60 minutes'));

  return jsonb_build_object('ok', not exists (select 1 from jsonb_array_elements(checks) c where not (c->>'ok')::boolean), 'checks', checks, 'at', now());
end $$;

create or replace function public.ins_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s ins_settings; j ins_jobs; st jsonb; bad text; v_requeued integer := 0; v_failed integer := 0; v_open integer := 0; a ins_approvals; n integer;
begin
  select * into s from ins_settings where id;
  if not coalesce(s.enabled, false) then return jsonb_build_object('enabled', false); end if;

  -- a job a runner took and never finished
  for j in select * from ins_jobs where status = 'claimed' and claimed_at < now() - make_interval(secs => window_s) loop
    if j.kind in ('submit', 'send_mail') then
      -- may have gone through: never retried. ins_job_done tells Jared to check.
      perform ins_job_done(j.id, 'failed', jsonb_build_object('stuck', true), 'the runner stopped partway through ' || j.kind);
      v_failed := v_failed + 1;
      perform bestly_raise('claims.ins_job.' || left(j.id::text, 8), 'problem', 'warning', 'Claims Closer: a ' || replace(j.kind, '_', ' ') || ' stopped partway',
        'Claims Closer here. A ' || replace(j.kind, '_', ' ') || ' for the insurance claim stopped partway. It may or may not have gone through, so I will not retry it. Check the claim card.', 'turo', null, false);
    elsif j.attempts < 3 then
      update ins_jobs set status = 'queued', claimed_at = null where id = j.id;
      perform ins_event(j.oc_id, 'requeued', 'A ' || replace(j.kind, '_', ' ') || ' step stalled. Put it back in line.', jsonb_build_object('job', j.id));
      v_requeued := v_requeued + 1;
    else
      perform ins_job_done(j.id, 'failed', jsonb_build_object('stuck', true), 'stalled three times');
      v_failed := v_failed + 1;
      perform bestly_raise('claims.ins_job.' || left(j.id::text, 8), 'problem', 'warning', 'Claims Closer: a ' || replace(j.kind, '_', ' ') || ' keeps stalling',
        'Claims Closer here. The ' || replace(j.kind, '_', ' ') || ' step for the insurance claim stalled three times and I gave up on it.', 'turo', null, false);
    end if;
  end loop;

  -- a runner that is not picking work up
  select count(*) into n from ins_jobs where status = 'queued' and runner = 'mac' and created_at < now() - interval '30 minutes' and kind <> 'attach_fetch';
  perform bestly_raise('claims.ins_mac_idle', case when n > 0 then 'problem' else 'resolved' end, case when n > 0 then 'warning' else 'info' end,
    case when n > 0 then 'Claims Closer: the Mac mini is not picking up claim work' else 'Claims Closer: the Mac mini is picking up claim work again' end,
    case when n > 0 then 'Claims Closer here. ' || n || ' insurance claim step(s) have waited over 30 minutes for the Mac mini filer. Check that it is awake and its launchd job is loaded.' else null end, 'turo', null, n = 0);
  select count(*) into n from ins_jobs where status = 'queued' and runner = 'pi' and created_at < now() - interval '60 minutes';
  perform bestly_raise('claims.ins_pi_idle', case when n > 0 then 'problem' else 'resolved' end, case when n > 0 then 'warning' else 'info' end,
    case when n > 0 then 'Claims Closer: the Pi is not fetching claim photos' else 'Claims Closer: the Pi is fetching claim photos again' end,
    case when n > 0 then 'Claims Closer here. ' || n || ' photo job(s) have waited over an hour for the Pi Turo reader. I will go ahead with the photos I have.' else null end, 'turo', null, n = 0);

  -- an approval nobody opened for a day: one reminder
  for a in select * from ins_approvals where status = 'pending' and created_at < now() - interval '24 hours' and nudged_at is null and expires_at > now() loop
    perform ins_notify('Still waiting on your OK: ' || a.title, 'It has waited a day. One tap on the link.', 'https://bestly.tech/y/' || a.code, 'ins-remind-' || a.code);
    update ins_approvals set nudged_at = now() where id = a.id;
  end loop;
  update ins_approvals set status = 'expired' where status = 'pending' and expires_at <= now();

  -- a case with an insurer and no card
  select count(*) into n from claim_cases c where nullif(btrim(coalesce(c.insurer->>'name', '')), '') is not null and not coalesce(c.history, false)
     and not exists (select 1 from outside_claims o where o.case_id = c.id and o.kind = 'guest_insurer');
  if n > 0 then perform ins_sweep(); end if;
  select count(*) into n from claim_cases c where nullif(btrim(coalesce(c.insurer->>'name', '')), '') is not null and not coalesce(c.history, false)
     and not exists (select 1 from outside_claims o where o.case_id = c.id and o.kind = 'guest_insurer');
  perform bestly_raise('claims.ins_orphan', case when n > 0 then 'problem' else 'resolved' end, case when n > 0 then 'warning' else 'info' end,
    case when n > 0 then 'Claims Closer: a guest insurer has no claim card' else 'Claims Closer: every guest insurer has a claim card' end,
    case when n > 0 then 'Claims Closer here. ' || n || ' case(s) have a guest insurer but I could not open an insurance claim for them.' else null end, 'turo', null, n = 0);

  -- keep every open case moving (also the nudge and call clocks)
  perform ins_sweep();

  st := ins_selftest();
  select string_agg(c->>'name', ', ') into bad from jsonb_array_elements(st->'checks') c where not (c->>'ok')::boolean;
  perform bestly_raise('claims.ins_selftest', case when bad is not null then 'problem' else 'resolved' end, case when bad is not null then 'warning' else 'info' end,
    case when bad is not null then 'Claims Closer: the insurance filer self-test failed' else 'Claims Closer: the insurance filer self-test passes' end,
    case when bad is not null then 'Claims Closer here. My insurance filer self-test failed on: ' || bad || '.' else null end, 'turo', null, bad is null);
  select count(*) into v_open from outside_claims where kind = 'guest_insurer' and status <> 'closed';
  return jsonb_build_object('requeued', v_requeued, 'failed', v_failed, 'open_cases', v_open, 'selftest_ok', bad is null);
end $$;

-- Insurer mail that nothing matched: retry the matcher, then tell Jared. Same idea as claims_mail_unmatched_watch for Turo mail.
create or replace function public.ins_mail_unmatched_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m bestly_mail; v_n integer := 0; v_fixed integer := 0;
begin
  if not coalesce((select enabled from ins_settings where id), false) then return jsonb_build_object('enabled', false); end if;
  for m in
    select b.* from bestly_mail b
     where b.ingested_at between now() - interval '14 days' and now() - interval '15 minutes'
       and b.from_addr !~* '(turo\.com|@bestly\.tech)'
       and not exists (select 1 from ins_mail_links l where l.mail_id = b.id)
       and (lower(coalesce(b.subject, '') || ' ' || coalesce(b.body_text, '')) ~ '(claim|adjuster)')
       and (exists (select 1 from ins_insurers i, unnest(i.match_domains) d where i.enabled and lower(b.from_addr) ~ ('@([a-z0-9-]+\.)*' || replace(d, '.', '\.') || '>?\s*$'))
            or exists (select 1 from outside_claims o where o.kind = 'guest_insurer' and o.status <> 'closed'
                        and ((nullif(o.claim_no, '') is not null and strpos(lower(coalesce(b.subject, '') || ' ' || coalesce(b.body_text, '')), lower(o.claim_no)) > 0)
                          or (nullif(o.policy_no, '') is not null and strpos(lower(coalesce(b.subject, '') || ' ' || coalesce(b.body_text, '')), lower(o.policy_no)) > 0))))
  loop
    begin perform ins_mail_seen(m); exception when others then null; end;       -- self-heal: retry with the current matcher
    if exists (select 1 from ins_mail_links l where l.mail_id = m.id) then
      v_fixed := v_fixed + 1;
      perform bestly_raise('claims.ins_mail_unmatched.' || left(m.id::text, 8), 'resolved', 'info', 'Claims Closer matched the insurer email', null, null, null, true);
    else
      v_n := v_n + 1;
      perform bestly_raise('claims.ins_mail_unmatched.' || left(m.id::text, 8), 'problem', 'warning', 'Claims Closer could not match an insurer email',
        'Claims Closer here. "' || left(regexp_replace(coalesce(m.subject, ''), '\s+', ' ', 'g'), 160) || '" from ' || coalesce(m.from_addr, 'an insurer') || ' ('
          || to_char(m.sent_at at time zone 'America/Los_Angeles', 'Mon FMDD FMHH12:MI AM') || ') mentions a claim, but it did not match any insurance claim I have open. It is not on any card.', 'turo', null, false);
    end if;
  end loop;
  return jsonb_build_object('unmatched', v_n, 'healed', v_fixed);
end $$;

-- Wakes the edge function (drafting, photo copying) only when there is work for it, like claims_tick().
create or replace function public.ins_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not coalesce((select enabled from ins_settings where id), false) then return jsonb_build_object('enabled', false); end if;
  select (select count(*) from ins_drafts where status = 'writing') + (select count(*) from ins_jobs where runner = 'edge' and status = 'queued') into n;
  if n > 0 then
    begin perform invoke_edge_function('insurance-filer', jsonb_build_object('op', 'tick'), 90000); exception when others then null; end;
  end if;
  return jsonb_build_object('work', n);
end $$;

-- ============================================================================================================================
-- 15. Grants, team card, public-key RPC list
-- ============================================================================================================================
do $g$
declare f text;
begin
  -- internal: cron, triggers, other functions. No browser, no public key.
  foreach f in array array[
    'ins_digits(text)', 'ins_biz_open(timestamptz)', 'ins_next_biz_open(timestamptz)', 'ins_add_biz(timestamptz,integer)', 'ins_registry_find(text,text)',
    'ins_event(uuid,text,text,jsonb,uuid,timestamptz)', 'ins_notify(text,text,text,text)', 'ins_f(jsonb,jsonb,text,text,text,text,text,text,text)', 'ins_ans(jsonb,text)',
    'ins_loc_part(text,text)', 'ins_packet_core(jsonb)', 'ins_build_packet(uuid,uuid)', 'ins_queue(uuid,text,text,jsonb,boolean,integer)', 'ins_open_case(uuid)', 'ins_sweep()',
    'ins_claim_event_trg()', 'ins_case_insurer_trg()', 'ins_start_filing(uuid)', 'ins_make_errand(uuid,text)', 'ins_advance(uuid)', 'ins_set_claim_no(uuid,text,text)',
    'ins_match_mail(text,text,text)', 'ins_claim_no_from_text(text)', 'ins_is_noreply(text)', 'ins_mail_seen(bestly_mail)', 'ins_mail_trg()', 'ins_turo_mail(bestly_mail)',
    'ins_pick_attachments(uuid)', 'ins_draft_guard(uuid,text)', 'ins_draft_ready(uuid,text,text,jsonb)', 'ins_sig()', 'ins_draft_turo_reply(uuid,boolean)', 'ins_make_nudge(uuid)',
    'ins_follow_up(uuid)', 'ins_approval_create(uuid,text,text,jsonb,uuid,uuid,text)', 'ins_approval_decide_core(text,text,text,uuid,text)', 'ins_job_done(uuid,text,jsonb,text)',
    'ins_edge_take()', 'ins_draft_context(uuid)', 'ins_timeline(uuid)', 'ins_tesla_message(uuid)', 'ins_waiting_items()', 'ins_selftest()', 'ins_watch()',
    'ins_mail_unmatched_watch()', 'ins_tick()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- the signed-in admin pages (each checks admin inside)
  foreach f in array array['ins_approval_get(text)', 'ins_approval_decide(text,text,text,text)', 'ins_approval_exists(text)', 'ins_amount_add(uuid,text,numeric,text)',
                           'ins_registry_add(text,text,text,text[])', 'ins_resume(uuid)', 'ins_draft_edit(text,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- the Mac mini (watchdog token) and the Pi (worker token): public key, token-gated inside
  foreach f in array array['ins_mac_take(text)', 'ins_mac_done_t(text,uuid,text,jsonb,text)', 'ins_mac_packet_t(text,uuid)', 'ins_mac_beat_t(text,boolean,text)',
                           'ins_pi_take(text)', 'ins_pi_done(text,uuid,text,jsonb,text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end $g$;

insert into public.security_public_rpcs (fn, why) values
  ('ins_mac_take', 'Mac mini insurance filer takes its next job (watchdog token)'),
  ('ins_mac_done_t', 'Mac mini insurance filer reports a job (watchdog token)'),
  ('ins_mac_packet_t', 'Mac mini insurance filer rehearsal packet (watchdog token)'),
  ('ins_mac_beat_t', 'Mac mini insurance filer heartbeat (watchdog token)'),
  ('ins_pi_take', 'Pi Turo reader takes a claim-photo job (worker token)'),
  ('ins_pi_done', 'Pi Turo reader reports a claim-photo job (worker token)')
on conflict (fn) do nothing;

-- House rule: every bot gets a team card the day it goes live. The Mac filer beats every 5 minutes; 25 minutes of silence alerts.
-- Alerts it raises carry the 'claims.' prefix, which Claims Closer already owns, so they are signed Claims Closer.
select public.team_onboard($j$[
 {"slug":"insurance-filer","name":"Insurance Filer","role":"Files and chases the guest's insurance claim","tool_of":"claims-closer","runs_on":"mac-mini","icon":"file-check","schedule":"Every 5 min",
  "what_it_does":"When a Turo guest's own auto insurance is involved, opens the insurer's claim, fills it in from the damage report and photos, and stops for your one tap before sending. Then follows the adjuster: drafts replies with the photos and estimate attached, nudges after 2 business days, and queues a call if they stay quiet. Everything is signed Claims Closer and nothing goes out without your tap.",
  "pulse":{"src":"beat","gap":1500}}
]$j$::jsonb);

-- ============================================================================================================================
-- 16. ENABLE AT ROLLOUT (left commented on purpose). Order: edge function, Pi reader, Mac mini filer, then this, then the switch.
-- ============================================================================================================================
-- select cron.schedule('ins-sweep',                '*/5 * * * *',  'select public.ins_sweep();');            -- opens missed cases, moves every case one step, runs the nudge and call clocks
-- select cron.schedule('ins-tick',                 '*/5 * * * *',  'select public.ins_tick();');             -- wakes the edge function only when it has drafts or photo copies to do
-- select cron.schedule('ins-watch',                '*/10 * * * *', 'select public.ins_watch();');            -- watchdog: requeue stuck jobs, raise through bestly_raise, run the self-test
-- select cron.schedule('ins-mail-unmatched-watch', '*/15 * * * *', 'select public.ins_mail_unmatched_watch();');
-- update public.ins_settings set enabled = true, updated_at = now() where id;      -- THE SWITCH. Then: select public.ins_sweep();  (opens Cody's case)

-- ============================================================================================================================
-- UNDO (run top to bottom; it removes everything this file added, and restores the three patched functions from bestly_memory)
-- ============================================================================================================================
-- select cron.unschedule(jobname) from cron.job where jobname in ('ins-sweep', 'ins-tick', 'ins-watch', 'ins-mail-unmatched-watch');
-- update public.ins_settings set enabled = false where id;
-- drop trigger if exists ins_claim_event_trg on public.claim_events;
-- drop trigger if exists ins_case_insurer_trg on public.claim_cases;
-- drop trigger if exists ins_mail_trg on public.bestly_mail;
-- -- restore stuck_items_core, outside_claims_check, stuck_feed_selftest: open bestly_memory key
-- --   'build/insurance-filer-2026-10-29-undo-stuck-items-core' and run the three CREATE OR REPLACE statements in its body.
-- -- Close the Insurance Filer rows before dropping columns:   delete from public.outside_claims where kind = 'guest_insurer';
-- drop table if exists public.ins_mail_links, public.ins_amounts, public.ins_events, public.ins_drafts, public.ins_approvals, public.ins_photos, public.ins_jobs, public.ins_insurers, public.ins_settings cascade;
-- do $u$ declare r record; begin
--   for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'ins\_%' loop execute 'drop function ' || r.f || ' cascade'; end loop;
-- end $u$;
-- alter table public.outside_claims drop constraint if exists outside_claims_kind_check, drop constraint if exists outside_claims_ins_stage_check;
-- drop index if exists public.outside_claims_guest_case_uidx;
-- alter table public.outside_claims drop column if exists kind, drop column if exists case_id, drop column if exists reservation_id, drop column if exists insurer_slug,
--   drop column if exists policy_no, drop column if exists policyholder, drop column if exists driver_name, drop column if exists driver_phone, drop column if exists adjuster_name,
--   drop column if exists adjuster_email, drop column if exists adjuster_phone, drop column if exists filed_at, drop column if exists ins_stage, drop column if exists packet,
--   drop column if exists packet_hash, drop column if exists photo_set, drop column if exists last_inbound_at, drop column if exists last_outbound_at, drop column if exists internal;
-- delete from public.privacy_data_map where table_name in ('ins_drafts', 'ins_settings', 'ins_insurers') or (table_name = 'outside_claims' and column_name in ('adjuster_email', 'adjuster_phone', 'driver_phone'));
-- delete from public.security_public_rpcs where fn in ('ins_mac_take', 'ins_mac_done_t', 'ins_mac_packet_t', 'ins_mac_beat_t', 'ins_pi_take', 'ins_pi_done');
-- delete from public.bestly_agents where slug = 'insurance-filer';
-- -- The bucket insurance-photos: empty it in Storage first, then   delete from storage.buckets where id = 'insurance-photos';
-- -- The four Turo-matcher functions in section 1 were live before this file; leave them.
