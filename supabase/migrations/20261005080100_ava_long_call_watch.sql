-- Money stopper, part 2 (Spark, 2026-10-04): the watchdog flags "long call, nothing gained" after each finished call.
-- 3+ minutes with no message, no booking, no callback set and no meaningful outcome.
--
-- Why a subkind column and not a new kind: ava_reply_incidents.kind has a CHECK list (code_leak, no_hangup, repeat) and
-- (call_id, kind) is unique. Changing that CHECK means removing a constraint, which this project's migration runner
-- refuses, so the new type rides on an existing kind (repeat) and is told apart by a nullable subkind = 'long_call'.
-- The UI reads subkind first. If the same call already has a real "repeat" row, the long-call note is appended to that
-- row's excerpt instead (the Scout alert still goes out), so neither finding is lost.
alter table public.ava_reply_incidents add column if not exists subkind text;

create or replace function public.ava_long_call_check(p_source text, p_call_id uuid, p_call_no bigint, p_duration integer, p_gained boolean, p_cost numeric)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_text text; v_llm text; v_new boolean;
  v_url text := case when p_source = 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end;
  v_who text := case when p_source = 'roofguard' then 'RoofGuard Ava' else 'Ava' end;
begin
  if coalesce(p_duration, 0) < 180 or coalesce(p_gained, false) then return; end if;
  v_text := (p_duration / 60)::text || ':' || lpad((p_duration % 60)::text, 2, '0') || ' · $' || to_char(round(coalesce(p_cost, 0), 2), 'FM990.00');
  if p_source = 'roofguard' then select llm into v_llm from rg_settings where id;
  else select llm into v_llm from ava_settings where id; end if;

  insert into ava_reply_incidents (source, call_id, call_no, kind, subkind, excerpt, llm, healed)
  values (p_source, p_call_id, p_call_no, 'repeat', 'long_call', v_text, v_llm, 'logged for her next review')
  on conflict (call_id, kind) do nothing
  returning true into v_new;

  if v_new is null then
    -- a real "repeat" row already holds this kind for the call: add the long-call note to it (once)
    update ava_reply_incidents set excerpt = coalesce(excerpt, '') || ' | Long call, nothing gained · ' || v_text
     where call_id = p_call_id and kind = 'repeat' and subkind is null and coalesce(excerpt, '') not like '%Long call, nothing gained%';
  end if;

  -- "medium" is this guard's severity word (Scout treats it as a normal-priority heads-up); one alert per call
  perform scout_notify(v_who || ': long call, nothing gained (#' || coalesce(p_call_no::text, '?') || ')',
    v_text || ' on the line with no message, booking or call back. Logged for her next review.', 'medium', true, v_url,
    'ava-longcall-' || p_call_id::text);
exception when others then
  -- the watchdog must never break call logging
  raise warning 'ava_long_call_check failed: %', sqlerrm;
end $function$;
revoke execute on function public.ava_long_call_check(text, uuid, bigint, integer, boolean, numeric) from public, anon, authenticated;

-- RoofGuard: every real (non-test) call, in either direction. "Gained" = a message, a callback, or a real outcome.
create or replace function public.rg_calls_reply_guard_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare s rg_settings;
begin
  if new.transcript is not null and new.moved_to_ava_at is null and (tg_op = 'INSERT' or old.transcript is distinct from new.transcript) then
    perform ava_reply_guard('roofguard', new.id, new.call_no, new.transcript);
    if not coalesce(new.is_test, false) then
      select * into s from rg_settings where id;
      perform ava_long_call_check('roofguard', new.id, new.call_no, new.duration_sec,
        coalesce(new.message, '') <> '' or coalesce(new.callback_wanted, false) or new.callback_number is not null
          or coalesce(new.outcome, 'other') in ('booked', 'callback_set', 'dm_identified', 'not_interested', 'wrong_number', 'do_not_call'),
        rg_call_cost(new, s));
    end if;
  end if;
  return new;
end $function$;

-- Personal Ava: only incoming calls from strangers. Calls from Jared and saved contacts, and calls Jared asked her to
-- make, are never "wasted" (the money stopper skips them too).
create or replace function public.ava_calls_reply_guard_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare s ava_settings;
begin
  if new.transcript is not null and (tg_op = 'INSERT' or old.transcript is distinct from new.transcript) then
    perform ava_reply_guard('ava', new.id, new.call_no, new.transcript);
    select * into s from ava_settings where id;
    if new.direction = 'inbound' and new.contact_id is null and new.phone is distinct from coalesce(s.jared_cell, '+18165007236') then
      perform ava_long_call_check('ava', new.id, new.call_no, new.duration_sec,
        coalesce(new.message, '') <> '' or coalesce(new.callback_wanted, false) or new.callback_number is not null,
        coalesce(new.duration_sec, 0) / 60.0 * s.cost_voice_per_min + ceil(coalesce(new.duration_sec, 0) / 60.0) * s.cost_phone_per_min + coalesce(new.llm_cost, 0));
    end if;
  end if;
  return new;
end $function$;
