-- House autopost part 6a: the OLD direct-post paths stop posting anything Jared has not approved (Spark, 2026-10-14).
-- What was posting with no review, and what it does now:
--   1. social_bank_tick (pg_cron social-bank-tick 8:30 AM UTC) -> social-render queue_next -> social_bank_commit -> social_posts
--      for brands in social_brand_settings WHERE enabled (cookieyeti, inventoryproof were enabled; Pi brand_maker fills the bank).
--      Now: those brands are enabled=false (part 3), and any bank commit lands in the insert gate below.
--   2. Pi hoku_maker inserts queued social_posts rows for HOKU every night (no review). Now: the insert gate files it as a
--      Studio draft instead.
--   3. Pi bestly_social (daily card, Tuesday carousel) calls bestly-ig-poster action=post and bestly-fb-photo directly for
--      @bestly_llc. Now: those edge functions file a Studio draft instead (house_direct_gate) and post nothing.
--   4. bestly-ig-poster action=queue (anyone with the key) inserts social_posts. Same insert gate.
-- Whatever reaches social_posts for a house account without an approved Studio item is never claimed by the drain either
-- (claim_next_social_post), so even a path nobody has found yet cannot publish.
-- Rollback: select house_autopost_rollback_old_paths();  (re-enables the bank settings from house_autopost_backup and drops the gate)

-- 1. Is this queued post still cleared? (approved by a human for THIS content version) --------------------
create or replace function public.house_post_cleared(p_post uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select coalesce((public.studio_clear_state(i.id)->>'ok')::boolean, false)
                          and sp.content_version is not distinct from i.content_version
                     from public.social_posts sp join public.approval_items i on i.id = sp.approval_item_id
                    where sp.id = p_post), false)
$$;
revoke all on function public.house_post_cleared(uuid) from public, anon, authenticated;

