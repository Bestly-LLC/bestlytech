-- Sandbox/test clients never create work for Jared, and stale bells clear themselves.
-- All 14 test clients (bestly-test, demo-two, gate-selftest, re-demo, zz-*) already have sandbox=true; no flag changes needed.
-- Studio monitors below now skip approval_clients.sandbox. Signatures, SECURITY DEFINER and search_path are unchanged.

-- 1) client_feedback_watch: draft / rule-held / waiting checks ignore sandbox clients
CREATE OR REPLACE FUNCTION public.client_feedback_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_fixed int := 0; v_held int; v_list text; v_drafting int; v_wait int; v_wlist text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'feedback_rule_stamp' and tgrelid = 'public.approval_reviews'::regclass) then
    execute 'create trigger feedback_rule_stamp after insert or update of note on public.approval_reviews for each row when (new.reviewer_kind = ''client'') execute function public.trg_feedback_rule_stamp()';
    perform public.bestly_raise('studio:feedback-trigger', 'problem', 'warn', 'Feedback rule check trigger was missing — recreated', 'Spark recreated feedback_rule_stamp.', 'ops');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'feedback_predraft' and tgrelid = 'public.approval_reviews'::regclass) then
    execute 'create trigger feedback_predraft after insert on public.approval_reviews for each row when (new.reviewer_kind = ''client'' and new.note is not null) execute function public.trg_feedback_predraft()';
    perform public.bestly_raise('studio:feedback-trigger', 'problem', 'warn', 'Feedback pre-draft trigger was missing — recreated', 'Spark recreated feedback_predraft.', 'ops');
  end if;
  with m as (select id from public.approval_reviews where reviewer_kind = 'client' and rule_checked_at is null and created_at > now() - interval '30 days')
  select count(*) into v_fixed from m, lateral (select public.feedback_rule_stamp(m.id)) x;
  -- self-heal: a post that was SENT while her note was already open goes back.
  -- A note she leaves after the send is not a bypass and stays where it is.
  declare r record; v_back int := 0;
  begin
    perform set_config('studio.staff_id', '735400ca-eff1-4866-814b-65e40c551e36', true);
    for r in select it.id, it.title, it.content_version from public.approval_items it
              where it.stage = 'client' and it.status = 'pending' and public.item_feedback_hold(it.id) is not null
                and exists (select 1 from public.approval_reviews g
                             where g.item_id = it.id and g.reviewer_kind = 'client' and g.note is not null and g.parent_id is null
                               and g.content_version = it.content_version and g.triage is null
                               and g.created_at < coalesce((select max(e.at) from public.approval_item_events e
                                                             where e.item_id = it.id and e.kind = 'promoted'), 'epoch'::timestamptz)) loop
      perform set_config('studio.client_pullback', r.id::text, true);
      update public.approval_items set stage = 'internal', status = 'pending', internal_status = 'changes', decided_at = null where id = r.id;
      insert into public.approval_item_events (item_id, kind, actor_kind, staff_id, payload)
      values (r.id, 'unpromoted', 'staff', '735400ca-eff1-4866-814b-65e40c551e36', jsonb_build_object('why', 'Spark watchdog: on her board with her note unanswered', 'content_version', r.content_version));
      v_back := v_back + 1;
    end loop;
    perform set_config('studio.client_pullback', '', true);
    if v_back > 0 then
      perform public.bestly_raise('studio:feedback-sent-unanswered', 'problem', 'warn', v_back || ' post(s) reached her board with her note unanswered — pulled back', 'Spark moved them to Set aside › Changes. Something bypassed the send guard; check studio_promote.', 'ops');
    end if;
  end;
  v_drafting := public.feedback_draft_pending(20);
  if exists (select 1 from public.approval_reviews r join public.approval_items it on it.id = r.item_id
                join public.approval_clients c on c.id = it.client_id and not coalesce(c.sandbox, false)
              where r.reviewer_kind = 'client' and r.note is not null and r.triage is null and r.reply_draft is null
                and it.stage = 'internal' and r.content_version = it.content_version and r.created_at < now() - interval '3 hours') then
    perform public.bestly_raise('studio:feedback-draft', 'problem', 'warn', 'Reply drafts are not being written',
      'Client notes older than 3 hours still have no draft. Check the feedback-reply edge function logs and ANTHROPIC_API_KEY.', 'ops');
  else
    perform public.bestly_raise('studio:feedback-draft', 'resolved', 'info', 'Reply drafts OK', null, 'ops');
  end if;
  select count(*), string_agg(distinct it.title, '; ') into v_held, v_list
    from public.approval_reviews r join public.approval_items it on it.id = r.item_id
    join public.approval_clients c on c.id = it.client_id and not coalesce(c.sandbox, false)
   where r.reviewer_kind = 'client' and r.rule_blocked and r.rule_override is null and r.triage is null
     and r.content_version = it.content_version
     and r.created_at < now() - interval '2 hours' and r.created_at > now() - interval '30 days' and it.stage = 'internal';
  if v_held > 0 then
    perform public.bestly_raise('studio:feedback-rule-held', 'problem', 'warn', v_held || ' client note(s) break a rule and are waiting on you',
      'Held: ' || v_list || '. Studio › the post › From the client.', 'ops');
  else
    perform public.bestly_raise('studio:feedback-rule-held', 'resolved', 'info', 'No client notes held by a rule', null, 'ops');
  end if;
  select count(*), string_agg(distinct it.title, '; ') into v_wait, v_wlist
    from public.approval_reviews r join public.approval_items it on it.id = r.item_id
    join public.approval_clients c on c.id = it.client_id and not coalesce(c.sandbox, false)
   where r.reviewer_kind = 'client' and r.note is not null and r.triage is null and it.stage = 'internal'
     and r.content_version = it.content_version and r.created_at < now() - interval '24 hours' and r.created_at > now() - interval '30 days';
  if v_wait > 0 then
    perform public.bestly_raise('studio:feedback-waiting', 'problem', 'warn', v_wait || ' client note(s) waiting over a day for your reply', v_wlist, 'ops');
  else
    perform public.bestly_raise('studio:feedback-waiting', 'resolved', 'info', 'No client notes waiting', null, 'ops');
  end if;
  return jsonb_build_object('ok', true, 'restamped', v_fixed, 'drafting', v_drafting, 'held', v_held, 'waiting', v_wait);
