-- RoofGuard opener A/B test (Spark, 2026-10-04). Jared: "use all three and a/b test them ... learn from it."
--
-- Receptionist opener is fixed (gk_name_first). The decision-maker opener rotates between three variants:
--   dm_permission  "Not sure this is a fit for you, so I'll be quick. Got thirty seconds?"
--   dm_warranty    "When did your roofs last get documented maintenance? Most warranties quietly lapse without it."
--   dm_industry    "I'm calling {{industry_plural}} about one thing: {{industry_hook}}."
--
-- How it learns (rg_assign_openers):
--   1. Explore: until every active variant has 30 calls that reached a decision maker, hand out the
--      least-used variant first (balanced).
--   2. Lean in: after that, 80% of calls get the variant with the best booking rate per decision-maker
--      reached (smoothed: (booked + 1) / (reached + 2)), 20% keep exploring at random, so a variant that
--      got unlucky early can still win.
-- Measured per call (post-call data collection): dm_reached, kept_talking (the decision maker stayed past
-- the opener), and the outcome (booked = the win).

create table if not exists public.rg_openers (
  key         text primary key,
  audience    text not null check (audience in ('gatekeeper','decision_maker')),
  label       text not null,
  script      text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into public.rg_openers (key, audience, label, script) values
  ('gk_name_first', 'gatekeeper', 'Name-first',
   'Hi, it''s Ava from RoofGuard, on a recorded line. Is {{contact_name}} in today?'),
  ('dm_permission', 'decision_maker', 'Permission',
   'Hi {{contact_name}}, Ava with RoofGuard, on a recorded line. Not sure this is a fit for you, so I''ll be quick. Got thirty seconds?'),
  ('dm_warranty', 'decision_maker', 'Warranty question',
   'Hi {{contact_name}}, Ava with RoofGuard, on a recorded line. Quick question: when did your roofs last get documented maintenance? Most warranties quietly lapse without it.'),
  ('dm_industry', 'decision_maker', 'Industry hook',
   'Hi {{contact_name}}, Ava with RoofGuard, on a recorded line. I''m calling {{industry_plural}} about one thing: {{industry_hook}}. Is that something you look after?')
on conflict (key) do nothing;

alter table public.rg_openers enable row level security;
create policy rg_openers_admin on public.rg_openers for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
grant select, update on public.rg_openers to authenticated;

-- Industry wording for the dm_industry opener, one per lead category.
alter table public.rg_pitch_templates add column if not exists industry_plural text;
alter table public.rg_pitch_templates add column if not exists industry_hook text;
update public.rg_pitch_templates t set industry_plural = v.p, industry_hook = v.h
from (values
  ('hospital', 'hospitals', 'making sure a roof leak never reaches a clinical floor'),
  ('campus', 'universities', 'keeping roof leaks away from labs, libraries, and dorms'),
  ('school_district', 'school districts', 'keeping roofs from closing classrooms or surprising the budget'),
  ('government', 'city and county facilities teams', 'keeping public buildings dry on a predictable budget'),
  ('airport', 'airports', 'keeping roof leaks away from terminals and baggage systems'),
  ('manufacturing', 'manufacturers', 'keeping a roof leak from ever stopping a production line'),
  ('cold_food', 'food producers', 'keeping water away from production lines and cold storage'),
  ('pharma_cleanroom', 'pharma and lab facilities', 'keeping a roof leak from ever breaking a cleanroom'),
  ('fab', 'chip and electronics plants', 'keeping water away from cleanrooms and tools'),
  ('data_center', 'data center and network teams', 'keeping water away from live equipment'),
  ('utility', 'utilities', 'keeping control and equipment buildings sealed'),
  ('distribution', 'distribution centers', 'keeping roof leaks off inventory and conveyors'),
  ('retail', 'retail chains', 'keeping a roof leak from ever closing a store'),
  ('grocery', 'grocers', 'keeping roof leaks away from refrigerated stock and sales floors'),
  ('restaurant', 'restaurant groups', 'keeping a roof leak from closing a kitchen for the day'),
  ('casino', 'casino properties', 'keeping a leak from ever closing the gaming floor'),
  ('hotel', 'hotels and resorts', 'keeping roof leaks from taking rooms out of inventory'),
  ('senior_living', 'senior living operators', 'keeping residents'' homes dry and safe'),
  ('self_storage', 'self-storage operators', 'keeping water out of tenants'' units'),
  ('venue', 'venues', 'keeping a roof leak from canceling an event'),
  ('corporate', 'corporate facilities teams', 'keeping headquarters roofs from turning into emergencies'),
  ('generic', 'facilities teams', 'keeping roof leaks from turning into downtime')
) v(c, p, h) where t.category = v.c;

-- Per-call A/B data.
alter table public.rg_calls add column if not exists opener_key text references public.rg_openers(key);
alter table public.rg_calls add column if not exists dm_reached boolean;
alter table public.rg_calls add column if not exists kept_talking boolean;
create index if not exists rg_calls_opener_idx on public.rg_calls (opener_key);

-- Scoreboard, one row per decision-maker opener.
create or replace function public.rg_opener_scores()
returns table (key text, label text, active boolean, calls int, reached int, kept_talking int, booked int, book_rate numeric, score numeric)
language sql stable security definer set search_path = public as $$
  select o.key, o.label, o.active,
         count(c.id)::int,
         count(c.id) filter (where c.dm_reached)::int,
         count(c.id) filter (where c.dm_reached and c.kept_talking)::int,
         count(c.id) filter (where c.outcome = 'booked')::int,
         round(100.0 * count(c.id) filter (where c.outcome = 'booked') / nullif(count(c.id) filter (where c.dm_reached), 0), 1),
         (count(c.id) filter (where c.outcome = 'booked') + 1.0) / (count(c.id) filter (where c.dm_reached) + 2.0)
    from rg_openers o left join rg_calls c on c.opener_key = o.key
   where o.audience = 'decision_maker'
   group by o.key, o.label, o.active
   order by o.key;
$$;
revoke execute on function public.rg_opener_scores() from public, anon, authenticated;

-- Hand out openers for the next p_n calls: balanced while exploring, then 80% best / 20% random.
create or replace function public.rg_assign_openers(p_n int)
returns setof text language plpgsql volatile security definer set search_path = public as $$
declare
  v_keys text[];
  v_counts int[];
  v_best text;
  v_explore boolean;
  i int;
  j int;
  k int;
begin
  select array_agg(key order by reached, random()), array_agg(reached order by reached, random()),
         bool_or(reached < 30)
    into v_keys, v_counts, v_explore
    from rg_opener_scores() where active;
  if v_keys is null then return; end if;
  select key into v_best from rg_opener_scores() where active order by score desc, random() limit 1;

  for i in 1..greatest(0, p_n) loop
    if v_explore then
      -- least-reached first, counting what this batch already handed out
      k := 1;
      for j in 2..array_length(v_keys, 1) loop
        if v_counts[j] < v_counts[k] then k := j; end if;
      end loop;
      v_counts[k] := v_counts[k] + 1;
      return next v_keys[k];
    elsif random() < 0.2 then
      return next v_keys[1 + floor(random() * array_length(v_keys, 1))::int];
    else
      return next v_best;
    end if;
  end loop;
end $$;
revoke execute on function public.rg_assign_openers(int) from public, anon, authenticated;

-- The industry words the dm_industry opener needs, per lead (the dialer passes them as dynamic variables).
create or replace function public.rg_lead_opener_vars(p_lead uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('industry_plural', coalesce(t.industry_plural, 'facilities teams'),
                            'industry_hook',   coalesce(t.industry_hook, 'keeping roof leaks from turning into downtime'))
    from rg_leads l left join rg_pitch_templates t on t.category = l.category where l.id = p_lead;
$$;
revoke execute on function public.rg_lead_opener_vars(uuid) from public, anon, authenticated;

-- Post-call write path with the A/B fields. Closes the call row the dialer queued for this lead
-- (no conversation id yet) instead of adding a second row; otherwise upserts by conversation id.
create or replace function public.rg_log_call(
  p_conversation_id text, p_lead_id uuid, p_to_number text, p_status text, p_outcome text,
  p_summary text default null, p_duration_sec int default null, p_meeting_times text default null,
  p_meeting_email text default null, p_callback_at timestamptz default null, p_dm_name text default null,
  p_dm_title text default null, p_notes text default null, p_transcript jsonb default null, p_recording_url text default null,
  p_opener_key text default null, p_dm_reached boolean default null, p_kept_talking boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_call rg_calls;
  v_lead rg_leads;
  v_outcome text := coalesce(p_outcome, 'other');
  v_opener text := (select key from rg_openers where key = p_opener_key);
begin
  select * into v_lead from rg_leads where id = p_lead_id;
  if v_lead.id is null then raise exception 'rg_log_call: unknown lead %', p_lead_id; end if;

  update rg_calls set conversation_id = p_conversation_id, status = p_status, outcome = v_outcome, summary = p_summary,
         duration_sec = p_duration_sec, meeting_times = p_meeting_times, meeting_email = p_meeting_email,
         callback_at = p_callback_at, dm_name = p_dm_name, dm_title = p_dm_title, notes = p_notes,
         transcript = p_transcript, recording_url = p_recording_url, ended_at = now(),
         opener_key = coalesce(v_opener, opener_key), dm_reached = p_dm_reached, kept_talking = p_kept_talking
   where id = (select id from rg_calls where lead_id = p_lead_id and conversation_id is null
                 and status in ('queued','in_progress') order by queued_at desc limit 1)
  returning * into v_call;

  if v_call.id is null then
    insert into rg_calls (lead_id, attempt, to_number, conversation_id, status, outcome, summary, duration_sec,
                          meeting_times, meeting_email, callback_at, dm_name, dm_title, notes, transcript, recording_url,
                          ended_at, opener_key, dm_reached, kept_talking)
    values (p_lead_id, v_lead.call_attempts + 1, p_to_number, p_conversation_id, p_status, v_outcome, p_summary, p_duration_sec,
            p_meeting_times, p_meeting_email, p_callback_at, p_dm_name, p_dm_title, p_notes, p_transcript, p_recording_url,
            now(), v_opener, p_dm_reached, p_kept_talking)
    on conflict (conversation_id) do update set
      status = excluded.status, outcome = excluded.outcome, summary = excluded.summary, duration_sec = excluded.duration_sec,
      meeting_times = excluded.meeting_times, meeting_email = excluded.meeting_email, callback_at = excluded.callback_at,
      dm_name = excluded.dm_name, dm_title = excluded.dm_title, notes = excluded.notes, transcript = excluded.transcript,
      recording_url = excluded.recording_url, ended_at = now(), opener_key = coalesce(excluded.opener_key, rg_calls.opener_key),
      dm_reached = excluded.dm_reached, kept_talking = excluded.kept_talking
    returning * into v_call;
  end if;

  update rg_leads set
    call_attempts  = greatest(call_attempts, v_call.attempt),
    last_called_at = now(),
    call_status    = case v_outcome
                       when 'booked' then 'booked' when 'not_interested' then 'not_interested'
                       when 'do_not_call' then 'do_not_call' when 'wrong_number' then 'wrong_number'
                       when 'callback_set' then 'callback_set' else 'attempted' end,
    dnc            = dnc or v_outcome = 'do_not_call'
  where id = p_lead_id;

  if v_outcome = 'do_not_call' then
    insert into rg_dnc (phone, lead_id, reason) values (p_to_number, p_lead_id, 'requested on call')
    on conflict (phone) do nothing;
  end if;

  if v_outcome = 'booked' then
    perform scout_notify(
      'RoofGuard: meeting requested with ' || v_lead.company,
      coalesce(p_dm_name, 'Decision maker') || coalesce(', ' || p_dm_title, '') || ' wants a call with Eli. Times: '
        || coalesce(p_meeting_times, 'not given') || '. Email: ' || coalesce(p_meeting_email, 'not given') || '.',
      'info', true, '/admin/roofguard', 'roofguard-booked-' || coalesce(p_conversation_id, v_call.id::text));
  end if;

  return jsonb_build_object('ok', true, 'call_id', v_call.id, 'outcome', v_outcome, 'opener', v_call.opener_key);
end $$;
revoke execute on function public.rg_log_call(text, uuid, text, text, text, text, int, text, text, timestamptz, text, text, text, jsonb, text, text, boolean, boolean)
  from public, anon, authenticated;

-- Keep the older entry point working by routing it through the new one.
create or replace function public.rg_record_call(
  p_conversation_id text, p_lead_id uuid, p_to_number text, p_status text, p_outcome text,
  p_summary text default null, p_duration_sec int default null, p_meeting_times text default null,
  p_meeting_email text default null, p_callback_at timestamptz default null, p_dm_name text default null,
  p_dm_title text default null, p_notes text default null, p_transcript jsonb default null, p_recording_url text default null)
returns jsonb language sql security definer set search_path = public as $$
  select rg_log_call(p_conversation_id, p_lead_id, p_to_number, p_status, p_outcome, p_summary, p_duration_sec,
                     p_meeting_times, p_meeting_email, p_callback_at, p_dm_name, p_dm_title, p_notes, p_transcript, p_recording_url);
$$;

-- Admin page summary now includes the opener scoreboard.
create or replace function public.rg_call_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'settings',     (select to_jsonb(s) - 'id' from rg_settings s where id),
    'unverified',   (select count(*) from rg_leads where phone is not null and line_type = 'unverified'),
    'dialable',     (select count(*) from rg_leads where phone is not null and line_type in ('landline','voip') and not dnc),
    'calls_total',  (select count(*) from rg_calls),
    'calls_24h',    (select count(*) from rg_calls where queued_at > now() - interval '24 hours'),
    'by_outcome',   (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (select outcome, count(*) n from rg_calls where outcome is not null group by 1) o),
    'booked',       (select count(*) from rg_leads where call_status = 'booked'),
    'dnc',          (select count(*) from rg_dnc),
    'openers',      (select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('script', r.script)), '[]'::jsonb)
                       from rg_opener_scores() o join rg_openers r on r.key = o.key),
    'open_issue',   (select to_jsonb(i) from (select key, title, body, opened_at from monitor_issues where key = 'roofguard.caller' and status = 'open') i)
  );
end $$;
