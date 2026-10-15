-- Blue Steel live location: move the public entrance from the Tailscale Funnel to telemetry.bestly.tech.
-- Tesla refused bestly-pi.taile42611.ts.net ("hostname domain does not match with partner account"); it accepted
-- telemetry.bestly.tech (job 7350). That name points at a tiny AWS relay (44.241.28.216) that passes TCP 443 through a
-- reverse SSH tunnel the Pi opens; TLS still ends on the Pi. See tools/car-telemetry/relay/.
--
-- 1. car_telemetry_relay_key: the Pi posts its tunnel PUBLIC key (ingest token required) so Claude can authorize it on
--    the relay without anyone pasting it. Public key only; validated as a single ssh-ed25519 line.
-- 2. security_public_rpcs: the functions the Pi calls with the publishable key were never allowlisted, so Ares's
--    Auto-Fixer would have locked them on its next audit and silently broken streaming. Allowlist them now.

create or replace function public.car_telemetry_relay_key(p_token text, p_pubkey text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare s car_telemetry_settings; k text := btrim(coalesce(p_pubkey, ''));
begin
  select * into s from car_telemetry_settings where id = 1;
  if p_token is null or s.token_hash is null or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> s.token_hash then
    raise exception 'forbidden';
  end if;
  if k !~ '^ssh-ed25519 [A-Za-z0-9+/]{68}(=){0,2}( [A-Za-z0-9@._-]{1,64})?$' then
    raise exception 'not an ssh-ed25519 public key';
  end if;
  update car_telemetry_settings
     set state = state || jsonb_build_object('relay_pubkey', k, 'relay_pubkey_at', now()), updated_at = now()
   where id = 1;
  return jsonb_build_object('ok', true);
end $fn$;

revoke all on function public.car_telemetry_relay_key(text, text) from public;
grant execute on function public.car_telemetry_relay_key(text, text) to anon, authenticated;

insert into security_public_rpcs (fn, why) values
  ('car_telemetry_beat',      'Pi telemetry forwarder heartbeat; ingest token checked inside'),
  ('car_telemetry_ingest',    'Pi telemetry forwarder posts car location; ingest token checked inside'),
  ('car_telemetry_start',     'Pi finish.sh switches streaming on; ingest token checked inside'),
  ('car_telemetry_status',    'Pi finish.sh reads job status; ingest token checked inside'),
  ('car_telemetry_relay_key', 'Pi posts its relay tunnel public key; ingest token checked inside'),
  ('car_telemetry_push_args', 'Pi tesla-worker reads streaming settings; worker token checked inside'),
  ('car_telemetry_record',    'Pi tesla-worker records push/check results; worker token checked inside')
on conflict (fn) do nothing;