end $function$;

-- 2) studio_calendar_watch: runway / house-runway / calendar counts ignore sandbox clients
CREATE OR REPLACE FUNCTION public.studio_calendar_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   where ac.calendar_autopost and not coalesce(ac.sandbox, false) and i.posted_at is null and i.scheduled_at is null and not i.cal_hold
     and i.posting_ready_at < now() - interval '30 minutes' and public.studio_cal_ready(i.id);
  if n > 0 then v_bad := v_bad || (n || ' Ready post(s) have had no slot for 30+ minutes (calendar full or blocked)'); end if;
  select count(*) into n from approval_items i join approval_clients ac on ac.id = i.client_id
   where ac.calendar_autopost and not coalesce(ac.sandbox, false) and i.posted_at is null and not i.cal_hold and i.scheduled_at < now() - interval '30 minutes'
     and not exists (select 1 from social_posts sp where sp.approval_item_id = i.id and sp.status in ('posted','posting','in_drafts'));
  if n > 0 then v_bad := v_bad || (n || ' scheduled post(s) are 30+ minutes past their time and not out'); end if;
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    perform public.bestly_raise('studio:content-calendar', 'problem', 'warn', array_length(v_bad, 1) || ' content calendar problem(s)',
      array_to_string(v_bad || v_fixed, E'\\n'), 'ops');
  else
    perform public.bestly_raise('studio:content-calendar', 'resolved', 'info',
      'Content calendar healthy' || case when array_length(v_fixed, 1) > 0 then ' (healed: ' || array_to_string(v_fixed, '; ') || ')' else '' end, null, 'ops');
  end if;
  for c in select ac.id, ac.name, ac.social_brand, coalesce(ac.sandbox, false) as sandbox from approval_clients ac where ac.calendar_autopost and ac.kind is distinct from 'house' loop
    if c.sandbox then
      -- test client: never asks for work; close any runway issue it left behind
      perform public.bestly_raise('studio:content-runway:' || c.id, 'resolved', 'info', c.name || ': test client, ignored', null, 'ops');
      continue;
    end if;
    select count(*) into v_run from approval_items i where i.client_id = c.id and i.posted_at is null and i.scheduled_at > now();
    if v_run < 3 then
      perform public.bestly_raise('studio:content-runway:' || c.id, 'problem', 'info',
        c.name || ': only ' || v_run || ' post(s) scheduled ahead', 'Spark needs to make more posts to keep the 5-a-week plan.', 'ops');
    else
      perform public.bestly_raise('studio:content-runway:' || c.id, 'resolved', 'info', c.name || ': ' || v_run || ' posts scheduled ahead', null, 'ops');
    end if;
  end loop;
  for a in
    select public.studio_acct(ac.id)->>'id' as acct, (array_agg(ac.id order by ac.id::text))[1] as lead,
           count(*) as nclients, min(ac.name) as cname, min(public.studio_acct(ac.id)->>'handle') as handle
      from approval_clients ac
     where ac.calendar_autopost and not coalesce(ac.sandbox, false) and ac.kind = 'house' and public.studio_acct(ac.id)->>'id' is not null
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
end $function$;

