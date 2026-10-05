-- A callback-intent message also gets a follow-up row (2026-10-05), so the message's "Approve for..." button has something to approve
-- (ava_followup_act). Nothing dials: the row stays "proposed" until Jared taps Call back now or approves a time.
create or replace function public.ava_calls_actions_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.intent is not null and new.direction = 'inbound' and coalesce(new.is_spam, false) = false and new.deleted_at is null then
    perform ava_actions_make('ava', new.id, new.intent, coalesce(new.counterpart_phone, new.callback_number, new.phone), new.caller_name,
                             new.counterpart_business, coalesce(new.message, new.summary), new.appointment_purpose, new.preferred_times);
    update ava_actions set payload = payload || jsonb_build_object('appt_duration_min', coalesce(new.appt_duration_min, 60),
        'appt_constraints', coalesce(nullif(btrim(new.appt_constraints), ''), nullif(btrim(new.preferred_times), '')))
     where source = 'ava' and call_id = new.id and kind = 'find_times' and status = 'open';
    if new.intent = 'callback' and coalesce(new.counterpart_phone, new.callback_number, new.phone) is not null then
      insert into ava_followups (source, call_id, phone, name, reason)
      values ('ava', new.id, coalesce(new.counterpart_phone, new.callback_number, new.phone), new.caller_name,
              left(coalesce(new.message, new.summary, 'Asked for a call back'), 300))
      on conflict (source, call_id) do nothing;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'ava_calls_actions_trg failed: %', sqlerrm;
  return new;
end $function$;
