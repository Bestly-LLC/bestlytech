-- scout-files-prune failed on its first run (2026-09-24, 9:35 PM PT):
--
--   ERROR: Direct deletion from storage tables is not allowed. Use the Storage API instead.
--   HINT:  This prevents accidental data loss from orphaned objects.
--
-- The original prune did `delete from storage.objects ...`. Supabase Storage guards that table
-- with a BEFORE DELETE trigger (storage.protect_delete) because the row is only the metadata:
-- dropping it leaves the actual bytes orphaned in the object store, still billed and never
-- reachable again. The right way to remove a file is the Storage API, which deletes the blob
-- and the row together. Flipping the guard off (storage.allow_delete_query) would have made
-- the job "pass" while leaking every pruned file — so no.
--
-- New shape: gather the expired object names, hand them to DELETE /storage/v1/object/scout-files
-- through pg_net with the service role (same key path invoke_edge_function uses), in batches.
-- pg_net is async, so a run can't confirm its own delete; instead each night checks whether
-- anything older than 31 days is still sitting there (it should have gone the night before)
-- and raises ai.scoutfile.prune to Scout if the prune isn't taking. It resolves itself once a
-- run lands. Cron failures of the job itself are already caught by the monitor.

drop function if exists public.scout_files_prune();

create function public.scout_files_prune()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'storage', 'vault', 'extensions'
as $$
declare
  v_url   text := 'https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/scout-files';
  v_key   text;
  v_names text[];
  v_batch text[];
  v_stale integer;
  v_req   bigint;
  v_reqs  bigint[] := '{}';
  i       integer;
begin
  -- Watchdog: anything older than 31 days should have been removed by yesterday's run.
  select count(*) into v_stale
    from storage.objects
   where bucket_id = 'scout-files' and created_at < now() - interval '31 days';

  if v_stale > 0 then
    perform public.bestly_raise('ai.scoutfile.prune', 'problem', 'warning',
      'Scout files: old files aren''t being pruned',
      format('%s file(s) older than 31 days are still in the scout-files bucket, so the last prune call to the Storage API didn''t take. Check net._http_response for the scout_files_prune requests and that service_role_key in Vault is current.', v_stale),
      'ai');
  else
    perform public.bestly_raise('ai.scoutfile.prune', 'resolved', 'info', null);
  end if;

  select coalesce(array_agg(name order by created_at), '{}') into v_names
    from storage.objects
   where bucket_id = 'scout-files' and created_at < now() - interval '30 days';

  if coalesce(array_length(v_names, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'pruned', 0, 'stale', v_stale);
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then
    raise exception 'service_role_key not found in vault';
  end if;

  -- Storage's remove endpoint takes a list of object paths; send them 200 at a time.
  for i in 1 .. array_length(v_names, 1) by 200 loop
    v_batch := v_names[i : i + 199];
    select net.http_delete(
      url                  := v_url,
      headers              := jsonb_build_object(
                                'Authorization', 'Bearer ' || v_key,
                                'apikey',        v_key,
                                'Content-Type',  'application/json'),
      body                 := jsonb_build_object('prefixes', to_jsonb(v_batch)),
      timeout_milliseconds := 30000
    ) into v_req;
    v_reqs := v_reqs || v_req;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'pruned', array_length(v_names, 1),
    'stale', v_stale,
    'requests', to_jsonb(v_reqs));
end $$;

-- Cron-only: it reads the service role key, so nobody but postgres/service_role calls it.
revoke all on function public.scout_files_prune() from public, anon, authenticated;
grant execute on function public.scout_files_prune() to service_role;
