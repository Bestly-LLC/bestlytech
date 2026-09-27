-- One-time file hand-off between Claude sessions and the Mac/Pi (wall code edits), applied 2026-09-27.
-- Tokens live in wall_drop_tokens (created from SQL, expire). The Mac job uses the public key + token.
create table if not exists public.wall_file_drop (
  id bigserial primary key, token text not null, name text not null,
  direction text not null check (direction in ('up','down')), body text not null,
  created_at timestamptz not null default now());
alter table public.wall_file_drop enable row level security;
create table if not exists public.wall_drop_tokens (token text primary key, expires_at timestamptz not null, note text);
alter table public.wall_drop_tokens enable row level security;
-- RPCs: wall_file_drop_put / _fetch (up), wall_file_drop_send / _get (down); all check a live token.
-- See the live definitions in the database (applied via MCP as wall_file_drop + wall_file_drop_fetch).
