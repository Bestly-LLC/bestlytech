-- Studio: review her takes before anything gets made.
-- Plan: docs/studio-take-review-opusplan.md (Jared, 2026-10-15).
--
-- A take she records lands as review_state 'waiting'. Staff either approve it (it then shows up in
-- studio_takes_for_edit(), the ONLY queue the AI editor / recut kit may read) or send it back with a
-- note (the same ask reopens as status 'redo' and the note reaches her board + daily digest).
-- Uploads that already existed are 'legacy' and behave exactly as before (Q10).
--
-- Deviation from the plan, on purpose: the plan says add 'approved'/'rerecord' to a decision check.
-- There is no decision check on client_ask_reviews, but studio_ask_signoff counts decision='approved'
-- rows toward the ask's SCRIPT sign-off, so a take review must not look like one. Take reviews carry
-- upload_id; studio_ask_signoff now ignores any review with an upload_id.

-- ---------------------------------------------------------------- schema
alter table public.client_uploads
  add column if not exists review_state text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.approval_staff(id),
  add column if not exists take_no int,
  add column if not exists edit_claimed_at timestamptz,
  add column if not exists edit_claimed_by text,
  add column if not exists edit_done_at timestamptz,
  add column if not exists edit_render_id uuid;

alter table public.client_uploads drop constraint if exists client_uploads_review_state_ck;
alter table public.client_uploads add constraint client_uploads_review_state_ck
  check (review_state is null or review_state in ('waiting','approved','sent_back','legacy'));

-- Q10: everything that exists today is legacy; numbered by the order she recorded it.
update public.client_uploads u
   set review_state = 'legacy', take_no = n.rn
  from (select id, row_number() over (partition by ask_id order by created_at, id) rn
          from public.client_uploads where purpose = 'ask') n
 where u.id = n.id and u.review_state is null;

create index if not exists client_uploads_review_idx
  on public.client_uploads (review_state) where review_state in ('waiting','approved');

alter table public.client_asks drop constraint if exists client_asks_status_ck;
alter table public.client_asks add constraint client_asks_status_ck
  check (status = any (array['draft','open','received','attached','closed','redo']));

alter table public.client_ask_reviews
  add column if not exists to_client boolean not null default false,
  add column if not exists upload_id uuid references public.client_uploads(id) on delete set null;

insert into public.notify_kinds (kind, what)
values ('client_redo', 'A take was sent back to a client with a note (held for her daily digest, shown at the top of her board)')
on conflict (kind) do nothing;

-- ---------------------------------------------------------------- her recording lands as "waiting"
create or replace function public.client_upload_done(p_token text, p_upload uuid, p_duration numeric default null, p_parts integer default 1)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare c public.approval_caller; u public.client_uploads%rowtype;
        v_size bigint; v_n int; v_title text; v_take int;
begin
  c := public.approval_resolve_client(p_token);
  if public.client_viewer(p_token) is not null then return jsonb_build_object('ok', false, 'error', 'view_only', 'message', 'You are viewing as the client. Nothing here is saved as them.'); end if;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into u from public.client_uploads where id = p_upload and client_id = c.id;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if u.status <> 'pending' then return jsonb_build_object('ok', true, 'already', u.status, 'purpose', u.purpose); end if;

  if coalesce(p_parts, 1) <= 1 then
    select (o.metadata->>'size')::bigint into v_size
      from storage.objects o where o.bucket_id = u.bucket and o.name = u.path;
    v_n := case when v_size is null then 0 else 1 end;
  else
    select count(*), sum((o.metadata->>'size')::bigint) into v_n, v_size
      from storage.objects o
     where o.bucket_id = u.bucket
       and o.name ~ ('^' || regexp_replace(u.path, '([.+?^${}()|\[\]\\])', '\\\1', 'g') || '\.part[0-9]+$');
  end if;
  if v_n = 0 or v_n <> greatest(coalesce(p_parts, 1), 1) then
    return jsonb_build_object('ok', false, 'error', 'object_missing', 'found', v_n, 'expected', p_parts);
  end if;

  -- a client take now waits for a person: take number + review_state are set in the SAME update as
  -- status, so the notify trigger already sees them.
  if u.purpose = 'ask' then
    select coalesce(max(x.take_no), 0) + 1 into v_take from public.client_uploads x where x.ask_id = u.ask_id and x.id <> u.id;
  end if;

  update public.client_uploads
     set status = case when u.purpose = 'brand_guide' then 'stored' else 'ready' end,
         ready_at = now(), bytes = v_size, parts = greatest(coalesce(p_parts, 1), 1),
         duration_s = coalesce(p_duration, duration_s),
         review_state = case when u.purpose = 'ask' then 'waiting' else review_state end,
         take_no = case when u.purpose = 'ask' then v_take else take_no end
   where id = u.id;

  if u.purpose = 'brand_guide' then
    insert into public.brand_guide_answers (client_id, question_key, upload_id, answered_at)
    values (c.id, u.question_key, u.id, now())
    on conflict (client_id, question_key) do update set upload_id = excluded.upload_id, answered_at = now();
    return jsonb_build_object('ok', true, 'purpose', 'brand_guide',
                              'question', u.question_key, 'client', c.name,
                              'bytes', v_size, 'duration_s', p_duration);
  end if;

  if u.purpose = 'research' then
    return jsonb_build_object('ok', true, 'purpose', 'research', 'client', c.name, 'mime', u.mime,
                              'bytes', v_size, 'duration_s', p_duration);
  end if;

  -- open OR redo -> received; received_at is stamped fresh
  update public.client_asks set status = 'received', received_at = now()
   where id = u.ask_id and status in ('open', 'redo') returning title into v_title;
  if v_title is null then select title into v_title from public.client_asks where id = u.ask_id; end if;
  return jsonb_build_object('ok', true, 'purpose', 'ask', 'ask_title', v_title, 'client', c.name,
                            'bytes', v_size, 'parts', v_n, 'duration_s', p_duration, 'take_no', v_take);
