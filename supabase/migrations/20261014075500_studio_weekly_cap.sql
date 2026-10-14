-- Studio weekly cap, one week definition (Spark, 2026-10-14).
-- Jared: "still showing six posts next week, the maximum is five a week."
-- Root cause: the planner and the cap counted Monday-Sunday weeks (date_trunc('week')) while both
-- calendar grids (Studio, the client board) and phone calendars draw Sunday-Saturday weeks.
-- Sun 10/18 + Mon-Fri 10/19-23 = 6 in the grid's week, 5 in the planner's.
-- Also: a post the team marked "changes" still cleared under client_yes_is_final (CY22).
-- See docs/studio-weekly-cap-opusplan.md.

-- 1. One week definition, per client ------------------------------------------------------------
alter table public.approval_clients
  add column if not exists week_start text not null default 'sunday';
do $$ begin
  alter table public.approval_clients add constraint approval_clients_week_start_chk
    check (week_start in ('sunday', 'monday'));
exception when duplicate_object then null; end $$;
comment on column public.approval_clients.week_start is
  'First day of the week for the posting cap and week counts. Default sunday = what the Studio and board grids and phone calendars draw. The grids are hard-wired to Sunday, so do not set monday until they read this column.';

create or replace function public.studio_client_tz(p_client uuid) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select coalesce(nullif(c.tz, ''), nullif(s.tz, ''))
                     from approval_clients c left join social_brand_settings s on s.brand = c.social_brand
                    where c.id = p_client), 'America/Los_Angeles')
$$;

create or replace function public.studio_week_start(p_client uuid, p_day date) returns date
language sql stable security definer set search_path to 'public' as $$
  select case when coalesce((select week_start from approval_clients where id = p_client), 'sunday') = 'monday'
              then p_day - (extract(isodow from p_day)::int - 1)
              else p_day - extract(dow from p_day)::int end
$$;

create or replace function public.studio_week_of(p_client uuid, p_ts timestamptz) returns date
language sql stable security definer set search_path to 'public' as $$
  select public.studio_week_start(p_client, (p_ts at time zone public.studio_client_tz(p_client))::date)
$$;

create or replace function public.studio_week_cap(p_client uuid) returns int
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select s.posts_per_week from approval_clients c
                     join social_brand_settings s on s.brand = c.social_brand where c.id = p_client), 5)
$$;

-- the day an item sits on the calendar (the grid rule: posted_at, then scheduled_at, then scheduled_for)
create or replace function public.studio_item_day(p_client uuid, p_posted timestamptz, p_at timestamptz, p_for date) returns date
language sql stable security definer set search_path to 'public' as $$
  select coalesce((p_posted at time zone public.studio_client_tz(p_client))::date,
                  (p_at at time zone public.studio_client_tz(p_client))::date, p_for)
$$;

-- 2. Counts and checks use that definition ------------------------------------------------------
create or replace function public.studio_cal_week_count(p_client uuid, p_day date, p_skip uuid default null)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from approval_items i
   where i.client_id = p_client and i.id is distinct from p_skip
     and public.studio_item_day(p_client, i.posted_at, i.scheduled_at, i.scheduled_for)
         between public.studio_week_start(p_client, p_day) and public.studio_week_start(p_client, p_day) + 6
$$;

