-- Call to-dos are split into one column per person now, so a junk owner is no longer a
-- detail buried in a row's subtitle — it is a whole column with somebody's name on it.
-- The model that reads the recordings is asked for a first name and mostly gives one, but
-- it has produced "Cooper" (a surname) and "In" (a fragment of a sentence). Both became
-- people. The roster below is the only list of people a to-do can belong to.

create table if not exists public.todo_people (
  name       text primary key,
  aliases    text[] not null default '{}',
  created_at timestamptz not null default now()
);
comment on table public.todo_people is
  'Who a call to-do can belong to. Add a row to add a person; aliases are matched case-insensitively.';

insert into public.todo_people (name, aliases) values
  ('Jared',     '{}'),
  ('Eli',       '{cooper,"eli cooper"}'),
  ('Elizabeth', '{liz,beth,"elizabeth o''brien",obrien}'),
  ('Rohit',     '{}')
on conflict (name) do nothing;

-- Unknown resolves to Jared, which is what an unknown owner already meant everywhere:
-- scout-daily defaults to Jared, and so does the dashboard when action.owner is missing.
create or replace function public.todo_owner_norm(p_owner text)
returns text language sql stable set search_path to 'public' as $$
  select coalesce(
    (select p.name from public.todo_people p
      where lower(p.name) = lower(btrim(coalesce(p_owner, '')))
         or lower(btrim(coalesce(p_owner, ''))) = any (select lower(a) from unnest(p.aliases) a)
      limit 1),
    'Jared');
$$;

create or replace function public.scout_daily_owner_norm()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.kind = 'call' then
    new.action = coalesce(new.action, '{}'::jsonb)
      || jsonb_build_object('owner', public.todo_owner_norm(new.action->>'owner'));
  end if;
  return new;
end $$;

drop trigger if exists trg_scout_daily_owner_norm on public.scout_daily;
create trigger trg_scout_daily_owner_norm
  before insert or update on public.scout_daily
  for each row execute function public.scout_daily_owner_norm();

update public.scout_daily
   set action = action || jsonb_build_object('owner', public.todo_owner_norm(action->>'owner'))
 where kind = 'call'
   and coalesce(action->>'owner', '') is distinct from public.todo_owner_norm(action->>'owner');
