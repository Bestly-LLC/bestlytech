-- RoofGuard Outreach moves off the Claude scheduled task onto the Pi (Jared, 2026-10-11 2:20 PM): free AI, weekdays 9:00 AM PT.
--
-- Old home (Claude scheduled task, DISABLED once the Pi version ran OK, kept as the fallback):
--   trig_01VAw9GEZHXnWp2SSb6Rn9ZD  "RoofGuard Daily Outreach"   (slug roofguard-outreach)
-- New home: Pi cron job roofguard_outreach (tools/roofguard-outreach/). DRAFT-ONLY: the Pi job never sends anything. It writes
-- drafts to rg_outreach_drafts; Jared reads them on /admin/roofguard-outreach, sends the ones he likes from his own mail, and taps
-- "I sent it". Nothing in this file or in the job can email a business.
--
-- The contacted ledger used to live in mempalace wing "roofguard_lbmc", room "contacted_ledger". That wing no longer exists and the Pi
-- cannot reach mempalace, so the ledger is rebuilt here: rg_outreach_ledger. It is seeded with the six Loop-1 companies (2026-08-11,
-- addresses were not recorded anywhere that survived) and the six phone-only companies. Anyone contacted after 2026-08-11 whose
-- record was lost is caught a second way: before a new lead is drafted the job checks bestly_mail and bestly_sent_mail for any mail
-- to or from that domain, and skips it if there is any.
--
-- Hard rules from the old prompt are enforced here too, in constraints, so no code path can bypass them:
--   never the word "replacement"; compliance footer (address + "STOP") on every email; BCC is always jared@bestly.tech;
--   phone-only companies and opted-out / bounced / replied contacts can never get a first-touch or follow-up draft.

create table if not exists public.rg_outreach_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,                         -- drafting on/off (there is no sending to switch on)
  daily_first_touch_cap integer not null default 10 check (daily_first_touch_cap between 1 and 30),
  pending_cap integer not null default 40 check (pending_cap between 5 and 200),   -- stop drafting while this many wait unreviewed
  updated_at timestamptz not null default now()
);
insert into public.rg_outreach_settings (id) values (true) on conflict (id) do nothing;
alter table public.rg_outreach_settings enable row level security;
revoke all on public.rg_outreach_settings from anon, authenticated;

create table if not exists public.rg_outreach_ledger (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  name_key text not null,                                        -- company name, lowercase letters and digits only
  domain text not null unique,                                   -- lowercase, no www; 'unknown:<name_key>' when only the name is known
  website text,
  email text,                                                    -- verified off the company's own site; null = cannot be emailed
  phone text,
  contact_name text,
  contact_title text,
  city text,
  state text,
  tz text,
  track text check (track in ('A', 'B')),
  services text,
  fit_note text,                                                 -- one line, from their own site, used in the Eli intro
  hook_quote text,                                               -- exact words from their site behind the first-line hook
  hook_url text,
  call_score integer not null default 0,
  called_at date,
  status text not null default 'new' check (status in ('new', 'active', 'resting', 'replied', 'interested', 'introduced', 'needs_review',
                                                         'opted_out', 'bounced', 'phone_only', 'retired')),
  loop_no integer not null default 1 check (loop_no between 1 and 3),
  touches integer not null default 0 check (touches between 0 and 3),
  loop_started date,
  last_touch_at date,
  next_due date,
  thread_subject text,
  review_note text,                                              -- what a reply said (first 300 characters, addresses and numbers removed)
  note text,
  source text not null default 'research',                       -- seed | research | manual
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rg_outreach_ledger_name_key_idx on public.rg_outreach_ledger (name_key);
create index if not exists rg_outreach_ledger_status_idx on public.rg_outreach_ledger (status);
alter table public.rg_outreach_ledger enable row level security;
revoke all on public.rg_outreach_ledger from anon, authenticated;

create table if not exists public.rg_outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.rg_outreach_ledger (id) on delete cascade,
  kind text not null check (kind in ('first', 'touch2', 'touch3', 'loop2', 'loop3', 'intro', 'summary_reply')),
  to_email text not null,
  cc text,
  bcc text not null default 'jared@bestly.tech' check (bcc = 'jared@bestly.tech'),
  subject text not null,
  body text not null,
  hook_quote text,
  hook_url text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped')),
  run_date date not null default ((now() at time zone 'America/Los_Angeles')::date),
  decided_at timestamptz,
  decided_note text,
  created_at timestamptz not null default now(),
  -- the old prompt's absolute rules, as constraints
  constraint rg_no_replacement check (body !~* 'replacement' and subject !~* 'replacement'),
  constraint rg_compliance_footer check (position('733 N Kings Rd #205, Los Angeles, CA 90069' in body) > 0 and position('Reply "STOP"' in body) > 0)
);
create index if not exists rg_outreach_drafts_status_idx on public.rg_outreach_drafts (status, created_at);
create index if not exists rg_outreach_drafts_ledger_idx on public.rg_outreach_drafts (ledger_id);
alter table public.rg_outreach_drafts enable row level security;
revoke all on public.rg_outreach_drafts from anon, authenticated;

