-- Closes security finding b494357d (supa:Bestly:rpc:anon_writer:card_scan_log). STEP 2 of 2; step 1 (ip_hash) is 20261015000300.
-- The guest QR page (TuroEntry.tsx) now logs scans through the card-scan edge function (deployed v1, live on bestly.tech since
-- commit a1608c5), so no legitimate anon caller of the card_scan_log RPC remains. This takes the public RPC away.
-- Same SQL as 20261015000400_card_scan_log_close_anon.sql (committed, never applied). Applied from this file instead; do NOT also
-- apply 000400 (it would be a harmless repeat, but out of order). card_scan_link stays public on purpose (token-bound).
-- UNDO: see the header of 20261015000400_card_scan_log_close_anon.sql.

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
