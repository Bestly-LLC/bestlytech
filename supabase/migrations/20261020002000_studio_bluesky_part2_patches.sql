-- Studio Bluesky, part 2 (2026-10-19): add 'bluesky' next to 'threads' in the live platform lists.
-- Each call re-reads the LIVE function text, swaps exact strings, fails loudly if a string is not found, then re-creates it.
-- (Live text is used on purpose: other work edits studio_autopost_tick at the same time. Every existing edit stays.)
-- Originals are saved in bestly_memory under build/studio-bluesky-2026-10-19-orig/*.

create or replace function pg_temp.bsky_patch(p_name text, p_args int, p_pairs text[]) returns text language plpgsql as $f$
declare d text; i int; o text; n text; done int := 0; skipped int := 0;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = p_name and p.pronargs = p_args;
  if d is null then raise exception 'function % not found', p_name; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    o := p_pairs[i*2-1]; n := p_pairs[i*2];
    if position(n in d) > 0 then skipped := skipped + 1; continue; end if;
    if position(o in d) = 0 then raise exception 'patch % of % did not match', i, p_name; end if;
    d := replace(d, o, n);
    done := done + 1;
  end loop;
  if done > 0 then execute d; end if;
  return p_name || ': applied ' || done || ', already there ' || skipped;
end $f$;

-- 1. connect link: Bluesky needs no app secret, so it is always allowed
select pg_temp.bsky_patch('studio_social_connect_link', 3, array[
 $a$or (p_platform = 'threads' and public.studio_threads_ready())$a$,
 $a$or (p_platform = 'threads' and public.studio_threads_ready()) or p_platform = 'bluesky'$a$
]);

-- 2. which platforms an item goes to (non-house brands)
select pg_temp.bsky_patch('item_platforms', 1, array[
 $a$array['instagram','facebook','tiktok','linkedin','pinterest','youtube','threads']$a$,
 $a$array['instagram','facebook','tiktok','linkedin','pinterest','youtube','threads','bluesky']$a$
]);

-- 3. house brands with no account mapping: Bluesky is a target next to Instagram and Threads
select pg_temp.bsky_patch('house_post_targets', 1, array[
 $a$a.platform in ('instagram', 'threads')$a$,
 $a$a.platform in ('instagram', 'threads', 'bluesky')$a$
]);

-- 4. enqueue: accept the platform; Bluesky uses the Instagram caption when it has none of its own
select pg_temp.bsky_patch('social_enqueue_item', 5, array[
 $a$if p_platform not in ('instagram','tiktok','facebook','linkedin','pinterest','youtube','threads') then$a$,
 $a$if p_platform not in ('instagram','tiktok','facebook','linkedin','pinterest','youtube','threads','bluesky') then$a$,
 $a$if v_cap is null and p_platform in ('tiktok','facebook','linkedin','pinterest','youtube','threads') then$a$,
 $a$if v_cap is null and p_platform in ('tiktok','facebook','linkedin','pinterest','youtube','threads','bluesky') then$a$
]);

-- 5. the 5-minute scheduler: queue Bluesky, kick its poster
select pg_temp.bsky_patch('studio_autopost_tick', 0, array[
 $a$if p not in ('instagram', 'tiktok', 'facebook', 'linkedin', 'pinterest', 'youtube', 'threads') then continue; end if;$a$,
 $a$if p not in ('instagram', 'tiktok', 'facebook', 'linkedin', 'pinterest', 'youtube', 'threads', 'bluesky') then continue; end if;$a$,
 $a$elsif p in ('facebook', 'linkedin', 'pinterest', 'youtube', 'threads') and not exists$a$,
 $a$elsif p in ('facebook', 'linkedin', 'pinterest', 'youtube', 'threads', 'bluesky') and not exists$a$,
 $a$begin perform invoke_edge_function('bestly-threads-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;$a$,
 $a$begin perform invoke_edge_function('bestly-threads-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-bluesky-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;$a$
]);

-- 6. the watchdog: Bluesky gets the same drain / retry / reconnect checks as Threads (and is not nagged for a slot wait)
select pg_temp.bsky_patch('social_engine_watch', 0, array[
 $a$'social-drain-youtube','social-drain-threads')$a$,
 $a$'social-drain-youtube','social-drain-threads','social-drain-bluesky')$a$,
 $a$when 'social-drain-threads' then 'bestly-threads-poster' else 'tiktok-inbox' end$a$,
 $a$when 'social-drain-threads' then 'bestly-threads-poster' when 'social-drain-bluesky' then 'bestly-bluesky-poster' else 'tiktok-inbox' end$a$,
 $a$foreach pl in array array['linkedin','pinterest','youtube','threads'] loop$a$,
 $a$foreach pl in array array['linkedin','pinterest','youtube','threads','bluesky'] loop$a$,
 $a$when 'threads' then 'bestly-threads-poster' else 'bestly-pin-poster' end;$a$,
 $a$when 'threads' then 'bestly-threads-poster' when 'bluesky' then 'bestly-bluesky-poster' else 'bestly-pin-poster' end;$a$,
 $a$when 'threads' then 'Threads' else 'Pinterest' end;$a$,
 $a$when 'threads' then 'Threads' when 'bluesky' then 'Bluesky' else 'Pinterest' end;$a$,
 $a$and pl <> 'threads';$a$,
 $a$and pl not in ('threads', 'bluesky');$a$
]);

-- 7. the connect tile in brand settings
select pg_temp.bsky_patch('client_connect_tile', 2, array[
 $a$when 'threads' then 'Threads' else p end;$a$,
 $a$when 'threads' then 'Threads' when 'bluesky' then 'Bluesky' else p end;$a$,
 $a$when p = 'threads' then$a$,
 $a$when p = 'bluesky' then
          jsonb_build_array('In Bluesky, open Settings, then Privacy and security, then App passwords, and make one called Bestly Studio.', 'Tap the button below.', 'Type your Bluesky handle and paste the App Password.')
        when p = 'threads' then$a$
]);
