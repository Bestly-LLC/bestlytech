-- Cookie Yeti render-engine watchdog (2026-10-29).
-- cy-render-health used to be a ping that nothing scheduled and nothing alerted on. The new "watch" mode
-- (service key only) pings AND launches Chromium on an inline test page, retries once, and raises or
-- resolves 'cy:render-engine' through bestly_raise. notification_owner('cy:render-engine') is
-- cy-pipeline (Cookie Yeti Pipeline), so the alert is signed by that employee.
-- The job is owned by cy-pipeline: listed in its pulse "also" so the Roster Scanner sees an owner.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cy-render-watch') then
    perform cron.unschedule('cy-render-watch');
  end if;
  perform cron.schedule(
    'cy-render-watch',
    '13-59/15 * * * *',
    $job$ select public.invoke_edge_function('cy-render-health', '{"watch":true}'::jsonb, 60000) $job$
  );
end $$;

update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}',
         (select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb)
            from jsonb_array_elements_text(coalesce(pulse->'also', '[]'::jsonb) || '["cy-render-watch"]'::jsonb) x)),
       updated_at = now()
 where slug = 'cy-pipeline'
   and not (coalesce(pulse->'also', '[]'::jsonb) ? 'cy-render-watch');
