-- Claims Closer cleaning reports, fix 2 (2026-10-29): Groq's free vision model (qwen3.8) allows about 7,000 input tokens a minute,
-- roughly one 3-photo call. The reader now only stores the photos (pending_check); claims_cleaning_look_tick runs every minute and asks
-- the claims-cleaning edge function to read the next 3 photos (notes saved per photo), and once every chosen photo has notes the
-- edge function decides and calls claims_cleaning_verdict, which applies the same rules as before (claims_cleaning_apply).
-- Follow-up to 20261029230000_claims_cleaning.sql and 20261029231500_claims_cleaning_dryrun_fix.sql.

alter table public.claim_cleaning_photos add column if not exists note text;
alter table public.claim_cleaning_photos add column if not exists noted_at timestamptz;

create or replace function public.claims_cleaning_apply(p_res bigint, p_kind text, p_ok boolean, p_result jsonb default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c claim_cleaning; s claim_cleaning_settings; st text; chk jsonb; v_post int; v_pre int; v_conf numeric; v_new text; v_uuids text[];
  who text;
begin
  select * into c from claim_cleaning where reservation_id = p_res for update;
  if c.reservation_id is null then return jsonb_build_object('ok', false, 'error', 'no row'); end if;
  select * into s from claim_cleaning_settings where id;
  who := coalesce(c.guest_first, 'the guest');
  st := nullif(p_result->>'turo_status', '');
  update claim_cleaning set job_state = 'idle', job_claimed_at = null,
         turo_status = coalesce(st, turo_status), turo_seen_at = case when st is not null then now() else turo_seen_at end, updated_at = now()
   where reservation_id = p_res;

  if not p_ok then
    update claim_cleaning set last_error = left(p_error, 300),
           job_state = case when job_attempts < 4 and p_kind <> 'file' then 'queued' else 'idle' end,
           next_try_at = now() + interval '10 minutes',
           status = case when p_kind = 'file' then 'error' when job_attempts >= 4 then 'error' else status end
     where reservation_id = p_res;
    perform claims_cleaning_log(p_res, p_kind || ' failed: ' || coalesce(p_error, '?'));
    if p_kind = 'file' then
      perform bestly_raise('claims.cleaning.file.' || p_res, 'problem', 'error', 'Cleaning report for ' || who || ' did not go through',
        'Reservation ' || p_res || ': ' || coalesce(p_error, 'unknown error') || '. Turo''s window closes ' ||
        to_char(c.deadline at time zone 'America/Los_Angeles', 'Dy Mon FMDD at FMHH12:MI AM') || '.', 'turo',
        'File it in Turo (report-issue page for ' || p_res || ') or tap File again on /admin/claims', false);
    end if;
    return jsonb_build_object('ok', true, 'retry', p_kind <> 'file');
  end if;

  -- 2026-10-29 fix 2: the reader only stores the photos; the free-AI read runs a minute at a time (claims_cleaning_look_tick)
  if p_kind = 'photos' and coalesce((p_result->>'pending_check')::boolean, false) then
    update claim_cleaning set photo_counts = p_result->'counts', pre_count = coalesce((p_result->>'pre_count')::int, 0),
           post_count = coalesce((p_result->>'post_count')::int, 0), last_error = null, checked_at = null, verdict = null, confidence = null,
           status = 'checking', next_try_at = now()
     where reservation_id = p_res;
    perform claims_cleaning_log(p_res, 'Photos saved (' || coalesce(p_result->>'pre_count', '0') || ' check-in, ' ||
      coalesce(p_result->>'post_count', '0') || ' return); reading them with free AI, a few a minute');
    return jsonb_build_object('ok', true, 'status', 'checking');
  end if;

  if p_kind = 'photos' then
    chk := coalesce(p_result->'check', '{}'::jsonb);
    v_pre := coalesce((p_result->>'pre_count')::int, 0);
    v_post := coalesce((p_result->>'post_count')::int, 0);
    v_conf := nullif(chk->>'confidence', '')::numeric;
    update claim_cleaning set photo_counts = p_result->'counts', pre_count = v_pre, post_count = v_post,
           verdict = case when chk->>'verdict' in ('abuse', 'normal', 'unclear') then chk->>'verdict' else verdict end,
           confidence = coalesce(v_conf, confidence), reasons = coalesce(nullif(chk->>'reasons', ''), reasons),
           support_uuids = coalesce((select array_agg(x) from jsonb_array_elements_text(chk->'support_uuids') x), support_uuids),
           ai_model = coalesce(chk->>'model', ai_model), checked_at = case when chk ? 'verdict' then now() else checked_at end,
           last_error = null
     where reservation_id = p_res;
    select * into c from claim_cleaning where reservation_id = p_res;

    -- Turo already shows a report (Jared filed it himself) or the window is gone.
    if st is not null and st not in ('AVAILABLE', 'EXPIRED') and not c.dry_run then
      update claim_cleaning set status = 'saved', verified_at = now() where reservation_id = p_res;
      perform claims_cleaning_log(p_res, 'Turo already shows a cleaning report (' || st || ')');
      perform claims_cleaning_queue(p_res, 'verify', null, now() + interval '6 hours');
      return jsonb_build_object('ok', true, 'status', 'saved');
    end if;
    if st = 'EXPIRED' and not c.dry_run then
      update claim_cleaning set status = 'expired' where reservation_id = p_res;
      perform claims_cleaning_log(p_res, 'Turo shows the cleaning report window as closed');
      return jsonb_build_object('ok', true, 'status', 'expired');
    end if;
    if v_post = 0 then
      if now() < c.trip_end + interval '24 hours' and not c.dry_run then
        update claim_cleaning set status = 'waiting' where reservation_id = p_res;
        perform claims_cleaning_queue(p_res, 'photos', null, now() + interval '2 hours');
        perform claims_cleaning_log(p_res, 'No check-out photos from Jared yet; looking again in 2 hours');
        return jsonb_build_object('ok', true, 'status', 'waiting');
      end if;
      update claim_cleaning set status = 'no_evidence', reasons = 'No check-out photos were taken within 24 hours of the trip end, so Turo would not accept a report.' where reservation_id = p_res;
      perform claims_cleaning_log(p_res, 'No check-out photos within 24 hours of trip end');
      return jsonb_build_object('ok', true, 'status', 'no_evidence');
    end if;
    if v_pre = 0 then
      update claim_cleaning set status = 'no_evidence', reasons = 'No check-in photos within 24 hours before the trip, so Turo would not accept a report.' where reservation_id = p_res;
      perform claims_cleaning_log(p_res, 'No check-in photos within 24 hours before the trip');
      return jsonb_build_object('ok', true, 'status', 'no_evidence');
    end if;
    if c.verdict is null then
      update claim_cleaning set status = 'error', last_error = coalesce(nullif(p_result->>'check_error', ''), 'the photo check returned no answer'),
             job_state = case when job_attempts < 4 then 'queued' else 'idle' end, next_try_at = now() + interval '20 minutes'
       where reservation_id = p_res;
      perform claims_cleaning_log(p_res, 'Photo check gave no answer; trying again');
      return jsonb_build_object('ok', true, 'status', 'error');
    end if;
    if c.verdict = 'normal' then
      update claim_cleaning set status = 'clean' where reservation_id = p_res;
      perform claims_cleaning_log(p_res, 'Photos look like normal use; nothing to report');
      return jsonb_build_object('ok', true, 'status', 'clean');
    end if;
    v_uuids := coalesce(c.support_uuids, (select array_agg(uuid) from claim_cleaning_photos where reservation_id = p_res and side <> 'pre'));
    if c.dry_run then
      update claim_cleaning set status = 'needs_you' where reservation_id = p_res;
      perform claims_cleaning_log(p_res, 'Dry run: would ' || case when c.verdict = 'abuse' and coalesce(c.confidence, 0) >= s.min_confidence and s.mode = 'auto'
        then 'file the report on its own' else 'ask Jared' end || ' (' || c.verdict || ', ' || coalesce(round(c.confidence * 100)::text || '%', '?') || ')');
      return jsonb_build_object('ok', true, 'status', 'needs_you', 'dry_run', true);
    end if;
    if c.verdict = 'abuse' and coalesce(c.confidence, 0) >= s.min_confidence and s.mode = 'auto' then
      update claim_cleaning set status = 'filing', decided_by = 'claims-closer', decided_at = now() where reservation_id = p_res;
      perform claims_cleaning_queue(p_res, 'file', jsonb_build_object('message', claims_cleaning_message(p_res), 'photo_uuids', to_jsonb(v_uuids)));
      perform claims_cleaning_log(p_res, 'Clear mess in the photos; filing the cleaning report');
      return jsonb_build_object('ok', true, 'status', 'filing');
    end if;
    update claim_cleaning set status = 'needs_you' where reservation_id = p_res;
    perform claims_cleaning_log(p_res, 'Photos might show a mess; asking Jared');
    perform claims_notify('Was ' || who || '''s car left dirty?',
      coalesce(c.reasons, 'The return photos might show a mess.') || ' Tap File or Skip on the Claims page. Turo''s window closes ' ||
      to_char(c.deadline at time zone 'America/Los_Angeles', 'Dy Mon FMDD at FMHH12:MI AM') || '.', 'warning', 'cleaning-ask-' || p_res);
    return jsonb_build_object('ok', true, 'status', 'needs_you');
  end if;

  if p_kind in ('file', 'verify') then
    if coalesce((p_result->>'dry_run')::boolean, false) then
      perform claims_cleaning_log(p_res, 'Dry run of the filing: ' || left(coalesce(p_result::text, ''), 220));
      update claim_cleaning set status = 'needs_you' where reservation_id = p_res;
      return jsonb_build_object('ok', true, 'dry_run', true);
    end if;
    if p_kind = 'file' and coalesce((p_result->>'posted')::boolean, false) then
      update claim_cleaning set filed_at = now(), filed_message = p_result->>'message',
             filed_photo_uuids = (select array_agg(x) from jsonb_array_elements_text(p_result->'photo_uuids') x)
       where reservation_id = p_res;
    end if;
    v_new := case
      when st ~* 'APPROV|ACCEPT|PAID|CHARGED|RESOLVED' then 'approved'
      when st ~* 'DENI|REJECT|DECLIN' then 'denied'
      when st is not null and st not in ('AVAILABLE', 'EXPIRED') then 'saved'
      when st = 'EXPIRED' and c.filed_at is null and p_kind = 'verify' then 'expired'
      else 'filed' end;
    update claim_cleaning set status = v_new, verified_at = case when v_new in ('saved', 'approved', 'denied') then coalesce(verified_at, now()) else verified_at end
     where reservation_id = p_res;
    perform claims_cleaning_log(p_res, p_kind || ': Turo status ' || coalesce(st, '?') || ' -> ' || v_new);
    if v_new = 'saved' and c.status <> 'saved' then
      perform bestly_raise('claims.cleaning.file.' || p_res, 'resolved', 'info', 'Cleaning report for ' || who || ' is in with Turo', null, 'turo', null, true);
      perform claims_notify('Cleaning report filed for ' || who, 'Turo saved it. Turo reviews it within about 48 hours.', 'success', 'cleaning-saved-' || p_res);
    end if;
    if v_new = 'approved' and c.status <> 'approved' then
      perform claims_notify('Turo approved ' || who || '''s cleaning fee', 'The $150 cleaning fee goes into your earnings.', 'success', 'cleaning-approved-' || p_res);
    end if;
    if v_new = 'denied' and c.status <> 'denied' then
      perform claims_notify('Turo turned down ' || who || '''s cleaning report', 'Reservation ' || p_res || '. Turo status: ' || st || '.', 'info', 'cleaning-denied-' || p_res);
    end if;
    if v_new = 'filed' then
      perform claims_cleaning_queue(p_res, 'verify', null, now() + interval '10 minutes');
    elsif v_new = 'saved' and now() < coalesce(c.filed_at, now()) + interval '5 days' then
      perform claims_cleaning_queue(p_res, 'verify', null, now() + interval '6 hours');   -- keep reading until Turo decides
    end if;
    return jsonb_build_object('ok', true, 'status', v_new);
  end if;
  return jsonb_build_object('ok', false, 'error', 'unknown kind');
end $$;

create or replace function public.claims_cleaning_done(p_token text, p_res bigint, p_kind text, p_ok boolean, p_result jsonb default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  return claims_cleaning_apply(p_res, p_kind, p_ok, p_result, p_error);
end $$;

-- Every minute: one free-AI photo read for the oldest trip being checked (Groq's free vision allows about one 3-photo call a minute).
create or replace function public.claims_cleaning_look_tick()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  select reservation_id into r from claim_cleaning
   where status = 'checking' and job_state = 'idle' and checked_at is null
     and exists (select 1 from claim_cleaning_photos p where p.reservation_id = claim_cleaning.reservation_id)
   order by deadline limit 1;
  if r.reservation_id is null then return jsonb_build_object('idle', true); end if;
  -- a read that has not finished in 45 minutes gives up this round (the row goes to error and the photos job runs again, up to 4 times)
  if exists (select 1 from claim_cleaning where reservation_id = r.reservation_id and turo_seen_at < now() - interval '45 minutes') then
    return claims_cleaning_verdict(r.reservation_id, jsonb_build_object('error', 'the free AI photo read did not finish within 45 minutes'));
  end if;
  perform invoke_edge_function('claims-cleaning', jsonb_build_object('op', 'look_next', 'reservation_id', r.reservation_id), 120000);
  update claim_cleaning set next_try_at = now() + interval '5 minutes' where reservation_id = r.reservation_id;   -- keeps the watchdog from re-queuing a live read
  return jsonb_build_object('looking', r.reservation_id);
end $$;

-- The edge function hands back the verdict here (service key only).
create or replace function public.claims_cleaning_verdict(p_res bigint, p_check jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c claim_cleaning;
begin
  select * into c from claim_cleaning where reservation_id = p_res;
  if c.reservation_id is null or c.status <> 'checking' then return jsonb_build_object('ok', false, 'error', 'not checking'); end if;
  return claims_cleaning_apply(p_res, 'photos', true, jsonb_build_object('turo_status', c.turo_status, 'pre_count', c.pre_count,
    'post_count', c.post_count, 'counts', c.photo_counts, 'check', p_check, 'check_error', p_check->>'error'));
end $$;

revoke all on function public.claims_cleaning_apply(bigint, text, boolean, jsonb, text), public.claims_cleaning_look_tick(),
  public.claims_cleaning_verdict(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.claims_cleaning_verdict(bigint, jsonb) to service_role;

update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(pulse->'also', '[]'::jsonb) || '["claims-cleaning-look"]'::jsonb) x)),
       updated_at = now()
 where slug = 'claims-closer';

select cron.unschedule('claims-cleaning-look') where exists (select 1 from cron.job where jobname = 'claims-cleaning-look');
select cron.schedule('claims-cleaning-look', '* * * * *', 'select public.claims_cleaning_look_tick()');
