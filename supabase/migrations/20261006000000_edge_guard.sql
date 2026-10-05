-- 2026-10-05 Edge Guard: the AI employee that owns the Cloudflare edge (bestly.tech, www, cloud).
-- Why: the account is on the Workers FREE plan (100,000 requests a day, shared). Two splash Workers sat on
-- bestly.tech/*, www.bestly.tech/* and cloud.bestly.tech/* all day, every request counted, the cap was hit and
-- Cloudflare answered every visitor with error 1027. Fix: no Worker routes exist normally (zero quota); Edge Guard
-- attaches a splash route only while a site is failing, detaches it when healthy, keeps every route fail-open, and
-- tells Jared. It runs on the Mac mini (launchd, every minute): see docs/edge-guard.md.
-- The Mac reaches the database the same way the Mac watchdog does: publishable key + the watchdog token in
-- Keychain (bestly-db-watchdog), checked by db_watchdog_ok(). No new secret.

-- ------------------------------------------------------------------ log (one row per event, not per run)
create table if not exists public.edge_guard_log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  site   text not null,          -- 'bestly.tech' | 'cloud.bestly.tech' | 'cloudflare' | 'guard'
  state  text not null,          -- ok | down | quota | recovered | repaired | token | error
  action text not null,          -- none | attached splash | detached splash | set fail open | alert | ...
  detail text
);
create index if not exists edge_guard_log_at_idx on public.edge_guard_log (at desc);
alter table public.edge_guard_log enable row level security;
revoke all on public.edge_guard_log from anon, authenticated;
grant select on public.edge_guard_log to authenticated;
create policy "admin reads edge guard log" on public.edge_guard_log
  for select to authenticated using (public.team_is_admin());

-- ------------------------------------------------------------------ heartbeat (one row, rewritten every run)
-- Team Watch reads this through the card's pulse; silence here turns the card yellow, then red, and it alerts.
create table if not exists public.edge_guard_beat (
  id      int primary key default 1 check (id = 1),
  at      timestamptz not null default now(),
  ok      boolean not null default true,
  summary text
);
alter table public.edge_guard_beat enable row level security;
revoke all on public.edge_guard_beat from anon, authenticated;
grant select on public.edge_guard_beat to authenticated;
create policy "admin reads edge guard beat" on public.edge_guard_beat
  for select to authenticated using (public.team_is_admin());

-- ------------------------------------------------------------------ what the Mac calls
-- Log an event and, optionally, tell Jared. p_alert = {title, body, severity, push, dedupe, url}.
-- Titles always start with "Edge Guard:" so every alert is signed by the employee who owns it.
create or replace function public.edge_guard_note_t(
  p_token text, p_site text, p_state text, p_action text, p_detail text default null, p_alert jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_title text; v_res jsonb := '{}'::jsonb;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  insert into edge_guard_log (site, state, action, detail)
  values (left(coalesce(p_site, 'guard'), 80), left(coalesce(p_state, 'ok'), 40), left(coalesce(p_action, 'none'), 80), left(p_detail, 1500));
  if p_alert is not null and p_alert ? 'title' then
    v_title := p_alert->>'title';
    if v_title not like 'Edge Guard%' then v_title := 'Edge Guard: ' || v_title; end if;
    v_res := scout_notify(v_title, p_alert->>'body', coalesce(p_alert->>'severity', 'info'),
                          coalesce((p_alert->>'push')::boolean, false), coalesce(p_alert->>'url', '/admin/team'),
                          p_alert->>'dedupe');
  end if;
  -- keep the log small
  if random() < 0.02 then delete from edge_guard_log where at < now() - interval '60 days'; end if;
  return v_res;
end $$;
revoke all on function public.edge_guard_note_t(text, text, text, text, text, jsonb) from public;
grant execute on function public.edge_guard_note_t(text, text, text, text, text, jsonb) to anon, authenticated, service_role;

create or replace function public.edge_guard_beat_t(p_token text, p_ok boolean default true, p_summary text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  insert into edge_guard_beat (id, at, ok, summary) values (1, now(), coalesce(p_ok, true), left(p_summary, 300))
  on conflict (id) do update set at = excluded.at, ok = excluded.ok, summary = excluded.summary;
end $$;
revoke all on function public.edge_guard_beat_t(text, boolean, text) from public;
grant execute on function public.edge_guard_beat_t(text, boolean, text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------ team card (onboarding protocol, CLAUDE.md rule)
select public.team_onboard($j$[
 {"slug":"edge-guard","name":"Edge Guard","role":"Cloudflare and uptime guard","reports_to":"security-auditor","dept":"ops",
  "runs_on":"mac_mini","icon":"shield-check","schedule":"every minute","sort":32,
  "what_it_does":"Owns the Cloudflare edge for bestly.tech, www and cloud. Checks the three sites every minute. When a site is down it shows the 'we'll be right back' page, and takes it off when the site is healthy again. Keeps every Worker route fail-open so the free plan's request cap can never lock visitors out (error 1027). Tells you, signed Edge Guard.",
  "pulse":{"src":"at","table":"edge_guard_beat","col":"at","ok":"ok","sum":"summary","gap":5,"alert":true,"issues":["edge."]},
  "owns":["edge","edge-guard"]}
]$j$::jsonb);
