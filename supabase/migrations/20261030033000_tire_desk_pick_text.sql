-- Flat Tire Desk, fix 1 (2026-10-29): the tow plan printed the shop's phone as "Vernon ((323) 264-2366)". Now ", phone (323) 264-2366".
-- Found by the rolled-back pick/approve test. Follow-up to 20261030030000_tire_desk.sql.

create or replace function public.tire_desk_pick(p_id uuid, p_idx int) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare i tire_incidents; s car_tire_settings; sh jsonb; r jsonb; body text; hard boolean;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into i from tire_incidents where id = p_id for update;
  if i.id is null then raise exception 'no such incident'; end if;
  sh := i.shops -> p_idx;
  if sh is null then raise exception 'no such shop'; end if;
  select * into s from car_tire_settings where id = 1;
  r := sh->'result';
  hard := exists (select 1 from turo_out_msgs where reservation_id = i.reservation_id and kind = 'tire_hard' and status = 'sent');
  body := case when hard then '' else 'If you haven''t yet, call Turo Roadside Assistance, 24/7: ' || s.roadside_phone || '. ' end
       || 'Please have Turo Roadside tow the car to ' || (sh->>'name') || coalesce(', ' || (sh->>'address'), '') || coalesce(', phone ' || (sh->>'phone'), '') || '. '
       || case when r->>'in_stock' = 'yes' then 'They told us they have the ' || coalesce(s.tire_size, '') || ' tire in stock'
                 || coalesce(' (' || nullif(r->>'brand', '') || ')', '') || '. '
               else 'The tire size is ' || coalesce(s.tire_size, '') || '. ' end
       || 'Before they put a new tire on, have the shop send me the brand and price here so I can approve it, per Turo''s flat tire policy, and keep all receipts. '
       || 'If the wheel or suspension looks damaged, not just the tire, tell me here before anything else is done.';
  insert into turo_out_msgs (reservation_id, kind, body, verify_snippet, status)
  values (i.reservation_id, 'tire_next', body, 'Please have Turo Roadside tow the car to', 'queued')
  on conflict (reservation_id, kind) do update set body = excluded.body, status = 'queued', attempts = 0, last_error = null, updated_at = now()
    where turo_out_msgs.status in ('queued', 'failed', 'cancelled');
  update tire_incidents set status = 'picked', picked = sh || jsonb_build_object('idx', p_idx, 'at', now()), updated_at = now() where id = p_id;
  perform tire_desk_log(p_id, 'Jared picked ' || (sh->>'name') || '; tow plan queued for the Turo chat');
  perform car_tire_poke_reader();
  return jsonb_build_object('ok', true, 'queued', found);
end $fn$;
