-- Log rows carry where it happened and its update timeline, so tapping one in /admin Sky shows it on the map (Citizen-style).
create or replace function public.citizen_admin_log(p_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return coalesce((
    select jsonb_agg(r order by r.first_seen desc)
    from (
      select i.key, i.category as cat, i.source, i.title, i.short, i.sub, i.address, i.level,
             i.dist_ft, i.place, i.lat, i.lng,
             (extract(epoch from i.first_seen) * 1000)::bigint as first_seen,
             (extract(epoch from i.closed_at) * 1000)::bigint as closed_at,
             (extract(epoch from i.pinged_at) * 1000)::bigint as pinged_at,
             jsonb_array_length(coalesce(i.updates, '[]'::jsonb)) as n_updates,
             coalesce(i.updates, '[]'::jsonb) as updates
      from public.citizen_incidents i
      where i.first_seen > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
      order by i.first_seen desc
      limit 300
    ) r
  ), '[]'::jsonb);
end $$;
revoke all on function public.citizen_admin_log(int) from public, anon;
grant execute on function public.citizen_admin_log(int) to authenticated;
