-- Studio TikTok posting kit (2026-10-20, Jared 1:03 AM PT).
-- Why: TikTok's inbox/draft upload cannot set caption, cover, location or the AI label, so Jared finishes each draft by
-- hand in the TikTok app on his iPhone. The kit is one screen of tap-to-copy cards + a checklist, in Studio (staff token)
-- and standalone at a SHORT link (bestly.tech/k/<7 chars>, no sign-in, expires after 7 days) so it opens from the note.
-- "I posted it" marks the social_posts row 'posted' (remote_id stays null) so Studio and the watchdogs stop waiting.
-- Never uploads anything: the only write to social_posts is in_drafts -> posted.
-- Undo: bestly_memory build/studio-tiktok-kit-2026-10-20-undo

-- ── storage ───────────────────────────────────────────────────────────────
create table if not exists public.tiktok_kit_links (
  code        text primary key check (code ~ '^[a-z0-9]{7}$'),
  post_id     uuid not null references public.social_posts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days'
);
create index if not exists tiktok_kit_links_post_idx on public.tiktok_kit_links (post_id, expires_at desc);

create table if not exists public.tiktok_kit_state (
  post_id     uuid primary key references public.social_posts(id) on delete cascade,
  checks      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.tiktok_kit_links enable row level security;
alter table public.tiktok_kit_state enable row level security;
revoke all on public.tiktok_kit_links, public.tiktok_kit_state from anon, authenticated;

-- ── internals (not callable from the browser) ─────────────────────────────
create or replace function public.tiktok_kit_new_code() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare a constant text := 'abcdefghjkmnpqrstuvwxyz23456789'; s text; b int; i int;
begin
  loop
    s := '';
    while length(s) < 7 loop
      b := get_byte(gen_random_bytes(1), 0);
      if b < 248 then s := s || substr(a, 1 + (b % 31), 1); end if;   -- 248 = 31 * 8: no modulo bias
    end loop;
    exit when not exists (select 1 from tiktok_kit_links where code = s);
  end loop;
  return s;
end $$;

-- a live short code for a TikTok post (mints one when none has at least a day left)
create or replace function public.tiktok_kit_mint(p_post uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v text;
begin
  if not exists (select 1 from social_posts where id = p_post and platform = 'tiktok') then return null; end if;
  select code into v from tiktok_kit_links where post_id = p_post and expires_at > now() + interval '1 day'
   order by expires_at desc limit 1;
  if v is null then
    v := tiktok_kit_new_code();
    insert into tiktok_kit_links (code, post_id) values (v, p_post);
  end if;
  return v;
end $$;

-- the kit itself, one TikTok row
create or replace function public.tiktok_kit_json(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sp social_posts%rowtype; it approval_items%rowtype; cap text; m text[]; tagline text; body text;
        lbl text; srch text; cover text; custom boolean; checks jsonb;
begin
  select * into sp from social_posts where id = p_post and platform = 'tiktok';
  if sp.id is null then return null; end if;
  select * into it from approval_items where id = sp.approval_item_id;
  cap := coalesce(sp.caption, '');
  -- the hashtag line: a line made only of #tags
  m := regexp_match(cap, '(?:^|\n)([ \t]*#[^\s#]+(?:[ \t]+#[^\s#]+)*[ \t]*)(?=\n|$)');
  if m is not null then
    tagline := btrim(m[1]);
    body := btrim(regexp_replace(replace(cap, m[1], ''), '\n{3,}', E'\n\n', 'g'));
  else
    body := btrim(cap);
  end if;
  lbl  := nullif(btrim(coalesce(it.provenance->'place'->>'label', '')), '');
  srch := nullif(btrim(split_part(coalesce(lbl, ''), ',', 1)), '');
  cover  := coalesce(nullif(sp.cover_url, ''), nullif(it.thumb_url, ''));
  custom := coalesce(sp.cover_url, '') ~ '-cover-v[0-9]';
  select coalesce(s.checks, '{}'::jsonb) into checks from tiktok_kit_state s where s.post_id = p_post;
  return jsonb_build_object(
    'ok', true, 'post', sp.id, 'item', sp.approval_item_id, 'status', sp.status, 'brand', sp.brand,
    'title', coalesce(nullif(btrim(it.title), ''), nullif(btrim(sp.title), ''), 'Your video'),
    'code', it.code,
    'caption', body, 'hashtags', tagline, 'all', cap, 'chars', length(cap),
    'place', lbl, 'place_search', srch,
    'cover', cover, 'cover_custom', custom, 'headline', nullif(btrim(coalesce(it.provenance->'custom_thumb'->>'headline', '')), ''),
    'checks', coalesce(checks, '{}'::jsonb),
    'in_drafts_at', sp.in_drafts_at, 'posted_at', sp.posted_at);
end $$;

create or replace function public.tiktok_kit_set_check(p_post uuid, p_key text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if p_key is null or p_key not in ('caption', 'ai', 'location', 'cover', 'duet', 'post') then
    return jsonb_build_object('ok', false, 'error', 'bad_key');
  end if;
  if not exists (select 1 from social_posts where id = p_post and platform = 'tiktok') then
    return jsonb_build_object('ok', false, 'error', 'no_post');
  end if;
  insert into tiktok_kit_state (post_id, checks) values (p_post, jsonb_build_object(p_key, coalesce(p_on, true)))
  on conflict (post_id) do update set checks = tiktok_kit_state.checks || jsonb_build_object(p_key, coalesce(p_on, true)), updated_at = now()
  returning checks into v;
  return jsonb_build_object('ok', true, 'checks', v);
end $$;

-- "I posted it": in_drafts -> posted, remote_id left null. Nothing else changes, nothing is uploaded.
create or replace function public.tiktok_kit_set_posted(p_post uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare n int; st text;
begin
  update social_posts set status = 'posted', posted_at = now(), error = null
   where id = p_post and platform = 'tiktok' and status = 'in_drafts';
  get diagnostics n = row_count;
  if n = 1 then
    perform tiktok_kit_set_check(p_post, 'post', true);
    return jsonb_build_object('ok', true, 'posted', true);
  end if;
  select status into st from social_posts where id = p_post and platform = 'tiktok';
  if st = 'posted' then return jsonb_build_object('ok', true, 'posted', true, 'already', true); end if;
  return jsonb_build_object('ok', false, 'error', case when st is null then 'no_post' else 'not_in_drafts' end, 'status', st);
end $$;

revoke all on function public.tiktok_kit_new_code(), public.tiktok_kit_mint(uuid), public.tiktok_kit_json(uuid),
  public.tiktok_kit_set_check(uuid, text, boolean), public.tiktok_kit_set_posted(uuid) from public, anon, authenticated;

-- ── Studio doors (staff token) ────────────────────────────────────────────
-- one post's kit, by TikTok row or by Studio item (the detail view knows the item)
create or replace function public.studio_tiktok_kit(p_token text, p_post uuid default null, p_item uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.studio_caller; v_post uuid := p_post; v_item uuid; k jsonb; v_code text;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_post is null then
    if p_item is null then return jsonb_build_object('ok', false, 'error', 'no_post'); end if;
    select id into v_post from social_posts
     where approval_item_id = p_item and platform = 'tiktok' and status in ('queued', 'posting', 'in_drafts', 'posted')
     order by (status = 'posted'), created_at desc limit 1;
    if v_post is null then return jsonb_build_object('ok', true, 'kit', null); end if;
  end if;
  select approval_item_id into v_item from social_posts where id = v_post and platform = 'tiktok';
  if v_item is null then return jsonb_build_object('ok', false, 'error', 'no_post'); end if;
  if not public.staff_may_see_item(s.id, v_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  k := public.tiktok_kit_json(v_post);
  if k->>'status' in ('queued', 'posting', 'in_drafts') then
    v_code := public.tiktok_kit_mint(v_post);
    k := k || jsonb_build_object('link', 'https://bestly.tech/k/' || v_code);
  end if;
  return jsonb_build_object('ok', true, 'kit', k);
end $$;

-- the "TikTok drafts to finish" list: every TikTok row still waiting on a person
create or replace function public.studio_tiktok_kits(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.studio_caller; r record; out jsonb := '[]'::jsonb; k jsonb; v_code text; n int; d int;
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
    n := (select count(*) from jsonb_each(k->'checks') e where e.value = 'true'::jsonb and e.key <> 'post');
    out := out || jsonb_build_array(jsonb_build_object(
      'post', r.id, 'item', r.approval_item_id, 'client', r.client_slug, 'status', r.status,
      'title', k->>'title', 'code', k->>'code', 'cover', k->>'cover', 'done', n,
      'link', case when v_code is not null then 'https://bestly.tech/k/' || v_code end));
  end loop;
  return jsonb_build_object('ok', true, 'kits', out);
end $$;

create or replace function public.studio_tiktok_kit_check(p_token text, p_post uuid, p_key text, p_on boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.studio_caller; v_item uuid;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select approval_item_id into v_item from social_posts where id = p_post and platform = 'tiktok';
  if v_item is null then return jsonb_build_object('ok', false, 'error', 'no_post'); end if;
  if not public.staff_may_see_item(s.id, v_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  return public.tiktok_kit_set_check(p_post, p_key, p_on);
end $$;

create or replace function public.studio_tiktok_kit_posted(p_token text, p_post uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.studio_caller; v_item uuid;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select approval_item_id into v_item from social_posts where id = p_post and platform = 'tiktok';
  if v_item is null then return jsonb_build_object('ok', false, 'error', 'no_post'); end if;
  if not public.staff_may_see_item(s.id, v_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  return public.tiktok_kit_set_posted(p_post);
end $$;

-- ── the short-link doors (no sign-in; the code is the key; 7 days) ────────
create or replace function public.tiktok_kit_get(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l tiktok_kit_links%rowtype; k jsonb;
begin
  select * into l from tiktok_kit_links where code = lower(btrim(coalesce(p_code, '')));
  if l.code is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if l.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  k := public.tiktok_kit_json(l.post_id);
  if k is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'kit', k || jsonb_build_object('expires_at', l.expires_at));
end $$;

create or replace function public.tiktok_kit_check(p_code text, p_key text, p_on boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l tiktok_kit_links%rowtype;
begin
  select * into l from tiktok_kit_links where code = lower(btrim(coalesce(p_code, ''))) and expires_at > now();
  if l.code is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return public.tiktok_kit_set_check(l.post_id, p_key, p_on);
end $$;

create or replace function public.tiktok_kit_posted(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare l tiktok_kit_links%rowtype;
begin
  select * into l from tiktok_kit_links where code = lower(btrim(coalesce(p_code, ''))) and expires_at > now();
  if l.code is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return public.tiktok_kit_set_posted(l.post_id);
end $$;

grant execute on function public.studio_tiktok_kit(text, uuid, uuid), public.studio_tiktok_kits(text),
  public.studio_tiktok_kit_check(text, uuid, text, boolean), public.studio_tiktok_kit_posted(text, uuid),
  public.tiktok_kit_get(text), public.tiktok_kit_check(text, text, boolean), public.tiktok_kit_posted(text)
  to anon, authenticated;

-- Ares's Auto-Fixer revokes anything anon can call unless it is listed here
insert into public.security_public_rpcs (fn, why) values
  ('studio_tiktok_kit',        'Studio reads one TikTok post''s finishing kit (publishable key + staff session token); token-gated'),
  ('studio_tiktok_kits',       'Studio lists TikTok drafts still to finish (publishable key + staff session token); token-gated'),
  ('studio_tiktok_kit_check',  'Studio ticks a kit checklist step (publishable key + staff session token); token-gated'),
  ('studio_tiktok_kit_posted', 'Studio marks a TikTok draft as posted by hand (publishable key + staff session token); token-gated'),
  ('tiktok_kit_get',           'bestly.tech/k/<code> phone page reads one TikTok kit by its 7-character short code; expires after 7 days; returns only the post''s own caption, tags, place and cover'),
  ('tiktok_kit_check',         'bestly.tech/k/<code> phone page ticks a checklist step; needs a live short code'),
  ('tiktok_kit_posted',        'bestly.tech/k/<code> phone page marks the draft posted (in_drafts -> posted only, no upload); needs a live short code')
on conflict (fn) do nothing;

-- ── Anchor's hand-off note now carries the short kit link, not the whole caption ──
create or replace function public.trg_mnd_tiktok_handoff() returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_code text; v_link text;
begin
  select coalesce(nullif(btrim(title), ''), 'a clip') into v_title from approval_items where id = new.approval_item_id;
  v_code := public.tiktok_kit_mint(new.id);
  v_link := case when v_code is not null then 'https://bestly.tech/k/' || v_code end;
  insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key, agent_slug)
  values ('mnd', 'Anchor: ' || coalesce(v_title, 'a clip') || ' is in your TikTok drafts',
          case when v_link is not null
               then E'Finish it in TikTok (about a minute). Caption, hashtags, location and cover are ready to tap and copy:\n' || v_link
               else E'Finish it in TikTok. Open the post in Studio for the caption, hashtags, location and cover.' end,
          coalesce(v_link, '/admin'), 'mnd.tiktok:' || new.id::text, 'success', 'mnd-tiktok-caption-' || new.id::text, 'anchor')
  on conflict (dedupe_key) do nothing;
  return new;
exception when others then
  return new;   -- a note must never fail the status change
end $$;
