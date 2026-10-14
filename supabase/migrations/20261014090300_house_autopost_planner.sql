-- House autopost part 4 of 6: Spark's smart slot planner works for house brands and shared accounts (Spark, 2026-10-14).
-- Same engine as Centering YOU. New: it plans per ACCOUNT group (so @bestly_llc's 7 a week are shared fairly by
-- bestly-cloud / bestly-studio / bestly-agent), matches a post's words to dates and seasons (studio_calendar_events.keywords),
-- prefers timely posts first, then the brand with the fewest recent posts, then the newest approval, and writes the reason
-- ("Picked Tue 11:00 AM: ...") on the card.

create or replace function public.studio_title_overlap(p_a text, p_b text) returns int
language sql immutable as $$
  select count(*)::int from (
    select distinct w from regexp_split_to_table(lower(coalesce(p_a, '')), '[^a-z0-9]+') w
     where length(w) >= 4 and w not in ('your','with','that','this','what','from','before','after','about','into','make','made','more','than','when','every','just',
                                         'bestly','agent','cloud','studio','hoku','cookie','yeti','inventoryproof','episode')
    intersect
    select distinct w from regexp_split_to_table(lower(coalesce(p_b, '')), '[^a-z0-9]+') w where length(w) >= 4
  ) s
$$;

