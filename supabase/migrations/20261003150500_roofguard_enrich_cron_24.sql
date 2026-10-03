-- Finder runs take ~30 s for 12 leads, so take 24 per run (about 4 hours for the full list). (Spark, 2026-10-03)
select cron.schedule('roofguard-enrich', '*/5 * * * *',
  $$ select public.invoke_edge_function('roofguard-enrich', '{"source":"cron","limit":24}'::jsonb, 150000)
     where exists (select 1 from public.rg_leads where enrich_status = 'pending'
                   or (enrich_status = 'error' and enrich_attempts < 3)); $$);
