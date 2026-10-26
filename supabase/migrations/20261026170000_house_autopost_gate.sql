-- House autopost gate (Spark), 2026-10-26.
-- Jared, 4:26 PM: "Bestly, HOKU, Cookie Yeti and IP should be autoposting, I shouldn't be approving anything."
-- Supersedes the Oct 13-14 rule that house-brand posts need his Approve (bestly-cloud, bestly-studio, bestly-agent,
-- hoku, cookie-yeti, inventoryproof). Client rules and the MND / WeHo manual rules are NOT touched.
--
-- The gate replaces his eyes. A pending house item auto-approves only if house_gate_check() passes:
--   claim rules, product pointer, no "..." truncation, media checked by the Pi (music bed, safe box, text size,
--   readable, not blank), no near-duplicate caption / opening / picture / look against the last 60 posts and
--   everything queued, Bestly Cloud videos show the 3D unit. A fail is auto-rejected (killed, reason on the item,
--   undo with house_gate_restore) and never posted.
-- Undo for the whole change: bestly_memory build/house-autopost-2026-10-26-orig/*, and
--   update approval_clients set publish_mode = 'push' where slug in (...)  (HOKU stays 'auto'),
--   select cron.unschedule('house-gate-run'); select cron.unschedule('house-gate-watch');

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- tables
create table if not exists public.house_gate_brand (
  client_slug text primary key,
  product_terms text not null,          -- the caption must match this (regex, case-insensitive): "every post hooks back to the product"
  backlog_max int not null default 10,  -- approved-and-not-posted items allowed ahead for the shared account; more wait
  auto_since timestamptz,
  note text
);
insert into public.house_gate_brand (client_slug, product_terms, backlog_max) values
  ('bestly-cloud',   'bestly|private cloud|in-house cloud', 10),
  ('bestly-studio',  'bestly|studio', 10),
  ('bestly-agent',   'bestly|maya', 10),
  ('cookie-yeti',    'cookie yeti|cookieyeti', 8),
  ('inventoryproof', 'inventoryproof|proofy', 10),
  ('hoku',           'hoku', 6)
on conflict (client_slug) do nothing;

create table if not exists public.house_gate_media (
  item_id uuid not null references public.approval_items(id) on delete cascade,
  content_version int not null,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  reasons jsonb not null default '[]'::jsonb,   -- [{k, t}] what the Pi found wrong
  hashes text[] not null default '{}',          -- 64-bit dHash, 16 hex chars each: keyframes (video) or slides (carousel/image)
  endcard text,                                 -- dHash of the last frame (video)
  facts jsonb not null default '{}'::jsonb,
  primary key (item_id, content_version)
);

create table if not exists public.house_gate_post_hash (
  post_id uuid primary key references public.social_posts(id) on delete cascade,
  brand text not null,
  hashes text[] not null default '{}',
  checked_at timestamptz not null default now()
);

create table if not exists public.house_gate_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  item_id uuid,
  client_slug text,
  code text,
  content_version int,
  verdict text not null check (verdict in ('approved', 'rejected')),
  reasons jsonb not null default '[]'::jsonb,   -- [{k, t}]
  undone_at timestamptz
);
create index if not exists house_gate_log_slug_at on public.house_gate_log (client_slug, at desc);
create index if not exists house_gate_log_item on public.house_gate_log (item_id);

alter table public.house_gate_brand enable row level security;
alter table public.house_gate_media enable row level security;
alter table public.house_gate_post_hash enable row level security;
alter table public.house_gate_log enable row level security;
revoke all on public.house_gate_brand, public.house_gate_media, public.house_gate_post_hash, public.house_gate_log from anon, authenticated;
revoke all on sequence public.house_gate_log_id_seq from anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public.house_gate_clean(t text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(lower(regexp_replace(coalesce(t, ''), 'https?://\S+|#\w+|@\w+', ' ', 'g')),
         '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- the first line of a caption, cleaned, first 10 words
create or replace function public.house_gate_open(t text) returns text
language sql immutable set search_path = public as $$
  select array_to_string((string_to_array(public.house_gate_clean((regexp_split_to_array(btrim(coalesce(t, ''), E' \n\r\t'), E'\n+'))[1]), ' '))[1:10], ' ')
$$;

create or replace function public.house_gate_hamming(a text, b text) returns int
language sql immutable set search_path = public as $$
  select case when a is null or b is null or length(a) <> 16 or length(b) <> 16 then 64
              else bit_count(('x' || a)::bit(64) # ('x' || b)::bit(64))::int end
$$;

-- ---------------------------------------------------------------- the check
create or replace function public.house_gate_check(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  it approval_items%rowtype; c approval_clients%rowtype; br house_gate_brand%rowtype; m house_gate_media%rowtype;
  g uuid[]; v_brand text; reasons jsonb := '[]'::jsonb; v_wait text; txt record; cr jsonb; o record;
  v_cap text; v_open text; v_sim real; v_best real := 0; v_best_code text; v_obest real := 0; v_ocode text;
  v_vcode text; v_n int; v_backlog int; v_fp jsonb; v_slides int; v_hoku text; v_matches int; v_need int;
  v_pcode text; v_checks jsonb := '{}'::jsonb;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'wait', false, 'reasons', jsonb_build_array(jsonb_build_object('k', 'no_item', 't', 'item not found'))); end if;
  select * into c from approval_clients where id = it.client_id;
  select * into br from house_gate_brand where client_slug = c.slug;
  if br.client_slug is null then return jsonb_build_object('ok', false, 'wait', true, 'wait_why', 'not a gated house brand', 'reasons', '[]'::jsonb); end if;
  g := public.studio_group(c.id); v_brand := public.studio_brand_of(c.id);

  -- 1. hard claim rules + the brand's soft words, on every piece of text this post carries
  for txt in
    select 'title' w, it.title t union all select 'caption', it.caption
    union all select 'a platform caption', v.caption from approval_variants v where v.item_id = it.id
    union all select 'slide ' || s.position, s.copy::text from approval_slides s where s.item_id = it.id and s.copy is not null
  loop
    continue when coalesce(txt.t, '') = '';
    cr := public.claim_check(c.slug, txt.t, 'house-gate');
    if coalesce((cr->>'ok')::boolean, true) is false and coalesce(cr->>'severity', 'hard') = 'hard' then
      reasons := reasons || jsonb_build_object('k', 'claim', 't', 'Claim rule on the ' || txt.w || ': ' || coalesce(cr->>'reason', 'blocked'));
    end if;
    if c.slug = 'hoku' then
      v_hoku := public.hoku_soft_claim_violation(txt.t);
      if coalesce(v_hoku, '') <> '' then reasons := reasons || jsonb_build_object('k', 'claim', 't', 'HOKU word list on the ' || txt.w || ': ' || v_hoku); end if;
    end if;
    -- 3. no "..." truncation anywhere
    if txt.t ~ '\.\.\.|…' then
      reasons := reasons || jsonb_build_object('k', 'ellipsis', 't', 'The ' || txt.w || ' is cut off with "..."');
    end if;
  end loop;

  -- 2. every post hooks back to the product
  if coalesce(it.caption, '') !~* br.product_terms then
    reasons := reasons || jsonb_build_object('k', 'product', 't', 'The caption never names the product (' || br.product_terms || ')');
  end if;
  if coalesce(array_length(public.post_sells_product(it.id), 1), 0) > 0 then
    reasons := reasons || jsonb_build_object('k', 'product', 't', array_to_string(public.post_sells_product(it.id), '; '));
  end if;

  -- basic media presence
  if coalesce(it.media_url, '') = '' then reasons := reasons || jsonb_build_object('k', 'media', 't', 'No media on the post'); end if;
  if it.media_type = 'carousel' then
    select count(*) into v_slides from approval_slides where item_id = it.id and coalesce(media_url, '') <> '';
    if v_slides < 2 then reasons := reasons || jsonb_build_object('k', 'media', 't', 'Carousel has fewer than 2 slides'); end if;
  end if;

  -- 5/6. duplicate check against the last 60 posts plus everything queued (this brand's shared account)
  v_cap := public.house_gate_clean(it.caption); v_open := public.house_gate_open(it.caption);
  for o in
    select x.* from (
      select i.id, i.code, i.caption cap, 'item'::text src, coalesce(i.posted_at, i.scheduled_at, i.created_at) ts
        from approval_items i
       where i.client_id = any(g) and i.id <> it.id and coalesce(i.internal_status, '') <> 'killed' and i.parked_at is null
         and (i.posted_at is not null or i.scheduled_at is not null or i.internal_status = 'approved')
      union all
      select sp.id, null, sp.caption, 'post', coalesce(sp.posted_at, sp.scheduled_at, sp.created_at)
        from social_posts sp
       where sp.brand = v_brand and sp.status in ('posted', 'queued', 'posting')
         and sp.approval_item_id is null
    ) x order by x.ts desc limit 120
  loop
    v_sim := similarity(v_cap, public.house_gate_clean(o.cap));
    if v_sim > v_best then v_best := v_sim; v_best_code := coalesce(o.code, 'an earlier post'); end if;
    if length(v_open) >= 12 and public.house_gate_open(o.cap) <> '' then
      v_sim := case when v_open = public.house_gate_open(o.cap) then 1 else similarity(v_open, public.house_gate_open(o.cap)) end;
      if v_sim > v_obest then v_obest := v_sim; v_ocode := coalesce(o.code, 'an earlier post'); end if;
    end if;
  end loop;
  if v_best >= 0.62 then
    reasons := reasons || jsonb_build_object('k', 'dup_caption', 't', 'Caption is ' || round(v_best * 100) || '% the same as ' || v_best_code);
  end if;
  if v_obest >= 0.75 then
    reasons := reasons || jsonb_build_object('k', 'dup_opening', 't', 'Same opening line as ' || v_ocode);
  end if;
  v_checks := v_checks || jsonb_build_object('caption_best', round(v_best::numeric, 2), 'opening_best', round(v_obest::numeric, 2));

  -- Pi media facts (music, safe box, text size, blank) and the picture check
  select * into m from house_gate_media where item_id = it.id and content_version = it.content_version;
  if m.item_id is null then
    v_wait := 'media check has not run yet';
  else
    if not m.ok then
      reasons := reasons || coalesce(m.reasons, '[]'::jsonb);
    end if;
    v_checks := v_checks || jsonb_build_object('media', m.facts);
    -- same picture: >= half of the keyframes within 6 bits of the same keyframe of another post
    v_need := greatest(1, ceil(least(coalesce(array_length(m.hashes, 1), 1), 3) / 2.0)::int);
    for o in
      select i.code, om.hashes from house_gate_media om
        join approval_items i on i.id = om.item_id and om.content_version = i.content_version
       where i.client_id = any(g) and i.id <> it.id and coalesce(i.internal_status, '') <> 'killed'
         and (i.posted_at is not null or i.scheduled_at is not null or i.internal_status = 'approved')
       order by coalesce(i.posted_at, i.scheduled_at, i.created_at) desc limit 120
    loop
      v_matches := 0;
      for v_n in 1..least(coalesce(array_length(m.hashes, 1), 0), coalesce(array_length(o.hashes, 1), 0)) loop
        if public.house_gate_hamming(m.hashes[v_n], o.hashes[v_n]) <= 6 then v_matches := v_matches + 1; end if;
      end loop;
      if v_matches >= v_need and coalesce(array_length(m.hashes, 1), 0) > 0 then v_vcode := o.code; exit; end if;
    end loop;
    if v_vcode is null and coalesce(array_length(m.hashes, 1), 0) > 0 then
      for o in
        select ph.hashes from house_gate_post_hash ph where ph.brand = v_brand
         order by ph.checked_at desc limit 60
      loop
        v_matches := 0;
        for v_n in 1..least(coalesce(array_length(m.hashes, 1), 0), coalesce(array_length(o.hashes, 1), 0)) loop
          if public.house_gate_hamming(m.hashes[v_n], o.hashes[v_n]) <= 6 then v_matches := v_matches + 1; end if;
        end loop;
        if v_matches >= v_need then v_vcode := 'an earlier post'; exit; end if;
      end loop;
    end if;
    if v_vcode is not null then
      reasons := reasons || jsonb_build_object('k', 'dup_visual', 't', 'Same picture as ' || v_vcode);
    end if;
  end if;

  -- same layout + accent color + music as a recent video of this brand (Studio's look ledger)
  if it.media_type = 'video' then
    select l.fingerprint into v_fp from studio_look_ledger l
     where l.item_code = it.code and l.brand_slug = c.slug and not l.superseded order by l.created_at desc limit 1;
    if v_fp is not null then
      select i.code into v_pcode from approval_items i
        join lateral (select l2.fingerprint from studio_look_ledger l2 where l2.item_code = i.code and l2.brand_slug = (select slug from approval_clients where id = i.client_id) and not l2.superseded order by l2.created_at desc limit 1) lf on true
       where i.client_id = any(g) and i.id <> it.id and i.media_type = 'video' and coalesce(i.internal_status, '') <> 'killed'
         and (i.posted_at is not null or i.scheduled_at is not null or i.internal_status = 'approved')
         and lf.fingerprint->>'layout' = v_fp->>'layout' and lf.fingerprint->>'accent' = v_fp->>'accent'
         and lf.fingerprint->>'track' is not distinct from v_fp->>'track'
       order by coalesce(i.posted_at, i.scheduled_at, i.created_at) desc limit 1;
      if v_pcode is not null then
        reasons := reasons || jsonb_build_object('k', 'look', 't', 'Same layout, color and music as ' || v_pcode);
      end if;
    end if;
    -- Bestly Cloud videos show the 3D unit
    if c.slug = 'bestly-cloud' and coalesce(nullif(v_fp->>'unit', ''), nullif(it.provenance->'look'->>'unit', ''), 'none') = 'none' then
      reasons := reasons || jsonb_build_object('k', 'unit', 't', 'Bestly Cloud video does not show the 3D unit');
    end if;
  end if;

  -- backlog: do not stack more than a short run of finished posts ahead of the calendar
  if v_wait is null then
    select count(*) into v_backlog from approval_items i
     where i.client_id = any(g) and i.posted_at is null and i.internal_status = 'approved' and i.parked_at is null and i.id <> it.id;
    if v_backlog >= br.backlog_max and jsonb_array_length(reasons) = 0 then v_wait := v_backlog || ' finished posts are already queued ahead of it'; end if;
  end if;

  return jsonb_build_object('ok', jsonb_array_length(reasons) = 0 and v_wait is null, 'wait', v_wait is not null,
                            'wait_why', v_wait, 'reasons', reasons, 'checks', v_checks);
end $$;

-- ---------------------------------------------------------------- Pi hand-off (service role only)
create or replace function public.house_gate_todo(p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_items jsonb; v_posts jsonb;
begin
  select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) into v_items from (
    select i.id, i.code, c.slug, i.media_type, i.media_url, i.thumb_url, i.content_version, i.created_at,
           coalesce((select jsonb_agg(s.media_url order by s.position) from approval_slides s where s.item_id = i.id), '[]'::jsonb) slides
      from approval_items i join approval_clients c on c.id = i.client_id join house_gate_brand b on b.client_slug = c.slug
     where c.kind = 'house' and i.stage = 'internal' and coalesce(i.internal_status, 'pending') = 'pending'
       and i.posted_at is null and i.parked_at is null
       and not exists (select 1 from house_gate_media gm where gm.item_id = i.id and gm.content_version = i.content_version)
     order by i.created_at limit p_limit) x;
  select coalesce(jsonb_agg(y), '[]'::jsonb) into v_posts from (
    select sp.id, sp.brand, coalesce(sp.cover_url, sp.media_urls[1], sp.media_url) url, sp.media_type
      from social_posts sp
     where sp.brand in ('bestly', 'cookieyeti', 'hoku', 'inventoryproof') and sp.status = 'posted'
       and sp.posted_at > now() - interval '60 days'
       and not exists (select 1 from house_gate_post_hash ph where ph.post_id = sp.id)
     order by sp.posted_at desc limit 4) y;
  return jsonb_build_object('items', v_items, 'posts', v_posts);
end $$;

create or replace function public.house_gate_media_put(p_item uuid, p_version int, p_ok boolean, p_reasons jsonb,
                                                       p_hashes text[], p_endcard text, p_facts jsonb) returns void
language sql security definer set search_path = public as $$
  insert into house_gate_media (item_id, content_version, ok, reasons, hashes, endcard, facts)
  values (p_item, p_version, p_ok, coalesce(p_reasons, '[]'::jsonb), coalesce(p_hashes, '{}'), p_endcard, coalesce(p_facts, '{}'::jsonb))
  on conflict (item_id, content_version) do update
    set ok = excluded.ok, reasons = excluded.reasons, hashes = excluded.hashes, endcard = excluded.endcard,
        facts = excluded.facts, checked_at = now()
$$;

create or replace function public.house_gate_post_hash_put(p_post uuid, p_brand text, p_hashes text[]) returns void
language sql security definer set search_path = public as $$
  insert into house_gate_post_hash (post_id, brand, hashes) values (p_post, p_brand, coalesce(p_hashes, '{}'))
  on conflict (post_id) do update set hashes = excluded.hashes, checked_at = now()
$$;

-- ---------------------------------------------------------------- the decision
create or replace function public.house_gate_run(p_item uuid default null, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  it record; r jsonb; v_out jsonb := '[]'::jsonb; v_ver int; v_why text; v_txt text;
begin
  perform set_config('bestly.actor', jsonb_build_object('kind', 'robot', 'name', 'Spark', 'via', 'house gate')::text, true);
  for it in
    select i.id, i.code, i.content_version, c.slug, i.title
      from approval_items i join approval_clients c on c.id = i.client_id join house_gate_brand b on b.client_slug = c.slug
     where c.kind = 'house' and c.publish_mode = 'auto' and i.stage = 'internal' and coalesce(i.internal_status, 'pending') = 'pending'
       and i.posted_at is null and i.parked_at is null and (p_item is null or i.id = p_item)
     order by i.created_at limit 40
  loop
    r := public.house_gate_check(it.id);
    if coalesce((r->>'wait')::boolean, false) then
      v_out := v_out || jsonb_build_object('code', it.code, 'slug', it.slug, 'verdict', 'waiting', 'why', r->>'wait_why');
      continue;
    end if;
    if coalesce((r->>'ok')::boolean, false) then
      v_out := v_out || jsonb_build_object('code', it.code, 'slug', it.slug, 'verdict', 'approved');
      continue when p_dry;
      v_why := 'House gate: passed every check (claim rules, product pointer, no cut-off text, music and safe box, no duplicate caption, opening, picture or look). Auto-approved; Jared does not approve house posts (2026-10-26).';
      update approval_items set internal_status = 'approved',
             move_override = jsonb_build_object('at', now(), 'by', 'Spark (house gate: passed checks)', 'why', v_why, 'missing', '[]'::jsonb, 'version', it.content_version),
             provenance = coalesce(provenance, '{}'::jsonb) || jsonb_build_object('gate', jsonb_build_object('approved_at', now(), 'checks', r->'checks'))
       where id = it.id;
      insert into approval_item_events (item_id, kind, actor_kind, payload)
      values (it.id, 'note', 'system', jsonb_build_object('by', 'Spark', 'note', v_why));
      insert into house_gate_log (item_id, client_slug, code, content_version, verdict, reasons) values (it.id, it.slug, it.code, it.content_version, 'approved', '[]');
    else
      select string_agg(x->>'t', '; ') into v_txt from jsonb_array_elements(r->'reasons') x;
      v_out := v_out || jsonb_build_object('code', it.code, 'slug', it.slug, 'verdict', 'rejected', 'reasons', r->'reasons');
      continue when p_dry;
      update approval_items set internal_status = 'killed',
             provenance = coalesce(provenance, '{}'::jsonb) || jsonb_build_object('gate', jsonb_build_object('rejected_at', now(), 'reasons', r->'reasons'))
       where id = it.id;
      insert into approval_item_events (item_id, kind, actor_kind, payload)
      values (it.id, 'note', 'system', jsonb_build_object('by', 'Spark', 'note', 'House gate rejected this and sent it back for regeneration: ' || coalesce(v_txt, 'failed a check') || '. It will not post. Undo: select house_gate_restore(''' || it.id || ''').'));
      insert into house_gate_log (item_id, client_slug, code, content_version, verdict, reasons) values (it.id, it.slug, it.code, it.content_version, 'rejected', r->'reasons');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'dry', p_dry, 'items', v_out);
end $$;

-- undo a rejection (the reasons stay in the log)
create or replace function public.house_gate_restore(p_item uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update approval_items set internal_status = 'pending', move_override = null
   where id = p_item and internal_status = 'killed' and provenance ? 'gate';
  if not found then return jsonb_build_object('ok', false, 'error', 'not a gate rejection'); end if;
  update house_gate_log set undone_at = now() where item_id = p_item and verdict = 'rejected' and undone_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- recap + watchdog
create or replace function public.house_gate_daily_line() returns text
language plpgsql stable security definer set search_path = public as $$
declare r record; v_lines text := ''; v_top text; v_post int;
begin
  for r in
    select c.id, c.slug, c.name from approval_clients c join house_gate_brand b on b.client_slug = c.slug
     where c.kind = 'house' and c.publish_mode = 'auto' order by c.name
  loop
    select count(*) into v_post from approval_items i where i.client_id = r.id and i.posted_at > now() - interval '24 hours';
    select string_agg(k || ' ' || n, ', ' order by n desc) into v_top from (
      select x->>'k' k, count(*) n from house_gate_log l, jsonb_array_elements(l.reasons) x
       where l.client_slug = r.slug and l.verdict = 'rejected' and l.at > now() - interval '24 hours' and l.undone_at is null group by 1 order by 2 desc limit 2) q;
    v_lines := v_lines || E'\n' || r.name || ': posted ' || v_post
      || ', auto-approved ' || (select count(*) from house_gate_log l where l.client_slug = r.slug and l.verdict = 'approved' and l.at > now() - interval '24 hours')
      || ', auto-rejected ' || (select count(*) from house_gate_log l where l.client_slug = r.slug and l.verdict = 'rejected' and l.at > now() - interval '24 hours' and l.undone_at is null)
      || coalesce(' (' || v_top || ')', '') || '.';
  end loop;
  if v_lines = '' then return ''; end if;
  return 'Spark, house posts in the last day:' || v_lines;
end $$;

create or replace function public.house_gate_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_days numeric; v_last timestamptz; v_cap int; v_out jsonb := '[]'::jsonb; v_rej int; v_top text; v_wait int;
begin
  for r in
    select c.id, c.slug, c.name, b.auto_since from approval_clients c join house_gate_brand b on b.client_slug = c.slug
     where c.kind = 'house' and c.publish_mode = 'auto'
  loop
    v_cap := public.studio_week_cap(r.id);
    v_days := greatest(2, ceil(7.0 / greatest(v_cap, 1)) + 1);   -- 2 days for a 7-a-week brand, 3 for 5 or 4 a week
    select max(i.posted_at) into v_last from approval_items i where i.client_id = any(public.studio_group(r.id)) and i.posted_at is not null;
    if r.auto_since is not null and r.auto_since > now() - (v_days || ' days')::interval then continue; end if;
    if v_last is null or v_last < now() - (v_days || ' days')::interval then
      select count(*) into v_rej from house_gate_log l where l.client_slug = r.slug and l.verdict = 'rejected' and l.at > now() - interval '3 days' and l.undone_at is null;
      select string_agg(k, ', ') into v_top from (select x->>'k' k from house_gate_log l, jsonb_array_elements(l.reasons) x
         where l.client_slug = r.slug and l.verdict = 'rejected' and l.at > now() - interval '3 days' and l.undone_at is null group by 1 order by count(*) desc limit 3) q;
      select count(*) into v_wait from approval_items i where i.client_id = r.id and i.stage = 'internal' and coalesce(i.internal_status, 'pending') = 'pending' and i.posted_at is null;
      perform public.bestly_raise('house.nopost.' || r.slug, 'problem', 'warning',
        r.name || ' has not posted in ' || v_days::int || ' days',
        'Spark: ' || r.name || ' last posted ' || coalesce(to_char(v_last at time zone 'America/Los_Angeles', 'Mon FMDD FMHH12:MI AM'), 'never')
          || '. The gate rejected ' || v_rej || ' in the last 3 days' || coalesce(' (' || v_top || ')', '') || ' and ' || v_wait
          || ' are waiting on a check. The generator is making replacements; nothing for you to do unless this stays open.', 'studio');
      v_out := v_out || to_jsonb(r.slug);
    else
      perform public.bestly_raise('house.nopost.' || r.slug, 'resolved', 'info', r.name || ' is posting again', null, 'studio', null, true);
    end if;
  end loop;
  return jsonb_build_object('stalled', v_out);
end $$;

-- ---------------------------------------------------------------- the old "three already in review" block
-- The block was Jared's brake while he approved by hand. For a brand on publish_mode 'auto' the gate decides, so the
-- cap is only a backstop (12) against a runaway maker. Everything else in the function is unchanged.
create or replace function public.house_direct_to_review(p_brand text, p_urls text[], p_type text, p_caption text, p_source text, p_cover text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_client uuid; v_slug text; v_mode text; v_item uuid := gen_random_uuid(); v_code text; v_title text; v_n int; v_dup record; v_type text; v_first text; v_cap int; i int;
begin
  select c.id, c.slug, c.publish_mode into v_client, v_slug, v_mode
    from approval_client_accounts m join social_accounts a on a.id = m.account_id join approval_clients c on c.id = m.client_id
   where a.brand = p_brand and c.active order by (c.slug = 'bestly-cloud') desc, c.slug limit 1;
  if v_client is null then return jsonb_build_object('ok', false, 'error', 'no_house_client'); end if;
  v_first := p_urls[1];
  if v_first is null then return jsonb_build_object('ok', false, 'error', 'no_media'); end if;
  select id, code into v_dup from approval_items where client_id = v_client and provenance->>'source_media' = v_first limit 1;
  if v_dup.id is not null then return jsonb_build_object('ok', true, 'filed', true, 'already', true, 'code', v_dup.code, 'item', v_dup.id, 'client', v_slug); end if;
  select count(*) into v_n from approval_items
   where client_id = v_client and stage = 'internal' and coalesce(internal_status, 'pending') = 'pending' and provenance->>'made_in' = 'direct-path';
  v_cap := case when v_mode = 'auto' then 12 else 3 end;
  if v_n >= v_cap then
    return jsonb_build_object('ok', true, 'filed', false, 'reason', 'queue_full', 'detail', v_cap || ' of these already wait to be checked for ' || v_slug || '. Nothing was posted.');
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
end $function$;

create or replace function public.trg_social_posts_house_gate() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare r jsonb; v_auto boolean;
begin
  if new.approval_item_id is not null or new.status <> 'queued' then return new; end if;
  if coalesce(current_setting('studio.allow_direct', true), '') = 'on' then return new; end if;
  if not public.is_house_brand(new.brand) then return new; end if;
  r := public.house_direct_to_review(new.brand, coalesce(new.media_urls, array[new.media_url]), new.media_type, new.caption, 'social_posts insert');
  new.status := 'canceled';
  select exists (select 1 from approval_clients c join approval_client_accounts m on m.client_id = c.id join social_accounts a on a.id = m.account_id
                  where a.brand = new.brand and c.kind = 'house' and c.publish_mode = 'auto') into v_auto;
  new.error := case when coalesce((r->>'filed')::boolean, false)
                    then case when v_auto then 'Not posted yet: filed to Studio as ' || coalesce(r->>'code', '?') || '. The house gate checks it and posts it if it passes.'
                              else 'Not posted: filed to Studio Drafts > To review as ' || coalesce(r->>'code', '?') || '. Posts need Jared''s Approve in Studio.' end
                    else 'Not posted: ' || coalesce(r->>'detail', r->>'error', 'needs a check in Studio') end;
  return new;
end $function$;

-- ---------------------------------------------------------------- lock the new functions down
revoke execute on function public.house_gate_check(uuid), public.house_gate_todo(int), public.house_gate_media_put(uuid, int, boolean, jsonb, text[], text, jsonb),
  public.house_gate_post_hash_put(uuid, text, text[]), public.house_gate_run(uuid, boolean), public.house_gate_restore(uuid),
  public.house_gate_daily_line(), public.house_gate_watch() from public, anon, authenticated;
grant execute on function public.house_gate_check(uuid), public.house_gate_todo(int), public.house_gate_media_put(uuid, int, boolean, jsonb, text[], text, jsonb),
  public.house_gate_post_hash_put(uuid, text, text[]), public.house_gate_run(uuid, boolean), public.house_gate_restore(uuid),
  public.house_gate_daily_line(), public.house_gate_watch() to service_role;