-- Replies, bounces and opt-outs already handled, so a mail is acted on once. Holds a mail id only, never an address or text.
create table if not exists public.rg_outreach_events (
  mail_id text primary key,
  ledger_id uuid references public.rg_outreach_ledger (id) on delete cascade,
  kind text not null,
  seen_at timestamptz not null default now()
);
alter table public.rg_outreach_events enable row level security;
revoke all on public.rg_outreach_events from anon, authenticated;

-- ------------------------------------------------------------------ privacy map (Vera)
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason) values
  ('rg_outreach_ledger', 'email', 'email', 'review', 'Opt-out suppression: we must remember who said STOP. Jared decides per person whether to delete or keep.'),
  ('rg_outreach_ledger', 'phone', 'phone', 'review', 'Business phone off the company''s own site, used for the call sheet. Jared decides per person.'),
  ('rg_outreach_drafts', 'to_email', 'email', 'delete', null),
  ('rg_outreach_drafts', 'cc', 'email', 'keep', 'Eli Cooper''s fixed work address on introductions; not a recipient''s private data.'),
  ('rg_outreach_drafts', 'bcc', 'email', 'keep', 'Jared''s own address; a constraint forces it on every email.')
on conflict (table_name, column_name) do nothing;

-- ------------------------------------------------------------------ seed (the only records that survived)
insert into public.rg_outreach_ledger (company, name_key, domain, status, loop_no, touches, loop_started, last_touch_at, next_due, note, source)
select v.company, regexp_replace(lower(v.company), '[^a-z0-9]', '', 'g'), 'unknown:' || regexp_replace(lower(v.company), '[^a-z0-9]', '', 'g'),
       'resting', 1, 1, date '2026-08-11', date '2026-08-11', date '2026-10-25',
       'Loop 1 first touch sent 2026-08-11 without BCC. The ledger was lost after 2026-08-25, so later touches are unknown. No address was recorded: it cannot be drafted.', 'seed'
from (values ('Burtin & Associates'), ('Reliable Maintenance'), ('Kunz Janitorial'), ('Building Services Inc Chattanooga'),
             ('Oklahoma Facility Services'), ('Tri-State Building Services')) as v(company)
on conflict (domain) do nothing;

insert into public.rg_outreach_ledger (company, name_key, domain, status, note, source)
select v.company, regexp_replace(lower(v.company), '[^a-z0-9]', '', 'g'), 'unknown:' || regexp_replace(lower(v.company), '[^a-z0-9]', '', 'g'),
       'phone_only', 'Phone only: call sheet, NEVER email.', 'seed'
from (values ('Arkansas Building Services'), ('Ahlers Building Maintenance'), ('Corporate Clean Peoria'), ('Katsam Property Services'),
             ('Commercial Building Services STL'), ('Commercial Service Company Little Rock')) as v(company)
on conflict (domain) do nothing;

