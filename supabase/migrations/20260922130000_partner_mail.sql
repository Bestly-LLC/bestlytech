-- Partner portal: the emails Jared sent the partner, their attachments, doc links, and the call room.
-- Filled by the Mac mini (scripts/partner-ai/partner_mail.py) from Jared's Sent folders over IMAP;
-- mailbox passwords stay in the Mac's Keychain. Attachments go to the private 'partner-files' bucket
-- under <roster>/..., so a partner can only open their own.

alter table public.partners add column if not exists call_url text;
update public.partners set call_url = 'https://cloud.bestly.tech/call/sm33w3fu' where roster_name = 'eli' and call_url is null;

create table if not exists public.partner_mail (
  id uuid primary key default gen_random_uuid(),
  roster text not null,                    -- partners.roster_name
  message_id text not null,
  account text not null,
  subject text,
  sent_at timestamptz,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  body_text text,
  links jsonb not null default '[]',       -- [{url, label, kind}] docs linked in the email
  attachments jsonb not null default '[]', -- [{name, size, type, path}] path in bucket partner-files
  created_at timestamptz not null default now(),
  unique (roster, message_id)
);
create index if not exists partner_mail_roster_idx on public.partner_mail (roster, sent_at desc);
alter table public.partner_mail enable row level security;
drop policy if exists partner_mail_read on public.partner_mail;
create policy partner_mail_read on public.partner_mail for select to authenticated
  using (roster = public.partner_roster_name() or public.has_role(auth.uid(), 'admin'));

insert into storage.buckets (id, name, public) values ('partner-files', 'partner-files', false)
on conflict (id) do nothing;
drop policy if exists partner_files_read on storage.objects;
create policy partner_files_read on storage.objects for select to authenticated
  using (bucket_id = 'partner-files' and ((storage.foldername(name))[1] = public.partner_roster_name() or public.has_role(auth.uid(), 'admin')));

-- Worker: who to look for, and which messages are already in.
create or replace function public.partner_mail_targets(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('roster', roster_name, 'email', lower(email))) from public.partners), '[]'::jsonb);
end $$;
revoke all on function public.partner_mail_targets(text) from public;
grant execute on function public.partner_mail_targets(text) to anon;

create or replace function public.partner_mail_known(p_key text, p_roster text, p_ids text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  return coalesce((select array_agg(message_id) from public.partner_mail where roster = p_roster and message_id = any (p_ids)), '{}');
end $$;
revoke all on function public.partner_mail_known(text, text, text[]) from public;
grant execute on function public.partner_mail_known(text, text, text[]) to anon;
