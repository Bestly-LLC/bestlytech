-- Every notification belongs to one AI employee, and that employee is the one who tells Jared.
--
-- 1. notification_owners maps an alert key family (wall.*, car.*, ...) to the employee responsible for it.
-- 2. bestly_raise looks the owner up, the phone push is sent under that employee's name, and the bell card is signed by them.
-- 3. A key nobody owns falls back to System Monitor (the alarm) and shows up in notification_unowned so it can be assigned.

alter table public.admin_notifications add column if not exists agent_slug text;

create table if not exists public.notification_owners (
  prefix     text primary key,
  agent_slug text not null,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.notification_owners enable row level security;
drop policy if exists "admin reads notification owners" on public.notification_owners;
create policy "admin reads notification owners" on public.notification_owners
  for select to authenticated using (public.team_is_admin());

insert into public.notification_owners (prefix, agent_slug, note) values
  ('wall',            'wall-watchdog',   'Wall display problems'),
  ('wall-sign-legacy','wall-watchdog',   'Wall sign'),
  ('cron',            'system-monitor',  'Scheduled jobs that failed or went quiet'),
  ('uptime',          'system-monitor',  'Site and service uptime'),
  ('admin',           'system-monitor',  'Admin dashboard health'),
  ('vesta',           'system-monitor',  'Vesta app health'),
  ('car',             'car-guard',       'Car roster and Tesla'),
  ('tesla',           'car-guard',       'Tesla'),
  ('studio',          'studio-watch',    'Studio queue, posting engine, feedback'),
  ('ops:db-down',     'db-watch',        'Database down'),
  ('scout',           'scout',           'Scout itself'),
  ('ava',             'scout',           'Ava'),
  ('demo',            'scout',           'Demos'),
  ('partner',         'partner-scout',   'Eli and partner mail'),
  ('agent',           'team-watch',      'An employee went quiet'),
  ('team',            'team-watch',      'Team roll call'),
  ('mail',            'mail-bridge',     'Mail'),
  ('recorder',        'scout-notetaker', 'Meeting recorder'),
  ('ai',              'chat-router',     'AI provider limits and failures'),
  ('key',             'key-keeper',      'Keys'),
  ('keys',            'key-keeper',      'Keys'),
  ('security',        'security-auditor','Security findings'),
  ('ops:identity',    'security-auditor','Identity flags'),
  ('guest',           'turo-sender',     'Guest messages'),
  ('turo',            'turo-reader',     'Turo'),
  ('cy',              'cy-pipeline',     'Cookie Yeti pipeline')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;

-- Who owns this key: longest matching prefix, else System Monitor.
create or replace function public.notification_owner(p_key text)
returns table (slug text, name text, role text, owned boolean)
language sql stable security definer set search_path to 'public' as $$
  with hit as (
    select o.agent_slug
      from notification_owners o
      join bestly_agents a on a.slug = o.agent_slug and a.kind = 'agent' and a.status in ('active','paused','new')
     where p_key = o.prefix or p_key like o.prefix || '.%' or p_key like o.prefix || ':%'
     order by length(o.prefix) desc limit 1)
  select a.slug, a.name, a.role, exists (select 1 from hit)
    from bestly_agents a
   where a.slug = coalesce((select agent_slug from hit), 'system-monitor')
$$;

-- Alert keys that fell back to System Monitor because nobody owns them yet.
create or replace view public.notification_unowned with (security_invoker = true) as
  select i.key, i.title, i.status, i.push_count
    from monitor_issues i
   where not (select owned from notification_owner(i.key));

-- The phone push is sent under the owner's name.
create or replace function public.bestly_ntfy(p_title text, p_body text, p_priority integer, p_tags text[] default '{}'::text[], p_immediate boolean default false)
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare s home_hub_settings; v_title text := coalesce(p_title, 'Bestly'); v_src text := 'Bestly'; v_from text;
begin
  select * into s from home_hub_settings where id;
  if s.id is null or not s.push_enabled then return null; end if;
  v_from := nullif(current_setting('bestly.from', true), '');
  if v_from is not null then
    select name into v_src from bestly_agents where slug = v_from;
    v_src := coalesce(v_src, 'Bestly');
  elsif v_title ~* '^\s*scout\s*:\s*' then
    v_src := 'Scout';
    v_title := regexp_replace(v_title, '^\s*scout\s*:\s*', '', 'i');
  end if;
  return ha_push(v_title, coalesce(nullif(p_body, ''), p_title), _ha_level(p_priority), v_src,
                 'https://bestly.tech/admin', lower(v_src), null, null, null, false,
                 _ha_quiet_until(p_priority, p_immediate));
end $$;

-- bestly_raise: same grouping and throttling as before, plus the owner.
create or replace function public.bestly_raise(p_key text, p_kind text, p_severity text default 'warning', p_title text default null,
  p_body text default null, p_area text default null, p_needs_jared text default null, p_healed boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  s   public.home_hub_settings;
  iss public.monitor_issues;
  v_sev  text := lower(coalesce(p_severity,'warning'));
  v_push boolean := false;
  v_prio int;
  v_bell text;
  o record;
begin
  if p_kind not in ('problem','resolved') then
    raise exception 'bestly_raise: unknown kind %', p_kind;
  end if;
  if v_sev not in ('info','warning','error') then v_sev := 'warning'; end if;

  select * into o from notification_owner(p_key);
  select * into s from home_hub_settings where id;
  select * into iss from monitor_issues where key = p_key for update;

  if p_kind = 'problem' then
    if iss.key is null or iss.status = 'resolved' then
      insert into monitor_issues (key, status, severity, title, body, area, needs_jared, self_healed)
      values (p_key, 'open', v_sev, p_title, p_body, p_area, p_needs_jared, p_healed)
      on conflict (key) do update set
        status='open', severity=excluded.severity, title=excluded.title, body=excluded.body,
        area=excluded.area, needs_jared=excluded.needs_jared, self_healed=excluded.self_healed,
        opened_at=now(), updated_at=now(), resolved_at=null, last_pushed_at=null,
        occurrences = monitor_issues.occurrences + 1;
      v_push := not p_healed;
    else
      update monitor_issues set
        title=p_title, body=p_body, needs_jared=p_needs_jared, updated_at=now(),
        occurrences = occurrences + 1,
        severity = case when v_sev='error' then 'error' else severity end
      where key = p_key;
      v_push := not p_healed and (
        iss.last_pushed_at is null
        or iss.last_pushed_at < now() - make_interval(hours => coalesce(s.repush_hours, 6))
        or (v_sev='error' and iss.severity <> 'error'));
    end if;

    if v_push then
      v_prio := case v_sev when 'error' then 5 when 'warning' then 4 else 3 end;
      perform set_config('bestly.from', o.slug, true);
      perform bestly_ntfy(
        p_title,
        coalesce(p_body,'') || case when p_needs_jared is not null
                                    then E'\n\nNeeds you: ' || p_needs_jared else '' end,
        v_prio,
        array[case v_sev when 'error' then 'rotating_light' else 'warning' end, 'satellite']);
      perform set_config('bestly.from', '', true);
      update monitor_issues set last_pushed_at = now(), push_count = push_count + 1 where key = p_key;
    end if;

  else
    if iss.key is null or iss.status <> 'open' then
      return jsonb_build_object('ok', true, 'noop', true);
    end if;
    update monitor_issues set status='resolved', resolved_at=now(), updated_at=now(), needs_jared=null
     where key = p_key;
    if iss.last_pushed_at is not null then
      v_push := true;
      perform set_config('bestly.from', o.slug, true);
      perform bestly_ntfy(coalesce(nullif(p_title,''), 'Fixed: ' || iss.title), p_body, 3,
                          array['white_check_mark','satellite'], iss.severity = 'error');
      perform set_config('bestly.from', '', true);
    end if;
  end if;

  insert into monitor_events (key, kind, severity, title, body, pushed)
  values (p_key, p_kind, v_sev, p_title, p_body, v_push);

  v_bell := case when p_kind = 'resolved' then 'success'
                 when v_sev = 'error' then 'warning'
                 else v_sev end;

  if p_kind = 'problem' and exists (select 1 from admin_notifications
       where entity_key = 'monitor:' || p_key and read_at is null and severity <> 'success') then
    update admin_notifications set
      title = left(o.name || ': ' || coalesce(p_title,''),200),
      body  = left(coalesce(p_body,'') || case when p_needs_jared is not null then ' — Needs you: ' || p_needs_jared else '' end, 600),
      severity = v_bell, agent_slug = o.slug
     where entity_key = 'monitor:' || p_key and read_at is null and severity <> 'success';
    return jsonb_build_object('ok', true, 'pushed', v_push, 'bell', 'refreshed', 'owner', o.slug);
  end if;
  if p_kind = 'resolved' then
    update admin_notifications set read_at = now()
     where entity_key = 'monitor:' || p_key and read_at is null and severity <> 'success';
  end if;

  insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key, agent_slug)
  values ('monitor', left(o.name || ': ' || coalesce(p_title,''),200),
          left(coalesce(p_body,'') || case when p_needs_jared is not null
                                           then ' — Needs you: ' || p_needs_jared else '' end, 600),
          '/admin', 'monitor:' || p_key, v_bell,
          'monitor:' || p_key || ':' || p_kind || ':' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS'),
          o.slug)
  on conflict (dedupe_key) do nothing;

  return jsonb_build_object('ok', true, 'pushed', v_push, 'owner', o.slug);
end;
$$;
