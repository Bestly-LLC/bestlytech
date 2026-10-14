-- House autopost part 7: what the Studio app needs so house brands get the same calendar as Centering YOU (Spark, 2026-10-14).
-- 1. studio_clients says which brands autopost and what their weekly cap is (the app shows the Calendar tab from it).
-- 2. studio_house_post (the manual "Post now" / dated Schedule in the sheet) obeys the same weekly cap, and a dated Schedule
--    refuses a pause day (Election Day, a brand's own skip days). "Post now" stays an explicit override of the pause day only.
-- 3. studio_house_post_state suggests the planner's next open slot (not just "tomorrow at the usual time") and reports week use.
-- 4. studio_item_schedule (the time box on the card) uses the account's brand for time zone and usual hour, and refuses pause days.
-- 5. client_posting_state reports the real cap and that posting is automatic once approved.
-- Nothing here posts anything: every path still needs Jared's Approve for the current version (studio_clear_state).

create or replace function public.studio_clients(p_token text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare s public.studio_caller;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'clients', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'slug', c.slug, 'name', c.name, 'contact', c.contact_name,
             'kind', c.kind,
             'brand', c.social_brand,
             'handle', coalesce(sa.handle, case when c.kind = 'house' then public.house_post_targets(c.id)->0->>'handle' end),
             'accent', sa.accent,
             'guide_only', coalesce(c.guide_only, false),
             'post_targets', case when c.kind = 'house' then public.house_post_targets(c.id) end,
             'autopost', case when c.kind = 'house' and c.calendar_autopost then true end,
             'week_cap', case when c.kind = 'house' and c.calendar_autopost then public.studio_week_cap(c.id) end,
             'shares_with', case when c.kind = 'house' and c.calendar_autopost and cardinality(public.studio_group(c.id)) > 1
                                 then (select jsonb_agg(k.name order by k.name) from public.approval_clients k
                                        where k.id = any(public.studio_group(c.id)) and k.id <> c.id) end,
             'logo_path', (select u.path from public.client_uploads u
                            where u.client_id = c.id and u.purpose = 'brand_guide'
                              and u.question_key = 'logo' and u.mime like 'image/%'
                              and u.status not in ('failed','removed')
                            order by u.created_at desc limit 1),
             'open_asks', case when c.kind = 'client'
                 then (select count(*) from public.client_asks a where a.client_id = c.id and a.status in ('draft','open','received'))
                 else 0 end,
             'board_url', case when c.kind = 'client' then 'https://studio.bestly.tech/' || c.slug || '?c=' || c.access_token end,
             'guide_url', 'https://studio.bestly.tech/' || c.slug || '?c=' || c.access_token || '#guide'))
           order by c.kind, c.name)
      from public.approval_clients c
      left join public.social_accounts sa on sa.brand = c.social_brand and sa.platform = 'instagram'
     where c.active and public.staff_may_see(s.id, c.id)), '[]'::jsonb));
end $$;

