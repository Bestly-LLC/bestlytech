-- Claims Closer, part 2: Link Sender claims-only mode (turo_sender_claim / turo_sender_done).
-- The Mac mini turo_sender.py is unchanged: turo_sender_claim also hands out claim_drafts Jared approved, even while
-- guest-link sending (turo_sender_settings.enabled) is off; turo_sender_done marks them sent and starts the 24h follow-up clock.
-- Kept separate because it replaces two live sender functions; applied only after Jared OK'd it.

create or replace function public.turo_sender_claim(p_token text, p_version text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare out jsonb; claims jsonb := '[]'::jsonb; s turo_sender_settings;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update turo_sender_settings set seen_at = now(), version = coalesce(p_version, version), updated_at = now() where id = 1
    returning * into s;
  perform turo_link_enqueue();   -- guest links: only when sending is on (enabled)
  update turo_link_msgs set status = 'failed', last_error = 'sender stopped mid-send; check the Turo thread', updated_at = now()
    where status = 'sending' and claimed_at < now() - interval '5 minutes';
  with c as (
    update turo_link_msgs m set status = 'sending', claimed_at = now(), attempts = attempts + 1, updated_at = now()
    where m.reservation_id in (select reservation_id from turo_link_msgs where status = 'queued'
                                 or (status = 'failed' and attempts < 3 and updated_at < now() - interval '10 minutes' and coalesce(last_error,'') not like 'sender stopped%')
                               order by queued_at limit 3)
    returning m.reservation_id, m.body, m.token)
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into out from c;

  -- Claims Closer: messages Jared approved. Never double-send: a send that stopped midway is failed, not retried.
  update claim_drafts set status = 'failed', last_error = 'sender stopped mid-send; check the Turo thread', updated_at = now()
    where status = 'sending' and claimed_at < now() - interval '5 minutes';
  if coalesce(s.claims_enabled, true) then
    with d as (
      update claim_drafts d set status = 'sending', claimed_at = now(), attempts = attempts + 1, updated_at = now()
      where d.id in (select x.id from claim_drafts x
                      where x.kind <> 'escalation'
                        and (x.status = 'approved'
                             or (x.status = 'failed' and x.attempts < 3 and x.updated_at < now() - interval '10 minutes' and coalesce(x.last_error,'') not like 'sender stopped%'))
                        and not exists (select 1 from turo_link_msgs m where m.reservation_id = x.reservation_id and m.status = 'sending')
                        and x.reservation_id not in (select (j->>'reservation_id')::bigint from jsonb_array_elements(out) j)
                      order by x.approved_at limit 2)
      returning d.reservation_id, d.body, coalesce(d.verify_snippet, '') as token)
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into claims from d;
  end if;
  return out || claims;
end $$;

create or replace function public.turo_sender_done(p_token text, p_res bigint, p_ok boolean, p_error text default null, p_verified boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
declare d claim_drafts;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update claim_drafts set status = case when p_ok then 'sent' else 'failed' end, sent_at = case when p_ok then now() else sent_at end,
    verified = case when p_ok then p_verified else verified end, last_error = case when p_ok then null else left(p_error, 300) end, updated_at = now()
  where id = (select id from claim_drafts where reservation_id = p_res and status = 'sending' order by claimed_at limit 1)
  returning * into d;
  if d.id is not null then
    if p_ok then
      update claim_cases set last_host_msg_at = now(), follow_up_at = claims_daytime(now() + interval '24 hours'),
        status = case when status = 'open' then 'waiting_guest' else status end, updated_at = now() where id = d.case_id;
      insert into claim_events (case_id, reservation_id, kind, title, detail)
        values (d.case_id, p_res, 'sent', 'Sent to guest', jsonb_build_object('draft_id', d.id, 'verified', p_verified, 'body', left(d.body, 600)));
    else
      insert into claim_events (case_id, reservation_id, kind, title, detail)
        values (d.case_id, p_res, 'send_failed', 'Send failed', jsonb_build_object('draft_id', d.id, 'error', left(p_error, 300)));
      if d.attempts >= 3 then
        perform claims_notify('Could not send a message', coalesce(left(p_error, 200), 'Turo send failed 3 times') || '. Check Turo is signed in on the Mac mini.',
          'warning', 'claims-sendfail-' || d.id);
      end if;
    end if;
    return;
  end if;
  update turo_link_msgs set status = case when p_ok then 'sent' else 'failed' end, sent_at = case when p_ok then now() else sent_at end,
    verified_at = case when p_verified then now() else verified_at end, last_error = case when p_ok then null else left(p_error, 300) end, updated_at = now()
  where reservation_id = p_res;
  if p_ok then
    insert into lax_guest_events (reservation_id, kind, detail) values (p_res, 'link_sent', jsonb_build_object('verified', p_verified));
  end if;
end $$;

