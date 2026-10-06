-- LTX vertical deploy, multi-clip billing fix, Spark policy guard (2026-10-06, docs/montage-opusplan.md Track B).
-- Applied via execute_sql (patched from pg_get_functiondef); this file is the record.
--
-- Box (not SQL): tools/ltx-box/make-video.py + ltx-worker.py (commit 148c4df) copied to /opt/ltx/ over SSM,
--   old ones kept as *.bak-20261006, ltx-worker restarted. sha256 on the box matched the repo:
--   make-video.py  8fb9d875130df77221d56414efba956957f5e15f5c079c96ab886668d756e602 (second revision: sets the ResolutionSelector node;
                 first deploy ddc30c95... still rendered 1280x704 because that node overrides the width/height widgets)
--   ltx-worker.py  703fbb8bf276f65bcbe407d0c56fcabc4f52afc441c738675a3d0541ddc1f56d
--
-- ltx_request(p_prompt, p_seconds, p_source, p_thread) changes:
--  1. Billing: woke_box = (box asleep AND no other ltx_jobs row is queued/rendering). Before, every clip queued while
--     the box slept got woke_box = true and ltx_finish charged each one the whole requested->claimed wait.
--     (montage_clip_request already did this with its `first` flag.) Rows already finished today: only one
--     woke_box row existed (the first Montage clip, legitimately charged the wake), so nothing to correct.
--  2. Policy guard: p_source = 'spark' with p_thread = a studio_requests row whose client_slug has a
--     montage_brand_policy row with ai_footage_ok = false returns
--     {ok:false, error:'no_ai_footage', text:'No AI video for this client: <note>'} and inserts nothing.
--     Tested in a rolled-back DO block against a fake centering-you thread.
create or replace function public.ltx_request(p_prompt text, p_seconds integer default 5, p_source text default 'claude', p_thread uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare q jsonb; j ltx_jobs; b ltx_box; awake boolean; n int; wait_txt text;
begin
  -- Policy guard (2026-10-06): clients with ai_footage_ok = false never get AI video from Spark.
  if p_source = 'spark' and p_thread is not null and exists (
       select 1 from studio_requests r join montage_brand_policy p on p.client_slug = r.client_slug
       where r.id = p_thread and p.ai_footage_ok = false) then
    return jsonb_build_object('ok', false, 'error', 'no_ai_footage', 'text',
      'No AI video for this client: ' || (select p.note from studio_requests r join montage_brand_policy p on p.client_slug = r.client_slug where r.id = p_thread limit 1));
  end if;
  select * into b from ltx_box where id;
  q := ltx_quote(p_seconds);
  awake := (q->>'awake')::boolean;
  insert into ltx_jobs (prompt, seconds, source, thread_id, woke_box, est_minutes, est_usd)
  values (trim(p_prompt), greatest(1, least(coalesce(p_seconds, 5), 20)), p_source, p_thread,
          (not awake and not exists (select 1 from ltx_jobs o where o.status in ('queued', 'rendering'))), (q->>'est_minutes')::numeric, (q->>'est_usd')::numeric)
  returning * into j;
  insert into ltx_box_events (event, detail) values ('job_queued', jsonb_build_object('job', j.id, 'source', p_source, 'seconds', j.seconds));
  select count(*) into n from ltx_jobs where status = 'queued';
  wait_txt := case when awake then 'Starting now.'
                   when n >= b.batch_min then 'That makes a batch of ' || n || ', so the box is waking now.'
                   else 'The box is asleep: it wakes when ' || b.batch_min || ' clips are queued or in ' || ltx_nb(b.batch_wait_min::text, 'min') ||
                        ', whichever comes first (' || n || ' of ' || b.batch_min || ' so far). Say "now" to wake it right away.' end;
  return jsonb_build_object('job_id', j.id, 'code', j.code, 'quote', q,
    'text', 'Queued (' || ltx_nb(j.seconds::text, 'sec') || ' clip). ' || wait_txt || ' ' || (q->>'text') ||
      '. I will post the clip here with the actual cost when it is done.');
end $function$;