-- 2. Filing helper: a direct-post attempt becomes a Studio draft (Drafts > To review), signed Spark -------------
create or replace function public.house_direct_to_review(p_brand text, p_urls text[], p_type text, p_caption text, p_source text, p_cover text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_client uuid; v_slug text; v_item uuid := gen_random_uuid(); v_code text; v_title text; v_n int; v_dup record; v_type text; v_first text; i int;
begin
  select c.id, c.slug into v_client, v_slug
    from approval_client_accounts m join social_accounts a on a.id = m.account_id join approval_clients c on c.id = m.client_id
   where a.brand = p_brand and c.active order by (c.slug = 'bestly-cloud') desc, c.slug limit 1;
  if v_client is null then return jsonb_build_object('ok', false, 'error', 'no_house_client'); end if;
  v_first := p_urls[1];
  if v_first is null then return jsonb_build_object('ok', false, 'error', 'no_media'); end if;
  select id, code into v_dup from approval_items where client_id = v_client and provenance->>'source_media' = v_first limit 1;
  if v_dup.id is not null then return jsonb_build_object('ok', true, 'filed', true, 'already', true, 'code', v_dup.code, 'item', v_dup.id, 'client', v_slug); end if;
  select count(*) into v_n from approval_items
   where client_id = v_client and stage = 'internal' and coalesce(internal_status, 'pending') = 'pending' and provenance->>'made_in' = 'direct-path';
  if v_n >= 3 then
    return jsonb_build_object('ok', true, 'filed', false, 'reason', 'queue_full', 'detail', 'Three of these already wait in To review for ' || v_slug || '. Nothing was posted.');
  end if;
  v_type := case when p_type in ('video', 'reel') then 'video' when coalesce(array_length(p_urls, 1), 1) > 1 then 'carousel' else 'image' end;
  v_title := left(coalesce(nullif(split_part(coalesce(p_caption, ''), E'\n', 1), ''), 'Post for ' || p_brand), 80);
  perform set_config('bestly.actor', jsonb_build_object('kind', 'robot', 'name', 'Spark', 'via', 'direct-post gate')::text, true);
  insert into approval_items (id, client_id, title, caption, media_url, thumb_url, media_type, stage, internal_status, status, provenance)
  values (v_item, v_client, v_title, p_caption, v_first, coalesce(p_cover, case when v_type <> 'video' then v_first end), v_type, 'internal', 'pending', 'pending',
          jsonb_build_object('made_by', 'Spark', 'made_in', 'direct-path', 'source', p_source, 'source_media', v_first, 'brand', p_brand));
  if v_type = 'carousel' then
    for i in 1..array_length(p_urls, 1) loop
      insert into approval_slides (item_id, position, media_url) values (v_item, i, p_urls[i]);
    end loop;
  end if;
  insert into approval_variants (item_id, platform, caption, hashtags) values (v_item, 'instagram', coalesce(p_caption, ''), '{}');
  select code into v_code from approval_items where id = v_item;
  return jsonb_build_object('ok', true, 'filed', true, 'code', v_code, 'item', v_item, 'client', v_slug);
end $$;
revoke all on function public.house_direct_to_review(text, text[], text, text, text, text) from public, anon, authenticated;

-- Edge functions (bestly-ig-poster action=post, bestly-fb-photo) call this instead of publishing for a house account
create or replace function public.house_direct_gate(p_brand text, p_urls text[], p_type text, p_caption text, p_source text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if not public.is_house_brand(p_brand) then return jsonb_build_object('house', false); end if;
  r := public.house_direct_to_review(p_brand, p_urls, p_type, p_caption, p_source);
  return jsonb_build_object('house', true) || r;
end $$;
revoke all on function public.house_direct_gate(text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.house_direct_gate(text, text[], text, text, text) to service_role;

-- 3. The insert gate: a house post with no Studio item never gets queued -----------------------------------
create or replace function public.trg_social_posts_house_gate() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if new.approval_item_id is not null or new.status <> 'queued' then return new; end if;
  if coalesce(current_setting('studio.allow_direct', true), '') = 'on' then return new; end if;
  if not public.is_house_brand(new.brand) then return new; end if;
  r := public.house_direct_to_review(new.brand, coalesce(new.media_urls, array[new.media_url]), new.media_type, new.caption, 'social_posts insert');
  new.status := 'canceled';
  new.error := case when coalesce((r->>'filed')::boolean, false)
                    then 'Not posted: filed to Studio Drafts > To review as ' || coalesce(r->>'code', '?') || '. Posts need Jared''s Approve in Studio.'
                    else 'Not posted: ' || coalesce(r->>'detail', r->>'error', 'needs Jared''s Approve in Studio') end;
  return new;
end $$;
create or replace trigger social_posts_house_gate before insert on public.social_posts for each row execute function public.trg_social_posts_house_gate();

-- 4. The drain only claims house posts that are still approved for the version that was queued ----------------
create or replace function public.claim_next_social_post(p_platform text)
returns setof social_posts language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  update public.social_posts sp
     set status = 'posting', attempts = sp.attempts + 1, claimed_at = now()
   where sp.id = (
     select s.id
       from public.social_posts s
       join public.social_accounts a
         on a.brand = s.brand and a.platform = s.platform and a.active
        and not a.publishing_paused
        and a.access_token is not null and a.remote_user_id is not null
      where s.platform = p_platform and s.status = 'queued' and s.scheduled_at <= now()
        and (not public.is_house_brand(s.brand) or (s.approval_item_id is not null and public.house_post_cleared(s.id)))
      order by s.scheduled_at asc
      limit 1
      for update of s skip locked
   )
  returning sp.*;
end;
$$;

-- 5. Rollback ---------------------------------------------------------------------------------------------
create or replace function public.house_autopost_rollback_old_paths() returns text
language plpgsql security definer set search_path to 'public' as $$
begin
  drop trigger if exists social_posts_house_gate on public.social_posts;
  update public.social_brand_settings s set enabled = coalesce((b.data->>'enabled')::boolean, s.enabled),
         posts_per_week = coalesce((b.data->>'posts_per_week')::int, s.posts_per_week)
    from public.house_autopost_backup b where b.key = 'social_brand_settings:' || s.brand;
  return 'gate trigger dropped; bank settings restored from house_autopost_backup. The drain gate (claim_next_social_post) and edge-function gates are separate: redeploy the previous edge functions and restore the previous claim function to fully undo.';
end $$;
revoke all on function public.house_autopost_rollback_old_paths() from public, anon, authenticated;
