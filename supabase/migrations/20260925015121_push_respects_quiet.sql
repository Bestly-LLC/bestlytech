-- Quiet has to hold at the send, not just in the tab: a push that leaves here still buzzes the
-- phone. Same body as before, with the quiet check in front of it.
create or replace function public.push_web_send(
  p_title text, p_body text default null, p_severity text default 'info',
  p_url text default '/admin', p_tag text default null,
  p_audience text default 'admin', p_user_id uuid default null)
returns bigint language plpgsql security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare v_key text; v_req bigint; q jsonb;
begin
  if p_audience = 'partner' and p_user_id is null then return null; end if;

  -- Quiet applies to Jared's own alerts. A partner's push is their business, not his Focus.
  if p_audience = 'admin' then
    q := public.notify_quiet_now();
    if (q->>'quiet')::boolean
       and not (coalesce((q->>'urgent_through')::boolean, true) and p_severity in ('warning', 'critical', 'error'))
    then
      return null;
    end if;
  end if;

  if not exists (select 1 from push_subscriptions where audience = p_audience and (p_user_id is null or user_id = p_user_id)) then
    return null;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then return null; end if;
  select net.http_post(
    url := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/push-notify',
    body := jsonb_build_object('title', left(p_title, 200), 'body', coalesce(p_body, ''), 'severity', p_severity,
                               'url', coalesce(p_url, '/admin'), 'tag', p_tag, 'audience', p_audience, 'user_id', p_user_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
    timeout_milliseconds := 20000) into v_req;
  return v_req;
exception when others then
  raise warning 'push_web_send failed: %', sqlerrm;
  return null;
end $$;

create or replace function public.admin_dnd(p_minutes integer)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update public.admin_notify_prefs
     set dnd_until = case when coalesce(p_minutes, 0) <= 0 then null
                          else now() + make_interval(mins => least(p_minutes, 60 * 24)) end,
         updated_at = now()
   where id = 1;
  return public.notify_quiet_now();
end $$;

create or replace function public.admin_notify_prefs_get()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare p public.admin_notify_prefs;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into p from public.admin_notify_prefs where id = 1;
  return to_jsonb(p) || jsonb_build_object('now', public.notify_quiet_now());
end $$;

create or replace function public.admin_notify_prefs_set(
  p_quiet_on boolean default null, p_quiet_start time default null, p_quiet_end time default null,
  p_urgent_through boolean default null, p_sound_on boolean default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update public.admin_notify_prefs set
    quiet_on       = coalesce(p_quiet_on, quiet_on),
    quiet_start    = coalesce(p_quiet_start, quiet_start),
    quiet_end      = coalesce(p_quiet_end, quiet_end),
    urgent_through = coalesce(p_urgent_through, urgent_through),
    sound_on       = coalesce(p_sound_on, sound_on),
    updated_at     = now()
  where id = 1;
  return public.admin_notify_prefs_get();
end $$;

revoke all on function public.admin_dnd(integer) from public, anon;
revoke all on function public.admin_notify_prefs_set(boolean, time, time, boolean, boolean) from public, anon;
grant execute on function public.admin_dnd(integer) to authenticated;
grant execute on function public.admin_notify_prefs_get() to authenticated;
grant execute on function public.admin_notify_prefs_set(boolean, time, time, boolean, boolean) to authenticated;
