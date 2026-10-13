-- Pipeline page backend (applied 2026-10-12 in 4 parts: pipeline_part1..4) (docs/pipeline-opusplan.md). Admin-only RPCs; no public-key access.

alter table public.voice_agents add column if not exists takes_leads boolean not null default false;
update public.voice_agents set takes_leads = true where slug in ('maya','reese');

alter table public.rg_leads add column if not exists archived boolean not null default false;

-- Template agents' lead queue: ids only, no personal columns.
create table if not exists public.agent_lead_queue (
  id uuid primary key default gen_random_uuid(),
  agent_slug text not null,
  lead_table text not null check (lead_table in ('maya_leads','rg_leads')),
  lead_id uuid not null,
  status text not null default 'queued' check (status in ('queued','called','done','pulled')),
  queued_at timestamptz not null default now(),
  note text
);
create index if not exists agent_lead_queue_lead_idx on public.agent_lead_queue (lead_table, lead_id);
create index if not exists agent_lead_queue_agent_idx on public.agent_lead_queue (agent_slug, status);
alter table public.agent_lead_queue enable row level security;
revoke all on public.agent_lead_queue from anon, authenticated;

create table if not exists public.ava_errands (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  who text,
  phone text,
  details text,
  due_by date,
  status text not null default 'open' check (status in ('open','calling','done','cancelled')),
  last_call_id text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.ava_errands enable row level security;
revoke all on public.ava_errands from anon, authenticated;

insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled)
select 'ava_errands', 'phone', 'phone', 'delete', null, true
where not exists (select 1 from public.privacy_data_map where table_name='ava_errands' and column_name='phone');

-- One normalized row per lead across maya_leads and rg_leads. Internal: only the RPCs below read it.
create or replace view public.pipeline_all as
with hs as (select coalesce((select min_fit from public.hunter_settings where id), 50) as min_fit)
select * from (
  select 'maya_leads'::text as lead_table, m.id, coalesce(q.agent_slug, 'maya') as owner,
         m.company, m.category, m.city, m.state, m.phone, (m.phone is not null) as phone_present, m.line_type,
         m.fit_score::numeric as fit, sc.p_reach_dm as reach, sc.priority as priority,
         (ap.status = 'found') as apollo,
         case
           when m.dnc or m.status = 'opted_out' or exists (select 1 from public.hunter_optouts o where o.phone = m.phone) then 'dnc'
           when m.status = 'rejected' then 'archived'
           when m.status in ('queued','called','booked') then m.status
           when m.status = 'checked' and m.line_type = 'landline' and m.phone is not null
                and coalesce(m.fit_score,0) >= hs.min_fit then 'qualified'
           else 'new' end as status,
         m.created_at as found_at,
         case when m.line_type = 'landline' and m.phone is not null and not m.dnc and coalesce(m.fit_score,0) >= hs.min_fit
                   and m.status <> 'opted_out' then m.fit_checked_at end as qualified_at,
         m.queued_at, m.last_called_at as called_at,
         case when m.status = 'booked' then m.updated_at end as booked_at,
         m.source, m.updated_at
    from public.maya_leads m cross join hs
    left join lateral (select s.p_reach_dm, s.priority from public.hunter_lead_scores s
                        where s.owner = 'maya' and s.lead_id = m.id order by s.scored_at desc limit 1) sc on true
    left join public.hunter_apollo_enrich ap on ap.owner = 'maya' and ap.lead_id = m.id
    left join lateral (select a.agent_slug from public.agent_lead_queue a
                        where a.lead_table = 'maya_leads' and a.lead_id = m.id and a.status = 'queued'
                        order by a.queued_at desc limit 1) q on true
  union all
  select 'rg_leads', r.id, coalesce(q.agent_slug, 'reese'),
         r.company, r.category, null::text, r.state, r.phone, (r.phone is not null), r.line_type,
         case when sc.p_fit is null then null when sc.p_fit <= 1 then round(sc.p_fit*100) else sc.p_fit end,
         sc.p_reach_dm, sc.priority, (ap.status = 'found'),
         case
           when r.archived then 'archived'
           when r.dnc or r.call_status = 'do_not_call' or exists (select 1 from public.rg_dnc d where d.phone = r.phone) then 'dnc'
           when r.call_status = 'booked' then 'booked'
           when r.call_status not in ('not_called','in_progress') or r.call_attempts > 0 then 'called'
           when r.next_call_at is not null and r.phone is not null and r.line_type in ('landline','voip') then 'queued'
           when r.phone is not null and r.line_type in ('landline','voip') then 'qualified'
           else 'new' end,
         r.created_at,
         case when r.phone is not null and r.line_type in ('landline','voip') and not r.dnc and not r.archived
              then coalesce(r.enriched_at, r.created_at) end,
         case when r.next_call_at is not null and r.next_call_at <= now() then r.next_call_at end,
         r.last_called_at,
         null::timestamptz,
         'roofguard'::text, r.updated_at
    from public.rg_leads r
    left join lateral (select s.p_reach_dm, s.priority, s.p_fit from public.hunter_lead_scores s
                        where s.owner = 'reese' and s.lead_id = r.id order by s.scored_at desc limit 1) sc on true
    left join public.hunter_apollo_enrich ap on ap.owner = 'reese' and ap.lead_id = r.id
    left join lateral (select a.agent_slug from public.agent_lead_queue a
                        where a.lead_table = 'rg_leads' and a.lead_id = r.id and a.status = 'queued'
                        order by a.queued_at desc limit 1) q on true
) x;
revoke all on public.pipeline_all from anon, authenticated;

