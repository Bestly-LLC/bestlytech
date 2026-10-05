-- 2026-10-05: a follow-up you can actually call back.
--
-- What went wrong: Federica rang with her caller ID withheld and asked Jared to call her office
-- number. ava_calls.phone was stored as 'anonymous' and she never gave the digits, so the follow-up
-- had nothing to dial. Tapping "Call back now" failed with "Enter a 10-digit US or Canada number",
-- the note was written back onto the row, and there was no way to supply a number. Dead end.
--
-- Fix, three parts:
--   1. ava_followups.callback_phone - the number they asked to be reached on, which is often NOT the
--      number they rang from. The dial target is coalesce(callback_phone, phone).
--   2. A trigger normalises callback_phone to +1XXXXXXXXXX and refuses anything else, so the admin
--      card can write it straight to the row and a bad number never reaches the dialer.
--   3. ava_followup_act and ava_followups_tick refuse to dial with no number, and say what to do
--      instead of surfacing a validation error from deep inside the dialer.
--
-- Signature note: ava_followup_act keeps its 3-arg shape on purpose. The number is saved to the row
-- first (by the card, through RLS) rather than passed in, which avoids dropping and recreating a
-- function other callers depend on.

alter table public.ava_followups add column if not exists callback_phone text;
comment on column public.ava_followups.callback_phone is
  'The number to actually dial when it differs from the number they rang from (an office line, a mobile). Preferred over phone.';

-- The number this follow-up should ring. 'anonymous' is a withheld caller ID, not a number.
create or replace function public.ava_followup_dial_to(f public.ava_followups)
returns text language sql immutable as $$
  select coalesce(nullif(f.callback_phone, ''), nullif(nullif(f.phone, ''), 'anonymous'));
$$;

-- Normalise on the way in, so every writer (the admin card, a backfill, a future edge function)
-- gets the same treatment and a typo is refused at the table rather than at dial time.
create or replace function public.ava_followup_phone_norm_trg() returns trigger language plpgsql as $$
declare d text;
begin
  if new.callback_phone is null or btrim(new.callback_phone) = '' then
    new.callback_phone := null;
    return new;
  end if;
  d := regexp_replace(new.callback_phone, '[^0-9]', '', 'g');
  if length(d) = 11 and left(d, 1) = '1' then d := substr(d, 2); end if;
  if length(d) <> 10 then raise exception 'That needs to be a 10-digit US or Canada number.'; end if;
  new.callback_phone := '+1' || d;
  new.note := null;   -- a fresh number clears the old complaint
  return new;
end $$;

create or replace trigger ava_followup_phone_norm
  before insert or update of callback_phone on public.ava_followups
  for each row execute function public.ava_followup_phone_norm_trg();

create or replace function public.ava_followup_act(p_id uuid, p_action text, p_at timestamptz default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare f ava_followups; v_dial text;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  select * into f from ava_followups where id = p_id for update;
  if f.id is null then raise exception 'No such follow-up'; end if;
  v_dial := public.ava_followup_dial_to(f);
  if p_action = 'call_now' then
    if f.status not in ('proposed', 'approved') then raise exception 'This follow-up is already %', f.status; end if;
    if v_dial is null then raise exception 'No number to call. Add the number they want ringing, then try again.'; end if;
    update ava_followups set status = 'dialing', due_at = now(), dialed_at = now(), note = null, updated_at = now() where id = p_id;
    perform invoke_edge_function(case f.source when 'ava' then 'ava-assistant' else 'roofguard-caller' end,
                                 jsonb_build_object('action', 'callback', 'id', p_id), 60000);
  elsif p_action = 'approve' then
    if f.status not in ('proposed', 'approved') then raise exception 'This follow-up is already %', f.status; end if;
    if p_at is null or p_at < now() - interval '1 minute' then raise exception 'Pick a time in the future'; end if;
    if v_dial is null then raise exception 'No number to call. Add the number they want ringing, then try again.'; end if;
    update ava_followups set status = 'approved', due_at = p_at, reminded_at = null, updated_at = now() where id = p_id;
  elsif p_action = 'dismiss' then
    if f.status not in ('proposed', 'approved') then raise exception 'This follow-up is already %', f.status; end if;
    update ava_followups set status = 'dismissed', updated_at = now() where id = p_id;
  elsif p_action = 'cancel' then
    if f.status <> 'approved' then raise exception 'Only a scheduled follow-up can be cancelled'; end if;
    update ava_followups set status = 'proposed', due_at = null, reminded_at = null, updated_at = now() where id = p_id;
  else
    raise exception 'unknown action %', p_action;
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from ava_followups where id = p_id), 'dial_to', v_dial);
end $function$;

