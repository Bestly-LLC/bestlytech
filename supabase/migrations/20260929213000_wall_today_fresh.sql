-- Admin freshness (2026-09-29): the wall's "today" shows only today's picks (it used to fall back to yesterday's
-- open picks), and "done today" counts picks Jared/Scout finished, not ones the freshness sweep aged out.
CREATE OR REPLACE FUNCTION public.wall_today()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (
    select (now() at time zone 'America/Los_Angeles')::date as day
  ), picks as (
    select slot, title, why, action->>'from' as src from scout_daily, d
     where scout_daily.day = d.day and kind = 'pick' and status = 'open'
  ), urgent as (
    select 'urgent' as kind, title, coalesce(needs_jared, left(body, 120)) as why from monitor_issues
     where status = 'open' and severity = 'error' and key not like 'wall.test%'
     order by opened_at desc limit 1
  ), needs as (
    select 'needs' as kind, title, needs_jared as why from monitor_issues
     where status = 'open' and needs_jared is not null and severity <> 'error'
     order by opened_at desc limit 1
  ), usps as (
    select nullif(substring(body_text from 'mailpieces=(\d+)'), '')::int as mp,
           nullif(substring(body_text from 'packages=(\d+)'), '')::int as pk
      from bestly_mail
     where from_addr ilike '%informeddelivery.usps.com'
       and (sent_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date
       and extract(hour from now() at time zone 'America/Los_Angeles') < 19
     order by sent_at desc limit 1
  ), pieces as (
    select string_agg(l, ' · ' order by key) as line from (
      select key, wall_mail_line(sender, what, summary) as l from wall_mail_pieces
       where kind = 'mail' and day = (now() at time zone 'America/Los_Angeles')::date
         and (summary is not null or sender is not null)) x
  ), mail as (
    select 'mail' as kind,
      case when mp is null then 'Mail is coming today'
           when mp = 0 and coalesce(pk,0) = 0 then null
           when mp = 0 then pk || ' USPS package' || case when pk > 1 then 's' else '' end || ' today'
           else mp || ' piece' || case when mp > 1 then 's' else '' end || ' of mail today'
             || case when coalesce(pk,0) > 0 then ' + ' || pk || ' package' || case when pk > 1 then 's' else '' end else '' end
      end as title,
      coalesce((select left(line, 140) from pieces), 'Scans are in your USPS Informed Delivery email.') as why
    from usps
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by ord) from (
        select 0 as ord, jsonb_build_object('kind', kind, 'title', title, 'why', why, 'from', 'Monitor') as x from urgent
        union all select 1, jsonb_build_object('kind', kind, 'title', title, 'why', why, 'from', 'USPS') from mail where title is not null
        union all select 2, jsonb_build_object('kind', 'focus', 'title', title, 'why', why, 'from', src) from picks where slot = 'focus'
        union all select 3, jsonb_build_object('kind', 'decision', 'title', title, 'why', why, 'from', src) from picks where slot = 'decision'
        union all select 4, jsonb_build_object('kind', 'quick', 'title', title, 'why', why, 'from', src) from picks where slot = 'quick'
        union all select 5, jsonb_build_object('kind', kind, 'title', title, 'why', why, 'from', 'Monitor') from needs
      ) s), '[]'::jsonb),
    'drafts', (select count(*) from scout_daily where kind = 'draft' and status = 'open'
                and day >= (now() at time zone 'America/Los_Angeles')::date - 1),
    'done_today', (select count(*) from scout_daily where kind = 'pick' and status in ('done', 'handed')
                    and done_at >= date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'),
    'needs_you', (select count(*) from monitor_issues where status = 'open' and needs_jared is not null));
$function$;
