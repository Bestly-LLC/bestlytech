-- House autopost part 2 of 6: the weekly cap guard and watchdog count per posting ACCOUNT (Spark, 2026-10-14).
-- A client with its own account still has its own cap; bestly-cloud/studio/agent share @bestly_llc (7 combined).

create or replace function public.trg_items_week_cap() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare c approval_clients%rowtype; v_day date; v_try date; v_new date; n int; cap int; v_wk text; i int; v_at timestamptz; v_handle text;
begin
  if new.posted_at is not null or (new.scheduled_at is null and new.scheduled_for is null) then return new; end if;
  if TG_OP = 'UPDATE' and new.scheduled_at is not distinct from old.scheduled_at
     and new.scheduled_for is not distinct from old.scheduled_for then return new; end if;
  select * into c from approval_clients where id = new.client_id;
  if not coalesce(c.calendar_autopost, false) then return new; end if;
  perform pg_advisory_xact_lock(hashtext('weekcap:' || coalesce(public.studio_acct(c.id)->>'id', c.id::text)));
  v_day := public.studio_item_day(c.id, null, new.scheduled_at, new.scheduled_for);
  cap := public.studio_week_cap(c.id);
  n := public.studio_cal_week_count(c.id, v_day, new.id);
  if n < cap then return new; end if;
  v_wk := to_char(public.studio_week_start(c.id, v_day), 'Mon FMDD');
  v_handle := coalesce(public.studio_acct(c.id)->>'handle', c.name);
  for i in 1..120 loop
    v_try := v_day + i;
    if public.studio_cal_day_free(c.id, v_try, new.id) is null then v_new := v_try; exit; end if;
  end loop;
  if v_new is null then
    new.scheduled_at := null; new.scheduled_for := null; new.time_locked := false; new.slot_by := 'Spark';
    new.slot_reason := format('Not dated: the week of %s already has %s posts for %s and no later day was open.', v_wk, cap, v_handle);
  else
    v_at := public.studio_cal_time(public.studio_brand_of(c.id), v_new);
    new.scheduled_for := v_new; new.scheduled_at := v_at; new.time_locked := false; new.slot_by := 'Spark';
    new.slot_reason := format('Moved to %s: the week of %s already had %s posts for %s (the limit).', to_char(v_new, 'Mon FMDD'), v_wk, cap, v_handle);
    update social_posts set scheduled_at = v_at where approval_item_id = new.id and status = 'queued';
  end if;
  begin
    if TG_OP = 'UPDATE' then
      insert into approval_item_events (item_id, kind, actor_kind, payload)
      values (new.id, 'calendar_slot', 'system', jsonb_build_object('by', 'Spark', 'why', 'week_full', 'week', v_wk, 'cap', cap, 'moved_to', v_new));
    end if;
    perform public.bestly_raise('studio.weekly-cap.' || c.id::text || '.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD'),
      'problem', 'info', 'A post was moved: that week was full',
      format('%s %s: the week of %s already had %s posts for %s, so it now sits on %s.', c.name, new.code, v_wk, cap, v_handle, coalesce(to_char(v_new, 'Mon FMDD'), 'no date')),
      'studio', null, true);
  exception when others then null;
  end;
  return new;
end $$;

create or replace function public.studio_cal_enforce_cap() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c record; r record; cap int; g uuid[]; v_out jsonb := '[]'::jsonb; v_moved int; v_msg text := ''; v_handle text;
begin
  for c in select ac.id, ac.name from approval_clients ac
            where ac.calendar_autopost and ac.social_brand is not null
              and ac.id = (select x from unnest(public.studio_group(ac.id)) x order by x::text limit 1) loop
    g := public.studio_group(c.id); cap := public.studio_week_cap(c.id); v_moved := 0; v_msg := '';
    v_handle := coalesce(public.studio_acct(c.id)->>'handle', c.name);
    for r in
      select x.id, x.code, x.wk, x.was from (
        select i.id, i.code, i.posted_at,
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
         where i.client_id = any(g) and (i.posted_at is not null or i.scheduled_at is not null or i.scheduled_for is not null)
      ) x where x.rn > cap and x.posted_at is null and not x.q
    loop
      update approval_items set scheduled_at = null, scheduled_for = null, time_locked = false, slot_by = 'Spark',
             slot_reason = format('Moved off %s: the week of %s already had %s posts for %s (the limit). Spark re-dates it into the next open slot.', r.was, to_char(r.wk, 'Mon FMDD'), cap, v_handle)
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
          'problem', 'info', v_handle || ': ' || v_moved || ' post(s) moved out of a full week',
          'More than ' || cap || ' posts were dated in one week for ' || v_handle || ', so ' || rtrim(v_msg, ', ') || ' went to the next open slot.', 'studio', null, true);
      exception when others then null;
      end;
    end if;
  end loop;
  return v_out;
end $$;
