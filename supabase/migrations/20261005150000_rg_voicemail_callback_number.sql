-- RoofGuard Ava's voicemails were telling people to call back on nothing (Jared, 2026-10-05: he called the number back
-- and reached PERSONAL Ava instead of RoofGuard Ava).
--
-- What actually happened, from the data:
--   * The outbound call went out from the RIGHT number. ElevenLabs' own record for conv_4801m47qh5cfejzazxf57sph93ny
--     shows agent_number +18165440206, the RoofGuard line. The caller ID was never wrong.
--   * But rg_settings.callback_number was NULL, and the voicemail script is
--     "...give us a call back on {{callback_number}}. That's {{callback_number}}. Thanks so much."
--     With the variable empty, Ava literally said "give us a call back on . That's ." - a blank.
--   * So there was no number to call back. Jared dialled the personal line (816) 429-9495 from memory, reached
--     personal Ava, who correctly said she is Jared's assistant and cannot book RoofGuard meetings.
--   * 4 earlier voicemails went out with the same blank. Those people could not reach us at all.
--
-- Why nothing caught it: the live dialler path DOES refuse to run without a callback number
-- (roofguard-caller index.ts ~line 124 returns 412 "callback_number not set"), but demoCall() has no such guard,
-- so every test and partner-portal demo call left a broken voicemail.
--
-- Fix applied: set the callback number to the RoofGuard line itself, which Ava answers for inbound, so a callback
-- now reaches RoofGuard Ava and not personal Ava. The template resolves {{callback_number}} per call from
-- rg_settings, so no agent re-setup is needed.

update public.rg_settings set callback_number = '+18165440206', updated_at = now()
 where id and (callback_number is null or callback_number = '');

-- Guard so this can never ship silently again. Daily; high + push if the number is ever blank again.
create or replace function public.rg_voicemail_guard() returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_cb text; v_bad int;
begin
  select callback_number into v_cb from rg_settings where id;
  if v_cb is null or v_cb = '' then
    perform scout_notify('RoofGuard Ava: voicemails have no callback number',
      'rg_settings.callback_number is empty, so every voicemail says "call us back on" and then nothing. '
      || 'Set it to the RoofGuard line (816) 544-0206 in Setup before any more calls go out.',
      'high', true, 'https://bestly.tech/admin/roofguard', 'rg-voicemail-nocb-' || to_char(now(), 'YYYYMMDD'));
    return;
  end if;
  select count(*) into v_bad from rg_calls c, jsonb_array_elements(c.transcript) t
   where c.outcome = 'voicemail_left' and t->>'role' = 'agent' and t->>'message' ilike '%call back on . That%';
  if v_bad > 0 then
    perform scout_notify('RoofGuard Ava: ' || v_bad || ' past voicemails had no callback number',
      'Fixed going forward (callback number is now ' || v_cb || '). Those ' || v_bad
      || ' people were told to call back on a blank, so they could not reach us. Worth re-calling them.',
      'medium', false, 'https://bestly.tech/admin/roofguard', 'rg-voicemail-pastblank');
  end if;
end $function$;
select cron.schedule('rg-voicemail-guard', '11 15 * * *', $$select public.rg_voicemail_guard()$$);

-- Jared's rule: every alert is signed by the employee responsible. Ownership matches on the dedupe-key prefix,
-- so 'rg-voicemail-*' needs its own row; the existing 'rg' row does not cover it.
insert into public.notification_owners (prefix, agent_slug, note)
values ('rg-voicemail', 'roofguard-caller', 'RoofGuard Ava owns what her voicemail says')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;
update public.admin_notifications set agent_slug = 'roofguard-caller'
 where title like 'RoofGuard Ava:%' and agent_slug is null;

-- STILL OPEN (needs a roofguard-caller edge function change; the live copy differs from this repo, so diff it with
-- get_edge_function before touching it): give demoCall() the same callback_number guard the live dialler already has.