-- 3) studio_state_check: the "problem" counts ignore sandbox clients (the self-healing updates still run on everything)
CREATE OR REPLACE FUNCTION public.studio_state_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bad text[] := '{}'; v_fixed text[] := '{}'; n int;
begin
  update public.approval_items set posted_at = null, posted_note = null where posted_note like 'Auto:%';
  get diagnostics n = row_count; if n > 0 then v_fixed := v_fixed || (n || ' leftover Auto: posted stamp(s) cleared'); end if;
  update public.approval_items it set regen_requested_at = now()
   where it.stage = 'internal' and it.regen_requested_at is null and it.needs_render_at is null
     and exists (select 1 from public.approval_reviews g where g.item_id = it.id and g.reviewer_kind = 'client'
                  and g.triage = 'agree' and g.content_version = it.content_version);
  get diagnostics n = row_count; if n > 0 then v_fixed := v_fixed || (n || ' agreed note(s) put back in the re-cut queue'); end if;
  select count(*) into n from public.approval_items it
   where it.stage = 'client' and it.status = 'changes'
     and not exists (select 1 from public.approval_clients sc where sc.id = it.client_id and coalesce(sc.sandbox, false));
  if n > 0 then v_bad := v_bad || (n || ' post(s) are stage=client with status=changes'); end if;
  select count(*) into n from public.client_asks ca where ca.status in ('open','received') and ca.sent_at is null
     and not exists (select 1 from public.approval_clients sc where sc.id = ca.client_id and coalesce(sc.sandbox, false));
  if n > 0 then v_bad := v_bad || (n || ' ask(s) are on her board with no sent_at'); end if;
  select count(*) into n from public.approval_items it
   where it.stage = 'client' and it.status = 'pending' and public.item_feedback_hold(it.id) is not null
     and not exists (select 1 from public.approval_clients sc where sc.id = it.client_id and coalesce(sc.sandbox, false))
     and exists (select 1 from public.approval_reviews g where g.item_id = it.id and g.reviewer_kind = 'client' and g.note is not null
                  and g.parent_id is null and g.triage is null and g.content_version = it.content_version
                  and g.created_at < coalesce((select max(e.at) from public.approval_item_events e where e.item_id = it.id and e.kind = 'promoted'), 'epoch'));
  if n > 0 then v_bad := v_bad || (n || ' post(s) were sent while her note was open'); end if;
  select count(*) into n from public.approval_items it join public.approval_clients ac on ac.id = it.client_id
   where it.stage = 'internal' and array_length(ac.approvers, 1) is not null and not coalesce(ac.sandbox, false)
     and exists (select 1 from public.approval_reviews r where r.item_id = it.id and r.reviewer_kind = 'staff' and r.decision is not null
                  and r.content_version = it.content_version and not (r.staff_id = any(ac.approvers)) and r.created_at > now() - interval '1 day');
  if n > 0 then v_bad := v_bad || (n || ' post(s) got a decision from someone not on the sign-off list in the last day'); end if;
  -- posted on a platform but the post row does not say so (the write-back trigger missed)
  update public.approval_items it set posted_at = sp.posted_at, posted_note = coalesce(sp.permalink, 'Posted on ' || sp.platform)
    from public.social_posts sp where sp.approval_item_id = it.id and sp.status = 'posted' and it.posted_at is null;
  get diagnostics n = row_count; if n > 0 then v_fixed := v_fixed || (n || ' posted post(s) stamped from the queue'); end if;
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    perform public.bestly_raise('studio:state', 'problem', 'warn', array_length(v_bad, 1) || ' Studio state problem(s)', array_to_string(v_bad || v_fixed, E'\\n'), 'ops');
  else
    perform public.bestly_raise('studio:state', 'resolved', 'info', 'Studio state consistent' || case when array_length(v_fixed, 1) > 0 then ' (healed: ' || array_to_string(v_fixed, '; ') || ')' else '' end, null, 'ops');
  end if;
  return jsonb_build_object('ok', true, 'problems', to_jsonb(coalesce(v_bad, '{}')), 'fixed', to_jsonb(coalesce(v_fixed, '{}')));
