-- 2026-10-04 Two follow-ups from building the first hire (Chat Router):
--  1. hire_spec_set(slug, patch): a builder session finishes a hire's card (what it does, where it runs, schedule,
--     icon, pulse) before it graduates. Direct UPDATEs on bestly_agents get stopped for confirmation in unattended runs.
--  2. Duplicate guard: The Recruiter proposed Cron Merger and Cron Consolidator in different runs (same job, different
--     names) and both got hired. hr_save now skips a candidate whose description mostly overlaps an existing or
--     in-training bot or pending proposal (word overlap >= 0.4), an established bot (>= 0.5), or has the same role.
--     (Cron Merger vs Cron Consolidator scored 0.45.)

create or replace function public.hire_spec_set(p_slug text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare a bestly_agents;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into a from bestly_agents where slug = p_slug;
  if a.slug is null or not (a.profile ? 'hire_id') then raise exception 'not a hire'; end if;
  update bestly_agents set updated_at = now(),
         what_it_does = coalesce(left(p_patch->>'what_it_does', 600), what_it_does),
         runs_on      = coalesce(p_patch->>'runs_on', runs_on),
         schedule     = coalesce(left(p_patch->>'schedule', 120), schedule),
         icon         = coalesce(p_patch->>'icon', icon),
         admin_url    = coalesce(p_patch->>'admin_url', admin_url),
         pulse        = case when jsonb_typeof(p_patch->'pulse') = 'object' then p_patch->'pulse' else pulse end
   where slug = p_slug;
  return jsonb_build_object('slug', p_slug, 'ok', true);
end $$;
revoke all on function public.hire_spec_set(text, jsonb) from public, anon;
grant execute on function public.hire_spec_set(text, jsonb) to authenticated, service_role;

-- share of meaningful words two descriptions have in common (0..1)
create or replace function public.text_overlap(a text, b text) returns numeric
language sql immutable as $$
  with wa as (select distinct w from regexp_split_to_table(lower(coalesce(a, '')), '[^a-z0-9]+') w where length(w) > 3),
       wb as (select distinct w from regexp_split_to_table(lower(coalesce(b, '')), '[^a-z0-9]+') w where length(w) > 3)
  select case when (select count(*) from wa) = 0 or (select count(*) from wb) = 0 then 0
              else round((select count(*) from wa join wb using (w))::numeric
                         / least((select count(*) from wa), (select count(*) from wb)), 2) end
$$;

create or replace function public.hr_save(p_hires jsonb) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  insert into team_hires (name, role, dept, reports_to, what_it_does, why, saves, runs_on, schedule, cost, first_task,
                          improver_note, improver_score, status)
  select left(h->>'name', 60), left(h->>'role', 80),
         case when h->>'dept' in ('scout','ops','studio','turo','sales','mail','home','desk') then h->>'dept' else 'unassigned' end,
         (select slug from bestly_agents where slug = h->>'reports_to'),
         left(h->>'what_it_does', 500), left(h->>'why', 600), left(h->>'saves', 300),
         case when h->>'runs_on' in ('pi','cloud','claude','mac_mini','macbook') then h->>'runs_on' else 'pi' end,
         left(h->>'schedule', 80), left(h->>'cost', 120), left(h->>'first_task', 300),
         left(h->>'improver_note', 500), least(5, greatest(1, coalesce((h->>'improver_score')::int, 3))),
         case when h->>'verdict' = 'back' then 'proposed' else 'vetoed' end
    from jsonb_array_elements(p_hires) h
   where coalesce(h->>'name', '') <> ''
     and not exists (select 1 from team_hires x where lower(x.name) = lower(h->>'name') and x.created_at > now() - interval '90 days')
     and not exists (select 1 from bestly_agents a where lower(a.name) = lower(h->>'name') and a.status <> 'retired')
     -- the same job under another name: an existing or in-training bot, or a pending proposal
     and not exists (select 1 from bestly_agents a where a.status <> 'retired' and a.kind in ('agent','open_role')
                       and (lower(coalesce(a.role, '')) = lower(coalesce(h->>'role', '-')) or text_overlap(a.what_it_does, h->>'what_it_does') >= 0.5))
     -- stricter against the small set where duplicates actually happen: bots in training and pending proposals
     and not exists (select 1 from bestly_agents a where a.status = 'planned' and a.kind = 'open_role' and text_overlap(a.what_it_does, h->>'what_it_does') >= 0.4)
     and not exists (select 1 from team_hires x where x.status = 'proposed' and text_overlap(x.what_it_does, h->>'what_it_does') >= 0.4);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.hr_save(jsonb) from public, anon, authenticated;
grant execute on function public.hr_save(jsonb) to service_role;
