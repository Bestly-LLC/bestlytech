-- Skill Inbox (owner: Radar, Platform Analyst). STAGED 2026-10-27, not applied anywhere.
--
-- Flow: Meta Muse reads Jared's Instagram Saves and calls the skill-inbox-mcp edge function ->
--       skill_inbox_ingest() stores each Save (deduped on the Reel shortcode) ->
--       a free Pi job (jobs/skill_inbox.py) transcribes, extracts, vets (Ares rule), maps to an AI employee or app, scores ->
--       skill_inbox_pick() surfaces at most 3 a day -> /admin/skill-inbox + a Command Center tile.
--
-- Rules baked in here:
--   * Admin RPCs (today / decide / parked) check team_is_admin() and are granted to authenticated only, never anon.
--   * Service RPCs (ingest / known / claim / finish / requeue / pick / push / key_ok) are granted to service_role only.
--   * Nothing here installs anything. A Save is data. Caption and transcript are untrusted text and are never executed.
--   * No emails or phones are stored in columns, so no privacy_data_map rows are needed (creator_handle is a public IG handle).
--   * Append-only: never edit this file once applied, write a new migration.
--
-- Rollback: supabase/rollbacks/20261027221500_skill_inbox_rollback.sql

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.skill_inbox (
  id              uuid primary key default gen_random_uuid(),
  ig_shortcode    text not null unique,
  reel_url        text not null,
  caption         text,
  creator_handle  text,
  saved_at        timestamptz,
  received_at     timestamptz not null default now(),
  media_url       text,
  transcript      text,
  title           text,
  what_it_does    text,
  fit_agent_slug  text,
  fit_label       text,
  fit_why         text,
  safe_status     text check (safe_status in ('cleared','needs_look','blocked')),
  safe_why        text,
  cost_label      text,
  cost_why        text,
  score           numeric,
  status          text not null default 'new' check (status in ('new','processing','ready','error')),
  decision        text check (decision in ('add','park','skip')),
  decided_at      timestamptz,
  surfaced_on     date,
  resurfaced_at   timestamptz,
  error           text,
  -- operational columns (additions to the approved column list)
  fit_kind        text check (fit_kind in ('agent','app','idea','none')),
  tool_url        text,
  hidden          boolean not null default false,
  hidden_reason   text check (hidden_reason in ('duplicate','off_topic','blocked')),
  resurface_boost numeric not null default 0,
  resurfaced_why  text,
  attempts        int not null default 0,
  claimed_at      timestamptz,
  ai_provider     text,
  updated_at      timestamptz not null default now(),
  constraint skill_inbox_caption_len check (caption is null or length(caption) <= 4000)
);
create index if not exists skill_inbox_status_idx   on public.skill_inbox (status, received_at);
create index if not exists skill_inbox_surfaced_idx on public.skill_inbox (surfaced_on) where surfaced_on is not null;
create index if not exists skill_inbox_ready_idx    on public.skill_inbox (score desc) where status = 'ready' and not hidden;

-- One row: when Muse last checked in, and when today's push went out (so a re-run never double-pushes).
create table if not exists public.skill_inbox_state (
  id            boolean primary key default true check (id),
  created_at    timestamptz not null default now(),
  last_sync_at  timestamptz,   -- Muse called known_posts or save_instagram_post
  last_post_at  timestamptz,   -- a new Save arrived
  push_sent_on  date,
  picks_per_day int not null default 3 check (picks_per_day between 1 and 5)
);
insert into public.skill_inbox_state (id) values (true) on conflict (id) do nothing;

alter table public.skill_inbox       enable row level security;
alter table public.skill_inbox_state enable row level security;

drop policy if exists "admin reads skill inbox" on public.skill_inbox;
create policy "admin reads skill inbox" on public.skill_inbox for select to authenticated using (public.team_is_admin());
-- no insert/update/delete policy on purpose: writes go through the RPCs below (service role bypasses RLS)

