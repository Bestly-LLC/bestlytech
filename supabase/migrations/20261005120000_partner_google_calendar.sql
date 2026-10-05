-- Eli's Google Calendar: Ava books a meeting -> two events on his calendar (the meeting with a Meet link, and a private prep brief).
-- Edge function: supabase/functions/partner-google. Setup + design: docs/eli-google-booking.md.
--
-- 1. partner_google        one row per connected partner; the refresh token itself lives in Vault, never in this table.
-- 2. partner_google_status the only thing the browser reads (no secret name, no error text).
-- 3. rg_calls.cal_*        make booking idempotent: re-booking updates the same two events instead of making new ones.
-- 4. rg_ava_kpis           booked_list now carries the call id and where the meeting landed on the calendar.
-- 5. notification_owners   'rg:booking' alerts belong to roofguard-outreach.

create table if not exists public.partner_google (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  email            text,
  vault_secret_name text not null,
  scope            text,
  connected_at     timestamptz not null default now(),
  last_ok_at       timestamptz,
  last_error       text,
  needs_reconnect  boolean not null default false
);
alter table public.partner_google enable row level security;

drop policy if exists partner_google_own_read on public.partner_google;
create policy partner_google_own_read on public.partner_google
  for select to authenticated using (user_id = auth.uid());
drop policy if exists partner_google_admin_read on public.partner_google;
create policy partner_google_admin_read on public.partner_google
  for select to authenticated using (public.team_is_admin());

-- Column-level: a signed-in user can never read vault_secret_name or last_error, even from their own row.
revoke all on public.partner_google from anon, authenticated;
grant select (user_id, email, scope, connected_at, last_ok_at, needs_reconnect) on public.partner_google to authenticated;

create or replace function public.partner_google_status()
returns table (connected boolean, email text, needs_reconnect boolean, last_ok_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select (g.user_id is not null), g.email, coalesce(g.needs_reconnect, false), g.last_ok_at
    from (select 1) x
    left join public.partner_google g on g.user_id = auth.uid()
$$;
revoke all on function public.partner_google_status() from public, anon;
grant execute on function public.partner_google_status() to authenticated;

-- Vault access for the edge function only (service role). The refresh token is stored as partner_google_refresh_<user_id>.
create or replace function public.partner_google_vault_put(p_name text, p_secret text)
returns void language plpgsql security definer set search_path to 'public','vault' as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_secret, p_name, 'Partner Google Calendar refresh token');
  else
    perform vault.update_secret(v_id, p_secret, p_name, 'Partner Google Calendar refresh token');
  end if;
end $$;

create or replace function public.partner_google_vault_get(p_name text)
returns text language sql security definer set search_path to 'public','vault' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

create or replace function public.partner_google_vault_delete(p_name text)
returns void language sql security definer set search_path to 'public','vault' as $$
  delete from vault.secrets where name = p_name;
$$;

revoke all on function public.partner_google_vault_put(text, text)    from public, anon, authenticated;
revoke all on function public.partner_google_vault_get(text)          from public, anon, authenticated;
revoke all on function public.partner_google_vault_delete(text)       from public, anon, authenticated;
grant execute on function public.partner_google_vault_put(text, text) to service_role;
grant execute on function public.partner_google_vault_get(text)       to service_role;
grant execute on function public.partner_google_vault_delete(text)    to service_role;

-- Where each booked call landed on Eli's calendar.
alter table public.rg_calls
  add column if not exists cal_event_id      text,
  add column if not exists cal_prep_event_id text,
  add column if not exists cal_meet_url      text,
  add column if not exists cal_start_at      timestamptz,
  add column if not exists cal_booked_by     uuid,
  add column if not exists cal_error         text;

-- The alert family has an owner (see 20261005030000_notification_owners.sql).
insert into public.notification_owners (prefix, agent_slug, note)
values ('rg:booking', 'roofguard-outreach', 'Google Calendar booking for Eli')
on conflict (prefix) do nothing;