-- 2. Manual "Post now" and dated Schedule obey the weekly cap; a dated Schedule also refuses a pause day --------
create or replace function public.studio_house_post(p_token text, p_item uuid, p_date date default null, p_time text default null, p_platform text default 'instagram')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s studio_caller; it approval_items%rowtype; c approval_clients%rowtype; t jsonb; v_miss text[]; v_at timestamptz; r jsonb; v_tz text; v_now boolean; v_why text;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if exists (select 1 from approval_staff a where a.id = s.id and a.is_system) then
    return jsonb_build_object('ok', false, 'error', 'human_required'); end if;
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into c from approval_clients where id = it.client_id;
  if c.kind is distinct from 'house' then return jsonb_build_object('ok', false, 'error', 'not_house'); end if;
  if it.posted_at is not null then return jsonb_build_object('ok', false, 'error', 'already_posted'); end if;
  if it.internal_status = 'killed' or coalesce(public.studio_signoff(p_item)->>'state', 'pending') is distinct from 'approved' then
    return jsonb_build_object('ok', false, 'error', 'not_approved', 'detail', 'Approve it first. Nothing posts before the team has signed off.'); end if;
  v_miss := public.post_sells_product(p_item);
  if coalesce(array_length(v_miss, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'error', 'held', 'detail', 'A house rule holds it: ' || array_to_string(v_miss, '; ')); end if;
  select x into t from jsonb_array_elements(public.house_post_targets(c.id)) x where x->>'platform' = p_platform limit 1;
  if t is null then return jsonb_build_object('ok', false, 'error', 'no_account', 'detail', 'This project has no ' || p_platform || ' account to post to.'); end if;
  if not (t->>'ready')::boolean then
    return jsonb_build_object('ok', false, 'error', 'account_not_ready', 'detail', coalesce(t->>'handle', 'The account') || ' ' || coalesce(t->>'why', 'is not ready')); end if;
  v_tz := coalesce((select sb.tz from social_brand_settings sb where sb.brand = t->>'brand'), 'America/Los_Angeles');
  if p_date is not null then
    begin v_at := (p_date + coalesce(nullif(p_time, ''), '09:15')::time) at time zone v_tz;
    exception when others then return jsonb_build_object('ok', false, 'error', 'bad_time', 'detail', 'That time did not make sense.'); end;
    if v_at < now() - interval '2 minutes' then return jsonb_build_object('ok', false, 'error', 'in_the_past', 'detail', 'That time has already passed.'); end if;
  else
    v_at := now();
  end if;
  if v_at > now() + interval '90 days' then return jsonb_build_object('ok', false, 'error', 'too_far', 'detail', 'Pick a time within the next 90 days.'); end if;
  if coalesce(c.calendar_autopost, false) then
    r := public.studio_cal_week_full(p_item, (v_at at time zone v_tz)::date);
    if r is not null then return r || jsonb_build_object('detail', r->>'message'); end if;
    if p_date is not null then
      v_why := public.studio_cal_blocked(c.slug, p_date);
      if v_why is not null then
        return jsonb_build_object('ok', false, 'error', 'blackout', 'detail', 'That day is a pause day (' || v_why || '). Pick another day.'); end if;
    end if;
  end if;
  perform set_config('studio.house_account', t->>'id', true);
  r := public.social_enqueue_item(p_item, v_at, s.name, false, p_platform);
  perform set_config('studio.house_account', '', true);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  update approval_items set posting_ready_at = coalesce(posting_ready_at, now()), scheduled_at = v_at,
         scheduled_for = (v_at at time zone v_tz)::date, time_locked = true,
         slot_reason = 'Set by ' || s.name || '. Spark will not move it.', slot_by = s.name where id = p_item;
  insert into approval_item_events (item_id, kind, actor_kind, staff_id, payload)
  values (p_item, 'posting_ready', 'staff', s.id, jsonb_build_object('by', s.name, 'house_post', r->'post', 'handle', t->>'handle', 'at', v_at));
  v_now := v_at <= now() + interval '1 minute';
  if v_now then perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action', 'drain'), 5000); end if;
  return r || jsonb_build_object('handle', t->>'handle', 'now', v_now);
end $$;

-- 3. The sheet's suggested time follows the planner (open day, pause days, spacing), and the week's use is reported --------
create or replace function public.studio_house_post_state(p_token text, p_item uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare s studio_caller; it approval_items%rowtype; c approval_clients%rowtype; v_t jsonb; v_first jsonb; v_brand text; v_tz text;
  v_posts jsonb; v_caps jsonb := '{}'::jsonb; v_slot timestamptz; v_d date; k int; e jsonb; v_auto boolean; v_today date; v_used int; v_cap int;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into c from approval_clients where id = it.client_id;
  if c.kind is distinct from 'house' then return jsonb_build_object('ok', true, 'house', false); end if;
  v_auto := coalesce(c.calendar_autopost, false);
  v_t := public.house_post_targets(c.id);
  for e in select * from jsonb_array_elements(v_t) loop
    v_caps := v_caps || jsonb_build_object(e->>'platform', public.house_post_caption(p_item, e->>'platform'));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'platform', p.platform, 'handle', a.handle, 'status', p.status,
      'scheduled_at', p.scheduled_at, 'posted_at', p.posted_at, 'error', p.error, 'permalink', p.permalink,
      'attempts', p.attempts, 'max_attempts', p.max_attempts) order by p.created_at desc), '[]'::jsonb)
    into v_posts
    from public.social_posts p left join public.social_accounts a on a.brand = p.brand and a.platform = p.platform
   where p.approval_item_id = p_item;
  v_first := (select x from jsonb_array_elements(v_t) x where (x->>'ready')::boolean limit 1);
  v_brand := case when v_auto then public.studio_brand_of(c.id) else v_first->>'brand' end;
  v_tz := coalesce((select sb.tz from social_brand_settings sb where sb.brand = v_brand), 'America/Los_Angeles');
  v_today := (now() at time zone v_tz)::date;
  if v_brand is not null then
    for k in 0..60 loop
      v_d := v_today + k;
      v_slot := case when v_auto then public.studio_cal_time(v_brand, v_d) else public.social_default_at(v_brand, v_d) end;
      if v_slot > now() + interval '15 minutes' then
        if v_auto then
          if public.studio_cal_day_check(c.id, v_d, p_item, false) is null then exit; end if;
        elsif not exists (select 1 from social_posts q where q.brand = v_brand and q.status in ('queued','posting')
                           and (q.scheduled_at at time zone v_tz)::date = v_d) then exit; end if;
      end if;
      v_slot := null;
    end loop;
  end if;
  if v_auto then v_used := public.studio_cal_week_count(c.id, v_today, p_item); v_cap := public.studio_week_cap(c.id); end if;
  return jsonb_build_object('ok', true, 'house', true, 'tz', v_tz, 'targets', v_t, 'posts', v_posts,
                            'captions', v_caps, 'next_slot', v_slot, 'autopost', v_auto,
                            'week_used', v_used, 'week_cap', v_cap,
                            'slot_reason', it.slot_reason, 'scheduled_at', it.scheduled_at);
