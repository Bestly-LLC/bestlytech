-- "All clear" left the DELTA 2 at 100% (the HA automation doesn't lower the limit; tested 2026-09-23).
-- Remember the limit that was set before the emergency and send it back with the storage command
-- (home hub agent 1.5.2 applies payload.level).
alter table public.emergency_prep add column if not exists prev_limit int;

create or replace function public.emergency_start(p_hazard text default 'general')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.emergency_prep;
  v_hazard text := case when p_hazard in ('general','earthquake','fire','flood','outage') then p_hazard else 'general' end;
  v_cmd uuid;
  v_prev int;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into e from emergency_prep where ended_at is null limit 1;
  if e.id is null then
    -- the last limit the DELTA 2 reported that wasn't already 100%
    select (result->>'max_charge')::int into v_prev from home_hub_commands
     where target = 'homeassistant' and action = 'ecoflow' and status = 'done'
       and (result->>'max_charge') ~ '^\d+$' and (result->>'max_charge')::int < 100
     order by created_at desc limit 1;
    insert into emergency_prep (hazard, prev_limit) values (v_hazard, coalesce(v_prev, 50)) returning * into e;
  elsif v_hazard <> 'general' and e.hazard <> v_hazard then
    update emergency_prep set hazard = v_hazard where id = e.id returning * into e;
  end if;
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
  insert into home_hub_commands (target, action, payload)
    values ('homeassistant', 'ecoflow', jsonb_build_object('mode', 'storage', 'level', coalesce(e.prev_limit, 50)));
  return coalesce(to_jsonb(e), '{}'::jsonb);
end $$;
