-- Edge Guard card: the one-line fix skips npx's "Ok to proceed? (y)" prompt (Jared hit it on 2026-10-30, then a
-- broken npx cache folder). Same sign-in, fewer stops.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.stuck_classify(text,text)'::regprocedure);
  d := replace(d, 'cd ~/bestly-agents/edge-guard && npx wrangler login', 'npx --yes wrangler@latest login');
  execute d;
end $$;