create or replace function public.pipeline_events(p_days int default 15) returns table(day date, kind text)
language sql stable security definer set search_path = public as $$
  with tz as (select 'America/Los_Angeles'::text z)
  select (found_at at time zone z)::date, 'found' from pipeline_all, tz where found_at >= now() - make_interval(days => p_days)
  union all select (qualified_at at time zone z)::date, 'qualified' from pipeline_all, tz where qualified_at >= now() - make_interval(days => p_days)
  union all select (queued_at at time zone z)::date, 'queued' from pipeline_all, tz where queued_at >= now() - make_interval(days => p_days)
  union all select (last_called_at at time zone z)::date, 'called' from maya_leads, tz where last_called_at >= now() - make_interval(days => p_days)
  union all select (queued_at at time zone z)::date, 'called' from rg_calls, tz where direction = 'outbound' and not is_test and queued_at >= now() - make_interval(days => p_days)
  union all select (updated_at at time zone z)::date, 'booked' from maya_leads, tz where status = 'booked' and updated_at >= now() - make_interval(days => p_days)
  union all select (coalesce(ended_at, queued_at) at time zone z)::date, 'booked' from rg_calls, tz where outcome = 'booked' and not is_test and coalesce(ended_at, queued_at) >= now() - make_interval(days => p_days)
$$;
revoke all on function public.pipeline_events(int) from public, anon, authenticated;

