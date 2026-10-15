-- Studio: "Send back to her" works on any take, not only the ones waiting for review (Jared, 2026-10-15).
-- Her earlier takes are all review_state 'legacy' (most already attached to a post), so the old guard
-- ('waiting' only) hid the button and a note meant for her ended up in the internal notes.
-- Now: waiting / approved / legacy (or null) can be sent back; only 'sent_back' is refused (already sent).
-- Sending back an attached take does NOT touch the post: it only reopens the ask as 'redo' with the note
-- (client_ask_reviews.to_client = true) so it shows on her board and in her digest.
-- DB labels: every platform label already reads "YouTube" (connect_platform_help, client_connect_tile,
-- platform_specs, client_todos checked 2026-10-15); the lowercase "youtube" came from the apps, fixed there.
create or replace function public.studio_take_send_back(p_token text, p_upload uuid, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  if u.review_state = 'sent_back' then
    return jsonb_build_object('ok', false, 'error', 'already_sent_back', 'message', 'This take was already sent back.'); end if;
  if u.status in ('pending', 'failed', 'removed') then
    return jsonb_build_object('ok', false, 'error', 'not_transcoded', 'status', u.status); end if;
  if a.status in ('draft', 'closed') then
    return jsonb_build_object('ok', false, 'error', 'ask_not_active', 'message', 'This ask is closed.'); end if;
  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) < 3 then return jsonb_build_object('ok', false, 'error', 'note_required'); end if;
  if length(v_note) > 2000 then return jsonb_build_object('ok', false, 'error', 'note_too_long', 'max', 2000); end if;

  update public.client_uploads set review_state = 'sent_back', reviewed_at = now(), reviewed_by = s.id where id = u.id;
  -- the ask reopens whatever it was (open / received / attached); item_id and the post are left alone
  update public.client_asks set status = 'redo' where id = a.id;
  insert into public.client_ask_reviews (ask_id, staff_id, decision, note, content_version, to_client, upload_id)
  values (a.id, s.id, 'rerecord', v_note, a.content_version, true, u.id);

  select slug, access_token into v_slug, v_tok from public.approval_clients where id = a.client_id;
  perform public.notify_client('client_redo', a.client_id,
    'Record again: ' || coalesce(a.title, 'your recording'), v_note,
    'https://studio.bestly.tech/' || v_slug || '?c=' || v_tok,
    'client_redo-' || u.id::text, jsonb_build_object('ask', a.id, 'upload', u.id));
  return jsonb_build_object('ok', true, 'upload_id', u.id, 'review_state', 'sent_back', 'take_no', u.take_no);
end $function$;
