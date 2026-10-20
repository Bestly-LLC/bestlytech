-- Minute News Daily TikTok caption + hand-off (2026-10-20).
-- Why: TikTok's inbox/draft upload (video.upload) takes no caption, TikTok pre-fills "#bestlystudio". So the real caption has to reach
-- Jared another way until Direct Post (video.publish) is approved. Two parts:
--   1. every minutenewsdaily TikTok social_posts row gets a TikTok-ready caption composed at insert (deterministic, no AI)
--   2. when tiktok-inbox moves the row to 'in_drafts', Anchor leaves one recap-only note (severity 'success', silent) with the caption to paste
-- approval_variants is deliberately NOT touched: any insert/update there withdraws the item's approval (unapprove_on_edit).
-- Undo: bestly_memory build/mnd-tiktok-caption-handoff-2026-10-20
--   alter table public.social_posts disable trigger social_posts_0_mnd_tiktok_caption; alter table public.social_posts disable trigger social_posts_mnd_tiktok_handoff;

create or replace function public.mnd_tiktok_caption(p_item uuid, p_extra text[] default '{}', p_ai_line boolean default false)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  it approval_items%rowtype; v_vcap text; v_vtags text[]; v_hook text; v_body text; v_ctx text; v_src text; v_place text;
  v_base text[] := '{}'; v_tags text[] := '{}'; v_slots int; t text; m text[]; v_out text; v_ai text := '';
  v_ban text[] := array['fyp','foryou','foryoupage','viral','like','follow','fy','xyzbca','news','minutenewsdaily'];
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return null; end if;
  select caption, hashtags into v_vcap, v_vtags from approval_variants
   where item_id = p_item and platform = 'tiktok' order by created_at desc limit 1;

  -- hook: the Pi's one-line hook (variant text before "Source:"), else the item title
  v_hook := nullif(btrim(split_part(regexp_replace(coalesce(v_vcap, ''), '\s*Source:.*$', '', 's'), E'\n', 1)), '');
  v_hook := coalesce(v_hook, nullif(btrim(it.title), ''));
  if v_hook is null then return null; end if;
  if v_hook !~ '[.!?]$' then v_hook := v_hook || '.'; end if;

  -- context: first sentence of the item's first paragraph (a period after a capital, as in "U.S.", is not a sentence end)
  v_body := btrim(regexp_replace(regexp_replace(coalesce(it.caption, ''), E'\\s*\\n\\s*\\n.*$', '', 's'), '\s*Source:.*$', '', 's'));
  m := regexp_match(v_body, '^(.*?[a-z0-9)"''’”][.!?])\s+[A-Z]', 's');
  v_ctx := nullif(btrim(coalesce(m[1], v_body)), '');
  if v_ctx is not null and lower(v_ctx) = lower(v_hook) then v_ctx := null; end if;

  v_src := nullif(btrim(it.provenance->>'source_channel'), '');

  -- place tag: first part of the geocoded label ("Doral, Miami-Dade County, Florida" -> doral)
  v_place := lower(regexp_replace(split_part(coalesce(it.provenance->'place'->>'label', ''), ',', 1), '[^A-Za-z0-9]', '', 'g'));
  if v_place = '' or v_place = any(v_ban) then v_place := null; end if;

  -- topic tags: extras first, then the Pi's topic hashtags; never #fyp-style tags, the brand tag, or #news (added last)
  foreach t in array coalesce(p_extra, '{}') || coalesce(v_vtags, '{}') loop
    t := lower(regexp_replace(t, '[^A-Za-z0-9]', '', 'g'));
    if t <> '' and not (t = any(v_ban)) and not (t = any(v_base)) and t is distinct from v_place then v_base := array_append(v_base, t); end if;
  end loop;
  v_slots := 4 - case when v_place is null then 0 else 1 end;
  v_tags := v_base[1:v_slots];
  if v_place is not null then v_tags := array_append(v_tags, v_place); end if;
  v_tags := array_append(v_tags, 'news');
  if array_length(v_tags, 1) < 3 then v_tags := array_append(v_tags, 'minutenewsdaily'); end if;

  if p_ai_line then v_ai := E'\n' || case when coalesce(it.provenance->>'ai_voice', '') = 'true' then 'AI voice' else 'AI-generated' end; end if;

  v_out := v_hook || coalesce(E'\n\n' || v_ctx, '') || coalesce(E'\n\nSource: ' || v_src, '')
           || E'\n\n' || (select string_agg('#' || x, ' ') from unnest(v_tags) x);
  if length(v_out || v_ai) > 2200 then   -- never cut mid-sentence: leave out the context sentence instead
    v_out := v_hook || coalesce(E'\n\nSource: ' || v_src, '') || E'\n\n' || (select string_agg('#' || x, ' ') from unnest(v_tags) x);
  end if;
  return v_out || v_ai;
end $$;

-- 1. compose at insert. Named so it sorts BEFORE social_posts_ai_label, which then appends its "AI voice" line as before.
create or replace function public.trg_mnd_tiktok_caption() returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if new.platform = 'tiktok' and new.brand = 'minutenewsdaily' and new.approval_item_id is not null then
    begin
      v := public.mnd_tiktok_caption(new.approval_item_id);
      if v is not null then new.caption := v; end if;
    exception when others then null;   -- never block a post over a caption
    end;
  end if;
  return new;
end $$;
create or replace trigger social_posts_0_mnd_tiktok_caption before insert on public.social_posts
  for each row execute function public.trg_mnd_tiktok_caption();

-- 2. hand-off when the draft lands. severity 'success' is silent and lands in the 7 PM recap + the admin bell (admin_notifications_classify).
create or replace function public.trg_mnd_tiktok_handoff() returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  select coalesce(nullif(btrim(title), ''), 'a clip') into v_title from approval_items where id = new.approval_item_id;
  insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key, agent_slug)
  values ('mnd', 'Anchor: ' || coalesce(v_title, 'a clip') || ' is in your TikTok drafts',
          E'Paste this caption:\n\n' || coalesce(new.caption, '') || E'\n\nTurn on AI-generated content, pick the headline frame as cover, tag the location.',
          '/admin', 'mnd.tiktok:' || new.id::text, 'success', 'mnd-tiktok-caption-' || new.id::text, 'anchor')
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  return new;   -- a note must never fail the status change
end $$;
create or replace trigger social_posts_mnd_tiktok_handoff after update of status on public.social_posts
  for each row when (new.status = 'in_drafts' and old.status is distinct from 'in_drafts' and new.platform = 'tiktok' and new.brand = 'minutenewsdaily' and new.approval_item_id is not null)
  execute function public.trg_mnd_tiktok_handoff();

-- 3. backfill the two clips already in the TikTok queue (MN02 G20, MN01 Star Shield), with specific extra tags
update public.social_posts set caption = public.mnd_tiktok_caption(approval_item_id, array['g20'], true)
 where id = 'f0a93e23-704e-45d3-890d-88ebbf275151' and platform = 'tiktok' and brand = 'minutenewsdaily';
update public.social_posts set caption = public.mnd_tiktok_caption(approval_item_id, array['starshield','starlink'], true)
 where id = 'a87bab9c-9cb3-4017-9ea4-8a5ecf60ef89' and platform = 'tiktok' and brand = 'minutenewsdaily';
