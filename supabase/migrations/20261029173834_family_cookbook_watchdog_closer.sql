-- A card can also hang in "closer" (the paid reader started and never answered); treat it like "reading".
do $$
declare def text;
begin
  def := pg_get_functiondef('public.basil_family_watchdog()'::regprocedure);
  if def like '%status in (''reading'', ''closer'') and updated_at%' then return; end if;
  if position('where status = ''reading'' and updated_at < now() - interval ''4 minutes''' in def) = 0 then raise exception 'basil_family_watchdog changed shape'; end if;
  execute replace(def, 'where status = ''reading'' and updated_at < now() - interval ''4 minutes''', 'where status in (''reading'', ''closer'') and updated_at < now() - interval ''4 minutes''');
end $$;
