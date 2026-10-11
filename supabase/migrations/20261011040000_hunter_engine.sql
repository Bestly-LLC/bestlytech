-- Hunter, Bestly's lead-generation employee: Phase 1 engine (2026-10-11).
--
-- Hunter finds local service businesses for Maya's cold-calling campaigns, cleans and dedupes them, reads each
-- website, scores how well the Bestly Agent (AI receptionist) fits, checks the phone line type, and hands the best
-- landline leads to Maya's queue every night. Free sources only, no Claude tokens at runtime (edge function
-- hunter-run + pg_cron; free AI ladder for the fit score).
--
-- RoofGuard stays separable: Hunter reads rg_leads (by phone) and rg_dnc only to avoid duplicates and to honor
-- opt-outs, and never writes to them. Reese gets wired through a small adapter in Phase 3.
--
--   hunter_campaigns   what to hunt, for whom, how many a day
--   hunter_sources     free data sources + their cursor, fail streak (Apollo seeded off, "not connected")
--   hunter_settings    one row: master switch, min fit score, daily Telnyx lookup cap
--   maya_leads         Maya's lead store (same useful shape as rg_leads)
--   hunter_optouts     the shared permanent opt-out list (Phase 3 wires Reese into it)
--   hunter_runs        one row per step per source per run, so the watchdog can tell "working" from "stuck"

