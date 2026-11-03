-- Bestly Admin app v2 (server side). Owner: Scout (Needs you) / Ares (grants).
-- 1 snooze table, 2 Needs you hides snoozed rows, 3 admin_today_act, 4 screen usage read,
-- 5 Ares hardening (no anon on admin RPCs the app calls).
-- Undo: bestly_memory house/undo/admin-today-rows-2026-11-03 holds the old admin_today_rows definition.
-- admin_app_report already accepts any kind and admin_app_watch only counts sign_in_failed / refresh_failed /
-- today_load_failed, so 'screen_view' needs no change there.

-- 1) snooze table (no personal data; only SECURITY DEFINER RPCs touch it)
create table if not exists public.admin_today_snoozed (
  key text primary key,
  fingerprint text,
  until timestamptz not null,
  created_at timestamptz default now()
);
alter table public.admin_today_snoozed enable row level security;
drop policy if exists admin_today_snoozed_admin on public.admin_today_snoozed;
create policy admin_today_snoozed_admin on public.admin_today_snoozed
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
revoke all on public.admin_today_snoozed from anon, authenticated;

-- 2) save the old definition, then make admin_today_rows skip snoozed rows (same fingerprint, until > now())
insert into public.bestly_memory (area, key, title, body, kind, tags, source, pinned, active, written_by)
select 'ops', 'house/undo/admin-today-rows-2026-11-03',
       'UNDO: admin_today_rows before it hid snoozed rows (Nov 3, Admin app v2)',
       'Exact pg_get_functiondef of public.admin_today_rows() before the snooze filter. To undo: run the CREATE OR REPLACE below, then drop table public.admin_today_snoozed if you also want it gone.' || E'\n\n' ||
       pg_get_functiondef('public.admin_today_rows()'::regprocedure),
       'runbook', array['admin-app','undo','needs-you'], 'claude-code', false, true, 'claude'
where not exists (select 1 from public.bestly_memory where key = 'house/undo/admin-today-rows-2026-11-03');

do $m$
declare
  d text := pg_get_functiondef('public.admin_today_rows()'::regprocedure);
  old_ text := E'from allrows a, g\n  where (not g.on_) or a.cls is not null';
  new_ text := E'from allrows a, g\n  where ((not g.on_) or a.cls is not null)\n    and not exists (select 1 from admin_today_snoozed z where z.key = a.key and z.until > now() and z.fingerprint is not distinct from a.fingerprint)';
begin
  if position('admin_today_snoozed' in d) > 0 then return; end if;
  if position(old_ in d) = 0 then raise exception 'admin_today_rows changed shape; patch by hand'; end if;
  execute replace(d, old_, new_);
end $m$;

