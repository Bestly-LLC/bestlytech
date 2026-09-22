-- Turo Watch moves into the admin (/admin/turo): admins read runs, day prices and comps.
drop policy if exists turo_runs_admin_read on public.turo_runs;
create policy turo_runs_admin_read on public.turo_runs for select to authenticated using (public.has_role(auth.uid(), 'admin'));
drop policy if exists turo_day_prices_admin_read on public.turo_day_prices;
create policy turo_day_prices_admin_read on public.turo_day_prices for select to authenticated using (public.has_role(auth.uid(), 'admin'));
drop policy if exists turo_comps_admin_read on public.turo_comps;
create policy turo_comps_admin_read on public.turo_comps for select to authenticated using (public.has_role(auth.uid(), 'admin'));
