-- Claims Closer sends from the Pi (2026-10-05). Jared: "the bot has to do this directly".
-- The Mac mini Link Sender can't send (Chrome "Allow JavaScript from Apple Events" is off there), and the claims-only
-- change to turo_sender_claim never applied. So the Pi Turo reader (already signed in to Turo, always on) sends the
-- claim messages Jared approved, through its own two RPCs. The Mac Link Sender and guest-link sending are untouched.
--   claims_send_claim(token)  -> up to 2 approved drafts (never escalation notes); a send stuck 'sending' 5+ min fails
--                                and is NOT retried (it may have gone out; check the thread), so nothing double-sends.
--   claims_send_done(token, id, ok, error, verified) -> draft sent/failed, case clock, events, signed alert.
--   claims_draft_decide: approving now pokes the Pi (turo_reader_state.poke_at) so it sends within ~15 seconds.
-- Supersedes 20261005040100_claims_closer_sender_mode.sql, which was never applied.

create or replace function public.claims_send_claim(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare out jsonb;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update claim_drafts set status = 'failed', last_error = 'sender stopped mid-send; check the Turo thread', updated_at = now()
    where status = 'sending' and claimed_at < now() - interval '5 minutes';
  if not coalesce((select claims_enabled from turo_sender_settings where id = 1), true) then return '[]'::jsonb; end if;
  with d as (
    update claim_drafts d set status = 'sending', claimed_at = now(), attempts = attempts + 1, updated_at = now()
    where d.id in (select x.id from claim_drafts x
                    where x.kind <> 'escalation'
                      and (x.status = 'approved'
                           or (x.status = 'failed' and x.attempts < 3 and x.updated_at < now() - interval '10 minutes'
                               and coalesce(x.last_error, '') not like 'sender stopped%'))
                    order by x.approved_at limit 2)
    returning d.id, d.reservation_id, d.body, coalesce(d.verify_snippet, '') as snippet)
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into out from d;
  return out;
end $$;
revoke all on function public.claims_send_claim(text) from anon, authenticated, public;
grant execute on function public.claims_send_claim(text) to anon;   -- the Pi calls with the publishable key; the worker token is the gate

create or replace function public.claims_send_done(p_token text, p_id uuid, p_ok boolean, p_error text default null, p_verified boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
declare d claim_drafts; c claim_cases;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update claim_drafts set status = case when p_ok then 'sent' else 'failed' end, sent_at = case when p_ok then now() else sent_at end,
    verified = case when p_ok then p_verified else verified end, last_error = case when p_ok then null else left(p_error, 300) end, updated_at = now()
  where id = p_id and status = 'sending' returning * into d;
  if d.id is null then return; end if;
  select * into c from claim_cases where id = d.case_id;
  if p_ok then
    update claim_cases set last_host_msg_at = now(), follow_up_at = claims_daytime(now() + interval '24 hours'),
      status = case when status = 'open' then 'waiting_guest' else status end, updated_at = now() where id = d.case_id;
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (d.case_id, d.reservation_id, 'sent', 'Sent to ' || coalesce(c.guest_first, 'guest'), jsonb_build_object('draft_id', d.id, 'verified', p_verified, 'body', left(d.body, 600)));
    perform claims_notify('Sent your message to ' || coalesce(c.guest_first, 'the guest'),
      case when p_verified then 'It shows in the Turo thread. I''ll follow up in 24 hours if there''s no reply.'
           else 'Turo took it, but I couldn''t see it in the thread yet. Worth a glance.' end, 'info', 'claims-sent-' || d.id);
  else
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (d.case_id, d.reservation_id, 'send_failed', 'Send failed', jsonb_build_object('draft_id', d.id, 'error', left(p_error, 300)));
    if d.attempts >= 3 or coalesce(p_error, '') ~* 'signed out' then
      perform claims_notify('Could not send your message to ' || coalesce(c.guest_first, 'the guest'),
        coalesce(left(p_error, 200), 'Turo send failed') || '. The message is still on the Claims page.', 'warning', 'claims-sendfail-' || d.id || '-' || d.attempts);
    end if;
  end if;
end $$;
revoke all on function public.claims_send_done(text, uuid, boolean, text, boolean) from anon, authenticated, public;
grant execute on function public.claims_send_done(text, uuid, boolean, text, boolean) to anon;

-- approving pokes the Pi so it sends now instead of on its 2-minute read
create or replace function public.claims_draft_decide(p_id uuid, p_action text, p_body text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d claim_drafts; v_body text;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into d from claim_drafts where id = p_id for update;
  if d.id is null then raise exception 'draft not found'; end if;
  if d.status <> 'pending' then raise exception 'this draft is already %', d.status; end if;
  v_body := btrim(coalesce(nullif(btrim(p_body), ''), d.body));
  if p_action = 'approve' then
    if length(v_body) < 2 or length(v_body) > 2000 then raise exception 'message must be 2 to 2000 characters'; end if;
    update claim_drafts set body = v_body, status = case when kind = 'escalation' then 'done' else 'approved' end, approved_at = now(),
      verify_snippet = left(substring(regexp_replace(v_body, '\s+', ' ', 'g') from '^[A-Za-z0-9 ,.]{8,40}'), 40), updated_at = now()
      where id = p_id;
    update claim_drafts set status = 'superseded', updated_at = now() where case_id = d.case_id and status = 'pending' and id <> p_id;
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (d.case_id, d.reservation_id, 'approved', case when d.kind = 'escalation' then 'Escalation note marked done' else 'Jared approved a message' end,
              jsonb_build_object('draft_id', p_id, 'edited', v_body <> d.body));
    if d.kind <> 'escalation' then update turo_reader_state set poke_at = now() where id = 1; end if;
  elsif p_action = 'reject' then
    update claim_drafts set status = 'rejected', updated_at = now() where id = p_id;
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (d.case_id, d.reservation_id, 'rejected', 'Jared rejected a draft', jsonb_build_object('draft_id', p_id, 'note', left(p_body, 300)));
  else
    raise exception 'unknown action';
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claims_draft_decide(uuid, text, text) from anon, public;
grant execute on function public.claims_draft_decide(uuid, text, text) to authenticated;
