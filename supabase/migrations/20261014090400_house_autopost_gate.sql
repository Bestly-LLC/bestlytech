-- House autopost part 5 of 6: ONE gate for house brands (Spark, 2026-10-14).
-- Jared: "Approved = my Approve in Studio. Nothing posts until I tap Approve." This supersedes the older rule that
-- InventoryProof / Cookie Yeti / HOKU post directly with no review (2026-10-04).
-- A house post is cleared when (a) a human on the team approved THIS content version and nothing later said otherwise,
-- (b) it is not killed, (c) the house rules (post_sells_product) hold. studio_clear_state feeds the lane, the planner,
-- the tick and the app, so this is the only place the rule lives.

create or replace function public.studio_clear_state(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare it approval_items%rowtype; c approval_clients%rowtype; sg jsonb; cv int; ov jsonb;
  v_miss jsonb := '[]'::jsonb; v_err text; v_client text; e jsonb; v_rules text[]; v_ok_rev boolean;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item', 'missing', '[]'::jsonb); end if;
  if it.posted_at is not null then return jsonb_build_object('ok', false, 'error', 'already_posted', 'missing', '[]'::jsonb); end if;
  select * into c from approval_clients where id = it.client_id;
  v_client := coalesce(nullif(split_part(coalesce(c.contact_name, ''), ' ', 1), ''), c.name);
  if coalesce(it.internal_status, '') = 'killed' then
    return jsonb_build_object('ok', false, 'error', 'killed', 'missing', '[]'::jsonb); end if;
  ov := it.move_override;
  if ov is not null and nullif(ov->>'version', '')::int = it.content_version then
    return jsonb_build_object('ok', true, 'override', true, 'missing', coalesce(ov->'missing', '[]'::jsonb), 'by', ov->>'by', 'why', ov->>'why');
  end if;
  sg := public.studio_signoff(it.id);

  -- House brands: no client in the loop. A human on the team approved this version = cleared.
  if c.kind = 'house' then
    select exists (
      select 1 from approval_reviews r join approval_staff s on s.id = r.staff_id
       where r.item_id = it.id and r.reviewer_kind = 'staff' and r.decision = 'approved'
         and r.content_version = it.content_version and not s.is_system
         and not exists (select 1 from approval_reviews r2 where r2.item_id = it.id and r2.reviewer_kind = 'staff'
                            and r2.decision is not null and r2.created_at > r.created_at))
      into v_ok_rev;
    if coalesce(sg->>'state', 'pending') <> 'approved' or coalesce(it.internal_status, '') <> 'approved' or not coalesce(v_ok_rev, false) then
      v_err := 'not_approved';
      v_miss := v_miss || jsonb_build_object('who', 'Jared', 'what', 'Approve in Studio (this version)');
    else
      v_rules := public.post_sells_product(it.id);
      if coalesce(array_length(v_rules, 1), 0) > 0 then
        v_err := 'held';
        v_miss := v_miss || jsonb_build_object('who', 'House rules', 'what', array_to_string(v_rules, '; '));
      end if;
    end if;
    return jsonb_build_object('ok', v_err is null, 'error', v_err, 'missing', v_miss);
  end if;

  select max(r.content_version) into cv from approval_reviews r
   where r.item_id = it.id and r.reviewer_kind = 'client' and r.decision = 'approved';
  if it.stage <> 'client' then
    v_err := 'not_with_client'; v_miss := v_miss || jsonb_build_object('who', v_client, 'what', 'her yes, and it has not been sent to her yet');
  elsif it.status <> 'approved' then
    v_err := 'not_approved_by_client'; v_miss := v_miss || jsonb_build_object('who', v_client, 'what', 'her yes');
  elsif cv is not null and cv < it.content_version then
    v_err := 'client_saw_older_version'; v_miss := v_miss || jsonb_build_object('who', v_client, 'what', 'her yes on this version');
  end if;
  if coalesce(c.client_yes_is_final, false) then
    if coalesce((sg->>'dual')::boolean, false) and coalesce(sg->>'state', '') in ('killed', 'changes') then
      v_err := coalesce(v_err, 'team_stopped');
      for e in select x from jsonb_array_elements(coalesce(sg->'people', '[]'::jsonb)) x
                where x->>'decision' in ('killed', 'changes') loop
        v_miss := v_miss || jsonb_build_object('who', e->>'name', 'what', 'asked for ' || case when e->>'decision' = 'killed' then 'it to be killed' else 'changes' end);
      end loop;
    elsif coalesce(it.internal_status, '') = 'changes' then
      v_err := coalesce(v_err, 'team_stopped');
      v_miss := v_miss || jsonb_build_object('who', 'The team', 'what', 'asked for changes');
    end if;
  else
    if coalesce(sg->>'state', 'pending') <> 'approved' then
      v_err := coalesce(v_err, 'team_not_signed_off');
      if coalesce((sg->>'dual')::boolean, false) then
        for e in select x from jsonb_array_elements(coalesce(sg->'people', '[]'::jsonb)) x
                  where coalesce(x->>'decision', '') <> 'approved' loop
          v_miss := v_miss || jsonb_build_object('who', e->>'name', 'what', 'sign-off');
        end loop;
      else
        v_miss := v_miss || jsonb_build_object('who', 'The team', 'what', 'sign-off');
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', v_err is null, 'error', v_err, 'missing', v_miss);
end $$;

-- Platforms a house item goes to: its own list, else every ready target the brand has switched on (Instagram only today)
create or replace function public.house_item_platforms(p_item uuid) returns text[]
language plpgsql stable security definer set search_path to 'public' as $$
declare it approval_items%rowtype; v_brand text; st social_brand_settings%rowtype; out text[] := '{}'; t jsonb;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return '{}'; end if;
  v_brand := public.studio_brand_of(it.client_id);
  select * into st from social_brand_settings where brand = v_brand;
  for t in select x from jsonb_array_elements(public.house_post_targets(it.client_id)) x loop
    if (t->>'ready')::boolean and coalesce((st.platforms->>(t->>'platform'))::boolean, (t->>'platform') = 'instagram')
       and (it.platforms is null or (t->>'platform') = any(it.platforms))
       and ((t->>'platform') <> 'tiktok' or it.media_type = 'video') then
      out := out || (t->>'platform');
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.house_item_platforms(uuid) from public, anon, authenticated;
