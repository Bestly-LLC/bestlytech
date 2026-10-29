-- Claims Closer return gate, last step: the Pi sender and the Turo invoice puller only take work the gate allows.
--   claims_send_claim: drafts only where claims_send_ok(case_id).
--   claims_turo_claim: actions only where kind <> 'create_invoice' or claims_send_ok(case_id).
-- The prior definitions are saved first to bestly_memory build/claims-closer-return-gate-2026-10-26-undo-send-turo-claim.
-- Grants are unchanged (create or replace keeps them).

insert into public.bestly_memory (area, key, title, body, kind, tags, source, pinned, active, written_by)
select 'ops',
       'build/claims-closer-return-gate-2026-10-26-undo-send-turo-claim',
       'UNDO: claims_send_claim / claims_turo_claim before the send-gate finish (2026-10-26)',
       'Exact pg_get_functiondef of both functions before adding the claims_send_ok(case_id) gate. To undo: run each CREATE OR REPLACE below.' || E'\n\n'
         || pg_get_functiondef('public.claims_send_claim(text)'::regprocedure) || E'\n\n-- ----\n\n'
         || pg_get_functiondef('public.claims_turo_claim(text)'::regprocedure),
       'runbook', array['claims-closer','undo','return-gate'], 'chat', false, true, 'claude'
where not exists (select 1 from public.bestly_memory
                  where key = 'build/claims-closer-return-gate-2026-10-26-undo-send-turo-claim');

create or replace function public.claims_send_claim(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
                      and claims_send_ok(x.case_id)
                      and (x.status = 'approved'
                           or (x.status = 'failed' and x.attempts < 3 and x.updated_at < now() - interval '10 minutes'
                               and coalesce(x.last_error, '') not like 'sender stopped%'))
                    order by x.approved_at limit 2)
    returning d.id, d.reservation_id, d.body, coalesce(d.verify_snippet, '') as snippet)
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into out from d;
  return out;
end $function$;

create or replace function public.claims_turo_claim(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare out jsonb;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  -- a send stuck 'sending' 10+ min fails and is NOT retried (it may have gone through); the watchdog tells Jared
  update claim_turo_actions set status = 'failed', error = 'reader stopped mid-action; check Turo before retrying', done_at = now()
    where status = 'sending' and claimed_at < now() - interval '10 minutes';
  with a as (
    update claim_turo_actions t set status = 'sending', claimed_at = now(), attempts = attempts + 1
    where t.id in (select x.id from claim_turo_actions x
                    where x.status = 'queued' and x.attempts < 2
                      and (x.kind <> 'create_invoice' or claims_send_ok(x.case_id))
                    order by x.created_at limit 1)
    returning t.id, t.kind, t.payload, t.case_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'payload', a.payload, 'case_id', a.case_id,
      'incident_id', c.turo_incident_id, 'reservation_id', c.reservation_id)), '[]'::jsonb) into out
    from a join claim_cases c on c.id = a.case_id;
  return out;
end $function$;
