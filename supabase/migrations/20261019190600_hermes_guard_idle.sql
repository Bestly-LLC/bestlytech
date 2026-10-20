-- Hermes guard moves from 15-second polling to IMAP IDLE (moves iPostal1 mail within about a second). Polling stays as the fallback.
-- Adds hermes_state.guard_mode / guard_polling_since, hermes_guard_mode_t(), and a hermes_watch() that tells Scout (quietly) when IDLE
-- has been down for 10 minutes. Applied to the project 2026-10-19 as migration hermes_guard_idle; full hermes_watch() body lives there.
alter table public.hermes_state add column if not exists guard_mode text not null default 'unknown' check (guard_mode in ('unknown','idle','polling'));
alter table public.hermes_state add column if not exists guard_polling_since timestamptz;

create or replace function public.hermes_guard_mode_t(p_moved bigint default 0, p_mode text default 'polling') returns void
language sql security definer set search_path to 'public' as $$
  update public.hermes_state set
    guard_beat_at = now(), guard_moved_run = coalesce(p_moved, 0), updated_at = now(),
    guard_mode = case when p_mode = 'idle' then 'idle' else 'polling' end,
    guard_polling_since = case when p_mode = 'idle' then null else coalesce(guard_polling_since, now()) end
  where id
$$;
revoke all on function public.hermes_guard_mode_t(bigint, text) from public, anon, authenticated;
grant execute on function public.hermes_guard_mode_t(bigint, text) to service_role;

do $p$
declare d text;
begin
  select pg_get_functiondef('public.hermes_watch()'::regprocedure) into d;
  if position('idle-down' in d) = 0 then
    d := replace(d, E'    v_out := v_out || ''guard-stale '';\n  end if;', E'    v_out := v_out || ''guard-stale '';\n  elsif s.guard_mode = ''polling'' and s.guard_polling_since is not null and s.guard_polling_since < now() - interval ''10 minutes'' then\n    perform public.scout_notify(p_title => ''Scout: Hermes'''' mail guard can''''t hold its live connection'', p_body => ''It fell back to checking every 15 seconds, so iPostal1 emails can sit in your inbox for up to 15 seconds. It keeps trying to reconnect.'', p_severity => ''warning'', p_push => false, p_url => ''/admin/team?hermes=1'', p_dedupe => ''hermes-guard-idle-'' || to_char(now() at time zone ''America/Los_Angeles'', ''YYYYMMDD''));\n    v_out := v_out || ''idle-down '';\n  end if;');
    execute d;
  end if;
end $p$;
