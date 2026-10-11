-- Agent layer (docs/agent-template-opusplan.md, Run 1, Phase 1). Applied live through MCP on 2026-10-10, one or two statements per call.
-- (Version 030100, not 030000: 20261011030000 is already taken by maya_portal_config.)
-- A generic registry + call log + coach tables for every TEMPLATE phone agent (Maya now). Ava and Reese stay legacy rows.
-- Additive only. All admin RPCs: SECURITY DEFINER, admin-guarded on line one, executable by authenticated only.

create table if not exists public.voice_agents (
  slug text primary key check (slug ~ '^[a-z][a-z0-9-]{1,31}$'),
  name text not null,
  purpose text not null default 'Bestly',
  kind text not null default 'template' check (kind in ('legacy','template')),
  page_url text,
  elevenlabs_agent_id text,
  phone_number_id text,
  line_e164 text,
  voice_id text,
  llm text,
  orb_hue int not null default 20 check (orb_hue between 0 and 359),
  status text not null default 'draft' check (status in ('draft','live','paused')),
  modules text[] not null default '{}',
  settings jsonb not null default '{"cost_per_min":0.12,"daily_cap":10,"coach_on":true,"watch":null}'::jsonb,
  tool_ids text[] not null default '{}',
  webhook_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.voice_agents enable row level security;
create policy voice_agents_admin on public.voice_agents for all to authenticated using (public.team_is_admin()) with check (public.team_is_admin());

insert into public.voice_agents (slug, name, purpose, kind, page_url, status, orb_hue, modules, line_e164) values
 ('ava','Ava','Personal','legacy','/admin/ava','live',20,'{}','+18164299495'),
 ('reese','Reese','RoofGuard','legacy','/admin/roofguard','live',20,'{}',null)
on conflict (slug) do nothing;

insert into public.voice_agents (slug, name, purpose, kind, page_url, elevenlabs_agent_id, phone_number_id, line_e164, voice_id, llm, orb_hue, status, modules, tool_ids, settings) values
 ('maya','Maya','Bestly','template','/admin/maya','agent_3701m4jbjnyef6ga4ys73xtbz37s','phnum_2501m4jea1d1enjt3tkyq4nps914','+12136410074','cjVigY5qzO86Huf0OWal','qwen35-397b-a17b',200,'live',
  '{tickets,privacy,calls,coach,voice,knowledge,spend}',
  '{tool_7901m4m0e2dvf0x9y469gf3cb4zn,tool_0901m4m3jga1fr99d0sv8kxr5saw,tool_9701m4m3jjxpf2jsf44rh3tt858x,tool_3201m4m3jnjffkd9rd6tp7hsmqbd,tool_5801m4m3jradf2nvg595bypbcv89,tool_8901m4m3jtvwfdb82kta0c5jmsv8,tool_3101m4m3jx58f4s9cdq89qavw7av}',
  '{"cost_per_min":0.12,"daily_cap":10,"coach_on":true,"watch":"maya-watch"}'::jsonb)
on conflict (slug) do nothing;

create table if not exists public.agent_calls (
  id uuid primary key default gen_random_uuid(),
  agent_slug text not null references public.voice_agents(slug),
  call_no int,
  conversation_id text not null unique,
  direction text not null default 'inbound' check (direction in ('inbound','outbound','web')),
  phone text,
  caller_name text,
  started_at timestamptz,
  duration_secs int,
  status text,
  summary text,
  title text,
  transcript jsonb,
  data jsonb,
  cost numeric,
  has_audio boolean not null default false,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists agent_calls_agent_started_idx on public.agent_calls (agent_slug, started_at desc);
create unique index if not exists agent_calls_agent_no_idx on public.agent_calls (agent_slug, call_no);
alter table public.agent_calls enable row level security;
create policy agent_calls_admin on public.agent_calls for all to authenticated using (public.team_is_admin()) with check (public.team_is_admin());

create or replace function public.agent_calls_number() returns trigger language plpgsql set search_path to 'public' as $f$
begin
  if new.call_no is null then
    perform pg_advisory_xact_lock(hashtext('agent_calls:' || new.agent_slug));
    select coalesce(max(call_no), 0) + 1 into new.call_no from agent_calls where agent_slug = new.agent_slug;
  end if;
  return new;
end $f$;
create trigger agent_calls_number_trg before insert on public.agent_calls for each row execute function public.agent_calls_number();
revoke all on function public.agent_calls_number() from public, anon, authenticated;

create table if not exists public.agent_reviews (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.agent_calls(id) on delete cascade,
  agent_slug text not null references public.voice_agents(slug),
  score int not null check (score between 0 and 10),
  went_well text,
  fix text,
  model text,
  created_at timestamptz not null default now(),
  unique (call_id)
);
create table if not exists public.agent_playbook (
  id uuid primary key default gen_random_uuid(),
  agent_slug text not null references public.voice_agents(slug),
  line text not null,
  why text,
  status text not null default 'proposed' check (status in ('proposed','on','off')),
  source_call_id uuid references public.agent_calls(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create table if not exists public.agent_health (
  agent_slug text primary key references public.voice_agents(slug),
  ok boolean not null default true,
  problems jsonb not null default '[]'::jsonb,
  healed boolean not null default false,
  checked_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_sync_at timestamptz
);
alter table public.agent_reviews enable row level security;
alter table public.agent_playbook enable row level security;
alter table public.agent_health enable row level security;
create policy agent_reviews_admin on public.agent_reviews for all to authenticated using (public.team_is_admin()) with check (public.team_is_admin());
create policy agent_playbook_admin on public.agent_playbook for all to authenticated using (public.team_is_admin()) with check (public.team_is_admin());
create policy agent_health_admin on public.agent_health for select to authenticated using (public.team_is_admin());

-- Vera (Privacy Clerk): the call log is removed with the caller's phone number.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled) values
 ('agent_calls','phone','phone','delete','Call log for the person; removed with their phone number',true)
on conflict (table_name, column_name) do nothing;

-- ---------- admin RPCs ----------

create or replace function public.admin_agents() returns jsonb language plpgsql security definer set search_path to 'public' as $f$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'slug', a.slug, 'name', a.name, 'purpose', a.purpose, 'kind', a.kind, 'page_url', a.page_url, 'status', a.status,
      'orb_hue', a.orb_hue, 'line_e164', a.line_e164,
      'unread', (select count(*) from agent_calls c where c.agent_slug = a.slug and c.read_at is null and c.archived_at is null))
    order by case a.slug when 'ava' then 0 when 'maya' then 1 when 'reese' then 2 else 3 end, a.created_at)
    from voice_agents a), '[]'::jsonb);