create table if not exists public.hunter_campaigns (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  owner         text not null check (owner in ('maya','reese')),
  name          text not null,
  area          text not null default 'Los Angeles County, CA',
  business_types text[] not null default '{}',   -- auto_repair | salon | home_services | clinic
  daily_target  int  not null default 0 check (daily_target between 0 and 200),
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.hunter_sources (
  slug          text primary key,
  name          text not null,
  enabled       boolean not null default true,
  notes         text,
  cursor        jsonb not null default '{}'::jsonb,
  fail_streak   int not null default 0,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text
);

create table if not exists public.hunter_settings (
  id               boolean primary key default true check (id),
  enabled          boolean not null default true,
  min_fit          int not null default 50 check (min_fit between 0 and 100),
  telnyx_daily_cap int not null default 120 check (telnyx_daily_cap between 0 and 1000),
  updated_at       timestamptz not null default now()
);
insert into public.hunter_settings (id) values (true) on conflict do nothing;

create table if not exists public.maya_leads (
  id                    uuid primary key default gen_random_uuid(),
  company               text not null,
  category              text,                       -- auto_repair | salon | home_services | clinic
  address               text,
  city                  text,
  state                 text not null default 'CA',
  zip                   text,
  timezone              text not null default 'America/Los_Angeles',
  lat                   double precision,
  lon                   double precision,
  phone                 text,                       -- E.164, +1XXXXXXXXXX
  phone_source          text,                       -- osm | website | la_open_data
  line_type             text not null default 'unverified' check (line_type in ('unverified','landline','voip','mobile','unknown')),
  line_type_checked_at  timestamptz,
  website               text,
  website_host          text generated always as (
                          nullif(lower(regexp_replace(regexp_replace(coalesce(website,''), '^https?://(www\.)?', '', 'i'), '[/?#:].*$', '')), '')
                        ) stored,
  site_status           text,                       -- ok | none | blocked | error
  site_read_at          timestamptz,
  email                 text,
  owner_name            text,
  business_hours        text,                       -- as written on the site or in OpenStreetMap
  fit_score             int check (fit_score between 0 and 100),
  fit_reason            text,                       -- one line a caller can say
  fit_checked_at        timestamptz,
  campaign_slug         text references public.hunter_campaigns(slug) on update cascade,
  source                text not null,              -- la_open_data | openstreetmap
  source_ref            text,
  status                text not null default 'new' check (status in ('new','checked','queued','called','booked','opted_out','rejected')),
  reject_reason         text,
  dnc                   boolean not null default false,
  dnc_checked           boolean not null default false,  -- true only after a National DNC Registry scrub (no registry access yet)
  call_attempts         int not null default 0,
  last_called_at        timestamptz,
  next_call_at          timestamptz,
  queued_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists maya_leads_phone_uq on public.maya_leads (phone) where phone is not null;
create unique index if not exists maya_leads_host_uq  on public.maya_leads (website_host) where website_host is not null;
create unique index if not exists maya_leads_src_uq   on public.maya_leads (source, source_ref) where source_ref is not null;
create index if not exists maya_leads_status_idx on public.maya_leads (status, campaign_slug, fit_score desc);
create index if not exists maya_leads_queue_idx  on public.maya_leads (campaign_slug, queued_at) where status = 'queued';

create or replace function public.maya_leads_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create or replace trigger maya_leads_touch before update on public.maya_leads for each row execute function public.maya_leads_touch();

create table if not exists public.hunter_optouts (
  id            bigserial primary key,
  phone         text,
  email         text,
  company       text,
  source_caller text,                                -- maya | reese | manual
  created_at    timestamptz not null default now(),
  check (phone is not null or email is not null or company is not null)
);
create unique index if not exists hunter_optouts_phone_uq on public.hunter_optouts (phone) where phone is not null;
create unique index if not exists hunter_optouts_email_uq on public.hunter_optouts (lower(email)) where email is not null;

create table if not exists public.hunter_runs (
  id            bigserial primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  step          text,                                -- find | read | check | handoff
  campaign_slug text,
  source        text,
  found         int not null default 0,
  deduped       int not null default 0,
  checked       int not null default 0,
  rejected      int not null default 0,
  queued        int not null default 0,
  error         text,
  detail        jsonb
);
create index if not exists hunter_runs_started_idx on public.hunter_runs (started_at desc);

-- ---- access: admin-only (has_role), explicit grants -------------------------------------------------------
alter table public.hunter_campaigns enable row level security;
alter table public.hunter_sources   enable row level security;
alter table public.hunter_settings  enable row level security;
alter table public.maya_leads       enable row level security;
alter table public.hunter_optouts   enable row level security;
alter table public.hunter_runs      enable row level security;

do $$ declare t text; begin
  foreach t in array array['hunter_campaigns','hunter_sources','hunter_settings','maya_leads','hunter_optouts','hunter_runs'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin_read') then
      execute format($p$create policy %I on public.%I for select to authenticated using (public.has_role(auth.uid(), 'admin'))$p$, t || '_admin_read', t);
    end if;
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

-- ---- seeds ---------------------------------------------------------------------------------------------------
insert into public.hunter_campaigns (slug, owner, name, area, business_types, daily_target) values
  ('maya-auto-repair',   'maya', 'Auto repair shops',                      'Los Angeles County, CA', '{auto_repair}',   8),
  ('maya-salons',        'maya', 'Hair and nail salons',                   'Los Angeles County, CA', '{salon}',         8),
  ('maya-home-services', 'maya', 'Home-service contractors',               'Los Angeles County, CA', '{home_services}', 7),
  ('maya-clinics',       'maya', 'Small medical, dental and chiro clinics', 'Los Angeles County, CA', '{clinic}',        7)
on conflict (slug) do nothing;

insert into public.hunter_sources (slug, name, enabled, notes) values
  ('la_open_data',   'City of Los Angeles active business list', true,  'data.lacity.org Socrata (listing of active businesses, by NAICS). Name and address only; the phone comes from an OpenStreetMap match. City of LA only, not the whole county.'),
  ('openstreetmap',  'OpenStreetMap (Overpass)',                 true,  'Free map data, one tile of LA County per request, polite single-query use.'),
  ('website_reader', 'Website reader + fit score',               true,  'Homepage only, robots.txt respected, 1 request a second, free AI ladder for the score.'),
  ('apollo',         'Apollo',                                   false, 'not connected')
on conflict (slug) do nothing;

-- ---- worker functions (service role only) --------------------------------------------------------------------
create or replace function public.hunter_worker_ok() returns boolean language sql stable set search_path = public as $$
  select coalesce(auth.role(), '') = 'service_role' or current_user in ('postgres','service_role','supabase_admin') or public.team_is_admin()
$$;

-- Insert cleaned candidates. Skips anything already known (maya_leads by phone / site / source ref, rg_leads by phone,
-- Reese's rg_dnc, the shared opt-out list). Returns counts.
create or replace function public.hunter_insert_leads(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; n_in int := 0; n_dup int := 0; n_out int := 0; ph text; em text; rows_ins int;
begin
  if not public.hunter_worker_ok() then raise exception 'not allowed'; end if;
  for r in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    ph := nullif(r->>'phone', ''); em := nullif(lower(r->>'email'), '');
    if (ph is not null and (exists (select 1 from hunter_optouts where phone = ph) or exists (select 1 from rg_dnc where phone = ph)))
       or (em is not null and exists (select 1 from hunter_optouts where lower(email) = em))
       or exists (select 1 from hunter_optouts where company is not null and lower(company) = lower(r->>'company')) then
      n_out := n_out + 1; continue;
    end if;
    if ph is not null and exists (select 1 from rg_leads where phone = ph) then n_dup := n_dup + 1; continue; end if;
    insert into maya_leads (company, category, address, city, state, zip, lat, lon, phone, phone_source, website, email,
                            business_hours, campaign_slug, source, source_ref)
    values (r->>'company', r->>'category', r->>'address', r->>'city', coalesce(r->>'state', 'CA'), r->>'zip',
            nullif(r->>'lat','')::double precision, nullif(r->>'lon','')::double precision, ph, r->>'phone_source',
            nullif(r->>'website',''), em, r->>'business_hours', r->>'campaign_slug', r->>'source', r->>'source_ref')
    on conflict do nothing;
    get diagnostics rows_ins = row_count;
    if rows_ins = 1 then n_in := n_in + 1; else n_dup := n_dup + 1; end if;
  end loop;
  return jsonb_build_object('inserted', n_in, 'deduped', n_dup, 'optout', n_out);
end $$;

-- Nightly hand-off: top each enabled Maya campaign's queue up to its daily target, best fit first, landlines only.
-- Never exceeds the target: neither the queue depth nor the number queued today.
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
        select id from maya_leads
         where campaign_slug = c.slug and status = 'checked' and line_type = 'landline'
           and phone is not null and not dnc and coalesce(fit_score, 0) >= s.min_fit
           and not exists (select 1 from hunter_optouts o where o.phone = maya_leads.phone)
         order by fit_score desc, created_at
         limit need for update skip locked)
      update maya_leads m set status = 'queued', queued_at = now() from pick where m.id = pick.id;
      get diagnostics moved = row_count;
    end if;
    out := out || jsonb_build_object('campaign', c.slug, 'target', c.daily_target, 'had', have, 'queued_today_before', today, 'moved', moved);
  end loop;
  return jsonb_build_object('campaigns', out);
end $$;

-- ---- admin RPCs (SECURITY DEFINER, team_is_admin() first) ------------------------------------------------------
create or replace function public.hunter_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from hunter_settings s where id),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'owner', c.owner, 'name', c.name, 'area', c.area, 'business_types', c.business_types,
        'daily_target', c.daily_target, 'enabled', c.enabled,
        'queued', (select count(*) from maya_leads l where l.campaign_slug = c.slug and l.status = 'queued'),
        'queued_today', (select count(*) from maya_leads l where l.campaign_slug = c.slug and l.queued_at >= day_start),
        'checked_ready', (select count(*) from maya_leads l where l.campaign_slug = c.slug and l.status = 'checked' and l.line_type = 'landline'))
        order by c.owner, c.slug) from hunter_campaigns c), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(x) order by x.slug) from hunter_sources x), '[]'::jsonb),
    'funnel', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from maya_leads group by status) f), '{}'::jsonb),
    'optouts', (select count(*) from hunter_optouts),
    'recent_runs', coalesce((select jsonb_agg(to_jsonb(r)) from (select * from hunter_runs order by id desc limit 12) r), '[]'::jsonb));