-- 3) one-tap actions for the app
create or replace function public.admin_today_act(p_key text, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_kind text := split_part(p_key, ':', 1);
  v_sub  text := split_part(p_key, ':', 2);
  v_id   uuid;
  r      jsonb;
  ok     boolean;
  fp     text;
  found_ boolean;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;
  if p_key is null or p_action not in ('approve', 'dismiss', 'snooze', 'undo') then
    return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', 'bad_action');
  end if;

  if p_action = 'approve' then
    if v_kind = 'hermes' and v_sub = 'act' then
      v_id := split_part(p_key, ':', 3)::uuid;
      r := public.hermes_action_decide(v_id, true);
      if r->>'ok' = 'false' then return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', coalesce(r->>'error', 'failed')); end if;
      return jsonb_build_object('ok', true, 'action', p_action, 'key', p_key);
    end if;
    return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', 'no_approve');

  elsif p_action = 'dismiss' then
    if v_kind = 'hermes' and v_sub = 'act' then
      v_id := split_part(p_key, ':', 3)::uuid;
      r := public.hermes_action_decide(v_id, false);
      if r->>'ok' = 'false' then return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', coalesce(r->>'error', 'failed')); end if;
    elsif v_kind = 'debrief' then
      v_id := v_sub::uuid;
      r := public.call_debrief_dismiss(v_id);
      if r->>'ok' = 'false' then return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', coalesce(r->>'error', 'failed')); end if;
    else
      ok := public.admin_today_done(p_key);
      if not coalesce(ok, false) then return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', 'not_found'); end if;
    end if;
    return jsonb_build_object('ok', true, 'action', p_action, 'key', p_key);

  elsif p_action = 'snooze' then
    if v_kind = 'debrief' then
      v_id := v_sub::uuid;
      r := public.call_debrief_snooze(v_id);
      if r->>'ok' = 'false' then return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', coalesce(r->>'error', 'failed')); end if;
      return jsonb_build_object('ok', true, 'action', p_action, 'key', p_key);
    end if;
    select t.fingerprint, true into fp, found_ from public.admin_today_rows() t where t.key = p_key limit 1;
    if not coalesce(found_, false) then return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', 'not_found'); end if;
    insert into public.admin_today_snoozed (key, fingerprint, until) values (p_key, fp, now() + interval '3 hours')
      on conflict (key) do update set fingerprint = excluded.fingerprint, until = excluded.until, created_at = now();
    return jsonb_build_object('ok', true, 'action', p_action, 'key', p_key);

  else -- undo
    delete from public.admin_today_snoozed where key = p_key;
    if (v_kind = 'hermes' and v_sub = 'act') or v_kind = 'debrief' then
      return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', 'no_undo');
    end if;
    perform public.admin_today_undo(p_key);
    return jsonb_build_object('ok', true, 'action', p_action, 'key', p_key);
  end if;
exception
  when invalid_text_representation then
    return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', 'bad_key');
  when others then
    return jsonb_build_object('ok', false, 'action', p_action, 'key', p_key, 'error', sqlerrm);
end $fn$;
revoke all on function public.admin_today_act(text, text) from public, anon;
grant execute on function public.admin_today_act(text, text) to authenticated;

-- 4) which screens get opened (read side of kind = 'screen_view')
create or replace function public.admin_app_screen_usage(p_days int default 30)
returns table(screen text, views bigint, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select e.detail, count(*), max(e.at) from public.admin_app_events e
     where e.kind = 'screen_view' and e.at > now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
     group by e.detail order by count(*) desc;
end $fn$;
revoke all on function public.admin_app_screen_usage(int) from public, anon;
grant execute on function public.admin_app_screen_usage(int) to authenticated;

-- 5) Ares hardening: none of these are on security_public_rpcs and none are called with the anon key
--    (callers: signed-in admin pages, or edge functions / Pi jobs on the service role).
revoke execute on function public.admin_today() from public, anon;
revoke execute on function public.admin_today_rows() from public, anon;
revoke execute on function public.admin_today_undo(text) from public, anon;
revoke execute on function public.turo_widget() from public, anon;
revoke execute on function public.admin_car_ready() from public, anon;
revoke execute on function public.admin_car_fix(text) from public, anon;
revoke execute on function public.tesla_admin_command(text) from public, anon;
revoke execute on function public.tesla_admin_job(bigint) from public, anon;
revoke execute on function public.wall_admin_packages() from public, anon;
revoke execute on function public.wall_package_done(bigint, boolean) from public, anon;
grant execute on function public.admin_today() to authenticated, service_role;
grant execute on function public.admin_today_rows() to authenticated, service_role;
grant execute on function public.admin_today_undo(text) to authenticated, service_role;
grant execute on function public.turo_widget() to authenticated, service_role;
grant execute on function public.admin_car_ready() to authenticated, service_role;
grant execute on function public.admin_car_fix(text) to authenticated, service_role;
grant execute on function public.tesla_admin_command(text) to authenticated, service_role;
grant execute on function public.tesla_admin_job(bigint) to authenticated, service_role;
grant execute on function public.wall_admin_packages() to authenticated, service_role;
grant execute on function public.wall_package_done(bigint, boolean) to authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name)
select '20261103190000', 'admin_app_v2'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '20261103190000');
