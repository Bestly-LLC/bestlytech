-- Centering YOU weekly draft maker (2026-10-04). Jared: "Centering You should run once a week" — she is a client, so
-- the Pi job cy_maker writes ONE carousel a week into Studio as an internal draft (Drafts > To review). It never sets
-- stage = client and never posts: a person reviews it, sends it to her board, and she signs off as usual.
-- All writes go through this one function so a draft is never half-made (item + slides + platform captions + note).
create or replace function public.cy_maker_insert(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client uuid;
  v_item uuid := gen_random_uuid();
  v_spark uuid;
  v_code text;
  s jsonb;
  v jsonb;
  i int := 0;
begin
  select id into v_client from approval_clients where slug = coalesce(p->>'client', 'centering-you');
  if v_client is null then raise exception 'cy_maker_insert: unknown client'; end if;
  select id into v_spark from approval_staff where is_system and name = 'Spark' limit 1;
  perform set_config('bestly.actor', jsonb_build_object('kind', 'robot', 'name', 'Spark',
                     'via', 'Pi weekly maker (cy_maker)')::text, true);

  insert into approval_items (id, client_id, title, caption, media_url, media_type, stage, internal_status, status,
                              provenance, audience)
  values (v_item, v_client, p->>'title', p->>'caption', p->'slides'->0->>'media_url', 'carousel', 'internal',
          'pending', 'pending',
          jsonb_build_object('made_by', 'Spark', 'made_in', 'cy_maker') || coalesce(p->'provenance', '{}'::jsonb),
          coalesce(p->>'audience', 'parents'));

  for s in select * from jsonb_array_elements(p->'slides') loop
    i := i + 1;
    insert into approval_slides (item_id, media_url, position, copy) values (v_item, s->>'media_url', i, s->'copy');
  end loop;

  for v in select * from jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) loop
    insert into approval_variants (item_id, platform, caption, hashtags, alt_text, notes)
    values (v_item, v->>'platform', v->>'caption',
            array(select jsonb_array_elements_text(coalesce(v->'hashtags', '[]'::jsonb))), v->>'alt_text', v->>'notes');
  end loop;

  if coalesce(p->>'note', '') <> '' then
    insert into approval_reviews (item_id, decision, note, reviewer_kind, staff_id)
    values (v_item, null, p->>'note', 'staff', v_spark);
  end if;

  select code into v_code from approval_items where id = v_item;
  return jsonb_build_object('id', v_item, 'code', v_code, 'slides', i);
end;
$function$;

revoke all on function public.cy_maker_insert(jsonb) from public, anon, authenticated;
grant execute on function public.cy_maker_insert(jsonb) to service_role;

-- The maker checks its words against the same product rule the stage gate uses, before it renders anything.
create or replace function public.cy_maker_sells(p_text text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(p_text ~* b.product_terms, false)
    from client_brand b join approval_clients c on c.id = b.client_id where c.slug = 'centering-you';
$$;
revoke all on function public.cy_maker_sells(text) from public, anon, authenticated;
grant execute on function public.cy_maker_sells(text) to service_role;

-- What reviewers said about Centering YOU carousels lately (staff and client notes, newest first), and how the
-- maker's own drafts fared. The maker reads this every week before writing.
create or replace function public.cy_maker_feedback(p_days int default 45)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'notes', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', r.created_at, 'who', r.reviewer_kind, 'decision', r.decision, 'post', i.title,
                                  'by_maker', coalesce(i.provenance->>'made_in', '') = 'cy_maker', 'note', left(r.note, 400)) x
          from approval_reviews r join approval_items i on i.id = r.item_id join approval_clients c on c.id = i.client_id
          left join approval_staff st on st.id = r.staff_id
         where c.slug = 'centering-you' and i.media_type = 'carousel' and r.note is not null
           and coalesce(st.is_system, false) = false and r.created_at > now() - make_interval(days => p_days)
         order by r.created_at desc limit 30) q), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'made', i.created_at, 'internal', i.internal_status,
                                                          'client', i.status, 'stage', i.stage, 'topic', i.provenance->>'topic',
                                                          'template', i.provenance->>'template') order by i.created_at desc)
                        from approval_items i join approval_clients c on c.id = i.client_id
                       where c.slug = 'centering-you' and i.provenance->>'made_in' = 'cy_maker'), '[]'::jsonb),
    'titles', coalesce((select jsonb_agg(i.title) from approval_items i join approval_clients c on c.id = i.client_id
                         where c.slug = 'centering-you' and i.title is not null), '[]'::jsonb));
$$;
revoke all on function public.cy_maker_feedback(int) from public, anon, authenticated;
grant execute on function public.cy_maker_feedback(int) to service_role;

insert into public.pi_jobs (job, enabled, max_gap_min) values ('cy_maker', true, 10140)   -- weekly + a day
on conflict (job) do update set enabled = true, max_gap_min = 10140;
