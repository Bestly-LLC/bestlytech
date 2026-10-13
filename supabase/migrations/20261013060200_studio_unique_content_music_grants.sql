-- Unique-content system, part 3: music picker avoids the last two tracks, grants, Spark alert owners
-- ---------------------------------------------------------------------------------------------------------------------------------------
-- music picker: never one of the LAST TWO tracks used for the brand (only the last one when the brand can reach fewer than 3 tracks)
create or replace function public.montage_music_pick(p_brand text, p_mood text, p_job uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_recent uuid[]; v_n int; v_borrow boolean := false; r studio_music_tracks;
begin
  select count(*) into v_n from studio_music_tracks where active and (brand_slug = p_brand or brand_slug is null);
  if v_n = 0 then
    v_borrow := true;
    select count(*) into v_n from studio_music_tracks t
     where t.active and t.brand_slug in (select c.slug from approval_clients c where c.kind = 'house' and c.active and c.slug like 'bestly-%' and c.slug <> p_brand);
  end if;
  if v_n = 0 then return null; end if;
  select coalesce(array_agg(track_id), '{}') into v_recent
    from (select track_id from studio_music_uses where brand_slug = p_brand order by used_at desc limit case when v_n >= 3 then 2 else 1 end) x;
  select t.* into r from studio_music_tracks t
   where t.active
     and (case when v_borrow then t.brand_slug in (select c.slug from approval_clients c where c.kind = 'house' and c.active and c.slug like 'bestly-%' and c.slug <> p_brand)
               else (t.brand_slug = p_brand or t.brand_slug is null) end)
     and (v_n = 1 or not (t.id = any(v_recent)))
   order by (t.mood = p_mood) desc, (t.brand_slug = p_brand) desc,
            coalesce((select max(u.used_at) from studio_music_uses u where u.track_id = t.id and u.brand_slug = p_brand), 'epoch'::timestamptz) asc,
            random()
   limit 1;
  insert into studio_music_uses (track_id, brand_slug, job_id, mood) values (r.id, p_brand, p_job, p_mood);
  return to_jsonb(r);
end $$;

-- a brand's own track set can be borrowed for ONE test (Centering YOU has no tracks of its own); this lets the picker lend a warm bed
-- from the bestly-* brands to a brand that asks with allow_borrow, without changing anyone else's rules
create or replace function public.montage_music_borrow(p_brand text, p_mood text, p_job uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r studio_music_tracks;
begin
  select t.* into r from studio_music_tracks t
   where t.active and t.brand_slug like 'bestly-%' and t.brand_slug in (select c.slug from approval_clients c where c.kind = 'house' and c.active)
   order by (t.mood = p_mood) desc, coalesce((select max(u.used_at) from studio_music_uses u where u.track_id = t.id), 'epoch'::timestamptz) asc, random()
   limit 1;
  if r.id is null then return null; end if;
  insert into studio_music_uses (track_id, brand_slug, job_id, mood) values (r.id, p_brand, p_job, p_mood);
  return to_jsonb(r);
end $$;

revoke all on function public.studio_series_take(text, uuid), public.studio_series_info(text, int), public.studio_series_topic_set(uuid, text),
  public.studio_series_next_brief(text), public.studio_look_record(uuid, jsonb), public.studio_look_set(uuid, text, text),
  public.studio_look_state(uuid, text), public.montage_music_pick(text, text, uuid), public.montage_music_borrow(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.studio_series_take(text, uuid), public.studio_series_info(text, int), public.studio_series_topic_set(uuid, text),
  public.studio_series_next_brief(text), public.studio_look_record(uuid, jsonb), public.studio_look_set(uuid, text, text),
  public.studio_look_state(uuid, text), public.montage_music_pick(text, text, uuid), public.montage_music_borrow(text, text, uuid)
  to service_role;

-- Spark owns the new Montage alert prefixes (info, never a push)
insert into public.notification_owners (prefix, agent_slug, note) values
  ('montage.variety', 'spark', 'A video was held because it looked or opened too much like the brand''s recent videos after 2 re-rolls; info, no push. 2026-10-12'),
  ('montage.series', 'spark', 'A brand''s upcoming-topics queue is nearly empty (the Next: tease needs it), or a topic failed the claim rules; info, no push. 2026-10-12')
on conflict (prefix) do nothing;

