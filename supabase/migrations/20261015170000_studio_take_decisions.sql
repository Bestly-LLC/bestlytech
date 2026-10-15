-- Studio > Asks: the same "Your call" on a take that the Queue has on a post (Jared, 2026-10-15).
-- Her earlier takes are all review_state 'legacy' (most already attached to a post), so Approve was
-- greyed out. Now studio_take_approve works for waiting, legacy / null and already-approved (idempotent)
-- takes, status transcoded or attached. Approving an attached take records the decision only: the post
-- and the ask are not touched. An approved take is in studio_takes_for_edit() until edit_done_at is set
-- (attached ones included), so the editor queue and the new Production view agree.
-- studio_take_unapprove is the undo (only before the cut is claimed).
alter table public.client_uploads add column if not exists review_prev text;

create or replace function public.studio_take_approve(p_token text, p_upload uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if u.review_state = 'approved' then
    return jsonb_build_object('ok', true, 'already', 'approved', 'upload_id', u.id, 'review_state', 'approved', 'take_no', u.take_no); end if;
  if u.review_state = 'sent_back' then
    return jsonb_build_object('ok', false, 'error', 'sent_back', 'message', 'This take was already sent back.'); end if;
  if u.status not in ('transcoded', 'attached') then
    return jsonb_build_object('ok', false, 'error', 'not_transcoded', 'status', u.status); end if;
  if u.status = 'transcoded' and u.transcoded_url is null then
    return jsonb_build_object('ok', false, 'error', 'not_transcoded', 'status', u.status); end if;

  update public.client_uploads
     set review_prev = u.review_state, review_state = 'approved', reviewed_at = now(), reviewed_by = s.id
   where id = u.id;
  -- a take that was waiting also moves the ask's own state (as before); a legacy / attached take leaves the ask and its post alone
  if u.review_state = 'waiting' then
    update public.client_asks set internal_status = 'approved' where id = a.id;
  end if;
  insert into public.client_ask_reviews (ask_id, staff_id, decision, note, content_version, to_client, upload_id)
  values (a.id, s.id, 'approved', null, a.content_version, false, u.id);
  return jsonb_build_object('ok', true, 'upload_id', u.id, 'review_state', 'approved', 'take_no', u.take_no);
end $function$;

create or replace function public.studio_take_unapprove(p_token text, p_upload uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s public.studio_caller; u public.client_uploads%rowtype; a public.client_asks%rowtype; v_back text;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into u from public.client_uploads where id = p_upload and purpose = 'ask' for update;
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into a from public.client_asks where id = u.ask_id;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  if not public.staff_may_see(s.id, a.client_id) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if u.review_state is distinct from 'approved' then
    return jsonb_build_object('ok', true, 'already', coalesce(u.review_state, 'none')); end if;
  if u.edit_done_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_cut', 'message', 'The cut is already made.'); end if;
  if u.edit_claimed_at is not null and u.edit_claimed_at > now() - interval '3 hours' then
    return jsonb_build_object('ok', false, 'error', 'being_cut', 'message', 'The editor has already picked this one up.'); end if;
  v_back := case when u.review_prev in ('waiting', 'legacy') then u.review_prev
                 when u.status = 'attached' then 'legacy' else 'waiting' end;
  update public.client_uploads
     set review_state = v_back, review_prev = null::text, reviewed_at = null::timestamptz, reviewed_by = null::uuid,
         edit_claimed_at = null::timestamptz, edit_claimed_by = null::text
   where id = u.id;
  -- the 'approved' line stays in client_ask_reviews as history; Studio shows it only while the take is approved
  return jsonb_build_object('ok', true, 'upload_id', u.id, 'review_state', v_back, 'take_no', u.take_no);
end $function$;

-- the editor queue: approved takes not cut yet, attached ones included (Jared: approve = it goes to production)
create or replace function public.studio_takes_for_edit()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
     and u.status in ('transcoded', 'attached')
     and u.edit_done_at is null
     and (u.edit_claimed_at is null or u.edit_claimed_at < now() - interval '3 hours');
$function$;

create or replace function public.studio_take_edit_claim(p_upload uuid, p_worker text DEFAULT 'recut-kit'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  update public.client_uploads set edit_claimed_at = now(), edit_claimed_by = left(coalesce(p_worker, 'recut-kit'), 80)
   where id = p_upload and purpose = 'ask' and review_state = 'approved' and status in ('transcoded', 'attached')
     and edit_done_at is null and (edit_claimed_at is null or edit_claimed_at < now() - interval '3 hours');
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1, 'claimed', n = 1);
end $function$;

-- grants + allowlist for the new staff RPC (same shape as studio_take_approve)
revoke all on function public.studio_take_unapprove(text, uuid) from public;
grant execute on function public.studio_take_unapprove(text, uuid) to anon, authenticated, service_role;
insert into public.security_public_rpcs (fn, why)
values ('studio_take_unapprove', 'Studio (token-bound, staff session + can_promote checked inside): undo an approved client take before the editor picks it up.')
on conflict (fn) do nothing;