revoke all on public.skill_inbox       from anon, authenticated;
revoke all on public.skill_inbox_state from anon, authenticated;
grant select on public.skill_inbox to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._skill_inbox_day() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- The card the UI draws. Leaves out caption and transcript (long, untrusted).
create or replace function public._skill_inbox_card(r public.skill_inbox) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'ig_shortcode', r.ig_shortcode, 'reel_url', r.reel_url, 'creator_handle', r.creator_handle,
    'saved_at', r.saved_at, 'received_at', r.received_at,
    'title', r.title, 'what_it_does', r.what_it_does,
    'fit_agent_slug', r.fit_agent_slug, 'fit_label', r.fit_label, 'fit_kind', r.fit_kind, 'fit_why', r.fit_why,
    'safe_status', r.safe_status, 'safe_why', r.safe_why,
    'cost_label', r.cost_label, 'cost_why', r.cost_why,
    'score', r.score, 'decision', r.decision, 'decided_at', r.decided_at,
    'surfaced_on', r.surfaced_on, 'resurfaced_at', r.resurfaced_at, 'resurfaced_why', r.resurfaced_why)
$$;
revoke all on function public._skill_inbox_day() from public, anon, authenticated;
revoke all on function public._skill_inbox_card(public.skill_inbox) from public, anon, authenticated;
grant execute on function public._skill_inbox_day() to authenticated, service_role;
grant execute on function public._skill_inbox_card(public.skill_inbox) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Admin RPCs (signed-in admin only)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.skill_inbox_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := public._skill_inbox_day();
  v_state public.skill_inbox_state;
  v_picks jsonb; v_left int; v_parked int;
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  select * into v_state from public.skill_inbox_state where id;

  select coalesce(jsonb_agg(public._skill_inbox_card(s) order by (s.score + s.resurface_boost) desc, s.received_at), '[]'::jsonb),
         count(*) filter (where s.decision is null)
    into v_picks, v_left
    from public.skill_inbox s
   where s.surfaced_on = v_day and not s.hidden and s.status = 'ready';

  select count(*) into v_parked from public.skill_inbox s
   where not s.hidden and s.status = 'ready'
     and (s.decision = 'park' or (s.decision is null and (s.surfaced_on is null or s.surfaced_on < v_day)));

  return jsonb_build_object(
    'day', v_day,
    'synced', jsonb_build_object(
      'last_sync_at', v_state.last_sync_at, 'last_post_at', v_state.last_post_at,
      'next_sync_at', case when v_state.last_sync_at is null then null else v_state.last_sync_at + interval '2 hours' end,
      'every_minutes', 120),
    'picks_per_day', v_state.picks_per_day,
    'picks', v_picks, 'left', v_left, 'parked_count', v_parked,
    'handled', jsonb_build_object(
      'duplicates', (select count(*) from public.skill_inbox where hidden_reason = 'duplicate'),
      'off_topic',  (select count(*) from public.skill_inbox where hidden_reason = 'off_topic'),
      'blocked',    (select count(*) from public.skill_inbox where hidden_reason = 'blocked')),
    'working', jsonb_build_object(
      'waiting',    (select count(*) from public.skill_inbox where status in ('new','processing')),
      'failed',     (select count(*) from public.skill_inbox where status = 'error')));
end $$;

