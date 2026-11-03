-- Eli auto-agenda: nightly (+ pre-call) pass drafts "Your prep" items from bestly_memory into the partner
-- portal. Jared, 2026-11-02 (bestly_memory area=eli key=plan/eli-auto-agenda-2026-11-02). Prep-first: nothing
-- reaches Eli without Jared tapping "Add to agenda" on it first. Scout owns the job, watchdog and alerts.
--
-- Pieces:
--   partner_agenda  gains a 'prep' status (admin-only, RLS-hidden from partners) + source/kind/memory_ids/project.
--   partner_agenda_auto_state   one row per roster: where the nightly pass left off, and its last result.
--   partner_agenda_auto_add()  service-role-only writer: inserts prep items (deduping on memory_ids overlap or a
--                               near-identical open/prep title) and advances the roster's cursor.
--   eli_agenda_tick()          anon-callable kick (Mac mini launchd -> this RPC -> eli-agenda-run edge function).
--                               Added to security_public_rpcs: it does nothing but invoke the edge function.
--   _eli_worker_key()          service-role-only relay of the existing partner_ai_worker_key vault secret, so the
--                               edge function can read Eli's next call from next-meeting the same way other
--                               Mac/Pi worker scripts already do (x-worker-key). No new secret.
--   pi_jobs 'eli-agenda'       heartbeat row, max_gap_min 1560 (26h: nightly + slack).
--   bestly_agents 'eli-agenda' team card, reports_to scout, runs_on mac_mini.
--   partner_agenda_auto_state seed: cursor = now() - 14 days, so the first real tick backfills two weeks (step D).
--
-- No new table holds emails or phones, so no privacy_data_map rows are needed.
--
-- UNDO:
--   delete from public.pi_jobs where job = 'eli-agenda';
--   delete from public.bestly_agents where slug = 'eli-agenda';
--   delete from public.notification_owners where prefix = 'eli-agenda';
--   delete from public.security_public_rpcs where fn = 'eli_agenda_tick';
--   drop function if exists public.eli_agenda_tick();
--   drop function if exists public._eli_worker_key();
--   drop function if exists public.partner_agenda_auto_add(text, jsonb, timestamptz, jsonb);
--   drop table if exists public.partner_agenda_auto_state;
--   delete from public.partner_agenda where source = 'auto';
--   -- partner_agenda's new columns / 'prep' status are left in place (append-only; nothing reads them if unused).

create extension if not exists pg_trgm;

/* ───── 1. partner_agenda: the prep workflow ───── */

alter table public.partner_agenda drop constraint if exists partner_agenda_status_check;
alter table public.partner_agenda
  add column if not exists source text not null default 'manual',
  add column if not exists kind text,
  add column if not exists memory_ids uuid[] not null default '{}',
  add column if not exists project text;
alter table public.partner_agenda
  add constraint partner_agenda_status_check check (status in ('prep', 'open', 'discussed', 'removed')),
  add constraint partner_agenda_source_check check (source in ('manual', 'auto')),
  add constraint partner_agenda_kind_check check (kind is null or kind in ('shipped', 'decide', 'question', 'fyi'));
create index if not exists partner_agenda_memory_ids_idx on public.partner_agenda using gin (memory_ids);
create index if not exists partner_agenda_title_trgm_idx on public.partner_agenda using gin (title gin_trgm_ops);

-- Partners never see a 'prep' row; admin sees everything (replaces the 2026-10-10 policy).
drop policy if exists partner_agenda_read on public.partner_agenda;
create policy partner_agenda_read on public.partner_agenda for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role) or (roster = public.partner_roster_name() and status <> 'prep'));

