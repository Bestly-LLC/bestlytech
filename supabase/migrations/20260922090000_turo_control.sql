-- Turo Watch is run by Claude (a scheduled task driving Jared's own Chrome, where Turo is
-- signed in). The database is the source of truth and the admin page is the control panel.
--   turo_settings      one row: paused?, a note Jared leaves for the next run
--   turo_breadcrumbs() the runbook (bestly_memory area 'turo') for the admin page
--   turo_watchdog()    hourly: shouts if a run is missing (silence hid two outages before)

create table if not exists public.turo_settings (
  id int primary key default 1 check (id = 1),
  paused boolean not null default false,
  pause_reason text,
  note_for_claude text,          -- read at the start of the next run, then cleared by that run
  note_set_at timestamptz,
  runner text not null default 'claude-in-chrome',
  updated_at timestamptz not null default now()
);
insert into public.turo_settings (id) values (1) on conflict (id) do nothing;
alter table public.turo_settings enable row level security;
drop policy if exists turo_settings_admin_read on public.turo_settings;
create policy turo_settings_admin_read on public.turo_settings for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.turo_settings_set(p_paused boolean default null, p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.turo_settings;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update public.turo_settings set
    paused = coalesce(p_paused, paused),
    pause_reason = case when p_paused is null then pause_reason when p_paused then p_reason else null end,
    note_for_claude = case when p_note is null then note_for_claude else nullif(trim(p_note), '') end,
    note_set_at = case when p_note is null then note_set_at else now() end,
    updated_at = now()
  where id = 1 returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.turo_settings_set(boolean, text, text) from public, anon;
grant execute on function public.turo_settings_set(boolean, text, text) to authenticated;

create or replace function public.turo_breadcrumbs()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'kind', kind, 'title', title, 'body', body, 'updated_at', updated_at)
                    order by case key when 'resume' then 0 when 'what-this-is' then 1 when 'open-items' then 2 else 3 end, key)
                   from public.bestly_memory where area = 'turo' and active and kind in ('fact', 'runbook', 'protocol', 'convention', 'open')), '[]'::jsonb);
end $$;
revoke all on function public.turo_breadcrumbs() from public, anon;
grant execute on function public.turo_breadcrumbs() to authenticated;

-- Runs are due at 07:05 and 19:12 LA. More than 14h without a run row = a missed run.
create or replace function public.turo_watchdog()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last timestamptz; v_paused boolean;
begin
  select paused into v_paused from public.turo_settings where id = 1;
  if coalesce(v_paused, false) then return jsonb_build_object('ok', true, 'paused', true); end if;
  select max(ran_at) into v_last from public.turo_runs;
  if v_last is null or v_last < now() - interval '14 hours' then
    return public.scout_notify(
      'Turo Watch missed a run',
      'No run since ' || coalesce(to_char(v_last at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am'), 'ever') ||
      '. Usually: Turo signed out in Chrome, Chrome closed, or the Mac asleep. Open /admin/turo.',
      'warning', true, '/admin/turo',
      'turo.missed.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'));
  end if;
  return jsonb_build_object('ok', true, 'last', v_last);
end $$;

do $$ begin perform cron.unschedule('turo-watchdog'); exception when others then null; end $$;
select cron.schedule('turo-watchdog', '30 * * * *', $$select public.turo_watchdog()$$);
