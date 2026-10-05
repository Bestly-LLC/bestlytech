-- Products on the Team page (docs/products-team-opusplan.md, sections 1-4).
-- Tables + seed, product_status() (the duty rules, one place), admin_products(), the two admin writers,
-- Product Watch (cron -> bestly_raise, signed by the duty owner), and Atlas, Head of Product.
-- Re-runnable: create or replace / if not exists / on conflict do update. Upserts only.

-- ------------------------------------------------------------------ tables
create table if not exists public.team_products (
  slug             text primary key,
  name             text not null,
  kind             text not null check (kind in ('app','web','service','physical','client','idea')),
  status           text not null check (status in ('live','beta','building','planned','idea','paused','retired')),
  platforms        text[] not null default '{}',
  url              text,
  store_url        text,
  icon             text,
  blurb            text,
  assets           text[] not null default '{}',
  social_brand     text,
  monitor_prefixes text[] not null default '{}',
  release_source   text,
  lead_slug        text not null default 'atlas',
  sort             int,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.team_product_duties (
  product_slug text not null references public.team_products(slug) on update cascade,
  duty         text not null check (duty in ('marketing','updates','security')),
  agent_slug   text,
  tools        text[] not null default '{}',
  note         text,
  updated_at   timestamptz not null default now(),
  primary key (product_slug, duty)
);

create table if not exists public.product_watch_state (
  id         int primary key default 1 check (id = 1),
  checked_at timestamptz,
  red        int,
  raised     int,
  resolved   int,
  error      text
);
insert into public.product_watch_state (id) values (1) on conflict (id) do nothing;

alter table public.team_products       enable row level security;
alter table public.team_product_duties enable row level security;
alter table public.product_watch_state enable row level security;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_products' and policyname='team_products_admin_read') then
    create policy team_products_admin_read on public.team_products for select to authenticated using (public.team_is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='team_product_duties' and policyname='team_product_duties_admin_read') then
    create policy team_product_duties_admin_read on public.team_product_duties for select to authenticated using (public.team_is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_watch_state' and policyname='product_watch_state_admin_read') then
    create policy product_watch_state_admin_read on public.product_watch_state for select to authenticated using (public.team_is_admin());
  end if;
end $pol$;

-- writes only through the security-definer functions below
revoke all on public.team_products, public.team_product_duties, public.product_watch_state from anon;
revoke all on public.team_products, public.team_product_duties, public.product_watch_state from authenticated;
grant select on public.team_products, public.team_product_duties, public.product_watch_state to authenticated;

-- ------------------------------------------------------------------ seed (plan section 1)
insert into public.team_products
  (slug, name, kind, status, platforms, url, store_url, icon, blurb, assets, social_brand, monitor_prefixes, release_source, lead_slug, sort)
values
 ('cookie-yeti','Cookie Yeti','app','live','{Chrome,Safari,iPhone,Mac}','/cookie-yeti','https://apps.apple.com/app/id6759732250','cookie',
  'Clicks away cookie pop-ups for you, so websites stop nagging and tracking you.','{}','cookieyeti','{}','cy_extension_releases','atlas',10),
 ('inventory-proof','InventoryProof','app','live','{iPhone}','https://inventoryproof.com',null,'package-check',
  'Walk through your home and get a report of everything you own, ready to hand to your insurance company.','{}','inventoryproof','{}',null,'atlas',20),
 ('parentiq','ParentIQ','web','live','{Web}','https://parentiq.io',null,'heart-handshake',
  'A shared calendar, message log and expense tracker for parents who live in two homes.','{parentiq.io,www.parentiq.io}',null,'{}',null,'atlas',30),
 ('captains-log','Captain''s Log','app','live','{iPhone,Web}','https://captainslog-command.higgsfield.app',null,'compass',
  'A sailing app with live marine weather, plus a web map that tracks ships in real time.','{}',null,'{}',null,'atlas',40),
 ('in-house-cloud','In-House Cloud','service','live','{Nextcloud}','/in-house-cloud',null,'cloud',
  'A private cloud server we set up for a business, so its files and chats stay off Big Tech.','{cloud.bestly.tech}',null,'{partner.cloud}',null,'atlas',50),
 ('bestly-studio','Bestly Studio','service','live','{Web}','https://studio.bestly.tech',null,'layout-dashboard',
  'A web page where clients review and approve their social posts before they go out.','{studio.bestly.tech,review.bestly.tech,"Vercel bestly-review (Studio)"}',null,'{studio}',null,'atlas',60),
 ('bestly-platform','bestly.tech & Admin','web','live','{Web}','https://bestly.tech',null,'globe',
  'Bestly''s public website and the private admin dashboard that runs the company.','{bestly.tech,www.bestly.tech,Bestly,"Supabase Bestly",github:bestlytech,"Bestly team",bestly-pi}',null,'{admin}',null,'atlas',70),
 ('vesta','Vesta','app','beta','{iPhone,Web}','https://vesta.bestly.tech',null,'flower',
  'A social and well-being app just for women, with verified members only.','{vesta.bestly.tech,app.bestly.tech,vesta-app.bestly.tech,vesta-beta.vercel.app,"Supabase Vesta"}',null,'{vesta}',null,'atlas',80),
 ('hoku','HOKU','physical','building','{Skincare}','https://hoku-clean.com',null,'droplets',
  'A daily face mist for clean, simple skincare.','{hoku-clean.com,www.hoku-clean.com}','hoku','{}',null,'atlas',90),
 ('content-service','Social Content Service','service','building','{Instagram,Facebook,TikTok}',null,null,'megaphone',
  'We make and post a business''s social media content for them, automatically.','{}','client-re-demo','{}',null,'atlas',100),
 ('arrivekey','Arrivekey','app','building','{"iPhone (TestFlight)"}',null,null,'key-round',
  'Gives Turo hosts a simple page for each trip, so guests find the car and check in without texting.','{}',null,'{}',null,'atlas',110),
 ('schoolpilot','SchoolPilot','app','building','{iPhone,Web}','https://school-pilot-nine.vercel.app',null,'graduation-cap',
  'One app for parents and students that shows grades, attendance and assignments from the school in one place.','{school-pilot.vercel.app,school-pilot-nine.vercel.app,"Supabase schoolpilot"}',null,'{}',null,'atlas',120),
 ('hoascope','HOAscope','web','building','{Web}','https://hoascope.com',null,'house',
  'Helps homeowner associations keep track of violations, dues and messages to residents.','{hoascope.com,www.hoascope.com}',null,'{}',null,'atlas',130),
 ('confesh','Confesh','app','building','{iPhone}',null,null,'message-circle',
  'An anonymous app where people share what is on their mind without being judged.','{}',null,'{}',null,'atlas',140),
 ('neckpilot','NeckPilot','app','planned','{iPhone,AirPods}','/neckpilot',null,'headphones',
  'Uses your AirPods to notice bad posture and give you a gentle nudge to sit up.','{}',null,'{}',null,'atlas',150),
 ('el-dora','El D''Ora','client','live','{Shopify}','https://eldoraluxe.com',null,'gem',
  'The online store we built for a lab-grown diamond jewelry brand.','{eldoraluxe.com,www.eldoraluxe.com}',null,'{}',null,'atlas',200),
 ('purely-hunza','Purely Hunza','client','live','{Web}','https://purelyhunza.com',null,'leaf',
  'The brand and online store we built for a food company.','{purelyhunza.vercel.app}',null,'{}',null,'atlas',210),
 ('golden-hour-garden','Golden Hour Garden Design','client','live','{Web}','https://goldenhourgardendesign.com',null,'flower-2',
  'The website we built for a landscape design studio, with a booking form that takes photo uploads.','{goldenhourgardendesign.com,www.goldenhourgardendesign.com}',null,'{}',null,'atlas',220),
 ('the-shift-shop','The Shift Shop','client','live','{Shopify,Amazon,"TikTok Shop"}','https://theshift.shop',null,'shopping-bag',
  'The store we moved to a new platform, then connected to Amazon and TikTok Shop so one catalog sells in three places.','{}',null,'{}',null,'atlas',230),
 ('bestly-wall','Bestly Wall (projection mapping)','idea','idea','{}',null,null,'projector',
  'An idea: a projector that turns any wall into a moving display for events and stores.','{}',null,'{}',null,'atlas',300),
 ('curbcite','CurbCite','idea','idea','{}',null,null,'bot',
  'An idea: an app for reporting delivery robots that block sidewalks.','{}',null,'{}',null,'atlas',310),
 ('pettv','Pet TV','idea','idea','{"Apple TV"}',null,null,'tv',
  'An idea: an Apple TV app that streams calming videos for pets.','{}',null,'{}',null,'atlas',320),
 ('runon','RunOn','idea','idea','{}',null,null,'sparkles',
  'An idea: one place to run several AI tools together on a single task.','{}',null,'{}',null,'atlas',330)
on conflict (slug) do update set
  name = excluded.name, kind = excluded.kind, status = excluded.status, platforms = excluded.platforms,
  url = excluded.url, store_url = excluded.store_url, icon = excluded.icon, blurb = excluded.blurb,
  assets = excluded.assets, social_brand = excluded.social_brand, monitor_prefixes = excluded.monitor_prefixes,
  release_source = excluded.release_source, lead_slug = excluded.lead_slug, sort = excluded.sort,
  updated_at = now();

-- duties: updates = atlas, security = security-auditor (Ares), marketing per the plan (clients and ideas: none)
insert into public.team_product_duties (product_slug, duty, agent_slug, tools)
select slug, 'updates', 'atlas', '{}' from public.team_products where kind <> 'idea'
on conflict (product_slug, duty) do update set agent_slug = excluded.agent_slug, updated_at = now();

insert into public.team_product_duties (product_slug, duty, agent_slug, tools)
select slug, 'security', 'security-auditor', '{}' from public.team_products where kind <> 'idea'
on conflict (product_slug, duty) do update set agent_slug = excluded.agent_slug, updated_at = now();

insert into public.team_product_duties (product_slug, duty, agent_slug, tools) values
 ('cookie-yeti',     'marketing', 'daily-post', '{pi-cy-maker,cy-pipeline,pi-brand-maker}'),
 ('inventory-proof', 'marketing', 'daily-post', '{pi-brand-maker}'),
 ('parentiq',        'marketing', 'spark', '{}'),
 ('captains-log',    'marketing', 'spark', '{}'),
 ('in-house-cloud',  'marketing', 'spark', '{}'),
 ('bestly-studio',   'marketing', 'spark', '{}'),
 ('bestly-platform', 'marketing', 'spark', '{}'),
 ('vesta',           'marketing', 'spark', '{}'),
 ('hoku',            'marketing', 'daily-post', '{pi-hoku-maker,hoku-post-check}'),
 ('content-service', 'marketing', 'daily-post', '{}'),
 ('arrivekey',       'marketing', 'spark', '{}'),
 ('schoolpilot',     'marketing', 'spark', '{}'),
 ('hoascope',        'marketing', 'spark', '{}'),
 ('confesh',         'marketing', 'spark', '{}'),
 ('neckpilot',       'marketing', 'spark', '{}')
on conflict (product_slug, duty) do update set agent_slug = excluded.agent_slug, tools = excluded.tools, updated_at = now();

-- ------------------------------------------------------------------ small helpers
-- "1:06 AM" today, "Yesterday 1:06 AM", else "Oct 3, 1:06 AM" (Los Angeles time, non-breaking spaces inside each part)
create or replace function public.product_when(p_ts timestamptz) returns text
language sql stable security definer set search_path to 'public' as $$
  select case when p_ts is null then null else
    (case
       when (p_ts at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date then ''
       when (p_ts at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date - 1 then 'Yesterday '
       else replace(to_char(p_ts at time zone 'America/Los_Angeles', 'FMMon FMDD'), ' ', chr(160)) || ', '
     end)
    || replace(to_char(p_ts at time zone 'America/Los_Angeles', 'FMHH12:MI AM'), ' ', chr(160))
  end
$$;

-- number joined to its unit with a non-breaking space
create or replace function public.product_n(n bigint, one text, many text default null) returns text
language sql immutable security definer set search_path to 'public' as $$
  select n::text || chr(160) || case when n = 1 then one else coalesce(many, one) end
$$;

create or replace function public.product_channel(c text) returns text
language sql immutable security definer set search_path to 'public' as $$
  select case c when 'chrome' then 'Chrome' when 'ios' then 'iPhone' when 'mac' then 'Mac' else initcap(c) end
$$;

-- ------------------------------------------------------------------ product_status(): the duty rules, in one place
create or replace function public.product_status() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  nb constant text := chr(160);
  run security_audit_runs;
  inv jsonb;
  p team_products;
  dr team_product_duties;
  dname text;
  req boolean;
  h text; det text;
  duties jsonb;
  res jsonb := '[]'::jsonb;
  overall text; headline text;
  n_red int; n_yel int; n_iss int; n_iss_red int; n_checked int; n_posts int; days int;
  down text[]; rel_red text; rel_ok text; last_at timestamptz; is_live boolean;
begin
  select * into run from security_audit_runs where finished_at is not null order by finished_at desc limit 1;
  inv := run.inventory;

  for p in select * from team_products order by sort nulls last, slug loop
    duties := '[]'::jsonb;
    is_live := p.status in ('live', 'beta');

    foreach dname in array array['marketing', 'updates', 'security'] loop
      req := case p.kind when 'client' then dname <> 'marketing' when 'idea' then false else true end;
      select * into dr from team_product_duties where product_slug = p.slug and duty = dname;
      h := null; det := null;

      if not req then
        h := 'grey';
        det := case p.kind when 'idea' then 'Just an idea for now' else 'The client handles this' end;

      elsif dr.agent_slug is null
         or not exists (select 1 from bestly_agents a where a.slug = dr.agent_slug and a.status in ('active', 'new')) then
        h := 'red'; det := 'No one owns this';

      elsif dname = 'security' then
        if cardinality(p.assets) = 0 then
          if is_live then h := 'yellow'; det := 'Not in the nightly audit yet';
          else h := 'grey'; det := 'Audit starts at launch'; end if;
        else
          select count(*) filter (where severity = 'red'), count(*) filter (where severity = 'yellow')
            into n_red, n_yel
            from security_findings where status = 'open' and asset = any (p.assets);
          if n_red > 0 then
            h := 'red'; det := product_n(n_red, 'red finding', 'red findings') || ' to fix';
          elsif n_yel > 0 then
            h := 'yellow'; det := n_yel::text || nb || 'to fix';
          elsif run.finished_at is null then
            h := 'yellow'; det := 'Audit hasn''t run yet';
          elsif run.finished_at < now() - interval '36 hours' then
            h := 'yellow'; det := 'Audit hasn''t run since ' || product_when(run.finished_at);
          else
            h := 'green'; det := 'All clear · checked ' || product_when(run.finished_at);
          end if;
        end if;

      elsif dname = 'updates' then
        rel_red := null; rel_ok := null;
        if p.release_source = 'cy_extension_releases' then
          select string_agg(product_channel(channel), ', ' order by case channel when 'ios' then 1 when 'mac' then 2 when 'chrome' then 3 else 4 end)
            into rel_red from cy_extension_releases where status = 'rejected';
          if rel_red is not null then rel_red := 'Rejected on ' || rel_red; end if;
          with r as (
            select channel, version, status,
                   case status when 'live' then 0 when 'in_review' then 1 else 2 end so,
                   case channel when 'ios' then 1 when 'mac' then 2 when 'chrome' then 3 else 4 end co
              from cy_extension_releases where status not in ('not_started', 'rejected')),
          g as (
            select version, status, so, min(co) co, string_agg(product_channel(channel), ', ' order by co) chans
              from r group by version, status, so),
          n as (select count(distinct version) nv from r)
          select string_agg(z.txt, ' · ' order by z.so, z.co) into rel_ok from (
            select g.so, g.co,
                   (case when n.nv > 1 or row_number() over (order by g.so, g.co) = 1 then coalesce(g.version || nb, '') else '' end
                    || case g.status when 'live' then 'live on ' when 'in_review' then 'in review on '
                                     else replace(g.status, '_', ' ') || ' on ' end
                    || g.chans) txt
              from g, n) z;
        end if;

        select coalesce(array_agg(x) filter (where (inv->'fingerprints'->x->>'status') is distinct from '200'), '{}'), count(*)
          into down, n_checked
          from unnest(p.assets) x where inv->'fingerprints' ? x;

        select count(*), count(*) filter (where m.severity in ('error', 'critical'))
          into n_iss, n_iss_red
          from monitor_issues m
         where m.status not in ('resolved', 'closed')
           and exists (select 1 from unnest(p.monitor_prefixes) px
                        where m.key = px or m.key like px || '.%' or m.key like px || ':%');

        if rel_red is not null then
          h := 'red'; det := rel_red;
        elsif cardinality(down) > 0 then
          h := 'red';
          det := case when cardinality(down) = 1 then down[1] || ' is down' else cardinality(down)::text || nb || 'sites are down' end;
        elsif n_iss_red > 0 then
          h := 'red'; det := product_n(n_iss, 'open problem', 'open problems');
        elsif n_iss > 0 then
          h := 'yellow'; det := product_n(n_iss, 'open problem', 'open problems');
        elsif rel_ok is not null then
          h := 'green'; det := rel_ok;
        elsif n_checked > 0 then
          h := 'green';
          det := case when n_checked = 1 then 'Site is up' else product_n(n_checked, 'site', 'sites') || ' up' end
                 || ' · checked ' || product_when(run.finished_at);
        elsif is_live then
          h := 'green'; det := 'No problems reported';
        else
          h := 'grey'; det := 'Not shipped yet';
        end if;

      else -- marketing
        if p.social_brand is not null then
          select count(*) filter (where posted_at >= now() - interval '7 days'), max(posted_at)
            into n_posts, last_at
            from social_posts where brand = p.social_brand and status = 'posted';
          if last_at is null then
            h := 'red'; det := 'No posts yet';
          else
            days := floor(extract(epoch from (now() - last_at)) / 86400)::int;
            if last_at < now() - interval '7 days' then
              h := 'red'; det := 'No post in ' || product_n(days, 'day', 'days') || ' · last ' || product_when(last_at);
            elsif last_at < now() - interval '3 days' and p.status in ('live', 'beta', 'building') then
              h := 'yellow'; det := 'No post in ' || product_n(days, 'day', 'days') || ' · last ' || product_when(last_at);
            else
              h := 'green'; det := product_n(n_posts, 'post', 'posts') || ' this week · last ' || product_when(last_at);
            end if;
          end if;
        elsif is_live then
          h := 'yellow'; det := 'No marketing running yet';
        else
          h := 'grey'; det := 'Starts at launch';
        end if;
      end if;

      duties := duties || jsonb_build_array(jsonb_build_object(
        'duty', dname, 'required', req, 'agent_slug', dr.agent_slug,
        'tools', to_jsonb(coalesce(dr.tools, '{}'::text[])),
        'health', h, 'detail', det, 'note', dr.note));
    end loop;

    -- overall = worst required duty (red > yellow > green > grey); ties read updates, security, marketing
    select e->>'health', e->>'detail' into overall, headline
      from jsonb_array_elements(duties) e
     where (e->>'required')::boolean
     order by case e->>'health' when 'red' then 3 when 'yellow' then 2 when 'green' then 1 else 0 end desc,
              case e->>'duty' when 'updates' then 0 when 'security' then 1 else 2 end
     limit 1;
    if not found then
      overall := 'grey'; headline := case p.kind when 'idea' then 'Just an idea for now' else 'Nothing to check' end;
    end if;

    res := res || jsonb_build_array(jsonb_build_object(
      'slug', p.slug, 'name', p.name, 'kind', p.kind, 'status', p.status,
      'platforms', to_jsonb(p.platforms), 'url', p.url, 'store_url', p.store_url, 'icon', p.icon, 'blurb', p.blurb,
      'sort', p.sort, 'lead_slug', p.lead_slug, 'assets', to_jsonb(p.assets), 'social_brand', p.social_brand,
      'health', overall, 'headline', headline, 'duties', duties));
  end loop;
  return res;
end $$;
revoke all on function public.product_status() from public, anon, authenticated;
revoke all on function public.product_when(timestamptz), public.product_n(bigint, text, text), public.product_channel(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ admin_products(): what the page reads
create or replace function public.admin_products() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_audit timestamptz; v_inv jsonb; v_hosts jsonb := '[]'::jsonb;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  select finished_at, inventory into v_audit, v_inv
    from security_audit_runs where finished_at is not null order by finished_at desc limit 1;
  if jsonb_typeof(v_inv->'hosts') = 'array' then
    select coalesce(jsonb_agg(t.h order by t.ord), '[]'::jsonb) into v_hosts
      from jsonb_array_elements_text(v_inv->'hosts') with ordinality t(h, ord)
     where not exists (select 1 from team_products tp where t.h = any (tp.assets));
  end if;
  return jsonb_build_object(
    'checked_at', (select checked_at from product_watch_state where id = 1),
    'audit_at', v_audit,
    'products', public.product_status(),
    'unmapped_hosts', v_hosts);
end $$;
revoke all on function public.admin_products() from public, anon;
grant execute on function public.admin_products() to authenticated;

-- ------------------------------------------------------------------ writers
create or replace function public.admin_product_duty_set(p_product text, p_duty text, p_agent text, p_tools text[] default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_row team_product_duties;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from team_products where slug = p_product) then raise exception 'no such product'; end if;
  if p_duty is null or p_duty not in ('marketing', 'updates', 'security') then raise exception 'no such duty'; end if;
  if not exists (select 1 from bestly_agents a
                  where a.slug = p_agent and a.status in ('active', 'new')
                    and coalesce(a.profile->>'tool', 'false') <> 'true') then
    raise exception 'pick an active employee (not a tool)';
  end if;
  insert into team_product_duties (product_slug, duty, agent_slug, tools)
  values (p_product, p_duty, p_agent, coalesce(p_tools, '{}'))
  on conflict (product_slug, duty) do update set
    agent_slug = excluded.agent_slug,
    tools = case when p_tools is null then team_product_duties.tools else excluded.tools end,
    updated_at = now()
  returning * into v_row;
  if v_row.product_slug is null then raise exception 'nothing changed'; end if;
  return to_jsonb(v_row);
end $$;
revoke all on function public.admin_product_duty_set(text, text, text, text[]) from public, anon;
grant execute on function public.admin_product_duty_set(text, text, text, text[]) to authenticated;

create or replace function public.admin_product_set(p_slug text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_row team_products;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('live','beta','building','planned','idea','paused','retired') then
    raise exception 'bad status';
  end if;
  update team_products set
    name         = coalesce(nullif(trim(p_patch->>'name'), ''), name),
    status       = coalesce(p_patch->>'status', status),
    url          = case when p_patch ? 'url' then nullif(trim(p_patch->>'url'), '') else url end,
    store_url    = case when p_patch ? 'store_url' then nullif(trim(p_patch->>'store_url'), '') else store_url end,
    blurb        = case when p_patch ? 'blurb' then nullif(trim(p_patch->>'blurb'), '') else blurb end,
    platforms    = case when jsonb_typeof(p_patch->'platforms') = 'array'
                        then array(select jsonb_array_elements_text(p_patch->'platforms')) else platforms end,
    assets       = case when jsonb_typeof(p_patch->'assets') = 'array'
                        then array(select jsonb_array_elements_text(p_patch->'assets')) else assets end,
    social_brand = case when p_patch ? 'social_brand' then nullif(trim(p_patch->>'social_brand'), '') else social_brand end,
    updated_at   = now()
  where slug = p_slug
  returning * into v_row;
  if not found then raise exception 'no such product'; end if;
  return to_jsonb(v_row);
end $$;
revoke all on function public.admin_product_set(text, jsonb) from public, anon;
grant execute on function public.admin_product_set(text, jsonb) to authenticated;

-- ------------------------------------------------------------------ Product Watch (every 30 min, signed by the duty owner)
-- bestly_raise's bell prefixes the notification owner's name itself (the owner prefix is synced below), so the issue
-- title stays "HOKU has 1 red security finding" and the bell/push read "Ares: HOKU has 1 red security finding".
create or replace function public.product_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  prod jsonb; d jsonb; keys text[] := '{}'; unowned text[];
  v_red int := 0; v_raised int := 0; v_resolved int := 0;
  v_slug text; v_name text; v_duty text; v_owner text; v_oname text; v_key text; v_title text; v_detail text; v_n int;
  v_was_open boolean; i record;
begin
  insert into notification_owners (prefix, agent_slug, note) values ('product', 'atlas', 'Products and Product Watch')
  on conflict (prefix) do nothing;

  for prod in select * from jsonb_array_elements(public.product_status()) loop
    v_slug := prod->>'slug'; v_name := prod->>'name'; unowned := '{}';
    for d in select * from jsonb_array_elements(prod->'duties') loop
      continue when not (d->>'required')::boolean;
      v_duty := d->>'duty'; v_owner := d->>'agent_slug'; v_detail := d->>'detail';
      select a.name into v_oname from bestly_agents a where a.slug = v_owner and a.status in ('active', 'new');
      if v_oname is null then unowned := unowned || v_duty; continue; end if;

      v_key := 'product.' || v_duty || '.' || v_slug;
      insert into notification_owners (prefix, agent_slug, note)
      values (v_key, v_owner, v_name || ' ' || v_duty)
      on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note
        where notification_owners.agent_slug is distinct from excluded.agent_slug;

      if d->>'health' = 'red' then
        v_red := v_red + 1; keys := keys || v_key;
        if v_duty = 'security' then
          select count(*) into v_n from security_findings f
           where f.status = 'open' and f.severity = 'red'
             and f.asset = any (select unnest(assets) from team_products where slug = v_slug);
          v_title := v_name || ' has ' || public.product_n(v_n, 'red security finding', 'red security findings');
        else
          v_title := v_name || ' ' || v_duty || ': ' || split_part(v_detail, ' · ', 1);
        end if;
        v_was_open := exists (select 1 from monitor_issues where key = v_key and status = 'open');
        perform bestly_raise(v_key, 'problem', 'warning', v_title,
          v_oname || ' looks after ' || v_duty || ' for ' || v_name || '. ' || v_detail || '. See Team > Products.',
          'product', null, false);
        if not v_was_open then v_raised := v_raised + 1; end if;
      end if;
    end loop;

    if cardinality(unowned) > 0 then
      v_key := 'product.unowned.' || v_slug;
      v_red := v_red + 1; keys := keys || v_key;
      v_was_open := exists (select 1 from monitor_issues where key = v_key and status = 'open');
      perform bestly_raise(v_key, 'problem', 'warning',
        v_name || ' has no one on ' || array_to_string(unowned, ' and '),
        'Nobody active owns ' || array_to_string(unowned, ' and ') || ' for ' || v_name || '. Pick an owner on Team > Products.',
        'product', null, false);
      if not v_was_open then v_raised := v_raised + 1; end if;
    end if;
  end loop;

  -- anything that was raised before and is not red now gets resolved
  for i in select key from monitor_issues where key like 'product.%' and status = 'open' and not (key = any (keys)) loop
    perform bestly_raise(i.key, 'resolved', 'info',
      coalesce((select t.name from team_products t where t.slug = split_part(i.key, '.', 3)), 'Product Watch') || ' is back to normal',
      null, 'product', null, false);
    v_resolved := v_resolved + 1;
  end loop;

  update product_watch_state set checked_at = now(), red = v_red, raised = v_raised, resolved = v_resolved, error = null where id = 1;
  return jsonb_build_object('red', v_red, 'raised', v_raised, 'resolved', v_resolved);
end $$;
revoke all on function public.product_watch() from public, anon, authenticated;

create or replace function public.product_watch_safe() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v_err text;
begin
  begin
    r := public.product_watch();
  exception when others then
    v_err := left(sqlerrm, 300);
    update product_watch_state set error = v_err where id = 1;
    begin
      perform bestly_raise('product.watch.failed', 'problem', 'warning', 'Product Watch stopped working',
        'Product Watch hit an error and could not check the products: ' || v_err, 'product', null, false);
    exception when others then null;
    end;
    return jsonb_build_object('error', v_err);
  end;
  return r;
end $$;
revoke all on function public.product_watch_safe() from public, anon, authenticated;

select cron.schedule('product-watch', '11,41 * * * *', $c$select public.product_watch_safe();$c$);

-- ------------------------------------------------------------------ Atlas, Head of Product (CLAUDE.md: a card the day it goes live)
select public.team_onboard($j$[
 {"slug":"atlas","name":"Atlas","role":"Head of Product","reports_to":"scout","dept":"product","runs_on":"cloud","icon":"package","welcome":false,
  "schedule":"every 30 min","admin_url":"/admin/team?view=products","sort":15,
  "what_it_does":"Owns every Bestly app and site from launch on. Keeps each one up to date, makes sure each has someone on marketing and security, and tells Scout when a product needs attention.",
  "pulse":{"src":"cron","job":"product-watch","gap":45,"alert":true},
  "owns":["product"]}
]$j$::jsonb);

-- Ares owns security for every product (via the admin helper; direct UPDATEs of bestly_agents get cancelled here)
do $$
declare v_cur text;
begin
  select what_it_does into v_cur from bestly_agents where slug = 'security-auditor';
  if v_cur is not null and v_cur not like '%Owns security for every Bestly product.%' then
    perform public.admin_agent_set('security-auditor', jsonb_build_object('what_it_does', v_cur || ' Owns security for every Bestly product.'));
  end if;
end $$;

-- populate state once
select public.product_watch_safe();
