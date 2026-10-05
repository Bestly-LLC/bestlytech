-- RoofGuard Calls board (Spark, 2026-10-04). See docs/roofguard/ava-live-calls-opusplan.md.
-- Read-only views for /admin/roofguard → Calls: the queue (left), the finished calls (right), live calls, and one lead's history.
-- Admin only. Nothing here claims, dials or changes a lead.

-- One word for where a call left the lead.
create or replace function public.rg_stage(p_outcome text, p_call_status text, p_attempts int, p_max int)
returns text language sql immutable as $$
  select case
    when p_call_status = 'booked' or p_outcome = 'booked'           then 'booked'
    when p_call_status = 'do_not_call' or p_outcome = 'do_not_call' then 'dnc'
    when p_call_status = 'not_interested' or p_outcome = 'not_interested' then 'not_interested'
    when p_call_status = 'wrong_number' or p_outcome = 'wrong_number'     then 'bad_number'
    when p_outcome = 'callback_set'                                  then 'callback'
    when coalesce(p_attempts, 0) >= coalesce(p_max, 3)               then 'exhausted'
    when p_outcome = 'voicemail_left'                                then 'voicemail'
    when p_outcome in ('gatekeeper_blocked', 'dm_identified')        then 'gatekeeper'
    when p_outcome = 'no_answer'                                     then 'no_answer'
    else 'other' end
$$;

