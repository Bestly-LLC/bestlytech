-- Tinker v3 (2026-10-29): the Automation Maker also FIXES and TROUBLESHOOTS Jared's existing Home Assistant automations.
-- Plan: docs/ha-fixer-opusplan.md. Jared: "we've added some stuff, and it's messed up some things I don't want."
--
--   ha_fixes      one row per "what went wrong?" question: evidence -> plain-words story -> proposed fix (before/after) -> one tap to apply -> undo
--   ha_inventory  one row: the list of every automation and script (UI-made and package-based) with a one-line description
--   ha_fixer_on_command   moves a row forward when the Pi (agent 1.6.2+) answers, and wakes the ha-fixer edge function
--   tinker_page_check     now watches all FOUR of Tinker's tables (select/insert/update/delete for signed-in admins + the admin policy)
--   cron ha-fixer-watch   stuck applies, drafts waiting on a free model, warm inventory, Code Worker hand-backs
--
-- Same rules as the Maker: free AI only, nothing touches Home Assistant until Jared taps Apply, every change keeps a backup and an undo.
--
-- UNDO:
--   select cron.unschedule('ha-fixer-watch');
--   drop trigger ha_fixer_on_command on public.home_hub_commands; drop function public.ha_fixer_on_command();
--   drop table public.ha_fixes, public.ha_inventory;
--   (tinker_page_check: re-apply 20261029062402_tinker_page_check.sql; bestly_agents pulse: remove "also")

-- ------------------------------------------------------------------ 1. tables
create table if not exists public.ha_fixes (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  question        text not null,
  focus           text,                       -- automation.<x> when opened from "Fix this" on the list
  status          text not null default 'gathering'
                  check (status in ('gathering','analyzing','proposed','diagnosed','applying','applied','undoing','undone','failed','discarded','handoff')),
  stage           text,                       -- analyzing: 'story_done' once the plain-words story is saved (a re-run skips it)
  window_start    timestamptz,
  window_end      timestamptz,
  window_note     text,
  entities        jsonb,                      -- [{id, name}] the devices Tinker looked at
  evidence_cmd    uuid,                       -- the home_hub_commands row that holds the raw evidence
  command_id      uuid,                       -- the command this row is waiting on right now
  timeline        jsonb,                      -- [{t: "6:02 AM", text}] what Home Assistant recorded, oldest first
  suspects        jsonb,                      -- [{key, name, kind, where, file, last_run, why}]
  story           jsonb,                      -- array of plain sentences: what happened and why
  culprit         jsonb,                      -- {key, entity_id, name, kind, where, file, why}
  confidence      text check (confidence in ('high','medium','low')),
  fix             jsonb,                      -- {type: item_edit|package_patch|turn_off, ...exactly what the Pi will be told}
  before_plain    jsonb,                      -- plain sentences
  after_plain     jsonb,
  diff            jsonb,                      -- [{t: ' '|'+'|'-', s}] the exact change
  risky           boolean not null default false,
  risk_reason     text,
  undo            jsonb,                      -- {action, payload} the Pi is told to put things back
  applied_at      timestamptz,
  undone_at       timestamptz,
  restart_note    text,
  feedback        text,
  error           text,
  needs_agent_update boolean not null default false,
  model           text,
  provider        text,
  tried           jsonb,
  attempts        int not null default 0,
  wait_tries      int not null default 0,
  retry_at        timestamptz,
  code_job_id     uuid,
  handoff_prompt  text,
  handback        text,
  requested_by    uuid default auth.uid()
);
create index if not exists ha_fixes_status_idx on public.ha_fixes (status, updated_at);
create index if not exists ha_fixes_created_idx on public.ha_fixes (created_at desc);

create table if not exists public.ha_inventory (
  id           boolean primary key default true check (id),
  captured_at  timestamptz,
  requested_at timestamptz,
  command_id   uuid,
  view         jsonb not null default '[]'::jsonb,   -- [{entity_id, name, kind, state, last_run, where, file, line, mine}]
  counts       jsonb,
  error        text
);
insert into public.ha_inventory (id) values (true) on conflict do nothing;

alter table public.ha_fixes enable row level security;
alter table public.ha_inventory enable row level security;
revoke all on public.ha_fixes, public.ha_inventory from anon;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ha_fixes' and policyname='ha_fixes_admin_all') then
    create policy ha_fixes_admin_all on public.ha_fixes for all to authenticated
      using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ha_fixes' and policyname='ha_fixes_service') then
    create policy ha_fixes_service on public.ha_fixes for all using (auth.role() = 'service_role'::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ha_inventory' and policyname='ha_inventory_admin_all') then
    create policy ha_inventory_admin_all on public.ha_inventory for all to authenticated
      using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ha_inventory' and policyname='ha_inventory_service') then
    create policy ha_inventory_service on public.ha_inventory for all using (auth.role() = 'service_role'::text);
  end if;
end $$;

-- A signed-in page reads these: the explicit grant (default privileges no longer give it). Rows stay admin-only through the policies above.
grant select, insert, update, delete on public.ha_fixes, public.ha_inventory to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ha_fixes') then
    alter publication supabase_realtime add table public.ha_fixes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ha_inventory') then
    alter publication supabase_realtime add table public.ha_inventory;
  end if;
end $$;

create or replace trigger ha_fixes_updated_at before update on public.ha_fixes
  for each row execute function public.update_updated_at_column();

