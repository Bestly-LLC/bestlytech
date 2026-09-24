-- Files Jared hands to Scout in the chat. Private; only an admin can put anything in or read it
-- back, and the reader function uses the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scout-files', 'scout-files', false, 26214400, array[
  'image/png','image/jpeg','image/gif','image/webp','image/heic','image/heif',
  'application/pdf',
  'text/plain','text/markdown','text/csv','text/html','text/xml',
  'application/json','application/xml','application/sql',
  'text/javascript','application/javascript','text/x-python','text/x-typescript'
])
on conflict (id) do update set
  public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "scout files: admin writes" on storage.objects;
create policy "scout files: admin writes" on storage.objects for insert to authenticated
  with check (bucket_id = 'scout-files' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "scout files: admin reads" on storage.objects;
create policy "scout files: admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'scout-files' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "scout files: admin deletes" on storage.objects;
create policy "scout files: admin deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'scout-files' and public.has_role(auth.uid(), 'admin'));

-- Housekeeping: a file handed to Scout is read once into the conversation, so the blob itself
-- has no reason to outlive the month.
create or replace function public.scout_files_prune()
returns integer language plpgsql security definer set search_path to 'public', 'storage'
as $$
declare n integer;
begin
  with gone as (
    delete from storage.objects
     where bucket_id = 'scout-files' and created_at < now() - interval '30 days'
    returning 1
  ) select count(*) into n from gone;
  return n;
end $$;

select cron.schedule('scout-files-prune', '35 4 * * *', $$select public.scout_files_prune()$$);
