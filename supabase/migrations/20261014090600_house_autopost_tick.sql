-- House autopost part 6b: the 5-minute tick queues approved, slotted house posts (Spark, 2026-10-14).
-- Same loop as Centering YOU. New for house brands: the platform list comes from the brand's own settings (Instagram only today),
-- the posting account is the ready target of the shared @handle, the pause check uses the account's brand, and any queued post
-- whose Approve no longer covers its current version is taken back before the drain can claim it (studio_cal_revoke_stale).
-- Rollback: the previous definition is saved in house_autopost_backup (key fn:studio_autopost_tick).

insert into public.house_autopost_backup (key, data)
select 'fn:studio_autopost_tick', jsonb_build_object('def', pg_get_functiondef('public.studio_autopost_tick'::regproc))
on conflict (key) do nothing;

-- A queued house post is only valid while Jared's Approve covers the version that was queued ----------------
create or replace function public.studio_cal_revoke_stale() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_out jsonb := '[]'::jsonb;
begin
  for r in
    select sp.id as post_id, i.id as item_id, i.code
      from social_posts sp
      join approval_items i on i.id = sp.approval_item_id
      join approval_clients c on c.id = i.client_id
     where c.kind = 'house' and sp.status = 'queued' and i.posted_at is null
       and not public.house_post_cleared(sp.id)
  loop
    update social_posts set status = 'canceled',
           error = 'Taken back before posting: the Approve in Studio no longer covers this version (edited, un-approved or killed). Nothing was posted.'
     where id = r.post_id and status = 'queued';
    if found then
      insert into approval_item_events (item_id, kind, actor_kind, payload)
      values (r.item_id, 'calendar_withdrawn', 'system', jsonb_build_object('why', 'not_approved_for_this_version', 'post', r.post_id));
      v_out := v_out || jsonb_build_object('code', r.code, 'post', r.post_id);
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.studio_cal_revoke_stale() from public, anon, authenticated;

create or replace function public.studio_autopost_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c record; it record; p text; r jsonb; v_tz text; v_b text; v_kick boolean := false; v_brand text; v_house boolean; v_tid text; v_plats text[];
        v_done jsonb := '[]'::jsonb; v_bad jsonb := '[]'::jsonb; v_slots jsonb := '[]'::jsonb; g jsonb;
begin
  perform public.studio_cal_revoke_stale();
  perform public.studio_cal_clear_past();
  perform public.studio_cal_clear_uncleared();
  perform public.studio_cal_enforce_cap();
  for c in select ac.* from approval_clients ac where ac.calendar_autopost and ac.social_brand is not null order by ac.name loop
    v_house := (c.kind = 'house');
    v_brand := case when v_house then public.studio_brand_of(c.id) else c.social_brand end;
    if coalesce((public.posting_paused(v_brand)->>'paused')::boolean, false) then continue; end if;
    select coalesce(s.tz, 'America/Los_Angeles') into v_tz from social_brand_settings s where s.brand = v_brand;
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
      v_plats := case when v_house then public.house_item_platforms(it.id) else public.item_platforms(it.id) end;
      foreach p in array v_plats loop
        if p not in ('instagram', 'tiktok', 'facebook') then continue; end if;
        if v_house then
          select x->>'id' into v_tid from jsonb_array_elements(public.house_post_targets(c.id)) x
           where x->>'platform' = p and (x->>'ready')::boolean limit 1;
          if v_tid is null then continue; end if;
          perform set_config('studio.house_account', v_tid, true);
        elsif p = 'facebook' and not exists (select 1 from social_accounts fa where fa.brand = c.social_brand and fa.platform = 'facebook' and fa.active and fa.access_token is not null and not coalesce(fa.publishing_paused, false)) then
          continue;
        end if;
        r := public.social_enqueue_item(it.id, greatest(it.scheduled_at, now()), 'Spark', false, p);
        if v_house then perform set_config('studio.house_account', '', true); end if;
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
