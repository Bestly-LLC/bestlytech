-- Scout learns from what went wrong and what fixed it.
--
--   scout_lessons         one row per lesson: where it applies (scope = a tool, a table, a project),
--                         when it applies, what works, what to avoid, and a running score
--   scout_lessons_for()   the lessons that match a failure (scope + words), best first
--   scout_lesson_used()   a lesson was shown and the next try worked (or not): moves its score
--   nightly reflect       scout-daily op reflect reads the last day of tool calls and jobs,
--                         finds "failed, then this worked" pairs, and writes lessons
-- Lessons are also mirrored into bestly_memory (area 'lessons') so every Claude session sees them.

create table if not exists public.scout_lessons (
  id uuid primary key default gen_random_uuid(),
  scope text not null,                 -- 'tool:run_sql', 'table:cloud_deals', 'project:studio', 'mac', 'deploy' ...
  title text not null,                 -- one line, what the lesson is
  when_text text not null,             -- when it applies ("run_sql says column does not exist")
  do_text text not null,               -- what works
  avoid_text text,                     -- what not to do again
  signature text,                      -- lower-case words from the error, for matching
  evidence jsonb not null default '[]'::jsonb,   -- action / job ids it came from
  source text not null default 'reflect',        -- reflect | scout | jared
  shown int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (scope, title)
);
create index if not exists scout_lessons_scope_idx on public.scout_lessons (scope) where active;

alter table public.scout_lessons enable row level security;
drop policy if exists scout_lessons_admin_read on public.scout_lessons;
create policy scout_lessons_admin_read on public.scout_lessons for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Best matches for a failure: same scope first, then shared words with the error, then proven ones.
create or replace function public.scout_lessons_for(p_scope text, p_text text default '', p_limit int default 4)
returns table (id uuid, scope text, title text, when_text text, do_text text, avoid_text text, wins int, losses int)
language sql stable security definer set search_path = public as $$
  with words as (
    select distinct w from regexp_split_to_table(lower(coalesce(p_text, '')), '[^a-z0-9_]+') w where length(w) > 3
  )
  select l.id, l.scope, l.title, l.when_text, l.do_text, l.avoid_text, l.wins, l.losses
    from public.scout_lessons l
   where l.active and (l.scope = p_scope or l.scope = split_part(p_scope, ':', 1)
         or exists (select 1 from words where position(w in lower(l.signature || ' ' || l.when_text || ' ' || l.title)) > 0))
   order by (l.scope = p_scope) desc,
            (select count(*) from words where position(w in lower(coalesce(l.signature, '') || ' ' || l.when_text)) > 0) desc,
            (l.wins - l.losses) desc, l.updated_at desc
   limit greatest(1, least(p_limit, 10));
$$;
revoke all on function public.scout_lessons_for(text, text, int) from public, anon, authenticated;

create or replace function public.scout_lesson_used(p_ids uuid[], p_worked boolean)
returns void language sql security definer set search_path = public as $$
  update public.scout_lessons
     set shown = shown + 1,
         wins = wins + case when p_worked then 1 else 0 end,
         losses = losses + case when p_worked then 0 else 1 end,
         last_used_at = now(),
         -- A lesson that keeps failing retires itself; Jared can turn it back on.
         active = case when not p_worked and losses + 1 >= 3 and losses + 1 > wins * 2 then false else active end
   where id = any (p_ids);
$$;
revoke all on function public.scout_lesson_used(uuid[], boolean) from public, anon, authenticated;

-- Jared: switch a lesson on or off, or delete it, from /admin/playbook.
create or replace function public.scout_lesson_admin(p_id uuid, p_active boolean default null, p_delete boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_delete then delete from public.scout_lessons where id = p_id;
  else update public.scout_lessons set active = coalesce(p_active, active), updated_at = now() where id = p_id; end if;
end $$;
revoke all on function public.scout_lesson_admin(uuid, boolean, boolean) from public, anon;
grant execute on function public.scout_lesson_admin(uuid, boolean, boolean) to authenticated;

-- Reflect nightly at 02:20 LA (the function checks the local hour, so DST needs no edit).
do $$ begin perform cron.unschedule('scout-reflect'); exception when others then null; end $$;
select cron.schedule('scout-reflect', '20 * * * *',
  $$select public.invoke_edge_function('scout-daily', '{"op":"tick_reflect"}'::jsonb, 150000)$$);