-- ------------------------------------------------------------------ Pi-side functions (service role only)
create or replace function public.rg_outreach_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from rg_outreach_settings s where id),
    'today', (now() at time zone 'America/Los_Angeles')::date,
    'pending', (select count(*) from rg_outreach_drafts where status = 'pending'),
    'first_today', (select count(*) from rg_outreach_drafts where kind = 'first' and run_date = (now() at time zone 'America/Los_Angeles')::date),
    'pending_ledger_ids', (select coalesce(jsonb_agg(distinct ledger_id), '[]'::jsonb) from rg_outreach_drafts where status = 'pending'),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'company', company, 'name_key', name_key, 'domain', domain, 'email', email, 'contact_name', contact_name,
        'city', city, 'state', state, 'track', track, 'fit_note', fit_note, 'status', status, 'loop_no', loop_no, 'touches', touches,
        'last_touch_at', last_touch_at, 'next_due', next_due, 'thread_subject', thread_subject)), '[]'::jsonb) from rg_outreach_ledger)
  )
$$;
revoke all on function public.rg_outreach_state() from public, anon, authenticated;
grant execute on function public.rg_outreach_state() to service_role;

-- Add a researched company, or fill blanks on one already there. Never changes status, never overwrites a value that is set.
create or replace function public.rg_outreach_ledger_upsert(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_domain text := lower(trim(p->>'domain')); v_key text := regexp_replace(lower(coalesce(p->>'company', '')), '[^a-z0-9]', '', 'g');
begin
  if v_domain is null or v_domain = '' or coalesce(p->>'company', '') = '' then raise exception 'company and domain are required'; end if;
  select id into v_id from rg_outreach_ledger where domain = v_domain or name_key = v_key limit 1;
  if v_id is null then
    insert into rg_outreach_ledger (company, name_key, domain, website, email, phone, contact_name, contact_title, city, state, tz, track, services,
                                    fit_note, hook_quote, hook_url, call_score, status, note, source)
    values (p->>'company', v_key, v_domain, p->>'website', nullif(lower(p->>'email'), ''), p->>'phone', p->>'contact_name', p->>'contact_title',
            p->>'city', p->>'state', p->>'tz', p->>'track', p->>'services', p->>'fit_note', p->>'hook_quote', p->>'hook_url',
            coalesce(nullif(p->>'call_score', '')::integer, 0),
            case when nullif(p->>'email', '') is null then 'phone_only' else 'new' end, p->>'note', coalesce(p->>'source', 'research'))
    returning id into v_id;
  else
    update rg_outreach_ledger set
      website = coalesce(website, p->>'website'), email = coalesce(email, nullif(lower(p->>'email'), '')), phone = coalesce(phone, p->>'phone'),
      contact_name = coalesce(contact_name, p->>'contact_name'), contact_title = coalesce(contact_title, p->>'contact_title'),
      city = coalesce(city, p->>'city'), state = coalesce(state, p->>'state'), tz = coalesce(tz, p->>'tz'), track = coalesce(track, p->>'track'),
      services = coalesce(services, p->>'services'), fit_note = coalesce(fit_note, p->>'fit_note'),
      hook_quote = coalesce(hook_quote, p->>'hook_quote'), hook_url = coalesce(hook_url, p->>'hook_url'), updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.rg_outreach_ledger_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.rg_outreach_ledger_upsert(jsonb) to service_role;

-- Move a contact to a new status after a reply / bounce / opt-out. opted_out and bounced are permanent. Any halt skips waiting follow-ups.
create or replace function public.rg_outreach_ledger_status(p_id uuid, p_status text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if p_status not in ('replied', 'interested', 'introduced', 'needs_review', 'opted_out', 'bounced', 'resting', 'retired') then raise exception 'bad status %', p_status; end if;
  select status into cur from rg_outreach_ledger where id = p_id;
  if cur is null then raise exception 'unknown contact'; end if;
  if cur in ('opted_out', 'bounced') and p_status not in ('opted_out', 'bounced') then return cur; end if;
  if cur = 'phone_only' then return cur; end if;
  update rg_outreach_ledger set status = p_status, review_note = coalesce(left(p_note, 300), review_note), updated_at = now() where id = p_id;
  if p_status in ('replied', 'interested', 'introduced', 'needs_review', 'opted_out', 'bounced', 'retired') then
    update rg_outreach_drafts set status = 'skipped', decided_at = now(), decided_note = 'Skipped automatically: contact status is now ' || p_status
     where ledger_id = p_id and status = 'pending' and kind in ('first', 'touch2', 'touch3', 'loop2', 'loop3');
  end if;
  return p_status;
end $$;
revoke all on function public.rg_outreach_ledger_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rg_outreach_ledger_status(uuid, text, text) to service_role;

-- Queue a draft. Refuses anything the old prompt forbade.
create or replace function public.rg_outreach_draft_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare l rg_outreach_ledger; v_id uuid; v_kind text := p->>'kind';
begin
  select * into l from rg_outreach_ledger where id = (p->>'ledger_id')::uuid;
  if l.id is null then raise exception 'unknown contact'; end if;
  if v_kind not in ('first', 'touch2', 'touch3', 'loop2', 'loop3', 'intro', 'summary_reply') then raise exception 'bad kind'; end if;
  if l.status = 'phone_only' then raise exception 'phone-only company: call sheet only, never email'; end if;
  if l.status in ('opted_out', 'bounced') then raise exception 'contact opted out or bounced: never email again'; end if;
  if v_kind in ('first', 'touch2', 'touch3', 'loop2', 'loop3') then
    if l.email is null or lower(coalesce(p->>'to_email', '')) <> l.email then raise exception 'no verified address for this contact'; end if;
  elsif coalesce(p->>'to_email', '') = '' then
    raise exception 'no address to write to';
  end if;
  if v_kind in ('first', 'touch2', 'touch3', 'loop2', 'loop3') and l.status in ('replied', 'interested', 'introduced', 'needs_review', 'retired') then
    raise exception 'contact has replied or is retired: no more touches';
  end if;
  if v_kind = 'first' and (l.status <> 'new' or l.touches <> 0) then raise exception 'first touch already used'; end if;
  if exists (select 1 from rg_outreach_drafts where ledger_id = l.id and status = 'pending' and kind = v_kind) then raise exception 'a draft of this kind is already waiting'; end if;
  insert into rg_outreach_drafts (ledger_id, kind, to_email, cc, subject, body, hook_quote, hook_url)
  values (l.id, v_kind, lower(p->>'to_email'), nullif(p->>'cc', ''), p->>'subject', p->>'body', p->>'hook_quote', p->>'hook_url')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.rg_outreach_draft_add(jsonb) from public, anon, authenticated;
grant execute on function public.rg_outreach_draft_add(jsonb) to service_role;

create or replace function public.rg_outreach_event_add(p_mail_id text, p_ledger_id uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into rg_outreach_events (mail_id, ledger_id, kind) values (p_mail_id, p_ledger_id, p_kind) on conflict (mail_id) do nothing;
  return found;
end $$;
revoke all on function public.rg_outreach_event_add(text, uuid, text) from public, anon, authenticated;
grant execute on function public.rg_outreach_event_add(text, uuid, text) to service_role;

-- Mail that may be a reply, opt-out or bounce about someone in the ledger (last N days). Compact: the Pi reads, never writes, mail.
create or replace function public.rg_outreach_mail_scan(p_days integer default 30) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select jsonb_build_object('mail_id', coalesce(m.message_id, m.id::text), 'ledger_id', l.id,
             'hint', case when lower(m.from_addr) ~ '(mailer-daemon|postmaster)' or m.subject ~* '(undeliverable|delivery status|returned mail|failure notice|delivery has failed)' then 'bounce' else 'reply' end,
             'from_addr', m.from_addr, 'subject', m.subject, 'sent_at', m.sent_at, 'text', left(coalesce(m.body_text, ''), 1500)) as x
      from bestly_mail m
      join rg_outreach_ledger l
        on (l.domain not like 'unknown:%' and lower(split_part(m.from_addr, '@', 2)) = l.domain)
        or (l.email is not null and position(l.email in lower(coalesce(m.body_text, ''))) > 0
            and (lower(m.from_addr) ~ '(mailer-daemon|postmaster)' or m.subject ~* '(undeliverable|delivery status|returned mail|failure notice|delivery has failed)'))
     where m.sent_at > now() - make_interval(days => greatest(p_days, 1))
       and lower(coalesce(m.from_addr, '')) not like '%@bestly.tech'
     order by m.sent_at desc
     limit 200
  ) q
$$;
revoke all on function public.rg_outreach_mail_scan(integer) from public, anon, authenticated;
grant execute on function public.rg_outreach_mail_scan(integer) to service_role;

-- Any mail ever to or from this domain or address? (catches earlier contacts whose ledger record was lost)
create or replace function public.rg_outreach_mail_seen(p_domain text, p_email text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from bestly_mail m where lower(split_part(coalesce(m.from_addr, ''), '@', 2)) = lower(p_domain)
                   or exists (select 1 from unnest(m.to_addrs) a where lower(split_part(a, '@', 2)) = lower(p_domain)))
      or exists (select 1 from bestly_sent_mail s where lower(coalesce(s.to_addrs, '')) like '%@' || lower(p_domain) || '%')
$$;
revoke all on function public.rg_outreach_mail_seen(text, text) from public, anon, authenticated;
grant execute on function public.rg_outreach_mail_seen(text, text) to service_role;

-- ------------------------------------------------------------------ admin functions (Jared's page)
create or replace function public.rg_outreach_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from rg_outreach_settings s where id),
    'job', (select to_jsonb(j) from (select job, description, last_run_at, last_ok, last_summary, replaced_claude_task from pi_jobs where job = 'roofguard_outreach') j),
    'counts', jsonb_build_object(
      'pending', (select count(*) from rg_outreach_drafts where status = 'pending'),
      'sent_total', (select count(*) from rg_outreach_drafts where status = 'sent'),
      'active', (select count(*) from rg_outreach_ledger where status = 'active'),
      'resting', (select count(*) from rg_outreach_ledger where status = 'resting'),
      'replied', (select count(*) from rg_outreach_ledger where status in ('replied', 'interested', 'introduced', 'needs_review')),
      'introduced', (select count(*) from rg_outreach_ledger where status = 'introduced'),
      'opted_out', (select count(*) from rg_outreach_ledger where status = 'opted_out'),
      'bounced', (select count(*) from rg_outreach_ledger where status = 'bounced'),
      'ledger', (select count(*) from rg_outreach_ledger)),
    'drafts', (select coalesce(jsonb_agg(to_jsonb(d) order by d.kind in ('intro', 'summary_reply') desc, d.created_at), '[]'::jsonb) from (
        select d.id, d.kind, d.to_email, d.cc, d.bcc, d.subject, d.body, d.hook_quote, d.hook_url, d.created_at, l.company, l.city, l.state, l.track
          from rg_outreach_drafts d join rg_outreach_ledger l on l.id = d.ledger_id where d.status = 'pending' order by d.created_at limit 80) d),
    'review', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'company', company, 'status', status, 'review_note', review_note, 'updated_at', updated_at)
                  order by updated_at desc), '[]'::jsonb) from rg_outreach_ledger where status = 'needs_review'),
    'calls', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (
        select id, company, city, state, track, tz, phone, contact_name, contact_title, services, fit_note, status, (status <> 'phone_only' and last_touch_at is not null) as emailed
          from rg_outreach_ledger
         where phone is not null and called_at is null and status in ('phone_only', 'new', 'active', 'resting')
         order by (status = 'phone_only') desc, call_score desc, updated_at desc limit 10) c),
    'recent', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
        select d.id, d.kind, d.status, d.subject, d.decided_at, l.company from rg_outreach_drafts d join rg_outreach_ledger l on l.id = d.ledger_id
         where d.status <> 'pending' order by d.decided_at desc nulls last limit 8) r)
  );