-- A non-admin can never touch a 'prep' row (the where-clause simply won't match one for them), and this RPC
-- itself never creates or targets 'prep' -- only partner_agenda_auto_add (service role) does that.
create or replace function public.partner_agenda_set(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('open', 'discussed', 'removed') then raise exception 'Unknown status'; end if;
  update public.partner_agenda
     set status = p_status,
         discussed_at = case when p_status = 'discussed' then now() else null end
   where id = p_id
     -- admin may act on any row (prep included); a partner only on their own roster's non-prep rows
     and (public.has_role(auth.uid(), 'admin'::app_role) or (roster = public.partner_roster_name() and status <> 'prep'));
  if not found then raise exception 'Agenda item not found'; end if;
end $$;

/* ───── 2. where the nightly pass left off ───── */

create table if not exists public.partner_agenda_auto_state (
  roster       text primary key,
  cursor       timestamptz not null default (now() - interval '14 days'),
  last_run_at  timestamptz,
  last_result  jsonb not null default '{}'::jsonb
);
alter table public.partner_agenda_auto_state enable row level security;
revoke all on public.partner_agenda_auto_state from anon, authenticated;

-- Backfill (step D): Eli's cursor starts 14 days back, so the first real tick picks up everything since.
insert into public.partner_agenda_auto_state (roster, cursor)
values ('eli', now() - interval '14 days')
on conflict (roster) do nothing;

/* ───── 3. the writer (service role only -- the eli-agenda-run edge function) ───── */

create or replace function public.partner_agenda_auto_add(p_roster text, p_items jsonb, p_cursor timestamptz, p_result jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_title text; v_note text; v_memory_ids uuid[]; v_existing public.partner_agenda;
  v_added int := 0; v_merged int := 0;
begin
  if not exists (select 1 from public.partners where roster_name = p_roster) then
    raise exception 'Unknown roster: %', p_roster;
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_title := btrim(coalesce(it->>'title', ''));
    if length(v_title) = 0 then continue; end if;
    if length(v_title) > 200 then v_title := left(v_title, 200); end if;
    v_note := left(coalesce(it->>'note', ''), 1000);
    select coalesce(array_agg(x::uuid), '{}') into v_memory_ids
      from jsonb_array_elements_text(coalesce(it->'memory_ids', '[]'::jsonb)) x;

    -- dedupe: memory_ids overlap, or a near-identical title, among this roster's open/prep rows
    select a.* into v_existing from public.partner_agenda a
     where a.roster = p_roster and a.status in ('open', 'prep')
       and (a.memory_ids && v_memory_ids or similarity(lower(a.title), lower(v_title)) > 0.6)
     order by a.created_at desc limit 1;

    if v_existing.id is not null then
      update public.partner_agenda set
        note = case when length(v_note) > 0 and position(lower(v_note) in lower(note)) = 0
                     then left(note || case when length(note) > 0 then '  ·  ' else '' end || v_note, 1000)
                else note end,
        memory_ids = (select array_agg(distinct m) from unnest(v_existing.memory_ids || v_memory_ids) m),
        project = coalesce(nullif(it->>'project', ''), project)
      where id = v_existing.id;
      v_merged := v_merged + 1;
    else
      insert into public.partner_agenda (roster, title, note, added_by, status, source, kind, project, memory_ids)
      values (p_roster, v_title, v_note, 'scout', 'prep', 'auto',
              case when it->>'kind' in ('shipped', 'decide', 'question', 'fyi') then it->>'kind' else 'fyi' end,
              nullif(it->>'project', ''), v_memory_ids);
      v_added := v_added + 1;
    end if;
  end loop;

  insert into public.partner_agenda_auto_state (roster, cursor, last_run_at, last_result)
  values (p_roster, p_cursor, now(), coalesce(p_result, '{}'::jsonb) || jsonb_build_object('added', v_added, 'merged', v_merged))
  on conflict (roster) do update set cursor = excluded.cursor, last_run_at = excluded.last_run_at, last_result = excluded.last_result;

  return jsonb_build_object('added', v_added, 'merged', v_merged);
end $$;
revoke all on function public.partner_agenda_auto_add(text, jsonb, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.partner_agenda_auto_add(text, jsonb, timestamptz, jsonb) to service_role;

/* ───── 4. the Mac mini's kick, and the one secret relay it needs ───── */

-- Mac mini launchd ticks this every 15 min with the publishable key (like pi_job_report). It only ever
-- forwards to the edge function, which decides whether anything actually has to happen this tick.
create or replace function public.eli_agenda_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.invoke_edge_function('eli-agenda-run', '{}'::jsonb, 60000);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.eli_agenda_tick() from public;
grant execute on function public.eli_agenda_tick() to anon, authenticated, service_role;

insert into public.security_public_rpcs (fn, why)
values ('eli_agenda_tick', 'Mac mini launchd tick (tech.bestly.eli-agenda, every 15 min); only invokes the eli-agenda-run edge function, no direct writes')
on conflict (fn) do nothing;

-- Reuses the worker key next-meeting already accepts (x-worker-key / partner_ai_key_ok) -- no new secret.
create or replace function public._eli_worker_key()
returns text language sql security definer set search_path = public, vault stable as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'partner_ai_worker_key' limit 1;
$$;
revoke all on function public._eli_worker_key() from public, anon, authenticated;
grant execute on function public._eli_worker_key() to service_role;

/* ───── 5. heartbeat + team card ───── */

insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('eli-agenda',
        'Nightly ~9:47 PM PT pass (plus a check 45-75 min before a booked Eli call) that drafts "Your prep" items '
        'for the partner portal from new bestly_memory rows via free AI. Mac mini tick ~/bin/eli-agenda.py -> '
        'eli_agenda_tick() -> eli-agenda-run edge function.',
        1560, true)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, enabled = true;

select public.team_onboard($j$[
 {"slug":"eli-agenda","name":"Eli Agenda","role":"Drafts Eli's call prep","reports_to":"scout","runs_on":"mac_mini","icon":"clipboard-list",
  "schedule":"every 15 min (nightly ~9:47 PM PT, plus 45-75 min before a booked Eli call)","admin_url":"/partner?as=eli","sort":18,
  "what_it_does":"Reads new, non-private bestly_memory rows about Eli-shared projects, asks free AI to turn them into up to 8 short prep items, and puts them in Your prep where only Jared sees them. One tap adds an item to Eli's agenda; nothing reaches Eli on its own.",
  "pulse":{"src":"pi_job","key":"eli-agenda","gap":1560,"alert":true},
  "owns":["eli-agenda"]}
]$j$::jsonb);