create or replace function public.studio_cal_week_full(p_item uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare it approval_items%rowtype; c approval_clients%rowtype; cap int; n int;
begin
  select * into it from approval_items where id = p_item;
  select * into c from approval_clients where id = it.client_id;
  if not coalesce(c.calendar_autopost, false) then return null; end if;
  cap := public.studio_week_cap(c.id);
  n := public.studio_cal_week_count(c.id, p_day, p_item);
  if n >= cap then
    return jsonb_build_object('ok', false, 'error', 'week_full',
      'message', format('The week of %s already has %s posts. The limit is %s a week. Pick another week, or hold one of the others first.',
                        to_char(public.studio_week_start(c.id, p_day), 'Mon FMDD'), n, cap));
  end if;
  return null;
end $$;

create or replace function public.studio_cal_day_free(p_client uuid, p_day date, p_skip uuid default null)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare c approval_clients%rowtype; st social_brand_settings%rowtype; v_tz text; n int; b text;
begin
  select * into c from approval_clients where id = p_client;
  select * into st from social_brand_settings where brand = c.social_brand;
  v_tz := coalesce(st.tz, 'America/Los_Angeles');
  if p_day < (now() at time zone v_tz)::date then return 'past'; end if;
  if public.studio_cal_time(c.social_brand, p_day) < now() + interval '30 minutes' then return 'too_soon'; end if;
  b := public.studio_cal_blocked(c.slug, p_day); if b is not null then return 'blackout: ' || b; end if;
  if st.days is not null and not (extract(dow from p_day)::int = any(st.days)) then return 'not_a_posting_day'; end if;
  select count(*) into n from approval_items i
   where i.client_id = p_client and i.id is distinct from p_skip
     and public.studio_item_day(p_client, i.posted_at, i.scheduled_at, i.scheduled_for) = p_day;
  if n > 0 then return 'day_taken'; end if;
  if public.studio_cal_week_count(p_client, p_day, p_skip) >= public.studio_week_cap(p_client) then return 'week_full'; end if;
  return null;
end $$;

-- 3. Structural guard: a write can never put a 6th post in a week --------------------------------
create or replace function public.trg_items_week_cap() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare c approval_clients%rowtype; v_day date; v_try date; v_new date; n int; cap int; v_wk text; i int; v_at timestamptz;
begin
  if new.posted_at is not null or (new.scheduled_at is null and new.scheduled_for is null) then return new; end if;
  if TG_OP = 'UPDATE' and new.scheduled_at is not distinct from old.scheduled_at
     and new.scheduled_for is not distinct from old.scheduled_for then return new; end if;
  select * into c from approval_clients where id = new.client_id;
  if not coalesce(c.calendar_autopost, false) then return new; end if;
  perform pg_advisory_xact_lock(hashtext('weekcap:' || c.id::text));
  v_day := public.studio_item_day(c.id, null, new.scheduled_at, new.scheduled_for);
  cap := public.studio_week_cap(c.id);
  n := public.studio_cal_week_count(c.id, v_day, new.id);
  if n < cap then return new; end if;
  v_wk := to_char(public.studio_week_start(c.id, v_day), 'Mon FMDD');
  for i in 1..120 loop
    v_try := v_day + i;
    if public.studio_cal_day_free(c.id, v_try, new.id) is null then v_new := v_try; exit; end if;
  end loop;
  if v_new is null then
    new.scheduled_at := null; new.scheduled_for := null; new.time_locked := false; new.slot_by := 'Spark';
    new.slot_reason := format('Not dated: the week of %s already has %s posts and no later day was open.', v_wk, cap);
  else
    v_at := public.studio_cal_time(c.social_brand, v_new);
    new.scheduled_for := v_new; new.scheduled_at := v_at; new.time_locked := false; new.slot_by := 'Spark';
    new.slot_reason := format('Moved to %s: the week of %s already had %s posts (the limit).', to_char(v_new, 'Mon FMDD'), v_wk, cap);
    update social_posts set scheduled_at = v_at where approval_item_id = new.id and status = 'queued';
  end if;
  begin
    if TG_OP = 'UPDATE' then
      insert into approval_item_events (item_id, kind, actor_kind, payload)
      values (new.id, 'calendar_slot', 'system', jsonb_build_object('by', 'Spark', 'why', 'week_full', 'week', v_wk, 'cap', cap, 'moved_to', v_new));
    end if;
    perform public.bestly_raise('studio.weekly-cap.' || c.id::text || '.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD'),
      'problem', 'info', 'A post was moved: that week was full',
      format('%s %s: the week of %s already had %s posts, so it now sits on %s.', c.name, new.code, v_wk, cap, coalesce(to_char(v_new, 'Mon FMDD'), 'no date')),
      'studio', null, true);
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists items_week_cap on public.approval_items;
create trigger items_week_cap before insert or update of scheduled_at, scheduled_for on public.approval_items
  for each row execute function public.trg_items_week_cap();

