-- House autopost part 6c: watchdog, old HOKU check, alert owners, team card (Spark, 2026-10-14).
-- 1. studio_calendar_watch also watches each house ACCOUNT's runway: nothing approved to post in its next 3 days -> a Spark info alert
--    ("Nothing approved to post for HOKU after Thu"), bell only, resolved by itself once something is slotted.
-- 2. pi_hoku_prepost_check no longer looks at the old direct-post queue (the Pi's 9:30 AM job would have raised a false alarm every day).
-- 3. The alert prefixes belong to Spark; the two jobs are on Spark's team card.

insert into public.house_autopost_backup (key, data)
select 'fn:' || x, jsonb_build_object('def', pg_get_functiondef(('public.' || x)::regproc))
  from unnest(array['studio_calendar_watch', 'pi_hoku_prepost_check']) x
on conflict (key) do nothing;

create or replace function public.studio_calendar_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_last timestamptz; n int; v_bad text[] := '{}'; v_fixed text[] := '{}'; c record; v_run int;
  a record; v_today date; v_days int; v_cnt int; v_lastday date; v_label text; v_key text; k int; v_why text;
begin
  select max(d.end_time) into v_last from cron.job j join cron.job_run_details d on d.jobid = j.jobid
   where j.jobname = 'studio-autopost-tick' and d.status = 'succeeded';
  if v_last is null or v_last < now() - interval '15 minutes' then
    perform public.studio_autopost_tick();
    v_fixed := v_fixed || 'autopost tick had not run in 15 minutes, ran it by hand'::text;
  end if;
  select count(*) into n from approval_items i join approval_clients ac on ac.id = i.client_id
   where ac.calendar_autopost and i.posted_at is null and i.scheduled_at is null and not i.cal_hold
     and i.posting_ready_at < now() - interval '30 minutes' and public.studio_cal_ready(i.id);
  if n > 0 then v_bad := v_bad || (n || ' Ready post(s) have had no slot for 30+ minutes (calendar full or blocked)'); end if;
  select count(*) into n from approval_items i join approval_clients ac on ac.id = i.client_id
   where ac.calendar_autopost and i.posted_at is null and not i.cal_hold and i.scheduled_at < now() - interval '30 minutes'
     and not exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('posted','posting','in_drafts'));
  if n > 0 then v_bad := v_bad || (n || ' scheduled post(s) are 30+ minutes past their time and not out'); end if;
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    perform public.bestly_raise('studio:content-calendar', 'problem', 'warn', array_length(v_bad, 1) || ' content calendar problem(s)',
      array_to_string(v_bad || v_fixed, E'\n'), 'ops');
  else
    perform public.bestly_raise('studio:content-calendar', 'resolved', 'info',
      'Content calendar healthy' || case when array_length(v_fixed, 1) > 0 then ' (healed: ' || array_to_string(v_fixed, '; ') || ')' else '' end, null, 'ops');
  end if;
  -- runway, client brands: days of scheduled posts ahead
  for c in select ac.id, ac.name, ac.social_brand from approval_clients ac where ac.calendar_autopost and ac.kind is distinct from 'house' loop
    select count(*) into v_run from approval_items i where i.client_id = c.id and i.posted_at is null and i.scheduled_at > now();
    if v_run < 3 then
      perform public.bestly_raise('studio:content-runway:' || c.id, 'problem', 'info',
        c.name || ': only ' || v_run || ' post(s) scheduled ahead', 'Spark needs to make more posts to keep the 5-a-week plan.', 'ops');
    else
      perform public.bestly_raise('studio:content-runway:' || c.id, 'resolved', 'info', c.name || ': ' || v_run || ' posts scheduled ahead', null, 'ops');
    end if;
  end loop;
  -- runway, house accounts: is anything approved and dated for the next 3 days?
  for a in
    select public.studio_acct(ac.id)->>'id' as acct, (array_agg(ac.id order by ac.id::text))[1] as lead,
           count(*) as nclients, min(ac.name) as cname, min(public.studio_acct(ac.id)->>'handle') as handle
      from approval_clients ac
     where ac.calendar_autopost and ac.kind = 'house' and public.studio_acct(ac.id)->>'id' is not null
     group by 1
  loop
    v_today := (now() at time zone coalesce((select tz from social_brand_settings where brand = public.studio_brand_of(a.lead)), 'America/Los_Angeles'))::date;
    v_label := case when a.nclients > 1 then a.handle else a.cname end;
    v_key := 'studio.house-runway.' || a.acct;
    v_days := 0;
    for k in 0..2 loop
      v_why := public.studio_cal_day_check(a.lead, v_today + k, null, true);
      if v_why is null or v_why in ('day_taken', 'too_close', 'similar_nearby') then v_days := v_days + 1; end if;
    end loop;
    select count(*) into v_cnt from approval_items i
     where i.client_id = any(public.studio_group(a.lead)) and i.posted_at is null
       and public.studio_item_day(i.client_id, null, i.scheduled_at, i.scheduled_for) between v_today and v_today + 2;
    select max(public.studio_item_day(i.client_id, i.posted_at, i.scheduled_at, i.scheduled_for)) into v_lastday
      from approval_items i
     where i.client_id = any(public.studio_group(a.lead))
       and (i.posted_at is not null or i.scheduled_at is not null or i.scheduled_for is not null)
       and public.studio_item_day(i.client_id, i.posted_at, i.scheduled_at, i.scheduled_for) >= v_today - 14;
    if v_cnt = 0 and v_days > 0 then
      perform public.bestly_raise(v_key, 'problem', 'info',
        'Nothing approved to post for ' || v_label || case when v_lastday is not null then ' after ' || case when v_lastday <= v_today then 'today' else to_char(v_lastday, 'Dy') end else '' end,
        'No approved post is dated for the next 3 days on ' || coalesce(a.handle, v_label) || '. Approve more in Studio (Drafts, To review) and Spark dates them. Nothing posts until you approve. Spark.',
        'studio', null, true);
    else
      perform public.bestly_raise(v_key, 'resolved', 'info', v_label || ': approved posts are dated ahead', null, 'studio', null, true);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'problems', to_jsonb(v_bad), 'fixed', to_jsonb(v_fixed));
