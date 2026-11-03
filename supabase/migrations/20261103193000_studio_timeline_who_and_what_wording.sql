-- Studio timeline wording: every step says WHO did it and WHAT it applied to (script / recording / video / carousel).
-- Jared, Nov 2 2026 call with Eli ("signed off" was ambiguous). Labels come from SQL; the front end renders "<b>who</b> what".
-- Applied live as migrations studio_timeline_who_and_what_wording + studio_timeline_received_wording (Nov 3 2026).
-- UNDO: restore the old studio_trail(text,text,uuid) from bestly_memory area studio,
--       key build/timeline-signoff-wording-2026-11-03-orig/studio_trail (full original definition). New helper functions can stay.

create or replace function public.item_event_words_v2(p_kind text, p jsonb, p_noun text, p_client text)
 returns text language sql immutable
 set search_path to 'public','extensions','pg_temp'
as $fn$
  select case p_kind
    when 'internal_decision' then case p->>'decision'
        when 'approved' then 'signed off on the ' || p_noun
        when 'killed'   then 'killed the ' || p_noun
        when 'changes'  then 'asked for changes to the ' || p_noun
        when 'pending'  then 'took back their sign-off on the ' || p_noun
        else 'marked the ' || p_noun || ' as ' || coalesce(p->>'decision', '?') end
        || coalesce(' — ' || public.origin_clip(p->>'note', 4000), '')
    when 'promoted'   then 'sent the ' || p_noun || ' to ' || p_client || '''s board for her to approve'
    when 'unpromoted' then 'pulled the ' || p_noun || ' back from ' || p_client || '''s board' || coalesce(' — ' || public.origin_clip(p->>'why', 4000), '')
    when 'client_decision' then case p->>'decision' when 'approved' then 'approved the ' || p_noun
        when 'changes' then 'asked for changes to the ' || p_noun
        else 'answered on the ' || p_noun || ': ' || coalesce(p->>'decision','') end
    when 'client_read' then 'opened the ' || p_noun
    when 'edited'   then 'edited the ' || p_noun || coalesce(' — ' || public.origin_clip(p->>'what', 4000), '')
    when 'note'     then 'left a note on the ' || p_noun || ': ' || coalesce(public.origin_clip(p->>'note', 4000), '')
    when 'note_reply' then 'replied to a note on the ' || p_noun || ': ' || coalesce(public.origin_clip(p->>'note', 4000), '')
    when 'note_edited'  then 'edited a note on the ' || p_noun
    when 'note_deleted' then 'deleted a note on the ' || p_noun
    when 'work_started' then 'started ' || coalesce(p->>'work', 'work') || ' on the ' || p_noun || coalesce(' (' || (p->>'note') || ')', '')
    when 'work_done'    then 'finished ' || coalesce(p->>'work', 'work') || ' on the ' || p_noun || coalesce(' — ' || (p->>'status'), '')
    when 'needs_render' then 'asked for a re-cut of the ' || p_noun || coalesce(' — ' || public.origin_clip(p->>'why', 4000), '')
    when 'render_cleared' then 'cleared the re-cut flag on the ' || p_noun
    when 'regen_requested' then case when (p->>'on')::boolean is false then 'turned off the new-version request for the ' || p_noun
                                     else 'asked for a new version of the ' || p_noun end
    when 'regen_done'   then 'made a new version of the ' || p_noun
    when 'gate_blocked' then 'held the ' || p_noun || ' back because of the house rules' || coalesce(' — ' || public.origin_clip(p->>'why', 4000), '')
    when 'generated'    then 'generated the ' || p_noun || coalesce(' — ' || public.origin_clip(p->>'what', 4000), '')
    when 'scheduled'    then 'scheduled the ' || p_noun || ' to post'
    when 'calendar_slot' then 'picked a posting time for the ' || p_noun
    when 'calendar_withdrawn' then 'took the ' || p_noun || ' off the calendar' || coalesce(' — ' || (p->>'why'), '')
    when 'moved'  then 'moved the ' || p_noun || coalesce(' to ' || (p->>'to'), '')
    when 'move_override' then 'moved the ' || p_noun || ' anyway' || coalesce(' — ' || public.origin_clip(p->>'why', 4000), '')
    when 'reply_to_client' then 'replied to ' || p_client || ' about the ' || p_noun
    when 'version_restored' then 'restored version ' || coalesce(p->>'to_version', '?') || ' of the ' || p_noun
    when 'killed' then 'killed the ' || p_noun
    else lower(replace(p_kind, '_', ' ')) || ' on the ' || p_noun end
$fn$;

create or replace function public.studio_ask_events(p_ask uuid, p_cname text, p_detail boolean default true)
 returns jsonb language plpgsql stable security definer
 set search_path to 'public'
