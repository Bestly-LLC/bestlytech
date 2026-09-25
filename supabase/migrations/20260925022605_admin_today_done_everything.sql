-- Every row gets a check mark. The two that have a real one-tap action keep it; everything else
-- is recorded as dismissed at the source's current fingerprint, so the item goes away now and
-- comes straight back the moment the source reports on it again.
create or replace function public.admin_today_done(p_key text)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_kind text := split_part(p_key, ':', 1);
  v_id   text := substr(p_key, strpos(p_key, ':') + 1);
  v_fp   text;
begin
  if auth.uid() is not null then
    perform public.admin_require_admin();
  end if;

  if v_kind = 'cy' then
    update public.cy_extension_releases
       set needs_jared = null, updated_at = now(), updated_by = 'admin'
     where channel = v_id;
    return found;

  elsif v_kind = 'bell' then
    update public.admin_notifications
       set read_at = now()
     where id = v_id::uuid and read_at is null;
    return found;
  end if;

  -- Everything else: remember it as handled, pinned to what the source looks like right now.
  -- Before this, ticking a Studio item raised 'has no one-tap action' and nothing happened.
  select r.fingerprint into v_fp from public.admin_today_rows() r where r.key = p_key;
  if v_fp is null then return false; end if;

  insert into public.admin_today_dismissed (key, fingerprint, dismissed_at)
  values (p_key, v_fp, now())
  on conflict (key) do update set fingerprint = excluded.fingerprint, dismissed_at = now();
  return true;
end;
$function$;

/** Put a checked-off item back by hand. */
create or replace function public.admin_today_undo(p_key text)
returns boolean language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform public.admin_require_admin();
  delete from public.admin_today_dismissed where key = p_key;
  return found;
end $function$;

grant execute on function public.admin_today_undo(text) to authenticated;

create or replace function public.admin_today_dismissed_prune()
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare n integer;
begin
  with gone as (
    delete from public.admin_today_dismissed where dismissed_at < now() - interval '90 days' returning 1
  ) select count(*) into n from gone;
  return n;
end $$;

select cron.schedule('admin-today-dismissed-prune', '40 4 * * *', $$select public.admin_today_dismissed_prune()$$);
