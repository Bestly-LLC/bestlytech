-- W6: APNs rejects a provider token that is re-minted more than about once per 20 minutes
-- (429 TooManyProviderTokenUpdates). Edge isolates come and go, so the signed JWT is shared here (service role only).
create table if not exists public.wall_sky_jwt (
  id int primary key default 1 check (id = 1),
  token text,
  minted_at timestamptz
);
alter table public.wall_sky_jwt enable row level security;