-- 4. Watchdog: any week over the cap loses its latest posts to the next open slot -----------------
create or replace function public.studio_cal_enforce_cap() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c record; r record; v_tz text; cap int; v_out jsonb := '[]'::jsonb; v_moved int; v_msg text := '';
begin
  for c in select ac.id, ac.name, ac.social_brand from approval_clients ac where ac.calendar_autopost and ac.social_brand is not null loop
    cap := public.studio_week_cap(c.id); v_moved := 0; v_msg := '';
    for r in
      select x.id, x.code, x.wk, x.was from (
        select i.id, i.code, i.posted_at, i.time_locked,
               public.studio_week_start(c.id, public.studio_item_day(c.id, i.posted_at, i.scheduled_at, i.scheduled_for)) wk,
               to_char(public.studio_item_day(c.id, i.posted_at, i.scheduled_at, i.scheduled_for), 'Mon FMDD') was,
               exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('queued','posting','posted','held','in_drafts')) q,
               row_number() over (
                 partition by public.studio_week_start(c.id, public.studio_item_day(c.id, i.posted_at, i.scheduled_at, i.scheduled_for))
                 order by (i.posted_at is not null) desc,
                          exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('queued','posting','posted','held','in_drafts')) desc,
                          i.time_locked desc,
                          coalesce(i.scheduled_at, i.scheduled_for::timestamptz) asc, i.created_at asc) rn
          from approval_items i
         where i.client_id = c.id and (i.posted_at is not null or i.scheduled_at is not null or i.scheduled_for is not null)
      ) x where x.rn > cap and x.posted_at is null and not x.q
    loop
      update approval_items set scheduled_at = null, scheduled_for = null, time_locked = false, slot_by = 'Spark',
             slot_reason = format('Moved off %s: the week of %s already had %s posts (the limit). Spark re-dates it into the next open slot.', r.was, to_char(r.wk, 'Mon FMDD'), cap)
       where id = r.id;
      insert into approval_item_events (item_id, kind, actor_kind, payload)
      values (r.id, 'calendar_withdrawn', 'system', jsonb_build_object('why', 'week_full', 'week', r.wk, 'cap', cap, 'was', r.was));
      v_moved := v_moved + 1; v_msg := v_msg || r.code || ' (' || r.was || '), ';
      v_out := v_out || jsonb_build_object('code', r.code, 'was', r.was, 'week', r.wk);
    end loop;
    if v_moved > 0 then
      perform public.studio_autoslot(c.id);
      begin
        perform public.bestly_raise('studio.weekly-cap.' || c.id::text || '.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD'),
          'problem', 'info', c.name || ': ' || v_moved || ' post(s) moved out of a full week',
          'More than ' || cap || ' posts were dated in one week, so ' || rtrim(v_msg, ', ') || ' went to the next open slot.', 'studio', null, true);
      exception when others then null;
      end;
    end if;
  end loop;
  return v_out;
end $$;

insert into public.notification_owners (prefix, agent_slug, note)
values ('studio.weekly-cap', 'spark', 'A post moved because its week already had the weekly limit; info, bell only, no push. 2026-10-14')
on conflict do nothing;

-- 5. The tick runs the watchdog right after it clears uncleared and past dates --------------------
create or replace function public.studio_autopost_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c record; it record; p text; r jsonb; v_tz text; v_b text; v_kick boolean := false;
        v_done jsonb := '[]'::jsonb; v_bad jsonb := '[]'::jsonb; v_slots jsonb := '[]'::jsonb; g jsonb;
