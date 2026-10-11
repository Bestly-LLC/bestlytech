-- Maya fills the website's contact form for the visitor (docs/maya-contact-form-opusplan.md).
-- The form is now the record: it carries a phone number, says whether Maya typed it in, and links to her call.
-- Sales questions also file one sales_lead ticket for Maya's desk (done in submit-contact, not here).

alter table public.contact_submissions add column if not exists phone text;
alter table public.contact_submissions add column if not exists source text not null default 'web';
alter table public.contact_submissions add column if not exists conversation_id text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contact_submissions_source_check' and conrelid = 'public.contact_submissions'::regclass) then
    alter table public.contact_submissions add constraint contact_submissions_source_check check (source in ('web', 'maya'));
  end if;
end $$;

comment on column public.contact_submissions.source is 'web = the visitor typed it all; maya = Maya filled the form on screen with the visitor.';
comment on column public.contact_submissions.conversation_id is 'ElevenLabs conversation id of the Maya call that filled the form, when there was one.';

-- Vera (Privacy Clerk) deletes per person only from this map.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason)
values ('contact_submissions', 'phone', 'phone', 'delete', null)
on conflict (table_name, column_name) do nothing;
