-- Lock down data that the public (anon) key could reach. Found in the 2026-09-15 admin review.
-- Applied to prod 2026-09-16 via the Supabase MCP; this file is the source-of-truth mirror.

-- 1. Seller ID documents (storage bucket intake-documents) ------------------------------------
-- Before: anyone could read, overwrite or delete every file; any signed-in user could read.
-- After: admins keep full access ("Admins can manage intake documents storage"); a seller can
-- only touch files under their own draft intake's folder, proven by the x-intake-token header.
drop policy if exists "Anyone can view intake docs" on storage.objects;
drop policy if exists "Users can delete their intake docs" on storage.objects;
drop policy if exists "Users can update their intake docs" on storage.objects;
drop policy if exists "Anyone can upload intake docs" on storage.objects;
drop policy if exists "Authenticated users can upload intake docs" on storage.objects;
drop policy if exists "Admins can read intake docs" on storage.objects;

create or replace function public.intake_doc_path_ok(p_name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.seller_intakes s
     where s.id::text = split_part(p_name, '/', 1)
       and s.status = 'Draft'
       and s.requires_session_token
       and s.session_token is not null
       and public.current_intake_token() <> ''
       and s.session_token::text = public.current_intake_token()
  );
$$;
revoke all on function public.intake_doc_path_ok(text) from public;
grant execute on function public.intake_doc_path_ok(text) to anon, authenticated, service_role;

create policy "Seller reads own draft intake docs" on storage.objects for select to anon, authenticated
  using (bucket_id = 'intake-documents' and public.intake_doc_path_ok(name));
create policy "Seller uploads own draft intake docs" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'intake-documents' and public.intake_doc_path_ok(name));
create policy "Seller replaces own draft intake docs" on storage.objects for update to anon, authenticated
  using (bucket_id = 'intake-documents' and public.intake_doc_path_ok(name))
  with check (bucket_id = 'intake-documents' and public.intake_doc_path_ok(name));
create policy "Seller removes own draft intake docs" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'intake-documents' and public.intake_doc_path_ok(name));

-- 2. Cookie Yeti device registrations -------------------------------------------------------
-- Before: SELECT true for everyone (emails + device IDs). The apps still register via insert.
drop policy if exists device_reg_read on public.device_registrations;
create policy device_reg_admin_read on public.device_registrations for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- Public transparency page only needs the count.
create or replace function public.cy_devices_protected()
returns bigint
language sql stable security definer
set search_path = public
as $$ select count(*) from public.device_registrations $$;
revoke all on function public.cy_devices_protected() from public;
grant execute on function public.cy_devices_protected() to anon, authenticated, service_role;

-- 3. Leads and Shield reports: only the edge functions (service role) insert -----------------
drop policy if exists cloud_leads_insert_anon on public.cloud_leads;
drop policy if exists shield_reports_insert_anon on public.shield_url_reports;
revoke insert, update, delete on public.cloud_leads from anon;
revoke insert, update, delete on public.shield_url_reports from anon;

-- 4. Internal SECURITY DEFINER functions the public key could call ----------------------------
-- All callers are cron or service-role edge functions (checked in the edge logs).
do $$
declare f text;
begin
  foreach f in array array[
    'public.expire_stale_home_hub_commands()',
    'public.purge_expired_admin_auth()',
    'public.purge_old_bestly_mail()',
    'public.web_events_prune()',
    'public.web_events_rollup()',
    'public.bestly_mail_claim(text, integer)',
    'public.revoke_granted_access_subscription()',
    'public.trg_talk_items()',
    'public.trg_talk_review()',
    'public.cleanup_old_pihole_stats()',
    'public.prune_pihole_stats()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- 5. Street-sweeping acknowledge key: out of git, into Vault, rotated -------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'bluesteel_ack_key') then
    perform vault.create_secret(
      translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'),
      'bluesteel_ack_key',
      'Key in the Blue Steel sweeping alert acknowledge links');
  end if;
end $$;

create or replace function public.bluesteel_ack_key()
returns text
language sql stable security definer
set search_path = public
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'bluesteel_ack_key' $$;
revoke all on function public.bluesteel_ack_key() from public, anon, authenticated;
grant execute on function public.bluesteel_ack_key() to service_role;

create or replace function public.bluesteel_sweep_send_alert(p_title text, p_body text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ack text := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/bluesteel-ack?k=' || public.bluesteel_ack_key();
begin
  return net.http_post(
    url  := 'https://ntfy.sh',
    body := jsonb_build_object(
      'topic', 'bestly-sysalert-7q2k9mx4',
      'title', p_title,
      'message', p_body,
      'priority', 5,
      'tags', jsonb_build_array('rotating_light', 'blue_steel_sweep'),
      'click', v_ack || '&via=tap',
      'actions', jsonb_build_array(jsonb_build_object(
        'action', 'http', 'label', 'Moved it',
        'url', v_ack || '&via=button', 'method', 'POST', 'clear', true))
    )
  );
end $$;
