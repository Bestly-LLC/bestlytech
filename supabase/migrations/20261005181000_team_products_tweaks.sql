-- Tweaks to product_status (2026-10-05): marketing never red before launch, issue titles named on updates,
-- clearer security wording. create or replace only.

-- cut text to at most n characters at a word boundary, no ellipsis
create or replace function public.product_clip(t text, n int) returns text
language sql immutable security definer set search_path to 'public' as $$
  select case
    when t is null or length(t) <= n then t
    when substr(t, n + 1, 1) = ' ' then rtrim(left(t, n))
    else rtrim(regexp_replace(left(t, n), '\s+\S*$', ''))
  end
$$;
revoke all on function public.product_clip(text, int) from public, anon, authenticated;

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
  iss_title text;
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
            h := 'red'; det := product_n(n_red, 'red finding', 'red findings') || ' to fix now';
          elsif n_yel > 0 then
            h := 'yellow'; det := product_n(n_yel, 'finding', 'findings') || ' to fix';
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

        iss_title := null;
        if n_iss > 0 then
          select m.title into iss_title
            from monitor_issues m
           where m.status not in ('resolved', 'closed')
             and exists (select 1 from unnest(p.monitor_prefixes) px
                          where m.key = px or m.key like px || '.%' or m.key like px || ':%')
           order by m.opened_at desc limit 1;
          iss_title := public.product_clip(coalesce(
            (select substr(iss_title, length(a.name) + 3) from bestly_agents a
              where iss_title like a.name || ': %' order by length(a.name) desc limit 1), iss_title), 80);
        end if;

        if rel_red is not null then
          h := 'red'; det := rel_red;
        elsif cardinality(down) > 0 then
          h := 'red';
          det := case when cardinality(down) = 1 then down[1] || ' is down' else cardinality(down)::text || nb || 'sites are down' end;
        elsif n_iss > 0 then
          h := case when n_iss_red > 0 then 'red' else 'yellow' end;
          det := case when n_iss = 1 then iss_title
                      else product_n(n_iss, 'open problem', 'open problems') || ', newest: ' || iss_title end;
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
            h := case when is_live then 'red' else 'yellow' end; det := 'No posts yet';
          else
            days := floor(extract(epoch from (now() - last_at)) / 86400)::int;
            if last_at < now() - interval '7 days' then
              h := case when is_live then 'red' else 'yellow' end; det := 'No post in ' || product_n(days, 'day', 'days') || ' · last ' || product_when(last_at);
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

-- re-run Product Watch so issues that are no longer red resolve
select public.product_watch_safe();