create or replace function public.pipeline_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tz text := 'America/Los_Angeles';
  day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  today_d date := (now() at time zone 'America/Los_Angeles')::date;
  v_today jsonb; v_quality jsonb; v_funnel jsonb; v_sources jsonb; v_agents jsonb := '[]'::jsonb; v_health jsonb;
  a record; v_queued int; v_target int; v_calls int; v_out jsonb; v_next timestamptz;
  rg_cap int;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  select daily_cap into rg_cap from rg_settings where id;

  select jsonb_build_object(
      'found',     count(*) filter (where kind='found'),
      'qualified', count(*) filter (where kind='qualified'),
      'queued',    count(*) filter (where kind='queued'),
      'called',    count(*) filter (where kind='called'),
      'booked',    count(*) filter (where kind='booked'),
      'targets',   jsonb_build_object('queued', coalesce((select sum(daily_target) from hunter_campaigns where enabled), 0)))
    into v_today from pipeline_events(2) e where e.day = today_d;

  select jsonb_build_object(
      'avg_reach', coalesce(round(avg(reach)::numeric, 3), 0),
      'avg_fit',   coalesce(round(avg(fit)::numeric, 1), 0),
      'n',         count(*))
    into v_quality from pipeline_all
   where status in ('qualified','queued') and reach is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day,
           'found',     coalesce(c.f,0), 'qualified', coalesce(c.q,0), 'queued', coalesce(c.qd,0),
           'called',    coalesce(c.cl,0), 'booked', coalesce(c.b,0)) order by d.day), '[]'::jsonb)
    into v_funnel
    from (select generate_series(today_d - 13, today_d, interval '1 day')::date as day) d
    left join (select e.day,
                 count(*) filter (where kind='found') f, count(*) filter (where kind='qualified') q,
                 count(*) filter (where kind='queued') qd, count(*) filter (where kind='called') cl,
                 count(*) filter (where kind='booked') b
               from pipeline_events(15) e group by e.day) c on c.day = d.day;

  select coalesce(jsonb_agg(jsonb_build_object('source', source, 'found', f, 'qualified', q) order by f desc), '[]'::jsonb)
    into v_sources
    from (select coalesce(source,'unknown') as source, count(*) f,
                 count(*) filter (where qualified_at is not null) q
            from pipeline_all where found_at >= day_start - interval '13 days' group by 1) s;

  select jsonb_build_object('ok', coalesce(h.ok, false), 'problems', coalesce(to_jsonb(h.problems), '[]'::jsonb), 'checked_at', h.checked_at)
    into v_health from (select 1) one left join hunter_health h on h.source = 'hunter';
  if v_health is null then v_health := jsonb_build_object('ok', false, 'problems', '[]'::jsonb, 'checked_at', null); end if;

  for a in select * from voice_agents order by (slug='maya') desc, (slug='reese') desc, takes_leads desc, (slug='ava'), slug loop
    v_queued := 0; v_target := 0; v_calls := 0; v_next := null;
    v_out := jsonb_build_object('answered',0,'voicemail',0,'booked',0,'not_interested',0,'other',0);
    if a.slug = 'maya' then
      select count(*) into v_queued from maya_leads where status = 'queued';
      select coalesce(sum(daily_target),0) into v_target from hunter_campaigns where enabled and owner = 'maya';
      select count(*) into v_calls from maya_leads where last_called_at >= day_start;
      select min(next_call_at) into v_next from maya_leads where status = 'queued' and next_call_at is not null;
      select jsonb_build_object(
          'answered', (select count(*) from agent_calls where agent_slug='maya' and status='completed' and started_at >= now() - interval '7 days'),
          'voicemail', 0,
          'booked', (select count(*) from maya_leads where status='booked' and updated_at >= now() - interval '7 days'),
          'not_interested', 0,
          'other', (select count(*) from agent_calls where agent_slug='maya' and status is distinct from 'completed' and started_at >= now() - interval '7 days'))
        into v_out;
    elsif a.slug = 'reese' then
      select count(*) into v_queued from rg_leads l
       where not l.archived and l.phone is not null and l.line_type in ('landline','voip') and not l.dnc
         and l.call_status not in ('booked','not_interested','do_not_call','wrong_number','in_progress')
         and not exists (select 1 from rg_dnc d where d.phone = l.phone);
      v_target := coalesce(rg_cap, 0);
      select count(*) into v_calls from rg_calls where direction='outbound' and not is_test and queued_at >= day_start;
      select min(next_call_at) into v_next from rg_leads where next_call_at is not null and not archived
         and call_status not in ('booked','not_interested','do_not_call','wrong_number');
      select jsonb_build_object(
          'answered', count(*) filter (where outcome in ('dm_identified','callback_set','gatekeeper_blocked')),
          'voicemail', count(*) filter (where outcome = 'voicemail_left'),
          'booked', count(*) filter (where outcome = 'booked'),
          'not_interested', count(*) filter (where outcome in ('not_interested','do_not_call','wrong_number')),
          'other', count(*) filter (where outcome is null or outcome in ('no_answer','other')))
        into v_out from rg_calls where direction='outbound' and not is_test and queued_at >= now() - interval '7 days';
    elsif a.slug = 'ava' then
      select count(*) into v_queued from ava_errands where status in ('open','calling');
    else
      if a.takes_leads then
        select count(*) into v_queued from agent_lead_queue where agent_slug = a.slug and status = 'queued';
      end if;
      select count(*) into v_calls from agent_calls where agent_slug = a.slug and started_at >= day_start;
      select jsonb_build_object(
          'answered', count(*) filter (where status = 'completed'), 'voicemail', 0, 'booked', 0, 'not_interested', 0,
          'other', count(*) filter (where status is distinct from 'completed'))
        into v_out from agent_calls where agent_slug = a.slug and started_at >= now() - interval '7 days';
    end if;
    v_agents := v_agents || jsonb_build_object(
      'slug', a.slug, 'name', a.name, 'purpose', a.purpose,
      'kind', case when a.slug = 'ava' then 'errands' when a.takes_leads then 'leads' else 'support' end,
      'page_url', a.page_url, 'queued', v_queued, 'target', v_target, 'calls_today', v_calls,
      'outcomes', coalesce(v_out, '{}'::jsonb), 'next_call_at', v_next);
  end loop;

  return jsonb_build_object('today', v_today, 'quality', v_quality, 'funnel14', v_funnel,
                            'sources14', v_sources, 'agents', v_agents, 'health', v_health);
