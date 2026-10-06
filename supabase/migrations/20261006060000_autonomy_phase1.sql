-- Autonomy Phase 1 (docs/autonomy-opusplan.md, Jared 2026-10-05): clean the feed.
--   * Push gate: only 4 kinds of news reach his phone (security an employee couldn't fix, money, a real person
--     waiting, something down 1 hr+ nobody fixed) plus critical. Everything else is "held": a silent bell row and a
--     line in the evening recap. Live Activities and clears always pass.
--   * Needs you shows the same 4 kinds only, one card per problem.
--   * Every bell row is signed by its employee (agent_slug).
--   * autonomy_sweep (every 10 min): stale warnings close into the recap, good news closes the matching warning,
--     self-healed incidents that stay quiet 2 hours resolve themselves.
-- Off switches: autonomy_settings.push_gate / needs_you_gate / enabled.
-- Applied 2026-10-06 in pieces through execute_sql (no drops), this file is the same SQL in order.
-- Note: notify_route no longer prunes notify_ledger (the gate cut its inserts to a handful a day); add a prune job later.

create table if not exists public.autonomy_settings (
  id                boolean primary key default true check (id),
  enabled           boolean not null default true,
  push_gate         boolean not null default true,
  needs_you_gate    boolean not null default true,
  security_autofix  boolean not null default true,
  recap_hour        int not null default 19,
  updated_at        timestamptz not null default now()
);
insert into public.autonomy_settings (id) values (true) on conflict do nothing;
alter table public.autonomy_settings enable row level security;
create policy autonomy_settings_admin on public.autonomy_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

create table if not exists public.autonomy_held (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  title   text,
  body    text,
  source  text,
  level   text
);
create index if not exists autonomy_held_at on public.autonomy_held (at desc);
alter table public.autonomy_held enable row level security;
create policy autonomy_held_admin on public.autonomy_held for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- "System Monitor: Admin: csp › connect-src failed" and "Admin: csp › connect-src failed" are one problem.
create or replace function public.autonomy_subject(t text) returns text
language sql immutable set search_path = public as $$
  select left(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(t, '')),
    '^\s*(fixed|resolved|scout|done|checked)\s*:\s*', ''),
    '^\s*[^:]{2,40}:\s+', ''),
    '^\s*[^:]{2,40}:\s+', ''),
    '[0-9]+', '#', 'g'), 90)
$$;

