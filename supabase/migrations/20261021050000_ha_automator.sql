-- Tinker, the Home Automation Engineer ("Automation Maker" at /admin/home-hub/automations).
-- Plan: docs/ha-automator-opusplan.md (frozen contract). Lane A = this migration + the ha-automator edge function.
--
-- Jared types what he wants. The ha-automator edge function drafts it on free models, he taps Install, the Pi agent
-- (1.6.1+) writes it into Home Assistant through home_hub_commands, and this trigger records what happened.
--
-- Undo: select cron.unschedule('ha-automator-watch'); drop trigger ha_automator_on_command on public.home_hub_commands;
--       drop function public.ha_automator_on_command(), public.tinker_notify(text,text,text,text,text);
--       drop table public.ha_automations, public.ha_entity_catalog;
--       delete from notification_owners where prefix = 'tinker.'; delete from bestly_agents where slug = 'tinker';

-- ------------------------------------------------------------------ 1. tables
create table if not exists public.ha_automations (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  request        text not null,
  feedback       text,
  kind           text check (kind in ('automation','package','cannot')),
  status         text not null default 'drafting'
                 check (status in ('drafting','preview','installing','installed','failed','handoff','undoing','undone','discarded')),
  ha_id          text,                       -- Home Assistant automation id (bestly_<slug>)
  package_name   text,                       -- packages/<package_name>.yaml (bestly_auto_<slug>)
  entity_id      text,                       -- automation.<alias slug>, filled in after install
  title          text,
  summary        jsonb,                      -- array of plain sentences: When / Only if / Then
  assumptions    jsonb,                      -- array of plain sentences
  risky          boolean not null default false,
  risk_reason    text,
  config         jsonb,                      -- automation config (kind automation)
  package_yaml   text,                       -- what package_put writes (kind package)
  yaml           text,                       -- what the page shows
  prev_config    jsonb,                      -- what was there before the install (undo)
  prev_yaml      text,
  enabled        boolean not null default true,
  model          text,
  provider       text,
  tried          jsonb,
  error          text,
  handoff_prompt text,
  code_job_id    uuid,
  command_id     uuid,                       -- the home_hub_commands row this one is waiting on
  attempts       int not null default 0,
  requested_by   uuid default auth.uid(),
  installed_at   timestamptz,
  undone_at      timestamptz
);
create index if not exists ha_automations_status_idx on public.ha_automations (status, updated_at);
create index if not exists ha_automations_created_idx on public.ha_automations (created_at desc);

create table if not exists public.ha_entity_catalog (
  id          boolean primary key default true check (id),
  captured_at timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb   -- {entities:[[entity_id,name,state,area],...], services:{domain:[...]}, ha_version}
);

alter table public.ha_automations enable row level security;
alter table public.ha_entity_catalog enable row level security;
revoke all on public.ha_automations, public.ha_entity_catalog from anon;

