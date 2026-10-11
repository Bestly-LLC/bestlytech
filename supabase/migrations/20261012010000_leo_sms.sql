-- Leo real send_sms (ships OFF behind leo_settings.sms_mode) + stage-aware phone greeting data.
alter table public.leo_settings
  add column if not exists sms_mode text not null default 'off' check (sms_mode in ('off','owner_only','live')),
  add column if not exists sms_ready boolean not null default false,
  add column if not exists sms_detail jsonb,
  add column if not exists sms_checked_at timestamptz,
  add column if not exists sms_profile_id text,
  add column if not exists sms_campaign_id text;
alter table public.lax_guest_links add column if not exists sms_phone text, add column if not exists sms_phone_at timestamptz;
create table if not exists public.leo_sms_log (
  id bigserial primary key, token text not null, reservation_id bigint,
  action text not null check (action in ('send','demo_send','set_phone','refused','failed','optout','owner_test')),
  purpose text, to_last4 text, telnyx_id text, status text, error_code text, conversation_id text,
  at timestamptz not null default now());
create index if not exists leo_sms_log_token_at on public.leo_sms_log(token, at desc);
alter table public.leo_sms_log enable row level security;
revoke all on public.leo_sms_log from anon, authenticated;
create table if not exists public.leo_sms_optouts (phone_hash text primary key, source text, at timestamptz not null default now());
alter table public.leo_sms_optouts enable row level security;
revoke all on public.leo_sms_optouts from anon, authenticated;
create or replace function public.leo_sms_blocked(p_phone text) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare d text := right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10); b boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if exists (select 1 from leo_sms_optouts where phone_hash = encode(digest('+1'||d,'sha256'),'hex')) then return true; end if;
  if to_regclass('public.sms_suppressions') is not null then
    begin execute 'select exists(select 1 from public.sms_suppressions where right(regexp_replace(phone,''\D'','''',''g''),10)=$1)' into b using d;
    exception when others then b := false; end;
    if b then return true; end if;
  end if;
  return exists (select 1 from rg_dnc where right(regexp_replace(coalesce(phone,''),'\D','','g'),10) = d);
end $$;
revoke all on function public.leo_sms_blocked(text) from public, anon, authenticated;
create or replace function public.leo_sms_mode_set(p_mode text) returns text language sql security definer set search_path=public as $$
  update leo_settings set sms_mode = p_mode, updated_at = now() where id = 1 returning sms_mode $$;
revoke all on function public.leo_sms_mode_set(text) from public, anon, authenticated;

-- Phone greeting data: matched guests also get starts_at/ends_at/minutes_to_pickup/controls_state.
CREATE OR REPLACE FUNCTION public.leo_phone_caller(p_caller text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d text := right(regexp_replace(coalesce(p_caller,''), '\D', '', 'g'), 10);
  t public.turo_trips;
  stage text := 'none';
  place text := 'unknown';
  k text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if d = '8165007236' then
    -- Test mode (Jared, Oct 2026): every tool works against the demo trip and pretend car, never the real car.
    k := 'tv_' || encode(extensions.gen_random_bytes(24), 'hex');
    insert into public.trip_voice_sessions(key, agent_slug, token) values (k, 'leo', 'demo:demo-lax');
    return jsonb_build_object('trip_key', k, 'call_mode', 'phone', 'caller_type', 'test_guest', 'guest_first_name', 'Jared',
      'trip_stage', 'active', 'pickup_place', 'lax', 'pickup_time_local', '', 'return_time_local', '', 'car_name', 'Blue Steel (demo)',
      'minutes_to_pickup', -120, 'controls_state', 'on');
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
    'pickup_time_local', coalesce(t.local_start,''), 'return_time_local', coalesce(t.local_end,''), 'car_name','Blue Steel',
    'starts_at', t.starts_at, 'ends_at', t.ends_at,
    'minutes_to_pickup', round(extract(epoch from t.starts_at - now())/60)::int, 'controls_state', 'unknown');
end $function$;