-- decision: 'add' | 'park' | 'skip' | null (null = undo)
create or replace function public.skill_inbox_decide(p_id uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.skill_inbox;
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  if p_decision is not null and p_decision not in ('add','park','skip') then
    raise exception 'decision must be add, park, skip or null';
  end if;
  select * into r from public.skill_inbox where id = p_id for update;
  if not found or r.hidden or r.status <> 'ready' then raise exception 'That save is not available'; end if;
  if p_decision = 'add' and r.safe_status = 'blocked' then raise exception 'Ares blocked this one'; end if;
  update public.skill_inbox
     set decision = p_decision,
         decided_at = case when p_decision is null then null else now() end,
         updated_at = now()
   where id = p_id returning * into r;
  return public._skill_inbox_card(r);
end $$;

-- Parked list, searchable. p_q matches title, plain description, fit, caption and transcript (case-insensitive, literal).
create or replace function public.skill_inbox_parked(p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_day date := public._skill_inbox_day(); v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  return coalesce((
    select jsonb_agg(public._skill_inbox_card(s) order by s.saved_at desc nulls last, s.received_at desc)
      from (select * from public.skill_inbox s
             where not s.hidden and s.status = 'ready'
               and (s.decision = 'park' or (s.decision is null and (s.surfaced_on is null or s.surfaced_on < v_day)))
               and (v_q is null
                    or position(lower(v_q) in lower(concat_ws(' ', s.title, s.what_it_does, s.fit_label, s.caption, s.transcript))) > 0)
             order by s.saved_at desc nulls last, s.received_at desc
             limit 100) s
  ), '[]'::jsonb);
end $$;

revoke all on function public.skill_inbox_today()                   from public, anon;
revoke all on function public.skill_inbox_decide(uuid, text)        from public, anon;
revoke all on function public.skill_inbox_parked(text)              from public, anon;
grant execute on function public.skill_inbox_today()                to authenticated, service_role;
grant execute on function public.skill_inbox_decide(uuid, text)     to authenticated, service_role;
grant execute on function public.skill_inbox_parked(text)           to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Service RPCs (edge function + Pi jobs, service role only)
-- ---------------------------------------------------------------------------------------------------------------------

-- The Muse connector key lives in Vault under the name skill_inbox_mcp_key (created by Jared at deploy, never in git).
-- Compared by sha256 so the comparison does not leak length or prefix timing.
create or replace function public.skill_inbox_key_ok(p_key text) returns boolean
language plpgsql stable security definer set search_path = public, vault, extensions as $$
declare v text;
begin
  if coalesce(length(p_key), 0) < 24 or length(p_key) > 200 then return false; end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = 'skill_inbox_mcp_key' limit 1;
  if v is null or length(v) < 24 then return false; end if;   -- no key saved yet: nothing gets in
  return encode(extensions.digest(p_key, 'sha256'), 'hex') = encode(extensions.digest(v, 'sha256'), 'hex');
end $$;

-- p = {url, caption, saved_at, creator_handle, media_url}. Deduped on the Reel shortcode. Rate limited.
create or replace function public.skill_inbox_ingest(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_url text := btrim(coalesce(p->>'url', ''));
  v_code text; v_cap text; v_handle text; v_media text; v_saved timestamptz; v_id uuid;
begin
  v_code := substring(v_url from '^https?://(?:www\.|m\.)?instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:reels?|p|tv)/([A-Za-z0-9_-]{5,20})(?:[/?#].*)?$');
  if v_code is null then return jsonb_build_object('ok', false, 'error', 'not_an_instagram_post_url'); end if;

  update public.skill_inbox_state set last_sync_at = now() where id;

  if exists (select 1 from public.skill_inbox where ig_shortcode = v_code) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if (select count(*) from public.skill_inbox where received_at > now() - interval '1 hour') >= 60
     or (select count(*) from public.skill_inbox where received_at > now() - interval '1 day') >= 300 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  v_cap := left(regexp_replace(coalesce(p->>'caption', ''), '[\x01-\x08\x0B\x0C\x0E-\x1F]', '', 'g'), 4000);
  v_handle := substring(btrim(coalesce(p->>'creator_handle', '')) from '^@?([A-Za-z0-9._]{1,30})$');
  v_media := btrim(coalesce(p->>'media_url', ''));
  if v_media !~ '^https://' or length(v_media) > 2000 then v_media := null; end if;
  begin v_saved := (p->>'saved_at')::timestamptz; exception when others then v_saved := null; end;
  if v_saved is not null and (v_saved > now() + interval '1 hour' or v_saved < now() - interval '5 years') then v_saved := null; end if;

  insert into public.skill_inbox (ig_shortcode, reel_url, caption, creator_handle, saved_at, media_url)
  values (v_code, 'https://www.instagram.com/reel/' || v_code || '/', nullif(v_cap, ''), v_handle, v_saved, v_media)
  on conflict (ig_shortcode) do nothing
  returning id into v_id;

  update public.skill_inbox_state set last_post_at = now() where id;
  return jsonb_build_object('ok', true, 'duplicate', v_id is null, 'id', v_id);
end $$;

-- Shortcodes Muse should skip. Calling it counts as a sync check-in. Newest first.
create or replace function public.skill_inbox_known(p_limit int default 500) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.skill_inbox_state set last_sync_at = now() where id;
  return coalesce((select jsonb_agg(ig_shortcode order by received_at desc)
                     from (select ig_shortcode, received_at from public.skill_inbox
                            order by received_at desc limit greatest(1, least(coalesce(p_limit, 500), 2000))) k), '[]'::jsonb);
end $$;

-- Pi job: take up to p_limit new rows (new -> processing). SKIP LOCKED so two runs never take the same row.
create or replace function public.skill_inbox_claim(p_limit int default 8) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with c as (
    select id from public.skill_inbox where status = 'new'
     order by received_at limit greatest(1, least(coalesce(p_limit, 8), 25)) for update skip locked),
  up as (
    update public.skill_inbox s set status = 'processing', claimed_at = now(), attempts = s.attempts + 1, updated_at = now()
      from c where s.id = c.id returning s.*)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', up.id, 'ig_shortcode', up.ig_shortcode, 'reel_url', up.reel_url, 'caption', up.caption,
           'creator_handle', up.creator_handle, 'saved_at', up.saved_at, 'media_url', up.media_url, 'attempts', up.attempts)
           order by up.received_at), '[]'::jsonb)
    into v from up;
  return v;
