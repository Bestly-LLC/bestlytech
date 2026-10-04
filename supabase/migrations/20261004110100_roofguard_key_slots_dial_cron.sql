-- RoofGuard: write-only key slots for the admin page + the dial cron (Spark, 2026-10-04).
--
-- rg_key_put: Jared pastes his ElevenLabs / Twilio keys into /admin/roofguard; they go straight to Vault.
-- Admin only, three allowed names, nothing ever reads a value back to the browser (same pattern as
-- home_hub_vault_put). Keys never pass through chat.
--
-- roofguard-dial: every 5 minutes, but the HTTP call only happens while rg_settings.calling_enabled is
-- true, so it costs nothing and calls nobody while calling is off.

create or replace function public.rg_key_put(p_name text, p_value text)
returns timestamptz language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if p_name not in ('elevenlabs_api_key', 'twilio_account_sid', 'twilio_auth_token') then
    raise exception 'Not a RoofGuard key: %', p_name;
  end if;
  p_value := btrim(p_value);
  if coalesce(length(p_value), 0) < 8 or length(p_value) > 500 then raise exception 'That does not look like a key'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'RoofGuard caller key (added from /admin/roofguard)');
  else
    perform vault.update_secret(v_id, p_value);
  end if;
  return now();
end $$;
revoke execute on function public.rg_key_put(text, text) from public, anon;
grant execute on function public.rg_key_put(text, text) to authenticated;

select cron.schedule('roofguard-dial', '*/5 * * * *',
  $$ select public.invoke_edge_function('roofguard-caller', '{"action":"tick"}'::jsonb, 150000)
     where (select calling_enabled from public.rg_settings where id); $$);
