-- Montage: a re-cut may order fresh LTX b-roll, but ONLY through this function, and only with an approved dollar amount.
-- The default re-cut (trigger montage_recut on a "changes" note) stays broll=false, $0, and reuses the parent's clips.
-- Jared 2026-10-12 7:33 PM PT approved ONE b-roll order for BC05 (~$0.53 quoted, hard cap $1.00).
-- The worker re-prices the whole clip order before it orders anything and refuses if it is above p_approved_usd.
create or replace function public.montage_recut_broll(p_item uuid, p_note text, p_approved_usd numeric, p_by text default 'spark')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare it approval_items; pj studio_video_jobs; v_id uuid;
begin
  if coalesce(trim(p_note), '') = '' then raise exception 'montage_recut_broll: a revise note is required'; end if;
  if p_approved_usd is null or p_approved_usd <= 0 or p_approved_usd > 5 then
    raise exception 'montage_recut_broll: p_approved_usd must be the approved spend, above 0 and at most 5';
  end if;
  select * into it from approval_items where id = p_item;
  if it.id is null or it.provenance->>'made_in' is distinct from 'montage' then raise exception 'montage_recut_broll: not a Montage item'; end if;
  select * into pj from studio_video_jobs where id = (it.provenance->>'job_id')::uuid;
  if pj.id is null then raise exception 'montage_recut_broll: the item has no source job'; end if;
  if exists (select 1 from studio_video_jobs where parent_item_id = it.id and status in ('queued','working','waiting','held')) then
    raise exception 'montage_recut_broll: a re-cut of this item is already running';
  end if;
  insert into studio_video_jobs (client_slug, pipeline, brief, platform, duration_s, budget_usd, broll, thread_id, requested_by,
                                 parent_item_id, parent_job_id, revise_note)
  values (pj.client_slug, pj.pipeline, pj.brief, pj.platform, pj.duration_s, p_approved_usd, true, pj.thread_id, coalesce(p_by, 'spark'),
          it.id, pj.id, left(p_note, 2000))
  returning id into v_id;
  update approval_items set work_kind = 'rendering', work_by = 'Montage', work_started_at = now(),
         work_eta_at = now() + interval '35 minutes', work_note = 'Re-cutting with b-roll'
   where id = it.id;
  return jsonb_build_object('ok', true, 'job_id', v_id, 'approved_usd', p_approved_usd);
end $$;
revoke all on function public.montage_recut_broll(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.montage_recut_broll(uuid, text, numeric, text) to service_role;
