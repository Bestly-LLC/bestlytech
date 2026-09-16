-- Marketplace intake: the seller's "Submit" never saved.
-- Step5Review did `update seller_intakes set status = 'Submitted'` with the anon key, but the
-- "Anon update draft intake by token" policy has WITH CHECK status = 'Draft', so the update was
-- rejected (the client ignored the error and showed success). Every live intake stayed Draft.
--
-- This RPC does the one transition anon is allowed to make: Draft -> Submitted, bound to the
-- same session token the RLS policies use (sent by the client as the x-intake-token header and
-- read through public.current_intake_token()). It never returns row data.
create or replace function public.submit_intake(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text := public.current_intake_token();
  v_status text;
  v_requires boolean;
  v_session uuid;
  v_consent boolean;
begin
  if p_id is null or v_token = '' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select status, requires_session_token, session_token, consent_authorized
    into v_status, v_requires, v_session, v_consent
    from seller_intakes
   where id = p_id
   for update;

  -- Same answer for "no such row" and "wrong token", so the RPC can't be used to probe ids.
  if not found
     or v_requires is not true
     or v_session is null
     or v_session::text <> v_token then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_status = 'Submitted' then
    -- A retry after a dropped response: already done.
    return jsonb_build_object('ok', true, 'already_submitted', true);
  end if;

  if v_status <> 'Draft' then
    return jsonb_build_object('ok', false, 'reason', 'not_draft');
  end if;

  if v_consent is not true then
    return jsonb_build_object('ok', false, 'reason', 'consent_required');
  end if;

  update seller_intakes set status = 'Submitted' where id = p_id;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.submit_intake(uuid) from public;
grant execute on function public.submit_intake(uuid) to anon, authenticated;