end $function$;

-- 4) studio_media_fault: still logs the fault row, but a sandbox client's video never raises an issue
CREATE OR REPLACE FUNCTION public.studio_media_fault(p_token text, p_item uuid, p_url text, p_code text, p_ua text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.studio_caller; c public.approval_caller; v_who text; v_title text; v_slug text; v_key text; v_new boolean;
  v_viewer uuid; v_sandbox boolean := false;
  v_today text := to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD');
  v_url text := left(coalesce(p_url, ''), 600);
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is not null then v_who := 'staff:' || coalesce(s.slug, s.name);
  else
    c := public.approval_resolve_client(p_token);
    if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    -- staff viewing as the client: log it as staff, never as her
    v_viewer := public.client_viewer(p_token);
    if v_viewer is not null then v_who := 'staff-view:' || v_viewer::text;
    else v_who := 'client:' || c.id::text;
    end if;
  end if;
  if v_url = '' then return jsonb_build_object('ok', false, 'error', 'no_url'); end if;
  -- the table cannot be flooded: one row per person per file per 30 minutes
  if not exists (select 1 from studio_media_faults where who = v_who and url = v_url and at > now() - interval '30 minutes') then
    insert into studio_media_faults (who, item, url, code, ua) values (v_who, p_item, v_url, left(p_code, 60), left(p_ua, 300));
  end if;
  if p_item is not null then
    select coalesce(i.title, 'a post'), cl.slug, coalesce(cl.sandbox, false) into v_title, v_slug, v_sandbox
      from approval_items i left join approval_clients cl on cl.id = i.client_id where i.id = p_item;
  end if;
  -- test clients never create work for Jared
  if coalesce(v_sandbox, false) then return jsonb_build_object('ok', true, 'raised', false, 'sandbox', true); end if;
  v_key := 'studio.media.' || coalesce(p_item::text, md5(v_url)) || '.' || v_today;
  v_new := not exists (select 1 from monitor_issues where key = v_key);
  if v_new then
    perform bestly_raise(v_key, 'problem', 'info',
      'A video will not play' || coalesce(': ' || left(v_title, 60), ''),
      'The browser could not play ' || coalesce(nullif(v_title, ''), 'a video') || coalesce(' (' || v_slug || ')', '') || ' in Studio (' || coalesce(nullif(left(p_code, 60), ''), 'no code') || '). It was retried once and the person was shown a Retry button and a link to the file. File: ' || v_url,
      'studio', null, true);
  end if;
  return jsonb_build_object('ok', true, 'raised', v_new);
end $function$;

-- 5) One-time cleanup of sandbox-only issues that were open when this shipped
--    (the monitors above resolve studio:state and studio:feedback-waiting on their next tick; these two are not re-checked).
select public.bestly_raise('studio:content-runway:f5a75f7d-06b2-4cbc-bab8-bc65a5f41857','resolved','info','Flow Test: test client, ignored',null,'ops');
select public.bestly_raise('studio.media.e0411781-9f38-48fb-9b32-97affaf75f94.20261014','resolved','info','Test client video, ignored',null,'studio');