end $fn$;

-- she may record again on a reopened ask
create or replace function public.client_upload_begin(p_token text, p_ask uuid, p_bytes bigint, p_mime text, p_purpose text default 'ask', p_question_key text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare c public.approval_caller; a public.client_asks%rowtype;
        v_id uuid; v_ext text; v_path text; v_purpose text;
begin
  c := public.approval_resolve_client(p_token);
  if public.client_viewer(p_token) is not null then return jsonb_build_object('ok', false, 'error', 'view_only', 'message', 'You are viewing as the client. Nothing here is saved as them.'); end if;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_purpose := coalesce(p_purpose, 'ask');

  if v_purpose = 'ask' then
    select * into a from public.client_asks where id = p_ask and client_id = c.id;
    if a.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if a.status not in ('open','received','redo') then return jsonb_build_object('ok', false, 'error', 'ask_closed'); end if;
    if p_mime is null or p_mime not like 'video/%' then
      return jsonb_build_object('ok', false, 'error', 'not_video'); end if;
    -- up to 6 takes per ask (raised from 3 on 2026-10-06: Elizabeth wants several cuts/takes).
    -- Only takes that landed count; an abandoned pending row never blocks her.
    if (select count(*) from public.client_uploads u
         where u.ask_id = a.id and u.status not in ('pending','failed','removed')) >= 6 then
      return jsonb_build_object('ok', false, 'error', 'take_limit', 'max', 6); end if;
  elsif v_purpose = 'brand_guide' then
    if not exists (select 1 from public.brand_guide_questions where key = p_question_key and active) then
      return jsonb_build_object('ok', false, 'error', 'no_such_question'); end if;
    if p_mime is null or (p_mime not like 'audio/%' and p_mime not like 'image/%') then
      return jsonb_build_object('ok', false, 'error', 'not_audio_or_image'); end if;
    if p_mime like 'image/%' and p_bytes > 52428800 then
      return jsonb_build_object('ok', false, 'error', 'too_large'); end if;
  elsif v_purpose = 'research' then
    -- what a paper, a screenshot or a saved article actually arrives as.
    if p_mime is null or not (p_mime like 'image/%' or p_mime like 'audio/%' or p_mime like 'video/%'
         or p_mime in ('application/pdf','text/plain','text/markdown','text/csv','text/rtf',
                       'application/rtf','application/msword','application/epub+zip',
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) then
      return jsonb_build_object('ok', false, 'error', 'not_a_document'); end if;
    if p_bytes > 104857600 then return jsonb_build_object('ok', false, 'error', 'too_large'); end if;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_purpose');
  end if;

  if p_bytes is null or p_bytes <= 0 or p_bytes > 2147483648 then
    return jsonb_build_object('ok', false, 'error', 'too_large'); end if;

  v_ext := case p_mime
             when 'video/quicktime' then 'mov' when 'video/webm' then 'webm'
             when 'audio/mp4' then 'm4a' when 'audio/mpeg' then 'mp3'
             when 'audio/webm' then 'weba' when 'audio/wav' then 'wav'
             when 'audio/aac' then 'aac'
             when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp'
             when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'image/gif' then 'gif'
             when 'image/svg+xml' then 'svg' when 'image/tiff' then 'tif'
             when 'image/bmp' then 'bmp'
             when 'application/pdf' then 'pdf' when 'text/plain' then 'txt'
             when 'text/markdown' then 'md' when 'text/csv' then 'csv'
             when 'text/rtf' then 'rtf' when 'application/rtf' then 'rtf'
             when 'application/msword' then 'doc' when 'application/epub+zip' then 'epub'
             when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
             when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 'pptx'
             when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
             else 'mp4' end;
  v_id := gen_random_uuid();
  v_path := c.slug || '/' ||
            case when v_purpose = 'ask' then a.id::text
                 when v_purpose = 'research' then 'research'
                 else 'guide/' || p_question_key end
            || '/' || v_id::text || '.' || v_ext;

  insert into public.client_uploads (id, ask_id, client_id, path, bytes, mime, purpose, question_key)
  values (v_id, case when v_purpose = 'ask' then a.id end, c.id, v_path, p_bytes, p_mime,
          v_purpose, case when v_purpose = 'brand_guide' then p_question_key end);
  return jsonb_build_object('ok', true, 'upload_id', v_id, 'bucket', 'client-media', 'path', v_path);
end $fn$;

-- ---------------------------------------------------------------- the staff ping says it needs review
create or replace function public.trg_notify_upload()
 returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_client text; v_title text; v_q text;
begin
  if new.status in ('ready','stored') and coalesce(old.status,'') not in ('ready','stored') then
    if new.added_by is not null then return new; end if;
    if new.purpose = 'research' then return new; end if;
    select name into v_client from public.approval_clients where id = new.client_id;
    if new.purpose = 'ask' then
      select title into v_title from public.client_asks where id = new.ask_id;
      perform public.notify_staff('recording', 'email_recording',
        v_client || ' sent Take ' || coalesce(new.take_no, 1) || ' for "' || coalesce(v_title, 'an ask') || '"',
        'Review it in Studio › Asks, under "In from them". Approve it to send it to the editor, or send it back with a note. Nothing is cut until you approve.',
        'https://studio.bestly.tech/#asks/' || new.ask_id::text, jsonb_build_object('upload', new.id, 'ask', new.ask_id),
        null, true, interval '10 minutes');
    elsif new.purpose = 'brand_guide' then
      select prompt into v_q from public.brand_guide_questions where key = new.question_key;
      perform public.notify_staff('recording', 'email_recording',
        v_client || ' added to their brand guide',
        coalesce(v_q, 'A file') || ' — open Studio › Brand to see it.',
        'https://studio.bestly.tech/#brand', jsonb_build_object('upload', new.id, 'question', new.question_key),
        null, true, interval '30 minutes');
    end if;
  end if;
  return new;
end $fn$;

-- ---------------------------------------------------------------- approve
create or replace function public.studio_take_approve(p_token text, p_upload uuid)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare s public.studio_caller; u public.client_uploads%rowtype; a public.client_asks%rowtype;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into u from public.client_uploads where id = p_upload and purpose = 'ask' for update;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into a from public.client_asks where id = u.ask_id;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  if not public.staff_may_see(s.id, a.client_id) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;

  if u.review_state = 'approved' then return jsonb_build_object('ok', true, 'already', 'approved'); end if;
  if u.review_state = 'sent_back' then return jsonb_build_object('ok', false, 'error', 'sent_back', 'message', 'This take was already sent back.'); end if;
  if u.review_state is distinct from 'waiting' then
    return jsonb_build_object('ok', false, 'error', 'not_waiting', 'review_state', u.review_state); end if;
  if u.status <> 'transcoded' or u.transcoded_url is null then
    return jsonb_build_object('ok', false, 'error', 'not_transcoded', 'status', u.status); end if;

  update public.client_uploads set review_state = 'approved', reviewed_at = now(), reviewed_by = s.id where id = u.id;
  -- she sees nothing (Q8): the ask stays 'received'
  update public.client_asks set internal_status = 'approved' where id = a.id;
  insert into public.client_ask_reviews (ask_id, staff_id, decision, note, content_version, to_client, upload_id)
  values (a.id, s.id, 'approved', null, a.content_version, false, u.id);
  return jsonb_build_object('ok', true, 'upload_id', u.id, 'review_state', 'approved', 'take_no', u.take_no);
end $fn$;

-- ---------------------------------------------------------------- send back
create or replace function public.studio_take_send_back(p_token text, p_upload uuid, p_note text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare s public.studio_caller; u public.client_uploads%rowtype; a public.client_asks%rowtype;
        v_note text; v_slug text; v_tok text;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into u from public.client_uploads where id = p_upload and purpose = 'ask' for update;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into a from public.client_asks where id = u.ask_id;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  if not public.staff_may_see(s.id, a.client_id) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;

  if u.review_state = 'sent_back' then return jsonb_build_object('ok', true, 'already', 'sent_back'); end if;
  if u.review_state = 'approved' then
    return jsonb_build_object('ok', false, 'error', 'already_approved', 'message', 'This take is already approved.'); end if;
  if u.review_state is distinct from 'waiting' then
    return jsonb_build_object('ok', false, 'error', 'not_waiting', 'review_state', u.review_state); end if;
  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) < 3 then return jsonb_build_object('ok', false, 'error', 'note_required'); end if;
  if length(v_note) > 2000 then return jsonb_build_object('ok', false, 'error', 'note_too_long', 'max', 2000); end if;
  if u.status <> 'transcoded' or u.transcoded_url is null then
    return jsonb_build_object('ok', false, 'error', 'not_transcoded', 'status', u.status); end if;

  update public.client_uploads set review_state = 'sent_back', reviewed_at = now(), reviewed_by = s.id where id = u.id;
  update public.client_asks set status = 'redo'
   where id = a.id and status in ('open', 'received', 'redo');
  insert into public.client_ask_reviews (ask_id, staff_id, decision, note, content_version, to_client, upload_id)
  values (a.id, s.id, 'rerecord', v_note, a.content_version, true, u.id);

  -- held for her daily digest (no instant email, Q6); kept while the ask is 'redo'
  select slug, access_token into v_slug, v_tok from public.approval_clients where id = a.client_id;
  perform public.notify_client('client_redo', a.client_id,
    'Record again: ' || coalesce(a.title, 'your recording'), v_note,
    'https://studio.bestly.tech/' || v_slug || '?c=' || v_tok,
    'client_redo-' || u.id::text, jsonb_build_object('ask', a.id, 'upload', u.id));
  return jsonb_build_object('ok', true, 'upload_id', u.id, 'review_state', 'sent_back', 'take_no', u.take_no);
end $fn$;

-- ---------------------------------------------------------------- the editor's ONLY queue
create or replace function public.studio_takes_for_edit()
 returns jsonb language sql security definer stable set search_path to 'public' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
      'upload_id', u.id, 'ask_id', u.ask_id, 'client_id', u.client_id, 'client_slug', c.slug,
      'ask_title', a.title, 'script', a.script, 'take_no', u.take_no,
      'transcoded_url', u.transcoded_url, 'poster_url', u.poster_url, 'duration_s', u.duration_s,
      'path', u.path, 'bucket', u.bucket, 'parts', u.parts,
      'approved_at', u.reviewed_at, 'edit_claimed_at', u.edit_claimed_at) order by u.reviewed_at), '[]'::jsonb)
    from public.client_uploads u
    join public.client_asks a on a.id = u.ask_id
    join public.approval_clients c on c.id = u.client_id
   where u.purpose = 'ask' and u.review_state = 'approved'
     and u.status = 'transcoded'
     and u.edit_done_at is null
     and (u.edit_claimed_at is null or u.edit_claimed_at < now() - interval '3 hours');
