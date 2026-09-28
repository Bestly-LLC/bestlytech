-- Wall round 4, W1: "Flip the sky" removed for good - the admin patch cleaner no longer accepts airFlip.
-- (Patched in place so other workers' changes to wall_clean_patch are kept.)
do $$
declare d text; a text := '  if jsonb_typeof(p->''airFlip'') = ''boolean'' then out := out || jsonb_build_object(''airFlip'', p->''airFlip''); end if;
';
begin
  d := pg_get_functiondef('public.wall_clean_patch(jsonb)'::regprocedure);
  if position(a in d) > 0 then
    execute replace(d, a, '');
  end if;
end $$;
