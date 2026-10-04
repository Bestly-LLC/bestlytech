-- Pi Waves B + C: Studio regen and Bestly's own IG/FB posts move from Claude scheduled tasks to Pi cron jobs.
-- APPLIED LIVE 2026-10-03 ~10:40 PM PT (piecewise via SQL); this file is the record.
-- Jobs: scripts/pi-wave-b/ (studio_regen.py, bestly_social.py) -> /opt/bestly/cron/jobs on the Pi.

-- Spark sessions for the Pi's studio_regen job. Spark only (is_system), 1 hour, deleted when the run ends.
create or replace function public.pi_spark_session() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from staff_sessions where staff_id = (select id from approval_staff where slug = 'spark') and expires_at < now();
  insert into staff_sessions (token_hash, staff_id, created_at, last_seen_at, expires_at)
  select encode(extensions.digest(t, 'sha256'), 'hex'), id, now(), now(), now() + interval '1 hour'
    from approval_staff where slug = 'spark' and is_system;
  if not found then raise exception 'no spark staff row'; end if;
  return t;
end $$;

create or replace function public.pi_spark_session_end(p_token text) returns boolean
language sql security definer set search_path = public, extensions as $$
  with d as (delete from staff_sessions where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
              and staff_id = (select id from approval_staff where slug = 'spark') returning 1)
  select exists (select 1 from d);
$$;
revoke all on function public.pi_spark_session() from public, anon, authenticated;
revoke all on function public.pi_spark_session_end(text) from public, anon, authenticated;
grant execute on function public.pi_spark_session() to service_role;
grant execute on function public.pi_spark_session_end(text) to service_role;

-- Read a pg_net answer (invoke_edge_function is async). Anything carrying a credential is cut to timestamps.
create or replace function public.pi_http_result(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, net as $$
declare r record; c text;
begin
  select * into r from net._http_response where id = p_id;
  if not found then return null; end if;
  c := r.content;
  if c ilike '%access_token%' then
    begin
      c := jsonb_build_object('timestamps', coalesce((select jsonb_agg(m->>'timestamp') from jsonb_array_elements(c::jsonb->'data') m), '[]'::jsonb))::text;
    exception when others then
      c := '{"error":"response withheld: it contained a credential"}';
    end;
  end if;
  return jsonb_build_object('status_code', r.status_code, 'content', left(c, 20000), 'error_msg', r.error_msg, 'timed_out', r.timed_out);
end $$;
revoke all on function public.pi_http_result(bigint) from public, anon, authenticated;
grant execute on function public.pi_http_result(bigint) to service_role;

-- Double-post guard: start a read of Bestly's 5 newest Instagram posts. Token never leaves the database.
create or replace function public.pi_bestly_ig_recent() returns bigint
language sql security definer set search_path = public, net as $$
  select net.http_get('https://graph.facebook.com/v23.0/' || remote_user_id
                      || '/media?fields=timestamp,media_type&limit=5&access_token=' || access_token,
                      timeout_milliseconds => 20000)
    from social_accounts where brand = 'bestly' and platform = 'instagram' and access_token is not null;
$$;
revoke all on function public.pi_bestly_ig_recent() from public, anon, authenticated;
grant execute on function public.pi_bestly_ig_recent() to service_role;

-- Rotation history (the Claude tasks kept it in a prompt that never changed, so 3 images went out on repeat).
create table if not exists public.bestly_social_history (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('daily','carousel')),
  asset text not null,
  layout text,
  theme text,
  caption text,
  ig_ok boolean,
  ig_permalink text,
  fb_ok boolean,
  fb_post_id text,
  error text,
  source text not null default 'pi'
);
create index if not exists bestly_social_history_at on public.bestly_social_history (kind, at desc);
alter table public.bestly_social_history enable row level security;
create policy "Admins read social history" on public.bestly_social_history for select to authenticated using (has_role(auth.uid(), 'admin'));
-- Seeded live with 13 rows inferred from the Instagram feed (source = 'seed: inferred from the Instagram feed 2026-10-03').

insert into public.pi_jobs (job, enabled, max_gap_min) values
  ('studio_regen', true, 150), ('bestly_social', true, 1560)
on conflict (job) do update set enabled = excluded.enabled, max_gap_min = excluded.max_gap_min;
update public.pi_jobs set enabled = true where job = 'studio_ask';