end $$;

create or replace function public.pipeline_leads(p_status text default null, p_owner text default null,
    p_q text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_total int; v_rows jsonb; st text := nullif(lower(coalesce(p_status,'')), 'all'); ow text := nullif(lower(coalesce(p_owner,'')), 'all');
        q text := nullif(trim(coalesce(p_q,'')), '');
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  select count(*) into v_total from pipeline_all p
   where (st is null or st = '' or p.status = st) and (ow is null or ow = '' or p.owner = ow)
     and (q is null or p.company ilike '%'||q||'%' or p.city ilike '%'||q||'%' or p.category ilike '%'||q||'%');
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from (
    select p.lead_table, p.id, p.owner, p.company, p.category, p.city, p.state, p.phone_present, p.line_type,
           p.fit, p.reach, p.priority, p.status, coalesce(p.apollo, false) as apollo, p.updated_at
      from pipeline_all p
     where (st is null or st = '' or p.status = st) and (ow is null or ow = '' or p.owner = ow)
       and (q is null or p.company ilike '%'||q||'%' or p.city ilike '%'||q||'%' or p.category ilike '%'||q||'%')
     order by p.priority desc nulls last, p.updated_at desc
     limit greatest(1, least(coalesce(p_limit,50), 200)) offset greatest(0, coalesce(p_offset,0))) r;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.pipeline_lead(p_table text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_owner text; v_score jsonb; v_apollo jsonb; v_calls jsonb; v_queue jsonb; v_norm jsonb;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_table = 'maya_leads' then
    select to_jsonb(m) - 'lat' - 'lon', 'maya' into v_row, v_owner from maya_leads m where m.id = p_id;
    select jsonb_build_object('attempts', m.call_attempts, 'last_called_at', m.last_called_at,
           'agent_calls', (select count(*) from agent_calls c where c.agent_slug='maya' and c.phone = m.phone))
      into v_calls from maya_leads m where m.id = p_id;
  elsif p_table = 'rg_leads' then
    select to_jsonb(r) - 'phone_candidates' - 'phone_source_url', 'reese' into v_row, v_owner from rg_leads r where r.id = p_id;
    select jsonb_build_object('attempts', r.call_attempts, 'last_called_at', r.last_called_at,
           'rg_calls', (select count(*) from rg_calls c where c.lead_id = r.id and not c.is_test),
           'by_outcome', coalesce((select jsonb_object_agg(outcome, n) from (select coalesce(outcome,'none') outcome, count(*) n from rg_calls c where c.lead_id = r.id and not c.is_test group by 1) o), '{}'::jsonb))
      into v_calls from rg_leads r where r.id = p_id;
  else raise exception 'unknown lead table'; end if;
  if v_row is null then raise exception 'no such lead'; end if;
  select to_jsonb(s) into v_score from hunter_lead_scores s where s.lead_table = p_table and s.lead_id = p_id order by s.scored_at desc limit 1;
  if v_score is null then
    select to_jsonb(s) into v_score from hunter_lead_scores s where s.owner = v_owner and s.lead_id = p_id order by s.scored_at desc limit 1;
  end if;
  select to_jsonb(a) into v_apollo from hunter_apollo_enrich a where a.owner = v_owner and a.lead_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('agent_slug', agent_slug, 'status', status, 'queued_at', queued_at, 'note', note) order by queued_at desc), '[]'::jsonb)
    into v_queue from agent_lead_queue where lead_table = p_table and lead_id = p_id;
  select jsonb_build_object('status', status, 'owner', owner, 'fit', fit, 'reach', reach, 'priority', priority)
    into v_norm from pipeline_all where lead_table = p_table and id = p_id;
  return jsonb_build_object('lead_table', p_table, 'id', p_id, 'owner', v_owner, 'pipeline', v_norm, 'lead', v_row,
                            'score', v_score, 'apollo', v_apollo, 'calls', v_calls, 'queue', v_queue);
