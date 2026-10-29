-- Claims Closer cleaning reports, fix 1 (2026-10-29): dry-run rows (test runs on past trips) never expire or raise
-- "no cleaning check yet" alerts. Follow-up to 20261029230000_claims_cleaning.sql.

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
            where deadline < now() and not dry_run and status in ('waiting', 'checking', 'needs_you', 'filing') loop
    update claim_cleaning set status = 'expired', job_state = 'idle', updated_at = now() where reservation_id = r.reservation_id;
    perform claims_cleaning_log(r.reservation_id, 'Turo''s 72-hour window closed while this was ' || r.status);
    n_exp := n_exp + 1;
  end loop;
  return jsonb_build_object('new', n_new, 'expired', n_exp);
end $$;

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
            where status in ('waiting', 'checking') and checked_at is null and job_state <> 'running' and not dry_run
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
