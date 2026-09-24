-- Reading a file is silent when it works, so the failure mode is Jared dropping a screenshot and
-- getting a shrug. Watch the image/PDF reads (the only ones that can fail on a provider) and the
-- bucket filling up.
create or replace function public.scout_file_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public', 'storage'
as $$
declare v_bad int; v_all int; v_spend numeric; v_files int;
begin
  select count(*) filter (where not ok), count(*), coalesce(sum(cost_usd), 0)
    into v_bad, v_all, v_spend
    from public.ai_spend where fn = 'scout-file' and at > now() - interval '24 hours';

  if v_all >= 3 and v_bad * 2 > v_all then
    perform public.bestly_raise('ai.scoutfile.failing', 'problem', 'warning',
      'Scout files: reads are failing',
      format('%s of %s file reads failed in the last day. Text files never hit a model, so this is the image/PDF path.', v_bad, v_all),
      'ai', null, true);
  else
    perform public.bestly_raise('ai.scoutfile.failing', 'resolved', 'info', null);
  end if;

  -- It is a cheap model on a handful of files; a dollar a day means something is looping.
  if v_spend > 1.00 then
    perform public.bestly_raise('ai.scoutfile.spend', 'problem', 'warning',
      'Scout files: reading is costing more than expected',
      format('$%s on file reads in 24 hours across %s files.', round(v_spend, 2), v_all), 'ai');
  else
    perform public.bestly_raise('ai.scoutfile.spend', 'resolved', 'info', null);
  end if;

  select count(*) into v_files from storage.objects where bucket_id = 'scout-files';
  return jsonb_build_object('ok', true, 'reads_24h', v_all, 'failed', v_bad, 'spend_24h', v_spend, 'files', v_files);
end $$;

select cron.schedule('scout-file-watchdog', '26-59/30 * * * *', $$select public.scout_file_watchdog()$$);
