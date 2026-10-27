-- Skill Inbox, Add to Claude, part 2 (Radar). Idempotent.
--   * claude_app_offered: set once a Bestly chat has shown Jared the one-tap save card for an installed skill.
--   * Per-Mac install records, so the MacBook Air and the Mac mini each install a skill once.
--   * Token-gated Mac RPCs (same pattern as dock_sync_beat_t: db_watchdog_ok(token), publishable key, no service key on any Mac):
--       skill_inbox_mac_queue_t / skill_inbox_mac_done_t / skill_inbox_mac_beat_t
--   * skill_inbox_claude_watch(): in-database watchdog every 15 min (does not depend on the Pi), alerts signed Radar (prefix radar-skill).
--   * The card now carries claude_status; Undo is refused once a skill is installed; a failed skill can be retried by tapping again.

alter table public.skill_inbox add column if not exists claude_app_offered boolean not null default false;

create table if not exists public.skill_inbox_claude_hosts (
  id         uuid not null references public.skill_inbox(id) on delete cascade,
  host       text not null check (host ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  status     text not null check (status in ('installed', 'failed')),
  skill_name text,
  note       text,
  at         timestamptz not null default now(),
  primary key (id, host)
);
alter table public.skill_inbox_claude_hosts enable row level security;
revoke all on public.skill_inbox_claude_hosts from anon, authenticated;

-- the card carries the Claude status so the admin page can show drafting / installed
create or replace function public._skill_inbox_card(r public.skill_inbox)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'ig_shortcode', r.ig_shortcode, 'reel_url', r.reel_url, 'creator_handle', r.creator_handle,
    'saved_at', r.saved_at, 'received_at', r.received_at,
    'title', r.title, 'what_it_does', r.what_it_does,
    'fit_agent_slug', r.fit_agent_slug, 'fit_label', r.fit_label, 'fit_kind', r.fit_kind, 'fit_why', r.fit_why,
    'safe_status', r.safe_status, 'safe_why', r.safe_why,
    'cost_label', r.cost_label, 'cost_why', r.cost_why,
    'score', r.score, 'decision', r.decision, 'decided_at', r.decided_at,
    'surfaced_on', r.surfaced_on, 'resurfaced_at', r.resurfaced_at, 'resurfaced_why', r.resurfaced_why,
    'claude_status', r.claude_status)
$$;

-- decide: no Undo after install; tapping Add to Claude again retries a failed one
create or replace function public.skill_inbox_decide(p_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.skill_inbox;
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  if p_decision is not null and p_decision not in ('add','park','skip','claude') then
    raise exception 'decision must be add, park, skip, claude or null';
  end if;
  select * into r from public.skill_inbox where id = p_id for update;
  if not found or r.hidden or r.status <> 'ready' then raise exception 'That save is not available'; end if;
  if p_decision = 'add' and r.safe_status = 'blocked' then raise exception 'Ares blocked this one'; end if;
  if p_decision = 'claude' and coalesce(r.safe_status, '') <> 'cleared' then raise exception 'Only Ares-cleared saves can go to Claude'; end if;
  if r.claude_status = 'installed' and p_decision is distinct from 'claude' then
    raise exception 'Already installed in Claude Code, so it cannot be undone here';
  end if;
  if p_decision = 'claude' and r.claude_status = 'failed' then
    delete from public.skill_inbox_claude_hosts where id = p_id and status = 'failed';
  end if;
  update public.skill_inbox
     set decision = p_decision,
         decided_at = case when p_decision is null then null else now() end,
         claude_status = case when p_decision = 'claude' and (r.claude_status is null or r.claude_status = 'failed') then 'drafting'
                              when p_decision is distinct from 'claude' and r.claude_status = 'drafting' then null
                              else r.claude_status end,
         updated_at = now()
   where id = p_id returning * into r;
  return public._skill_inbox_card(r) || jsonb_build_object('claude_status', r.claude_status);
end $$;

-- Mac: what is waiting for this machine (ready or already installed on another Mac, not yet recorded for this host)
create or replace function public.skill_inbox_mac_queue_t(p_token text, p_host text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h text := lower(coalesce(p_host, ''));
begin
  if not public.db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if h !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'bad host'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.claude_skill_name, 'skill_md', s.claude_skill_md) order by s.decided_at)
      from public.skill_inbox s
     where s.decision = 'claude' and s.safe_status = 'cleared' and not s.hidden
       and s.claude_status in ('ready', 'installed', 'failed')
       and s.claude_skill_name is not null and s.claude_skill_md is not null
       and s.decided_at > now() - interval '30 days'
       and not exists (select 1 from public.skill_inbox_claude_hosts x where x.id = s.id and x.host = h)
  ), '[]'::jsonb);