end $$;

-- Pi job: write the analysis back (processing -> ready), or the error (processing -> error).
create or replace function public.skill_inbox_finish(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.skill_inbox; v_err text := nullif(btrim(coalesce(p->>'error', '')), '');
begin
  if v_err is not null then
    update public.skill_inbox set status = 'error', error = left(v_err, 500), updated_at = now()
     where id = p_id and status = 'processing' returning * into r;
    return jsonb_build_object('ok', found, 'status', 'error');
  end if;
  update public.skill_inbox set
    status = 'ready', error = null, updated_at = now(),
    transcript     = left(p->>'transcript', 20000),
    title          = left(p->>'title', 90),
    what_it_does   = left(p->>'what_it_does', 220),
    fit_agent_slug = nullif(left(p->>'fit_agent_slug', 80), ''),
    fit_label      = left(p->>'fit_label', 80),
    fit_kind       = case when p->>'fit_kind' in ('agent','app','idea','none') then p->>'fit_kind' else 'none' end,
    fit_why        = left(p->>'fit_why', 140),
    safe_status    = case when p->>'safe_status' in ('cleared','needs_look','blocked') then p->>'safe_status' else 'needs_look' end,
    safe_why       = left(p->>'safe_why', 140),
    cost_label     = left(p->>'cost_label', 40),
    cost_why       = left(p->>'cost_why', 140),
    score          = greatest(0, least(100, coalesce((p->>'score')::numeric, 0))),
    tool_url       = case when p->>'tool_url' ~ '^https://' then left(p->>'tool_url', 500) else null end,
    hidden         = coalesce((p->>'hidden')::boolean, false) or p->>'safe_status' = 'blocked',
    hidden_reason  = case when p->>'safe_status' = 'blocked' then 'blocked'
                          when p->>'hidden_reason' in ('duplicate','off_topic') then p->>'hidden_reason' end,
    ai_provider    = left(p->>'ai_provider', 80)
   where id = p_id and status = 'processing' returning * into r;
  return jsonb_build_object('ok', found, 'status', 'ready');
end $$;

-- Watchdog: put stuck rows back, retry errors. Returns counts.
create or replace function public.skill_inbox_requeue(p_stuck_minutes int default 45, p_max_attempts int default 3) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_stuck int; v_gave_up int; v_retry int;
begin
  with s as (
    update public.skill_inbox
       set status = case when attempts >= p_max_attempts then 'error' else 'new' end,
           error  = case when attempts >= p_max_attempts then 'stuck while processing, gave up' else error end,
           updated_at = now()
     where status = 'processing' and claimed_at < now() - make_interval(mins => p_stuck_minutes)
     returning status)
  select count(*) filter (where status = 'new'), count(*) filter (where status = 'error') into v_stuck, v_gave_up from s;

  with e as (
    update public.skill_inbox set status = 'new', updated_at = now()
     where status = 'error' and attempts < p_max_attempts and updated_at < now() - interval '30 minutes'
     returning 1)
  select count(*) into v_retry from e;

  return jsonb_build_object('stuck_reset', v_stuck, 'gave_up', v_gave_up, 'retried', v_retry,
    'failed_for_good', (select count(*) from public.skill_inbox where status = 'error' and attempts >= p_max_attempts),
    'waiting_new', (select count(*) from public.skill_inbox where status = 'new'),
    'oldest_new_min', (select floor(extract(epoch from now() - min(received_at)) / 60)::int from public.skill_inbox where status = 'new'),
    'last_sync_at', (select last_sync_at from public.skill_inbox_state where id),
    'state_created_at', (select created_at from public.skill_inbox_state where id));
end $$;

-- Job: tell the database which parked rows match recent work. p = [{"id": "...", "boost": 12, "why": "Fits the Maya work you did today"}]
-- Rows not in the list lose their boost.
create or replace function public.skill_inbox_set_boosts(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.skill_inbox set resurface_boost = 0, resurfaced_why = null
   where resurface_boost <> 0 and id not in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x);
  update public.skill_inbox s set resurface_boost = least(25, greatest(0, (x->>'boost')::numeric)), resurfaced_why = left(x->>'why', 140)
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x where s.id = (x->>'id')::uuid and not s.hidden;
  get diagnostics n = row_count;
  return jsonb_build_object('boosted', n);
end $$;

-- Choose the day's picks. At most p_n (default: the setting, 3). Idempotent.
-- p_rebalance=true: undecided picks for that day are re-chosen so a great new save can displace a weaker one (the job stops
-- rebalancing tomorrow's list after 9:00 PM PT). Decided rows keep their slot. Everything not chosen stays parked.
create or replace function public.skill_inbox_pick(p_day date, p_n int default null, p_rebalance boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int := coalesce(p_n, (select picks_per_day from public.skill_inbox_state where id), 3); v_have int; v_new int;
begin
  if p_rebalance then
    update public.skill_inbox set surfaced_on = null, updated_at = now() where surfaced_on = p_day and decision is null;
  end if;
  select count(*) into v_have from public.skill_inbox where surfaced_on = p_day and not hidden and status = 'ready';

  with cand as (
    select id from public.skill_inbox s
     where s.status = 'ready' and not s.hidden and coalesce(s.safe_status, 'needs_look') <> 'blocked'
       and s.decision is distinct from 'skip' and s.decision is distinct from 'add'
       and (s.surfaced_on is null or s.surfaced_on < p_day)
       and (
            (s.decision is null and s.surfaced_on is null and s.score >= 25)   -- fresh and worth showing
         or s.resurface_boost > 0                                              -- parked, but it fits what Jared is working on now
       )
     order by (s.score + s.resurface_boost) desc, s.received_at
     limit greatest(0, v_n - v_have)),
  up as (
    update public.skill_inbox s
       set surfaced_on = p_day,
           resurfaced_at = case when s.decision = 'park' or s.surfaced_on is not null or s.resurface_boost > 0 then now() else s.resurfaced_at end,
           decision = null, decided_at = null, updated_at = now()
      from cand where s.id = cand.id returning 1)
  select count(*) into v_new from up;
  return jsonb_build_object('day', p_day, 'kept', v_have, 'added', v_new);
end $$;

-- 9:00 AM PT push, signed Radar. Once per day. scout_notify would sign it "Scout", so this goes through notify_route
-- with Radar as the source. notify_route's autonomy gate still decides whether it buzzes or lands in the 7 PM recap.
create or replace function public.skill_inbox_push_today() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_day date := public._skill_inbox_day(); v_open int; v_titles text; v_ch text; v_sent date;
begin
  select push_sent_on into v_sent from public.skill_inbox_state where id;
  if v_sent = v_day then return jsonb_build_object('ok', true, 'skipped', 'already_sent'); end if;
  select count(*), string_agg(title, E'\n' order by (score + resurface_boost) desc)
    into v_open, v_titles
    from public.skill_inbox where surfaced_on = v_day and decision is null and not hidden and status = 'ready';
  if v_open = 0 then return jsonb_build_object('ok', true, 'skipped', 'no_picks'); end if;

  perform set_config('bestly.from', 'platform-radar', true);
  v_ch := public.notify_route(
    'Radar: ' || v_open || case when v_open = 1 then ' pick' else ' picks' end || ' in your Skill Inbox',
    coalesce(v_titles, '') || E'\n\nAdd, park or skip each one. Nothing installs without Ares.',
    'active', 'Radar', 'https://cloud.bestly.tech/admin/skill-inbox', null,
    'radar-skill-picks-' || v_day::text, null, null, false, now());
  perform set_config('bestly.from', '', true);

  update public.skill_inbox_state set push_sent_on = v_day where id;
  return jsonb_build_object('ok', true, 'picks', v_open, 'channel', v_ch);
end $$;

revoke all on function public.skill_inbox_key_ok(text)                       from public, anon, authenticated;
revoke all on function public.skill_inbox_ingest(jsonb)                      from public, anon, authenticated;
revoke all on function public.skill_inbox_known(int)                         from public, anon, authenticated;
revoke all on function public.skill_inbox_claim(int)                         from public, anon, authenticated;
revoke all on function public.skill_inbox_finish(uuid, jsonb)                from public, anon, authenticated;
revoke all on function public.skill_inbox_requeue(int, int)                  from public, anon, authenticated;
revoke all on function public.skill_inbox_set_boosts(jsonb)                  from public, anon, authenticated;
revoke all on function public.skill_inbox_pick(date, int, boolean)           from public, anon, authenticated;
revoke all on function public.skill_inbox_push_today()                       from public, anon, authenticated;
grant execute on function public.skill_inbox_key_ok(text)                    to service_role;
grant execute on function public.skill_inbox_ingest(jsonb)                   to service_role;
grant execute on function public.skill_inbox_known(int)                      to service_role;
grant execute on function public.skill_inbox_claim(int)                      to service_role;
grant execute on function public.skill_inbox_finish(uuid, jsonb)             to service_role;
grant execute on function public.skill_inbox_requeue(int, int)               to service_role;
grant execute on function public.skill_inbox_set_boosts(jsonb)               to service_role;
grant execute on function public.skill_inbox_pick(date, int, boolean)        to service_role;
grant execute on function public.skill_inbox_push_today()                    to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Radar owns it: alerts, Pi job registry, team card
-- ---------------------------------------------------------------------------------------------------------------------
-- Alerts keyed radar-skill.* are signed by Radar (notification_owner() resolves the prefix to platform-radar).
insert into public.notification_owners (prefix, agent_slug, note)
select 'radar-skill', 'platform-radar', 'Skill Inbox (Radar)'
where not exists (select 1 from public.notification_owners where prefix = 'radar-skill');

-- Pi job registry (max gap before pi_jobs_watch alerts Scout): the 2-hour job, the hourly 9 AM push gate, the 3-hour watchdog.
insert into public.pi_jobs (job, description, max_gap_min) values
  ('skill_inbox',       'Skill Inbox: transcribe, extract, vet and score new Instagram Saves (Radar)', 150),
  ('skill_inbox_push',  'Skill Inbox: 9:00 AM PT picks push, signed Radar',                             90),
  ('skill_inbox_watch', 'Skill Inbox watchdog: restart stuck rows, retry errors, alert on no sync',    240)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min;

-- Radar's team card: what it does, schedule, and every job it owns (pulse.also) plus the alert prefixes it owns (pulse.issues).
update public.bestly_agents set
  what_it_does = what_it_does || ' It also runs the Skill Inbox: it watches the AI skills and tools Jared saves on Instagram, has Ares check each one is safe, says which employee or app it fits, and shows at most 3 picks a day in the admin. Everything else is parked, not lost.',
  schedule     = 'Every 3 hours + Monday digest. Skill Inbox every 2 hours, picks at 9:00 AM',
  admin_url    = coalesce(admin_url, '/admin/skill-inbox'),
  pulse        = coalesce(pulse, '{}'::jsonb)
                 || jsonb_build_object('also', to_jsonb(array['skill_inbox','skill_inbox_push','skill_inbox_watch']),
                                       'issues', to_jsonb(array['platform.','radar-skill.'])),
  updated_at   = now()
where slug = 'platform-radar' and what_it_does not like '%Skill Inbox%';
