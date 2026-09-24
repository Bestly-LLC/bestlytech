-- The Mac watchdog calls with the publishable key (anon). ops_watchdog_report / _note are no longer granted to anon
-- (and must not be: the heal can end database sessions), so its reports and in-database heals were refused
-- ("permission denied", 2026-09-24). These wrappers require the Mac's private token (hash in db_watchdog_tokens).
create or replace function public.ops_watchdog_report_t(p_token text, p_source text, p_state text, p_detail jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return ops_watchdog_report(p_source, p_state, p_detail);
end $$;
create or replace function public.ops_watchdog_note_t(p_token text, p_action text, p_ok boolean, p_detail jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  select to_jsonb(x) into r from (select ops_watchdog_note(p_action, p_ok, p_detail)) x;
  return coalesce(r, '{}'::jsonb);
end $$;
revoke all on function public.ops_watchdog_report_t(text, text, text, jsonb), public.ops_watchdog_note_t(text, text, boolean, jsonb) from public;
grant execute on function public.ops_watchdog_report_t(text, text, text, jsonb), public.ops_watchdog_note_t(text, text, boolean, jsonb) to anon, authenticated;
