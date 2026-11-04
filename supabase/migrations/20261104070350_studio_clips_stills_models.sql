-- 2026-11-03 (Jared: add the Higgsfield assets to the library). The Nov 1 Higgsfield run also made stills (start frames,
-- packshots) and 3D bottle models, which the clip library had no kind for. Add 'still' and 'model3d'. studio_clip_pick
-- filters by kind, so a renderer asking for 'broll' never gets a still or a model.
-- studio_clip_watch counted only kind 'broll' as fresh footage, so brands whose library is product shots or UGC (HOKU,
-- Bestly Cloud) would raise a false "running low" card. It now counts every video kind (broll, product, ugc).
-- Data (not in this file): 107 studio_clips rows from the Nov 1 Higgsfield run + GLB fix renders, inserted 2026-11-03;
-- reshoot items are status draft with "RESHOOT: <reason>" in note. See bestly_memory build/clip-library-higgsfield-2026-11-03.
alter table public.studio_clips drop constraint if exists studio_clips_kind_check;
alter table public.studio_clips add constraint studio_clips_kind_check
  check (kind = any (array['broll','avatar','product','mascot','ugc','walkthrough','still','model3d']));

CREATE OR REPLACE FUNCTION public.studio_clip_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_healed int; v_low text;
begin
  with r as (update public.studio_clips set status = 'retired',
               note = coalesce(note || ' | ', '') || 'auto-retired ' || now()::date || ': no media'
             where status = 'approved' and media_url is null returning 1)
  select count(*) into v_healed from r;

  select string_agg(brand || ' (' || n || ')', ', ') into v_low from (
    select b.brand, count(c.id) n
    from (select distinct brand from public.studio_clips where brand <> 'any') b
    left join public.studio_clips c on c.brand = b.brand and c.kind in ('broll', 'product', 'ugc') and c.status = 'approved'
         and (c.last_used_at is null or c.last_used_at < now() - interval '7 days')
    group by b.brand having count(c.id) < 3) x;

  if v_low is not null then
    perform public.bestly_raise('studio:clip-library', 'problem', 'warning',
      'Clip library running low on fresh B-roll',
      'Fewer than 3 approved, unused-this-week video clips for: ' || v_low || '.'
        || case when v_healed > 0 then ' Also retired ' || v_healed || ' approved clip(s) with no media.' else '' end,
      'studio', 'Approve new clips in Studio, or OK Spark generating more (quote first).', v_healed > 0);
  else
    perform public.bestly_raise('studio:clip-library', 'resolved', 'info', null, null, 'studio');
  end if;
  return jsonb_build_object('ok', true, 'healed', v_healed, 'low', v_low);
end $function$;