end $$;

-- The 9:30 AM Pi check (hoku_prepost) used to look for a queued HOKU post with no review. HOKU posts come from Studio now.
create or replace function public.pi_hoku_prepost_check() returns jsonb
language sql security definer set search_path to 'public', 'storage' as $$
  select jsonb_build_object(
    'today', coalesce((select jsonb_agg(t) from (
       select p.id, p.media_type, p.scheduled_at, p.status,
              (select coalesce(publishing_paused, false) from social_accounts where brand = 'hoku' and platform = 'instagram') as paused,
              0 as missing_or_empty_objects, false as on_old_design
         from social_posts p
        where p.brand = 'hoku' and p.approval_item_id is not null and p.status in ('queued', 'posting', 'posted')
          and (p.scheduled_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date) t),
      jsonb_build_array(jsonb_build_object('id', null, 'media_type', 'studio', 'scheduled_at', null, 'status', 'queued',
        'paused', coalesce((select publishing_paused from social_accounts where brand = 'hoku' and platform = 'instagram'), false),
        'missing_or_empty_objects', 0, 'on_old_design', false,
        'note', 'HOKU posts come from Studio (Approve) now. Spark watches the runway: studio.house-runway'))),
    'yesterday', coalesce((select jsonb_agg(t) from (
       select id, status, permalink, error, scheduled_at from social_posts
        where brand = 'hoku' and approval_item_id is not null
          and (scheduled_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date - 1) t), '[]'::jsonb),
    'future_queued', (select count(*) from social_posts where brand = 'hoku' and status = 'queued' and approval_item_id is not null and scheduled_at > now())
  )
$$;
update public.pi_jobs set description = 'HOKU queue check 9:30 AM daily, Studio-managed now'
 where job = 'hoku_prepost';

-- Alert owners and the team card ----------------------------------------------------------------------------
insert into public.notification_owners (prefix, agent_slug, note) values
  ('studio.house-runway', 'spark', 'A house account has nothing approved and dated for its next 3 days; info, bell only, no push. 2026-10-14'),
  ('studio:content-calendar', 'spark', 'Content calendar watchdog (Ready posts without a slot, posts past their time). 2026-10-14'),
  ('studio:autopost', 'spark', 'Posts the autopost tick could not queue. 2026-10-14')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;

select public.team_assign_jobs('{"spark":["studio-autopost-tick","studio-calendar-watch"]}'::jsonb);
