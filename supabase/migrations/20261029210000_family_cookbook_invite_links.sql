-- Family Cookbook, part 8: sign in with a link, so nobody in the family ever types a password.
--
-- Until now the only way in was "Sign in with Bestly Cloud" (OIDC against cloud.bestly.tech), which means every
-- person needs a Bestly Cloud account and the password that comes with it. Mom and Mariah never got that far
-- (both still 'pending'), and a password is the wrong price of entry for a recipe box.
--
-- Instead: Jared (or Mariah) makes a one-time link from inside the cookbook and texts it. Tapping it signs that
-- person in on that phone for 90 days, the same session the OIDC path mints. Bestly Cloud sign-in stays as it was
-- for anyone who prefers it; this only adds a door.
--
-- The link token is random and only its sha-256 lands here, exactly like family_sessions. One use, then it is spent.
-- No policies and no grants: the family-auth edge function (service role) is the only thing that touches this.

set check_function_bodies = off;

create table if not exists public.family_invites (
  token_hash text primary key,
  member_id uuid not null references public.family_members (id) on delete cascade,
  created_by uuid references public.family_members (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz
);
create index if not exists family_invites_member_idx on public.family_invites (member_id);
create index if not exists family_invites_expires_idx on public.family_invites (expires_at);
alter table public.family_invites enable row level security;

revoke all on table public.family_invites from anon, authenticated;
