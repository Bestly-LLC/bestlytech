-- Mac fallback for ~/bin/hapush when the Pi is unreachable. ha_push is service_role only and the Mac
-- holds no service key, so gate on the Mac watchdog token it already has (Keychain bestly-db-watchdog),
-- same pattern as ops_watchdog_report_t. No new secret.
create or replace function public.ha_push_t(
  p_token text, p_title text, p_body text, p_level text default 'active', p_source text default 'Mac',
  p_url text default 'https://bestly.tech/admin', p_group text default null, p_tag text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if p_level not in ('passive','active','time-sensitive','critical') then p_level := 'active'; end if;
  return ha_push(left(coalesce(p_title,'Bestly'),120), left(coalesce(p_body,''),1200), p_level,
                 coalesce(p_source,'Mac'), coalesce(p_url,'https://bestly.tech/admin'), p_group, p_tag);
end $function$;
revoke all on function public.ha_push_t(text,text,text,text,text,text,text,text) from public;
grant execute on function public.ha_push_t(text,text,text,text,text,text,text,text) to anon, authenticated, service_role;
