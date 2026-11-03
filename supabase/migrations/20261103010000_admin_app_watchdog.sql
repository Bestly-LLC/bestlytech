-- Bestly Admin iPhone app, P1 (2026-11-03): self-healing watchdog wired to Scout.
-- The app reports its own failures through admin_app_report (admin session only). Every 15 minutes
-- admin_app_watch() looks for the same failure kind 3+ times in 30 minutes and raises ONE alert, signed by Scout
-- (nobody on the team owns the mobile admin; Scout is Chief of Staff). It resolves itself when the failures stop.
-- UNDO: select cron.unschedule('admin-app-watch'); drop function public.admin_app_watch(); drop function public.admin_app_report(text,text,text);
--       drop table public.admin_app_events; delete from notification_owners where prefix = 'admin.app'; delete from bestly_agents where slug = 'admin-app-watch';

create table if not exists public.admin_app_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  kind        text not null,
  detail      text,
  app_version text
);
create index if not exists admin_app_events_kind_at on public.admin_app_events (kind, at desc);
alter table public.admin_app_events enable row level security;
drop policy if exists admin_app_events_select on public.admin_app_events;
create policy admin_app_events_select on public.admin_app_events for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
revoke all on public.admin_app_events from public, anon, authenticated;
grant select on public.admin_app_events to authenticated;
grant all on public.admin_app_events to service_role;

create or replace function public.admin_app_report(p_kind text, p_detail text, p_version text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then raise exception 'not allowed'; end if;
  insert into public.admin_app_events (kind, detail, app_version)
  values (left(coalesce(p_kind, 'unknown'), 60), left(p_detail, 500), left(p_version, 40));
end $function$;
revoke all on function public.admin_app_report(text, text, text) from public, anon;
grant execute on function public.admin_app_report(text, text, text) to authenticated, service_role;

insert into public.notification_owners (prefix, agent_slug, note) values
  ('admin.app', 'scout', 'Bestly Admin iPhone app failing (sign-in, refresh, Today load)')
on conflict (prefix) do nothing;

create or replace function public.admin_app_watch()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_bad text; v_n int;
begin
  delete from public.admin_app_events where at < now() - interval '14 days';
  select string_agg(format('%s x%s', kind, c), ', ' order by c desc), count(*) into v_bad, v_n
    from (select kind, count(*) c from public.admin_app_events
           where at > now() - interval '30 minutes' and kind in ('sign_in_failed', 'refresh_failed', 'today_load_failed')
           group by kind having count(*) >= 3) x;
  if v_n >= 1 then
    perform public.bestly_raise('admin.app.failing', 'problem', 'warning',
      'The Bestly Admin app is failing on your phone',
      format('In the last 30 minutes the app reported the same failure 3+ times: %s. Check the Admin app events table; sign-in failures usually mean the passkey domain file or the sign-in function is down, Today failures mean a backend call is erroring.', v_bad),
      'admin-app');
  else
    perform public.bestly_raise('admin.app.failing', 'resolved', 'info', 'The Bestly Admin app is healthy again');
  end if;
  return jsonb_build_object('ok', true, 'failing_kinds', coalesce(v_n, 0));
end $function$;
revoke all on function public.admin_app_watch() from public, anon, authenticated;
grant execute on function public.admin_app_watch() to service_role;

select cron.schedule('admin-app-watch', '*/15 * * * *', $c$select public.admin_app_watch()$c$);

select public.team_onboard($j$[
 {"slug":"admin-app-watch","name":"Admin App Watch","role":"Watches the Bestly Admin iPhone app","tool_of":"scout","runs_on":"supabase","icon":"smartphone",
  "schedule":"every 15 min","admin_url":"/admin/team","welcome":false,
  "what_it_does":"The Bestly Admin iPhone app reports sign-in, refresh and Today-load failures. If the same one happens 3 or more times in 30 minutes, Scout raises one alert and clears it when the failures stop.",
  "pulse":{"src":"cron","job":"admin-app-watch","gap":25,"alert":true}}
]$j$::jsonb);
