-- ops:identity-lint flagged two client doors that write without asking who is really there:
-- studio_media_fault and client_thumb_broken. When staff open a client's board ("view as client"),
-- the token resolves to the client, so the fault / repair was logged as hers.
--
-- These two are reports about broken media, not the client's own words, so we do not refuse them
-- (that would stop staff from flagging a broken thumb while previewing). Instead, a viewer session is
-- recorded as staff: who = 'staff-view:<staff id>' / thumb_repairs.source = 'staff_view'.

create or replace function public.studio_media_fault(p_token text, p_item uuid, p_url text, p_code text, p_ua text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  s public.studio_caller; c public.approval_caller; v_who text; v_title text; v_slug text; v_key text; v_new boolean;
  v_viewer uuid;
  v_today text := to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD');
  v_url text := left(coalesce(p_url, ''), 600);
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is not null then v_who := 'staff:' || coalesce(s.slug, s.name);
  else
    c := public.approval_resolve_client(p_token);
    if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    -- staff viewing as the client: log it as staff, never as her
    v_viewer := public.client_viewer(p_token);
    if v_viewer is not null then v_who := 'staff-view:' || v_viewer::text;
    else v_who := 'client:' || c.id::text;
    end if;
  end if;
  if v_url = '' then return jsonb_build_object('ok', false, 'error', 'no_url'); end if;
  -- the table cannot be flooded: one row per person per file per 30 minutes
  if not exists (select 1 from studio_media_faults where who = v_who and url = v_url and at > now() - interval '30 minutes') then
    insert into studio_media_faults (who, item, url, code, ua) values (v_who, p_item, v_url, left(p_code, 60), left(p_ua, 300));
  end if;
  if p_item is not null then
    select coalesce(i.title, 'a post'), cl.slug into v_title, v_slug
      from approval_items i left join approval_clients cl on cl.id = i.client_id where i.id = p_item;
  end if;
  v_key := 'studio.media.' || coalesce(p_item::text, md5(v_url)) || '.' || v_today;
  v_new := not exists (select 1 from monitor_issues where key = v_key);
  if v_new then
    perform bestly_raise(v_key, 'problem', 'info',
      'A video will not play' || coalesce(': ' || left(v_title, 60), ''),
      'The browser could not play ' || coalesce(nullif(v_title, ''), 'a video') || coalesce(' (' || v_slug || ')', '') || ' in Studio (' || coalesce(nullif(left(p_code, 60), ''), 'no code') || '). It was retried once and the person was shown a Retry button and a link to the file. File: ' || v_url,
      'studio', null, true);
  end if;
  return jsonb_build_object('ok', true, 'raised', v_new);
end $function$;

create or replace function public.client_thumb_broken(p_token text, p_item uuid, p_url text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_act jsonb; v_cid uuid; v_ok boolean; v_new int := 0; v_source text := 'client';
begin
  v_act := public.client_actor(p_token);
  v_cid := (public.approval_resolve_client(p_token)).id;
  -- staff viewing as the client: the repair still queues, but it is filed as ours
  if public.client_viewer(p_token) is not null then v_source := 'staff_view'; end if;
  if v_cid is null and v_act is not null and v_act->>'role' = 'member' then v_cid := (v_act->>'client_id')::uuid; end if;
  if v_cid is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_url is null or length(p_url) > 800 or p_url !~ '^https://' then return jsonb_build_object('ok', false, 'error', 'bad_url'); end if;
  select exists (select 1 from public.approval_items it where it.id = p_item and it.client_id = v_cid
                  and (it.thumb_url = p_url or it.media_url = p_url
                       or exists (select 1 from public.approval_slides s where s.item_id = it.id and s.media_url = p_url)
                       )
                ) into v_ok;
  -- unknown url for this item (or a stale snapshot url): still accept as a report on the item's own thumb
  if not v_ok then
    if not exists (select 1 from public.approval_items it where it.id = p_item and it.client_id = v_cid) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;
  if (select count(*) from public.thumb_repairs where status in ('open','needs_poster')) > 300 then
    return jsonb_build_object('ok', true, 'queued', false);
  end if;
  insert into public.thumb_repairs (item_id, client_id, bad_url, source) values (p_item, v_cid, p_url, v_source)
  on conflict (item_id, bad_url) where status in ('open','needs_poster') do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then perform public.invoke_edge_function('studio-heal', '{"action":"thumb_repair"}'::jsonb, 20000); end if;
  return jsonb_build_object('ok', true, 'queued', true);
end $function$;

-- close the two lint flags; the next ops_identity_audit run resolves ops:identity-lint
update public.client_activity_flags
   set action = 'cleared',
       reason = reason || ' — FIXED 2026-10-15: viewer sessions are now logged as staff.'
 where kind = 'lint' and key in ('lint:studio_media_fault', 'lint:client_thumb_broken') and action = 'flagged';
