-- Studio Threads, part 2 (2026-10-19): add 'threads' to the live platform lists.
-- Each call re-reads the LIVE function text, swaps exact strings, fails loudly if a string is not found, then re-creates it.
-- (Live text is used on purpose: other work edits studio_autopost_tick at the same time.)
-- Originals are saved in bestly_memory under build/studio-threads-2026-10-19-orig/*.

create or replace function pg_temp.thr_patch(p_name text, p_args int, p_pairs text[]) returns text language plpgsql as $f$
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

-- 1. connect link: Threads allowed once the app secret is stored
select pg_temp.thr_patch('studio_social_connect_link', 3, array[
 $a$or (p_platform in ('linkedin', 'pinterest', 'youtube') and public.connect_platform_available(v_id, p_platform))$a$,
 $a$or (p_platform in ('linkedin', 'pinterest', 'youtube') and public.connect_platform_available(v_id, p_platform)) or (p_platform = 'threads' and public.studio_threads_ready())$a$
]);

-- 2. which platforms an item goes to (non-house brands)
select pg_temp.thr_patch('item_platforms', 1, array[
 $a$array['instagram','facebook','tiktok','linkedin','pinterest','youtube']$a$,
 $a$array['instagram','facebook','tiktok','linkedin','pinterest','youtube','threads']$a$
]);

-- 3. house brands with no account mapping: Threads is a target next to Instagram
select pg_temp.thr_patch('house_post_targets', 1, array[
 $a$a.brand = c.social_brand and a.platform = 'instagram'$a$,
 $a$a.brand = c.social_brand and a.platform in ('instagram', 'threads')$a$
]);

-- 4. enqueue: accept the platform; Threads uses the Instagram caption when it has none of its own; Threads takes video, images, carousels
select pg_temp.thr_patch('social_enqueue_item', 5, array[
 $a$if p_platform not in ('instagram','tiktok','facebook','linkedin','pinterest','youtube') then$a$,
 $a$if p_platform not in ('instagram','tiktok','facebook','linkedin','pinterest','youtube','threads') then$a$,
 $a$if v_cap is null and p_platform in ('tiktok','facebook','linkedin','pinterest','youtube') then$a$,
 $a$if v_cap is null and p_platform in ('tiktok','facebook','linkedin','pinterest','youtube','threads') then$a$
]);

-- 5. the 5-minute scheduler: queue Threads, kick its poster
select pg_temp.thr_patch('studio_autopost_tick', 0, array[
 $a$if p not in ('instagram', 'tiktok', 'facebook', 'linkedin', 'pinterest', 'youtube') then continue; end if;$a$,
 $a$if p not in ('instagram', 'tiktok', 'facebook', 'linkedin', 'pinterest', 'youtube', 'threads') then continue; end if;$a$,
 $a$elsif p in ('facebook', 'linkedin', 'pinterest', 'youtube') and not exists$a$,
 $a$elsif p in ('facebook', 'linkedin', 'pinterest', 'youtube', 'threads') and not exists$a$,
 $a$begin perform invoke_edge_function('bestly-yt-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;$a$,
 $a$begin perform invoke_edge_function('bestly-yt-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;
    begin perform invoke_edge_function('bestly-threads-poster', jsonb_build_object('action','drain'), 5000); exception when others then null; end;$a$
]);

-- 6. the watchdog: Threads gets the same drain / retry / reconnect / token-refresh checks as LinkedIn and Pinterest
select pg_temp.thr_patch('social_engine_watch', 0, array[
 $a$'social-drain-pinterest','social-drain-youtube')$a$,
 $a$'social-drain-pinterest','social-drain-youtube','social-drain-threads')$a$,
 $a$r.jobname not in ('social-drain-linkedin','social-drain-pinterest','social-drain-youtube')$a$,
 $a$r.jobname not in ('social-drain-linkedin','social-drain-pinterest','social-drain-youtube','social-drain-threads')$a$,
 $a$when 'social-drain-youtube' then 'bestly-yt-poster' else 'tiktok-inbox' end$a$,
 $a$when 'social-drain-youtube' then 'bestly-yt-poster' when 'social-drain-threads' then 'bestly-threads-poster' else 'tiktok-inbox' end$a$,
 $a$foreach pl in array array['linkedin','pinterest','youtube'] loop$a$,
 $a$foreach pl in array array['linkedin','pinterest','youtube','threads'] loop$a$,
 $a$when 'youtube' then 'bestly-yt-poster' else 'bestly-pin-poster' end;$a$,
 $a$when 'youtube' then 'bestly-yt-poster' when 'threads' then 'bestly-threads-poster' else 'bestly-pin-poster' end;$a$,
 $a$when 'youtube' then 'YouTube' else 'Pinterest' end;$a$,
 $a$when 'youtube' then 'YouTube' when 'threads' then 'Threads' else 'Pinterest' end;$a$,
 $a$coalesce(error, '') not ilike '%quota%'));$a$,
 $a$coalesce(error, '') not ilike '%quota%')) and pl <> 'threads';$a$
]);

-- 7. the connect tile in brand settings
select pg_temp.thr_patch('client_connect_tile', 2, array[
 $a$when 'pinterest' then 'Pinterest' when 'youtube' then 'YouTube' else p end;$a$,
 $a$when 'pinterest' then 'Pinterest' when 'youtube' then 'YouTube' when 'threads' then 'Threads' else p end;$a$,
 $a$else jsonb_build_array('Tap the button below.', 'Log in to ' || v_name || ' and approve.'$a$,
 $a$when p = 'threads' then
          jsonb_build_array('Tap the button below.', 'Log in with the Instagram account behind ' || coalesce(v_handle, 'your Threads profile') || ' if it asks.', 'Tap Allow.')
        else jsonb_build_array('Tap the button below.', 'Log in to ' || v_name || ' and approve.'$a$
]);
