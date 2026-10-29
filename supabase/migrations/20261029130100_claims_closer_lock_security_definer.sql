-- Claims Closer: these are SECURITY DEFINER and were executable by anon/public.
-- claims_hold_release(p_case) only rejects signed-in non-admins (auth.uid() is null passes),
-- so anyone holding the publishable key could clear a case's outbound_hold.
-- Confirmed neither the Pi (scripts/pi/turo-reader/reader.py) nor the admin app call
-- any of these six with the anon key -- they're internal gate/sweep/cron helpers.
-- Lock execute down to authenticated + service_role.

revoke execute on function public.claims_gate(uuid) from public, anon;
revoke execute on function public.claims_send_ok(uuid) from public, anon;
revoke execute on function public.claims_sent_violation(uuid, timestamptz, uuid) from public, anon;
revoke execute on function public.claims_gate_sweep() from public, anon;
revoke execute on function public.claims_guard_watch() from public, anon;
revoke execute on function public.claims_hold_release(uuid) from public, anon;

grant execute on function public.claims_gate(uuid) to authenticated, service_role;
grant execute on function public.claims_send_ok(uuid) to authenticated, service_role;
grant execute on function public.claims_sent_violation(uuid, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.claims_gate_sweep() to authenticated, service_role;
grant execute on function public.claims_guard_watch() to authenticated, service_role;
grant execute on function public.claims_hold_release(uuid) to authenticated, service_role;
