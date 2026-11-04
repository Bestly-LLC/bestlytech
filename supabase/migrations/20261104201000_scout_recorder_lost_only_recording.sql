-- Scout Recorder: the critical "stopped mid-call" alert only fires for a session that was really recording
-- (state 'recording' AND notice_at set). A 'starting' session with no notice for 12+ min becomes 'failed'
-- ('never started (no recording notice)') with one digest FYI through the normal report path, no push.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.scout_recorder_watch()'::regprocedure);
  d := replace(d, $q$where state in ('recording','starting') and last_beat_at < now() - interval '12 minutes'$q$,
                  $q$where state = 'recording' and notice_at is not null and last_beat_at < now() - interval '12 minutes'$q$);
  d := replace(d, $q$  -- 2. uploading with no progress$q$, $q$  -- 1b. starting with no recording notice for 12 min -> failed, digest FYI only
  for r in select * from scout_rec_sessions
            where state = 'starting' and last_beat_at < now() - interval '12 minutes'
            for update skip locked loop
    begin
      perform scout_rec_report('never-started', coalesce(nullif(r.title, ''), 'A call') || ' never started recording (no recording notice was confirmed).', 'warning', null);
    exception when others then null; end;
    update scout_rec_sessions set state = 'failed', error = 'never started (no recording notice)', updated_at = now() where id = r.id;
  end loop;

  -- 2. uploading with no progress$q$);
  execute d;
end $$;