end $$;

create or replace function public.pipeline_send(p_table text, p_id uuid, p_agent text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ag voice_agents; m maya_leads; r rg_leads; v_phone text; v_dnc boolean; v_new uuid; v_fit numeric;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  select * into ag from voice_agents where slug = p_agent;
  if ag.slug is null then raise exception 'Unknown agent "%".', p_agent; end if;
  if not ag.takes_leads then raise exception '% is not set to take leads from Pipeline.', ag.name; end if;

  if p_table = 'maya_leads' then
    select * into m from maya_leads where id = p_id for update;
    if m.id is null then raise exception 'That lead no longer exists.'; end if;
    v_phone := m.phone; v_dnc := m.dnc or m.status = 'opted_out';
  elsif p_table = 'rg_leads' then
    select * into r from rg_leads where id = p_id for update;
    if r.id is null then raise exception 'That lead no longer exists.'; end if;
    v_phone := r.phone; v_dnc := r.dnc or r.call_status = 'do_not_call';
  else raise exception 'Unknown lead table.'; end if;

  if v_phone is null or btrim(v_phone) = '' then raise exception 'This lead has no phone number, so it cannot be sent to an agent.'; end if;
  if v_dnc or exists (select 1 from hunter_optouts o where o.phone = v_phone) or exists (select 1 from rg_dnc d where d.phone = v_phone) then
    raise exception 'This lead is on the do-not-call or opted-out list and cannot be sent.';
  end if;

  if p_agent = 'maya' and p_table = 'maya_leads' then
    update maya_leads set status = 'queued', queued_at = now(), reject_reason = null where id = p_id;
    return jsonb_build_object('ok', true, 'sent_to', 'maya', 'lead_table', 'maya_leads', 'id', p_id);

  elsif p_agent = 'reese' and p_table = 'rg_leads' then
    update rg_leads set call_status = case when call_status in ('booked','not_interested','do_not_call','wrong_number') then call_status else 'not_called' end,
           next_call_at = now(), priority = greatest(priority, 90), archived = false where id = p_id;
    return jsonb_build_object('ok', true, 'sent_to', 'reese', 'lead_table', 'rg_leads', 'id', p_id);

  elsif p_agent = 'reese' and p_table = 'maya_leads' then
    select id into v_new from rg_leads where phone = m.phone limit 1;
    if v_new is null then
      insert into rg_leads (state, timezone, risk_tier, company, category, pitch, website, phone, phone_source, line_type, line_type_checked_at,
                            enrich_status, priority, call_status, next_call_at)
      values (m.state, m.timezone, 'MEDIUM', m.company, coalesce(m.category,'generic'), 'Cold call from the Pipeline page.', m.website, m.phone,
              coalesce(m.phone_source,'maya_leads'), m.line_type, m.line_type_checked_at, 'found', 90, 'not_called', now())
      returning id into v_new;
    else
      update rg_leads set call_status = case when call_status in ('booked','not_interested','do_not_call','wrong_number') then call_status else 'not_called' end,
             next_call_at = now(), priority = greatest(priority, 90), archived = false where id = v_new;
    end if;
    update maya_leads set status = 'rejected', reject_reason = 'sent to reese' where id = p_id;
    return jsonb_build_object('ok', true, 'sent_to', 'reese', 'lead_table', 'rg_leads', 'id', v_new);

  elsif p_agent = 'maya' and p_table = 'rg_leads' then
    select id into v_new from maya_leads where phone = r.phone limit 1;
    select case when p_fit <= 1 then round(p_fit*100) else p_fit end into v_fit
      from hunter_lead_scores where owner = 'reese' and lead_id = r.id order by scored_at desc limit 1;
    if v_new is null then
      insert into maya_leads (company, category, state, timezone, phone, phone_source, line_type, line_type_checked_at, website,
                              fit_score, fit_checked_at, source, status, queued_at, dnc_checked)
      values (r.company, r.category, r.state, r.timezone, r.phone, r.phone_source, r.line_type, r.line_type_checked_at, r.website,
              coalesce(v_fit::int, 50), now(), 'pipeline', 'queued', now(), true)
      returning id into v_new;
    else
      update maya_leads set status = 'queued', queued_at = now(), reject_reason = null where id = v_new;
    end if;
    update rg_leads set archived = true where id = p_id;
    return jsonb_build_object('ok', true, 'sent_to', 'maya', 'lead_table', 'maya_leads', 'id', v_new);

  else
    if exists (select 1 from agent_lead_queue where agent_slug = p_agent and lead_table = p_table and lead_id = p_id and status = 'queued') then
      raise exception 'This lead is already in %''s queue.', ag.name;
    end if;
    insert into agent_lead_queue (agent_slug, lead_table, lead_id) values (p_agent, p_table, p_id);
    return jsonb_build_object('ok', true, 'sent_to', p_agent, 'lead_table', p_table, 'id', p_id);
  end if;
end $$;

create or replace function public.pipeline_pull(p_table text, p_id uuid, p_to text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m maya_leads; r rg_leads;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_to not in ('requalify','archive','dnc') then raise exception 'Pull back must be requalify, archive or dnc.'; end if;

  if p_table = 'maya_leads' then
    select * into m from maya_leads where id = p_id for update;
    if m.id is null then raise exception 'That lead no longer exists.'; end if;
    if p_to = 'requalify' then
      update maya_leads set status = 'checked', queued_at = null, reject_reason = null where id = p_id;
    elsif p_to = 'archive' then
      update maya_leads set status = 'rejected', reject_reason = 'archived', queued_at = null where id = p_id;
    else
      update maya_leads set dnc = true, status = 'opted_out', reject_reason = 'pulled: do not call', queued_at = null where id = p_id;
      if m.phone is not null and not exists (select 1 from hunter_optouts o where o.phone = m.phone) then
        insert into hunter_optouts (phone, email, company, source_caller) values (m.phone, lower(m.email), m.company, 'pipeline');
      end if;
    end if;
  elsif p_table = 'rg_leads' then
    select * into r from rg_leads where id = p_id for update;
    if r.id is null then raise exception 'That lead no longer exists.'; end if;
    if p_to = 'requalify' then
      update rg_leads set call_status = 'not_called', next_call_at = null, archived = false where id = p_id;
    elsif p_to = 'archive' then
      update rg_leads set archived = true, next_call_at = null where id = p_id;
    else
      update rg_leads set dnc = true, next_call_at = null where id = p_id;
      if r.phone is not null and not exists (select 1 from rg_dnc d where d.phone = r.phone) then
        insert into rg_dnc (phone, lead_id, reason) values (r.phone, r.id, 'pipeline pull');
      end if;
    end if;
  else raise exception 'Unknown lead table.'; end if;

  update agent_lead_queue set status = 'pulled' where lead_table = p_table and lead_id = p_id and status = 'queued';
  return jsonb_build_object('ok', true, 'lead_table', p_table, 'id', p_id, 'pulled_to', p_to);
end $$;

create or replace function public.ava_errands_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(to_jsonb(e) order by (e.status in ('done','cancelled')), e.due_by nulls last, e.created_at desc)
                     from (select * from ava_errands order by created_at desc limit 100) e), '[]'::jsonb);
