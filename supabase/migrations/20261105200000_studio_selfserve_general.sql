-- Studio self-serve for every business, not just real estate (Nov 5 2026).
-- Plan: bestly_memory plan/studio-selfserve-golive-2026-11-04. Undo: build/studio-selfserve-golive-2026-11-04/undo-1.
--
-- 1. studio_networks: which networks a NEW self-serve customer can connect today (switch per network,
--    flipped by an admin through studio_network_set, never hand-edited). Meta (Instagram, Facebook, Threads),
--    TikTok and Pinterest stay closed until their app reviews pass.
-- 2. studio_network_waits: people who want a closed network; emailed once it opens.
-- 3. Connect before card: studio_ensure_client() makes an INACTIVE client (no billing row, so
--    studio_entitlement says can_post=false) and parks it on studio_signups.pre_client_slug.
--    client_slug stays empty until the card, so the wizard's "converted" logic is unchanged.
-- 4. studio_provision_client: vertical-aware (general | real-estate) and reuses the pre-client.
-- 5. Reserved slugs so a business called "start" or "me" can never take a route.
-- 6. studio_boot serves the self-serve pages.

-- ── 1. networks ─────────────────────────────────────────────────────────────
create table if not exists public.studio_networks (
  platform   text primary key,
  label      text not null,
  open       boolean not null default false,
  note       text,
  sort       int not null default 100,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.studio_networks enable row level security;
revoke all on public.studio_networks from anon, authenticated;

insert into public.studio_networks (platform, label, open, note, sort) values
  ('instagram', 'Instagram', false, 'Meta App Review not passed yet (Standard Access only)', 10),
  ('facebook',  'Facebook',  false, 'Meta App Review not passed yet (Standard Access only)', 20),
  ('threads',   'Threads',   false, 'Meta App Review not passed yet (Standard Access only)', 30),
  ('tiktok',    'TikTok',    false, 'TikTok app review in progress', 40),
  ('linkedin',  'LinkedIn',  true,  'Profile posting is open to anyone', 50),
  ('pinterest', 'Pinterest', false, 'Pinterest Standard access in review', 60),
  ('bluesky',   'Bluesky',   true,  'No review needed', 70),
  ('youtube',   'YouTube',   false, 'Google OAuth consent screen not verified yet', 80)
on conflict (platform) do nothing;

create or replace function public.studio_network_set(p_platform text, p_open boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.studio_networks;
begin
  if not public.team_is_admin() then raise exception 'admins only'; end if;
  update public.studio_networks
     set open = p_open, note = coalesce(p_note, note), updated_at = now(), updated_by = coalesce(auth.uid()::text, 'admin')
   where platform = p_platform returning * into r;
  if r.platform is null then return jsonb_build_object('ok', false, 'error', 'no_such_network'); end if;
  return jsonb_build_object('ok', true, 'platform', r.platform, 'open', r.open);
end $$;
revoke all on function public.studio_network_set(text, boolean, text) from public, anon;
grant execute on function public.studio_network_set(text, boolean, text) to authenticated;

-- ── 2. waits ────────────────────────────────────────────────────────────────
create table if not exists public.studio_network_waits (
  id          uuid primary key default gen_random_uuid(),
  signup_id   uuid not null references public.studio_signups(id) on delete cascade,
  platform    text not null references public.studio_networks(platform),
  email       text not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (signup_id, platform)
);
alter table public.studio_network_waits enable row level security;
revoke all on public.studio_network_waits from anon, authenticated;

insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled) values
  ('studio_network_waits', 'email', 'email', 'delete', 'Waiting-list row for a network that is not open yet; nothing else depends on it', true)
on conflict do nothing;

-- ── 3. reserved slugs + pre-client ──────────────────────────────────────────
create or replace function public.studio_slug_reserved(p_slug text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_slug, '')) = any (array[
    'start','me','o','real-estate','call','admin','studio','t','c','api','assets','connect','signin','login','logout',
    'board','thanks','m','app','help','privacy','terms','bestly','bestly-test','index','_loader','preview','new','www']);
$$;

alter table public.studio_signups add column if not exists pre_client_slug text;

