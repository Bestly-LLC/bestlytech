-- Jared 2026-10-10 (ElevenLabs in Studio, answer 20): "pause everywhere" - Montage no longer falls back to Piper on its own.
-- When ElevenLabs is unavailable, below the 30% reserve, or fails on a scene, the video job goes `held` (with a reason),
-- Spark tells Jared once a day, the worker re-checks every 30 minutes and resumes by itself, and after 7 days held the job
-- fails with an alert. Piper stays only behind montage_settings.voice.provider = 'piper' (manual switch).
-- Track B step 1 of docs/elevenlabs-studio-opusplan.md. Owner: Spark.

-- 1) a new job status + the columns the hold loop needs
alter table public.studio_video_jobs drop constraint if exists studio_video_jobs_status_check;
alter table public.studio_video_jobs add constraint studio_video_jobs_status_check
  check (status = any (array['queued','working','done','failed','cancelled','waiting','held']));
alter table public.studio_video_jobs add column if not exists held_reason text;
alter table public.studio_video_jobs add column if not exists held_since timestamptz;
alter table public.studio_video_jobs add column if not exists held_check_at timestamptz;

-- 2) claim: a held job comes back when its re-check time is due (stage 'resumed' = pick up from the saved script)
create or replace function public.montage_claim(p_worker text)
 returns setof studio_video_jobs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  update studio_video_jobs j set status = 'working',
         stage = case when j.status in ('waiting','held') then 'resumed' else 'claimed' end,
         worker = p_worker, attempts = j.attempts + case when j.status = 'queued' then 1 else 0 end,
         claimed_at = now(), heartbeat_at = now(), error = null
   where j.id = (select v.id from studio_video_jobs v
                  where v.status = 'queued'
                     or (v.status = 'waiting' and (v.waiting_since < now() - interval '90 minutes'
                         or not exists (select 1 from ltx_jobs l where l.montage_job_id = v.id and l.status in ('queued','rendering'))))
                     or (v.status = 'held' and coalesce(v.held_check_at, now()) <= now())
                  order by (v.status = 'waiting') desc, (v.status = 'held'), v.created_at
                  for update skip locked limit 1)
  returning j.*;
end $function$;

-- 3) report: the worker can set held_reason / held_check_at (timestamptz text); held_since is stamped on the first hold
create or replace function public.montage_report(p_id uuid, p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update studio_video_jobs set
    heartbeat_at = now(),
    stage        = coalesce(p->>'stage', stage),
    status       = coalesce(p->>'status', status),
    error        = case when p ? 'error' then left(p->>'error', 2000) else error end,
    script       = coalesce(p->'script', script),
    cost_usd     = coalesce((p->>'cost_usd')::numeric, cost_usd),
    render_s     = coalesce((p->>'render_s')::int, render_s),
    finished_at  = case when p->>'status' in ('done','failed') then now() else finished_at end,
    held_reason   = case when p->>'status' = 'held' then left(p->>'held_reason', 500)
                         when p->>'status' in ('working','done','failed') then null else held_reason end,
    held_since    = case when p->>'status' = 'held' then coalesce(held_since, now()) else held_since end,
    held_check_at = case when p->>'status' = 'held' then coalesce((p->>'held_check_at')::timestamptz, now() + interval '30 minutes')
                         else held_check_at end,
    log          = case when p ? 'note'
                        then (log || jsonb_build_array(jsonb_build_object('at', now(), 'stage', coalesce(p->>'stage', stage), 'note', left(p->>'note', 500))))
                        else log end
  where id = p_id;
  if p->>'status' = 'failed' then
    perform montage_post(p_id, 'The video failed at ' || coalesce(p->>'stage', 'some step') || ': ' || left(coalesce(p->>'error', 'unknown'), 300) ||
      '. Nothing was filed. Ask me to try again or change the brief.');
    update approval_items set work_kind = null, work_note = null, work_started_at = null, work_eta_at = null, work_by = null
     where id = (select parent_item_id from studio_video_jobs where id = p_id) and work_by = 'Montage';
  end if;
end $function$;

-- 4) status text for Spark / the Studio thread
create or replace function public.montage_status(p_ref text, p_thread uuid default null::uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare j studio_video_jobs; v_code text; n_done int; n_all int;
begin
  select * into j from studio_video_jobs
   where (coalesce(p_ref, '') <> '' and (id::text like p_ref || '%' or item_id in (select id from approval_items where code = upper(p_ref))))
      or (coalesce(p_ref, '') = '' and thread_id = p_thread)
   order by created_at desc limit 1;
  if j.id is null then return jsonb_build_object('ok', false, 'error', 'no Montage video found'); end if;
  select code into v_code from approval_items where id = coalesce(j.item_id, j.parent_item_id);
  select count(*) filter (where status in ('done','failed','cancelled')), count(*) into n_done, n_all from ltx_jobs where montage_job_id = j.id;
  return jsonb_build_object('ok', true, 'status', j.status, 'stage', j.stage, 'item', v_code,
    'text', case j.status
      when 'done' then 'Done: #' || coalesce(v_code, '?') || ' "' || coalesce(j.script->>'title', '') || '" is in Drafts > To review (' ||
                       ltx_nb(coalesce(round((j.script->'end'->>'end')::numeric)::text, '?'), 'sec') || ', rendered in ' || ltx_nb(coalesce(j.render_s, 0)::text, 'sec') || ').'
      when 'failed' then 'Failed at ' || coalesce(j.stage, '?') || ': ' || coalesce(j.error, 'unknown')
      when 'held' then 'On hold: ' || coalesce(j.held_reason, 'the voice is not available') || '. I re-check every 30 minutes and pick the video up on my own (held ' ||
                       ltx_dur(extract(epoch from now() - coalesce(j.held_since, j.created_at))) || ' so far; I stop after 7 days).'
      when 'waiting' then 'Waiting on b-roll from the LTX box: ' || n_done || ' of ' || n_all || ' clips back (ordered ' ||
                          ltx_dur(extract(epoch from now() - j.waiting_since)) || ' ago).'
      when 'queued' then 'Queued (' || ltx_dur(extract(epoch from now() - j.created_at)) || ' ago).'
      else 'Working: ' || coalesce(j.stage, 'starting') || '.' end);
end $function$;

-- 5) Spark owns the Montage voice alerts (dedupe keys montage.voice-*), and the team card no longer promises a Piper backup
insert into public.notification_owners (prefix, agent_slug, note)
select 'montage.voice', 'spark', 'Montage voice holds: credits low (push) / ElevenLabs down (info). 2026-10-10 answer 20'
 where not exists (select 1 from public.notification_owners where prefix = 'montage.voice');

select public.team_onboard('[{"slug":"elevenlabs-voice","name":"ElevenLabs Voice","role":"Paid narrator (videos wait for it, no Piper backup)","tool_of":"montage","runs_on":"external","schedule":"on demand","what_it_does":"Reads Montage videos aloud, one voice per brand. If credits run low or ElevenLabs is down, the video is put on hold (not read by a cheaper voice), Spark tells you once a day, and Montage picks it up on its own when credits reset or ElevenLabs answers. After 7 days on hold the video is stopped and you are told.","pulse":{"src":"none"},"icon":"bot"}]'::jsonb);
