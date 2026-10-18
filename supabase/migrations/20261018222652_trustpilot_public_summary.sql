-- Public Trustpilot summary for bestly.tech (homepage section, In-House Cloud line, footer).
-- Reads trustpilot_reviews (RLS on, no policies) through a SECURITY DEFINER function so the
-- publishable key can read exactly this summary and nothing else. Returns review_count 0 until the
-- Pi reader has inserted real rows; the site renders nothing at 0. Test rows (msg_id 'test-%') are
-- excluded. Newest six, no filtering by stars: no cherry-picking.

create or replace function public.get_trustpilot_public_summary()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with real as (
    select stars, title, snippet, reviewer_first_name, received_at
    from public.trustpilot_reviews
    where msg_id not like 'test-%'
  ),
  agg as (
    select round(avg(stars)::numeric, 1) as avg_rating,
           count(*)::int as review_count,
           max(received_at) as last_review_at
    from real
  ),
  newest as (
    select coalesce(json_agg(json_build_object(
             'stars', stars,
             'title', title,
             'snippet', snippet,
             'reviewer_first_name', reviewer_first_name,
             'received_at', received_at
           ) order by received_at desc), '[]'::json) as reviews
    from (select * from real order by received_at desc limit 6) r
  )
  select json_build_object(
    'avg_rating', agg.avg_rating,
    'review_count', agg.review_count,
    'last_review_at', agg.last_review_at,
    'reviews', newest.reviews
  )
  from agg, newest;
$$;

revoke all on function public.get_trustpilot_public_summary() from public;
grant execute on function public.get_trustpilot_public_summary() to anon, authenticated;

insert into public.security_public_rpcs (fn, why)
select 'get_trustpilot_public_summary',
       'bestly.tech homepage, In-House Cloud page and footer read the Trustpilot rating and newest reviews with no sign-in; returns only aggregate numbers plus first name, stars, title and snippet that Trustpilot already shows publicly'
where not exists (select 1 from public.security_public_rpcs where fn = 'get_trustpilot_public_summary');
