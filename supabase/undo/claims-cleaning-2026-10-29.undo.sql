-- Undo 20261029230000_claims_cleaning.sql (Claims Closer cleaning reports).
-- Photos stay in the claim-evidence bucket under cleaning/<reservation>/ until removed by hand.
select cron.unschedule('claims-cleaning-watch') where exists (select 1 from cron.job where jobname = 'claims-cleaning-watch');
drop function if exists public.claims_cleaning_watch();
drop function if exists public.claims_cleaning_admin();
drop function if exists public.claims_cleaning_settings_set(text);
drop function if exists public.claims_cleaning_decide(bigint, text);
drop function if exists public.claims_cleaning_done(text, bigint, text, boolean, jsonb, text);
drop function if exists public.claims_cleaning_message(bigint);
drop function if exists public.claims_cleaning_take(text);
drop function if exists public.claims_cleaning_scan();
drop function if exists public.claims_cleaning_queue(bigint, text, jsonb, timestamptz);
drop function if exists public.claims_cleaning_log(bigint, text);
drop table if exists public.claim_cleaning_photos;
drop table if exists public.claim_cleaning;
drop table if exists public.claim_cleaning_settings;
delete from public.security_public_rpcs where fn in ('claims_cleaning_take', 'claims_cleaning_done');
delete from public.notification_owners where prefix = 'claims.cleaning';
update public.bestly_agents set
  pulse = jsonb_set(pulse, '{also}', coalesce((select jsonb_agg(x) from jsonb_array_elements_text(pulse->'also') x where x <> 'claims-cleaning-watch'), '[]'::jsonb)),
  schedule = replace(schedule, '; cleaning report check every 10 min (photos on the Pi, free AI)', ''),
  what_it_does = replace(what_it_does, ' Also checks every trip''s return photos for a mess beyond normal use and files Turo''s $150 cleaning report within the 72-hour window, then confirms Turo saved it.', '')
 where slug = 'claims-closer';
-- Pi: restore /opt/bestly/turo-reader/reader.py.v1.4.0.bak and restart bestly-turo-reader. Edge function: delete claims-cleaning.
