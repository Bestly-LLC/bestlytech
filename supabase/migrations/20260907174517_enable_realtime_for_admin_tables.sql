-- The admin subscribes to postgres_changes on these and labels the surfaces "live",
-- but supabase_realtime had zero tables in it, so no event was ever delivered.
do $$
declare t text;
begin
  foreach t in array array[
    'cookie_patterns','missed_banner_reports','subscriptions',
    'granted_access','contact_submissions','hire_requests',
    'cloud_leads','shield_url_reports','home_hub_commands'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;
