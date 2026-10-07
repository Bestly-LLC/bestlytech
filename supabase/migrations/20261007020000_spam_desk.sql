-- 2026-10-07 Spam Desk (opusplan: docs/scout-vision-spam-opusplan.md, Part C).
-- Jared: "Put a Spam button on Replies ready that reports spam to Apple and every other party, records it, and if we
-- can collect damages like DoNotPay, do that." Phishing like "Secure Parcel Services" kept turning into reply drafts.
--
-- What this adds (all new, nothing existing is changed):
--   spam_reports          one row per reported email (tap, auto-caught, or a blocked sender writing again)
--   mail_blocklist        sender addresses and domains that never get drafts again; blocked mail goes to Junk
--   spam_report_targets   who takes reports, with the source page we verified the address on (verified addresses only)
--   mail_verdicts         what the hourly check decided about each new email (so nothing is judged twice)
--   spam_claims           damages file for commercial spam (California 17529.5); Jared approves every send
--   storage bucket spam-mail   the original .eml of every reported email (private, admin read)
--   cron spam-desk-auto   hourly at :07, owned by the new employee "Spam Desk" (reports to Ares)
-- Writes go through the spam-desk edge function (service key); the admin page only reads these tables.
-- Ares locks anon-callable SECURITY DEFINER functions: nothing here is granted to anon.

-- ------------------------------------------------------------------ reports
create table if not exists public.spam_reports (
  id             uuid primary key default gen_random_uuid(),
  mail_id        uuid,                                   -- bestly_mail.id
  mailbox        text not null,
  message_id     text not null,                          -- bestly_mail.message_id, or 'id:<mail id>' when it had none
  from_addr      text,
  from_name      text,
  subject        text,
  sent_at        timestamptz,
  verdict        text not null check (verdict in ('phishing', 'commercial', 'spam')),
  how            text not null check (how in ('tap', 'auto', 'blocked')),
  brand          text,
  reasons        text[] not null default '{}',
  status         text not null default 'queued'
                   check (status in ('queued', 'fetching', 'ready', 'sent', 'failed', 'undone', 'junk_only')),
  targets        jsonb not null default '[]'::jsonb,     -- [{email, source, ok, error}]
  sent_to        text[] not null default '{}',
  eml_path       text,
  error          text,
  error_code     text,
  tries          int not null default 0,
  claimed_at     timestamptz,
  junked_at      timestamptz,
  draft_id       uuid,                                   -- the Replies ready card this came from
  undo           jsonb not null default '{}'::jsonb,     -- what the tap changed, so Undo can put it back
  created_by     uuid,
  created_at     timestamptz not null default now(),
  sent_at_report timestamptz,
  updated_at     timestamptz not null default now(),
  unique (mailbox, message_id)
);
create index if not exists spam_reports_status_idx on public.spam_reports (status, created_at);
create index if not exists spam_reports_created_idx on public.spam_reports (created_at desc);

-- ------------------------------------------------------------------ blocklist
create table if not exists public.mail_blocklist (
  id         uuid primary key default gen_random_uuid(),
  pattern    text not null unique,                       -- lower-case address or domain
  kind       text not null check (kind in ('address', 'domain')),
  reason     text,
  report_id  uuid references public.spam_reports (id) on delete set null,
  created_at timestamptz not null default now(),
  active     boolean not null default true
);
create index if not exists mail_blocklist_active_idx on public.mail_blocklist (active, kind);

