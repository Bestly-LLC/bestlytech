-- Leo texting registration (US 10DLC): filing state, the EIN slot, the admin card's RPCs and the hourly tick.
-- The EIN is write-only in Vault (home_hub_leo_sms_ein via home_hub_vault_put); a page can see the saved-at time, never the value.
alter table public.leo_settings add column if not exists sms_filing jsonb;

-- Service-only reader for the one secret the filing needs (the edge function leo-10dlc is the only caller).
create or replace function public.leo_sms_secret(p_name text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if p_name <> 'home_hub_leo_sms_ein' then raise exception 'leo_sms_secret: % is not a Leo texting secret', p_name; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1);
end $$;
revoke all on function public.leo_sms_secret(text) from public, anon, authenticated;

-- Hourly: advance the filing (rides the existing leo-demo-parity cron; no new scheduler).
create or replace function public.leo_sms_tick() returns bigint
language sql security definer set search_path = public as $$
  select public.invoke_edge_function('leo-10dlc', '{"op":"tick"}'::jsonb, 60000) $$;
revoke all on function public.leo_sms_tick() from public, anon, authenticated;

-- What the Leo texting card shows. Admin only. Never returns the EIN.
create or replace function public.leo_sms_admin() returns jsonb
language plpgsql stable security definer set search_path = public, vault as $$
declare s leo_settings; v_ein timestamptz;
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then raise exception 'Admins only'; end if;
  select * into s from leo_settings where id = 1;
  select updated_at into v_ein from vault.secrets where name = 'home_hub_leo_sms_ein';
  return jsonb_build_object('mode', s.sms_mode, 'ready', s.sms_ready, 'why', s.sms_detail->>'why',
    'campaign_status', s.sms_detail->>'campaign_status', 'checked_at', s.sms_checked_at,
    'ein_saved_at', v_ein, 'filing', coalesce(s.sms_filing, '{}'::jsonb));
end $$;
revoke all on function public.leo_sms_admin() from public, anon;
grant execute on function public.leo_sms_admin() to authenticated;

-- Save the EIN once; the filing resumes immediately (and the hourly tick keeps it going).
create or replace function public.leo_sms_ein_put(p_ein text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p_ein, ''), '\D', '', 'g'); t timestamptz;
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then raise exception 'Admins only'; end if;
  if d !~ '^\d{9}$' then raise exception 'An EIN is 9 digits (12-3456789)'; end if;
  t := public.home_hub_vault_put('home_hub_leo_sms_ein', substr(d, 1, 2) || '-' || substr(d, 3), 'Bestly LLC EIN for Leo texting registration (write-only)');
  perform public.invoke_edge_function('leo-10dlc', '{"op":"tick"}'::jsonb, 60000);
  return t;
end $$;
revoke all on function public.leo_sms_ein_put(text) from public, anon;
grant execute on function public.leo_sms_ein_put(text) to authenticated;

-- Existing hourly cron (leo-demo-parity): also advance the texting registration.
select cron.alter_job((select jobid from cron.job where jobname = 'leo-demo-parity'),
  command := $c$select public.invoke_edge_function('trip-voice', '{"op":"selftest"}'::jsonb, 30000); select public.leo_sms_tick()$c$);