-- Which of the 4 interrupt kinds a message is, or null (held / owner's job).
create or replace function public.interrupt_class(p_title text, p_body text, p_source text, p_level text)
returns text language plpgsql immutable set search_path = public as $$
declare t text := lower(coalesce(p_title, '') || ' ' || coalesce(p_body, '')); s text := lower(coalesce(p_source, ''));
        ti text := lower(coalesce(p_title, ''));
begin
  if p_level = 'critical' then return 'critical'; end if;
  -- Good news never interrupts; it goes to the recap.
  if ti ~ '^\s*(fixed|resolved)\y' or ti ~ '(is working again|back to normal|is back\y|is steady|recovered|caught up|reachable again|all clear)' then
    return null;
  end if;
  if ti ~ '^(your day|today''s recap|bestly today)' then return 'recap'; end if;
  -- The Fix Ladder's "Scout found the fix and needs your yes" is a paid-AI ask, not a person waiting: drop that line first.
  t := regexp_replace(t, '(next: )?scout (found the fix and )?needs your yes[^.]*\.?', '', 'g');
  if s in ('blue steel', 'claims closer') or s like 'turo%' and t ~ '(pick-?up|drop-?off|return|check-?in)'
     or t ~ '(\$\s?[0-9]|refund|chargeback|charged (you|your)|card was charged|charge failed|not billed|payment|payout|invoice|deposit|parking ticket|citation|\ytowed?\y|move blue steel|street sweeping)' then
    return 'money';
  end if;
  if t ~ '(ready for your ok|is waiting (on|for) you|wrote back|replied to you|for your reply|message from (?!jared)|left (you )?a (message|voicemail)|new lead|booking request|wants to (talk|book|meet)|asked for you)' then
    return 'person';
  end if;
  if t ~ '(sign-?in request|login request|approve (this|the|a) (sign|login|device)|suspicious|breach|intrud|unauthori[sz]ed|break-?in|moved with no trip|is unlocked|smoke|water leak|weather alert|earthquake|tsunami|flood warning|couldn.t fix (a|this|the) security|security risk)' then
    return 'security';
  end if;
  if t ~ '(still down|down for (an hour|over an hour|[0-9]+ h)|nobody could fix)' then return 'down'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- notify_route: the gate. Same as the live definition (re-read 2026-10-06) plus the held branch.
create or replace function public.notify_route(p_title text, p_body text DEFAULT NULL::text, p_level text DEFAULT 'active'::text, p_source text DEFAULT 'Bestly'::text, p_url text DEFAULT 'https://bestly.tech/admin'::text, p_group text DEFAULT NULL::text, p_tag text DEFAULT NULL::text, p_actions jsonb DEFAULT NULL::jsonb, p_live jsonb DEFAULT NULL::jsonb, p_clear boolean DEFAULT false, p_deliver_at timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s            notify_router_settings;
  v_level      text;
  v_key        text;
  v_window     int;
  v_channel    text;
  v_needs_ha   boolean;
  v_id         bigint;
begin
  select * into s from notify_router_settings where id;
  if s is null or not s.enabled then
    perform ha_push_enqueue(p_title, p_body, p_level, p_source, p_url,
                            p_group, p_tag, p_actions, p_live, p_clear, p_deliver_at);
    return 'off';
  end if;

  v_level := case when p_level in ('passive','active','time-sensitive','critical')
                  then p_level else 'active' end;

  v_needs_ha := (p_live is not null)
                or coalesce(p_clear, false)
                or (v_level = any (s.ha_levels));

  if coalesce(p_clear, false) then
    perform ha_push_enqueue(p_title, p_body, v_level, p_source, p_url,
                            p_group, p_tag, p_actions, p_live, true, p_deliver_at);
    return 'ha';
  end if;

  v_key := coalesce(nullif(p_tag, ''),
                    md5(lower(coalesce(p_title,'') || '|' ||
                              coalesce(p_body,'')  || '|' ||
                              coalesce(p_source,''))));

  -- Autonomy gate (2026-10-06): only the 4 interrupt kinds (and critical) reach his phone. Live Activities pass.
  if p_live is null
     and coalesce(current_setting('autonomy.allow', true), '') <> '1'
     and coalesce((select a.enabled and a.push_gate from autonomy_settings a where a.id), false)
     and interrupt_class(p_title, p_body, p_source, v_level) is null then
    insert into autonomy_held (title, body, source, level) values (left(p_title, 200), left(p_body, 500), p_source, v_level);
    begin
      insert into admin_notifications (kind, title, body, url, severity, dedupe_key, silent)
      values (coalesce(nullif(lower(regexp_replace(coalesce(p_source,'bestly'), '\W+', '-', 'g')), ''), 'bestly'),
              left(p_title, 200), left(p_body, 500), p_url,
              case v_level when 'time-sensitive' then 'warning' else 'info' end, v_key, true)
      on conflict (dedupe_key) do nothing;
    exception when others then null; end;
    return 'held';
  end if;

  v_window := case when v_level = 'critical'
                   then s.dedupe_critical_seconds else s.dedupe_seconds end;

  if exists (select 1 from notify_ledger
             where dedupe_key = v_key
               and sent_at > now() - make_interval(secs => v_window)) then
    return 'duplicate';
  end if;

  if v_needs_ha then
    perform ha_push_enqueue(p_title, p_body, v_level, p_source, p_url,
                            p_group, p_tag, p_actions, p_live, false, p_deliver_at);
    v_channel := 'ha';
  else
    perform push_web_send(p_title, p_body,
      case v_level when 'time-sensitive' then 'warning'
                   when 'passive' then 'info' else 'info' end,
      coalesce(p_url, 'https://bestly.tech/admin'),
      'router-' || v_key,
      'admin', null);
    v_channel := 'web';
  end if;

  insert into notify_ledger (dedupe_key, channel, level, title, source)
  values (v_key, v_channel, v_level, left(coalesce(p_title,''), 200), p_source);

  begin
    perform admin_notify(
      coalesce(nullif(lower(regexp_replace(coalesce(p_source,'bestly'), '\W+', '-', 'g')), ''), 'bestly'),
      p_title, p_body, p_url, null,
      case v_level when 'critical' then 'critical'
                   when 'time-sensitive' then 'warning' else 'info' end,
      v_key);
  exception when others then null; end;

  return v_channel;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- Every bell row is signed by the employee responsible for it (Jared's rule, 2026-10-04).
create or replace function public.admin_notifications_sign() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text; k text;
begin
  if new.agent_slug is not null then return new; end if;
  -- 1. "Name: ..." in the title
  select a.slug into v from bestly_agents a
   where a.kind = 'agent' and length(a.name) >= 3 and lower(new.title) like lower(a.name) || ':%'
   order by length(a.name) desc limit 1;
  -- 2. an owned alert prefix (entity / dedupe key / kind)
  if v is null then
    foreach k in array array[regexp_replace(coalesce(new.entity_key, ''), '^monitor:', ''), coalesce(new.dedupe_key, ''), coalesce(new.kind, '')] loop
      if k <> '' then
        select o.slug into v from notification_owner(k) o where o.owned;
        exit when v is not null;
      end if;
    end loop;
  end if;
  -- 3. the kind names an employee ("home_hub" -> home-hub, "wall-watchdog")
  if v is null then
    select a.slug into v from bestly_agents a
     where a.slug = replace(lower(coalesce(new.kind, '')), '_', '-') or lower(a.name) = lower(replace(coalesce(new.kind, ''), '-', ' '))
     limit 1;
  end if;
  if v is null then
    v := case lower(coalesce(new.kind, ''))
           when 'monitor' then 'system-monitor' when 'pi' then 'pi-runner' when 'mac' then 'mac-hands'
           when 'home-watch' then 'home-hub' when 'backups' then 'home-hub' when 'cron' then 'system-monitor'
           when 'ops' then 'fix-ladder' when 'cy_release' then 'cy-pipeline' else 'scout' end;
  end if;
  new.agent_slug := v;
  return new;
end $$;
create or replace trigger admin_notifications_sign before insert on public.admin_notifications
  for each row execute function public.admin_notifications_sign();

-- ---------------------------------------------------------------------------------------------------------------
-- Needs you: the old rule set stays as admin_today_rows_all(); admin_today_rows() keeps only the 4 kinds.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'admin_today_rows_all') then
    alter function public.admin_today_rows() rename to admin_today_rows_all;
  end if;
end $$;

alter table public.security_findings add column if not exists autofix jsonb;

create or replace function public.admin_today_rows()
 RETURNS TABLE(key text, source text, severity text, title text, detail text, action_label text, url text, since timestamp with time zone, item_count integer, rank integer, origin_table text, origin_id text, why text, fingerprint text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
with g as (select coalesce((select a.enabled and a.needs_you_gate from autonomy_settings a where a.id), false) as on_),
base as (
  select r.*,
    case
      when r.origin_table = 'admin_notifications' then
        (select interrupt_class(n.title, n.body, n.kind, n.severity) from admin_notifications n where n.id::text = r.origin_id)
      when r.origin_table = 'external_health' then case when r.since < now() - interval '1 hour' then 'down' end
      when r.origin_table = 'home_hub_issues' then
        case when r.severity in ('error', 'critical') and r.since < now() - interval '1 hour' then 'down' end
      when r.origin_table = 'studio_requests' and r.origin_id <> 'status=failed' then
        (select case when s.client_slug is not null then 'person' end from studio_requests s where s.id::text = r.origin_id)
      when r.origin_table = 'client_asks' and r.origin_id = 'status=draft' then 'person'
      when r.origin_table = 'cy_extension_releases' then 'person'
      when r.origin_table = 'shop_stock_alerts' then 'money'
      when r.origin_table = 'notify_outbox' then 'person'
      else null
    end as cls
  from admin_today_rows_all() r
),
extra as (
  -- Security an employee could not fix (Ares + Fix Ladder gave up, or it needs someone outside Bestly).
  select 'sec:' || f.key as key, 'Security' as source, 'error' as severity,
         'Ares couldn''t fix: ' || f.title as title,
         coalesce(f.autofix->>'reason', f.proposed_fix, '') as detail,
         'Open security' as action_label, '/admin/security' as url,
         coalesce((f.autofix->>'at')::timestamptz, f.first_seen) as since, 1 as item_count,
         1 as rank, 'security_findings' as origin_table, f.id::text as origin_id,
         'security_findings is open and the auto-fix handed it to a person' as why,
         coalesce(f.autofix->>'at', '') as fingerprint, 'security'::text as cls
  from security_findings f
  where f.status = 'open' and f.autofix->>'state' = 'needs_person'
  union all
  -- Down an hour or more and nobody fixed it.
  select 'down:' || m.key, 'Down', 'error',
         'Still down after an hour: ' || m.title, coalesce(m.body, ''),
         'Open incident', '/admin', m.opened_at, coalesce(m.occurrences, 1),
         1, 'monitor_issues', m.key,
         'monitor_issues is open, severity error, for over an hour',
         to_char(m.opened_at, 'YYYYMMDDHH24MISS'), 'down'::text
  from monitor_issues m
  where m.status = 'open' and m.severity = 'error' and m.opened_at < now() - interval '1 hour'
),
allrows as (
  select b.key, b.source, b.severity, b.title, b.detail, b.action_label, b.url, b.since, b.item_count, b.rank,
         b.origin_table, b.origin_id, b.why, b.fingerprint, b.cls from base b
  union all
  select e.key, e.source, e.severity, e.title, e.detail, e.action_label, e.url, e.since, e.item_count, e.rank,
         e.origin_table, e.origin_id, e.why, e.fingerprint, e.cls from extra e
  where not exists (select 1 from admin_today_dismissed d where d.key = e.key and d.fingerprint = e.fingerprint)
),
kept as (
  select a.*, row_number() over (partition by autonomy_subject(a.title) order by a.rank, a.since desc nulls last) as rn
  from allrows a, g
  where (not g.on_) or a.cls is not null
)
select k.key, k.source, k.severity, k.title, k.detail, k.action_label, k.url, k.since, k.item_count,
       case when k.cls in ('critical', 'security', 'down') then least(k.rank, 1) else k.rank end,
       k.origin_table, k.origin_id, k.why, k.fingerprint
from kept k
where k.rn = 1
order by 10, k.since nulls last;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- Sweep: keep the bell and the incidents honest without anyone tapping.
create or replace function public.autonomy_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int := 0; b int := 0; c int := 0; r record;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not coalesce(has_role(auth.uid(), 'admin'), false) then
    raise exception 'not allowed';
  end if;
  if not coalesce((select enabled from autonomy_settings where id), false) then return '{"off":true}'::jsonb; end if;

  -- 1. A warning that has not come back in 24 hours closes into the recap.
  update admin_notifications n set read_at = now()
   where n.read_at is null and n.severity in ('warning', 'error') and n.created_at < now() - interval '24 hours'
     and not exists (select 1 from admin_notifications m
                      where m.created_at > now() - interval '24 hours' and m.id <> n.id
                        and autonomy_subject(m.title) = autonomy_subject(n.title));
  get diagnostics a = row_count;

  -- 2. Good news closes the matching warning ("Fixed: X", "X is back to normal").
  update admin_notifications n set read_at = now()
   where n.read_at is null and n.severity in ('warning', 'error', 'critical')
     and exists (select 1 from admin_notifications m
                 where m.created_at > n.created_at and m.severity in ('success', 'info')
                   and (autonomy_subject(m.title) = autonomy_subject(n.title)
                        or (m.agent_slug is not distinct from n.agent_slug
                            and m.title ~* '(back to normal|is back|is steady|working again|recovered|all clear)'
                            and split_part(autonomy_subject(m.title), ' ', 1) = split_part(autonomy_subject(n.title), ' ', 1))));
  get diagnostics b = row_count;

  -- 3. Self-healed incidents ("..., so the Pi restarted it") that stay quiet 2 hours resolve themselves.
  for r in select key, title from monitor_issues
            where status = 'open' and updated_at < now() - interval '2 hours'
              and (self_healed or title ~* '(, so (the )?(pi|mac|wall|scout)|rolled back|refreshed before|restarted it|fixed it)')
  loop
    perform bestly_raise(r.key, 'resolved', 'info', 'Fixed: ' || r.title, 'It healed itself and stayed quiet for 2 hours.', null, null, true);
    c := c + 1;
  end loop;

  return jsonb_build_object('stale_closed', a, 'closed_by_good_news', b, 'self_healed_resolved', c);
end $$;
select cron.schedule('autonomy-sweep', '3-59/10 * * * *', $$select public.autonomy_sweep()$$);
