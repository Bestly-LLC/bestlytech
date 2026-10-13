-- Unique-content system, part 2: series + look-ledger functions and the filed trigger (tables: 20261013060000_studio_unique_content_tables.sql)
-- ---------------------------------------------------------------------------------------------------------------------------------------
-- series: take the next number for a video job (idempotent per job), plus the real "Next:" tease (the planned topic of the next number)
create or replace function public.studio_series_take(p_brand text, p_job uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s studio_series; t studio_series_topics; v_ep int; v_tease jsonb;
begin
  select * into s from studio_series where brand_slug = p_brand and active for update;
  if s.brand_slug is null then return null; end if;
  select * into t from studio_series_topics where brand_slug = p_brand and job_id = p_job;
  if t.id is null then
    v_ep := s.next_ep;
    update studio_series set next_ep = next_ep + 1, updated_at = now() where brand_slug = p_brand;
    insert into studio_series_topics (brand_slug, ep, status, job_id) values (p_brand, v_ep, 'made', p_job)
      on conflict (brand_slug, ep) do update set status = 'made', job_id = p_job;
  else
    v_ep := t.ep;
  end if;
  select jsonb_build_object('ep', x.ep, 'topic', x.topic) into v_tease
    from studio_series_topics x where x.brand_slug = p_brand and x.ep = v_ep + 1 and x.status = 'planned' and x.topic is not null;
  return jsonb_build_object('ep', v_ep, 'total', s.total, 'label', s.label, 'name', s.name, 'tease', v_tease,
    'planned_left', (select count(*) from studio_series_topics x where x.brand_slug = p_brand and x.status = 'planned' and x.topic is not null));
end $$;

-- a re-cut keeps its number: just report the series facts for a number already given
create or replace function public.studio_series_info(p_brand text, p_ep int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s studio_series; v_tease jsonb;
begin
  select * into s from studio_series where brand_slug = p_brand and active;
  if s.brand_slug is null then return null; end if;
  select jsonb_build_object('ep', x.ep, 'topic', x.topic) into v_tease
    from studio_series_topics x where x.brand_slug = p_brand and x.ep = p_ep + 1 and x.status = 'planned' and x.topic is not null;
  return jsonb_build_object('ep', p_ep, 'total', s.total, 'label', s.label, 'name', s.name, 'tease', v_tease,
    'planned_left', (select count(*) from studio_series_topics x where x.brand_slug = p_brand and x.status = 'planned' and x.topic is not null));
end $$;

create or replace function public.studio_series_topic_set(p_job uuid, p_topic text)
returns void language sql security definer set search_path to 'public' as $$
  update studio_series_topics set topic = left(p_topic, 80) where job_id = p_job and topic is null;
$$;

-- the next planned topic's brief, for a NEW video that should be that episode (Spark / the rotation calls this instead of inventing a brief)
create or replace function public.studio_series_next_brief(p_brand text)
returns jsonb language sql security definer set search_path to 'public' as $$
  select jsonb_build_object('ep', ep, 'topic', topic, 'brief', brief)
    from studio_series_topics x, studio_series s
   where x.brand_slug = p_brand and s.brand_slug = p_brand and x.status = 'planned' and x.topic is not null and x.ep >= s.next_ep
   order by x.ep limit 1;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- look ledger
create or replace function public.studio_look_record(p_job uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into studio_look_ledger (job_id, brand_slug, fingerprint, opening, hook, segment, ep, state)
  values (p_job, p->>'brand', coalesce(p->'fingerprint', '{}'::jsonb), left(p->>'opening', 400), p->>'hook', p->>'segment',
          nullif(p->>'ep', '')::int, coalesce(p->>'state', 'planned'))
  on conflict (job_id) do update set fingerprint = excluded.fingerprint, opening = excluded.opening, hook = excluded.hook,
    segment = excluded.segment, ep = excluded.ep, state = case when studio_look_ledger.state = 'filed' then 'filed' else excluded.state end;
end $$;

create or replace function public.studio_look_set(p_job uuid, p_key text, p_val text)
returns void language sql security definer set search_path to 'public' as $$
  update studio_look_ledger set fingerprint = jsonb_set(fingerprint, array[p_key], to_jsonb(p_val)) where job_id = p_job;
$$;

create or replace function public.studio_look_state(p_job uuid, p_state text)
returns void language sql security definer set search_path to 'public' as $$
  update studio_look_ledger set state = p_state where job_id = p_job and state <> 'filed';
$$;

-- a video job that finishes (filed in Studio) becomes the item's current look; earlier cuts of the same item stop counting
create or replace function public.trg_look_filed() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_code text;
begin
  if new.status = 'done' and new.item_id is not null and old.status is distinct from 'done' then
    select code into v_code from approval_items where id = new.item_id;
    update studio_look_ledger set state = 'filed', item_id = new.item_id, item_code = v_code, filed_at = now() where job_id = new.id;
    update studio_look_ledger set superseded = true where item_id = new.item_id and job_id <> new.id;
    update studio_series_topics set item_code = v_code where job_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_look_filed on public.studio_video_jobs;
create trigger trg_look_filed after update of status on public.studio_video_jobs for each row execute function public.trg_look_filed();

