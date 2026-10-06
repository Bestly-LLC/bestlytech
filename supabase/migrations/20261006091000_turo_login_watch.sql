-- 2026-10-06 Sign-in Helper: the watchdog for the guest login page (/turo-key, /turo-lax).
-- Owner: LAX Concierge (Guest Experience Manager). Runs in the database every 10 minutes (no Claude, no paid AI).
--
-- Every run:
--   1. Heals first: re-reads Turo's emails (turo_enrich_from_mail) so every trip has the guest's phone, any country.
--      Nothing called that function on a schedule before today, so phones (and earnings) went stale.
--   2. Looks for a real guest who is stuck: 3+ failed sign-ins in 30 minutes that match an upcoming trip by phone or
--      name, with no successful sign-in since. That guest is waiting, so LAX Concierge tells Jared once (per trip, per
--      6 hours) with the guest's direct link ready to paste in Turo chat.
--   3. Writes the "Guest sign-in" row on the trip health board.
-- Host test attempts (kind = 'host-test') are ignored.

create table if not exists public.turo_login_alerts (
  reservation_id bigint primary key,
  alerted_at timestamptz not null default now(),
  fails int not null default 0
);
alter table public.turo_login_alerts enable row level security;
revoke all on public.turo_login_alerts from anon, authenticated;

create or replace function public.turo_login_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; healed int := 0; stuck int := 0; names text := ''; v_when text;
begin
  begin healed := turo_enrich_from_mail(); exception when others then healed := -1; end;

  for r in
    select t.reservation_id, t.guest_first, t.starts_at, l.token,
           count(a.*) filter (where not a.ok) as fails
      from turo_trips t
      join lax_guest_links l using (reservation_id)
      join guest_entry_attempts a
        on a.at > now() - interval '30 minutes'
       and not a.ok
       and a.kind is distinct from 'host-test'
       and (turo_phone_match(a.phone_digits, t.guest_phone) is true
            or (a.name_key is not null and turo_name_fits(a.name_key, t.guest_first, t.guest_last)))
     where t.ends_at > now() and t.starts_at < now() + interval '48 hours'
       and coalesce(t.status, '') not ilike '%cancel%'
       and not exists (select 1 from guest_entry_attempts s where s.ok and s.reservation_id = t.reservation_id
                                                               and s.at > now() - interval '30 minutes')
     group by t.reservation_id, t.guest_first, t.starts_at, l.token
    having count(*) >= 3
  loop
    stuck := stuck + 1;
    names := names || case when names = '' then '' else ', ' end || coalesce(r.guest_first, 'a guest');
    if exists (select 1 from turo_login_alerts x where x.reservation_id = r.reservation_id and x.alerted_at > now() - interval '6 hours') then
      continue;
    end if;
    v_when := case when r.starts_at > now()
                   then 'pickup ' || to_char(r.starts_at at time zone 'America/Los_Angeles', 'FMDy FMHH12:MI AM')
                   else 'trip in progress' end;
    perform scout_notify(
      p_title => 'LAX Concierge: ' || coalesce(r.guest_first, 'A guest') || ' can''t open the trip page',
      p_body => coalesce(r.guest_first, 'The guest') || ' tried to sign in ' || r.fails || ' times in the last 30 minutes (' || v_when
                || ') and is waiting for you. Paste the direct link in Turo chat: bestly.tech/t/' || r.token
                || '. I already re-checked Turo''s emails for the phone number.',
      p_severity => 'warning', p_push => true, p_url => '/admin/turo/lax-pass#keys',
      p_dedupe => 'turo.login.' || r.reservation_id);
    insert into turo_login_alerts (reservation_id, alerted_at, fails) values (r.reservation_id, now(), r.fails)
      on conflict (reservation_id) do update set alerted_at = now(), fails = excluded.fails;
  end loop;

  perform trip_health_set('guest_login', 'Guest sign-in',
    case when healed < 0 then 'warn' when stuck > 0 then 'fail' else 'ok' end,
    case when healed < 0 then 'Could not re-read Turo''s emails for guest phones.'
         when stuck > 0 then 'Stuck signing in: ' || names || '.' end,
    case when healed > 0 then 'Filled ' || healed || ' trip detail(s) from Turo''s emails.' end);

  return jsonb_build_object('healed', healed, 'stuck', stuck);
end $$;
revoke all on function public.turo_login_watch() from public, anon, authenticated;
grant execute on function public.turo_login_watch() to service_role;

select cron.unschedule('turo-login-watch') where exists (select 1 from cron.job where jobname = 'turo-login-watch');
select cron.schedule('turo-login-watch', '7-59/10 * * * *', 'select public.turo_login_watch()');

-- Team page: a tool of LAX Concierge, owning the turo.login.* alerts.
select public.team_onboard('[{
  "slug": "turo-login-watch",
  "name": "Sign-in Helper",
  "role": "Watches guests signing in to their trip page",
  "what_it_does": "Every 10 minutes: re-reads Turo emails so every trip has the guest phone (any country), spots a guest who keeps failing to sign in at bestly.tech/turo-key or /turo-lax, and has LAX Concierge send Jared their direct link to paste in Turo chat.",
  "tool_of": "lax-concierge",
  "runs_on": "cloud",
  "schedule": "every 10 min",
  "icon": "log-in",
  "admin_url": "/admin/turo",
  "pulse": {"src": "cron", "job": "turo-login-watch", "gap": 25},
  "owns": ["turo.login"]
}]'::jsonb);