-- The scheduled dialer stops on a numberless row and says so, instead of burning retries.
create or replace function public.ava_followups_tick()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  f record; v_reset int := 0; v_missed int := 0; v_reminded int := 0; v_dialed int := 0; v_nonum int := 0;
begin
  with x as (update ava_followups set status = 'proposed', due_at = null, updated_at = now(),
               note = coalesce(note || ' ', '') || '[call did not go out; tap Call back now to retry]'
              where status = 'dialing' and dialed_at < now() - interval '15 minutes' returning id)
  select count(*) into v_reset from x;
  if v_reset > 0 then
    perform scout_notify('Ava follow-up call did not go out', v_reset || ' follow-up call(s) never connected. They are back in the list to retry.',
                         'warning', true, 'https://bestly.tech/admin/ava', 'ava-followup-stuck-' || to_char(now(), 'YYYYMMDDHH24'));
  end if;
  with x as (update ava_followups set status = 'proposed', due_at = null, updated_at = now(),
               note = coalesce(note || ' ', '') || '[missed its time]'
              where status = 'approved' and due_at < now() - interval '4 hours' returning id)
  select count(*) into v_missed from x;
  with x as (update ava_followups set status = 'proposed', due_at = null, updated_at = now(),
               note = 'No number to call. Add the number they want ringing, then tap Call back now.'
              where status = 'approved' and due_at <= now()
                and coalesce(nullif(callback_phone, ''), nullif(nullif(phone, ''), 'anonymous')) is null returning id)
  select count(*) into v_nonum from x;
  for f in select * from ava_followups where status = 'approved' and reminded_at is null and due_at > now() and due_at <= now() + interval '15 minutes' loop
    perform scout_notify('Ava calls ' || coalesce(f.name, f.phone) || ' back at ' || to_char(f.due_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || ' PT',
                         coalesce(f.reason, 'Scheduled call back'), 'info', true,
                         case f.source when 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end,
                         'ava-followup-remind-' || f.id);
    update ava_followups set reminded_at = now(), updated_at = now() where id = f.id;
    v_reminded := v_reminded + 1;
  end loop;
  for f in select * from ava_followups where status = 'approved' and due_at <= now() order by due_at limit 3 loop
    update ava_followups set status = 'dialing', dialed_at = now(), updated_at = now() where id = f.id;
    perform invoke_edge_function(case f.source when 'ava' then 'ava-assistant' else 'roofguard-caller' end,
                                 jsonb_build_object('action', 'callback', 'id', f.id), 60000);
    v_dialed := v_dialed + 1;
  end loop;
  return jsonb_build_object('reset', v_reset, 'missed', v_missed, 'reminded', v_reminded, 'dialed', v_dialed, 'no_number', v_nonum);
end $function$;
revoke execute on function public.ava_followups_tick() from public, anon, authenticated;

-- Backfill: a call that did capture a callback number carries it onto its follow-up.
update public.ava_followups f set callback_phone = c.callback_number
  from public.ava_calls c
 where f.source = 'ava' and f.call_id = c.id and f.callback_phone is null
   and c.callback_number is not null and c.callback_number <> f.phone
   and length(regexp_replace(c.callback_number, '[^0-9]', '', 'g')) in (10, 11);
