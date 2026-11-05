-- Email builder: file attachments (2026-11-04, Jared: "make it so I can add attachments to our email templater").
--
-- email_library.attachments = [{ path, name, type, size }] — files live in the PRIVATE bucket email-attachments
-- under <uploader uid>/<random>/<file name>. Only admins can upload, read or delete them (has_role admin).
-- email-builder-send downloads them with the service key and hands them to Resend; the .eml download wraps them
-- in the browser. Limits: 20 MB a file (bucket), 25 MB per email and 10 files (UI + send function).
--
-- Undo:
--   alter table public.email_library drop column if exists attachments;
--   drop policy if exists email_attachments_admin_select on storage.objects;
--   drop policy if exists email_attachments_admin_insert on storage.objects;
--   drop policy if exists email_attachments_admin_delete on storage.objects;
--   (empty the bucket, then) delete from storage.buckets where id = 'email-attachments';

alter table public.email_library add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit)
values ('email-attachments', 'email-attachments', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists email_attachments_admin_select on storage.objects;
create policy email_attachments_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'email-attachments' and public.has_role(auth.uid(), 'admin'));

drop policy if exists email_attachments_admin_insert on storage.objects;
create policy email_attachments_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'email-attachments' and public.has_role(auth.uid(), 'admin'));

drop policy if exists email_attachments_admin_delete on storage.objects;
create policy email_attachments_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'email-attachments' and public.has_role(auth.uid(), 'admin'));