end $$;
revoke all on function public.rg_outreach_admin() from public, anon;
grant execute on function public.rg_outreach_admin() to authenticated, service_role;

create or replace function public.rg_outreach_set(p_enabled boolean default null, p_daily_cap integer default null, p_pending_cap integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  if p_daily_cap is not null and p_daily_cap not between 1 and 30 then raise exception 'Daily drafts must be 1 to 30'; end if;
  if p_pending_cap is not null and p_pending_cap not between 5 and 200 then raise exception 'Waiting drafts must be 5 to 200'; end if;
  update rg_outreach_settings set enabled = coalesce(p_enabled, enabled), daily_first_touch_cap = coalesce(p_daily_cap, daily_first_touch_cap),
         pending_cap = coalesce(p_pending_cap, pending_cap), updated_at = now() where id;
  return rg_outreach_admin();
end $$;
revoke all on function public.rg_outreach_set(boolean, integer, integer) from public, anon;
grant execute on function public.rg_outreach_set(boolean, integer, integer) to authenticated, service_role;

-- Jared decides a draft: sent (he sent it from his own mail), skipped, or never (do not contact this company again).
create or replace function public.rg_outreach_draft_decide(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d rg_outreach_drafts; l rg_outreach_ledger; v_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  if p_action not in ('sent', 'skipped', 'never') then raise exception 'bad action'; end if;
  select * into d from rg_outreach_drafts where id = p_id and status = 'pending';
  if d.id is null then raise exception 'That draft is not waiting any more'; end if;
  select * into l from rg_outreach_ledger where id = d.ledger_id;
  if p_action = 'never' then
    update rg_outreach_drafts set status = 'skipped', decided_at = now(), decided_note = coalesce(p_note, 'Never contact again') where id = d.id;
    perform rg_outreach_ledger_status(l.id, 'opted_out', 'Marked never contact by Jared');
  elsif p_action = 'skipped' then
    update rg_outreach_drafts set status = 'skipped', decided_at = now(), decided_note = p_note where id = d.id;
    if d.kind = 'first' then update rg_outreach_ledger set status = 'retired', note = coalesce(note, '') || ' Skipped by Jared before the first touch.', updated_at = now() where id = l.id; end if;
  else
    update rg_outreach_drafts set status = 'sent', decided_at = now(), decided_note = p_note where id = d.id;
    if d.kind in ('first', 'loop2', 'loop3') then
      update rg_outreach_ledger set status = 'active', loop_no = case d.kind when 'first' then 1 when 'loop2' then 2 else 3 end, touches = 1, loop_started = v_today,
             last_touch_at = v_today, next_due = v_today + 4, thread_subject = d.subject, updated_at = now() where id = l.id;
    elsif d.kind = 'touch2' then
      update rg_outreach_ledger set touches = 2, last_touch_at = v_today, next_due = v_today + 5, updated_at = now() where id = l.id;
    elsif d.kind = 'touch3' then
      update rg_outreach_ledger set touches = 3, last_touch_at = v_today,
             status = case when l.loop_no >= 3 then 'retired' else 'resting' end,
             next_due = case when l.loop_no >= 3 then null else coalesce(l.loop_started, v_today) + 75 end, updated_at = now() where id = l.id;
    elsif d.kind = 'intro' then
      update rg_outreach_ledger set status = 'introduced', updated_at = now() where id = l.id;
    end if;
  end if;
  return rg_outreach_admin();
end $$;
revoke all on function public.rg_outreach_draft_decide(uuid, text, text) from public, anon;
grant execute on function public.rg_outreach_draft_decide(uuid, text, text) to authenticated, service_role;

-- Jared sorts a reply the Pi could not read with confidence.
create or replace function public.rg_outreach_review_decide(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  if p_action not in ('interested', 'not_interested', 'opt_out') then raise exception 'bad action'; end if;
  perform rg_outreach_ledger_status(p_id, case p_action when 'interested' then 'interested' when 'opt_out' then 'opted_out' else 'retired' end, null);
  return rg_outreach_admin();
end $$;
revoke all on function public.rg_outreach_review_decide(uuid, text) from public, anon;
grant execute on function public.rg_outreach_review_decide(uuid, text) to authenticated, service_role;

create or replace function public.rg_outreach_called(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  update rg_outreach_ledger set called_at = (now() at time zone 'America/Los_Angeles')::date, updated_at = now() where id = p_id;
  return rg_outreach_admin();
end $$;
revoke all on function public.rg_outreach_called(uuid) from public, anon;
grant execute on function public.rg_outreach_called(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ watchdog
insert into public.pi_jobs (job, description, max_gap_min, enabled, replaced_claude_task) values
 ('roofguard_outreach', 'RoofGuard Outreach: weekdays 9:00 AM drafts partner-recruit emails for Jared''s approval (nothing is sent), advances follow-ups, reads replies, builds the call sheet', 4400, true, 'trig_01VAw9GEZHXnWp2SSb6Rn9ZD')
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, replaced_claude_task = excluded.replaced_claude_task;