end $$;

-- 4. The time box on a card: a house brand uses its account's brand for the time zone and usual hour, and refuses a pause day ----
create or replace function public.studio_item_schedule(p_token text, p_item uuid, p_date date, p_time text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s studio_caller; it approval_items%rowtype; c approval_clients%rowtype; v_tz text; v_at timestamptz; v_lock boolean := false; v_b text; v_why text;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into c from approval_clients where id = it.client_id;
  v_b := case when c.kind = 'house' then public.studio_brand_of(c.id) else c.social_brand end;
  if p_date is null then
    update approval_items set scheduled_for = null, scheduled_at = null, time_locked = false,
           cal_hold = c.calendar_autopost, slot_reason = case when c.calendar_autopost then 'Taken off the calendar by ' || s.name || '. Spark will not schedule it.' else null end,
           slot_by = s.name where id = p_item;
    update social_posts set status = 'canceled' where approval_item_id = p_item and status = 'queued';
    return jsonb_build_object('ok', true, 'on', null);
  end if;
  if public.studio_cal_week_full(p_item, p_date) is not null then return public.studio_cal_week_full(p_item, p_date); end if;
  if c.kind = 'house' and c.calendar_autopost then
    v_why := public.studio_cal_blocked(c.slug, p_date);
    if v_why is not null then
      return jsonb_build_object('ok', false, 'error', 'blackout', 'message', 'That day is a pause day (' || v_why || '). Pick another day.'); end if;
  end if;
  select coalesce(sb.tz, 'America/Los_Angeles') into v_tz from social_brand_settings sb where sb.brand = v_b;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');
  if p_time is not null and p_time <> '' then
    v_at := (p_date + p_time::time) at time zone v_tz; v_lock := true;
  elsif it.scheduled_at is not null and it.time_locked and it.scheduled_for = p_date then
    v_at := it.scheduled_at; v_lock := true;
  elsif it.scheduled_at is not null and it.time_locked then
    v_at := (p_date + (it.scheduled_at at time zone v_tz)::time) at time zone v_tz; v_lock := true;
  elsif c.calendar_autopost then
    v_at := public.studio_cal_time(v_b, p_date); v_lock := true;
  else
    v_at := public.social_default_at(v_b, p_date);
  end if;
  update approval_items set scheduled_for = p_date, scheduled_at = v_at, time_locked = v_lock, cal_hold = false,
         slot_reason = 'Set by ' || s.name || '. Spark will not move it.', slot_by = s.name where id = p_item;
  update social_posts set scheduled_at = v_at where approval_item_id = p_item and status = 'queued';
  return jsonb_build_object('ok', true, 'on', p_date, 'at', v_at, 'locked', v_lock);
end $$;

-- 5. Posting state: a house brand with autopost reports its real cap and that approved posts go out by themselves --------
create or replace function public.client_posting_state(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare c approval_clients%rowtype; st social_brand_settings%rowtype; v_pl text[] := array['instagram','facebook','tiktok','linkedin']; p text; v_out jsonb := '[]'::jsonb; a social_accounts%rowtype; v_tt boolean; v_fb boolean; v_b text; v_house boolean;
begin
  select * into c from approval_clients where id = p_client;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'no_client'); end if;
  v_house := (c.kind = 'house' and coalesce(c.calendar_autopost, false));
  v_b := case when v_house then public.studio_brand_of(c.id) else c.social_brand end;
  if v_b is not null then select * into st from social_brand_settings where brand = v_b; end if;
  v_tt := public.studio_tiktok_ready();
  v_fb := public.studio_fb_ready();
  foreach p in array v_pl loop
    a := null;
    if v_b is not null then select * into a from social_accounts where brand = v_b and platform = p; end if;
    v_out := v_out || jsonb_build_object(
      'platform', p,
      'available', p = 'instagram' or (p = 'tiktok' and v_tt) or (p = 'facebook' and v_fb and coalesce((st.platforms->>'facebook_offered')::boolean, false)),
      'mode', case when p = 'tiktok' then 'inbox' else 'direct' end,
      'enabled', coalesce((st.platforms->>p)::boolean, p = 'instagram'),
      'connected', a.id is not null and a.access_token is not null and a.remote_user_id is not null,
      'active', coalesce(a.active, false),
      'handle', a.handle,
      'connected_at', a.updated_at,
      'expires_at', case when p = 'tiktok' then a.refresh_expires_at else a.token_expires_at end,
      'needs_attention', a.id is not null and a.access_token is not null and (not coalesce(a.active, false)
         or (p <> 'tiktok' and a.token_expires_at is not null and a.token_expires_at < now() + interval '3 days')
         or (p = 'tiktok' and a.refresh_expires_at is not null and a.refresh_expires_at < now() + interval '7 days')),
      'paused', coalesce(a.publishing_paused, false),
      'queued', (select count(*) from social_posts q where q.brand = v_b and q.platform = p and q.status in ('queued','held')),
      'in_drafts', (select count(*) from social_posts q where q.brand = v_b and q.platform = p and q.status = 'in_drafts'),
      'posted', (select count(*) from social_posts q where q.brand = v_b and q.platform = p and q.status = 'posted'),
      'connect', public.client_connect_tile(p_client, p));
  end loop;
  return jsonb_build_object('ok', true,
    'publish_mode', coalesce(c.publish_mode, 'push'), 'auto', (c.publish_mode = 'auto') or v_house, 'brand', v_b,
    'posts_per_week', case when v_house then public.studio_week_cap(c.id) else coalesce(st.posts_per_week, 3) end,
    'window_start', coalesce(st.window_start, '08:00'::time), 'window_end', coalesce(st.window_end, '20:00'::time),
    'tz', coalesce(st.tz, 'America/Los_Angeles'), 'days', to_jsonb(st.days), 'accounts', v_out);
end $$;

-- 6. The Calendar tab for a house brand: its own dates (not Centering YOU's), and every project on the same @handle ------
-- A shared account (@bestly_llc) shows the posts of all three projects on one calendar, because the 7-a-week cap is shared.
-- Posts that belong to a sibling project carry "other" (its name); the app shows them read-only.
create or replace function public.studio_calendar(p_token text, p_client_slug text, p_days integer default 30, p_from date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare s public.studio_caller; v_client uuid; v_from date; v_to date; v_brand text; v_tz text; v_house boolean; v_group uuid[];
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_slug(s.id, p_client_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select id, social_brand, coalesce(nullif(tz, ''), 'America/Los_Angeles') into v_client, v_brand, v_tz from public.approval_clients where slug = p_client_slug;
  if v_client is null then return jsonb_build_object('ok', false, 'error', 'no_client'); end if;
  v_house := exists (select 1 from public.approval_clients where id = v_client and kind = 'house' and calendar_autopost);
  v_group := case when v_house then public.studio_group(v_client) else array[v_client] end;
  v_from := coalesce(p_from, current_date);
  v_to := v_from + greatest(7, least(coalesce(p_days, 30), 120));
  return jsonb_build_object('ok', true, 'from', v_from, 'to', v_to, 'today', current_date,
    'posting', public.client_posting_state(v_client),
    'dates', case when v_house then coalesce((select jsonb_agg(jsonb_build_object('on', e.starts_on, 'name', e.name,
                         'kind', case when e.blackout then 'pause' else 'day' end,
                         'note', case when e.blackout then 'No posts today' else nullif(rtrim(coalesce(e.angle, ''), '. '), '') end) order by e.starts_on)
                         from (select distinct on (x.starts_on, x.name) x.* from public.studio_calendar_events x
                               where x.starts_on between v_from and v_to and (x.blackout or x.relevance in ('high', 'medium'))
                                 and (x.client_slug is null or x.client_slug in (select k.slug from public.approval_clients k where k.id = any(v_group)))
                               order by x.starts_on, x.name, x.client_slug nulls first) e), '[]'::jsonb)
                  else coalesce((select jsonb_agg(jsonb_build_object('on', d.on_date, 'name', d.name, 'kind', d.kind, 'note', d.note) order by d.on_date)
                         from public.calendar_dates(v_from, v_to) d), '[]'::jsonb) end,
    'posts', coalesce((select jsonb_agg(x.j order by x.sa nulls last, x.sf)
                 from (
                   select it.scheduled_at as sa, it.scheduled_for as sf,
                          jsonb_build_object('id', it.id, 'on', dd.on_date, 'at', it.scheduled_at, 'locked', it.time_locked, 'title', it.title,
                                 'media_type', it.media_type, 'platform', it.platform, 'stage', it.stage,
                                 'status', it.status, 'internal_status', it.internal_status, 'posted_at', it.posted_at, 'posted_note', it.posted_note,
                                 'platforms', to_jsonb(public.item_platforms(it.id)), 'platforms_set', it.platforms is not null,
                                 'social', public.item_social_rows(it.id),
                                 'thumb', coalesce(it.thumb_url, (select sl.media_url from public.approval_slides sl where sl.item_id = it.id and sl.media_url is not null order by sl.position limit 1)),
                                 'slides', (select count(*) from public.approval_slides sl where sl.item_id = it.id),
                                 'lane', l.lane,
                                 'code', it.code, 'slot_reason', it.slot_reason, 'held', it.cal_hold,
                                 'other', case when it.client_id <> v_client then (select k.name from public.approval_clients k where k.id = it.client_id) end,
                                 'her', (it.posted_at is not null or l.lane in ('sched','ready','posted'))) j
                     from public.approval_items it
                    cross join lateral (select public.studio_lane_of(it.id) as lane) l
                    cross join lateral (select case when it.posted_at is not null then (it.posted_at at time zone v_tz)::date
                                                    when it.scheduled_at is not null then (it.scheduled_at at time zone v_tz)::date
                                                    else it.scheduled_for end as on_date) dd
                    where it.client_id = any(v_group) and it.status <> 'draft'
                      and dd.on_date between v_from and v_to
                      and ((it.stage = 'client' or it.posted_at is not null or coalesce(it.internal_status,'pending') in ('pending','approved'))
                           or (it.posted_at is not null or l.lane in ('sched','ready','posted')))
                 ) x), '[]'::jsonb),
    'asks', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'on', a.due, 'title', a.title, 'status', a.status, 'her', a.status in ('open','received')) order by a.due)
                        from public.client_asks a
                       where a.client_id = v_client and a.status <> 'closed' and a.due between v_from and v_to), '[]'::jsonb),
    'todos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'on', t.due, 'title', t.title, 'status', t.status) order by t.due)
                         from public.client_todos t
                        where t.client_id = v_client and t.status = 'open' and t.due between v_from and v_to), '[]'::jsonb),
    'undated', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'title', it.title, 'media_type', it.media_type,
                                 'stage', it.stage, 'status', it.status, 'internal_status', it.internal_status,
                                 'thumb', coalesce(it.thumb_url, (select sl.media_url from public.approval_slides sl where sl.item_id = it.id and sl.media_url is not null order by sl.position limit 1)),
                                 'slides', (select count(*) from public.approval_slides sl where sl.item_id = it.id)) order by it.position, it.created_at)
                           from public.approval_items it
                          where it.client_id = v_client and it.status <> 'draft' and it.scheduled_for is null
                            and (it.stage = 'client' or coalesce(it.internal_status,'pending') in ('pending','approved'))), '[]'::jsonb));
