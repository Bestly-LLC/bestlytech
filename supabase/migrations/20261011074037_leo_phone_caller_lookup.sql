-- Leo phone line (310) 622-7052: who is calling? Used by edge fn leo-phone-init (ElevenLabs call-start webhook).
-- Phone calls never carry trip_key, and the agent's dynamic-variable placeholders do not apply to phone calls, so
-- without this webhook every call failed with "Missing required dynamic variables in tools: trip_key" (2026-10-11).
-- Superseded by 20261011074655 (adds Jared's test mode); kept as applied.
create or replace function public.leo_phone_caller(p_caller text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d text := right(regexp_replace(coalesce(p_caller,''), '\D', '', 'g'), 10);
  t public.turo_trips;
  stage text := 'none';
  place text := 'unknown';
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if d = '8165007236' then
    return jsonb_build_object('trip_key','none','call_mode','phone','caller_type','host','guest_first_name','Jared',
      'trip_stage','none','pickup_place','unknown','car_name','Blue Steel');
  end if;
  if length(d) >= 7 then
    select * into t from public.turo_trips
     where right(regexp_replace(coalesce(guest_phone,''), '\D', '', 'g'), 10) = d
       and coalesce(status,'') !~* 'cancel'
       and ends_at > now() - interval '2 days'
       and starts_at < now() + interval '7 days'
     order by abs(extract(epoch from (starts_at - now()))) limit 1;
  end if;
  if t.reservation_id is null then
    return jsonb_build_object('trip_key','none','call_mode','phone','caller_type','unknown','guest_first_name','',
      'trip_stage','none','pickup_place','unknown','car_name','Blue Steel');
  end if;
  stage := case when now() < t.starts_at then 'upcoming' when now() <= t.ends_at or coalesce(t.in_progress,false) then 'active' else 'ended' end;
  place := case when t.airport_code is not null then 'lax'
                when coalesce(t.pickup_address,'') ~* '(kings|90069)' then 'home'
                else 'delivery' end;
  return jsonb_build_object('trip_key','none','call_mode','phone','caller_type','guest',
    'guest_first_name', coalesce(t.guest_first,''), 'trip_stage', stage, 'pickup_place', place,
    'pickup_time_local', coalesce(t.local_start,''), 'return_time_local', coalesce(t.local_end,''), 'car_name','Blue Steel');
end $$;
revoke all on function public.leo_phone_caller(text) from public, anon, authenticated;
grant execute on function public.leo_phone_caller(text) to service_role;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'leo_phone_init_token') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'leo_phone_init_token', 'Header token ElevenLabs sends to edge fn leo-phone-init (Leo phone line call-start webhook)');
  end if;
end $$;

create or replace function public.leo_phone_init_token_ok(p_token text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select auth.role() = 'service_role'
     and p_token is not null
     and p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'leo_phone_init_token');
$$;
revoke all on function public.leo_phone_init_token_ok(text) from public, anon, authenticated;
grant execute on function public.leo_phone_init_token_ok(text) to service_role;
