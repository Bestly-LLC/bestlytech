-- Hunter Phase 1.5: what the Jev card and the score screen read, the hand-off ordering, and Reese's read-only priority list.
-- All admin RPCs are SECURITY DEFINER with team_is_admin() as the first check. Nothing here returns a phone, email or name.

-- The score screen: summary strip plus one row per scored lead that still exists. Reese's lead data is read here only for
-- company, category, state and call status; it is never copied into a Hunter table.
create or replace function public.hunter_scores_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'; out jsonb;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  with m as (
    select s.id, s.owner, s.lead_id, s.scorer, s.model, s.p_reach_dm, s.outcome_probs, s.dm_role, s.best_window, s.p_fit, s.priority,
           s.reason, s.inputs, s.latency_ms, s.scored_at, l.company, l.category, l.city as place, l.campaign_slug,
           coalesce(c.name, 'Maya') as campaign, l.status, l.line_type
      from hunter_lead_scores s
      join maya_leads l on l.id = s.lead_id and s.owner = 'maya'
      left join hunter_campaigns c on c.slug = l.campaign_slug),
  r as (
    select s.id, s.owner, s.lead_id, s.scorer, s.model, s.p_reach_dm, s.outcome_probs, s.dm_role, s.best_window, s.p_fit, s.priority,
           s.reason, s.inputs, s.latency_ms, s.scored_at, l.company, l.category, l.state as place, 'roofguard'::text as campaign_slug,
           'RoofGuard'::text as campaign,
           case when l.call_status = 'booked' then 'booked' when l.call_attempts > 0 or l.call_status <> 'not_called' then 'called' else 'queued' end as status,
           l.line_type
      from hunter_lead_scores s
      join rg_leads l on l.id = s.lead_id and s.owner = 'reese'),
  allr as (select * from m union all select * from r)
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'scored', (select count(*) from allr),
      'avg_reach', (select round(avg(p_reach_dm)::numeric, 4) from allr),
      'jev_pct', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where scorer = 'jev') / count(*)) end from allr),
      'queued_today_maya', (select count(*) from maya_leads where queued_at >= day_start),
      'queued_today_reese', (select count(*) from rg_calls where queued_at >= day_start and not is_test and direction = 'outbound')),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.priority desc, x.scored_at desc) from (select * from allr order by priority desc, scored_at desc limit 800) x), '[]'::jsonb))
  into out;
  return out;
end $$;