-- 6) admin_freshness_sweep: a monitor bell clears itself when its issue is resolved (or gone, after 24 h).
--    bestly_raise already does this at resolve time; this catches any bell that slipped through (re-raised, raced, or issue row removed).
CREATE OR REPLACE FUNCTION public.admin_freshness_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  n int;
  s jsonb := '{}'::jsonb;
begin
  -- A pick made from an alert closes itself once that alert's problem is fixed (Scout may have picked it from a stale bell).
  update scout_daily d set status = 'done', done_at = now(),
         action = coalesce(d.action, '{}'::jsonb) || jsonb_build_object('auto_closed', jsonb_build_object(
           'rule', 'alert_fixed', 'at', now(), 'why', 'Its alert "' || mi.title || '" was fixed at ' || la_time12(mi.resolved_at) || '.'))
    from admin_notifications b, monitor_issues mi
   where d.kind = 'pick' and d.status = 'open' and d.source_key like 'today:bell:%'
     and b.id::text = substring(d.source_key from 'today:bell:(.*)$')
     and mi.status = 'resolved' and mi.resolved_at > b.created_at
     and (b.entity_key = 'monitor:' || mi.key or extensions.similarity(lower(mi.title), lower(b.title)) >= 0.6)
     and not coalesce((d.action->>'reopened_by_jared')::boolean, false);
  get diagnostics n = row_count; s := s || jsonb_build_object('picks_fixed', n);

  -- Picks belong to their day. Yesterday's stay until today's morning picks exist; older ones always go.
  -- (Scout's morning run still sees unfinished work as candidates and re-picks it fresh.)
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'pick' and status in ('open', 'snoozed')
     and (day < v_today - 1
          or (day < v_today and exists (select 1 from scout_daily t where t.kind = 'pick' and t.day = v_today)));
  get diagnostics n = row_count; s := s || jsonb_build_object('picks', n);

  -- The wrap is only today's.
  update scout_daily set status = 'done', done_at = now()
   where kind = 'wrap' and status = 'open' and day < v_today;
  get diagnostics n = row_count; s := s || jsonb_build_object('wraps', n);

  -- Email reply drafts: 3 days after the mail they answer; a newer draft for the same subject replaces an older one.
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'draft' and status = 'open' and day < v_today - 3;
  get diagnostics n = row_count; s := s || jsonb_build_object('drafts_old', n);
  update scout_daily d set status = 'expired', done_at = now()
   where d.kind = 'draft' and d.status = 'open'
     and exists (select 1 from scout_daily e where e.kind = 'draft' and e.status = 'open' and e.id <> d.id
                   and lower(e.title) = lower(d.title) and (e.created_at, e.id) > (d.created_at, d.id));
  get diagnostics n = row_count; s := s || jsonb_build_object('drafts_dup', n);

  -- Meeting to-dos are real work: only near-identical duplicates (same owner, within 3 days) collapse to the newest,
  -- and to-dos untouched for 21 days age out.
  update scout_daily d set status = 'expired', done_at = now(),
         action = coalesce(d.action, '{}'::jsonb) || jsonb_build_object('expired_why', 'duplicate', 'dup_of', e.id)
    from scout_daily e
   where d.kind = 'call' and e.kind = 'call' and d.status = 'open' and e.status = 'open' and d.id <> e.id
     and lower(coalesce(d.action->>'owner', 'jared')) = lower(coalesce(e.action->>'owner', 'jared'))
     and abs(d.day - e.day) <= 3
     and (e.created_at, e.id) > (d.created_at, d.id)
     and extensions.similarity(lower(d.title), lower(e.title)) >= 0.6;
  get diagnostics n = row_count; s := s || jsonb_build_object('calls_dup', n);
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'call' and status = 'open' and day < v_today - 21;
  get diagnostics n = row_count; s := s || jsonb_build_object('calls_old', n);

  -- Bell: a problem card whose monitor issue is resolved (opened-and-closed after the card), or whose issue no longer exists (24 h+), clears itself.
  update admin_notifications b set read_at = now()
   where b.read_at is null and b.entity_key like 'monitor:%' and b.severity <> 'success'
     and ((exists (select 1 from monitor_issues mi
                    where 'monitor:' || mi.key = b.entity_key and mi.status = 'resolved' and mi.resolved_at >= b.created_at)
           and not exists (select 1 from monitor_issues mo where 'monitor:' || mo.key = b.entity_key and mo.status = 'open'))
          or (b.created_at < now() - interval '24 hours'
              and not exists (select 1 from monitor_issues mi where 'monitor:' || mi.key = b.entity_key)));
  get diagnostics n = row_count; s := s || jsonb_build_object('bell_issue_resolved', n);

  -- Bell: FYIs clear themselves. Silent after 1 h, success/info after 12 h, warnings after 3 days, anything after 7 days.
  -- (A problem card is also cleared the moment its issue resolves - bestly_raise already does that for monitor cards.)
  update admin_notifications set read_at = now()
   where read_at is null
     and ((silent and created_at < now() - interval '1 hour')
          or (severity in ('success', 'info') and created_at < now() - interval '12 hours')
          or (severity = 'warning' and created_at < now() - interval '3 days')
          or created_at < now() - interval '7 days');
  get diagnostics n = row_count; s := s || jsonb_build_object('bell_read', n);

  -- A problem note clears when a later "working again / is back / fixed" note about the same thing arrives.
  update admin_notifications p set read_at = now()
   where p.read_at is null and p.severity <> 'success'
     and p.title !~* '(working again|is back|is fine|healthy|resolved|reaching|fixed|normally again|steady)'
     and exists (select 1 from admin_notifications r
                  where r.created_at > p.created_at and r.created_at < p.created_at + interval '3 days'
                    and (r.severity = 'success' or r.title ~* '(working again|is back|is fine|healthy|resolved|reaching|fixed|normally again|steady)')
                    and extensions.similarity(lower(p.title), lower(r.title)) >= 0.45);
  get diagnostics n = row_count; s := s || jsonb_build_object('bell_fixed', n);
  -- Repeats of the same note collapse to the newest one.
  update admin_notifications p set read_at = now()
   where p.read_at is null
     and exists (select 1 from admin_notifications r
                  where r.read_at is null and r.id <> p.id and r.kind = p.kind and lower(r.title) = lower(p.title)
                    and (r.created_at, r.id) > (p.created_at, p.id));
  get diagnostics n = row_count; s := s || jsonb_build_object('bell_repeat', n);

  insert into admin_freshness_runs (stats) values (s);
  delete from admin_freshness_runs where at < now() - interval '14 days';
  return s;
end $function$;
