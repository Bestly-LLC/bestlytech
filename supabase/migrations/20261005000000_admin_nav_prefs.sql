-- Admin left-nav section order, synced across every browser and device.
-- Before: the order Jared dragged the sections into lived in localStorage, so each browser had its own.
-- Now: one row per admin user; the sidebar reads it on load, on focus and live (realtime), and writes it when a drag ends.

create table if not exists public.admin_nav_prefs (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  section_order jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);

alter table public.admin_nav_prefs enable row level security;

create policy "admin reads own nav prefs" on public.admin_nav_prefs
  for select to authenticated using (user_id = auth.uid() and public.team_is_admin());
create policy "admin inserts own nav prefs" on public.admin_nav_prefs
  for insert to authenticated with check (user_id = auth.uid() and public.team_is_admin());
create policy "admin updates own nav prefs" on public.admin_nav_prefs
  for update to authenticated using (user_id = auth.uid() and public.team_is_admin())
  with check (user_id = auth.uid() and public.team_is_admin());

-- Live updates to other open browsers.
do $$ begin
  alter publication supabase_realtime add table public.admin_nav_prefs;
exception when duplicate_object then null; when undefined_object then null;
end $$;
