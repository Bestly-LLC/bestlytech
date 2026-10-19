-- ROLLBACK for the Email Builder migrations (2026-10-19): 20261019230000_email_builder_schema.sql and 20261019230100_email_builder_seed.sql.
-- Run by hand in the Supabase SQL editor. Nothing else reads these tables. Deleting the library deletes saved emails and their versions.
drop function if exists public.email_kit_for_client(text);
drop function if exists public.email_kit_build(text);
drop table if exists public.email_builder_runs, public.email_send_log, public.email_library_versions, public.email_library, public.email_brand_kits cascade;
drop function if exists public.email_library_keep_version();
delete from public.notification_owners where prefix = 'email-builder';
delete from public.privacy_data_map where table_name in ('email_library', 'email_send_log');
-- Edge functions: delete email-builder and email-builder-send in the dashboard (or leave them; they answer "unknown brand kit" without the tables).
-- Storage: pictures live under email-assets/builder/ (public bucket); remove that folder if you want them gone.
