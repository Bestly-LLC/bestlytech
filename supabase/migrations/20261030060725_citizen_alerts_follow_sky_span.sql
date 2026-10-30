-- Local alerts cover the whole sky map (Jared, Oct 29 2026 11:04 PM: "I want the alerts to be the span of the map showing on the sky").
-- The sky map radius is wall_state.airRadiusMi (10 mi today). Every local source now accepts incidents out to that radius,
-- and follows it when the map is zoomed. Wide-area sources keep their own larger reach (CAL FIRE 25 mi, USGS 250 mi); AQI is home-only.
-- The wall still draws only what lands on screen. Undo: set max_ft back (old values in the comment at the bottom).
create or replace function public.citizen_sync_sky_span()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r numeric;
begin
  select coalesce(nullif(state->>'airRadiusMi','')::numeric, 10) into r from public.wall_state limit 1;
  r := greatest(1, least(coalesce(r, 10), 30));
  update public.citizen_sources
     set max_ft = round(r * 5280)::int
   where source in ('chp','closures','heli','lafd','metro','nixle','nws','scanner','sce','wehocity','pulsepoint','citizen')
     and max_ft is distinct from round(r * 5280)::int;
end $$;
revoke all on function public.citizen_sync_sky_span() from public, anon, authenticated;

create or replace function public.citizen_sky_span_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.state->>'airRadiusMi') is distinct from (old.state->>'airRadiusMi') then
    perform public.citizen_sync_sky_span();
  end if;
  return new;
end $$;

drop trigger if exists citizen_sky_span on public.wall_state;
create trigger citizen_sky_span after update on public.wall_state
  for each row execute function public.citizen_sky_span_trg();

select public.citizen_sync_sky_span();

-- Previous max_ft: chp 5280, closures 26400, heli 7920, lafd 7920, metro 7920, nixle 15840, nws 5280, scanner 7920,
-- sce 15840, wehocity 15840, pulsepoint 5280, citizen 5280 (calfire 132000, usgs 1320000, aqi 0 unchanged).
