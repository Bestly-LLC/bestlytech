-- Email builder: a copy of every sent email lands in jared@bestly.tech -> Sent (2026-11-04).
--
-- Jared sent from /admin/emails and could not find the email in Sent: Resend sends from outside the mailbox, so
-- no Sent copy is ever made. email-builder-send now snapshots each sent email here; Hermes's Hestia job
-- sent_copies (every 5 min, /opt/bestly/cron/jobs/sent_copies.py) builds the real message with Python's email
-- library and IMAP-APPENDs it to the Sent folder as read, then blanks the snapshot (html/text) and keeps the row
-- as a log. Service role only (no policies, no grants to authenticated).
--
-- Undo: drop table if exists public.email_sent_copies;
--       delete from public.privacy_data_map where table_name = 'email_sent_copies';
--       delete from public.pi_jobs where job = 'sent_copies';
--       update public.bestly_agents set pulse = jsonb_set(pulse, '{also}', (pulse->'also') - 'sent_copies') where slug = 'hermes';

create table if not exists public.email_sent_copies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz not null default now(),
  source text not null default 'email-builder',
  provider_id text,
  library_id uuid,
  mailbox text not null default 'jared@bestly.tech',
  from_header text not null,
  to_list jsonb not null default '[]'::jsonb,
  cc_list jsonb not null default '[]'::jsonb,
  bcc_list jsonb not null default '[]'::jsonb,
  reply_to text,
  subject text not null,
  html text,
  text_body text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'filed', 'failed')),
  attempts int not null default 0,
  error text,
  filed_at timestamptz,
  imap_folder text
);
create index if not exists email_sent_copies_pending_idx on public.email_sent_copies (created_at) where status = 'pending';
create unique index if not exists email_sent_copies_provider_uidx on public.email_sent_copies (provider_id) where provider_id is not null;
alter table public.email_sent_copies enable row level security;

-- Vera: the snapshot is blanked once filed; the address lists are a send log like email_send_log.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled)
select * from (values
  ('email_sent_copies', 'to_list',   'email', 'delete', 'Queue for the Sent-folder copy of a sent email; the copy itself lives in the mailbox', true),
  ('email_sent_copies', 'cc_list',   'email', 'delete', 'Queue for the Sent-folder copy of a sent email; the copy itself lives in the mailbox', true),
  ('email_sent_copies', 'bcc_list',  'email', 'delete', 'Queue for the Sent-folder copy of a sent email; the copy itself lives in the mailbox', true)
) v(table_name, column_name, match_kind, action, reason, enabled)
where not exists (select 1 from public.privacy_data_map m where m.table_name = v.table_name and m.column_name = v.column_name);

-- Heartbeat: Scout alerts if Hestia stops running it (pi_job_report).
insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('sent_copies', 'Hermes (Mail Clerk): every 5 min files a copy of each email sent from /admin/emails into jared@bestly.tech -> Sent (IMAP APPEND, marked read). Pi job /opt/bestly/cron/jobs/sent_copies.py, queue email_sent_copies.', 20, true)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, enabled = true;

-- Hermes owns it on the Team page.
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '["sent_copies"]'::jsonb), updated_at = now()
 where slug = 'hermes' and not coalesce(pulse->'also', '[]'::jsonb) ? 'sent_copies';
