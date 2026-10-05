-- Jared, 2026-10-04: test calls belong to personal Ava, not RoofGuard.
-- 1) Copy every RoofGuard test call (Gerry, Eli, Mom, Jared) into ava_calls, with its AI cost.
-- 2) Mark the originals moved (kept for history, not deleted) and hide them from RoofGuard's
--    board, lead history, stats and spend. Recordings keep working: both functions fetch audio
--    by ElevenLabs conversation id.

alter table public.rg_calls add column if not exists moved_to_ava_at timestamptz;

insert into public.ava_calls (direction, phone, contact_id, caller_name, purpose, conversation_id, status,
                              summary, duration_sec, transcript, read_at, created_at, ended_at)
select 'outbound', c.to_number, ac.id,
       coalesce(ac.name, case c.to_number
         when '+18172919827' then 'Gerry'
         when '+18165883683' then 'Eli'
         when '+18165007236' then 'Jared'
         else null end),
       case when c.lead_id = s.personal_lead_id then 'Personal test call'
            else 'RoofGuard pitch test (role-play)' end,
       c.conversation_id,
       case when c.status in ('queued','in_progress','completed','failed') then c.status else 'completed' end,
       c.summary, c.duration_sec, c.transcript, now(), c.queued_at, c.ended_at
from public.rg_calls c
cross join (select personal_lead_id from public.rg_settings limit 1) s
left join public.ava_contacts ac on ac.phone = c.to_number
where c.is_test and c.moved_to_ava_at is null
on conflict (conversation_id) do nothing;

-- AI cost = RoofGuard's per-call cost minus its voice and phone minutes.
update public.ava_calls a
   set llm_cost = round(greatest(0, public.rg_call_cost(c, s)
                    - coalesce(c.duration_sec, 0) / 60.0 * s.cost_voice_per_min
                    - ceil(coalesce(c.duration_sec, 0) / 60.0) * s.cost_phone_per_min), 4)
  from public.rg_calls c, public.rg_settings s
 where s.id and c.conversation_id = a.conversation_id and c.is_test and a.llm_cost is null;

update public.rg_calls set moved_to_ava_at = now() where is_test and moved_to_ava_at is null;

create or replace function public.rg_call_board(p_limit integer default 100)
 returns table(call_id uuid, lead_id uuid, company text, state text, timezone text, stage text, outcome text, summary text, notes text, meeting_times text, meeting_email text, callback_at timestamptz, dm_name text, dm_title text, opener_key text, duration_sec integer, ended_at timestamptz, attempt integer, calls integer, is_test boolean, to_number text, has_transcript boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query
  with s as (select * from rg_settings where id),
  latest as (
    select distinct on (c.lead_id, c.is_test) c.*,
           count(*) over (partition by c.lead_id, c.is_test) as n
      from rg_calls c
     where c.status not in ('queued', 'in_progress') and c.moved_to_ava_at is null
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
end $function$;

create or replace function public.rg_lead_calls(p_lead uuid)
 returns table(call_id uuid, outcome text, summary text, notes text, meeting_times text, meeting_email text, callback_at timestamptz, dm_name text, dm_title text, opener_key text, duration_sec integer, ended_at timestamptz, attempt integer, is_test boolean, transcript jsonb)
 language plpgsql stable security definer set search_path to 'public'
as $function$
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
   where c.lead_id = p_lead and c.status not in ('queued', 'in_progress') and c.moved_to_ava_at is null
   order by coalesce(c.ended_at, c.queued_at) desc;
end $function$;

create or replace function public.rg_call_stats()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'settings',     (select to_jsonb(s) - 'id' from rg_settings s where id),
    'keys',         rg_secret_status(),
    'unverified',   (select count(*) from rg_leads where phone is not null and line_type = 'unverified'),
    'dialable',     (select count(*) from rg_leads where phone is not null and line_type in ('landline','voip') and not dnc),
    'mobile',       (select count(*) from rg_leads where line_type = 'mobile'),
    'calls_total',  (select count(*) from rg_calls where not is_test),
    'test_calls',   (select count(*) from rg_calls where is_test and moved_to_ava_at is null),
    'calls_24h',    (select count(*) from rg_calls where queued_at > now() - interval '24 hours' and not is_test),
    'by_outcome',   (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (select outcome, count(*) n from rg_calls where outcome is not null and not is_test group by 1) o),
    'booked',       (select count(*) from rg_leads where call_status = 'booked'),
    'callbacks_due',(select count(*) from rg_leads where next_call_at is not null and call_status = 'callback_set'),
    'dnc',          (select count(*) from rg_dnc),
    'openers',      (select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('script', r.script)), '[]'::jsonb)
                       from rg_opener_scores() o join rg_openers r on r.key = o.key),
    'open_issue',   (select to_jsonb(i) from (select key, title, body, opened_at from monitor_issues where key = 'roofguard.caller' and status = 'open') i)
  );
end $function$;

create or replace function public.rg_costs()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare s rg_settings; v_months int; v jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  select * into s from rg_settings where id;
  v_months := 1 + (extract(year from age(now(), s.number_bought_on)) * 12 + extract(month from age(now(), s.number_bought_on)))::int;
  with c as (
    select x.*, rg_call_cost(x, s) cost, (x.queued_at at time zone 'America/Los_Angeles')::date d
      from rg_calls x where x.moved_to_ava_at is null
  )
  select jsonb_build_object(
    'calls_total', round(coalesce(sum(cost), 0), 2),
    'today', round(coalesce(sum(cost) filter (where d = (now() at time zone 'America/Los_Angeles')::date), 0), 2),
    'month', round(coalesce(sum(cost) filter (where date_trunc('month', d) = date_trunc('month', (now() at time zone 'America/Los_Angeles')::date)), 0), 2),
    'minutes', round(coalesce(sum(duration_sec), 0) / 60.0, 1),
    'calls', count(*),
    'voice', round(coalesce(sum(coalesce(duration_sec, 0)), 0) / 60.0 * s.cost_voice_per_min, 2),
    'phone', round(coalesce(sum(ceil(coalesce(duration_sec, 0) / 60.0)), 0) * s.cost_phone_per_min, 2),
    'ai', round(coalesce(sum(cost), 0) - coalesce(sum(coalesce(duration_sec, 0)), 0) / 60.0 * s.cost_voice_per_min
                - coalesce(sum(ceil(coalesce(duration_sec, 0) / 60.0)), 0) * s.cost_phone_per_min, 2),
    'number', s.cost_number_monthly * (v_months + 1),
    'per_meeting', (select round((coalesce(sum(cost), 0) + s.cost_number_monthly * (v_months + 1)) / nullif(count(*) filter (where outcome = 'booked' and not is_test), 0), 2) from c),
    'rates', jsonb_build_object('voice_per_min', s.cost_voice_per_min, 'phone_per_min', s.cost_phone_per_min, 'number_monthly', s.cost_number_monthly))
  into v from c;
  return v || jsonb_build_object('total', round((v->>'calls_total')::numeric + (v->>'number')::numeric, 2));
end $function$;