end $$;

-- 7. The iPhone feed (calendar-ics) follows the same rules: a house brand shows its own dates and pause days (not Centering YOU's),
-- and a shared @handle shows the posts of every project on it. Letters come from calendar_post_platforms, so "[I]" for Instagram.
create or replace function public.calendar_feed_read(p_key text, p_back integer default 60, p_fwd integer default 240) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare f public.calendar_feeds%rowtype; v_client uuid; v_name text; v_from date; v_to date; v_staff boolean; v_house boolean; v_group uuid[];
begin
  select * into f from public.calendar_feeds where key = p_key and revoked_at is null;
  if f.key is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update public.calendar_feeds set last_read = now() where key = p_key;

  v_staff := f.kind = 'staff';
  v_client := f.client_id;
  select name into v_name from public.approval_clients where id = v_client;
  v_house := exists (select 1 from public.approval_clients where id = v_client and kind = 'house' and calendar_autopost);
  v_group := case when v_house then public.studio_group(v_client) else array[v_client] end;
  v_from := current_date - greatest(0, least(coalesce(p_back, 60), 365));
  v_to   := current_date + greatest(7, least(coalesce(p_fwd, 240), 730));

  -- 2026-10-13 (Jared): posts appear on the calendar only once they are cleared to post
  -- (lane sched/ready) or posted. Anything still with the client, needing changes, ours or killed stays off.
  return jsonb_build_object('ok', true, 'name', v_name, 'staff', v_staff, 'from', v_from, 'to', v_to,
    'dates', case when v_house then coalesce((select jsonb_agg(jsonb_build_object('on', e.starts_on, 'slug', coalesce(e.client_slug, 'house'), 'name', e.name,
                         'kind', case when e.blackout then 'pause' else 'day' end,
                         'note', case when e.blackout then 'No posts today' else nullif(rtrim(coalesce(e.angle, ''), '. '), '') end) order by e.starts_on)
                         from (select distinct on (x.starts_on, x.name) x.* from public.studio_calendar_events x
                               where x.starts_on between v_from and v_to and (x.blackout or x.relevance in ('high', 'medium'))
                                 and (x.client_slug is null or x.client_slug in (select k.slug from public.approval_clients k where k.id = any(v_group)))
                               order by x.starts_on, x.name, x.client_slug nulls first) e), '[]'::jsonb)
                  else coalesce((select jsonb_agg(jsonb_build_object('on', d.on_date, 'slug', d.slug, 'name', d.name, 'kind', d.kind, 'note', d.note) order by d.on_date)
                         from public.calendar_dates(v_from, v_to) d), '[]'::jsonb) end,
    'posts', coalesce((select jsonb_agg(x.j order by x.on_date) from (
                         select it.scheduled_for as on_date, jsonb_build_object('id', it.id, 'on', it.scheduled_for, 'title', it.title,
                                 'media_type', it.media_type, 'platform', it.platform, 'stage', it.stage,
                                 'status', it.status, 'internal_status', it.internal_status, 'posted_at', it.posted_at,
                                 'scheduled_at', it.scheduled_at, 'lane', l.lane,
                                 'where', public.calendar_post_platforms(it.id),
                                 'links', coalesce((select jsonb_object_agg(sp.platform, sp.permalink) from public.social_posts sp
                                                     where sp.approval_item_id = it.id and sp.status = 'posted' and sp.permalink is not null), '{}'::jsonb),
                                 'v', it.content_version, 'at', it.created_at) as j
                           from public.approval_items it
                           cross join lateral (select public.studio_lane_of(it.id) as lane) l
                          where it.client_id = any(v_group) and it.status <> 'draft'
                            and it.scheduled_for between v_from and v_to
                            and (it.posted_at is not null or l.lane in ('sched','ready','posted'))) x), '[]'::jsonb),
    'asks', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'on', a.due, 'title', a.title, 'status', a.status,
                                 'seconds', a.target_seconds, 'at', a.created_at) order by a.due)
                        from public.client_asks a
                       where a.client_id = v_client and a.due between v_from and v_to
                         and (v_staff or a.status in ('open','received'))
                         and a.status <> 'draft'), '[]'::jsonb),
    'todos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'on', t.due, 'title', t.title,
                                 'status', t.status, 'next', t.forward->>'next',
                                 'blocked', t.forward->>'blocked', 'at', t.created_at,
                                 'done_at', t.done_at) order by t.due)
                         from public.client_todos t
                        where t.client_id = v_client and t.due between v_from and v_to
                          and t.status not in ('dropped', 'draft')), '[]'::jsonb));
