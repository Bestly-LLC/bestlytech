-- CARCARD_20261103 (applied as migration carcard_20261103_trip_end_sweep_due)
-- UNDO: alter table car_charge_plan drop column trip_end, drop column sweep_due, drop column sweep_end;
alter table public.car_charge_plan add column if not exists trip_end timestamptz;
alter table public.car_charge_plan add column if not exists sweep_due timestamptz;
alter table public.car_charge_plan add column if not exists sweep_end timestamptz;