end $f$;

create or replace function public.admin_agent(p_slug text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare a voice_agents; h agent_health; lc record;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into a from voice_agents where slug = p_slug;
  if not found then raise exception 'no such agent'; end if;
  select * into h from agent_health where agent_slug = p_slug;
  select call_no, started_at into lc from agent_calls where agent_slug = p_slug order by started_at desc nulls last limit 1;
  return (to_jsonb(a) - 'webhook_id') || jsonb_build_object(
    'webhook', a.webhook_id is not null,
    'health', case when h.agent_slug is null then null else to_jsonb(h) end,
    'last_call_no', lc.call_no, 'last_call_at', lc.started_at,
    'calls_total', (select count(*) from agent_calls where agent_slug = p_slug),
    'unread', (select count(*) from agent_calls where agent_slug = p_slug and read_at is null and archived_at is null));
end $f$;

create or replace function public.admin_agent_set(p_slug text, p_patch jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare a voice_agents; st jsonb; v numeric;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into a from voice_agents where slug = p_slug;
  if not found then raise exception 'no such agent'; end if;
  if a.kind <> 'template' then raise exception 'legacy agents are edited on their own page'; end if;
  st := coalesce(a.settings, '{}'::jsonb);
  if p_patch ? 'name' then
    if length(btrim(p_patch->>'name')) not between 1 and 40 then raise exception 'name must be 1 to 40 characters'; end if;
    a.name := btrim(p_patch->>'name');
  end if;
  if p_patch ? 'purpose' then
    if length(btrim(p_patch->>'purpose')) not between 1 and 40 then raise exception 'purpose must be 1 to 40 characters'; end if;
    a.purpose := btrim(p_patch->>'purpose');
  end if;
  if p_patch ? 'orb_hue' then
    if (p_patch->>'orb_hue')::int not between 0 and 359 then raise exception 'orb_hue must be 0 to 359'; end if;
    a.orb_hue := (p_patch->>'orb_hue')::int;
  end if;
  if p_patch ? 'status' then
    if p_patch->>'status' not in ('draft','live','paused') then raise exception 'bad status'; end if;
    a.status := p_patch->>'status';
  end if;
  if p_patch #> '{settings,cost_per_min}' is not null then
    v := (p_patch #>> '{settings,cost_per_min}')::numeric;
    if v < 0 or v > 5 then raise exception 'cost per minute must be 0 to 5'; end if;
    st := st || jsonb_build_object('cost_per_min', v);
  end if;
  if p_patch #> '{settings,daily_cap}' is not null then
    v := (p_patch #>> '{settings,daily_cap}')::numeric;
    if v < 0 or v > 500 then raise exception 'daily cap must be 0 to 500'; end if;
    st := st || jsonb_build_object('daily_cap', v);
  end if;
  if p_patch #> '{settings,coach_on}' is not null then
    st := st || jsonb_build_object('coach_on', (p_patch #>> '{settings,coach_on}')::boolean);
  end if;
  update voice_agents set name = a.name, purpose = a.purpose, orb_hue = a.orb_hue, status = a.status, settings = st, updated_at = now() where slug = p_slug;
  return admin_agent(p_slug);
end $f$;

create or replace function public.admin_agent_calls(p_slug text, p_view text default 'all', p_lim int default 50) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by x.started_at desc nulls last) from (
    select c.id, c.call_no, c.conversation_id, c.direction, c.phone, c.caller_name, c.started_at, c.duration_secs, c.status, c.summary, c.title,
           c.cost, c.has_audio, c.read_at, c.archived_at,
           (select r.score from agent_reviews r where r.call_id = c.id) as score,
           coalesce((select jsonb_agg(t.code order by t.created_at) from support_tickets t where t.conversation_id = c.conversation_id), '[]'::jsonb) as tickets
      from agent_calls c
     where c.agent_slug = p_slug
       and case p_view when 'archived' then c.archived_at is not null
                       when 'unread' then c.archived_at is null and c.read_at is null
                       else c.archived_at is null end
     order by c.started_at desc nulls last
     limit greatest(1, least(coalesce(p_lim, 50), 200))) x), '[]'::jsonb);
end $f$;

create or replace function public.admin_agent_call(p_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare c agent_calls;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into c from agent_calls where id = p_id;
  if not found then raise exception 'no such call'; end if;
  return to_jsonb(c) || jsonb_build_object(
    'review', (select to_jsonb(r) from agent_reviews r where r.call_id = c.id),
    'tickets', coalesce((select jsonb_agg(t.code order by t.created_at) from support_tickets t where t.conversation_id = c.conversation_id), '[]'::jsonb));
end $f$;

create or replace function public.admin_agent_call_set(p_id uuid, p_action text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare c agent_calls;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_action not in ('read','unread','archive','unarchive','delete') then raise exception 'bad action'; end if;
  if p_action = 'delete' then
    delete from agent_calls where id = p_id returning * into c;
    if not found then raise exception 'no such call'; end if;
    return jsonb_build_object('ok', true, 'deleted', true);
  end if;
  update agent_calls set
    read_at = case p_action when 'read' then coalesce(read_at, now()) when 'unread' then null else read_at end,
    archived_at = case p_action when 'archive' then now() when 'unarchive' then null else archived_at end
   where id = p_id returning * into c;
  if not found then raise exception 'no such call'; end if;
  return jsonb_build_object('ok', true, 'read_at', c.read_at, 'archived_at', c.archived_at);
end $f$;

create or replace function public.admin_agent_spend(p_slug text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare a voice_agents; v_today numeric; v_month numeric; v_cap numeric; v_per numeric;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into a from voice_agents where slug = p_slug;
  if not found then raise exception 'no such agent'; end if;
  v_cap := coalesce((a.settings->>'daily_cap')::numeric, 10);
  v_per := coalesce((a.settings->>'cost_per_min')::numeric, 0.12);
  select coalesce(sum(coalesce(cost, coalesce(duration_secs, 0) / 60.0 * v_per)), 0) into v_today from agent_calls
   where agent_slug = p_slug and (started_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date;
  select coalesce(sum(coalesce(cost, coalesce(duration_secs, 0) / 60.0 * v_per)), 0) into v_month from agent_calls
   where agent_slug = p_slug and date_trunc('month', started_at at time zone 'America/Los_Angeles') = date_trunc('month', now() at time zone 'America/Los_Angeles');
  return jsonb_build_object('today', round(v_today, 2), 'cap', v_cap, 'over', v_cap > 0 and v_today >= v_cap, 'month', round(v_month, 2));
end $f$;

create or replace function public.admin_agent_coach(p_slug text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'avg_score_7d', (select round(avg(score)::numeric, 1) from agent_reviews where agent_slug = p_slug and created_at > now() - interval '7 days'),
    'reviews_7d', (select count(*) from agent_reviews where agent_slug = p_slug and created_at > now() - interval '7 days'),
    'reviews', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select r.id, r.call_id, c.call_no, c.started_at, c.caller_name, c.phone, r.score, r.went_well, r.fix, r.created_at
          from agent_reviews r join agent_calls c on c.id = r.call_id where r.agent_slug = p_slug order by r.created_at desc limit 20) x), '[]'::jsonb),
    'proposed', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from agent_playbook p where p.agent_slug = p_slug and p.status = 'proposed'), '[]'::jsonb),
    'on', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from agent_playbook p where p.agent_slug = p_slug and p.status = 'on'), '[]'::jsonb));
