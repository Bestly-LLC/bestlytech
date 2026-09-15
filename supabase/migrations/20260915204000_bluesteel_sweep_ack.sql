-- Blue Steel street-sweeping alerts: acknowledgment log + ack RPC.
-- (Applied 2026-09-15 via MCP; recorded here so the repo matches the database.)
-- Publishing to ntfy.sh must go through pg_net: ntfy returns 429 daily-quota to the
-- shared IPs of both the Claude sandbox and Supabase edge functions, but not to the DB.

create table if not exists public.bluesteel_sweep_acks (
  id bigserial primary key,
  acked_at timestamptz not null default now(),
  via text
);
alter table public.bluesteel_sweep_acks enable row level security;
revoke all on public.bluesteel_sweep_acks from anon, authenticated;

create or replace function public.bluesteel_sweep_ack(p_via text default 'tap')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recent boolean;
begin
  select exists(select 1 from bluesteel_sweep_acks where acked_at > now() - interval '2 minutes') into v_recent;
  insert into bluesteel_sweep_acks (via) values (left(coalesce(p_via,'tap'), 20));

  perform net.http_post(
    url  := 'https://ntfy.sh',
    body := jsonb_build_object('topic','bluesteel-ack-qx59qnmegm','message','ack-' || left(coalesce(p_via,'tap'),20))
  );

  if not v_recent then
    perform net.http_post(
      url  := 'https://ntfy.sh',
      body := jsonb_build_object(
        'topic','bestly-sysalert-7q2k9mx4',
        'title','Got it: sweeping alerts off',
        'message','No more Blue Steel alerts this morning. They start again next sweeping day.',
        'priority',3,
        'tags',jsonb_build_array('white_check_mark'))
    );
  end if;
  return jsonb_build_object('ok', true, 'confirmation_sent', not v_recent);
end $$;

revoke all on function public.bluesteel_sweep_ack(text) from public, anon, authenticated;
grant execute on function public.bluesteel_sweep_ack(text) to service_role;