$fn$;

create or replace function public.studio_take_edit_claim(p_upload uuid, p_worker text default 'recut-kit')
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare n int;
begin
  update public.client_uploads set edit_claimed_at = now(), edit_claimed_by = left(coalesce(p_worker, 'recut-kit'), 80)
   where id = p_upload and purpose = 'ask' and review_state = 'approved' and status = 'transcoded'
     and edit_done_at is null and (edit_claimed_at is null or edit_claimed_at < now() - interval '3 hours');
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1, 'claimed', n = 1);
end $fn$;

create or replace function public.studio_take_edit_done(p_upload uuid, p_render uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare n int;
begin
  update public.client_uploads set edit_done_at = now(), edit_render_id = p_render
   where id = p_upload and purpose = 'ask' and review_state = 'approved' and edit_done_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end $fn$;

-- ---------------------------------------------------------------- attach refuses an unreviewed take
create or replace function public.studio_ask_attach(p_token text, p_upload uuid, p_item uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare s public.studio_caller; u public.client_uploads%rowtype; a public.client_asks%rowtype; v_item uuid; v_target uuid;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into u from public.client_uploads where id = p_upload;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into a from public.client_asks where id = u.ask_id;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  if not public.staff_may_see(s.id, a.client_id) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if p_item is not null and not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  -- the gate: 'approved' and 'legacy' (and staff-added, null) pass; unreviewed or sent-back do not
  if u.review_state in ('waiting', 'sent_back') then
    return jsonb_build_object('ok', false, 'error', 'not_approved', 'review_state', u.review_state); end if;
  if u.status <> 'transcoded' or u.transcoded_url is null then
    return jsonb_build_object('ok', false, 'error', 'not_transcoded', 'status', u.status); end if;
  v_target := coalesce(p_item, a.item_id);
  if v_target is null then
    insert into public.approval_items (client_id, title, caption, media_url, media_type, platform, status, stage,
                                       internal_status, position, provenance)
    values (a.client_id, a.title, coalesce(a.brief, ''), u.transcoded_url, 'video', 'instagram', 'pending', 'internal',
            'pending', coalesce((select max(position) from public.approval_items where client_id = a.client_id), 0) + 1,
            jsonb_build_object('ask_id', a.id, 'upload_id', u.id, 'recorded_by', 'client'))
    returning id into v_item;
  else
    update public.approval_items
       set media_url = u.transcoded_url, media_type = 'video',
           provenance = coalesce(provenance, '{}'::jsonb) || jsonb_build_object('ask_id', a.id, 'upload_id', u.id, 'recorded_by', 'client')
     where id = v_target and client_id = a.client_id returning id into v_item;
    if v_item is null then return jsonb_build_object('ok', false, 'error', 'item_not_found'); end if;
  end if;
  update public.client_uploads set status = 'attached' where id = u.id;
  update public.client_asks set status = 'attached', item_id = v_item where id = a.id;
  insert into public.approval_item_events (item_id, kind, actor_kind, staff_id, payload)
  values (v_item, 'edited', 'staff', s.id, jsonb_build_object('attached_upload', u.id, 'ask', a.id));
  return jsonb_build_object('ok', true, 'item_id', v_item);
end $fn$;

-- ---------------------------------------------------------------- script sign-off ignores take reviews
create or replace function public.studio_ask_signoff(p_ask uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare a public.client_asks%rowtype; v_req uuid[]; v_people jsonb; v_have int; v_of int; v_state text;
begin
  select * into a from public.client_asks where id = p_ask;
  if a.id is null then return null; end if;
  select coalesce(ac.approvers, '{}') into v_req from public.approval_clients ac where ac.id = a.client_id;

  if v_req is null or array_length(v_req, 1) is null then
    return jsonb_build_object('dual', false, 'of', 1,
      'have', case when a.internal_status = 'approved' then 1 else 0 end,
      'state', coalesce(a.internal_status, 'pending'), 'version', a.content_version, 'people', '[]'::jsonb);
  end if;

  select jsonb_agg(x order by x->>'name'), count(*) filter (where x->>'decision' = 'approved')
    into v_people, v_have
  from (
    select jsonb_build_object(
             'staff_id', s.id, 'name', s.name, 'slug', s.slug,
             'decision', r.decision, 'at', r.created_at, 'note', r.note,
             'lapsed_decision', lr.decision, 'lapsed_version', lr.content_version) as x
      from public.approval_staff s
      left join lateral (
        select r2.decision, r2.created_at, r2.note from public.client_ask_reviews r2
         where r2.ask_id = p_ask and r2.staff_id = s.id and r2.decision is not null
           and r2.upload_id is null
           and r2.content_version = a.content_version
         order by r2.created_at desc limit 1) r on true
      left join lateral (
        select r3.decision, r3.content_version from public.client_ask_reviews r3
         where r3.ask_id = p_ask and r3.staff_id = s.id and r3.decision is not null
           and r3.upload_id is null
           and r3.content_version < a.content_version
         order by r3.created_at desc limit 1) lr on true
     where s.id = any(v_req)
  ) q;

  v_of := array_length(v_req, 1);
  v_have := coalesce(v_have, 0);

  if exists (select 1 from jsonb_array_elements(coalesce(v_people,'[]'::jsonb)) e where e->>'decision' = 'killed')
    then v_state := 'killed';
  elsif exists (select 1 from jsonb_array_elements(coalesce(v_people,'[]'::jsonb)) e where e->>'decision' = 'changes')
    then v_state := 'changes';
  elsif v_have >= v_of then v_state := 'approved';
  else v_state := 'pending';
  end if;

  return jsonb_build_object('dual', true, 'of', v_of, 'have', v_have,
    'state', v_state, 'version', a.content_version, 'people', coalesce(v_people, '[]'::jsonb));
end $fn$;

-- ---------------------------------------------------------------- her board
create or replace function public.client_asks_board(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare c public.approval_caller; v_gate boolean;
begin
  c := public.approval_resolve_client(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select guide_only into v_gate from public.approval_clients where id = c.id;
  return jsonb_build_object('ok', true, 'client', jsonb_build_object('slug', c.slug, 'name', c.name),
    'guide_only', coalesce(v_gate, false),
    'asks', case when coalesce(v_gate, false) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'title', a.title, 'brief', a.brief, 'script', a.script, 'tips', a.tips,
        'kind', a.kind, 'clip_url', a.clip_url, 'clip_note', a.clip_note,
        'reference', case when a.reference is not null then jsonb_build_object(
            'url', a.reference->>'url', 'what_we_see', a.reference->>'what_we_see', 'credit', a.reference->>'credit',
            'media_url', a.reference->>'media_url', 'poster_url', a.reference->>'poster_url',
            'part_start', a.reference->'part_start', 'part_end', a.reference->'part_end', 'part_label', a.reference->>'part_label') end,
        'filming', a.filming - 'storyboard',
        'hook_opening', a.hook_opening, 'hook_example_url', a.hook_example_url, 'licence', a.licence,
        'comment_draft', a.comment_draft, 'comment_draft_at', a.comment_draft_at,
        'comment_final', case when a.comment_final_sent_at is not null then a.comment_final end,
        'target_seconds', a.target_seconds, 'due', a.due, 'status', a.status,
        'created_at', a.created_at, 'received_at', a.received_at,
        'item_id', case when i.stage = 'client' then i.id end,
        'uploads', coalesce((select jsonb_agg(jsonb_build_object(
                       'id', u.id, 'status', u.status, 'bytes', u.bytes, 'created_at', u.created_at)
                       order by u.created_at desc)
                     from public.client_uploads u where u.ask_id = a.id and u.status <> 'pending'), '[]'::jsonb),
        -- a sent-back ask: ONLY the note we chose to send her (to_client), her last take, nothing staff-only
        'redo', case when a.status = 'redo' then (
            select jsonb_build_object('note', r.note, 'at', r.created_at, 'take_no', ru.take_no,
                     'last_take', jsonb_build_object('url', ru.transcoded_url, 'poster', ru.poster_url, 'duration_s', ru.duration_s))
              from public.client_ask_reviews r
              left join public.client_uploads ru on ru.id = r.upload_id
             where r.ask_id = a.id and r.to_client and r.decision = 'rerecord'
             order by r.created_at desc limit 1) end,
        'takes', (select count(*) from public.client_uploads tu
                   where tu.ask_id = a.id and tu.purpose = 'ask' and tu.status not in ('pending','failed','removed'))
      ) order by (a.status = 'redo') desc, (a.status = 'open') desc, a.due nulls last, a.created_at desc)
      from public.client_asks a left join public.approval_items i on i.id = a.item_id
     where a.client_id = c.id and a.status not in ('closed','draft')), '[]'::jsonb) end);
end $fn$;

-- ---------------------------------------------------------------- staff side
create or replace function public.studio_asks(p_token text, p_client_slug text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare s public.studio_caller; v_client uuid;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.staff_may_see_slug(s.id, p_client_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select id into v_client from public.approval_clients where slug = p_client_slug;
  if v_client is null then return jsonb_build_object('ok', false, 'error', 'no_client'); end if;
  return jsonb_build_object('ok', true, 'asks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'brief', a.brief, 'script', a.script, 'tips', a.tips,
      'kind', a.kind, 'clip_url', a.clip_url, 'clip_note', a.clip_note,
      'reference', a.reference, 'filming', a.filming, 'hook_style', a.hook_style, 'deck_tie', a.deck_tie,
      'hook_style_source', a.hook_style_source, 'hook_opening', a.hook_opening, 'hook_example_url', a.hook_example_url,
      'licence', a.licence, 'comment_draft', a.comment_draft, 'comment_draft_at', a.comment_draft_at,
      'comment_final', a.comment_final, 'comment_final_sent_at', a.comment_final_sent_at,
      'missing', case when a.status = 'draft' then to_jsonb(public.ask_readiness(a)) end,
      'internal_status', a.internal_status, 'content_version', a.content_version,
      'regen_requested_at', a.regen_requested_at,
      'signoff', case when a.status in ('draft', 'open', 'received') then public.studio_ask_signoff(a.id) end,
      -- the review thread: every round. to_client marks the notes that actually went to her.
      'reviews', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'kind', 'staff', 'decision', r.decision, 'note', r.note,
          'parent_id', r.parent_id, 'content_version', r.content_version,
          'staff_id', r.staff_id, 'who', st.name, 'slug', st.slug,
          'to_client', r.to_client, 'upload_id', r.upload_id,
          'created_at', r.created_at) order by r.created_at)
        from public.client_ask_reviews r left join public.approval_staff st on st.id = r.staff_id
        where r.ask_id = a.id), '[]'::jsonb),
      'target_seconds', a.target_seconds, 'due', a.due, 'status', a.status, 'item_id', a.item_id,
      'item_title', i.title, 'item_stage', i.stage,
      'created_at', a.created_at, 'sent_at', a.sent_at, 'received_at', a.received_at,
      'created_by', (select name from public.approval_staff where id = a.created_by),
      'source', a.source,
      'uploads', coalesce((select jsonb_agg(jsonb_build_object(
          'id', u.id, 'status', u.status, 'bytes', u.bytes, 'mime', u.mime, 'path', u.path, 'parts', u.parts,
          'duration_s', u.duration_s, 'transcoded_url', u.transcoded_url, 'poster_url', u.poster_url,
          'error', u.error, 'created_at', u.created_at, 'ready_at', u.ready_at,
          'review_state', u.review_state, 'take_no', u.take_no, 'reviewed_at', u.reviewed_at,
          'reviewed_by', (select rs.name from public.approval_staff rs where rs.id = u.reviewed_by),
          'edit_claimed_at', u.edit_claimed_at, 'edit_done_at', u.edit_done_at)
          order by u.created_at desc)
        from public.client_uploads u where u.ask_id = a.id and u.status <> 'pending'), '[]'::jsonb)
    ) order by (a.status in ('draft','open','received','redo')) desc, a.created_at desc)
    from public.client_asks a left join public.approval_items i on i.id = a.item_id
    where a.client_id = v_client), '[]'::jsonb));
