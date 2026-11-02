-- Family Cookbook, part 9: passkeys. Bestly is a password-free company, so Face ID is the way in.
--
-- Part 8 added the one-time link, which is how a phone proves who it is the FIRST time. This adds the thing that
-- happens after: that phone registers a passkey, and from then on signing in is Face ID and nothing else. The
-- "Sign in with Bestly Cloud" button is gone from the page with this change — it was the last door with a password
-- behind it. The OIDC ops stay in family-auth, unreachable from the UI, as break-glass.
--
-- We store only what a public key is: the credential id, the SPKI public key the browser handed us, and which
-- algorithm it is. There is no secret here — a stolen row cannot sign anything. Challenges are single-use rows
-- with a short life, the same shape as family_oauth_states.
--
-- No policies and no grants: the family-auth edge function (service role) is the only thing that touches these.

set check_function_bodies = off;

create table if not exists public.family_passkeys (
  credential_id text primary key,
  member_id uuid not null references public.family_members (id) on delete cascade,
  public_key text not null,
  alg int not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists family_passkeys_member_idx on public.family_passkeys (member_id);
alter table public.family_passkeys enable row level security;

create table if not exists public.family_webauthn_challenges (
  challenge text primary key,
  member_id uuid references public.family_members (id) on delete cascade,
  kind text not null check (kind in ('register', 'login')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes'
);
create index if not exists family_webauthn_challenges_expires_idx on public.family_webauthn_challenges (expires_at);
alter table public.family_webauthn_challenges enable row level security;

revoke all on table public.family_passkeys, public.family_webauthn_challenges from anon, authenticated;
