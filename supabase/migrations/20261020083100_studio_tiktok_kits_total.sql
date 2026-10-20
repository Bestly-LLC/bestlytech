-- The drafts list said "0 of 5 done" while the panel said "1 of 6": the list left the Post step out and had no total.
-- Both now count the same steps: caption, AI label, location (only when the clip has a place), cover, Duet/Stitch, Post.
create or replace function public.studio_tiktok_kits(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.studio_caller; r record; out jsonb := '[]'::jsonb; k jsonb; v_code text; n int; t int;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  for r in
    select sp.id, sp.approval_item_id, sp.status, c.slug as client_slug
      from social_posts sp
      join approval_items i on i.id = sp.approval_item_id
      join approval_clients c on c.id = i.client_id
     where sp.platform = 'tiktok' and sp.status in ('queued', 'posting', 'in_drafts')
     order by sp.created_at desc limit 40
  loop
    if not public.staff_may_see_item(s.id, r.approval_item_id) then continue; end if;
    k := public.tiktok_kit_json(r.id);
    if k is null then continue; end if;
    v_code := case when r.status = 'in_drafts' then public.tiktok_kit_mint(r.id) end;
    t := 5 + case when coalesce(k->>'place', '') <> '' then 1 else 0 end;
    n := (select count(*) from jsonb_each(coalesce(k->'checks', '{}'::jsonb)) e
           where e.value = 'true'::jsonb and e.key in ('caption', 'ai', 'location', 'cover', 'duet', 'post')
             and (e.key <> 'location' or t = 6));
    out := out || jsonb_build_array(jsonb_build_object(
      'post', r.id, 'item', r.approval_item_id, 'client', r.client_slug, 'status', r.status,
      'title', k->>'title', 'code', k->>'code', 'cover', k->>'cover', 'done', n, 'total', t,
      'link', case when v_code is not null then 'https://bestly.tech/k/' || v_code end));
  end loop;
  return jsonb_build_object('ok', true, 'kits', out);
end $$;
