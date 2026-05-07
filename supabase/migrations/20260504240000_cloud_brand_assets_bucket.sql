-- Storage bucket for client brand assets uploaded during Stage 5b.
-- Service-role-only writes — uploads go through cloud-brand-upload edge function
-- which verifies the deal's intake_token before allowing the write.
-- Public reads enabled so the intake portal can preview uploaded logos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cloud-brand-assets',
  'cloud-brand-assets',
  true,
  5242880, -- 5 MB per file
  array['image/png','image/jpeg','image/svg+xml','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cloud_brand_assets_public_read" on storage.objects;
create policy "cloud_brand_assets_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'cloud-brand-assets');