-- same pattern as home_hub_commands: admins read/write, the service role does everything
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ha_automations' and policyname='ha_automations_admin_all') then
    create policy ha_automations_admin_all on public.ha_automations for all to authenticated
      using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ha_automations' and policyname='ha_automations_service') then
    create policy ha_automations_service on public.ha_automations for all using (auth.role() = 'service_role'::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ha_entity_catalog' and policyname='ha_entity_catalog_admin_all') then
    create policy ha_entity_catalog_admin_all on public.ha_entity_catalog for all to authenticated
      using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ha_entity_catalog' and policyname='ha_entity_catalog_service') then
    create policy ha_entity_catalog_service on public.ha_entity_catalog for all using (auth.role() = 'service_role'::text);
  end if;
end $$;

-- the page listens
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ha_automations') then
    alter publication supabase_realtime add table public.ha_automations;
  end if;
end $$;

create or replace trigger ha_automations_updated_at before update on public.ha_automations
  for each row execute function public.update_updated_at_column();

-- ------------------------------------------------------------------ 2. signed notes from Tinker
-- Titles always start "Tinker:" and dedupe keys with "tinker." so admin_notifications_sign and notification_owners sign them as Tinker.
-- Good news (success/info) is a silent bell row that lands in the 7 PM recap. Warnings go through notify_route, so the autonomy gate
-- (interrupt_class) decides: only a failure worded as "nobody could fix" interrupts, everything else is held.
create or replace function public.tinker_notify(p_title text, p_body text default null, p_severity text default 'success',
                                                 p_url text default '/admin/home-hub/automations', p_dedupe text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_title text := case when p_title ilike 'tinker:%' then p_title else 'Tinker: ' || p_title end;
        v_key text := case when p_dedupe is null then 'tinker.' || gen_random_uuid()::text
                           when p_dedupe like 'tinker.%' then p_dedupe else 'tinker.' || p_dedupe end;
begin
  if p_severity in ('success', 'info') then
    perform admin_notify('tinker', left(v_title, 200), left(coalesce(p_body, ''), 600), p_url, null, p_severity, v_key);
    return 'bell';
  end if;
  return notify_route(left(v_title, 200), left(coalesce(p_body, ''), 600), 'time-sensitive', 'Tinker',
                      'https://bestly.tech' || p_url, null, v_key, null, null, false, now());
end $$;
revoke all on function public.tinker_notify(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.tinker_notify(text, text, text, text, text) to service_role;

-- ------------------------------------------------------------------ 3. what happened on the Pi
create or replace function public.ha_automator_on_command() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  a public.ha_automations;
  v_id uuid;
  v_err text;
  v_title text;
  v_done boolean := (new.status = 'done');
  v_en boolean;
begin
  -- the entity list the Pi sent: keep the newest one
  if new.action = 'catalog' then
    if v_done and jsonb_typeof(new.result -> 'entities') = 'array' then
      insert into public.ha_entity_catalog (id, captured_at, data) values (true, now(), new.result)
      on conflict (id) do update set captured_at = now(), data = excluded.data;
    end if;
    return new;
  end if;

  begin v_id := (new.payload ->> 'automator_id')::uuid; exception when others then return new; end;
  select * into a from public.ha_automations where id = v_id for update;
  if not found then return new; end if;
  -- only the command this row is waiting on counts (a re-queued one replaces the old)
  if a.command_id is distinct from new.id then return new; end if;

  v_title := coalesce(a.title, left(a.request, 60));
  v_err := case when new.status = 'expired' then 'Your Pi did not pick this up in time, so nothing was changed.'
                else left(coalesce(nullif(trim(new.error), ''), 'Home Assistant did not say why.'), 600) end;

  begin
    if new.action = 'toggle_automation' then
      v_en := (new.payload ->> 'enabled')::boolean;
      if v_done then
        update public.ha_automations set enabled = coalesce(v_en, enabled), error = null where id = a.id;
      else
        update public.ha_automations set enabled = coalesce(not v_en, enabled), error = v_err where id = a.id;
      end if;

    elsif new.action in ('automation_put', 'package_put', 'automation_delete', 'package_delete') then
      if a.status = 'installing' and new.action in ('automation_put', 'package_put') then
        if v_done then
          update public.ha_automations set
            status = 'installed', installed_at = now(), undone_at = null, error = null,
            entity_id = coalesce(nullif(new.result ->> 'entity_id', ''), a.entity_id),
            enabled = coalesce(lower(new.result ->> 'state') <> 'off', true),
            prev_config = case when new.action = 'automation_put' then nullif(new.result -> 'prev_config', 'null'::jsonb) else null end,
            prev_yaml = case when new.action = 'package_put' then new.result ->> 'prev_yaml' else null end
           where id = a.id;
          perform public.tinker_notify('Tinker: ' || v_title || ' is installed', 'It is live in Home Assistant now. Undo is on the Automation Maker page.',
                                       'success', '/admin/home-hub/automations', 'tinker.installed.' || a.id);
        else
          update public.ha_automations set status = 'failed', error = v_err where id = a.id;
          perform public.tinker_notify('Tinker: I could not install ' || v_title, v_err, 'warning',
                                       '/admin/home-hub/automations', 'tinker.install-failed.' || a.id || '.' || new.id);
        end if;
      elsif a.status = 'undoing' then
        if v_done then
          update public.ha_automations set status = 'undone', undone_at = now(), error = null where id = a.id;
          perform public.tinker_notify('Tinker: ' || v_title || ' is undone', 'Home Assistant is back to how it was before.',
                                       'success', '/admin/home-hub/automations', 'tinker.undone.' || a.id);
        else
          update public.ha_automations set status = 'failed', error = 'The undo did not work. ' || v_err where id = a.id;
          perform public.tinker_notify('Tinker: I could not undo ' || v_title, v_err, 'warning',
                                       '/admin/home-hub/automations', 'tinker.undo-failed.' || a.id || '.' || new.id);
        end if;
      end if;
    end if;
  exception when others then
    -- never block the Pi's command update; the watch job will catch a row that stays stuck
    null;
  end;
  return new;
end $$;
revoke all on function public.ha_automator_on_command() from public, anon, authenticated;

create or replace trigger ha_automator_on_command after update on public.home_hub_commands
  for each row
  when (new.requested_by = 'ha-automator' and new.status in ('done', 'failed', 'expired') and old.status is distinct from new.status)
  execute function public.ha_automator_on_command();

-- ------------------------------------------------------------------ 4. schedule: the watchdog (installing/undoing stuck, Code Worker hand-backs, heartbeat)
select cron.schedule('ha-automator-watch', '4-59/5 * * * *',
  $c$select public.invoke_edge_function('ha-automator', '{"op":"watch"}'::jsonb, 60000)$c$);

-- ------------------------------------------------------------------ 5. team card (every bot gets one the day it goes live)
select public.team_onboard('[{
  "slug": "tinker", "name": "Tinker", "role": "Home Automation Engineer",
  "what_it_does": "Turns a sentence from Jared into a Home Assistant automation. Reads the real list of devices from the Pi, writes a plain-English preview and the YAML on free AI only (never paid), checks it against his house rules and a safety list, and installs nothing until he taps Install. Every install keeps an undo. If it cannot build the thing itself it hands a ready prompt to the Code Worker, then pulls the finished file back for the same one-tap preview. Checks every 5 minutes for installs that got stuck and for Code Worker files that came back.",
  "reports_to": "home-hub", "dept": "home", "runs_on": "supabase", "schedule": "on demand; watchdog every 5 min", "icon": "wrench",
  "admin_url": "/admin/home-hub/automations", "sort": 56,
  "pulse": {"src": "cron", "job": "ha-automator-watch", "gap": 20, "issues": ["tinker."]},
  "owns": ["tinker."]
}]'::jsonb);

-- notification_owner() matches a key to prefix or prefix.%, so the bare word is what resolves "tinker.installed.<id>" to Tinker
-- (team_onboard stored "tinker." with the dot, which only matches keys like "tinker..x").
insert into public.notification_owners (prefix, agent_slug, note)
select 'tinker', 'tinker', 'Tinker: Automation Maker alerts (2026-10-20)'
 where not exists (select 1 from public.notification_owners o where o.prefix = 'tinker');
