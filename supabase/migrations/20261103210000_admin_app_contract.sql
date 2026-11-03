-- App Contract Check (Nov 3 2026, build 7): the Bestly Admin iPhone app was written blind against guessed RPC shapes, so many
-- buttons silently failed. This lets a daily Mac mini job (tools/admin-app-contract) compare every rpc/edge call in the app source
-- with the live database and tell Scout when they disagree.

-- 1) The comparison data: what each named public function really takes (names, types, DEFAULT markers) and returns. service_role only.
create or replace function public.admin_app_contract(p_fns text[])
returns table(name text, args text, result text, authed boolean, secdef boolean)
language sql security definer set search_path = public as $$
  select p.proname::text,
         pg_get_function_arguments(p.oid),
         pg_get_function_result(p.oid),
         has_function_privilege('authenticated', p.oid, 'execute'),
         p.prosecdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(p_fns)
   order by p.proname, 2
$$;
revoke all on function public.admin_app_contract(text[]) from public, anon, authenticated;
grant execute on function public.admin_app_contract(text[]) to service_role;

-- 2) Mac mini wrappers. The Mac holds the publishable key plus the watchdog token (Keychain bestly-db-watchdog), never the service key.
create or replace function public.admin_app_contract_t(p_token text, p_fns text[])
returns table(name text, args text, result text, authed boolean, secdef boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return query select * from public.admin_app_contract(p_fns);
end $$;

-- Heartbeat for the team card + Scout alert (signed by the owner of admin.app.*, which is Scout).
create or replace function public.admin_app_contract_report_t(p_token text, p_ok boolean, p_summary text default null, p_body text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  perform agent_beat('admin-app-contract', coalesce(p_ok, true), left(p_summary, 500), get_home_hub_agent_key());
  if coalesce(p_ok, true) then
    perform bestly_raise('admin.app.contract', 'resolved', 'info', 'The Admin app and the server agree again');
  else
    perform bestly_raise('admin.app.contract', 'problem', 'warning',
      'Some buttons in the Admin app call things the server does not have',
      left(coalesce(p_body, p_summary, ''), 1500), 'admin-app');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_app_contract_t(text, text[]), public.admin_app_contract_report_t(text, boolean, text, text) from public;
grant execute on function public.admin_app_contract_t(text, text[]), public.admin_app_contract_report_t(text, boolean, text, text) to anon, authenticated, service_role;

-- Public-key RPCs the Mac calls (token-gated inside): keep Ares's Auto-Fixer off them.
insert into public.security_public_rpcs (fn, why) values
  ('admin_app_contract_t', 'Mac mini App Contract Check (watchdog token)'),
  ('admin_app_contract_report_t', 'Mac mini App Contract Check heartbeat and Scout alert (watchdog token)')
on conflict (fn) do nothing;

-- Alerts for admin.app.* already route to Scout (notification_owners prefix admin.app).
select public.team_onboard($j$[
 {"slug":"admin-app-contract","name":"App Contract Check","role":"Checks every button in the Admin app still matches the server","tool_of":"scout","runs_on":"mac-mini","icon":"shield-check",
  "schedule":"daily 6:40 AM","admin_url":"/admin/team","welcome":false,
  "what_it_does":"Every morning, and before every Admin app ship, it reads the iPhone app's source, lists each server call a button makes, and checks the server really has that function with those inputs and that you are allowed to run it. If a button would fail, Scout raises one alert naming the button and the fix. Runs as LaunchAgent tech.bestly.admin-app-contract on the Mac mini, no AI.",
  "pulse":{"src":"beat","gap":100800,"alert":true},
  "owns":["admin.app.contract"]}
]$j$::jsonb);
