-- Scout chief of staff, step 4: "Free AI keys" card. Jared pastes a provider key in /admin; it waits in Vault until the Pi job
-- (freellm_keys, every minute) adds it to FreeLLM on 127.0.0.1:3001 (the Funnel only exposes /v1, so the cloud cannot reach /api).
-- Nothing here ever returns a key value to a browser.
create table if not exists public.freellm_key_queue (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  label text not null default '',
  secret_name text not null,
  status text not null default 'pending' check (status in ('pending', 'applying', 'added', 'failed')),
  error text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create table if not exists public.freellm_key_status (
  provider text primary key,
  name text not null,
  keyless boolean not null default false,
  keys integer not null default 0,
  enabled_keys integer not null default 0,
  healthy_keys integer not null default 0,
  last_error text,
  synced_at timestamptz not null default now()
);
alter table public.freellm_key_queue enable row level security;
alter table public.freellm_key_status enable row level security;
revoke all on public.freellm_key_queue, public.freellm_key_status from anon, authenticated;

create or replace function public.freellm_key_add(p_provider text, p_key text, p_label text default '')
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid := gen_random_uuid(); v_name text; k text := trim(coalesce(p_key, ''));
begin
  if not public.team_is_admin() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.freellm_key_status where provider = p_provider) then raise exception 'unknown provider'; end if;
  if length(k) < 8 or length(k) > 600 or k ~ '\s' then raise exception 'That does not look like an API key (no spaces, 8 to 600 characters)'; end if;
  v_name := 'freellm_newkey_' || replace(v_id::text, '-', '');
  perform vault.create_secret(k, v_name, 'Free AI key waiting for the Pi to add it to FreeLLM (' || p_provider || ')');
  insert into public.freellm_key_queue(id, provider, label, secret_name, requested_by)
    values (v_id, p_provider, left(coalesce(p_label, ''), 60), v_name, auth.uid());
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.freellm_key_add(text, text, text) from public, anon;
grant execute on function public.freellm_key_add(text, text, text) to authenticated;

create or replace function public.freellm_keys_admin()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.team_is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'providers', coalesce((select jsonb_agg(to_jsonb(s) - 'synced_at' order by s.keys desc, s.name) from public.freellm_key_status s), '[]'::jsonb),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'provider', q.provider, 'status', q.status, 'error', q.error, 'created_at', q.created_at) order by q.created_at desc)
                         from (select * from public.freellm_key_queue order by created_at desc limit 8) q), '[]'::jsonb),
    'synced_at', (select max(synced_at) from public.freellm_key_status),
    'total_keys', coalesce((select sum(keys) from public.freellm_key_status), 0),
    'providers_with_keys', coalesce((select count(*) from public.freellm_key_status where keys > 0), 0));
end $$;
revoke all on function public.freellm_keys_admin() from public, anon;
grant execute on function public.freellm_keys_admin() to authenticated;

-- Pi side (service role only): take pending keys, then report each result and delete the Vault copy.
create or replace function public.freellm_key_next()
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare out jsonb;
begin
  with t as (
    update public.freellm_key_queue q set status = 'applying'
     where q.status = 'pending' or (q.status = 'applying' and q.created_at < now() - interval '10 minutes')
    returning q.id, q.provider, q.label, q.secret_name)
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'provider', t.provider, 'label', t.label,
           'key', (select decrypted_secret from vault.decrypted_secrets where name = t.secret_name))), '[]'::jsonb) into out from t;
  return out;
end $$;
revoke all on function public.freellm_key_next() from public, anon, authenticated;
grant execute on function public.freellm_key_next() to service_role;

create or replace function public.freellm_key_done(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare n text;
begin
  update public.freellm_key_queue set status = case when p_ok then 'added' else 'failed' end, error = left(p_error, 300), done_at = now()
   where id = p_id returning secret_name into n;
  if n is not null then delete from vault.secrets where name = n; end if;
end $$;
revoke all on function public.freellm_key_done(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.freellm_key_done(uuid, boolean, text) to service_role;

-- Pi pushes the provider list and key counts (no key values).
create or replace function public.freellm_status_put(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.freellm_key_status(provider, name, keyless, keys, enabled_keys, healthy_keys, last_error, synced_at)
    values (r->>'provider', coalesce(r->>'name', r->>'provider'), coalesce((r->>'keyless')::boolean, false), coalesce((r->>'keys')::int, 0),
            coalesce((r->>'enabled_keys')::int, 0), coalesce((r->>'healthy_keys')::int, 0), left(r->>'last_error', 200), now())
    on conflict (provider) do update set name = excluded.name, keyless = excluded.keyless, keys = excluded.keys,
      enabled_keys = excluded.enabled_keys, healthy_keys = excluded.healthy_keys, last_error = excluded.last_error, synced_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.freellm_status_put(jsonb) from public, anon, authenticated;
grant execute on function public.freellm_status_put(jsonb) to service_role;
