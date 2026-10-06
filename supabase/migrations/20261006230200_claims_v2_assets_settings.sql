-- Claims Closer v2: small assets table (Jared's Bestly mail signature GIF, loaded from his Mac's Mail signature by hand on
-- 2026-10-06) and this week's setting: ask 5 shops, not 3, because Willie's estimate is due Wed Oct 7 11:54 AM.
create table if not exists public.claims_assets (name text primary key, content_type text not null, b64 text not null, updated_at timestamptz not null default now());
alter table public.claims_assets enable row level security;
revoke all on public.claims_assets from anon, authenticated;
update public.claims_settings set shops_per_request = 5, updated_at = now() where id;
