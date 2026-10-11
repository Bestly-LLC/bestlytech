-- Hunter: reach OpenStreetMap's Overpass API through pg_net.
-- The public Overpass mirrors answer requests made from the edge runtime with 406 (Not Acceptable) but serve the
-- identical request made by pg_net, so hunter-run issues its Overpass reads through these two service-only helpers.
-- Read-only public data, polite single-query use, User-Agent names Bestly and a contact address.

create or replace function public.hunter_net_get(p_url text, p_timeout_ms int default 60000)
returns bigint
language sql
security definer
set search_path = public, net
as $$
  select net.http_get(
    url := p_url,
    headers := jsonb_build_object('User-Agent', 'BestlyHunter/1.0 (jared@bestly.tech)', 'Accept', '*/*'),
    timeout_milliseconds := greatest(5000, least(coalesce(p_timeout_ms, 60000), 120000))
  );
$$;

create or replace function public.hunter_net_result(p_id bigint)
returns jsonb
language sql
security definer
set search_path = public, net
as $$
  select jsonb_build_object('status', r.status_code, 'body', r.content, 'error', r.error_msg)
  from net._http_response r
  where r.id = p_id;
$$;

revoke all on function public.hunter_net_get(text, int) from public, anon, authenticated;
revoke all on function public.hunter_net_result(bigint) from public, anon, authenticated;
grant execute on function public.hunter_net_get(text, int) to service_role;
grant execute on function public.hunter_net_result(bigint) to service_role;
