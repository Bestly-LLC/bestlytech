-- Claims Closer return gate (2026-10-26), part 5: the 5-minute outbound watchdog cron and the team card.
-- Run from chat on 2026-10-26 outside a recorded migration; this file reproduces the live state (idempotent).
select cron.schedule('claims-guard-watch', '*/5 * * * *', 'select public.claims_guard_watch()');

update public.bestly_agents
   set profile = jsonb_set(coalesce(profile, '{}'::jsonb), '{quirk}',
         to_jsonb('Waits until the trip is over and Jared taps Complete trip before it ever messages a guest, and never quotes dollar amounts or speaks for Turo'::text)),
       pulse = case when coalesce(pulse->'also', '[]'::jsonb) ? 'claims-guard-watch' then pulse
                    else jsonb_set(coalesce(pulse, '{}'::jsonb), '{also}', coalesce(pulse->'also', '[]'::jsonb) || '["claims-guard-watch"]'::jsonb) end,
       updated_at = now()
 where slug = 'claims-closer';
