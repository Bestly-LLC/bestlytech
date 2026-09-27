-- The wall's "one thing" (wall_state.state.one) is now filled by Scout, not typed in the admin.
-- Jared 2026-09-27: "Remove the text box in admin UI for the one thing, make this automatically filled by Scout."
--
-- wall_one_thing_tick() runs every 10 minutes: it takes Scout's focus pick for today (scout_daily, the same list
-- the wall's center reads through wall_today()), else the most urgent open problem, else Scout's decision/quick
-- picks, else an admin_today row that is an error or blocked. Nothing -> '' and the wall shows its calm fallback.
-- It only writes (and bumps wall_state.version, which makes the Pi re-pull) when the text actually changes.
-- wall_one_thing_watchdog() heals a stale pick by running the tick itself, and raises a Scout incident
-- (wall.one_thing) if the pick is still more than an hour old.

create table if not exists public.wall_one_thing (
  id          int primary key default 1 check (id = 1),
  text        text not null default '',
  kind        text,
  source      text,
  why         text,
  checked_at  timestamptz,
  changed_at  timestamptz,
  last_error  text
);
alter table public.wall_one_thing enable row level security;
insert into public.wall_one_thing (id) values (1) on conflict do nothing;

create or replace function public.wall_one_thing_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_items jsonb;
  v_pick  jsonb;
  v_txt   text := '';
  v_old   text;
  v_row   record;
begin
  begin
    v_items := coalesce(wall_today()->'items', '[]'::jsonb);
    -- Scout's focus first; mail counts are never "the one thing".
    select x into v_pick from jsonb_array_elements(v_items) x
     where x->>'kind' <> 'mail' and coalesce(x->>'title','') <> ''
     order by case x->>'kind' when 'focus' then 0 when 'urgent' then 1 when 'decision' then 2
                              when 'needs' then 3 when 'quick' then 4 else 5 end
     limit 1;
    if v_pick is null then
      select title, source, severity, detail into v_row from admin_today_rows()
       where severity in ('error', 'blocked') and coalesce(title,'') <> ''
       order by rank, (severity = 'error') desc, since desc nulls last limit 1;
      if v_row.title is not null then
        v_pick := jsonb_build_object('kind', v_row.severity, 'title', v_row.title, 'from', v_row.source, 'why', v_row.detail);
      end if;
    end if;

    if v_pick is not null then
      v_txt := btrim(regexp_replace(v_pick->>'title', '\s+', ' ', 'g'));
      if length(v_txt) > 80 then
        v_txt := regexp_replace(left(v_txt, 79), '\s+\S*$', '') || '…';
      end if;
    end if;

    select coalesce(state->>'one', '') into v_old from wall_state where id = 1;
    if v_old is distinct from v_txt then
      update wall_state set state = state || jsonb_build_object('one', v_txt),
                            version = version + 1, updated_at = now()
       where id = 1;
      update wall_one_thing set changed_at = now() where id = 1;
    end if;

    update wall_one_thing set text = v_txt, kind = v_pick->>'kind', source = v_pick->>'from',
           why = v_pick->>'why', checked_at = now(), last_error = null
     where id = 1;
    return jsonb_build_object('ok', true, 'text', v_txt, 'changed', v_old is distinct from v_txt, 'pick', v_pick);
  exception when others then
    update wall_one_thing set last_error = left(sqlerrm, 500) where id = 1;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
end $$;

create or replace function public.wall_one_thing_watchdog()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r wall_one_thing; v jsonb;
begin
  select * into r from wall_one_thing where id = 1;
  if r.checked_at is null or r.checked_at < now() - interval '1 hour' then
    v := wall_one_thing_tick();                       -- self-heal first
    select * into r from wall_one_thing where id = 1;
  end if;
  if r.checked_at is null or r.checked_at < now() - interval '1 hour' then
    perform bestly_raise('wall.one_thing', 'problem', 'warning',
      'The wall''s "one thing" stopped updating',
      format('Scout fills it every 10 minutes (wall_one_thing_tick, cron wall-one-thing). Last good run: %s. Last error: %s. The wall keeps showing the old text until this is fixed.',
             coalesce(to_char(r.checked_at at time zone 'America/Los_Angeles', 'Mon DD FMHH12:MI AM'), 'never'),
             coalesce(r.last_error, 'none')),
      'house', null, false);
    return jsonb_build_object('ok', false, 'checked_at', r.checked_at, 'error', r.last_error);
  end if;
  perform bestly_raise('wall.one_thing', 'resolved', 'info', null);
  return jsonb_build_object('ok', true, 'checked_at', r.checked_at, 'text', r.text);
end $$;

-- Admin read + "update now" for the Wall page.
create or replace function public.wall_one_thing_get(p_refresh boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r wall_one_thing;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_refresh then perform wall_one_thing_tick(); end if;
  select * into r from wall_one_thing where id = 1;
  return jsonb_build_object('text', r.text, 'kind', r.kind, 'source', r.source, 'why', r.why,
                            'checked_at', r.checked_at, 'changed_at', r.changed_at, 'error', r.last_error);
end $$;

revoke all on function public.wall_one_thing_tick() from public, anon, authenticated;
revoke all on function public.wall_one_thing_watchdog() from public, anon, authenticated;
revoke all on function public.wall_one_thing_get(boolean) from public, anon;
grant execute on function public.wall_one_thing_get(boolean) to authenticated;

select cron.schedule('wall-one-thing', '1-59/10 * * * *', $$select public.wall_one_thing_tick()$$);
select cron.schedule('wall-one-thing-watchdog', '6-59/15 * * * *', $$select public.wall_one_thing_watchdog()$$);

select public.wall_one_thing_tick();
