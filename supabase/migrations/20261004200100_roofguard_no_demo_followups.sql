-- Demo calls (partner portal) never schedule follow-ups: an investor saying "call me tomorrow" during a demo
-- must not get an automatic callback. Same trigger function as 20261004190000, plus the demo-lead skip.
create or replace function public.rg_calls_followup_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id = (select demo_lead_id from rg_settings where id) then return new; end if;
  if new.status = 'completed' and new.outcome = 'callback_set' and new.callback_at is not null
     and new.callback_at > now() - interval '1 hour' then
    insert into rg_followups (lead_id, call_id, to_number, due_at, is_test, note)
    values (new.lead_id, new.id, new.to_number, new.callback_at, new.is_test,
            left(coalesce(new.summary, new.notes, 'Asked for a callback'), 300))
    on conflict (call_id) do update set due_at = excluded.due_at, note = excluded.note, updated_at = now()
      where rg_followups.status = 'scheduled';
  end if;
  if tg_op = 'INSERT' and not new.is_test then
    update rg_followups set status = 'done', result_call_id = new.id, updated_at = now()
     where lead_id = new.lead_id and not is_test and status = 'scheduled' and due_at < now() + interval '1 hour';
  end if;
  return new;
end $$;