-- LEFT COLUMN: who Ava calls next, in order, with a plain reason. Mirrors rg_next_call_batch's rules
-- but ignores the on/off switch and daily caps so Jared can see the line-up while calling is paused.
create or replace function public.rg_call_queue(p_limit int default 100)
returns table(lead_id uuid, company text, state text, timezone text, contact_name text, contact_title text, phone text,
              line_type text, attempt int, max_attempts int, priority int, call_status text, next_call_at timestamptz,
              local_time text, ready_now boolean, reason text, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query
  with s as (select * from rg_settings where id),
  c as (
    select l.*, s.max_attempts as mx, s.window_start_hour as ws, s.window_end_hour as we, s.min_gap_bdays as gap,
           (now() at time zone l.timezone) as loc
      from rg_leads l, s
     where l.phone is not null
       and l.line_type in ('landline', 'voip', 'unverified')
       and not l.dnc
       and not exists (select 1 from rg_dnc d where d.phone = l.phone)
       and l.call_status not in ('booked', 'not_interested', 'do_not_call', 'wrong_number', 'in_progress')
       and l.call_attempts < s.max_attempts
  ),
  r as (
    select c.*,
      (c.line_type <> 'unverified') as line_ok,
      (extract(isodow from c.loc) < 6 and extract(hour from c.loc) >= c.ws and extract(hour from c.loc) < c.we
         and not exists (select 1 from rg_holidays h where h.day = c.loc::date)) as hours_ok,
      (case when c.next_call_at is not null then now() >= c.next_call_at - interval '10 minutes'
            else (c.last_called_at is null or rg_business_days_between(c.last_called_at, now(), c.timezone) >= c.gap) end) as due_ok
      from c
  )
  select r.id, r.company, r.state, r.timezone, r.contacts->0->>'name', r.contacts->0->>'title', r.phone,
         r.line_type, r.call_attempts + 1, r.mx, r.priority, r.call_status, r.next_call_at,
         to_char(r.loc, 'FMHH12:MI AM'),
         (r.line_ok and r.hours_ok and r.due_ok),
         case
           when r.next_call_at is not null and not r.due_ok
             then 'Callback ' || to_char(r.next_call_at at time zone r.timezone, 'Dy FMHH12:MI AM')
           when r.next_call_at is not null then 'Callback due now'
           when not r.line_ok then 'Line type not checked yet'
           when not r.due_ok then 'Retry after a ' || r.gap || '-business-day gap'
           when not r.hours_ok then 'Outside calling hours there'
           when r.call_attempts = 0 then 'First call'
           else 'Attempt ' || (r.call_attempts + 1) || ' of ' || r.mx
         end,
         count(*) over ()
    from r
   order by (r.line_ok and r.hours_ok and r.due_ok) desc, (r.next_call_at is not null) desc, r.next_call_at,
            r.line_ok desc, r.priority desc, r.company
   limit greatest(1, least(p_limit, 500));
end $$;

-- RIGHT COLUMN: every lead Ava has called, latest call first, with its stage in the cycle.
create or replace function public.rg_call_board(p_limit int default 100)
returns table(call_id uuid, lead_id uuid, company text, state text, timezone text, stage text, outcome text,
              summary text, notes text, meeting_times text, meeting_email text, callback_at timestamptz,
              dm_name text, dm_title text, opener_key text, duration_sec int, ended_at timestamptz,
              attempt int, calls int, is_test boolean, to_number text, has_transcript boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query
  with s as (select * from rg_settings where id),
  latest as (
    select distinct on (c.lead_id, c.is_test) c.*,
           count(*) over (partition by c.lead_id, c.is_test) as n
      from rg_calls c
     where c.status not in ('queued', 'in_progress')
     order by c.lead_id, c.is_test, coalesce(c.ended_at, c.queued_at) desc
  )
  select x.id, x.lead_id, l.company, l.state, l.timezone,
         case when x.is_test then rg_stage(x.outcome, null, 0, s.max_attempts)
              else rg_stage(x.outcome, l.call_status, l.call_attempts, s.max_attempts) end,
         x.outcome, x.summary, x.notes, x.meeting_times, x.meeting_email, x.callback_at,
         x.dm_name, x.dm_title, x.opener_key, x.duration_sec, coalesce(x.ended_at, x.queued_at),
         x.attempt, x.n::int, x.is_test, x.to_number, (x.transcript is not null)
    from latest x join rg_leads l on l.id = x.lead_id, s
   order by coalesce(x.ended_at, x.queued_at) desc
   limit greatest(1, least(p_limit, 500));
end $$;

-- LIVE: calls dialed in the last 20 minutes that haven't reported back yet.
create or replace function public.rg_live_calls()
returns table(call_id uuid, lead_id uuid, conversation_id text, company text, contact_name text, to_number text,
              queued_at timestamptz, is_test boolean, opener_key text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query
  select c.id, c.lead_id, c.conversation_id, l.company, l.contacts->0->>'name', c.to_number, c.queued_at, c.is_test, c.opener_key
    from rg_calls c join rg_leads l on l.id = c.lead_id
   where c.status in ('queued', 'in_progress') and c.queued_at > now() - interval '20 minutes'
   order by c.queued_at desc;
end $$;

-- SHEET: every call to one lead, with a slim transcript (who said what, when).
create or replace function public.rg_lead_calls(p_lead uuid)
returns table(call_id uuid, outcome text, summary text, notes text, meeting_times text, meeting_email text,
              callback_at timestamptz, dm_name text, dm_title text, opener_key text, duration_sec int,
              ended_at timestamptz, attempt int, is_test boolean, transcript jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query
  select c.id, c.outcome, c.summary, c.notes, c.meeting_times, c.meeting_email, c.callback_at, c.dm_name, c.dm_title,
         c.opener_key, c.duration_sec, coalesce(c.ended_at, c.queued_at), c.attempt, c.is_test,
         (select coalesce(jsonb_agg(jsonb_build_object('role', t->>'role', 'text', t->>'message',
                                                       't', (t->>'time_in_call_secs')::int) order by ord), '[]'::jsonb)
            from jsonb_array_elements(coalesce(c.transcript, '[]'::jsonb)) with ordinality as e(t, ord)
           where coalesce(t->>'message', '') <> '')
    from rg_calls c
   where c.lead_id = p_lead and c.status not in ('queued', 'in_progress')
   order by coalesce(c.ended_at, c.queued_at) desc;
end $$;

revoke execute on function public.rg_call_queue(int), public.rg_call_board(int), public.rg_live_calls(), public.rg_lead_calls(uuid) from public, anon;
grant execute on function public.rg_call_queue(int), public.rg_call_board(int), public.rg_live_calls(), public.rg_lead_calls(uuid) to authenticated;
grant execute on function public.rg_stage(text, text, int, int) to authenticated;
