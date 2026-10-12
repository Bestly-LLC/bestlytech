-- The client board's videos were black until the browser decoded a frame (and, when a video would not decode, forever).
-- Give each post its still: approval_board now returns thumb_url, except while she is looking at an older version of a
-- post we have since changed (stale), where the current still would not match what she was sent.
-- Applied as a text patch of the live definition so nothing else in the function is retyped; safe to re-run.
do $do$ declare d text; begin
  d := pg_get_functiondef('public.approval_board(text)'::regprocedure);
  if position('thumb_url' in d) > 0 then return; end if;
  if position('it.code, it.media_type, it.platform' in d) = 0 then raise exception 'approval_board: unexpected definition'; end if;
  d := replace(d, 'it.code, it.media_type, it.platform', 'case when stale then null else it.thumb_url end as thumb_url, it.code, it.media_type, it.platform');
  execute d;
end $do$;