end $$;

create or replace function public.hunter_campaign_set(p_slug text, p_enabled boolean default null, p_daily_target int default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c hunter_campaigns;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_daily_target is not null and (p_daily_target < 0 or p_daily_target > 200) then raise exception 'daily_target must be 0 to 200'; end if;
  update hunter_campaigns set enabled = coalesce(p_enabled, enabled), daily_target = coalesce(p_daily_target, daily_target),
         name = coalesce(nullif(left(p_name, 80), ''), name)
   where slug = p_slug returning * into c;
  if c.slug is null then raise exception 'no such campaign'; end if;
  return to_jsonb(c);
end $$;

create or replace function public.hunter_source_set(p_slug text, p_enabled boolean default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s hunter_sources;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_slug = 'apollo' and p_enabled is true then raise exception 'Apollo is not connected yet'; end if;
  update hunter_sources set enabled = coalesce(p_enabled, enabled), notes = coalesce(left(p_notes, 400), notes)
   where slug = p_slug returning * into s;
  if s.slug is null then raise exception 'no such source'; end if;
  return to_jsonb(s);
end $$;

create or replace function public.hunter_settings_set(p_enabled boolean default null, p_min_fit int default null, p_telnyx_daily_cap int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s hunter_settings;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_min_fit is not null and (p_min_fit < 0 or p_min_fit > 100) then raise exception 'min_fit must be 0 to 100'; end if;
  if p_telnyx_daily_cap is not null and (p_telnyx_daily_cap < 0 or p_telnyx_daily_cap > 1000) then raise exception 'cap must be 0 to 1000'; end if;
  update hunter_settings set enabled = coalesce(p_enabled, enabled), min_fit = coalesce(p_min_fit, min_fit),
         telnyx_daily_cap = coalesce(p_telnyx_daily_cap, telnyx_daily_cap), updated_at = now() where id returning * into s;
  return to_jsonb(s);
end $$;

create or replace function public.hunter_lead_set(p_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l maya_leads;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('new','checked','queued','called','booked','opted_out','rejected') then raise exception 'bad status'; end if;
  update maya_leads set status = p_status,
         reject_reason = case when p_status in ('rejected','opted_out') then coalesce(left(p_reason, 200), reject_reason) else null end,
         dnc = dnc or p_status = 'opted_out',
         queued_at = case when p_status = 'queued' then coalesce(queued_at, now()) else queued_at end
   where id = p_id returning * into l;
  if l.id is null then raise exception 'no such lead'; end if;
  if p_status = 'opted_out' then
    insert into hunter_optouts (phone, email, company, source_caller)
    values (l.phone, lower(l.email), l.company, 'manual') on conflict do nothing;
  end if;
  return to_jsonb(l);
end $$;

-- ---- lock down: admin RPCs for signed-in admins, workers for the service role only -------------------------------
revoke all on function public.hunter_worker_ok() from public, anon;
revoke all on function public.hunter_insert_leads(jsonb) from public, anon, authenticated;
revoke all on function public.hunter_handoff() from public, anon, authenticated;
grant execute on function public.hunter_worker_ok() to service_role;
grant execute on function public.hunter_insert_leads(jsonb) to service_role;
grant execute on function public.hunter_handoff() to service_role;

revoke all on function public.hunter_overview() from public, anon;
revoke all on function public.hunter_campaign_set(text, boolean, int, text) from public, anon;
revoke all on function public.hunter_source_set(text, boolean, text) from public, anon;
revoke all on function public.hunter_settings_set(boolean, int, int) from public, anon;
revoke all on function public.hunter_lead_set(uuid, text, text) from public, anon;
grant execute on function public.hunter_overview() to authenticated, service_role;
grant execute on function public.hunter_campaign_set(text, boolean, int, text) to authenticated, service_role;
grant execute on function public.hunter_source_set(text, boolean, text) to authenticated, service_role;
grant execute on function public.hunter_settings_set(boolean, int, int) to authenticated, service_role;
grant execute on function public.hunter_lead_set(uuid, text, text) to authenticated, service_role;
