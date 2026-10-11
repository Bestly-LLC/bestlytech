-- Narrow secret reader for leo-phone-init (service role, two names only) + hourly self-heal watch.
-- The watch re-registers ElevenLabs' call-start webhook if it drifts and raises leo.phone-init if Leo's
-- per-agent toggle is off (calls would drop again).
create or replace function public.leo_phone_secret(p_name text)
returns text language plpgsql stable security definer set search_path = public, vault as $$
declare v text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if p_name not in ('elevenlabs_api_key','leo_phone_init_token') then raise exception 'Not an allowed secret'; end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = p_name;
  return v;
end $$;
revoke all on function public.leo_phone_secret(text) from public, anon, authenticated;
grant execute on function public.leo_phone_secret(text) to service_role;

create or replace function public.leo_phone_watch_tick()
returns bigint language sql security definer set search_path = public, vault as $$
  select net.http_post(
    url := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/leo-phone-init?op=watch',
    headers := jsonb_build_object('Content-Type','application/json','x-leo-init',(select decrypted_secret from vault.decrypted_secrets where name='leo_phone_init_token')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$$;
revoke all on function public.leo_phone_watch_tick() from public, anon, authenticated;

select cron.schedule('leo-phone-watch', '37 * * * *', $c$select public.leo_phone_watch_tick()$c$);