-- ------------------------------------------------------------------ who takes reports
create table if not exists public.spam_report_targets (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  applies          text not null default 'all' check (applies in ('phishing', 'spam', 'all')),
  mailbox          text,                                 -- null = any mailbox
  brand_keywords   text[] not null default '{}',         -- empty = no brand test; else any word in the mail's sender, subject, body
  subject_override text,                                 -- IRS asks for the subject "IRS"
  note             text,
  source_url       text not null,                        -- the page we verified this address on
  verified_on      date not null default current_date,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------------------------ what the hourly check decided
create table if not exists public.mail_verdicts (
  mail_id    uuid primary key,
  verdict    text not null check (verdict in ('legit', 'phishing', 'commercial', 'spam', 'unsure')),
  confidence numeric,
  brand      text,
  reasons    text[] not null default '{}',
  business   text,
  us_business boolean,
  at         timestamptz not null default now()
);

-- ------------------------------------------------------------------ damages file
create table if not exists public.spam_claims (
  id               uuid primary key default gen_random_uuid(),
  advertiser_domain text not null unique,
  business_name    text,
  contact_email    text,
  contact_address  text,
  email_count      int not null default 0,
  report_ids       uuid[] not null default '{}',
  first_at         timestamptz,
  last_at          timestamptz,
  amount_claimed   numeric not null default 0,           -- email_count x $1,000 (what the statute allows, not a promise)
  statute_note     text,
  demand_letter    text,
  status           text not null default 'open' check (status in ('open', 'drafted', 'approved', 'sent', 'paid', 'closed')),
  sent_at          timestamptz,
  sent_to          text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ------------------------------------------------------------------ security: RLS on, admins read, service role writes
alter table public.spam_reports enable row level security;
alter table public.mail_blocklist enable row level security;
alter table public.spam_report_targets enable row level security;
alter table public.mail_verdicts enable row level security;
alter table public.spam_claims enable row level security;
revoke all on public.spam_reports, public.mail_blocklist, public.spam_report_targets, public.mail_verdicts, public.spam_claims from anon, authenticated;
grant select on public.spam_reports, public.mail_blocklist, public.spam_report_targets, public.mail_verdicts, public.spam_claims to authenticated;

do $$ declare t text; begin
  foreach t in array array['spam_reports', 'mail_blocklist', 'spam_report_targets', 'mail_verdicts', 'spam_claims'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (public.has_role(auth.uid(), 'admin'))$p$, t || '_admin_read', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ storage: the original .eml of each reported email
insert into storage.buckets (id, name, public, file_size_limit)
values ('spam-mail', 'spam-mail', false, 10485760)
on conflict (id) do nothing;
drop policy if exists "spam mail: admin reads" on storage.objects;
create policy "spam mail: admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'spam-mail' and public.has_role(auth.uid(), 'admin'));

create unique index if not exists spam_report_targets_uniq on public.spam_report_targets (lower(email), applies, coalesce(mailbox, ''));

-- ------------------------------------------------------------------ who gets reports (verified 2026-10-06, source page kept on each row)
-- Only addresses read off the owner's own page today. Not added because they could not be confirmed:
-- FTC spam@uce.gov (the FTC says it retired that mailbox), UPS, DHL, Microsoft (reportphishing@microsoft.com bounces),
-- Namecheap Private Email (abuse@namecheap.com takes reports about Namecheap customers, not mailbox spam training).
insert into public.spam_report_targets (email, applies, mailbox, brand_keywords, subject_override, note, source_url, verified_on) values
 ('abuse@icloud.com',          'all',      'jaredbest@icloud.com', '{}', null,
  'Apple: send harassment, impersonation and other abuse received in an iCloud inbox here (Jared asked for it on every iCloud report).',
  'https://support.apple.com/en-us/102568', '2026-10-06'),
 ('reportphishing@apple.com',  'all',      'jaredbest@icloud.com', '{}', null,
  'Apple: forward suspicious email here (Jared asked for it on every iCloud report).',
  'https://support.apple.com/en-us/102568', '2026-10-06'),
 ('reportphishing@apple.com',  'phishing', null, array['apple','icloud','apple id'], null,
  'Apple: phishing that looks like it is from Apple, in any mailbox.',
  'https://support.apple.com/en-us/102568', '2026-10-06'),
 ('reportphishing@apwg.org',   'phishing', null, '{}', null,
  'Anti-Phishing Working Group: every phishing email. APWG asks for forward-as-attachment, which is how reports are sent.',
  'https://apwg.org/reportphishing/', '2026-10-06'),
 ('spam@uspis.gov',            'phishing', null, array['usps','postal service','postal inspection','parcel'], null,
  'US Postal Inspection Service: fake USPS and package-delivery email.',
  'https://www.uspis.gov/news/scam-article/fake-usps-emails', '2026-10-06'),
 ('stop-spoofing@amazon.com',  'phishing', null, array['amazon','prime video'], null,
  'Amazon: forged Amazon email.',
  'https://aws.amazon.com/security/report-suspicious-emails/', '2026-10-06'),
 ('phishing@paypal.com',       'phishing', null, array['paypal'], null,
  'PayPal: forward the entire suspicious email.',
  'https://www.paypal.com/us/security/report-suspicious-messages', '2026-10-06'),
 ('phishing@chase.com',        'phishing', null, array['chase','jpmorgan'], null,
  'Chase: forward suspicious email claiming to be from Chase.',
  'https://www.chase.com/digital/resources/privacy-security/security/how-to-spot-scams', '2026-10-06'),
 ('reportphish@wellsfargo.com','phishing', null, array['wells fargo','wellsfargo'], null,
  'Wells Fargo: email suspicious messages that mention Wells Fargo (some forwards are rejected by their server).',
  'https://www.wellsfargo.com/privacy-security/fraud/report/phish/', '2026-10-06'),
 ('abuse@bofa.com',            'phishing', null, array['bank of america','bankofamerica','bofa'], null,
  'Bank of America: forward suspicious email that uses the bank''s name.',
  'https://web.bankofamerica.com/en/security/report-suspicious-activity', '2026-10-06'),
 ('phishing@irs.gov',          'phishing', null, array['irs','internal revenue','treasury'], 'IRS',
  'IRS: send fake IRS or Treasury email with the subject line "IRS".',
  'https://www.irs.gov/privacy-disclosure/report-phishing', '2026-10-06'),
 ('abuse@fedex.com',           'phishing', null, array['fedex'], null,
  'FedEx: forward suspicious messages claiming to be from FedEx.',
  'https://www.fedex.com/en-us/report-fraud.html', '2026-10-06'),
 ('phishing@netflix.com',      'phishing', null, array['netflix'], null,
  'Netflix: forward suspicious email.',
  'https://help.netflix.com/en/node/65674', '2026-10-06')
on conflict do nothing;

-- ------------------------------------------------------------------ is this sender blocked? (admin pages and Scout; never anon)
create or replace function public.spam_blocked(p_from text) returns boolean
language sql stable set search_path = public as $$
  with a as (select lower(coalesce(substring(p_from from '<([^>]+)>'), p_from)) addr),
       d as (select addr, split_part(addr, '@', 2) dom from a)
  select exists (
    select 1 from mail_blocklist b, d
     where b.active and ((b.kind = 'address' and b.pattern = d.addr)
                      or (b.kind = 'domain' and (d.dom = b.pattern or d.dom like '%.' || b.pattern))));
$$;
revoke all on function public.spam_blocked(text) from public, anon;
grant execute on function public.spam_blocked(text) to authenticated, service_role;

-- ------------------------------------------------------------------ the hourly job
do $$ begin perform cron.unschedule('spam-desk-auto'); exception when others then null; end $$;
select cron.schedule('spam-desk-auto', '7 * * * *',
  $$select public.invoke_edge_function('spam-desk', '{"op":"auto"}'::jsonb, 150000)$$);

-- ------------------------------------------------------------------ team card: Spam Desk reports to Ares
-- welcome:false on purpose. The card must not announce a new employee before the spam-desk function is deployed;
-- the lead re-runs team_onboard for slug spam-desk (without welcome:false) once the function is live.
select public.team_onboard($j$[
 {"slug":"spam-desk","name":"Spam Desk","role":"Mail spam and phishing handler","reports_to":"security-auditor","runs_on":"cloud","icon":"shield-alert","welcome":false,
  "schedule":"hourly at :07","admin_url":"/admin/spam","sort":55,
  "what_it_does":"Catches phishing and spam in Jared's two mailboxes. Clear phishing from someone he never wrote to is reported on its own (Apple, the anti-phishing groups, the impersonated brand, the sender's network and registrar) and listed in the 7 PM recap; unsure mail becomes a Spam? card instead of a reply draft. Tapping Spam on a Replies ready card does the same, moves the email to Junk and blocks the sender. Commercial spam from a US business opens a damages file with a drafted letter; nothing is sent without Jared's yes.",
  "pulse":{"src":"cron","job":"spam-desk-auto","gap":90,"alert":true},
  "owns":["mail.spam"]}
]$j$::jsonb);
