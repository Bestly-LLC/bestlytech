-- Claims Closer: Turo cleaning violation reports (Jared approved 2026-10-29 2:18 PM PT; "just do yourself" 2:47 PM).
-- Why: Yuta's trip (res 62243969, Oct 11-12) never got its $150 cleaning fee. Jared's in-app report never saved (Turo's
-- issue options still showed CLEANING_VIOLATION as AVAILABLE until it EXPIRED), and his check-out set was 4 photos + odometer,
-- which Turo's Power Host Support said did not show a policy violation.
--
-- Turo facts found 2026-10-29 in Turo's own web code (read-only):
--   GET  /api/reservations/{id}/issue/options -> options[] {issueType, issueStatus AVAILABLE|EXPIRED|..., reimbursementAmount}
--        CLEANING_VIOLATION and SMOKING_VIOLATION are $150 and "Available up to 72 hours after trip end".
--   POST /api/reservations/{id}/issue  {reservationIssueType:"CLEANING_VIOLATION", message, selectedTripPhotos:[uuid...]}
--        selectedTripPhotos must be non-empty and are uuids already on the reservation (/api/reservation/imagesV2).
--   Web form: turo.com/us/en/report-issue/{id}/cleaning
-- Help page: pre-trip photos within 24h before, post-trip within 24h after, only mess from irresponsible/abusive use.
--
-- Flow (all signed Claims Closer):
--   claims_cleaning_scan()  every ended trip gets a row; 1 hour after trip end the Pi Turo reader (hestia) is asked for a 'photos' job
--   reader 1.5.0            reads the issue options + photo list, downloads Jared's check-in/check-out and the guest's return photos,
--                           stores them (claims-cleaning edge fn, op put) and asks for a free-AI check (op check), then claims_cleaning_done
--   claims_cleaning_done    clean -> done. Clear abuse at >= min_confidence with mode auto -> 'file' job. Anything else worth a look -> Jared taps
--                           File or Skip on /admin/claims. 'file' re-checks AVAILABLE, posts the report, re-reads options to confirm Turo saved it.
--   claims_cleaning_watch   every 10 min: scan, heal stuck jobs, alert when a report is not confirmed saved within 1 hour, or a decision
--                           waits with under 12 hours left in Turo's 72-hour window. Raises claims.cleaning.* (owner claims-closer).
-- Undo: supabase/undo/claims-cleaning-2026-10-29.undo.sql

create table if not exists public.claim_cleaning_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  mode text not null default 'auto' check (mode in ('auto', 'ask')),
  min_confidence numeric not null default 0.85 check (min_confidence between 0.5 and 1),
  updated_at timestamptz not null default now()
);
insert into public.claim_cleaning_settings (id) values (true) on conflict do nothing;