begin
  perform public.studio_cal_clear_past();
  perform public.studio_cal_clear_uncleared();
  perform public.studio_cal_enforce_cap();
  for c in select ac.* from approval_clients ac where ac.calendar_autopost and ac.social_brand is not null loop
    if coalesce((public.posting_paused(c.social_brand)->>'paused')::boolean, false) then continue; end if;
    select coalesce(s.tz, 'America/Los_Angeles') into v_tz from social_brand_settings s where s.brand = c.social_brand;
    v_tz := coalesce(v_tz, 'America/Los_Angeles');
    update approval_items set scheduled_at = null, scheduled_for = null, slot_reason = null
     where client_id = c.id and posted_at is null and not time_locked and not cal_hold
       and scheduled_at < now() - interval '2 hours'
       and not exists (select 1 from social_posts sp where sp.approval_item_id = approval_items.id and sp.status in ('queued','posting','posted','held','in_drafts'));
    r := public.studio_autoslot(c.id);
    v_slots := v_slots || coalesce(r->'slots', '[]'::jsonb);
    for it in
      select i.* from approval_items i
       where i.client_id = c.id and i.posted_at is null and not i.cal_hold
         and i.scheduled_at is not null and i.scheduled_at <= now() + interval '10 minutes'
         and not exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('queued','posting','posted','held','in_drafts'))
    loop
      v_b := public.studio_cal_blocked(c.slug, (it.scheduled_at at time zone v_tz)::date);
      if v_b is not null and not it.time_locked then
        update approval_items set scheduled_at = null, scheduled_for = null, slot_reason = null where id = it.id;
        continue;
      end if;
      if not public.studio_cal_ready(it.id) then
        g := public.studio_posting_gate(it.id);
        update approval_items set scheduled_at = null, scheduled_for = null, posting_ready_at = null,
               slot_reason = 'Taken off the calendar: ' || coalesce(g->>'error', 'not cleared to post')
         where id = it.id;
        v_bad := v_bad || jsonb_build_object('code', it.code, 'title', it.title, 'why', coalesce(g->>'error', 'not cleared'));
        continue;
      end if;
      foreach p in array public.item_platforms(it.id) loop
        if p not in ('instagram', 'tiktok', 'facebook') then continue; end if;
        if p = 'facebook' and not exists (select 1 from social_accounts fa where fa.brand = c.social_brand and fa.platform = 'facebook' and fa.active and fa.access_token is not null and not coalesce(fa.publishing_paused, false)) then continue; end if;
        r := public.social_enqueue_item(it.id, greatest(it.scheduled_at, now()), 'Spark', false, p);
        if coalesce((r->>'ok')::boolean, false) then
          v_done := v_done || jsonb_build_object('code', it.code, 'platform', p, 'at', it.scheduled_at);
          if it.scheduled_at <= now() + interval '1 minute' then v_kick := true; end if;
        elsif coalesce(r->>'error', '') <> 'already_queued' then
          v_bad := v_bad || jsonb_build_object('code', it.code, 'platform', p, 'why', r->>'error');
        end if;
      end loop;
    end loop;
  end loop;
  if v_kick then
    begin perform invoke_edge_function('bestly-ig-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('tiktok-inbox', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-fb-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
  end if;
  if jsonb_array_length(v_bad) > 0 then
    perform public.bestly_raise('studio:autopost', 'problem', 'warn',
      jsonb_array_length(v_bad) || ' post(s) could not go out on schedule',
      (select string_agg(coalesce(x->>'code','?') || ' ' || coalesce(x->>'title','') || ': ' || coalesce(x->>'why',''), E'\n') from jsonb_array_elements(v_bad) x), 'ops');
  end if;
  return jsonb_build_object('ok', true, 'slotted', v_slots, 'queued', v_done, 'problems', v_bad);
end $$;

-- 6. One gate: the team's own "changes" status stops a post even when her yes is final -------------
create or replace function public.studio_clear_state(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare it approval_items%rowtype; c approval_clients%rowtype; sg jsonb; cv int; ov jsonb;
  v_miss jsonb := '[]'::jsonb; v_err text; v_client text; e jsonb;
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
      -- 2026-10-14: the team's own status is a stop even when her yes is final (CY22 auto-posted over it)
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

-- 7. Taking an uncleared post off the calendar says why --------------------------------------------
create or replace function public.studio_cal_clear_uncleared() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_out jsonb := '[]'::jsonb; g jsonb; v_why text;
begin
  for r in
    select i.id, i.code, coalesce(to_char(coalesce(i.scheduled_for, (i.scheduled_at at time zone 'America/Los_Angeles')::date), 'Mon FMDD'), '') as was
      from approval_items i join approval_clients ac on ac.id = i.client_id
     where ac.calendar_autopost and i.posted_at is null
       and (i.scheduled_for is not null or i.scheduled_at is not null)
       and public.studio_lane_of(i.id) not in ('sched', 'ready', 'posted')
       and not exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('queued','posting','posted','held','in_drafts'))
  loop
    g := public.studio_clear_state(r.id);
    select string_agg((m->>'who') || ': ' || (m->>'what'), '; ') into v_why from jsonb_array_elements(coalesce(g->'missing', '[]'::jsonb)) m;
    update approval_items set scheduled_for = null, scheduled_at = null, time_locked = false, slot_by = 'Spark', posting_ready_at = null,
           slot_reason = format('Taken off the calendar (it was %s): only posts cleared to go out sit on it.%s Spark dates it again once it clears.',
                                r.was, case when v_why is not null then ' Waiting on ' || v_why || '.' else '' end)
     where id = r.id;
    v_out := v_out || jsonb_build_object('code', r.code, 'was', r.was);
  end loop;
  return v_out;
end $$;
