-- *** NOT APPLIED. WRITTEN FOR REVIEW (2026-10-15). Read the tradeoff before applying. ***
--
-- Security audit finding supa:Bestly:rpc:anon_writer:card_scan_log (open 5 nights).
-- The audit's proposed fix (revoke execute from public, anon) would BREAK PRODUCTION: card_scan_log is the
-- deliberate public caller behind the in-car card QR. src/pages/TuroEntry.tsx calls
-- supabase.rpc("card_scan_log", ...) with the publishable key for every guest who scans the card at /turo-key,
-- and it is already on public.security_public_rpcs (20261012050000_card_qr_scans.sql). card-qr-watch (hourly)
-- would also just re-grant it. So the finding is a known, accepted exposure: the function inserts a row of
-- non-personal data (src regex-limited, device/device_id truncated to 40 chars) and has a 300 rows/hour flood guard.
--
-- This migration is the "add a check inside the function" option. A QR scan has no login and no secret, so the
-- strongest check available without new infrastructure is: when the caller is the anon role, the browser Origin
-- must be bestly.tech. Calls from SQL, the service role or an authenticated session are unaffected.
--
-- TRADEOFFS (why this is not auto-applied):
--  1. It is a SPEED BUMP, not authentication. Origin is set by browsers and trivially forged by curl, so a
--     determined attacker still writes rows (still capped at 300/hour by the existing flood guard).
--  2. It can break legitimate callers: Vercel preview deployments (*.vercel.app) and localhost dev will stop
--     logging scans, and any non-browser anon caller (none found in this repo) would be refused.
--  3. The audit closes this finding only because the new body contains the substring "current_setting", which is one
--     of the audit's accepted auth-check words. That is the audit's heuristic, not proof the hole is shut.
--     Do not count the finding as truly fixed on that basis alone.
--  4. The 300/hour flood guard is itself a denial vector: anyone can fill it and stop real scans being counted.
-- The only real fix is to stop exposing a writer to the public key: put the insert behind an edge function
-- (service role, with real rate limiting / Turnstile), point TuroEntry.tsx at it, then revoke anon here and drop the
-- security_public_rpcs row and the card_qr_watch re-grant. That is a frontend change and was out of scope.
-- Alternative: leave as is and accept the finding (the audit has no suppression because it deliberately keeps
-- allowlisted functions on the report).
--
-- Deploy note if applied: wait for Vercel to serve the current build; run a real scan from bestly.tech/turo-key?src=card
-- and confirm a new row in card_scans.
--
-- UNDO: re-apply the function body from 20261012050000_card_qr_scans.sql (create or replace public.card_scan_log ...,
-- then re-run its two revoke/grant lines). Grants and the security_public_rpcs row are not touched by this migration.

create or replace function public.card_scan_log(p_src text, p_kind text, p_device text default null, p_device_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '');
  v_origin text := lower(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'origin', ''));
begin
  -- Public-key callers (PostgREST role anon) must come from the Bestly site. Other roles / direct SQL pass.
  if v_role = 'anon' and v_origin not in ('https://bestly.tech', 'https://www.bestly.tech') then return null; end if;
  if p_src is null or p_src !~ '^[a-z0-9-]{1,24}$' then return null; end if;
  if coalesce(p_kind, 'home') not in ('home', 'lax') then p_kind := 'home'; end if;
  if (select count(*) from card_scans where scanned_at > now() - interval '1 hour') > 300 then return null; end if; -- flood guard
  if p_device_id is not null then
    select id into v_id from card_scans
     where device_id = left(p_device_id, 40) and src = p_src and scanned_at > now() - interval '30 minutes'
     order by scanned_at desc limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into card_scans (src, kind, device, device_id)
  values (p_src, coalesce(p_kind, 'home'), left(p_device, 40), left(p_device_id, 40))
  returning id into v_id;
  return v_id;
end $$;
