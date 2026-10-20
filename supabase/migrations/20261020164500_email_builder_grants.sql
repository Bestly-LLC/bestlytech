-- Email Builder: table grants for signed-in admins (2026-10-20).
--
-- 20261019230000_email_builder_schema.sql created the tables with RLS policies
-- "to authenticated using has_role(auth.uid(), 'admin')" but never granted the
-- authenticated role any table privileges. PostgREST answered "permission denied"
-- to the admin page, which reads any error as "tables missing" and showed an empty
-- library ("The email tables are not in the database yet") with Save and Send off.
--
-- RLS is unchanged and still limits every row to admins; anon gets nothing.
-- Rollback: revoke the same privileges from authenticated.

grant select, insert, update, delete on public.email_brand_kits      to authenticated;
grant select, insert, update, delete on public.email_library         to authenticated;
grant select, insert, update, delete on public.email_library_versions to authenticated;
grant select on public.email_send_log     to authenticated;
grant select on public.email_builder_runs to authenticated;

-- The keep-version trigger inserts into email_library_versions as the caller.
grant usage, select on sequence public.email_library_versions_id_seq to authenticated;