create table if not exists public.claim_cleaning (
  reservation_id bigint primary key,
  guest_first text,
  trip_start timestamptz,
  trip_end timestamptz not null,
  deadline timestamptz not null,
  status text not null default 'waiting' check (status in
    ('waiting', 'checking', 'clean', 'no_evidence', 'needs_you', 'filing', 'filed', 'saved', 'approved', 'denied', 'skipped', 'expired', 'error')),
  dry_run boolean not null default false,
  job_kind text check (job_kind in ('photos', 'file', 'verify')),
  job_state text not null default 'idle' check (job_state in ('idle', 'queued', 'running')),
  job_payload jsonb,
  job_claimed_at timestamptz,
  job_attempts int not null default 0,
  next_try_at timestamptz,
  turo_status text,
  turo_seen_at timestamptz,
  photo_counts jsonb,
  pre_count int,
  post_count int,
  verdict text check (verdict in ('abuse', 'normal', 'unclear')),
  confidence numeric,
  reasons text,
  support_uuids text[],
  ai_model text,
  checked_at timestamptz,
  filed_at timestamptz,
  filed_message text,
  filed_photo_uuids text[],
  verified_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  last_error text,
  log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists claim_cleaning_job_idx on public.claim_cleaning (job_state, next_try_at);

create table if not exists public.claim_cleaning_photos (
  uuid text primary key,
  reservation_id bigint not null references public.claim_cleaning (reservation_id) on delete cascade,
  side text not null check (side in ('pre', 'post', 'guest_post')),
  step text,
  taken_at timestamptz,
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists claim_cleaning_photos_res_idx on public.claim_cleaning_photos (reservation_id);

alter table public.claim_cleaning enable row level security;
alter table public.claim_cleaning_photos enable row level security;
alter table public.claim_cleaning_settings enable row level security;
revoke all on public.claim_cleaning, public.claim_cleaning_photos, public.claim_cleaning_settings from anon, authenticated;
-- The admin page reads through claims_cleaning_admin() (SECURITY DEFINER), so no table grants to authenticated are needed.

-- one log line on the row (kept to the last 40)
create or replace function public.claims_cleaning_log(p_res bigint, p_text text)
returns void language sql security definer set search_path to 'public' as $$
  update claim_cleaning set log = (select coalesce(jsonb_agg(t.x order by t.n), '[]'::jsonb) from (
      select e.x, e.n from jsonb_array_elements(log || jsonb_build_array(jsonb_build_object('at', now(), 'text', left(p_text, 300)))) with ordinality e(x, n)
      order by e.n offset greatest(jsonb_array_length(log) + 1 - 40, 0)) t), updated_at = now()
   where reservation_id = p_res;
$$;

create or replace function public.claims_cleaning_queue(p_res bigint, p_kind text, p_payload jsonb default null, p_at timestamptz default now())
returns void language sql security definer set search_path to 'public' as $$
  update claim_cleaning set job_kind = p_kind, job_state = 'queued', job_payload = p_payload, job_attempts = 0,
         next_try_at = p_at, updated_at = now()
   where reservation_id = p_res;
  update turo_reader_state set poke_at = now() where id = 1 and p_at <= now();
$$;

-- Every ended trip gets a row; rows past the window expire.
create or replace function public.claims_cleaning_scan()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare n_new int := 0; n_exp int := 0; r record;
begin
  if not coalesce((select enabled from claim_cleaning_settings where id), true) then return jsonb_build_object('off', true); end if;
  insert into claim_cleaning (reservation_id, guest_first, trip_start, trip_end, deadline, status, next_try_at, job_kind, job_state)
  select t.reservation_id, t.guest_first, t.starts_at, t.ends_at, t.ends_at + interval '72 hours', 'waiting',
         t.ends_at + interval '1 hour', 'photos', 'queued'
    from turo_trips t
   where t.ends_at <= now() and t.ends_at > now() - interval '72 hours'
     and coalesce(t.status, '') !~* 'cancel'
  on conflict (reservation_id) do nothing;
  get diagnostics n_new = row_count;

  for r in select reservation_id, status from claim_cleaning
            where deadline < now() and status in ('waiting', 'checking', 'needs_you', 'filing') loop
    update claim_cleaning set status = 'expired', job_state = 'idle', updated_at = now() where reservation_id = r.reservation_id;
    perform claims_cleaning_log(r.reservation_id, 'Turo''s 72-hour window closed while this was ' || r.status);
    n_exp := n_exp + 1;
  end loop;
  return jsonb_build_object('new', n_new, 'expired', n_exp);
end $$;

-- The Pi reader takes one job at a time.
create or replace function public.claims_cleaning_take(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c claim_cleaning;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  -- A photos/verify job stuck 15+ min is safe to run again. A file job is never re-posted blind: it becomes a verify job,
  -- which reads Turo's status first (the report may have gone through).
  update claim_cleaning set job_state = 'queued', job_claimed_at = null,
         job_kind = case when job_kind = 'file' then 'verify' else job_kind end, updated_at = now()
   where job_state = 'running' and job_claimed_at < now() - interval '15 minutes';
  select * into c from claim_cleaning
   where job_state = 'queued' and coalesce(next_try_at, now()) <= now() and job_attempts < 4
   order by deadline limit 1 for update skip locked;
  if c.reservation_id is null then return jsonb_build_object('job', null); end if;
  update claim_cleaning set job_state = 'running', job_claimed_at = now(), job_attempts = job_attempts + 1,
         status = case when c.job_kind = 'photos' and status = 'waiting' then 'checking' else status end, updated_at = now()
   where reservation_id = c.reservation_id;
  return jsonb_build_object('job', jsonb_build_object('reservation_id', c.reservation_id, 'kind', c.job_kind,
    'payload', coalesce(c.job_payload, '{}'::jsonb), 'dry_run', c.dry_run, 'trip_start', c.trip_start, 'trip_end', c.trip_end,
    'deadline', c.deadline, 'known', (select coalesce(jsonb_agg(uuid), '[]'::jsonb) from claim_cleaning_photos where reservation_id = c.reservation_id)));
end $$;

-- The message filed with the report. Facts only: what the photos show. Never amounts, deductibles or Turo policy wording.
create or replace function public.claims_cleaning_message(p_res bigint)
returns text language sql stable security definer set search_path to 'public' as $$
  select left('The car was returned needing cleaning beyond normal use. '
    || coalesce('Post-trip photos show: ' || nullif(trim(c.reasons), '') || ' ', '')
    || 'Check-in photos show it was clean at pickup.', 500)
    from claim_cleaning c where c.reservation_id = p_res;
$$;

create or replace function public.claims_cleaning_done(p_token text, p_res bigint, p_kind text, p_ok boolean, p_result jsonb default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c claim_cleaning; s claim_cleaning_settings; st text; chk jsonb; v_post int; v_pre int; v_conf numeric; v_new text; v_uuids text[];
  who text;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
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

-- Jared's File / Skip tap (and Dry run for testing).
create or replace function public.claims_cleaning_decide(p_res bigint, p_action text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c claim_cleaning;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into c from claim_cleaning where reservation_id = p_res for update;
  if c.reservation_id is null then raise exception 'no cleaning check for %', p_res; end if;
  if p_action = 'file' then
    if c.deadline < now() then raise exception 'Turo''s 72-hour window has closed'; end if;
    if c.status in ('filing', 'filed', 'saved', 'approved', 'denied') then return jsonb_build_object('ok', true, 'already', c.status); end if;
    update claim_cleaning set status = 'filing', decided_by = 'jared', decided_at = now(), dry_run = false, last_error = null where reservation_id = p_res;
    perform claims_cleaning_queue(p_res, 'file', jsonb_build_object('message', claims_cleaning_message(p_res),
      'photo_uuids', to_jsonb(coalesce(c.support_uuids, (select array_agg(uuid) from claim_cleaning_photos where reservation_id = p_res and side <> 'pre')))));
    perform claims_cleaning_log(p_res, 'Jared tapped File');
  elsif p_action = 'skip' then
    update claim_cleaning set status = 'skipped', decided_by = 'jared', decided_at = now(), job_state = 'idle' where reservation_id = p_res;
    perform claims_cleaning_log(p_res, 'Jared tapped Skip');
  elsif p_action = 'recheck' then
    update claim_cleaning set status = case when status in ('clean', 'no_evidence', 'error', 'needs_you') then 'waiting' else status end where reservation_id = p_res;
    perform claims_cleaning_queue(p_res, 'photos');
    perform claims_cleaning_log(p_res, 'Jared asked for a fresh photo check');
  else
    raise exception 'unknown action %', p_action;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.claims_cleaning_settings_set(p_mode text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_mode not in ('auto', 'ask') then raise exception 'mode is auto or ask'; end if;
  update claim_cleaning_settings set mode = p_mode, updated_at = now() where id;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;

create or replace function public.claims_cleaning_admin()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from claim_cleaning_settings s where id),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('reservation_id', c.reservation_id, 'guest_first', c.guest_first, 'trip_end', c.trip_end,
        'deadline', c.deadline, 'status', c.status, 'dry_run', c.dry_run, 'verdict', c.verdict, 'confidence', c.confidence, 'reasons', c.reasons,
        'pre_count', c.pre_count, 'post_count', c.post_count, 'turo_status', c.turo_status, 'filed_at', c.filed_at, 'verified_at', c.verified_at,
        'last_error', c.last_error, 'job_kind', c.job_kind, 'job_state', c.job_state, 'log', c.log,
        'photos', (select coalesce(jsonb_agg(jsonb_build_object('uuid', p.uuid, 'side', p.side, 'path', p.storage_path, 'taken_at', p.taken_at,
            'support', p.uuid = any(coalesce(c.support_uuids, '{}'))) order by p.side, p.taken_at), '[]'::jsonb) from claim_cleaning_photos p where p.reservation_id = c.reservation_id))
        order by c.trip_end desc) from (select * from claim_cleaning order by trip_end desc limit 12) c), '[]'::jsonb));
end $$;

-- Watchdog: scan, heal, and tell Jared only about money with a clock on it.
create or replace function public.claims_cleaning_watch()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare scan jsonb; r record; v_left text; n_alert int := 0; n_heal int := 0; v_msg text; reader_seen timestamptz;
begin
  scan := claims_cleaning_scan();
  select seen_at into reader_seen from turo_reader_state where id = 1;

  -- heal: jobs that ran out of attempts while time is left get one more round, an hour later
  for r in select reservation_id from claim_cleaning
            where job_state = 'queued' and job_attempts >= 4 and deadline > now() + interval '6 hours' and updated_at < now() - interval '1 hour' loop
    update claim_cleaning set job_attempts = 0 where reservation_id = r.reservation_id;
    perform claims_cleaning_log(r.reservation_id, 'Watchdog: gave the stuck job another round');
    n_heal := n_heal + 1;
  end loop;

  -- a trip ended 12+ hours ago and still has no photo check
  for r in select reservation_id, guest_first, trip_end, deadline from claim_cleaning
            where status in ('waiting', 'checking') and checked_at is null and job_state <> 'running'
              and coalesce(next_try_at, now()) < now() - interval '30 minutes'
              and trip_end < now() - interval '12 hours' and deadline > now() loop
    perform claims_cleaning_queue(r.reservation_id, 'photos');
    perform bestly_raise('claims.cleaning.stuck.' || r.reservation_id, 'problem', 'warning',
      'No cleaning check yet for ' || coalesce(r.guest_first, 'a guest') || '''s trip',
      'Reservation ' || r.reservation_id || ' ended ' || to_char(r.trip_end at time zone 'America/Los_Angeles', 'Dy FMHH12:MI AM') ||
      '. I re-queued the photo check. The Turo reader on hestia was last seen ' ||
      coalesce(to_char(reader_seen at time zone 'America/Los_Angeles', 'FMHH12:MI AM'), 'never') || '.', 'turo', null, true);
    n_heal := n_heal + 1;
  end loop;
  for r in select reservation_id from claim_cleaning
            where (checked_at is not null or status not in ('waiting', 'checking')) and updated_at > now() - interval '1 day' loop
    perform bestly_raise('claims.cleaning.stuck.' || r.reservation_id, 'resolved', 'info', null, null, 'turo', null, true);
  end loop;

  -- filed but Turo does not show it saved within an hour: money with a clock on it
  for r in select reservation_id, guest_first, deadline, filed_at, decided_at from claim_cleaning
            where status in ('filing', 'filed') and coalesce(filed_at, decided_at) < now() - interval '1 hour' and deadline > now() loop
    v_left := round(extract(epoch from (r.deadline - now())) / 3600)::text;
    perform claims_cleaning_queue(r.reservation_id, 'verify');
    perform bestly_raise('claims.cleaning.file.' || r.reservation_id, 'problem', 'error',
      'Turo has not saved the cleaning report for ' || coalesce(r.guest_first, 'a guest'),
      'Reservation ' || r.reservation_id || '. I am re-reading Turo now. ' || v_left || ' hours left in Turo''s window.', 'turo',
      'Check turo.com/us/en/report-issue/' || r.reservation_id || '/cleaning', false);
    n_alert := n_alert + 1;
  end loop;

  -- a File/Skip decision waiting with under 12 hours left
  for r in select reservation_id, guest_first, deadline, reasons from claim_cleaning
            where status = 'needs_you' and not dry_run and deadline > now() and deadline < now() + interval '12 hours' loop
    v_left := round(extract(epoch from (r.deadline - now())) / 3600)::text;
    perform claims_notify(v_left || ' hours left to report ' || coalesce(r.guest_first, 'the guest') || '''s car as dirty',
      coalesce(r.reasons, '') || ' Tap File or Skip on the Claims page.', 'warning', 'cleaning-last-call-' || r.reservation_id);
    n_alert := n_alert + 1;
  end loop;

  perform bestly_raise('claims.cleaning', 'resolved', 'info', 'Cleaning report check is running', null, 'turo', null, true);
  return scan || jsonb_build_object('healed', n_heal, 'alerts', n_alert);
exception when others then
  v_msg := left(sqlerrm, 300);
  begin perform bestly_raise('claims.cleaning', 'problem', 'warning', 'Cleaning report check failed', v_msg, 'turo', null, false); exception when others then null; end;
  return jsonb_build_object('error', v_msg);
end $$;

revoke all on function public.claims_cleaning_log(bigint, text), public.claims_cleaning_queue(bigint, text, jsonb, timestamptz),
  public.claims_cleaning_scan(), public.claims_cleaning_watch(), public.claims_cleaning_message(bigint) from public, anon, authenticated;
-- The Pi reader calls these two with the publishable key; each checks the worker token first.
revoke all on function public.claims_cleaning_take(text), public.claims_cleaning_done(text, bigint, text, boolean, jsonb, text) from public, authenticated;
grant execute on function public.claims_cleaning_take(text), public.claims_cleaning_done(text, bigint, text, boolean, jsonb, text) to anon;
revoke all on function public.claims_cleaning_decide(bigint, text), public.claims_cleaning_settings_set(text), public.claims_cleaning_admin() from public, anon;
grant execute on function public.claims_cleaning_decide(bigint, text), public.claims_cleaning_settings_set(text), public.claims_cleaning_admin() to authenticated;

insert into public.security_public_rpcs (fn, why)
select x.fn, 'Pi Turo reader (hestia) with the publishable key; checks tesla_worker_ok first'
  from (values ('claims_cleaning_take'), ('claims_cleaning_done')) x(fn)
 where not exists (select 1 from public.security_public_rpcs s where s.fn = x.fn);

-- Claims Closer owns it.
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(coalesce(pulse->'also', '[]'::jsonb) || '["claims-cleaning-watch"]'::jsonb) x)),
       schedule = case when schedule ilike '%cleaning%' then schedule else schedule || '; cleaning report check every 10 min (photos on the Pi, free AI)' end,
       what_it_does = case when what_it_does ilike '%cleaning%' then what_it_does else what_it_does ||
         ' Also checks every trip''s return photos for a mess beyond normal use and files Turo''s $150 cleaning report within the 72-hour window, then confirms Turo saved it.' end,
       updated_at = now()
 where slug = 'claims-closer';
insert into public.notification_owners (prefix, agent_slug, note)
select 'claims.cleaning', 'claims-closer', 'cleaning reports 2026-10-29'
 where not exists (select 1 from public.notification_owners where prefix = 'claims.cleaning');

select cron.unschedule('claims-cleaning-watch') where exists (select 1 from cron.job where jobname = 'claims-cleaning-watch');
select cron.schedule('claims-cleaning-watch', '3-59/10 * * * *', 'select public.claims_cleaning_watch()');
