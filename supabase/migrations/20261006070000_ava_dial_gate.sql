-- Protect the number's reputation: don't let Ava hammer the same person.
--
-- Why (2026-10-05): calls to one contact on Verizon started going straight to voicemail. Ava had dialed him seven
-- times in eleven minutes, and the line had made 77 calls that day, many of them short or abandoned. That is the exact
-- fingerprint carrier spam analytics score on, so the redialing was feeding the problem it was trying to diagnose.
--
-- The rule: three calls to one number in an hour is enough. The fourth is refused with a plain-words reason, unless
-- Jared passes force. Inbound calls are never gated, and this says nothing about the daily spend cap (ava_spend_gate),
-- which is about money rather than reputation.

create or replace function public.ava_dial_gate(p_phone text, p_force boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_recent integer; v_vm integer; v_last timestamptz;
begin
  if p_force then return jsonb_build_object('blocked', false); end if;

  select count(*), max(coalesce(ended_at, created_at))
    into v_recent, v_last
    from public.ava_calls
   where phone = p_phone and direction = 'outbound'
     and created_at > now() - interval '1 hour';

  if coalesce(v_recent, 0) < 3 then return jsonb_build_object('blocked', false, 'recent', coalesce(v_recent, 0)); end if;

  -- all of them reaching voicemail is the telling case: the phone is not ringing, so dialing again changes nothing
  select count(*) into v_vm
    from public.ava_calls
   where phone = p_phone and direction = 'outbound'
     and created_at > now() - interval '1 hour'
     and (coalesce(summary, '') ilike '%voicemail%' or coalesce(summary, '') ilike '%voice mail%');

  return jsonb_build_object(
    'blocked', true,
    'recent', v_recent,
    'voicemails', coalesce(v_vm, 0),
    'last_at', v_last,
    'message', case when coalesce(v_vm, 0) >= 2
      then format('Ava has called this number %s times in the last hour and kept reaching voicemail. Calling again will not make it ring, and repeat dialing is what gets her number flagged as spam. Give it a few hours, or call anyway if you need to.', v_recent)
      else format('Ava has already called this number %s times in the last hour. Repeat dialing is what gets her number flagged as spam. Give it a while, or call anyway if you need to.', v_recent) end);
end $function$;

revoke all on function public.ava_dial_gate(text, boolean) from public, anon;
grant execute on function public.ava_dial_gate(text, boolean) to authenticated, service_role;
