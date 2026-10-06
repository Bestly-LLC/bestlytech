-- Scout chases requests we send to vendors until they are actually answered (Jared, 2026-10-05:
-- "draft and send it for me, have scout follow up and see this through, if he doesnt have that ability make it for him").
-- He did not have that ability. This is it.
--
-- First request in it: ElevenLabs, asking for the realtime-monitoring feature flag so a live call transcript works on
-- the Creator plan. Sent 2026-10-05 from jared@bestly.tech (which is the ElevenLabs account email - checked against
-- bestly_mail, where their verification and login mail lands).
--
-- How the loop actually closes, in order of what it trusts:
--   1. The OUTCOME. For ElevenLabs it checks ava_live_watch.mid_call_partial. The day a real call shows its transcript
--      mid-call, the flag is on and the request closes itself. An email promising a fix does not close it.
--   2. A REPLY. The Mac's mail puller ingests jared@bestly.tech into bestly_mail within ~2 minutes, so Scout reads the
--      vendor's answer without anyone forwarding it. no-reply senders are ignored.
--   3. SILENCE. After 3 days it reminds Jared, up to three times, three days apart, then gives up and says so out loud
--      rather than quietly sitting there. It never emails the vendor again on its own.
--
-- verify_sql on the row is documentation of the check, not something executed: running stored SQL from a table is a
-- bad habit to build. The check lives in the function, keyed off the vendor.

create table if not exists public.vendor_requests (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  vendor_domain text,
  to_addr text not null,
  subject text not null,
  body_text text not null,
  ask text not null,
  status text not null default 'queued' check (status in ('queued','sent','replied','resolved','gave_up')),
  sent_at timestamptz,
  provider_message_id text,
  reply_at timestamptz,
  reply_from text,
  reply_excerpt text,
  outcome text,
  nudges int not null default 0,
  next_check_at timestamptz,
  verify_sql text,
  owner_slug text not null default 'scout',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vendor_requests enable row level security;
create policy "admin vendor_requests" on public.vendor_requests for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
grant select, update on public.vendor_requests to authenticated;

create or replace function public.vendor_request_check() returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_reply record; v_works boolean; v_days int;
begin
  for r in select * from vendor_requests
            where status in ('sent','replied') and (next_check_at is null or next_check_at <= now()) loop

    v_works := null;
    if r.vendor = 'ElevenLabs' then
      select coalesce(bool_or(mid_call_partial), false) into v_works
        from ava_live_watch where started_at > now() - interval '7 days';
      if v_works then
        update vendor_requests set status = 'resolved', outcome = 'Live words started working: a call showed its transcript mid-call.',
          updated_at = now(), next_check_at = null where id = r.id;
        perform scout_notify('Scout: ' || r.vendor || ' request is done',
          'Live call transcript is working now, so the realtime-monitoring flag is on. Closing the request I sent on '
          || to_char(r.sent_at, 'Mon FMDD') || '. The live view will fill in while a call is happening from here on.',
          'info', false, 'https://bestly.tech/admin/roofguard', 'vendor-req-done-' || r.id::text);
        continue;
      end if;
    end if;

    if r.status = 'sent' and r.vendor_domain is not null then
      select from_addr, subject, left(coalesce(body_text,''), 600) body, sent_at into v_reply
        from bestly_mail
       where from_addr ilike '%@' || r.vendor_domain
         and sent_at > r.sent_at
         and from_addr not ilike 'no-reply@%'
       order by sent_at asc limit 1;
      if v_reply.from_addr is not null then
        update vendor_requests set status = 'replied', reply_at = v_reply.sent_at, reply_from = v_reply.from_addr,
          reply_excerpt = v_reply.body, updated_at = now(), next_check_at = now() + interval '2 days' where id = r.id;
        perform scout_notify('Scout: ' || r.vendor || ' replied about the live transcript',
          'From ' || v_reply.from_addr || ': "' || left(regexp_replace(v_reply.body, '\s+', ' ', 'g'), 300) || '"',
          'high', true, 'https://bestly.tech/admin', 'vendor-req-reply-' || r.id::text);
        continue;
      end if;
    end if;

    v_days := greatest(0, extract(day from now() - coalesce(r.sent_at, r.created_at))::int);
    if r.status = 'sent' and v_days >= 3 then
      if r.nudges >= 3 then
        update vendor_requests set status = 'gave_up', updated_at = now(), next_check_at = null,
          outcome = 'No reply after ' || v_days || ' days and 3 reminders.' where id = r.id;
        perform scout_notify('Scout: giving up chasing ' || r.vendor,
          'No reply in ' || v_days || ' days to the realtime-monitoring request. I have stopped checking. '
          || 'Next step if you still want it: their in-app support chat while signed in, which gets a human faster than email.',
          'medium', false, 'https://bestly.tech/admin', 'vendor-req-gaveup-' || r.id::text);
      else
        update vendor_requests set nudges = r.nudges + 1, next_check_at = now() + interval '3 days', updated_at = now() where id = r.id;
        perform scout_notify('Scout: ' || r.vendor || ' has not replied in ' || v_days || ' days',
          'Still waiting on the realtime-monitoring flag, so live call words are still only arriving at hang-up. '
          || 'Want me to send a follow-up, or try their in-app support chat? Reminder ' || (r.nudges + 1) || ' of 3.',
          'medium', false, 'https://bestly.tech/admin', 'vendor-req-nudge-' || r.id::text || '-' || (r.nudges + 1)::text);
      end if;
    end if;
  end loop;
exception when others then
  raise warning 'vendor_request_check failed: %', sqlerrm;
end $function$;
select cron.schedule('vendor-request-check', '37 */4 * * *', $$select public.vendor_request_check()$$);

-- Jared's rule: every alert is signed by the employee responsible. Ownership matches on the dedupe-key prefix.
insert into public.notification_owners (prefix, agent_slug, note)
values ('vendor-req', 'scout', 'Scout chases requests we sent to vendors until they are answered')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;

select public.team_onboard($j$[
 {"slug":"vendor-chaser","name":"Vendor Chaser","role":"Chases requests sent to vendors","tool_of":"scout","runs_on":"cloud","icon":"mail-question",
  "schedule":"every 4 hours at :37",
  "what_it_does":"Watches every request Bestly sends a vendor until it is actually answered. Reads replies out of Jared's own mailbox, checks whether the thing we asked for started working, reminds Jared up to three times if nobody answers, then stops and says so. Currently chasing ElevenLabs for the live-call-transcript flag.",
  "pulse":{"src":"cron","job":"vendor-request-check","gap":300},
  "owns":["vendor-req"]}
]$j$::jsonb);

-- The ElevenLabs request itself was inserted and sent live on 2026-10-05; Resend id 01a10f97-36b5-7161-a7f3-940ada8100d1.
-- Not re-inserted here on purpose: replaying this migration must not send the vendor a second copy.
