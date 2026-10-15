-- Blue Steel live location, part 2 (2026-10-14): what finish.sh calls once the public entrance is open.
-- (a) push_args now also says whether streaming is switched on (applied earlier as car_telemetry_push_args_enabled).
-- (b) car_telemetry_start: ingest-token holder switches streaming on and queues telemetry_push then telemetry_check.
--     Refuses (unless forced) while the Tesla grant lacks the vehicle_location scope, because Tesla gates location data on it.
-- (c) car_telemetry_status: read-only progress for finish.sh.

create or replace function public.car_telemetry_push_args(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public', 'vault' as $fn$
declare s car_telemetry_settings; fs tesla_fleet_settings; ca text;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  select * into s from car_telemetry_settings where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  select decrypted_secret into ca from vault.decrypted_secrets where name = 'tesla_telemetry_ca_crt';
  return jsonb_build_object('hostname', s.host, 'port', s.port, 'fields', s.fields, 'ca', ca, 'vin', fs.vin, 'enabled', s.enabled);
end $fn$;

create or replace function public.car_telemetry_start(p_token text, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public', 'vault' as $fn$
declare s car_telemetry_settings; tok text; scopes jsonb; pid bigint; cid bigint;
begin
  select * into s from car_telemetry_settings where id = 1;
  if p_token is null or s.token_hash is null or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> s.token_hash then
    raise exception 'forbidden';
  end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'tesla_fleet_access_token';
  begin
    scopes := (convert_from(decode(translate(rpad(split_part(tok, '.', 2), ((length(split_part(tok, '.', 2)) + 3) / 4) * 4, '='), '-_', '+/'), 'base64'), 'utf8')::jsonb) -> 'scp';
  exception when others then scopes := null;
  end;
  if not coalesce(p_force, false) and (scopes is null or not (scopes ? 'vehicle_location')) then
    return jsonb_build_object('ok', false, 'problem', 'scope_missing', 'scopes', scopes);
  end if;
  if exists (select 1 from tesla_fleet_commands where action = 'telemetry_push' and status in ('queued', 'running')) then
    return jsonb_build_object('ok', false, 'problem', 'already_queued');
  end if;
  update car_telemetry_settings set enabled = true, updated_at = now() where id = 1;
  insert into tesla_fleet_commands (action, auto, args) values ('telemetry_push', true, jsonb_build_object('why', 'finish.sh')) returning id into pid;
  insert into tesla_fleet_commands (action, auto, args) values ('telemetry_check', true, jsonb_build_object('why', 'finish.sh')) returning id into cid;
  return jsonb_build_object('ok', true, 'push_job', pid, 'check_job', cid, 'forced', coalesce(p_force, false));
end $fn$;

create or replace function public.car_telemetry_status(p_token text, p_ids bigint[] default '{}')
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare s car_telemetry_settings;
begin
  select * into s from car_telemetry_settings where id = 1;
  if p_token is null or s.token_hash is null or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> s.token_hash then
    raise exception 'forbidden';
  end if;
  return jsonb_build_object(
    'enabled', s.enabled, 'exp_at', s.exp_at, 'last_push_at', s.last_push_at, 'last_record_at', s.last_record_at,
    'check', s.state->'check', 'push', s.state->'push',
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'action', action, 'status', status, 'stage', stage,
                       'error', result->>'error', 'result', result) order by id)
                      from tesla_fleet_commands where id = any(p_ids)), '[]'::jsonb));
end $fn$;

revoke all on function public.car_telemetry_push_args(text) from public, anon, authenticated;
revoke all on function public.car_telemetry_start(text, boolean) from public, anon, authenticated;
revoke all on function public.car_telemetry_status(text, bigint[]) from public, anon, authenticated;
grant execute on function public.car_telemetry_push_args(text) to anon, authenticated;
grant execute on function public.car_telemetry_start(text, boolean) to anon, authenticated;
grant execute on function public.car_telemetry_status(text, bigint[]) to anon, authenticated;
