-- House gate, part 2 (Spark, 2026-10-26): what the makers read so they stop repeating themselves.
-- Root cause of "it duplicates": the image makers only compared titles against a 14-topic pool, never saw what was
-- already queued, and never saw how posts did. These three functions give every maker the same picture the gate has.
--   house_gate_history(slug, n)   the last n posts + everything queued, what each one looked like, what did best, why the gate
--                                 rejected recent ones, and how many more posts the brand needs
--   house_gate_dup_probe(slug, caption)   the gate's own caption/opening similarity, run before a maker files anything
--   house_gate_need(slug)         posts short of a week of runway (weekly cap minus finished, scheduled and waiting posts)
-- Undo: drop function public.house_gate_history(text, int), public.house_gate_dup_probe(text, text), public.house_gate_need(text);
--       the makers fall back to their old behavior when these are missing (they wrap every call).

create or replace function public.house_gate_need(p_slug text) returns int
language plpgsql stable security definer set search_path = public as $$
declare c approval_clients%rowtype; g uuid[]; v_cap int; v_ahead int; v_wait int;
begin
  select * into c from approval_clients where slug = p_slug;
  if c.id is null then return 0; end if;
  g := public.studio_group(c.id);
  v_cap := greatest(public.studio_week_cap(c.id), 1);
  select count(*) filter (where i.internal_status = 'approved'),
         count(*) filter (where coalesce(i.internal_status, 'pending') = 'pending')
    into v_ahead, v_wait
    from approval_items i
   where i.client_id = any(g) and i.stage = 'internal' and i.posted_at is null and i.parked_at is null
     and coalesce(i.internal_status, '') <> 'killed';
  return greatest(0, v_cap - coalesce(v_ahead, 0) - coalesce(v_wait, 0));
end $$;

