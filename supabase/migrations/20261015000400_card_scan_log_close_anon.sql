-- *** NOT APPLIED. STEP 2 of 2: apply ONLY after the card-scan edge function is deployed AND the TuroEntry.tsx build is live. ***
-- Applying it earlier breaks guest scans (the old page still calls the RPC with the publishable key) for as long as the gap lasts.
--
-- Security audit finding supa:Bestly:rpc:anon_writer:card_scan_log. Fix chosen by Jared: front the writer with an edge function
-- instead of leaving a SECURITY DEFINER writer callable by anon. The edge function (supabase/functions/card-scan) inserts with the
-- service role behind per-IP / per-device rate limits; TuroEntry.tsx now calls it. This migration then takes the public RPC away.
-- SUPERSEDES 20261015000200_card_scan_log_origin_guard.sql (the Origin-header speed bump, never applied, do not apply it).
--
-- In this order, in one transaction (so card_qr_watch cannot interleave and re-grant):
--   1. revoke execute on card_scan_log from public and anon (authenticated and service_role keep it).
--   2. remove its security_public_rpcs row, so it is no longer allow-listed as "public on purpose".
--   3. replace card_qr_watch() so it no longer re-grants card_scan_log or re-lists it. ONLY the card_scan_log lines are removed;
--      the card_scan_link check, the Scout alert/resolve, and the return value are exactly as in 20261012050000.
--
-- card_scan_link stays public on purpose (token-bound: it needs a valid guest trip token).
-- Side effect to know about: card-qr-watch no longer proves the logging path works. It only watches card_scan_link now.
-- The card-scan function is the thing to health-check instead.
--
-- UNDO (restores the old public RPC exactly; the edge function can stay deployed, it does not depend on this):
--   grant execute on function public.card_scan_log(text, text, text, text) to anon, authenticated;
--   insert into public.security_public_rpcs (fn, why) values
--     ('card_scan_log', 'In-car card QR: /turo-key logs a scan (no personal data, flood-guarded)') on conflict (fn) do nothing;
--   then re-apply the card_qr_watch() body from 20261012050000_card_qr_scans.sql (create or replace public.card_qr_watch ...).
--   Also revert TuroEntry.tsx to call supabase.rpc("card_scan_log") if the edge function is being removed.

-- 1. No more anonymous writer.
revoke execute on function public.card_scan_log(text, text, text, text) from public, anon;

-- 2. No longer allow-listed.
delete from public.security_public_rpcs where fn = 'card_scan_log';

-- 3. Watchdog: stop re-granting card_scan_log. card_scan_link handling is unchanged.
create or replace function public.card_qr_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fixed text[] := '{}';
begin
  if not has_function_privilege('anon', 'public.card_scan_link(uuid, text)', 'execute') then
    grant execute on function public.card_scan_link(uuid, text) to anon, authenticated; v_fixed := v_fixed || 'card_scan_link'::text;
  end if;
  insert into security_public_rpcs (fn, why) values
    ('card_scan_link', 'In-car card QR: ties a scan to the trip the same visit signed in to (token-bound)')
  on conflict (fn) do nothing;
  if array_length(v_fixed, 1) > 0 then
    perform bestly_raise('card.qr.locked', 'problem', 'warning',
      'Card QR tracking was locked, unlocked it',
      format('Guests scanning the in-car card could not be counted because %s lost public access. I gave it back and re-listed it as allowed. Nothing for you to do. - Leo', array_to_string(v_fixed, ' and ')),
      'turo', null, true);
  else
    perform bestly_raise('card.qr.locked', 'resolved', 'info', 'Card QR tracking is working');
  end if;
  return jsonb_build_object('ok', true, 'fixed', v_fixed, 'scans_7d', (select count(*) from card_scans where scanned_at > now() - interval '7 days'));
end $$;
revoke all on function public.card_qr_watch() from public, anon, authenticated;