end $$;

-- Mac: report one skill as installed or failed on this host. A Mac may rename a skill whose folder name was taken (never overwrites).
create or replace function public.skill_inbox_mac_done_t(p_token text, p_host text, p_id uuid, p_status text,
                                                         p_name text default null, p_skill_md text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare h text := lower(coalesce(p_host, '')); r public.skill_inbox; v_name text;
begin
  if not public.db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if h !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'bad host'; end if;
  if p_status not in ('installed', 'failed') then raise exception 'bad status'; end if;
  select * into r from public.skill_inbox where id = p_id and decision = 'claude' for update;
  if not found then return jsonb_build_object('ok', false); end if;
  v_name := substring(p_name from '^[a-z0-9][a-z0-9-]{1,63}$');
  if p_status = 'installed' and v_name is not null and v_name is distinct from r.claude_skill_name
     and p_skill_md is not null and length(p_skill_md) <= 20000 and p_skill_md like '---%' then
    update public.skill_inbox set claude_skill_name = v_name, claude_skill_md = p_skill_md where id = p_id;
  end if;
  insert into public.skill_inbox_claude_hosts (id, host, status, skill_name, note)
  values (p_id, h, p_status, coalesce(v_name, r.claude_skill_name), left(p_note, 200))
  on conflict (id, host) do update set status = excluded.status, skill_name = excluded.skill_name, note = excluded.note, at = now();
  if p_status = 'installed' then
    update public.skill_inbox set claude_status = 'installed', claude_installed_at = coalesce(claude_installed_at, now()), updated_at = now()
     where id = p_id and claude_status in ('ready', 'failed', 'installed');
  else
    update public.skill_inbox set claude_status = 'failed', updated_at = now()
     where id = p_id and claude_status = 'ready'
       and not exists (select 1 from public.skill_inbox_claude_hosts x where x.id = p_id and x.status = 'installed');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Mac: heartbeat. Writes agent_beats and raises or clears an alert signed Radar when the installer itself reports a problem.
create or replace function public.skill_inbox_mac_beat_t(p_token text, p_host text, p_ok boolean, p_summary text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare h text := lower(coalesce(p_host, '')); k text; v_open boolean;
begin
  if not public.db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if h !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'bad host'; end if;
  k := 'radar-skill.claude-mac-' || h;
  insert into public.agent_beats (slug, at, ok, summary) values ('skill-inbox-mac-' || h, now(), coalesce(p_ok, true), left(p_summary, 500))
  on conflict (slug) do update set at = now(), ok = excluded.ok, summary = excluded.summary;
  select exists(select 1 from public.monitor_issues where key = k and status <> 'resolved') into v_open;
  if not coalesce(p_ok, true) then
    perform public.bestly_raise(k, 'problem', 'warning', 'Add to Claude could not install a skill on ' || h,
      coalesce(left(p_summary, 300), 'The Mac installer hit an error.') || ' Radar.', 'radar-skill', null, false);
  elsif v_open then
    perform public.bestly_raise(k, 'resolved', 'info', 'Fixed: Add to Claude on ' || h, 'The Mac installer is working again.', 'radar-skill', null, true);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- In-database watchdog (every 15 min, no Pi needed): drafting stuck, or a ready skill that no Mac has installed
create or replace function public.skill_inbox_claude_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d_n int; d_min numeric; r_n int; r_min numeric; d_bad boolean; r_bad boolean; v_open boolean;
begin
  select count(*), extract(epoch from now() - min(updated_at)) / 60 into d_n, d_min
    from public.skill_inbox where decision = 'claude' and claude_status = 'drafting' and safe_status = 'cleared';
  select count(*), extract(epoch from now() - min(updated_at)) / 60 into r_n, r_min
    from public.skill_inbox where decision = 'claude' and claude_status = 'ready' and safe_status = 'cleared';
  d_bad := d_n > 0 and d_min > 60;
  r_bad := r_n > 0 and r_min > 90;

  select exists(select 1 from public.monitor_issues where key = 'radar-skill.claude-draft' and status <> 'resolved') into v_open;
  if d_bad then
    perform public.bestly_raise('radar-skill.claude-draft', 'problem', 'warning', 'Add to Claude is not writing skills',
      d_n || ' skill' || case when d_n = 1 then ' has' else 's have' end || ' waited ' || round(d_min / 60.0, 1) ||
      ' hours to be written. The drafting job on Hestia is not running. Radar.', 'radar-skill', null, false);
  elsif v_open then
    perform public.bestly_raise('radar-skill.claude-draft', 'resolved', 'info', 'Fixed: Add to Claude is writing skills', 'Drafting is working again.', 'radar-skill', null, true);
  end if;

  select exists(select 1 from public.monitor_issues where key = 'radar-skill.claude-install' and status <> 'resolved') into v_open;
  if r_bad then
    perform public.bestly_raise('radar-skill.claude-install', 'problem', 'warning', 'Add to Claude skills are waiting for a Mac',
      r_n || ' skill' || case when r_n = 1 then ' is' else 's are' end || ' written but no Mac has installed ' || case when r_n = 1 then 'it' else 'them' end ||
      ' for ' || round(r_min / 60.0, 1) || ' hours. Both Macs may be asleep or offline. Radar.', 'radar-skill', null, false);
  elsif v_open then
    perform public.bestly_raise('radar-skill.claude-install', 'resolved', 'info', 'Fixed: Add to Claude installs', 'A Mac installed the waiting skills.', 'radar-skill', null, true);
  end if;
  return jsonb_build_object('drafting', d_n, 'ready', r_n, 'draft_alert', d_bad, 'install_alert', r_bad);
end $$;

revoke all on function public.skill_inbox_mac_queue_t(text, text)                          from public;
revoke all on function public.skill_inbox_mac_done_t(text, text, uuid, text, text, text, text) from public;
revoke all on function public.skill_inbox_mac_beat_t(text, text, boolean, text)             from public;
grant execute on function public.skill_inbox_mac_queue_t(text, text)                          to anon, authenticated, service_role;
grant execute on function public.skill_inbox_mac_done_t(text, text, uuid, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.skill_inbox_mac_beat_t(text, text, boolean, text)             to anon, authenticated, service_role;
revoke all on function public.skill_inbox_claude_watch() from public, anon, authenticated;
grant execute on function public.skill_inbox_claude_watch() to service_role;
revoke all on function public.skill_inbox_decide(uuid, text) from public, anon;
grant execute on function public.skill_inbox_decide(uuid, text) to authenticated, service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'skill-inbox-claude-watch';
    perform cron.schedule('skill-inbox-claude-watch', '7,22,37,52 * * * *', 'select public.skill_inbox_claude_watch()');
  end if;
end $$;

-- Pi drafting job (staged; installs on Hestia) and Radar's card
insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('skill_inbox_claude', 'Skill Inbox: write Claude skills for Add to Claude taps, free AI only (Radar)', 60, true)
on conflict (job) do nothing;

update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '"skill_inbox_claude"'::jsonb), updated_at = now()
 where slug = 'platform-radar' and not (coalesce(pulse->'also', '[]'::jsonb) ? 'skill_inbox_claude');
