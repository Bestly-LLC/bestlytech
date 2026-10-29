-- Claims Closer cleaning reports, fix 3 (2026-10-29): pace the free-AI photo read by progress, not by the clock.
-- Found on the first dry run: Groq's vision model hit its daily token cap (200,000 a day, refilled about 140 a minute), and
--  1. claims_cleaning_look_tick ignored next_try_at, so it asked again every minute against a cap that could not answer
--     (no tokens spent, but every miss counts toward Groq's provider-wide pause that other bots share);
--  2. the 45-minute give-up was measured from when the photos were saved, so a slow but healthy read would have failed.
-- Now: the tick only picks a row whose next_try_at has come; the edge function sets the next try (next minute after progress,
-- 30 minutes after a miss); the read gives up only after 6 hours with no new photo read, and if Turo's window is within
-- 3 hours it hands the call to Jared instead of letting it lapse.
-- Follow-up to 20261029233000_claims_cleaning_paced_look.sql.

create or replace function public.claims_cleaning_look_tick()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c claim_cleaning; last_progress timestamptz; who text;
begin
  select * into c from claim_cleaning
   where status = 'checking' and job_state = 'idle' and checked_at is null
     and coalesce(next_try_at, now()) <= now()
     and exists (select 1 from claim_cleaning_photos p where p.reservation_id = claim_cleaning.reservation_id)
   order by deadline limit 1;
  if c.reservation_id is null then return jsonb_build_object('idle', true); end if;
  who := coalesce(c.guest_first, 'the guest');

  -- Turo's window is about to close and the read is not done: Jared decides from the photos himself.
  if not c.dry_run and c.deadline < now() + interval '3 hours' then
    update claim_cleaning set status = 'needs_you',
           reasons = 'Free AI could not finish reading the photos before Turo''s window closes. Look at them below and tap File or Skip.'
     where reservation_id = c.reservation_id;
    perform claims_cleaning_log(c.reservation_id, 'Photo read not finished with Turo''s window closing; asking Jared');
    perform claims_notify('Check ' || who || '''s return photos',
      'Free AI could not finish reading them. Tap File or Skip on the Claims page before ' ||
      to_char(c.deadline at time zone 'America/Los_Angeles', 'Dy Mon FMDD at FMHH12:MI AM') || '.', 'warning', 'cleaning-ask-' || c.reservation_id);
    return jsonb_build_object('asked', c.reservation_id);
  end if;

  -- No photo read for 6 hours: give up this round (the photos job runs again, up to 4 times).
  select greatest(c.turo_seen_at, max(noted_at)) into last_progress from claim_cleaning_photos where reservation_id = c.reservation_id;
  if last_progress < now() - interval '6 hours' then
    return claims_cleaning_verdict(c.reservation_id, jsonb_build_object('error', 'free AI read no photos for 6 hours'));
  end if;

  -- 2-minute hold while the call runs; the edge function sets the real next try when it finishes.
  update claim_cleaning set next_try_at = now() + interval '2 minutes' where reservation_id = c.reservation_id;
  perform invoke_edge_function('claims-cleaning', jsonb_build_object('op', 'look_next', 'reservation_id', c.reservation_id), 120000);
  return jsonb_build_object('looking', c.reservation_id);
end $$;

revoke all on function public.claims_cleaning_look_tick() from public, anon, authenticated;
