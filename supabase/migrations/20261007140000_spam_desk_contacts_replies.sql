-- Spam Desk fixes after 2026-10-07: it auto-reported Jared's mom (a forward) and esearch.com, neither of them spam.
--   mail_contacts       every email address in Jared's iCloud contacts (synced daily by spam-desk over CardDAV).
--                       Nobody in here is ever judged, junked or reported.
--   spam_desk_replies   replies from the abuse desks (AWS, Apple, APWG, GoDaddy, Google...) to Spam Desk's reports.
--                       Jared never sees them: the Mac mini moves each to Trash and Spam Desk posts a silent note instead.
-- "Not spam" on a report now works at any stage (see spam-desk opUndo): the restore state lives in spam_reports.undo.

create table if not exists public.mail_contacts (
  email      text primary key,
  name       text,
  synced_at  timestamptz not null default now()
);

create table if not exists public.spam_desk_replies (
  mail_id     uuid primary key,
  mailbox     text not null,
  message_id  text,
  from_addr   text,
  subject     text,
  report_id   uuid references public.spam_reports(id) on delete set null,
  status      text not null default 'queued' check (status in ('queued', 'done', 'missing', 'failed')),
  tries       integer not null default 0,
  claimed_at  timestamptz,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists spam_desk_replies_queued on public.spam_desk_replies (created_at) where status = 'queued';
create index if not exists spam_desk_replies_report on public.spam_desk_replies (report_id);

alter table public.mail_contacts enable row level security;
alter table public.spam_desk_replies enable row level security;
create policy mail_contacts_admin_read on public.mail_contacts for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy spam_desk_replies_admin_read on public.spam_desk_replies for select to authenticated using (public.has_role(auth.uid(), 'admin'));