end $$;

-- 8. Platform letters for house posts: the account the project posts to (approval_client_accounts), not social_accounts.client_id,
-- which only names one of the three projects that share @bestly_llc. Dates are listed once even when three projects carry the same event.
create or replace function public.calendar_post_platforms(p_item uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with it as (select id, client_id, platform from public.approval_items where id = p_item),
  posted as (select distinct sp.platform from public.social_posts sp where sp.approval_item_id = p_item and sp.status = 'posted'),
  wanted as (
    select distinct v.platform from public.approval_variants v where v.item_id = p_item
    union select it.platform from it where it.platform is not null
      and not exists (select 1 from public.approval_variants v where v.item_id = p_item)),
  live as (select distinct a.platform from public.social_accounts a, it
            where a.client_id = it.client_id and a.active and not coalesce(a.publishing_paused, false)),
  hz as (select coalesce(bool_or(c.kind = 'house' and coalesce(c.calendar_autopost, false)), false) as is_house
           from public.approval_clients c join it on c.id = it.client_id)
  select jsonb_build_object(
    'posted',  coalesce((select jsonb_agg(platform) from posted), '[]'::jsonb),
    'planned', case when (select is_house from hz)
                    then coalesce((select jsonb_agg(p) from unnest(public.house_item_platforms(p_item)) p where p not in (select platform from posted)), '[]'::jsonb)
                    else coalesce((select jsonb_agg(w.platform) from wanted w where w.platform in (select platform from live)
                           and w.platform not in (select platform from posted)), '[]'::jsonb) end,
    'not_connected', case when (select is_house from hz) then '[]'::jsonb
                    else coalesce((select jsonb_agg(w.platform) from wanted w where w.platform not in (select platform from live)
                           and w.platform not in (select platform from posted)), '[]'::jsonb) end);
$$;

-- 9. Grants. The helpers below are only ever called from other SECURITY DEFINER functions and triggers, never by a browser.
-- The three app RPCs are token-gated (the staff session is the check) and are listed so Ares leaves them alone.
revoke all on function public.studio_cal_day_check(uuid, date, uuid, boolean), public.studio_client_tz(uuid), public.studio_title_overlap(text, text),
  public.studio_week_cap(uuid), public.studio_cal_has_post(uuid, date, uuid), public.studio_cal_week_count(uuid, date, uuid),
  public.trg_social_posts_house_gate() from public, anon, authenticated;
insert into public.security_public_rpcs (fn, why) values
  ('studio_clients', 'Studio app: the staff session token is the check; lists the projects that staff member may see'),
  ('studio_calendar', 'Studio app Calendar tab: staff session token is the check'),
  ('studio_item_schedule', 'Studio app: put a post on a day. Staff session token is the check; refuses a full week or a pause day')
on conflict (fn) do nothing;
