-- Family Cookbook (bestly.tech/cookbook). Owner: Basil. 2026-10-29.
--
-- Mom, Jared and Mariah keep their recipe cards in one phone app. Identity is a Bestly Cloud (Nextcloud) account:
-- the family-auth edge function does the OIDC code exchange and mints one of OUR sessions (family_sessions, token
-- hashed). Every read and write below takes that session token and is enforced HERE, in SQL, not in the page:
--   * Mom's recipes are visible to all three.  * Jared's and Mariah's are never visible to Mom (list, search, count,
--     Recently Deleted, review queue, photo, API).  * Jared and Mariah see each other's.
--   * Only the owner or Jared edits or deletes.  * Delete is a soft delete: 30 days in Recently Deleted, then the
--     daily purge (family-maint) removes the row and its photos.
-- Recipes live in the SAME table as Jared's Kitchen recipes (pantry_recipes). Rows with family_by NULL are Jared's
-- Kitchen recipes; the admin Kitchen > Recipes tab shows family rows under a "Family" category with no copy.
--
-- Tables have RLS on and NO policies and no anon/authenticated grants: only SECURITY DEFINER functions (and the
-- service role used by the edge functions) touch them. Public RPCs are on security_public_rpcs so Ares leaves them.

set check_function_bodies = off;

-- ---------------------------------------------------------------- people
create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  role text not null unique check (role in ('mom', 'jared', 'mariah')),
  name text not null,
  last_name text not null,
  nc_uid text,
  email text,
  status text not null default 'pending' check (status in ('pending', 'invited', 'active', 'paused')),
  invited_at timestamptz,
  first_sign_in_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists family_members_nc_uid_uidx on public.family_members (lower(nc_uid)) where nc_uid is not null;
alter table public.family_members enable row level security;

insert into public.family_members (role, name, last_name, nc_uid, status, first_sign_in_at)
values ('jared', 'Jared', 'Best', 'jared', 'active', null),
       ('mom', 'Trudy', 'Harris', null, 'pending', null),
       ('mariah', 'Mariah', 'Best', null, 'pending', null)
on conflict (role) do nothing;

create table if not exists public.family_sessions (
  token_hash text primary key,
  member_id uuid not null references public.family_members (id) on delete cascade,
  via text not null default 'oauth',
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);
create index if not exists family_sessions_member_idx on public.family_sessions (member_id);
alter table public.family_sessions enable row level security;

-- OIDC state + PKCE verifier live on the server so the sign-in survives Safari handing off to the home-screen app.
create table if not exists public.family_oauth_states (
  state text primary key,
  verifier text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.family_oauth_states enable row level security;

-- "Sign in on another device": a signed-in phone shows a short code, the other device types it.
create table if not exists public.family_pair_codes (
  code text primary key,
  member_id uuid not null references public.family_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes'
);
alter table public.family_pair_codes enable row level security;

create table if not exists public.family_auth_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  ok boolean not null,
  stage text not null,
  detail text,
  member_id uuid references public.family_members (id) on delete set null
);
create index if not exists family_auth_log_at_idx on public.family_auth_log (at desc);
alter table public.family_auth_log enable row level security;

-- One row of settings. The paid backup reader is capped per calendar month (Pacific); spend lands in ai_spend (scope 'family').
create table if not exists public.family_settings (
  id boolean primary key default true check (id),
  paid_on boolean not null default true,
  paid_cap_usd numeric not null default 3.00 check (paid_cap_usd >= 0 and paid_cap_usd <= 50),
  updated_at timestamptz not null default now()
);
insert into public.family_settings (id) values (true) on conflict (id) do nothing;
alter table public.family_settings enable row level security;

-- ---------------------------------------------------------------- recipes (same table as the Kitchen)
alter table public.pantry_recipes
  add column if not exists family_by text check (family_by in ('mom', 'jared', 'mariah')),
  add column if not exists family_status text not null default 'approved' check (family_status in ('approved', 'review')),
  add column if not exists family_flagged_by text check (family_flagged_by in ('mom', 'jared', 'mariah')),
  add column if not exists family_flagged_at timestamptz,
  add column if not exists family_note text,
  add column if not exists family_closer boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text check (deleted_by in ('mom', 'jared', 'mariah'));
create index if not exists pantry_recipes_family_idx on public.pantry_recipes (family_by, deleted_at);

-- ---------------------------------------------------------------- snap > read > check > save
create table if not exists public.family_captures (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.family_members (id) on delete cascade,
  status text not null default 'reading' check (status in ('reading', 'closer', 'ready', 'failed', 'saved', 'discarded')),
  draft jsonb,
  review jsonb not null default '[]'::jsonb,
  closer boolean not null default false,
  lowconf boolean not null default false,
  paid_used boolean not null default false,
  parse_job uuid,
  attempts int not null default 0,
  error text,
  has_back boolean not null default false,
  recipe_id int references public.pantry_recipes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists family_captures_member_idx on public.family_captures (member_id, status);
alter table public.family_captures enable row level security;

create table if not exists public.family_photos (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid references public.family_captures (id) on delete cascade,
  recipe_id int references public.pantry_recipes (id) on delete cascade,
  side text not null default 'front' check (side in ('front', 'back')),
  storage_path text not null,
  bytes int,
  nc_path text,
  nc_synced_at timestamptz,
  nc_error text,
  nc_tries int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists family_photos_recipe_idx on public.family_photos (recipe_id);
create index if not exists family_photos_capture_idx on public.family_photos (capture_id);
create index if not exists family_photos_unsynced_idx on public.family_photos (created_at) where nc_synced_at is null;
alter table public.family_photos enable row level security;

-- Per-person notes (Jared's notes stay in recipe_notes so the Kitchen tab shows them).
create table if not exists public.family_recipe_notes (
  recipe_id int not null references public.pantry_recipes (id) on delete cascade,
  member_id uuid not null references public.family_members (id) on delete cascade,
  body text not null default '' check (length(body) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (recipe_id, member_id)
);
alter table public.family_recipe_notes enable row level security;

create table if not exists public.family_purge_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  ok boolean not null default true,
  recipes int not null default 0,
  photos int not null default 0,
  captures int not null default 0,
  detail text
);
alter table public.family_purge_log enable row level security;

revoke all on public.family_members, public.family_sessions, public.family_oauth_states, public.family_pair_codes, public.family_auth_log,
  public.family_settings, public.family_captures, public.family_photos, public.family_recipe_notes, public.family_purge_log from anon, authenticated;
revoke all on sequence public.family_auth_log_id_seq, public.family_purge_log_id_seq from anon, authenticated;

-- Reading a family card is a new kind of parse job (source = capture id).
alter table public.recipe_parse_jobs drop constraint if exists recipe_parse_jobs_kind_check;
alter table public.recipe_parse_jobs add constraint recipe_parse_jobs_kind_check check (kind = any (array['photo', 'link', 'family']));

-- Private bucket for the shrunken (about 0.5 MB) working copies. Originals also go to Bestly Cloud Files > Family Recipes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-cards', 'family-cards', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