create or replace function public.house_gate_dup_probe(p_slug text, p_caption text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare c approval_clients%rowtype; g uuid[]; v_brand text; o record; v_cap text; v_open text; v_sim real;
        v_best real := 0; v_code text; v_obest real := 0; v_ocode text;
begin
  select * into c from approval_clients where slug = p_slug;
  if c.id is null then return jsonb_build_object('ok', true, 'best', 0, 'open_best', 0); end if;
  g := public.studio_group(c.id); v_brand := public.studio_brand_of(c.id);
  v_cap := public.house_gate_clean(p_caption); v_open := public.house_gate_open(p_caption);
  for o in
    select x.* from (
      select i.caption cap, i.code, coalesce(i.posted_at, i.scheduled_at, i.created_at) ts
        from approval_items i
       where i.client_id = any(g) and coalesce(i.internal_status, '') <> 'killed' and i.parked_at is null
         and (i.posted_at is not null or i.scheduled_at is not null or coalesce(i.internal_status, 'pending') in ('approved', 'pending'))
      union all
      select sp.caption, null, coalesce(sp.posted_at, sp.scheduled_at, sp.created_at)
        from social_posts sp where sp.brand = v_brand and sp.status in ('posted', 'queued', 'posting') and sp.approval_item_id is null
    ) x order by x.ts desc limit 160
  loop
    v_sim := similarity(v_cap, public.house_gate_clean(o.cap));
    if v_sim > v_best then v_best := v_sim; v_code := coalesce(o.code, 'an earlier post'); end if;
    if length(v_open) >= 12 and public.house_gate_open(o.cap) <> '' then
      v_sim := case when v_open = public.house_gate_open(o.cap) then 1 else similarity(v_open, public.house_gate_open(o.cap)) end;
      if v_sim > v_obest then v_obest := v_sim; v_ocode := coalesce(o.code, 'an earlier post'); end if;
    end if;
  end loop;
  return jsonb_build_object('ok', v_best < 0.45 and v_obest < 0.6, 'best', round(v_best::numeric, 2), 'code', v_code,
                            'open_best', round(v_obest::numeric, 2), 'open_code', v_ocode);
end $$;

create or replace function public.house_gate_history(p_slug text, p_n int default 60) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare c approval_clients%rowtype; g uuid[]; v_brand text; v_recent jsonb; v_top jsonb; v_rej jsonb; v_looks jsonb;
begin
  select * into c from approval_clients where slug = p_slug;
  if c.id is null then return jsonb_build_object('error', 'no_client'); end if;
  g := public.studio_group(c.id); v_brand := public.studio_brand_of(c.id);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.ts desc), '[]'::jsonb) into v_recent from (
    select * from (
      select i.code, left(coalesce(i.title, ''), 90) title, left(split_part(coalesce(i.caption, ''), E'\n', 1), 120) opening,
             left(coalesce(i.caption, ''), 220) caption, i.media_type,
             case when i.posted_at is not null then 'posted' when i.scheduled_at is not null then 'scheduled'
                  when i.internal_status = 'approved' then 'approved' else 'waiting' end state,
             coalesce(i.posted_at, i.scheduled_at, i.created_at) ts,
             (select max(sp.likes) from social_posts sp where sp.approval_item_id = i.id) likes,
             (select max(sp.comments) from social_posts sp where sp.approval_item_id = i.id) comments,
             i.provenance->>'format' format, i.provenance->>'segment' segment, i.provenance->>'topic' topic
        from approval_items i
       where i.client_id = any(g) and coalesce(i.internal_status, '') <> 'killed' and i.parked_at is null
         and (i.posted_at is not null or i.scheduled_at is not null or coalesce(i.internal_status, 'pending') in ('approved', 'pending'))
      union all
      select null, left(coalesce(split_part(sp.caption, E'\n', 1), ''), 90), left(split_part(coalesce(sp.caption, ''), E'\n', 1), 120),
             left(coalesce(sp.caption, ''), 220), sp.media_type, case when sp.status = 'posted' then 'posted' else 'scheduled' end,
             coalesce(sp.posted_at, sp.scheduled_at, sp.created_at), sp.likes, sp.comments, null, null, null
        from social_posts sp where sp.brand = v_brand and sp.status in ('posted', 'queued', 'posting') and sp.approval_item_id is null
    ) u order by u.ts desc limit greatest(p_n, 1)
  ) r;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top from (
    select r->>'opening' opening, r->>'format' format, (r->>'likes')::int likes, (r->>'comments')::int comments
      from jsonb_array_elements(v_recent) r
     where coalesce((r->>'likes')::int, 0) + 2 * coalesce((r->>'comments')::int, 0) > 0
     order by coalesce((r->>'likes')::int, 0) + 2 * coalesce((r->>'comments')::int, 0) desc limit 5) t;

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_rej from (
    select x->>'k' k, count(*) n, max(x->>'t') example
      from house_gate_log l, jsonb_array_elements(l.reasons) x
     where l.client_slug = p_slug and l.verdict = 'rejected' and l.undone_at is null and l.at > now() - interval '14 days'
     group by 1 order by 2 desc limit 6) t;

  -- the look of the last 12 videos, so a new video can pick a layout / color / music that was not just used
  select coalesce(jsonb_agg(l.fingerprint order by l.created_at desc), '[]'::jsonb) into v_looks from (
    select fingerprint, created_at from studio_look_ledger
     where brand_slug = p_slug and not superseded order by created_at desc limit 12) l;

  return jsonb_build_object('slug', p_slug, 'recent', v_recent, 'top', v_top, 'rejects', v_rej, 'looks', v_looks,
                            'need', public.house_gate_need(p_slug), 'week_cap', public.studio_week_cap(c.id));
end $$;

revoke execute on function public.house_gate_need(text), public.house_gate_dup_probe(text, text), public.house_gate_history(text, int) from public, anon, authenticated;
grant execute on function public.house_gate_need(text), public.house_gate_dup_probe(text, text), public.house_gate_history(text, int) to service_role;
