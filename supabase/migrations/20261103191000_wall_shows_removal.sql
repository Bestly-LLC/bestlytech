-- Wall shows removal (Jared, Nov 3 2026): sleep show, tours, Motivate me, "Wake + sleep" test,
-- Live Activities "Show for friends" and "Sleep mode". Themes, heads-up, alarm, radio, neon, sky stay.
-- Undo: bestly_memory key house/undo/wall-shows-removal-2026-11-03 (original function bodies + saved state values).
-- Cleaners are rewritten from their live definitions by anchored cuts so nothing else in them changes.
do $mig$
declare d text; a int; b int;
begin
  -- wall_clean_tour: drop the tour{cmd,at} block, keep volume + theme
  d := pg_get_functiondef('public.wall_clean_tour(jsonb)'::regprocedure);
  a := strpos(d, E'  if jsonb_typeof(p->''tour'') = ''object''');
  b := strpos(d, E'  if jsonb_typeof(p->''volume'')');
  if a > 0 and b > a then execute substr(d, 1, a - 1) || substr(d, b); end if;

  -- wall_clean_r4admin: drop motivate
  d := pg_get_functiondef('public.wall_clean_r4admin(jsonb)'::regprocedure);
  a := strpos(d, E'  if p ? ''motivate'' then');
  b := strpos(d, E'  return out;');
  if a > 0 and b > a then execute substr(d, 1, a - 1) || substr(d, b); end if;

  -- wall_clean_ledsign: no more motivate test fx
  d := pg_get_functiondef('public.wall_clean_ledsign(jsonb)'::regprocedure);
  if strpos(d, '''sign'',''turo'',''motivate'',''scout''') > 0 then
    execute replace(d, '''sign'',''turo'',''motivate'',''scout''', '''sign'',''turo'',''scout''');
  end if;

  -- wall_clean_patch: fxPlay name 'show' gone, sleepShow gone, liveActs show/sleep gone
  d := pg_get_functiondef('public.wall_clean_patch(jsonb)'::regprocedure);
  d := replace(d, '(''show'',''wake'',''sleep'')', '(''wake'',''sleep'')');
  a := strpos(d, E'  if p ? ''sleepShow'' then');
  b := strpos(d, E'  if jsonb_typeof(p->''liveActs'')');
  if a > 0 and b > a then d := substr(d, 1, a - 1) || substr(d, b); end if;
  d := replace(d, '(''plane'',''sweep'',''turo'',''show'',''sleep'',''incident'')', '(''plane'',''sweep'',''turo'',''incident'')');
  execute d;
end
$mig$;

-- Saved state: drop the removed keys (bounded to the single wall row), bump version so the Pi re-reads.
update public.wall_state
   set state = (state - 'tour' - 'sleepShow' - 'motivate'
                 - case when state->'fxPlay'->>'name' = 'show' then 'fxPlay' else '' end)
               || case when jsonb_typeof(state->'liveActs') = 'object'
                       then jsonb_build_object('liveActs', (state->'liveActs') - 'show' - 'sleep')
                       else '{}'::jsonb end,
       version = version + 1
 where id = 1;
