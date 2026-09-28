-- W6 (wall round 4): native "Bestly Sky" iPhone Live Activity for the aircraft on the wall's name tag.
-- The Pi decides WHAT to show (the wall's tagged plane) and calls the edge function wall-live-activity, which signs
-- APNs pushes with the team's APNs .p8 key (Vault) and delivers them to the tokens the app registered here.

-- Tokens the app registers: 'start' = push-to-start token (one per install), 'update' = one per running activity.
create table if not exists public.wall_sky_tokens (
  token text primary key,
  kind text not null check (kind in ('start', 'update')),
  activity_id text,
  env text not null default 'sandbox' check (env in ('sandbox', 'production')),
  device text,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_push_at timestamptz,
  last_status int,
  last_reason text,
  dead boolean not null default false
);
alter table public.wall_sky_tokens enable row level security;   -- service role only (edge function)

-- Every push the edge function sent (kept 7 days) — the watchdog and the admin read this.
create table if not exists public.wall_sky_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  event text not null,
  hex text,
  sent int not null default 0,
  ok int not null default 0,
  statuses jsonb
);
create index if not exists wall_sky_log_at on public.wall_sky_log (at desc);
alter table public.wall_sky_log enable row level security;

-- What the activity shows right now (the app's in-app compass view reads this).
create table if not exists public.wall_sky_current (
  id int primary key default 1 check (id = 1),
  event text,
  state jsonb,
  at timestamptz not null default now()
);
alter table public.wall_sky_current enable row level security;
insert into public.wall_sky_current (id, event, state) values (1, 'none', null) on conflict (id) do nothing;

-- APNs signing credentials, server only (same pattern as get_weatherkit_credentials).
create or replace function public.get_apns_credentials()
returns table (team_id text, key_id text, private_key text, app_key text)
language sql
security definer
set search_path = public
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'apns_team_id'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'apns_key_id'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'apns_private_key'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'sky_app_key');
$$;
revoke all on function public.get_apns_credentials() from public, anon, authenticated;
grant execute on function public.get_apns_credentials() to service_role;

-- One-way intake so the .p8 goes Mac file -> Vault without passing through a chat.
-- A short-lived nonce (sha256 stored here) gates it; only four names are accepted.
create table if not exists public.wall_sky_intake_nonce (
  id int primary key default 1 check (id = 1),
  nonce_sha256 text,
  expires_at timestamptz
);
alter table public.wall_sky_intake_nonce enable row level security;

create or replace function public.wall_sky_secret_intake(p_nonce text, p_secrets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  n record; k text; v text; existing uuid; out jsonb := '{}'::jsonb;
  allowed text[] := array['apns_private_key', 'apns_key_id', 'apns_team_id', 'sky_app_key'];
begin
  select * into n from wall_sky_intake_nonce where id = 1;
  if n.nonce_sha256 is null or n.expires_at < now()
     or encode(extensions.digest(coalesce(p_nonce, ''), 'sha256'), 'hex') <> n.nonce_sha256 then
    raise exception 'not allowed';
  end if;
  for k, v in select key, value from jsonb_each_text(p_secrets) loop
    if not (k = any(allowed)) or v is null or length(v) = 0 then
      out := out || jsonb_build_object(k, 'refused');
      continue;
    end if;
    select id into existing from vault.secrets where name = k;
    if existing is null then
      perform vault.create_secret(v, k, 'Bestly Sky Live Activity (W6) - set via the one-way intake');
      out := out || jsonb_build_object(k, 'created');
    else
      perform vault.update_secret(existing, v, k, 'Bestly Sky Live Activity (W6) - rotated via the one-way intake');
      out := out || jsonb_build_object(k, 'updated');
    end if;
  end loop;
  update wall_sky_intake_nonce set nonce_sha256 = null, expires_at = null where id = 1;   -- single use
  return out;
end $$;
revoke all on function public.wall_sky_secret_intake(text, jsonb) from public;
grant execute on function public.wall_sky_secret_intake(text, jsonb) to anon, authenticated, service_role;

-- Keep the log small.
create or replace function public.wall_sky_log_prune()
returns void language sql security definer set search_path = public as $$
  delete from wall_sky_log where at < now() - interval '7 days';
  delete from wall_sky_tokens where dead and last_seen < now() - interval '14 days';
$$;
revoke all on function public.wall_sky_log_prune() from public, anon, authenticated;
grant execute on function public.wall_sky_log_prune() to service_role;