as $fn$
declare x public.client_asks; o jsonb; n text; ev jsonb;
begin
  select * into x from public.client_asks where id = p_ask;
  if x.id is null then return '[]'::jsonb; end if;
  o := public.origin_ask(p_ask);
  n := case x.kind when 'comment' then 'comment' else 'script' end;
  select coalesce(jsonb_agg(e order by e->>'at', (e->>'o')::int), '[]'::jsonb) into ev from (
    select jsonb_build_object('at', x.created_at, 'o', 1, 'who', coalesce(o->>'made_by', 'Unknown'), 'who_kind', o->>'made_by_kind',
             'what', case when o->>'made_by_kind' = 'client' then 'sent in the idea for a ' || n else 'wrote the ' || n end,
             'detail', case when p_detail and o->>'made_by_kind' = 'client' then coalesce(public.origin_clip(x.source->>'ref', 4000), public.origin_clip(x.source->>'note', 4000)) end,
             'kind', 'created') e
    union all
    select jsonb_build_object('at', r.created_at, 'o', 2, 'who', coalesce(public.staff_display(r.staff_id), 'Staff'), 'who_kind', 'staff',
             'what', case when r.upload_id is not null then
                        case r.decision when 'approved' then 'signed off on the recording ' || p_cname || ' filmed'
                          when 'rerecord' then 'asked ' || p_cname || ' to film it again'
                          when 'killed' then 'killed the recording ' || p_cname || ' filmed'
                          else 'left a note on the recording ' || p_cname || ' filmed' end
                      else
                        case r.decision when 'approved' then 'signed off on the ' || n
                          when 'changes' then 'asked for changes to the ' || n
                          when 'killed' then 'killed the ' || n
                          when 'pending' then 'took back their sign-off on the ' || n
                          else 'left a note on the ' || n end
                      end || coalesce(' — ' || public.origin_clip(r.note, 4000), ''),
             'kind', 'review')
      from public.client_ask_reviews r where r.ask_id = p_ask
    union all select jsonb_build_object('at', x.sent_at, 'o', 3, 'who', 'Studio', 'who_kind', 'staff',
             'what', case x.kind when 'comment' then 'sent the comment to ' || p_cname || '''s board' else 'sent the script to ' || p_cname || '''s board to film' end, 'kind', 'sent')
      where x.sent_at is not null
    union all select jsonb_build_object('at', x.received_at, 'o', 4, 'who', p_cname, 'who_kind', 'client',
             'what', case x.kind when 'comment' then 'sent in her reply to the comment' else 'filmed the script and sent in the recording' end, 'kind', 'received')
      where x.received_at is not null
    union all select jsonb_build_object('at', x.comment_final_sent_at, 'o', 5, 'who', 'Studio', 'who_kind', 'staff',
             'what', 'sent the final comment to ' || p_cname, 'kind', 'comment')
      where x.comment_final_sent_at is not null
    union all select jsonb_build_object('at', coalesce((x.source->>'closed_at')::timestamptz, x.created_at), 'o', 6, 'who', coalesce(x.source->>'closed_by', 'Studio'), 'who_kind', 'staff',
             'what', 'closed the ' || n || coalesce(' — ' || (x.source->>'closed_why'), ''), 'kind', 'closed')
      where x.status = 'closed'
  ) q;
  return ev;
end $fn$;

create or replace function public.studio_trail(p_token text, p_kind text, p_id uuid)
 returns jsonb language plpgsql security definer
 set search_path to 'public'
as $function$
declare s public.studio_caller; v_client uuid; v_cname text; o jsonb; chain jsonb := '[]'; ev jsonb := '[]';
        x public.client_asks; t public.client_todos; b public.client_briefs; v_ask uuid; v_listing public.re_listings;
        v_noun text := 'post';
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if p_kind = 'item' then
    select client_id into v_client from approval_items where id = p_id;
  elsif p_kind = 'ask' then
    select client_id into v_client from client_asks where id = p_id;
  elsif p_kind = 'todo' then
    select client_id into v_client from client_todos where id = p_id;
  elsif p_kind = 'brief' then
    select client_id into v_client from client_briefs where id = p_id;
  else return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  if v_client is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  if not public.staff_may_see(s.id, v_client) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select coalesce(nullif(split_part(contact_name, ' ', 1), ''), name) into v_cname from approval_clients where id = v_client;

  if p_kind = 'item' then
    o := public.origin_item(p_id);
    select case media_type when 'video' then 'video' when 'carousel' then 'carousel' when 'image' then 'image' else 'post' end into v_noun from approval_items where id = p_id;
    v_ask := nullif(o->'ask'->>'id', '')::uuid;
    if v_ask is not null then chain := chain || jsonb_build_array(public.origin_ask(v_ask) || jsonb_build_object('title', (select title from client_asks where id = v_ask))); end if;
    select l.* into v_listing from re_listings l join approval_items i on i.external_ref = l.job_ref where i.id = p_id limit 1;
    if v_listing.id is not null then
      chain := chain || jsonb_build_array(jsonb_build_object('kind', 'email', 'title', v_listing.subject, 'made_by', public.mail_addr(v_listing.sender),
        'via', 'Email to ' || coalesce(v_listing.intake_address, 'studio@'), 'at', v_listing.received_at,
        'source', public.origin_clip(regexp_replace(coalesce(v_listing.raw_body, ''), '\s+', ' ', 'g'), 200),
        'note', case when v_listing.rerouted is not null then 'Not a listing — moved by the intake guard (' || (v_listing.rerouted->>'why') || ')' end));
    end if;
    select coalesce(jsonb_agg(e order by e->>'at', (e->>'o')::int), '[]') into ev from (
      select jsonb_build_object('at', e.at, 'o', case e.kind when 'internal_decision' then 10 when 'promoted' then 11 else 12 end,
               'who', case when e.actor_kind = 'client' then v_cname
                           else coalesce(public.staff_display(e.staff_id), e.payload->>'by', case when e.actor_kind in ('system','agent') then 'Spark' end, 'System') end,
               'who_kind', e.actor_kind, 'what', public.item_event_words_v2(e.kind, e.payload, v_noun, v_cname), 'kind', e.kind) e
        from approval_item_events e
       where e.item_id = p_id
         and not (e.kind = 'client_read' and exists (select 1 from approval_item_events f where f.item_id = e.item_id and f.kind = 'client_read' and f.at < e.at))
      union all
      select jsonb_build_object('at', r.created_at, 'o', 12,
               'who', case when r.reviewer_kind = 'client' then v_cname else coalesce(public.staff_display(r.staff_id), 'Staff') end,
               'who_kind', r.reviewer_kind,
               'what', case when r.reviewer_kind = 'client' then 'left a note on the ' || v_noun || ': ' else 'replied to ' || v_cname || ' about the ' || v_noun || ': ' end || public.origin_clip(r.note, 4000),
               'kind', 'review')
        from approval_reviews r
       where r.item_id = p_id and r.note is not null and btrim(r.note) <> ''
         and (r.reviewer_kind = 'client' or r.to_client)
      union all
      select jsonb_build_object('at', coalesce(sp.posted_at, sp.in_drafts_at, sp.created_at), 'o', 12,
               'who', 'Spark', 'who_kind', 'system',
               'what', case sp.status when 'posted' then 'posted the ' || v_noun || ' to ' || initcap(sp.platform)
                         when 'in_drafts' then 'sent the ' || v_noun || ' to ' || v_cname || '''s ' || initcap(sp.platform) || ' drafts'
                         when 'queued' then 'queued the ' || v_noun || ' to post on ' || initcap(sp.platform)
                         when 'failed' then 'could not post the ' || v_noun || ' to ' || initcap(sp.platform) || ' — ' || coalesce(public.origin_clip(sp.error, 4000), 'no reason given')
                         else 'marked the ' || v_noun || ' ' || sp.status || ' on ' || initcap(sp.platform) end, 'kind', 'social')
        from social_posts sp where sp.approval_item_id = p_id
      union all
      select x2 from jsonb_array_elements(case when v_ask is not null then public.studio_ask_events(v_ask, v_cname, false) else '[]'::jsonb end) x2
    ) q(e);

  elsif p_kind = 'ask' then
    select * into x from client_asks where id = p_id;
    o := public.origin_ask(p_id);
    if x.item_id is not null then
      chain := chain || jsonb_build_array(public.origin_item(x.item_id) || jsonb_build_object('title', (select title from approval_items where id = x.item_id)));
    end if;
    if x.source ? 'listing_id' then
      select * into v_listing from re_listings where id = (x.source->>'listing_id')::uuid;
      if v_listing.id is not null then
        chain := chain || jsonb_build_array(jsonb_build_object('kind', 'email', 'title', v_listing.subject, 'made_by', v_cname,
          'via', 'Email to studio@', 'at', v_listing.received_at,
          'source', public.origin_clip(regexp_replace(coalesce(v_listing.raw_body, ''), '\s+', ' ', 'g'), 200),
          'note', 'The listing robot grabbed it first; Spark moved it here.'));
      end if;
    end if;
    ev := public.studio_ask_events(p_id, v_cname, true);

  elsif p_kind = 'todo' then
    select * into t from client_todos where id = p_id;
    o := public.origin_todo(p_id);
    ev := jsonb_build_array(jsonb_build_object('at', t.created_at, 'who', coalesce(o->>'made_by', 'Unknown'), 'what', 'put the to-do on ' || v_cname || '''s list', 'kind', 'created'));
    if t.done_at is not null then
      ev := ev || jsonb_build_array(jsonb_build_object('at', t.done_at, 'who', coalesce(t.done_by, v_cname), 'what', 'marked the to-do done', 'kind', 'done'));
    end if;

  else
    select * into b from client_briefs where id = p_id;
    o := public.origin_brief(p_id);
    ev := jsonb_build_array(jsonb_build_object('at', b.received_at, 'who', o->>'made_by', 'who_kind', 'client', 'what', 'sent in the idea', 'detail', public.origin_clip(b.body, 4000), 'kind', 'created'));
    if b.used_at is not null then
      ev := ev || jsonb_build_array(jsonb_build_object('at', b.used_at, 'who', 'Studio', 'what',
              case when b.used_ask is not null then 'turned the idea into an ask' when b.used_item is not null then 'used the idea in a post' else coalesce('marked the idea ' || b.status, 'used the idea') end, 'kind', 'used'));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'id', p_id, 'origin', o, 'chain', chain, 'events', ev);
end $function$;