end $fn$;

create or replace function public.studio_seen_counts(p_token text, p_client_slug text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare s studio_caller; v_client uuid; q int; a int; b int; m int; t int;
begin
  s := studio_resolve_staff(p_token);
  if s.id is null then raise exception 'not_found'; end if;
  select id into v_client from approval_clients where slug = p_client_slug;
  select count(*) into q from approval_items i
   where i.client_id = v_client and i.posted_at is null and coalesce(i.internal_status, 'pending') <> 'killed'
     and public.staff_may_see_item(s.id, i.id)
     and coalesce((select x.stamp from studio_seen x where x.staff_id = s.id and x.kind = 'item' and x.ref_id = i.id), '') <> i.content_version::text;
  select count(*) into a from client_asks k
   where k.client_id = v_client and k.status in ('draft', 'open', 'received', 'redo')
     and coalesce((select x.stamp from studio_seen x where x.staff_id = s.id and x.kind = 'ask' and x.ref_id = k.id), '')
         <> k.content_version::text || '.' || (select count(*) from client_uploads u where u.ask_id = k.id and u.status <> 'pending')::text;
  select count(*) into b from client_briefs r
   where r.client_id = v_client and r.status = 'new'
     and not exists (select 1 from studio_seen x where x.staff_id = s.id and x.kind = 'idea' and x.ref_id = r.id);
  select count(*) into m from studio_mail ml
   where ml.status = 'new' and (ml.client_slug is null or ml.client_slug = p_client_slug)
     and not exists (select 1 from studio_seen x where x.staff_id = s.id and x.kind = 'mail' and x.ref_id = ml.id);
  select count(*) into t from client_uploads u
   where u.client_id = v_client and u.purpose = 'ask' and u.review_state = 'waiting' and u.status in ('ready','transcoded');
  return jsonb_build_object('ok', true, 'queue', q, 'asks', a + b, 'inbox', m, 'takes_waiting', t);
end $fn$;

-- ---------------------------------------------------------------- digest: "Record again" task block
create or replace function public.studio_digest_compose_client(p_client uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  c public.approval_clients; r record; v_link text;
  n_posts int := 0; ask_titles text[] := '{}'; ask_ids uuid[] := '{}'; todo_titles text[] := '{}';
  n_asks int; n_todos int; n_redo int := 0; redo_ids uuid[] := '{}'; v_wait int; ids uuid[] := '{}'; keep_ids uuid[] := '{}';
  n_receipt int := 0; v_receipt text; has_new boolean := false; tasks jsonb := '[]'; v_intro text; v_subject text; v_line text;
  rd record;
begin
  select * into c from public.approval_clients where id = p_client and active;
  if c.id is null or coalesce(c.sandbox, false) or not coalesce(c.notify_email, false) or nullif(c.contact_email, '') is null then
    return jsonb_build_object('send', false, 'why', 'no email for this client', 'ids',
      coalesce((select to_jsonb(array_agg(o.id)) from public.notify_outbox o
                 where o.audience = 'client' and o.sent_at is null and o.hold_until = 'infinity'::timestamptz
                   and public.studio_digest_row_client(o) = p_client), '[]'::jsonb));
  end if;
  v_link := coalesce(public.client_board_link(c.id), 'https://studio.bestly.tech/' || c.slug);

  select count(*) into n_posts from public.approval_items where client_id = c.id and stage = 'client' and status = 'pending';
  select coalesce(array_agg(coalesce(nullif(trim(a.title), ''), 'A recording') order by a.created_at), '{}'), coalesce(array_agg(a.id), '{}')
    into ask_titles, ask_ids from public.client_asks a where a.client_id = c.id and a.status = 'open';
  select coalesce(array_agg(a.id), '{}') into redo_ids from public.client_asks a where a.client_id = c.id and a.status = 'redo';
  select coalesce(array_agg(t.title order by t.position, t.created_at), '{}')
    into todo_titles from public.client_todos t where t.client_id = c.id and t.status = 'open';
  n_asks := coalesce(array_length(ask_titles, 1), 0);
  n_redo := coalesce(array_length(redo_ids, 1), 0);
  n_todos := coalesce(array_length(todo_titles, 1), 0);
  v_wait := n_posts + n_asks + n_redo + n_todos;

  for r in
    select o.id, o.kind, o.body, o.payload, o.created_at
      from public.notify_outbox o
     where o.audience = 'client' and o.sent_at is null and o.hold_until = 'infinity'::timestamptz
       and o.kind not in ('staff_digest', 'client_digest') and public.studio_digest_row_client(o) = c.id
     order by o.created_at
  loop
    ids := ids || r.id;
    if r.kind = 'ask_received' then
      if r.created_at > now() - interval '3 days' then
        n_receipt := n_receipt + 1; v_receipt := r.body; keep_ids := keep_ids || r.id;
      end if;
    elsif r.kind = 'client_posts' and n_posts > 0 then has_new := true;
    elsif r.kind = 'client_ask' and (public.studio_try_uuid(r.payload->>'ask') = any(ask_ids)) then has_new := true;
    elsif r.kind = 'client_redo' and (public.studio_try_uuid(r.payload->>'ask') = any(redo_ids)) then has_new := true;
    end if;
  end loop;
  if n_receipt > 0 then has_new := true; end if;

  if v_wait = 0 then
    return jsonb_build_object('send', false, 'why', 'nothing is waiting on her', 'ids', to_jsonb(ids),
      'keep_ids', to_jsonb(keep_ids), 'waiting', 0);
  end if;

  -- sent-back takes first: one block each, our note as the body, one button to her board
  for rd in
    select a.id, coalesce(nullif(trim(a.title), ''), 'your recording') as title,
           (select r.note from public.client_ask_reviews r
             where r.ask_id = a.id and r.to_client and r.decision = 'rerecord'
             order by r.created_at desc limit 1) as note
      from public.client_asks a where a.id = any(redo_ids) order by a.received_at nulls last, a.created_at limit 3
  loop
    tasks := tasks || jsonb_build_object(
      'title', 'Record again: ' || rd.title,
      'line', coalesce(left(rd.note, 600), 'Open your board to see what we would like you to change.'),
      'href', v_link, 'label', 'Record again');
  end loop;

  if n_posts > 0 then
    tasks := tasks || jsonb_build_object(
      'title', case when n_posts = 1 then '1 post is waiting for you' else n_posts || ' posts are waiting for you' end,
      'line', 'Say yes, or ask for a change. It takes about a minute.',
      'href', v_link, 'label', case when n_posts = 1 then 'Look at my post' else 'Look at my posts' end);
  end if;
  if n_asks > 0 then
    v_line := (select string_agg(chr(8220) || t || chr(8221), ', ') from unnest(ask_titles[1:3]) t)
              || case when n_asks > 3 then ', and ' || (n_asks - 3) || ' more' else '' end;
    tasks := tasks || jsonb_build_object(
      'title', case when n_asks = 1 then '1 recording is waiting for you' else n_asks || ' recordings are waiting for you' end,
      'line', v_line, 'href', v_link, 'label', 'Record it now');
  end if;
  if n_todos > 0 then
    v_line := (select string_agg(chr(8220) || t || chr(8221), ', ') from unnest(todo_titles[1:3]) t)
              || case when n_todos > 3 then ', and ' || (n_todos - 3) || ' more' else '' end;
    tasks := tasks || jsonb_build_object(
      'title', case when n_todos = 1 then '1 thing on your list' else n_todos || ' things on your list' end,
      'line', v_line, 'href', v_link, 'label', 'See my list');
  end if;

  v_intro := case
    when n_receipt = 1 then coalesce(nullif(trim(v_receipt), ''), 'We got your idea.') || ' Here is what is waiting for you.'
    when n_receipt > 1 then 'We got your ideas. We will turn them into things you can film, and they will show up on your board. Here is what is waiting for you.'
    else 'Here is what is waiting for you.' end;
  v_subject := case when v_wait = 1 then 'One thing is waiting for you' else v_wait || ' things are waiting for you' end;

  return jsonb_build_object('send', true, 'ids', to_jsonb(ids), 'keep_ids', '[]'::jsonb, 'to', c.contact_email,
    'who', c.name, 'subject', v_subject, 'body', v_intro, 'link', v_link, 'waiting', v_wait, 'has_new', has_new,
    'payload', jsonb_build_object('digest', true, 'client', c.id, 'tasks', tasks,
      'note', 'You get one short email a day, and only when something is waiting on you. Reply to this email if you would rather not get it.'));
end $fn$;

-- ---------------------------------------------------------------- outbox: drop a stale client_redo
create or replace function public.notify_outbox_take(p_limit integer default 20)
 returns setof public.notify_outbox language plpgsql security definer set search_path to 'public' as $fn$
declare g record; v_n int; v_body text; v_clients text;
begin
  -- 1. anything the person has already dealt with in the app is noise
  update public.notify_outbox o
     set sent_at = now(), error = 'seen in the app'
   where o.sent_at is null and o.staff_id is not null and o.kind <> 'decision'
     and o.hold_until is distinct from 'infinity'
     and exists (select 1 from public.staff_sessions s
                  where s.staff_id = o.staff_id and s.last_seen_at > o.created_at);

  -- 2. client nudges for asks that have since been answered
  update public.notify_outbox o
     set sent_at = now(), error = 'already handled'
   where o.sent_at is null and o.kind = 'client_ask'
     and exists (select 1 from public.client_asks a
                  where a.id = (o.payload->>'ask')::uuid and a.status not in ('open','received'));

  -- 2b. a "record again" note is kept only while that ask is still waiting on her re-record
  update public.notify_outbox o
     set sent_at = now(), error = 'already handled'
   where o.sent_at is null and o.kind = 'client_redo'
     and not exists (select 1 from public.client_asks a
                      where a.id = public.studio_try_uuid(o.payload->>'ask') and a.status = 'redo');

  -- 3. decisions that are due fold into one email per producer: the first row
  --    carries the whole list, the rest are marked folded
  for g in select dedupe, staff_id, min(id::text) as keep, count(*) as n
             from public.notify_outbox
            where sent_at is null and kind = 'decision' and dedupe like 'digest:%'
              and hold_until <= now()
            group by dedupe, staff_id having count(*) > 0
  loop
    select string_agg(body, E'\n' order by created_at), string_agg(distinct payload->>'client', ', ')
      into v_body, v_clients
      from public.notify_outbox where sent_at is null and dedupe = g.dedupe and staff_id = g.staff_id;
    update public.notify_outbox
       set subject = case when g.n = 1 then v_clients || ' decided on a post' else g.n || ' decisions from ' || v_clients end,
           body = v_body || E'\n\nEverything is in the queue.'
     where id::text = g.keep;
    update public.notify_outbox set sent_at = now(), error = 'folded into digest'
     where sent_at is null and dedupe = g.dedupe and staff_id = g.staff_id and id::text <> g.keep;
  end loop;

  return query
    update public.notify_outbox o set attempts = attempts + 1
     where o.id in (select id from public.notify_outbox
                     where sent_at is null and to_email is not null and attempts < 5
                       and (hold_until is null or hold_until <= now())
                     order by created_at limit p_limit for update skip locked)
    returning o.*;
end $fn$;

-- ---------------------------------------------------------------- grants
revoke all on function public.studio_takes_for_edit() from public, anon, authenticated;
revoke all on function public.studio_take_edit_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.studio_take_edit_done(uuid, uuid) from public, anon, authenticated;
grant execute on function public.studio_takes_for_edit() to service_role;
grant execute on function public.studio_take_edit_claim(uuid, text) to service_role;
grant execute on function public.studio_take_edit_done(uuid, uuid) to service_role;

revoke all on function public.studio_take_approve(text, uuid) from public;
revoke all on function public.studio_take_send_back(text, uuid, text) from public;
grant execute on function public.studio_take_approve(text, uuid) to anon, authenticated, service_role;
grant execute on function public.studio_take_send_back(text, uuid, text) to anon, authenticated, service_role;

-- staff doors called from Studio with the publishable key + a staff token (own token check inside)
insert into public.security_public_rpcs (fn, why) values
  ('studio_take_approve', 'Studio (token-bound, staff session + can_promote checked inside): approve a client take for the AI editor.'),
  ('studio_take_send_back', 'Studio (token-bound, staff session + can_promote checked inside): send a client take back with a note.')
on conflict (fn) do nothing;
