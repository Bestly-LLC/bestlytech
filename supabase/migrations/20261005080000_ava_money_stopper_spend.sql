-- Money stopper, part 1 (Spark, 2026-10-04): a daily spend cap for each Ava, in US dollars, Pacific day.
-- Outgoing calls refuse once today's spend reaches the cap; incoming calls are always answered.
alter table public.rg_settings  add column if not exists daily_spend_cap numeric(8,2) not null default 20.00 check (daily_spend_cap > 0 and daily_spend_cap <= 1000);
alter table public.ava_settings add column if not exists daily_spend_cap numeric(8,2) not null default 10.00 check (daily_spend_cap > 0 and daily_spend_cap <= 1000);

-- Today's spend for one Ava, using the same cost math as rg_costs() / ava_costs(): voice minutes + phone minutes + AI model.
-- Internal (no admin check, so edge functions on the service key can call it); not callable by browsers.
create or replace function public.ava_spend_calc(p_source text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_today numeric; v_cap numeric; r rg_settings; a ava_settings;
begin
  if p_source = 'roofguard' then
    select * into r from rg_settings where id;
    v_cap := r.daily_spend_cap;
    select coalesce(sum(rg_call_cost(c, r)), 0) into v_today
      from rg_calls c where c.moved_to_ava_at is null and (c.queued_at at time zone 'America/Los_Angeles')::date = v_day;
  elsif p_source = 'ava' then
    select * into a from ava_settings where id;
    v_cap := a.daily_spend_cap;
    select coalesce(sum(coalesce(c.duration_sec, 0) / 60.0 * a.cost_voice_per_min + ceil(coalesce(c.duration_sec, 0) / 60.0) * a.cost_phone_per_min + coalesce(c.llm_cost, 0)), 0) into v_today
      from ava_calls c where (c.created_at at time zone 'America/Los_Angeles')::date = v_day;
  else
    raise exception 'unknown source %', p_source;
  end if;
  return jsonb_build_object('source', p_source, 'today', round(v_today, 2), 'cap', v_cap, 'over', v_today >= v_cap);
end $function$;
revoke execute on function public.ava_spend_calc(text) from public, anon, authenticated;

-- The gate every outgoing call path asks first. Over the cap: returns the refusal message and pushes Scout once per day.
create or replace function public.ava_spend_gate(p_source text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v jsonb := ava_spend_calc(p_source);
  v_day text := to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD');
  v_cap text := to_char((v->>'cap')::numeric, 'FM999990.00');
begin
  if (v->>'over')::boolean then
    perform scout_notify(case when p_source = 'roofguard' then 'RoofGuard Ava' else 'Ava' end || ' hit her daily spend cap',
      'Spent $' || to_char((v->>'today')::numeric, 'FM999990.00') || ' today, cap $' || v_cap
        || '. Outgoing calls are paused until tomorrow or until you raise the cap. Incoming calls still get answered.',
      'warning', true,
      case when p_source = 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end,
      'ava-spend-cap-' || p_source || '-' || v_day);
    return v || jsonb_build_object('message', 'Daily spend cap reached ($' || v_cap || '). Raise it in Setup or try tomorrow.');
  end if;
  return v;
end $function$;
revoke execute on function public.ava_spend_gate(text) from public, anon, authenticated;

-- For the admin pages: today's spend and the cap.
create or replace function public.ava_spend(p_source text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return ava_spend_calc(p_source);
end $function$;
revoke execute on function public.ava_spend(text) from public, anon;
grant execute on function public.ava_spend(text) to authenticated;

-- Change the cap (US dollars, more than 0 and at most 1000).
create or replace function public.ava_set_spend_cap(p_source text, p_cap numeric)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if p_cap is null or p_cap <= 0 or p_cap > 1000 then raise exception 'Pick a cap between $0.01 and $1,000.00'; end if;
  if p_source = 'roofguard' then update rg_settings set daily_spend_cap = round(p_cap, 2), updated_at = now() where id;
  elsif p_source = 'ava' then update ava_settings set daily_spend_cap = round(p_cap, 2), updated_at = now() where id;
  else raise exception 'unknown source %', p_source; end if;
  return ava_spend_calc(p_source);
end $function$;
revoke execute on function public.ava_set_spend_cap(text, numeric) from public, anon;
grant execute on function public.ava_set_spend_cap(text, numeric) to authenticated;
