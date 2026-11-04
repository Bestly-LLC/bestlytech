-- Scout Recorder: bestly_raise already feeds the 7 AM digest, so the explicit digest row must not carry its own key
-- (a null key dedupes by title and returns the row bestly_raise made: one digest row per report, not two).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.scout_rec_report(text,text,text,uuid)'::regprocedure);
  d := replace(d, $q$v_detail, v_key, null, 'meetings', false, null)$q$, $q$v_detail, null, null, 'meetings', false, null)$q$);
  execute d;
  d := pg_get_functiondef('public.scout_recorder_watch()'::regprocedure);
  d := replace(d, $q$' is still waiting to be transcribed after 6 hours.' end,
        'scout.recorder.transcribe:' || r.id, null, 'meetings', false, null);$q$,
        $q$' is still waiting to be transcribed after 6 hours.' end,
        null, null, 'meetings', false, null);$q$);
  execute d;
end $$;
