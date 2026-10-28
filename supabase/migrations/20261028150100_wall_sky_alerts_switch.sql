-- Jared 2026-10-28: Wall > Sky details "Local alerts" switch (skyAlerts). wall_clean_toggles drops any key not on its allowlist,
-- so add it. Idempotent: patches the live function text instead of restating it (already applied through the Supabase MCP).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.wall_clean_toggles(jsonb)'::regprocedure);
  if d not like '%skyAlerts%' then
    d := replace(d, '''skyTiles''', '''skyTiles'',''skyAlerts''');
    execute d;
  end if;
end $$;
