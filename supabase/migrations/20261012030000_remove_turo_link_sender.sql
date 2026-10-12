-- 2026-10-11: Jared retired the Turo trip-link auto-sender ("delete it all, we do not use anymore").
-- Guests reach their trip page from bestly.tech/turo-key (phone + last name) or a link Jared shares.
-- Removed: turo_link_msgs, the sender RPCs and watchdog, its trip-health row, its public-RPC allowlist rows,
-- and the Link Sender team card (retired). The Mac mini launchd job tech.bestly.turo-sender is unloaded separately.
-- KEPT on purpose: turo_sender_settings, because Claims Closer (claims_enabled) and the Pi Turo reader
-- (last_ingest_at / turo_sync health) still read and write it.

do $mig$
declare src text; a int; b int;
begin
  -- trip_health_run: drop the trip-link message checks, keep the Turo bookings sync check.
  src := pg_get_functiondef('public.trip_health_run()'::regprocedure);
  src := replace(src, E'    delete from turo_link_msgs where reservation_id = r.reservation_id;\n', '');
  a := position('  -- 11) Turo sync + trip-link messages.' in src);
  b := position('    perform trip_health_set(''turo_sync''' in src);
  if a > 0 and b > a then
    src := substr(src, 1, a - 1)
        || E'  -- 11) Turo bookings sync. (The trip-link auto-sender was removed 2026-10-11.)\n'
        || E'  declare ss turo_sender_settings; begin\n'
        || E'    select * into ss from turo_sender_settings where id = 1;\n\n'
        || substr(src, b);
  end if;
  if src ~ 'turo_link_msgs|turo_sender_watchdog' then raise exception 'trip_health_run still references the sender'; end if;
  execute src;

  -- tesla_worker_alive_watch: its fix steps no longer restart the sender.
  src := pg_get_functiondef('public.tesla_worker_alive_watch()'::regprocedure);
  if position('tesla-worker turo-sender' in src) > 0 then
    execute replace(src, 'tesla-worker turo-sender', 'tesla-worker');
  end if;
end $mig$;

drop function if exists public.turo_link_admin(bigint, text);
drop function if exists public.turo_link_enqueue();
drop function if exists public.turo_link_body(bigint);
drop function if exists public.turo_sender_claim(text, text);
drop function if exists public.turo_sender_done(text, bigint, boolean, text, boolean);
drop function if exists public.turo_sender_note(text, text, jsonb);
drop function if exists public.turo_sender_watchdog();
drop table if exists public.turo_link_msgs;

delete from public.security_public_rpcs where fn in ('turo_sender_note', 'turo_sender_claim', 'turo_link_admin', 'turo_link_enqueue', 'turo_link_body', 'turo_sender_done', 'turo_sender_watchdog');
delete from public.trip_health where check_key = 'turo_links';
delete from public.privacy_data_map where table_name = 'turo_link_msgs';
update public.bestly_agents set status = 'retired', updated_at = now(),
  what_it_does = 'Retired 2026-10-11. Used to message each new guest their trip link from the Mac mini; guests now use bestly.tech/turo-key.'
 where slug = 'turo-sender';