-- Brand profile from the wizard answers. Shared by the pre-client and the paid client so it is always current.
create or replace function public.studio__brand_upsert(p_signup_id uuid, p_client_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare s public.studio_signups; a jsonb; v_re boolean;
begin
  select * into s from public.studio_signups where id = p_signup_id;
  a := coalesce(s.answers, '{}'::jsonb);
  v_re := coalesce(s.vertical, 'real-estate') = 'real-estate';
  insert into public.client_brand (
    client_id, theme, feel, voice, words_use, words_avoid, audience, wants, product_terms,
    resource_when, resource_has, resource_hint, compiled_at
  ) values (
    p_client_id,
    jsonb_build_object(
      'colors', coalesce(a->'brand'->'colors', '[]'::jsonb),
      'logo', coalesce(a->'brand'->>'logo_path', a->'brand'->>'logo', ''),
      'headshot', coalesce(a->'brand'->>'headshot_path', a->'brand'->>'headshot', ''),
      'logo_path', coalesce(a->'brand'->>'logo_path', ''),
      'headshot_path', coalesce(a->'brand'->>'headshot_path', ''),
      'storage_bucket', 're-uploads',
      'pulled_from', coalesce(a->'brand'->>'pulled', ''),
      'about', coalesce(a->'about', '{}'::jsonb),
      'footer', case when v_re then public.re_caption_footer(p_signup_id) else '' end,
      'content', coalesce(a->'content', '{}'::jsonb),
      'cadence', jsonb_build_object('per_week', coalesce((a->'cadence'->>'per_week')::int, 3),
                                    'autopost', coalesce((a->'cadence'->>'autopost')::boolean, false)),
      'style', coalesce(a->'style'->'picks', '{}'::jsonb),
      'rules', coalesce(a->'rules', '{}'::jsonb),
      'vertical', coalesce(s.vertical, 'real-estate'),
      'wizard', a),
    coalesce(array(select jsonb_array_elements_text(coalesce(a->'voice'->'tones', '[]'::jsonb))), '{}'),
    jsonb_build_object('tones', coalesce(a->'voice'->'tones', '[]'::jsonb), 'tone_note', coalesce(a->'voice'->>'tone_note', ''),
                       'emoji', coalesce((a->'voice'->>'emoji')::boolean, false), 'hashtags', coalesce(a->'voice'->'hashtags', '[]'::jsonb)),
    coalesce(array(select jsonb_array_elements_text(coalesce(a->'voice'->'words_use', '[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(a->'voice'->'words_avoid', '[]'::jsonb))), '{}'),
    case when v_re then coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(coalesce(a->'about'->'cities', '[]'::jsonb)) x), '')
         else coalesce(nullif(btrim(a->'about'->>'audience'), ''),
                       (select string_agg(x, ', ') from jsonb_array_elements_text(coalesce(a->'about'->'cities', '[]'::jsonb)) x), '') end,
    case when v_re then jsonb_build_object('license_line', true, 'equal_housing', true, 'never', coalesce(a->'rules'->'never', '[]'::jsonb))
         else jsonb_build_object('never', coalesce(a->'rules'->'never', '[]'::jsonb), 'no_face', coalesce((a->'rules'->>'no_face')::boolean, false)) end,
    case when v_re then 'Posts show the brokerage and license line. Equal Housing line or logo on every post.'
         else coalesce(nullif(btrim(a->'about'->>'what'), ''), '') end,
    case when v_re then 'Listing photos arrive from the Studio upload page, or by email at studio@bestly.tech with the address in the subject.'
         else 'Photos, clips and notes arrive by email at studio@bestly.tech or from the board.' end,
    case when v_re then 'A post for every new listing, just-sold, open house, and the neighborhood.'
         else 'Posts about what the business does, its people and its news, from what the owner sends.' end,
    'Brand pulled from their own website; they confirmed each item in the wizard.',
    now())
  on conflict (client_id) do update set
    theme = excluded.theme, feel = excluded.feel, voice = excluded.voice, words_use = excluded.words_use,
    words_avoid = excluded.words_avoid, audience = excluded.audience, wants = excluded.wants,
    product_terms = excluded.product_terms, resource_when = excluded.resource_when, resource_has = excluded.resource_has,
    resource_hint = excluded.resource_hint, compiled_at = now();
end $$;
revoke all on function public.studio__brand_upsert(uuid, uuid) from public, anon, authenticated;

-- Make the approval_clients row for a signup. p_active=false for the pre-client (connect before card).
create or replace function public.studio__client_from_signup(p_signup_id uuid, p_active boolean)
returns text language plpgsql security definer set search_path to 'public' as $$
declare s public.studio_signups; a jsonb; v_re boolean; v_name text; v_base text; v_slug text; v_n int := 1; v_client approval_clients;
begin
  select * into s from public.studio_signups where id = p_signup_id;
  if s.id is null then return null; end if;
  a := coalesce(s.answers, '{}'::jsonb);
  v_re := coalesce(s.vertical, 'real-estate') = 'real-estate';

  v_name := nullif(btrim(coalesce(a->'about'->>'business', '')), '');
  if v_name is null then v_name := nullif(btrim(coalesce(a->'about'->>'name', '')), ''); end if;
  if v_name is null then v_name := nullif(btrim(coalesce(a->'about'->>'licensed_name', '')), ''); end if;
  if v_name is null then v_name := nullif(btrim(coalesce(a->'about'->>'brokerage', '')), ''); end if;
  if v_name is null then v_name := split_part(s.email, '@', 1); end if;

  v_base := btrim(lower(regexp_replace(
              case when v_re then coalesce(nullif(btrim(a->'about'->>'licensed_name'), ''), v_name) else v_name end,
              '[^a-zA-Z0-9]+', '-', 'g')), '-');
  if v_base is null or v_base = '' then v_base := case when v_re then 'agent' else 'studio-client' end; end if;
  v_base := left(v_base, 40);
  v_slug := v_base;
  while public.studio_slug_reserved(v_slug) or exists (select 1 from public.approval_clients where slug = v_slug) loop
    v_n := v_n + 1; v_slug := left(v_base, 36) || '-' || v_n;
  end loop;

  insert into public.approval_clients (
    slug, name, kind, contact_name, contact_email, notify_email, intake_emails, publish_mode, client_yes_is_final,
    social_brand, active, sandbox, access_token, tz, calendar_autopost, approvers, vertical, claim_gate_ack
  ) values (
    v_slug, v_name, 'client', nullif(btrim(coalesce(a->'about'->>'name', '')), ''), s.email, true, array[s.email],
    case when coalesce((a->'cadence'->>'autopost')::boolean, false) then 'auto' else 'push' end,
    true, v_slug, p_active, false, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'America/Los_Angeles',
    coalesce((a->'cadence'->>'autopost')::boolean, false), '{}'::uuid[], case when v_re then 'real-estate' else 'general' end,
    jsonb_build_object('by', 'Bestly Studio self-serve', 'at', now(),
                       'note', case when v_re then 'Self-serve real estate: house rules + fair-housing lint + agent approval apply'
                                    else 'Self-serve: house rules + client approval apply' end)
  ) returning * into v_client;

  perform public.studio__brand_upsert(p_signup_id, v_client.id);
  return v_slug;
end $$;
revoke all on function public.studio__client_from_signup(uuid, boolean) from public, anon, authenticated;

-- Called by the wizard (through studio-re, service role) the first time someone taps Connect.
create or replace function public.studio_ensure_client(p_signup_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.studio_signups; v_slug text; v_id uuid;
begin
  select * into s from public.studio_signups where id = p_signup_id for update;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'no_signup'); end if;
  v_slug := coalesce(s.client_slug, s.pre_client_slug);
  if v_slug is null then
    v_slug := public.studio__client_from_signup(p_signup_id, false);
    update public.studio_signups set pre_client_slug = v_slug, updated_at = now() where id = p_signup_id;
  end if;
  select id into v_id from public.approval_clients where slug = v_slug;
  if s.client_slug is null then perform public.studio__brand_upsert(p_signup_id, v_id); end if;
  return jsonb_build_object('ok', true, 'client_slug', v_slug, 'client_id', v_id, 'paid', s.client_slug is not null);
end $$;
revoke all on function public.studio_ensure_client(uuid) from public, anon, authenticated;

-- ── 4. provisioning (webhook -> here) ───────────────────────────────────────
create or replace function public.studio_provision_client(p_signup_id uuid, p_customer text, p_subscription text, p_plan text, p_cadence text, p_status text, p_trial_end timestamp with time zone, p_period_end timestamp with time zone, p_price_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.studio_signups; v_slug text; v_id uuid; v_name text; v_videos int; l record; v_first boolean;
begin
  select * into s from public.studio_signups where id = p_signup_id for update;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'no_signup'); end if;

  -- A one-time extra video bought from the board: one credit, nothing else changes.
  if p_plan = 'extra_video' then
    if s.client_slug is null then return jsonb_build_object('ok', false, 'error', 'no_client'); end if;
    update public.studio_billing set extra_videos = coalesce(extra_videos, 0) + 1, updated_at = now() where client_slug = s.client_slug;
    return jsonb_build_object('ok', true, 'client_slug', s.client_slug, 'extra_video', true);
  end if;

  v_first := s.client_slug is null;
  v_slug := coalesce(s.client_slug, s.pre_client_slug);
  if v_slug is null then
    v_slug := public.studio__client_from_signup(p_signup_id, true);
  end if;
  update public.approval_clients set active = true where slug = v_slug returning id, name into v_id, v_name;
  if v_first then perform public.studio__brand_upsert(p_signup_id, v_id); end if;

  v_videos := case when coalesce(p_plan, 'carousels') = 'premium' then 4 else 0 end;
  insert into public.studio_billing (
    client_slug, stripe_customer, stripe_subscription, plan, cadence, status, trial_end, current_period_end,
    video_credits, extra_videos, video_ceiling_cents, signup_id, price_id, spending_cents, spending_month
  ) values (
    v_slug, p_customer, p_subscription, coalesce(p_plan, 'carousels'), coalesce(p_cadence, 'monthly'),
    coalesce(p_status, 'trialing'), p_trial_end, p_period_end, v_videos, 0, 2500, p_signup_id, p_price_id, 0, to_char(now(), 'YYYY-MM')
  )
  on conflict (client_slug) do update set
    stripe_customer = coalesce(excluded.stripe_customer, studio_billing.stripe_customer),
    stripe_subscription = coalesce(excluded.stripe_subscription, studio_billing.stripe_subscription),
    plan = coalesce(excluded.plan, studio_billing.plan), cadence = coalesce(excluded.cadence, studio_billing.cadence),
    status = coalesce(excluded.status, studio_billing.status), trial_end = coalesce(excluded.trial_end, studio_billing.trial_end),
    current_period_end = coalesce(excluded.current_period_end, studio_billing.current_period_end),
    price_id = coalesce(excluded.price_id, studio_billing.price_id), updated_at = now();

  update public.studio_signups
     set client_slug = v_slug, status = 'converted', updated_at = now(),
         stripe_customer = coalesce(p_customer, stripe_customer), plan = coalesce(p_plan, plan),
         cadence_billing = coalesce(p_cadence, cadence_billing)
   where id = p_signup_id;

  -- a listing uploaded in the wizard (before the card) gets its carousel draft now (real estate only)
  update public.re_listings set client_slug = v_slug where signup_id = p_signup_id and client_slug is null;
  for l in select id from public.re_listings where signup_id = p_signup_id order by created_at loop
    perform public.re_enqueue_listing(l.id);
  end loop;

  if v_first then
    perform public.bestly_raise('studio:signup-' || v_slug, 'resolved', 'info',
      'New Studio client: ' || coalesce(v_name, v_slug),
      'Signed up on their own (' || coalesce(s.vertical, 'real-estate') || ') and put a card on file. Board at /' || v_slug, 'studio');
  end if;
  return jsonb_build_object('ok', true, 'client_slug', v_slug, 'client_id', v_id, 'existing', not v_first);
end $$;

-- ── 6. boot ─────────────────────────────────────────────────────────────────
create or replace function public.studio_boot(p_file text, p_preview uuid default null::uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case
    when p_file not in ('index.html','board.html','start.html','me.html','o.html','real-estate.html') then jsonb_build_object('ok', false, 'error', 'bad_file')
    when p_preview is not null then coalesce(
      (select jsonb_build_object('ok', true, 'path', files->>p_file, 'build', id, 'status', status)
         from studio_builds where id = p_preview and files ? p_file),
      jsonb_build_object('ok', false, 'error', 'no_such_preview'))
    else coalesce(
      (select jsonb_build_object('ok', true, 'path', files->>p_file, 'build', id, 'status', status)
         from studio_builds where status = 'live' and files ? p_file order by created_at desc limit 1),
      jsonb_build_object('ok', false, 'error', 'no_live_build'))
  end;
$$;

-- service role (studio-re) calls these; nothing else may
grant execute on function public.studio_ensure_client(uuid) to service_role;
grant execute on function public.studio__brand_upsert(uuid, uuid) to service_role;
grant execute on function public.studio__client_from_signup(uuid, boolean) to service_role;
grant select, insert, update on public.studio_networks, public.studio_network_waits to service_role;
