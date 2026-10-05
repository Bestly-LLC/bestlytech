-- Ava's follow-ups (Spark, 2026-10-04). Jared: "follow up with Eli tomorrow, it should be autonomous and set tasks and
-- reminders for itself."
-- Any call that ends with a callback time becomes a follow-up task. Every 5 minutes rg_followups_tick:
--   * reminds Jared (Scout push) 15 minutes before each one,
--   * dials test follow-ups itself when they come due (real leads are already re-queued through next_call_at by rg_log_call,
--     so for those the task just tracks it and closes when the next call to that lead goes out),
--   * self-heals: a follow-up stuck "dialing" for 15 minutes is marked failed and raised to Scout.

create table if not exists public.rg_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.rg_leads(id) on delete cascade,
  call_id uuid unique references public.rg_calls(id) on delete set null,   -- the call that asked for it
  to_number text not null,
  due_at timestamptz not null,
  is_test boolean not null default false,
  kind text not null default 'callback',
  status text not null default 'scheduled' check (status in ('scheduled', 'dialing', 'done', 'failed', 'cancelled')),
  note text,
  reminded_at timestamptz,
  dialed_at timestamptz,
  result_call_id uuid references public.rg_calls(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rg_followups_due on public.rg_followups (status, due_at);
alter table public.rg_followups enable row level security;
create policy "admins read followups" on public.rg_followups for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "admins change followups" on public.rg_followups for update to authenticated using (public.has_role(auth.uid(), 'admin'));
grant select, update on public.rg_followups to authenticated;

-- A finished call with a callback time schedules its own follow-up. A new call to the same lead closes any that are due.
create or replace function public.rg_calls_followup_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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
create trigger rg_calls_followup after insert or update of status, outcome, callback_at on public.rg_calls
  for each row execute function public.rg_calls_followup_trg();

create or replace function public.rg_followups_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f record;
  v_reminded int := 0; v_dialed int := 0; v_failed int := 0;
begin
  -- self-heal: dial requests that never reported back
  with stuck as (
    update rg_followups set status = 'failed', updated_at = now(), note = coalesce(note || ' ', '') || '[watchdog: no call after 15 min]'
     where status = 'dialing' and dialed_at < now() - interval '15 minutes' returning id)
  select count(*) into v_failed from stuck;
  if v_failed > 0 then
    perform bestly_raise('roofguard.followups', 'problem', 'warning', 'RoofGuard follow-up call failed',
      format('%s follow-up call(s) never connected. Check /admin/roofguard.', v_failed), 'roofguard', null, true);
  end if;

  -- reminders, 15 minutes ahead
  for f in select fu.*, l.company from rg_followups fu join rg_leads l on l.id = fu.lead_id
            where fu.status = 'scheduled' and fu.reminded_at is null and fu.due_at <= now() + interval '15 minutes' loop
    perform scout_notify('Ava calls back ' || f.company || ' at ' || to_char(f.due_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || ' PT',
      coalesce(f.note, 'Scheduled callback') || case when f.is_test then ' (test call to ' || f.to_number || ')' else '' end,
      'info', true, '/admin/roofguard', 'roofguard-followup-remind-' || f.id);
    update rg_followups set reminded_at = now(), updated_at = now() where id = f.id;
    v_reminded := v_reminded + 1;
  end loop;

  -- dial test follow-ups that are due (real leads go through the dialer's own queue)
  for f in select * from rg_followups where status = 'scheduled' and is_test and due_at <= now()
            and due_at > now() - interval '2 hours' order by due_at limit 3 loop
    update rg_followups set status = 'dialing', dialed_at = now(), updated_at = now() where id = f.id;
    perform invoke_edge_function('roofguard-caller', jsonb_build_object('action', 'followup', 'id', f.id), 60000);
    v_dialed := v_dialed + 1;
  end loop;

  -- anything more than 2 hours overdue and never dialed is closed out loudly rather than called at a strange hour
  update rg_followups set status = 'failed', updated_at = now(), note = coalesce(note || ' ', '') || '[missed: over 2 hours late]'
   where status = 'scheduled' and is_test and due_at < now() - interval '2 hours';

  return jsonb_build_object('reminded', v_reminded, 'dialed', v_dialed, 'healed', v_failed);
end $$;

select cron.schedule('roofguard-followups', '*/5 * * * *', $$ select public.rg_followups_tick(); $$);

-- For the Calls screen: Ava's upcoming and recent follow-ups.
create or replace function public.rg_followups_list()
returns table(id uuid, lead_id uuid, company text, contact_name text, to_number text, due_at timestamptz, timezone text,
              is_test boolean, status text, note text, reminded_at timestamptz, result_call_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query
  select f.id, f.lead_id, l.company, l.contacts->0->>'name', f.to_number, f.due_at, l.timezone, f.is_test, f.status, f.note,
         f.reminded_at, f.result_call_id
    from rg_followups f join rg_leads l on l.id = f.lead_id
   where f.status in ('scheduled', 'dialing') or f.updated_at > now() - interval '2 days'
   order by (f.status in ('scheduled', 'dialing')) desc, f.due_at;
end $$;
revoke execute on function public.rg_followups_list() from public, anon;
grant execute on function public.rg_followups_list() to authenticated;
revoke execute on function public.rg_followups_tick() from public, anon, authenticated;