end $f$;

create or replace function public.admin_agent_playbook_set(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare p agent_playbook;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('proposed','on','off') then raise exception 'bad status'; end if;
  update agent_playbook set status = p_status, decided_at = now() where id = p_id returning * into p;
  if not found then raise exception 'no such playbook line'; end if;
  return to_jsonb(p);
end $f$;

revoke all on function public.admin_agents(), public.admin_agent(text), public.admin_agent_set(text,jsonb), public.admin_agent_calls(text,text,int), public.admin_agent_call(uuid), public.admin_agent_call_set(uuid,text), public.admin_agent_spend(text), public.admin_agent_coach(text), public.admin_agent_playbook_set(uuid,text) from public, anon, authenticated;
grant execute on function public.admin_agents(), public.admin_agent(text), public.admin_agent_set(text,jsonb), public.admin_agent_calls(text,text,int), public.admin_agent_call(uuid), public.admin_agent_call_set(uuid,text), public.admin_agent_spend(text), public.admin_agent_coach(text), public.admin_agent_playbook_set(uuid,text) to authenticated;

-- Post-call webhook secret: Vault name home_hub_agent_hub_webhook_secret (written by agent-hub setup; the home_hub_ prefix is what home_hub_vault_put allows).
-- Webhook ingest + setup + sync live in supabase/functions/agent-hub.
