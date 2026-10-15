-- YouTube connector (2026-10-15), follow-up: YouTube gates on studio_yt_live() exactly like Pinterest gates on studio_pin_live().
-- Google locks unaudited API uploads as private, so nothing is planned, enqueued or uploaded until the audit passes and
-- studio_yt_live_set(true) is called. Connecting still works while not live (tile + connect link need only studio_yt_ready()).
-- bestly-yt-poster v2 matches: drain returns {"drained":0,"gated":true} while not live.
-- Supersedes the "queues now, uploads private" behaviour in 20261015120100_youtube_connector.sql (that file is not edited).
-- Each patch replaces exactly one occurrence of a snippet in the live function body and fails loudly if it is not found.

create or replace function pg_temp.yt_patch(p_sig text, p_old text, p_new text) returns void
 language plpgsql
as $f$
declare d text; n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  n := (length(d) - length(replace(d, p_old, ''))) / length(p_old);
  if n <> 1 then raise exception 'yt_patch: % occurrence(s) of [%] in %', n, left(p_old, 70), p_sig; end if;
  execute replace(d, p_old, p_new);
end $f$;

-- calendar_post_platforms: youtube is live-gated, and held (not "not connected") while the gate is closed
select pg_temp.yt_patch('public.calendar_post_platforms(uuid)',
  $a$(a.platform <> 'pinterest' or public.studio_pin_live())),$a$,
  $a$(a.platform <> 'pinterest' or public.studio_pin_live())
              and (a.platform <> 'youtube' or public.studio_yt_live())),$a$);
select pg_temp.yt_patch('public.calendar_post_platforms(uuid)',
  $a$or (a.platform = 'pinterest' and not public.studio_pin_live())$a$,
  $a$or (a.platform = 'pinterest' and not public.studio_pin_live()) or (a.platform = 'youtube' and not public.studio_yt_live())$a$);

-- item_platforms / house_item_platforms
select pg_temp.yt_patch('public.item_platforms(uuid)',
  $a$and (p <> 'pinterest' or public.studio_pin_live()) then$a$,
  $a$and (p <> 'pinterest' or public.studio_pin_live())
       and (p <> 'youtube' or public.studio_yt_live()) then$a$);
select pg_temp.yt_patch('public.house_item_platforms(uuid)',
  $a$and ((t->>'platform') <> 'pinterest' or public.studio_pin_live()) then$a$,
  $a$and ((t->>'platform') <> 'pinterest' or public.studio_pin_live())
       and ((t->>'platform') <> 'youtube' or public.studio_yt_live()) then$a$);

-- social_enqueue_item (5-arg): youtube_not_live, and the stale "queues now" comment fixed
select pg_temp.yt_patch('public.social_enqueue_item(uuid, timestamp with time zone, text, boolean, text)',
  $a$LinkedIn / Pinterest only post once their live gate is thrown$a$,
  $a$LinkedIn / Pinterest / YouTube only post once their live gate is thrown$a$);
select pg_temp.yt_patch('public.social_enqueue_item(uuid, timestamp with time zone, text, boolean, text)',
  $a$-- (YouTube is different: it queues now and the poster uploads private until studio_yt_live() is true)$a$,
  $a$-- (YouTube too: Google keeps unaudited uploads private, so nothing is queued until studio_yt_live() is true)$a$);
select pg_temp.yt_patch('public.social_enqueue_item(uuid, timestamp with time zone, text, boolean, text)',
  $a$'Pinterest is connected, but posting to it is not switched on yet.'); end if;$a$,
  $a$'Pinterest is connected, but posting to it is not switched on yet.'); end if;
  if p_platform = 'youtube' and not public.studio_yt_live() then
    return jsonb_build_object('ok', false, 'error', 'youtube_not_live', 'detail', 'YouTube is connected, but posting to it is not switched on yet.'); end if;$a$);

-- studio_autopost_tick: silent skip until live
select pg_temp.yt_patch('public.studio_autopost_tick()',
  $a$if p = 'pinterest' and not public.studio_pin_live() then continue; end if;$a$,
  $a$if p = 'pinterest' and not public.studio_pin_live() then continue; end if;
        if p = 'youtube' and not public.studio_yt_live() then continue; end if;$a$);
select pg_temp.yt_patch('public.studio_autopost_tick()',
  $a$-- YouTube: video only, never an image item (and no live gate: the poster uploads private until studio_yt_live())$a$,
  $a$-- YouTube: gated on studio_yt_live() above like Pinterest; video only, never an image item$a$);

-- studio_post_now: silent skip until live
select pg_temp.yt_patch('public.studio_post_now(text, uuid, text[], timestamp with time zone)',
  $a$(p = 'pinterest' and not public.studio_pin_live()) then continue;$a$,
  $a$(p = 'pinterest' and not public.studio_pin_live()) or (p = 'youtube' and not public.studio_yt_live()) then continue;$a$);

-- social_engine_watch: no "past slot" kicks/alerts and no failed-post requeue for youtube while not live (quota exemption kept)
select pg_temp.yt_patch('public.social_engine_watch()',
  $a$(pl <> 'youtube' or coalesce(error, '') not ilike '%quota%')$a$,
  $a$(pl <> 'youtube' or (public.studio_yt_live() and coalesce(error, '') not ilike '%quota%'))$a$);
select pg_temp.yt_patch('public.social_engine_watch()',
  $a$fa.platform = pl and fa.active);$a$,
  $a$fa.platform = pl and fa.active)
       and (pl <> 'youtube' or public.studio_yt_live());$a$);
