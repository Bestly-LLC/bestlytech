-- Turo Watch demand meter. One row per scope per check:
--   car     our own car (2020 Model 3): share of the next 14 days already booked (fleet calendar)
--   model3  Tesla Model 3s near West Hollywood: how many are still free next week vs 5 weeks out,
--           and how much pricier next week is (median daily price, first page of results)
--   all     every car near West Hollywood: price pressure only (Turo caps the count at "200+")
-- score 0-100: under 30 Slow, 30-54 Normal, 55-74 Busy, 75+ Hot.
create table if not exists public.turo_demand (
  id bigserial primary key,
  observed_at timestamptz not null default now(),
  scope text not null check (scope in ('car', 'model3', 'all')),
  score int not null check (score between 0 and 100),
  booked_share numeric,           -- 0-1
  near_count int, far_count int, far_capped boolean,
  near_median_daily int, far_median_daily int,
  window_start date, window_end date,
  note text,
  src text not null default 'claude-in-chrome'
);
create index if not exists turo_demand_idx on public.turo_demand (scope, observed_at desc);
alter table public.turo_demand enable row level security;
drop policy if exists turo_demand_admin_read on public.turo_demand;
create policy turo_demand_admin_read on public.turo_demand for select to authenticated using (public.has_role(auth.uid(), 'admin'));
grant select on public.turo_demand to authenticated;

-- First readings, taken 2026-09-22 while building this (window Sep 23-30 vs Oct 28-Nov 4).
insert into public.turo_demand (observed_at, scope, score, booked_share, near_count, far_count, far_capped, near_median_daily, far_median_daily, window_start, window_end, note, src) values
  ('2026-09-22 08:40+00', 'car', 71, 0.714, null, null, null, null, null, '2026-09-23', '2026-10-06', '10 of the next 14 days booked', 'claude (build)'),
  ('2026-09-22 08:40+00', 'model3', 57, 0.335, 133, 200, true, 92, 58, '2026-09-23', '2026-09-30', '133 free next week vs 200+ five weeks out; next week ~59% pricier', 'claude (build)'),
  ('2026-09-22 08:40+00', 'all', 59, null, 200, 200, true, 93, 75, '2026-09-23', '2026-09-30', 'next week ~24% pricier than five weeks out', 'claude (build)');