end $$;

create or replace function public.ava_errand_put(p_id uuid, p_title text, p_who text, p_phone text, p_details text, p_due_by date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ava_errands;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_title),'') = '' then raise exception 'An errand needs a title.'; end if;
  if p_id is null then
    insert into ava_errands (title, who, phone, details, due_by) values (left(btrim(p_title),200), left(p_who,200), left(p_phone,40), left(p_details,2000), p_due_by)
    returning * into e;
  else
    update ava_errands set title = left(btrim(p_title),200), who = left(p_who,200), phone = left(p_phone,40), details = left(p_details,2000), due_by = p_due_by
     where id = p_id returning * into e;
    if e.id is null then raise exception 'No such errand.'; end if;
  end if;
  return to_jsonb(e);
end $$;

create or replace function public.ava_errand_set(p_id uuid, p_status text, p_last_call_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ava_errands;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('open','calling','done','cancelled') then raise exception 'Bad errand status.'; end if;
  update ava_errands set status = p_status, last_call_id = coalesce(p_last_call_id, last_call_id),
         done_at = case when p_status = 'done' then now() else null end
   where id = p_id returning * into e;
  if e.id is null then raise exception 'No such errand.'; end if;
  return to_jsonb(e);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'pipeline_overview()', 'pipeline_leads(text,text,text,int,int)', 'pipeline_lead(text,uuid)',
    'pipeline_send(text,uuid,text)', 'pipeline_pull(text,uuid,text)', 'ava_errands_list()',
    'ava_errand_put(uuid,text,text,text,text,date)', 'ava_errand_set(uuid,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- Jev priority into Reese's dialer: scored leads (last 7 days) go first within the same call-time tier,
-- ranked by Jev priority; unscored leads keep the old priority order. Signature and every filter unchanged,
-- plus: archived leads are never dialed.
create or replace function public.rg_next_call_batch(p_limit integer default 10)
 returns table(lead_id uuid, company text, phone text, timezone text, contact_name text, contact_title text, pitch_angle text, category text, state text, attempt integer)
 language sql stable security definer set search_path to 'public'
as $function$
  with s as (select * from rg_settings where id),
  today as (select count(*) n from rg_calls where queued_at > now() - interval '24 hours' and not is_test and direction = 'outbound'),
  ever as (select count(distinct lead_id) n from rg_calls where not is_test and direction = 'outbound')
  select l.id, l.company, l.phone, l.timezone, l.contacts->0->>'name', l.contacts->0->>'title',
         l.pitch, l.category, l.state, l.call_attempts + 1
    from rg_leads l cross join s cross join today cross join ever
    left join lateral (select hs.priority from hunter_lead_scores hs
                        where hs.owner = 'reese' and hs.lead_id = l.id and hs.scored_at > now() - interval '7 days'
                        order by hs.scored_at desc limit 1) jev on true
   where s.calling_enabled
     and not l.archived
     and l.phone is not null
     and l.line_type in ('landline','voip')
     and not l.dnc
     and not exists (select 1 from rg_dnc d where d.phone = l.phone)
     and l.call_status not in ('booked','not_interested','do_not_call','wrong_number','in_progress')
     and l.call_attempts < s.max_attempts
     and case when l.next_call_at is not null then now() >= l.next_call_at - interval '10 minutes'
              else (l.last_called_at is null or rg_business_days_between(l.last_called_at, now(), l.timezone) >= s.min_gap_bdays) end
     and extract(isodow from (now() at time zone l.timezone)) < 6
     and extract(hour from (now() at time zone l.timezone)) >= s.window_start_hour
     and extract(hour from (now() at time zone l.timezone)) <  s.window_end_hour
     and not exists (select 1 from rg_holidays h where h.day = (now() at time zone l.timezone)::date)
     and today.n < s.daily_cap
     and (s.pilot_limit is null or ever.n < s.pilot_limit or exists (select 1 from rg_calls c where c.lead_id = l.id and not c.is_test and c.direction = 'outbound'))
   order by (l.next_call_at is not null) desc, l.next_call_at, jev.priority desc nulls last, l.priority desc
   limit greatest(0, least(p_limit, (select daily_cap from s) - (select n from today)));
$function$;
