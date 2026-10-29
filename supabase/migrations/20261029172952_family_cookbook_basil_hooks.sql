-- Family Cookbook, part 11: hook the family check into Basil's recipes watchdog, schedule the daily purge, and put it on Basil's pulse.
do $$
declare def text; block_sql text; marker text := E'  return jsonb_build_object(''healed'', to_jsonb(healed), ''problems'', to_jsonb(problems));';
begin
  def := pg_get_functiondef('public.basil_recipes_watchdog()'::regprocedure);
  if def like '%basil_family_watchdog%' then return; end if;
  if position(marker in def) = 0 then raise exception 'basil_recipes_watchdog changed shape; patch by hand'; end if;
  block_sql := E'  -- 7. Family Cookbook: stuck cards, sign-in, photo sync, purge, paid cap (basil_family_watchdog)\n'
    || E'  declare fw jsonb;\n  begin\n'
    || E'    fw := public.basil_family_watchdog();\n'
    || E'    healed := healed || coalesce((select array_agg(x) from jsonb_array_elements_text(fw -> ''healed'') x), ''{}''::text[]);\n'
    || E'    problems := problems || coalesce((select array_agg(x) from jsonb_array_elements_text(fw -> ''problems'') x), ''{}''::text[]);\n'
    || E'  exception when others then problems := problems || (''family cookbook check: '' || sqlerrm);\n  end;\n\n';
  execute replace(def, marker, block_sql || marker);
end $$;

select cron.schedule('basil-family-purge', '23 10 * * *', 'select public.family_maint_tick()')
 where not exists (select 1 from cron.job where jobname = 'basil-family-purge');

update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', (select to_jsonb(array_agg(distinct x)) from jsonb_array_elements_text(pulse -> 'also' || '["basil-family-purge"]'::jsonb) x))
 where slug = 'basil' and not (pulse -> 'also') ? 'basil-family-purge';
