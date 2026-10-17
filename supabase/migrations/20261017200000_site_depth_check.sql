-- 2026-10-17 — the depth check Ares was missing, plus its watchdog.
--
-- Background and the two misses it exists for: supabase/functions/site-depth-check/index.ts
-- and docs/site-depth-check.md.
--
-- Pieces here:
--   1. site_depth_beat      — one row, written by the edge function on every run.
--   2. site_depth_watch()   — every 30 min: if the beat is older than 45 minutes,
--                             raise site.depth-check.stale and hand it to Ares.
--                             A checker that dies quietly is the whole reason
--                             this file exists; the check gets its own check.
--   3. notification_owners  — the `site` prefix signs every finding Ares, which
--                             is what the routing rule requires and what makes
--                             the Fix Ladder pick it up under the right card.
--   4. cron                 — the 15-minute tick that runs the edge function.
--   5. team card            — the tool under Ares, with its pulse.

-- ------------------------------------------------------------------ 1. heartbeat

create table if not exists public.site_depth_beat (
  id          integer primary key default 1,
  at          timestamptz not null default now(),
  ok          boolean     not null default true,
  raised      integer     not null default 0,
  cleared     integer     not null default 0,
  checks      integer     not null default 0,
  constraint site_depth_beat_single_row check (id = 1)
);

comment on table public.site_depth_beat is
  'Last run of the site-depth-check edge function. Read by site_depth_watch() to catch the check itself dying. Service-role only; no policies.';

alter table public.site_depth_beat enable row level security;
-- No policies on purpose: nothing but the service role (the edge function) and
-- the SECURITY DEFINER watchdog below may touch it.

-- ------------------------------------------------------------------ 2. watchdog

create or replace function public.site_depth_watch()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  b     public.site_depth_beat;
  v_age numeric;
begin
  select * into b from public.site_depth_beat where id = 1;

  if b.id is null then
    perform public.bestly_raise(
      'site.depth-check.stale', 'problem', 'warning',
      'The site depth check has never run',
      'probe-external only looks at status codes, and bestly.tech answers 200 for every URL on it including the broken ones, so nothing else would notice a page whose data has stopped loading. site-depth-check should have written its first beat within 15 minutes of deploy.',
      'site',
      'Deploy site-depth-check and confirm the cron job site-depth-check is active.');
    return jsonb_build_object('raised', true, 'reason', 'never_ran');
  end if;

  v_age := extract(epoch from (now() - b.at)) / 60.0;

  if v_age > 45 then
    perform public.bestly_raise(
      'site.depth-check.stale', 'problem', 'warning',
      'The site depth check has gone quiet',
      'Last run was ' || round(v_age)::text || ' minutes ago (it runs every 15). Until it comes back, nothing is checking what bestly.tech actually renders or whether its public data calls still work.',
      'site',
      'Check the site-depth-check function and the site-depth-check cron job.');
    return jsonb_build_object('raised', true, 'age_min', round(v_age));
  end if;

  perform public.bestly_raise('site.depth-check.stale', 'resolved', 'info',
    'The site depth check is running again', null, 'site');

  return jsonb_build_object('ok', true, 'age_min', round(v_age), 'last_raised', b.raised);
end $$;

revoke all on function public.site_depth_watch() from public;
grant execute on function public.site_depth_watch() to authenticated, service_role;

-- ------------------------------------------------------------------ 3. who answers for it

insert into public.notification_owners (prefix, agent_slug, note) values
  ('site',  'security-auditor', 'What bestly.tech actually renders: routes, assets, public data calls, sitemap (2026-10-17)'),
  ('site.', 'security-auditor', 'What bestly.tech actually renders: routes, assets, public data calls, sitemap (2026-10-17)')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;

-- ------------------------------------------------------------------ 4. the tick

do $$ begin
  perform cron.unschedule('site-depth-check');
exception when others then null;
end $$;

select cron.schedule(
  'site-depth-check',
  '6-59/15 * * * *',
  $$ select public.invoke_edge_function('site-depth-check', '{}'::jsonb, 60000) $$
);

do $$ begin
  perform cron.unschedule('site-depth-watch');
exception when others then null;
end $$;

select cron.schedule(
  'site-depth-watch',
  '12,42 * * * *',
  $$ select public.site_depth_watch() $$
);

-- ------------------------------------------------------------------ 5. team card (CLAUDE.md rule: a card the day it goes live)

select public.team_onboard($j$[
 {"slug":"site-depth-check","name":"Depth Check","role":"Tests what bestly.tech actually renders","dept":"ops",
  "reports_to":"security-auditor","runs_on":"cloud","icon":"scan-eye","schedule":"every 15 min, plus a 30 min watchdog","sort":29,
  "what_it_does":"Every 15 minutes it fetches the pages that carry revenue or a legal obligation and checks the HTML is really the app, that every file those pages load still resolves, that each public database call the site makes with no sign-in answers with live data, and that the sitemap's URLs all resolve. Written 2026-10-17 after two pages were broken for months while every status code was 200: /status was timing out its query, and /cookie-yeti/transparency had never once reached its database because its function was never applied to the project. It files what it finds as Ares, and Ares's watchdog raises the alarm if the check itself stops running.",
  "pulse":{"src":"at","table":"site_depth_beat","col":"at","ok":"ok","sum":"raised || ' raised / ' || cleared || ' cleared of ' || checks","gap":45,"alert":true,"issues":["site."]},
  "owns":["site"]}
]$j$::jsonb);
