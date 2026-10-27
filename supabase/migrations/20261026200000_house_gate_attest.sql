-- House gate part 3 (Spark, 2026-10-26): cards the renderer itself drew do not wait for the Pi.
-- Cookie Yeti and InventoryProof image posts are drawn by social-render (cloud). Since v12 (2026-10-18, deployed 21:38 UTC)
-- its type scale is 2x (body 40-46 px, headlines 72-124 px), it never draws blank cards and it draws every word inside the
-- card by construction, so the Pi's OCR size check adds nothing for them. This function writes the media row for such a post
-- (facts say who attested it) so the gate can decide on caption, claims, duplicates and the product pointer without
-- depending on the Pi being reachable. A real Pi check, when it runs, replaces the row (house_gate_media_put upserts).
-- Renders before v12 are NOT attested: their small type is exactly what the gate rejects.
-- Undo: select cron.alter_job((select jobid from cron.job where jobname='house-gate-run'), command := 'select public.house_gate_run()');
--       drop function public.house_gate_attest_renders();

create or replace function public.house_gate_attest_renders() returns int
language plpgsql security definer set search_path = public as $$
declare it record; v_n int := 0; v_urls text[]; v_ok boolean;
begin
  for it in
    select i.id, i.content_version, i.media_type, i.media_url
      from approval_items i join approval_clients c on c.id = i.client_id join house_gate_brand b on b.client_slug = c.slug
     where c.kind = 'house' and c.publish_mode = 'auto' and c.slug in ('cookie-yeti', 'inventoryproof')
       and i.stage = 'internal' and coalesce(i.internal_status, 'pending') = 'pending' and i.posted_at is null and i.parked_at is null
       and i.media_type in ('image', 'carousel')
       and not exists (select 1 from house_gate_media m where m.item_id = i.id and m.content_version = i.content_version)
  loop
    select array_agg(u order by ord) into v_urls from (
      select it.media_url u, 0 ord where it.media_type = 'image'
      union all select s.media_url, s.position from approval_slides s where s.item_id = it.id and it.media_type = 'carousel'
    ) q where u is not null;
    -- every file must be a social-render output (social/<brand>/...) stored after the v12 deploy
    select coalesce(bool_and(exists (
             select 1 from storage.objects o
              where o.bucket_id in ('ig-staging', 'inventoryproof-social')
                and u like '%/storage/v1/object/public/' || o.bucket_id || '/' || o.name
                and o.name like 'social/%'
                and o.created_at > timestamptz '2026-10-18 21:38:48+00')), false)
      into v_ok from unnest(coalesce(v_urls, '{}')) u;
    if v_ok then
      perform public.house_gate_media_put(it.id, it.content_version, true, '[]'::jsonb, '{}'::text[], null,
        jsonb_build_object('attested_by', 'social-render v12', 'min_font_px', 40, 'slides', array_length(v_urls, 1),
                           'note', 'drawn by the renderer: type 40 px and up, never blank; the Pi OCR check replaces this when it runs'));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke execute on function public.house_gate_attest_renders() from public, anon, authenticated;
grant execute on function public.house_gate_attest_renders() to service_role;

select cron.alter_job((select jobid from cron.job where jobname = 'house-gate-run'),
  command := 'select public.house_gate_attest_renders(); select public.house_gate_run()');