-- rg_ava_kpis: ONLY the booked_list part changed (adds call_id, lead_id, cal_event_id, cal_meet_url, cal_start_at, timezone).
CREATE OR REPLACE FUNCTION public.rg_ava_kpis(p_weeks integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s rg_settings;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_wk date := date_trunc('week', now() at time zone 'America/Los_Angeles')::date;
  v_hour int := extract(hour from now() at time zone 'America/Los_Angeles');
  v_rate numeric; v_dials_all int; v_booked_all int;
  v_week jsonb; v_day jsonb; v_hist jsonb; v_booked_list jsonb; v_quality jsonb;
  v_booked_wk int; v_days_left int; v_need_rate_daily int; v_need_rest int; v_projected numeric;
  v_live_weeks int; v_last2 numeric; v_status text; v_hire text;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'partner') or auth.uid() is null) then
    raise exception 'Not allowed';
  end if;
  select * into s from rg_settings where id;

  select count(*), count(*) filter (where booked) into v_dials_all, v_booked_all from rg_ava_calls();
  v_rate := (v_booked_all + s.loa_prior_rate * s.loa_prior_weight) / (v_dials_all + s.loa_prior_weight);

  select jsonb_build_object('dials', count(*), 'connects', count(*) filter (where connected), 'dms', count(*) filter (where dm),
                            'pitches', count(*) filter (where pitched), 'booked', count(*) filter (where booked),
                            'voicemails', count(*) filter (where outcome = 'voicemail_left'),
                            'callbacks', count(*) filter (where outcome = 'callback_set'),
                            'not_interested', count(*) filter (where outcome = 'not_interested'),
                            'dnc', count(*) filter (where outcome = 'do_not_call'))
    into v_week from rg_ava_calls() where wk = v_wk;
  select jsonb_build_object('dials', count(*), 'connects', count(*) filter (where connected), 'dms', count(*) filter (where dm),
                            'pitches', count(*) filter (where pitched), 'booked', count(*) filter (where booked))
    into v_day from rg_ava_calls() where day = v_today;

  select coalesce(jsonb_agg(jsonb_build_object('week', w.wk, 'dials', coalesce(x.dials, 0), 'connects', coalesce(x.connects, 0),
                                               'dms', coalesce(x.dms, 0), 'pitches', coalesce(x.pitches, 0), 'booked', coalesce(x.booked, 0))
                            order by w.wk), '[]'::jsonb)
    into v_hist
    from (select (v_wk - (g * 7))::date as wk from generate_series(0, greatest(p_weeks, 1) - 1) g) w
    left join (select wk, count(*) dials, count(*) filter (where connected) connects, count(*) filter (where dm) dms,
                      count(*) filter (where pitched) pitches, count(*) filter (where booked) booked
                 from rg_ava_calls() group by wk) x on x.wk = w.wk;

  select jsonb_build_object(
           'reply_sec', round(percentile_cont(0.5) within group (order by (t->'conversation_turn_metrics'->'metrics'->'convai_ttf_audio_since_silence'->>'elapsed_time')::numeric)::numeric, 2),
           'calls_measured', count(distinct c.id))
    into v_quality
    from rg_calls c, jsonb_array_elements(coalesce(c.transcript, '[]'::jsonb)) t
   where c.queued_at > now() - interval '7 days' and t->>'role' = 'agent'
     and (t->>'time_in_call_secs')::numeric > 0
     and t->>'llm_override' is null
     and t->'conversation_turn_metrics'->'metrics'->'convai_ttf_audio_since_silence' is not null;
  v_quality := v_quality || jsonb_build_object(
    'avg_call_sec', (select round(avg(duration_sec)) from rg_ava_calls() where wk = v_wk and connected),
    'optout_rate', (select round(100.0 * count(*) filter (where outcome = 'do_not_call') / nullif(count(*) filter (where connected), 0), 1)
                      from rg_ava_calls() where at > now() - interval '28 days'));

  select coalesce(jsonb_agg(jsonb_build_object('company', l.company, 'dm_name', c.dm_name, 'dm_title', c.dm_title,
                                               'meeting_times', c.meeting_times, 'meeting_email', c.meeting_email,
                                               'booked_at', coalesce(c.ended_at, c.queued_at), 'state', l.state,
                                               'call_id', c.id, 'lead_id', c.lead_id, 'cal_event_id', c.cal_event_id,
                                               'cal_meet_url', c.cal_meet_url, 'cal_start_at', c.cal_start_at, 'timezone', l.timezone)
                            order by coalesce(c.ended_at, c.queued_at) desc), '[]'::jsonb)
    into v_booked_list
    from rg_calls c join rg_leads l on l.id = c.lead_id
   where c.outcome = 'booked' and not c.is_test and c.queued_at > now() - interval '30 days'
     and c.lead_id is distinct from s.demo_lead_id;

  v_booked_wk := (v_week->>'booked')::int;
  select count(*) into v_days_left from generate_series(v_today, v_wk + (s.work_days - 1), interval '1 day') d
   where extract(isodow from d) <= s.work_days and not (d::date = v_today and v_hour >= 17);
  v_need_rate_daily := ceil(s.weekly_goal / (s.work_days * v_rate));
  v_need_rest := ceil(greatest(0, s.weekly_goal - v_booked_wk) / v_rate);
  v_projected := v_booked_wk + v_rate * least(s.daily_cap, greatest(v_need_rate_daily, 0)) * v_days_left
                 * case when s.calling_enabled then 1 else 0 end;

  v_status := case
    when v_booked_wk >= s.weekly_goal then 'hit'
    when not s.calling_enabled then 'off'
    when v_projected >= s.weekly_goal then 'on_track'
    when v_projected >= s.weekly_goal * 0.66 then 'behind'
    else 'at_risk' end;

  select count(*) into v_live_weeks from (select wk from rg_ava_calls() where wk < v_wk group by wk having count(*) >= 20) z;
  select avg(b) into v_last2 from (select count(*) filter (where booked) b from rg_ava_calls() where wk < v_wk
                                    group by wk having count(*) >= 20 order by wk desc limit 2) z;
  v_hire := case when v_live_weeks < 2 then 'ramping'
                 when v_last2 >= s.weekly_goal then 'retained'
                 when v_last2 >= s.weekly_goal * 0.66 then 'watch'
                 else 'probation' end;

  return jsonb_build_object(
    'goal', s.weekly_goal, 'work_days', s.work_days, 'calling', s.calling_enabled, 'daily_cap', s.daily_cap,
    'auto_pace', s.auto_pace, 'pilot_limit', s.pilot_limit,
    'week_start', v_wk, 'today', v_today, 'days_left', v_days_left,
    'week', v_week, 'day', v_day, 'history', v_hist, 'quality', v_quality, 'booked_list', v_booked_list,
    'loa', jsonb_build_object(
      'rate', round(v_rate, 4), 'dials_per_meeting', round(1 / v_rate), 'dials_all', v_dials_all, 'booked_all', v_booked_all,
      'prior_rate', s.loa_prior_rate, 'prior_weight', s.loa_prior_weight,
      'daily_target', v_need_rate_daily, 'weekly_target', ceil(s.weekly_goal / v_rate),
      'rest_of_week_dials', v_need_rest, 'rest_per_day', case when v_days_left > 0 then ceil(v_need_rest::numeric / v_days_left) else null end,
      'door_rate', 0.045, 'door_dials_per_meeting', 22),
    'status', v_status, 'projected', round(v_projected, 1), 'hire', v_hire, 'live_weeks', v_live_weeks, 'last2_avg', round(v_last2, 1),
    'leads_left', (select count(*) from rg_leads l where l.phone is not null and l.line_type in ('landline','voip','unverified') and not l.dnc
                     and l.call_status not in ('booked','not_interested','do_not_call','wrong_number') and l.call_attempts < s.max_attempts),
    'max_attempts', s.max_attempts);
end $function$;
