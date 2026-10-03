-- RoofGuard phone finder schedule (Spark, 2026-10-03):
--   roofguard-enrich  every 5 min, 12 leads per run, stops claiming when nothing is left
--   roofguard-watch   every 10 min: rg_watch() self-heals stuck rows / stalled runs and raises to Scout
select cron.schedule('roofguard-enrich', '*/5 * * * *',
  $$ select public.invoke_edge_function('roofguard-enrich', '{"source":"cron"}'::jsonb, 150000)
     where exists (select 1 from public.rg_leads where enrich_status = 'pending'
                   or (enrich_status = 'error' and enrich_attempts < 3)); $$);
select cron.schedule('roofguard-watch', '3-59/10 * * * *', $$ select public.rg_watch(); $$);
