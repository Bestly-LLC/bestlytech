-- Emergency prep: one tap in the admin starts getting ready for a disaster (earthquake, fire,
-- flood, power outage). It charges the EcoFlow DELTA 2 to 100% through the Home Hub agent on the
-- Pi (homeassistant.ecoflow full), buzzes Jared's phone, and opens a checklist whose ticks are
-- kept here so they follow him from the Mac to the phone. "All clear" sets the battery back to
-- its storage level.

create table if not exists public.emergency_prep (
  id uuid primary key default gen_random_uuid(),
  hazard text not null default 'general' check (hazard in ('general','earthquake','fire','flood','outage')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  checklist jsonb not null default '{}'::jsonb,          -- item id -> ISO time it was ticked
  charge_cmd uuid,                                       -- home_hub_commands row that charges the DELTA 2
  note text
);
create unique index if not exists emergency_prep_one_active on public.emergency_prep ((true)) where ended_at is null;
alter table public.emergency_prep enable row level security;
drop policy if exists "Admins manage emergency prep" on public.emergency_prep;
create policy "Admins manage emergency prep" on public.emergency_prep for all to authenticated
  using (has_role(auth.uid(), 'admin')) with check (has_role(auth.uid(), 'admin'));
grant select, update on public.emergency_prep to authenticated;

create or replace function public.emergency_start(p_hazard text default 'general')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.emergency_prep;
  v_hazard text := case when p_hazard in ('general','earthquake','fire','flood','outage') then p_hazard else 'general' end;
  v_cmd uuid;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into e from emergency_prep where ended_at is null limit 1;
  if e.id is null then
    insert into emergency_prep (hazard) values (v_hazard) returning * into e;
  elsif v_hazard <> 'general' and e.hazard <> v_hazard then
    update emergency_prep set hazard = v_hazard where id = e.id returning * into e;
  end if;
  -- (Re)send the charge unless one is already on its way.
  if e.charge_cmd is null or not exists (select 1 from home_hub_commands where id = e.charge_cmd and status in ('pending','running')) then
    insert into home_hub_commands (target, action, payload) values ('homeassistant', 'ecoflow', '{"mode":"full"}')
      returning id into v_cmd;
    update emergency_prep set charge_cmd = v_cmd where id = e.id returning * into e;
    perform scout_notify('Emergency prep started',
      'Charging the EcoFlow DELTA 2 to 100%. Your checklist is open in the admin.', 'warning', true,
      '/admin/emergency', 'emergency:' || e.id);
  end if;
  return to_jsonb(e);
end $$;

create or replace function public.emergency_end()
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.emergency_prep;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update emergency_prep set ended_at = now() where ended_at is null returning * into e;
  insert into home_hub_commands (target, action, payload) values ('homeassistant', 'ecoflow', '{"mode":"storage"}');
  return coalesce(to_jsonb(e), '{}'::jsonb);
end $$;

create or replace function public.emergency_tick(p_item text, p_done boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e public.emergency_prep;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update emergency_prep set checklist = case when p_done
      then checklist || jsonb_build_object(left(p_item, 60), now())
      else checklist - left(p_item, 60) end
   where ended_at is null returning * into e;
  return coalesce(to_jsonb(e), '{}'::jsonb);
end $$;

-- Battery check without charging anything: the page asks for this every couple of minutes.
create or replace function public.emergency_battery_check()
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select id into v from home_hub_commands
   where target = 'homeassistant' and action = 'ecoflow' and payload->>'mode' = 'status'
     and status in ('pending','running') limit 1;
  if v is null then
    insert into home_hub_commands (target, action, payload) values ('homeassistant', 'ecoflow', '{"mode":"status"}')
      returning id into v;
  end if;
  return v;
end $$;

revoke all on function public.emergency_start(text) from public, anon;
revoke all on function public.emergency_end() from public, anon;
revoke all on function public.emergency_tick(text, boolean) from public, anon;
revoke all on function public.emergency_battery_check() from public, anon;
grant execute on function public.emergency_start(text) to authenticated;
grant execute on function public.emergency_end() to authenticated;
grant execute on function public.emergency_tick(text, boolean) to authenticated;
grant execute on function public.emergency_battery_check() to authenticated;
