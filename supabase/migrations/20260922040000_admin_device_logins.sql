-- Sign in to the admin on a browser that can't do passkeys or Apple sign-in
-- (the Claude app's built-in browser, a TV, a borrowed laptop): it shows a code,
-- Jared approves it from a device where he is already signed in with his passkey.
-- Only the admin-device-login edge function (service role) touches this table.
create table public.admin_device_logins (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  secret_sha256 text not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','used','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  user_agent text,
  ip text,
  approved_by uuid,
  approved_at timestamptz,
  used_at timestamptz
);
create index admin_device_logins_recent on public.admin_device_logins (created_at desc);
alter table public.admin_device_logins enable row level security;
revoke all on public.admin_device_logins from anon, authenticated;

-- Phone push for a request. Tapping it opens the approve page, which still makes
-- Jared type the code shown on the other screen.
create or replace function public.admin_login_push() returns bigint
language plpgsql security definer set search_path = public as $$
declare s public.home_hub_settings;
begin
  select * into s from home_hub_settings where id;
  if s.id is null or not s.push_enabled then return null; end if;
  return net.http_post(url := 'https://ntfy.sh', body := jsonb_build_object(
    'topic', s.ntfy_topic,
    'title', 'Bestly Admin sign-in request',
    'message', 'A browser wants to sign in to the admin. If it is you, tap and type the code shown on that screen.',
    'priority', 4, 'tags', jsonb_build_array('key'),
    'click', 'https://bestly.tech/admin/approve'));
end $$;
revoke all on function public.admin_login_push() from public, anon, authenticated;