-- The Jev card: connected or not, last scored, scored today, average latency, estimated cost this month ($0.042 per million input tokens).
create or replace function public.hunter_jev_status() returns jsonb
language plpgsql stable security definer set search_path = public, vault as $$
declare day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
        month_start timestamptz := date_trunc('month', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
        k record; src record; st hunter_settings; tok bigint; lat bigint; calls bigint;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  select s.updated_at into k from vault.secrets s where s.name = 'jev_api_key';
  select * into src from hunter_sources where slug = 'jev';
  select * into st from hunter_settings where id;
  select coalesce(sum((detail->>'tokens_in')::bigint), 0) into tok from hunter_runs where step = 'score' and source = 'jev' and started_at >= month_start;
  select coalesce(sum((detail->>'latency_ms')::bigint), 0), coalesce(sum((detail->>'calls')::bigint), 0) into lat, calls
    from hunter_runs where step = 'score' and source = 'jev' and started_at >= now() - interval '7 days';
  return jsonb_build_object(
    'key_saved', k.updated_at is not null,
    'saved_at', k.updated_at,
    'enabled', coalesce(src.enabled, true),
    'connected', k.updated_at is not null and coalesce(src.enabled, true),
    'last_scored_at', (select max(scored_at) from hunter_lead_scores where scorer = 'jev'),
    'scored_today', (select coalesce(sum(checked), 0) from hunter_runs where step = 'score' and source = 'jev' and started_at >= day_start),
    'free_today', (select coalesce(sum(checked), 0) from hunter_runs where step = 'score' and source = 'free_ai' and started_at >= day_start),
    'avg_latency_ms', case when calls = 0 then null else round(lat::numeric / calls) end,
    'cost_month', round(tok::numeric * 0.042 / 1000000, 6),
    'tokens_month', tok,
    'fail_streak', coalesce(src.fail_streak, 0),
    'last_error', src.last_error,
    'score_cap_jev', st.score_cap_jev,
    'score_cap_free', st.score_cap_free);
end $$;

create or replace function public.hunter_score_caps_set(p_jev int default null, p_free int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s hunter_settings;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_jev is not null and (p_jev < 0 or p_jev > 5000) then raise exception 'Jev cap must be 0 to 5000'; end if;
  if p_free is not null and (p_free < 0 or p_free > 2000) then raise exception 'free AI cap must be 0 to 2000'; end if;
  update hunter_settings set score_cap_jev = coalesce(p_jev, score_cap_jev), score_cap_free = coalesce(p_free, score_cap_free), updated_at = now()
   where id returning * into s;
  return to_jsonb(s);
end $$;

-- Reese's callable leads ranked by priority, read-only. roofguard-dial is NOT changed; Phase 3 wires this in.
-- Same eligibility as rg_next_call_batch's lead filter (phone, landline or voip, not DNC, not finished), fresh scores only (under 7 days).
create or replace function public.hunter_reese_priority() returns table(lead_id uuid, priority numeric, best_window text, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hunter_worker_ok() then raise exception 'not allowed'; end if;
  return query
    select s.lead_id, s.priority, s.best_window, s.reason
      from hunter_lead_scores s join rg_leads r on r.id = s.lead_id
     where s.owner = 'reese' and s.scored_at > now() - interval '7 days'
       and r.phone is not null and r.line_type in ('landline','voip') and not r.dnc
       and not exists (select 1 from rg_dnc d where d.phone = r.phone)
       and r.call_status not in ('booked','not_interested','do_not_call','wrong_number','in_progress')
     order by s.priority desc, s.scored_at desc;
end $$;

-- Hand-off: same rules as before, but the best leads go first: Jev or free-AI priority (reach odds x fit), then the old fit score.
create or replace function public.hunter_handoff() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; s hunter_settings; have int; today int; need int; moved int; out jsonb := '[]'::jsonb;
        day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
begin
  if not public.hunter_worker_ok() then raise exception 'not allowed'; end if;
  select * into s from hunter_settings where id;
  if not coalesce(s.enabled, false) then return jsonb_build_object('paused', true); end if;
  for c in select * from hunter_campaigns where enabled and owner = 'maya' order by slug loop
    select count(*) into have  from maya_leads where campaign_slug = c.slug and status = 'queued';
    select count(*) into today from maya_leads where campaign_slug = c.slug and queued_at >= day_start;
    need := greatest(0, least(c.daily_target - have, c.daily_target - today));
    moved := 0;
    if need > 0 then
      with pick as (
        select ml.id from maya_leads ml
          left join hunter_lead_scores sc on sc.owner = 'maya' and sc.lead_id = ml.id
         where ml.campaign_slug = c.slug and ml.status = 'checked' and ml.line_type = 'landline'
           and ml.phone is not null and not ml.dnc and coalesce(ml.fit_score, 0) >= s.min_fit
           and not exists (select 1 from hunter_optouts o where o.phone = ml.phone)
         order by sc.priority desc nulls last, ml.fit_score desc, ml.created_at
         limit need for update of ml skip locked)
      update maya_leads m set status = 'queued', queued_at = now() from pick where m.id = pick.id;
      get diagnostics moved = row_count;
    end if;
    out := out || jsonb_build_object('campaign', c.slug, 'target', c.daily_target, 'had', have, 'queued_today_before', today, 'moved', moved);
  end loop;
  return jsonb_build_object('campaigns', out);
end $$;

revoke all on function public.hunter_scores_list() from public, anon;
revoke all on function public.hunter_jev_status() from public, anon;
revoke all on function public.hunter_score_caps_set(int, int) from public, anon;
revoke all on function public.hunter_reese_priority() from public, anon;
revoke all on function public.hunter_handoff() from public, anon, authenticated;
grant execute on function public.hunter_scores_list() to authenticated, service_role;
grant execute on function public.hunter_jev_status() to authenticated, service_role;
grant execute on function public.hunter_score_caps_set(int, int) to authenticated, service_role;
grant execute on function public.hunter_reese_priority() to authenticated, service_role;
grant execute on function public.hunter_handoff() to service_role;
