-- Outside watchdog (Mac mini ~/bin/bestly-watchdog.py, launchd tech.bestly.watchdog, every minute), 2026-09-24.
-- Scout's own alerts live in this database, so when the database freezes nobody hears about it. The Mac probes it
-- from outside, pushes to ntfy directly, pauses its own pollers while it's down, resumes them after, and reports
-- the incident here when it's back. It authenticates with a token only the Mac holds (Keychain); we keep its hash.
create table if not exists public.db_watchdog_tokens (token_hash text primary key, label text, created_at timestamptz default now());
alter table public.db_watchdog_tokens enable row level security;
insert into public.db_watchdog_tokens(token_hash, label) values ('6e5df488dbe46ee9d2bd7ddeef2184bf493cc2ea628fa7a72e028f4dc3489f8e', 'mac mini db_watchdog.py')
on conflict do nothing;

create or replace function public.db_watchdog_ok(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from db_watchdog_tokens where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')) $$;

-- The Mac caches the push topic while the database is healthy, so it can still alert when it isn't.
create or replace function public.db_watchdog_sync(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return (select jsonb_build_object('ntfy_topic', ntfy_topic, 'push_enabled', push_enabled) from home_hub_settings limit 1);
end $$;

create or replace function public.db_watchdog_report(p_token text, p_down_at timestamptz, p_up_at timestamptz, p_detail jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare mins int := greatest(1, round(extract(epoch from (p_up_at - p_down_at)) / 60)::int); m record;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  select * into m from db_metrics where at between p_down_at - interval '20 minutes' and p_down_at order by at desc limit 1;
  insert into ops_incidents(started_at, ended_at, component, symptom, detail, actions, resolved_by, lesson, source)
  values (p_down_at, p_up_at, 'database', 'Database stopped answering (' || mins || ' min)',
    p_detail || jsonb_build_object('mem_avail_mb_before', m.mem_avail_mb, 'swap_used_mb_before', m.swap_used_mb, 'load1_before', m.load1),
    coalesce(p_detail->'actions', '[]'::jsonb), coalesce(p_detail->>'resolved_by', 'recovered'),
    'Nano compute (0.5 GB) swaps under load and freezes. Real fix: bigger compute. Meanwhile db-memory-watch sheds background jobs early.',
    'mac db_watchdog');
  perform scout_notify(p_title := 'Database was down ' || mins || ' min, now back',
    p_body := 'The Mac mini watchdog saw it from outside, paused its pollers while it was down and restarted them. Logged in ops incidents.',
    p_severity := 'warning', p_push := false, p_url := '/admin', p_dedupe := 'dbdown.' || to_char(p_down_at, 'YYYYMMDDHH24MI'));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.db_watchdog_ok(text) from public, anon, authenticated;
revoke all on function public.db_watchdog_sync(text), public.db_watchdog_report(text, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.db_watchdog_sync(text), public.db_watchdog_report(text, timestamptz, timestamptz, jsonb) to anon, authenticated;

-- Record tonight's and yesterday's freezes so Scout's learning loop has them.
insert into ops_incidents(started_at, ended_at, component, symptom, detail, actions, resolved_by, lesson, source) values
 ('2026-09-23 11:00+00', '2026-09-23 17:35+00', 'database', 'Database froze ~6.5 h (REST 5xx, statement timeouts)',
  '{"compute":"nano","mem_total_mb":407}', '["restart"]', 'restart (unknown who)',
  'Nano compute swaps and freezes; nothing outside the database was watching it.', 'cowork audit 2026-09-24'),
 ('2026-09-24 08:05+00', '2026-09-24 08:29+00', 'database', 'Database froze ~24 min (connection timeouts, statement timeouts)',
  '{"compute":"nano","mem_avail_mb_after_restart":157,"swap_used_mb_after_restart":356,"load1":6.61}', '["paused mac pollers","project restart from dashboard"]', 'cowork',
  'Swap-bound Nano instance; restart fixed it. Added db-memory-watch (shed jobs) and the Mac outside watchdog (ntfy direct).', 'cowork audit 2026-09-24');