create or replace function public.studio_autoslot(p_client uuid, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c approval_clients%rowtype; st social_brand_settings%rowtype; v_brand text; v_tz text; v_today date; g uuid[]; v_cap int; v_handle text;
  r record; ev studio_calendar_events%rowtype; v_day date; v_at timestamptz; v_why text; v_try date; v_pass int; v_relaxed boolean;
  v_out jsonb := '[]'::jsonb; v_left jsonb := '[]'::jsonb; d int; v_hit text; v_detail text; v_skip uuid[] := '{}'; v_iter int := 0;
  v_assume boolean := coalesce(current_setting('studio.autoslot_assume', true), '') = 'on';
  v_parts text[]; v_turn text; v_src text; v_shared boolean; v_tnote text;
begin
  select * into c from approval_clients where id = p_client;
  if c.id is null or c.social_brand is null or not (c.calendar_autopost or v_assume) then
    return jsonb_build_object('ok', false, 'error', 'autopost_off'); end if;
  v_brand := public.studio_brand_of(c.id);
  select * into st from social_brand_settings where brand = v_brand;
  if st.brand is null then return jsonb_build_object('ok', false, 'error', 'no_brand_settings'); end if;
  v_tz := coalesce(st.tz, 'America/Los_Angeles');
  v_today := (now() at time zone v_tz)::date;
  g := public.studio_group(c.id); v_cap := public.studio_week_cap(c.id);
  v_handle := coalesce(public.studio_acct(c.id)->>'handle', c.name); v_shared := cardinality(g) > 1;
  begin
    update approval_items i set posting_ready_at = now()
     where i.client_id = any(g) and i.posted_at is null and i.posting_ready_at is null and public.studio_cal_ready(i.id);
    loop
      v_iter := v_iter + 1; exit when v_iter > 60;
      select i.id, i.code, i.title, i.client_id, k.slug as cslug, k.name as cname, k.kind as ckind, evx.id as ev_id, coalesce(evx.hard, false) as hard, evx.kw as kw
        into r
        from approval_items i join approval_clients k on k.id = i.client_id
        left join lateral (
          select e.id, (i.code = any(e.hold_codes)) as hard,
                 (select w from unnest(e.keywords) w where lower(i.title || ' ' || coalesce(i.caption, '')) like '%' || lower(w) || '%' limit 1) as kw
            from studio_calendar_events e
           where (e.client_slug is null or e.client_slug = k.slug) and not e.blackout
             and ((i.code = any(e.hold_codes) and coalesce(e.post_on, e.starts_on) >= v_today)
               or (e.relevance in ('high', 'medium') and cardinality(e.keywords) > 0
                   and e.ends_on >= v_today and coalesce(e.post_on, e.starts_on) <= v_today + 7
                   and exists (select 1 from unnest(e.keywords) w where lower(i.title || ' ' || coalesce(i.caption, '')) like '%' || lower(w) || '%')))
           order by (i.code = any(e.hold_codes)) desc, coalesce(e.post_on, e.starts_on) limit 1) evx on true
       where i.client_id = any(g) and i.posted_at is null and i.scheduled_at is null and not i.cal_hold
         and not (i.id = any(v_skip)) and public.studio_cal_ready(i.id)
         and not exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('queued','posting','posted','held','in_drafts'))
       order by (evx.id is not null) desc,
                (select count(*) from approval_items x where x.client_id = i.client_id and (x.posted_at is not null or x.scheduled_at is not null)
                    and public.studio_item_day(x.client_id, x.posted_at, x.scheduled_at, x.scheduled_for) between v_today - 7 and v_today + 14) asc,
                (case when k.kind = 'house'
                      then -extract(epoch from coalesce((select max(rv.created_at) from approval_reviews rv where rv.item_id = i.id and rv.reviewer_kind = 'staff' and rv.decision = 'approved'), i.created_at))
                      else extract(epoch from i.created_at) end) asc
       limit 1;
      exit when r.id is null;
      v_day := null; v_parts := '{}';
      if r.ev_id is not null then
        select * into ev from studio_calendar_events where id = r.ev_id;
        if r.hard then
          foreach d in array array[0, -1, -2, -3, 1] loop
            v_try := coalesce(ev.post_on, ev.starts_on) + d;
            if public.studio_cal_day_free(r.client_id, v_try, r.id) is null then v_day := v_try; exit; end if;
          end loop;
          if v_day is not null then
            v_parts := array_append(v_parts, format('saved for %s (%s). %s', ev.name, to_char(ev.starts_on, 'Mon FMDD'), rtrim(coalesce(ev.angle, ''), '. ')));
          end if;
        elsif ev.starts_on <= v_today then
          for d in 0..least(10, ev.ends_on - v_today) loop
            v_try := v_today + d;
            if public.studio_cal_day_free(r.client_id, v_try, r.id) is null then v_day := v_try; exit; end if;
          end loop;
        else
          foreach d in array array[0, -1, -2, 1, 2] loop
            v_try := ev.starts_on + d;
            if v_try >= v_today and public.studio_cal_day_free(r.client_id, v_try, r.id) is null then v_day := v_try; exit; end if;
          end loop;
        end if;
        if v_day is not null and not r.hard then
          v_parts := array_append(v_parts, format('it fits %s (%s) because the post mentions "%s". %s', ev.name,
            case when ev.starts_on = ev.ends_on then to_char(ev.starts_on, 'Mon FMDD') else to_char(ev.starts_on, 'Mon FMDD') || ' to ' || to_char(ev.ends_on, 'Mon FMDD') end,
            r.kw, rtrim(coalesce(ev.angle, ''), '. ')));
        end if;
      end if;
      v_relaxed := false;
      if v_day is null then
        for v_pass in 1..2 loop
          for d in 0..120 loop
            v_try := v_today + d;
            if exists (select 1 from studio_calendar_events e where (e.client_slug is null or e.client_slug = r.cslug)
                         and coalesce(e.post_on, e.starts_on) = v_try and cardinality(e.hold_codes) > 0 and not (r.code = any(e.hold_codes))
                         and exists (select 1 from approval_items h where h.client_id = any(g) and h.code = any(e.hold_codes) and h.posted_at is null and h.scheduled_at is null)) then continue; end if;
            if public.studio_cal_day_check(r.client_id, v_try, r.id, v_pass = 2) is null then v_day := v_try; v_relaxed := (v_pass = 2); exit; end if;
          end loop;
          exit when v_day is not null;
        end loop;
        if v_day is not null then
          select e.name into v_hit from studio_calendar_events e
           where (e.client_slug is null or e.client_slug = r.cslug) and not e.blackout and e.relevance = 'high'
             and v_day between e.starts_on and e.ends_on order by e.starts_on limit 1;
          v_parts := array_append(v_parts, format('next open day in the %s-a-week plan for %s', v_cap, v_handle)
                     || case when v_hit is not null then format(', and it lands during %s', v_hit) else '' end);
          if r.ckind = 'house' and v_cap < 6 and not v_relaxed then
            v_parts := array_append(v_parts, 'kept off back-to-back days so the week is spread out'); end if;
        end if;
      end if;
      if v_day is null then
        v_left := v_left || jsonb_build_object('code', r.code, 'title', r.title, 'why', 'no open day in the next 120 days');
        v_skip := v_skip || r.id; continue;
      end if;
      if v_shared then
        select string_agg(x.nm || ' ' || x.n, ', ' order by x.nm) into v_turn from (
          select k.name nm, count(it.id) n from approval_clients k
            left join approval_items it on it.client_id = k.id and (it.posted_at is not null or it.scheduled_at is not null)
                 and public.studio_item_day(k.id, it.posted_at, it.scheduled_at, it.scheduled_for) between v_today - 7 and v_today + 14
           where k.id = any(g) group by k.name) x;
        v_parts := array_append(v_parts, format('%s''s turn on %s (posts around now: %s)', r.cname, v_handle, v_turn));
      end if;
      v_at := public.studio_cal_time(v_brand, v_day);
      select t.source into v_src from studio_post_times t where t.brand = v_brand and t.dow = extract(dow from v_day)::int order by t.weight desc, t.at limit 1;
      v_tnote := format('%s is the %s time: %s',
                        to_char(v_at at time zone v_tz, 'FMHH12:MI AM'), trim(to_char(v_day, 'FMDay')),
                        case v_src when 'learned' then 'from this account''s own results'
                                   when 'history' then 'the hour this account has posted at so far'
                                   else 'a starting guess that Spark adjusts from results' end);
      v_why := format('Picked %s %s: %s. %s.', to_char(v_day, 'Dy'), to_char(v_at at time zone v_tz, 'FMHH12:MI AM'), (select string_agg(case when t.n = 1 then t.p else upper(left(t.p, 1)) || substr(t.p, 2) end, '. ' order by t.n) from unnest(v_parts) with ordinality t(p, n)), v_tnote);
      update approval_items set scheduled_for = v_day, scheduled_at = v_at, time_locked = false,
             slot_reason = v_why, slot_by = 'Spark', posting_ready_at = coalesce(posting_ready_at, now())
       where id = r.id;
      insert into approval_item_events (item_id, kind, actor_kind, payload)
      values (r.id, 'calendar_slot', 'system', jsonb_build_object('by', 'Spark', 'at', v_at, 'why', v_why));
      v_out := v_out || jsonb_build_object('code', r.code, 'title', r.title, 'client', r.cslug, 'handle', v_handle, 'at', v_at, 'why', v_why);
    end loop;
    if p_dry then
      raise exception using errcode = 'P0001', message = 'STUDIO_DRY',
        detail = jsonb_build_object('slots', v_out, 'left', v_left)::text;
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm = 'STUDIO_DRY' then
      get stacked diagnostics v_detail = pg_exception_detail;
      return jsonb_build_object('ok', true, 'dry', true) || v_detail::jsonb;
    end if;
    raise;
  end;
  return jsonb_build_object('ok', true, 'slots', v_out, 'left', v_left);
end $$;

-- keyword fixes found on review: 'mom' hit 'moment', 'call' hit every Agent post
update public.studio_calendar_events set keywords = array['mother','gift'] where client_slug = 'hoku' and name = 'Mother''s Day';
update public.studio_calendar_events set keywords = array['small business'] where client_slug = 'bestly-agent' and name = 'Small Business Saturday';
