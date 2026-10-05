-- The Graveyard on /admin/team: every bot that was let go (status retired), newest first, with why and where its work went.
-- undo_id is set while the reorg can still be undone (7 days), so the card can offer "Bring back".
create or replace function public.admin_graveyard()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select coalesce(jsonb_agg(s.x order by s.x->>'retired_at' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
             'slug', a.slug, 'name', a.name, 'role', a.role, 'icon', a.icon, 'what_it_does', a.what_it_does,
             'retired_at', coalesce(a.profile->>'retired_at', a.updated_at::text),
             'why', r.why, 'into_name', b.name,
             'undo_id', case when r.status = 'done' and r.decided_at > now() - interval '7 days' then r.id end) x
      from bestly_agents a
      left join lateral (select t.* from team_reorgs t where t.slug = a.slug and t.status = 'done' order by t.decided_at desc limit 1) r on true
      left join bestly_agents b on b.slug = r.into_slug
     where a.status = 'retired' and a.kind = 'agent') s);
end $$;
revoke all on function public.admin_graveyard() from public, anon;
grant execute on function public.admin_graveyard() to authenticated;
