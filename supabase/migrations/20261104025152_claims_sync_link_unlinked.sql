-- Claims Closer: sync cases that have a Turo claim number but no incident id (2026-11-03)
--
-- Why: claims_sync_list only handed the Pi reader cases with turo_incident_id. A case opened from Turo claims mail
-- (Craig, reservation 62784054, claim 1110100, case be4e5d46) carries the claim number but never the incident id,
-- because Turo's mail only prints the claim number. So it was never read, synced_at stayed null, the Command Center
-- showed "Not synced with Turo" for 5 days, and every Sync tap poked a reader that was never handed the case.
--
-- Fix: claims_sync_list also returns open cases with no incident id (incident_id null). Turo reader 1.6.1 looks each
-- one up in Turo's own claims list (/api/claims/host: id = incident id, claimNumber, reservationId) and reports through
-- claims_sync_link, which links the case via claims_link_turo_ids (that pokes the reader, so it syncs right away) or
-- logs once every 6 hours that Turo's list does not show the claim yet, so the miss is never silent.
-- Reader 1.6.0 treats an unlinked case as a failed incident read and skips it, so this is safe before the Pi update.
--
-- Undo: re-run the claims_sync_list body from 20261006230100_claims_v2_fix_sync.sql (filter turo_incident_id is not null)
--       and drop function public.claims_sync_link(text, uuid, bigint, text, integer).

create or replace function public.claims_sync_list(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('case_id', c.id, 'reservation_id', c.reservation_id, 'incident_id', c.turo_incident_id,
      'claim_no', c.turo_claim_no, 'synced_at', c.synced_at,
      'known', coalesce((select jsonb_agg(e.uuid) from claim_evidence e where e.case_id = c.id), '[]'::jsonb)))
    from claim_cases c
   where not coalesce(c.history, false) and c.status not in ('paid', 'closed')
     and (c.turo_incident_id is not null or c.turo_claim_no is not null or c.reservation_id is not null)), '[]'::jsonb);
end $function$;

create or replace function public.claims_sync_link(p_token text, p_case uuid, p_incident bigint, p_claim_no text, p_listed integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c claim_cases; v jsonb; v_now bigint;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  select * into c from claim_cases where id = p_case;
  if c.id is null then return jsonb_build_object('ok', false); end if;
  if c.turo_incident_id is not null then
    return jsonb_build_object('ok', true, 'linked', false, 'already', c.turo_incident_id);
  end if;

  if p_incident is not null and p_incident > 0 then
    v := claims_link_turo_ids(p_case, coalesce(nullif(btrim(p_claim_no), ''), c.turo_claim_no), p_incident);
    select turo_incident_id into v_now from claim_cases where id = p_case;
    return jsonb_build_object('ok', true, 'linked', v_now = p_incident, 'set', v->'set');
  end if;

  -- Turo's list does not show it (yet): say so at most every 6 hours, so the case history and Scout see why.
  if not exists (select 1 from claim_events e
                  where e.case_id = p_case and e.kind = 'turo' and e.detail->>'unlinked' = 'true'
                    and e.at > now() - interval '6 hours') then
    insert into claim_events (case_id, reservation_id, kind, title, detail)
    values (p_case, c.reservation_id, 'turo',
            'Turo''s claims list does not show ' || coalesce('claim ' || c.turo_claim_no, 'this reservation') || ' yet',
            jsonb_build_object('unlinked', true, 'listed', p_listed, 'claim_no', c.turo_claim_no));
  end if;
  return jsonb_build_object('ok', true, 'linked', false, 'listed', p_listed);
end $function$;

revoke all on function public.claims_sync_link(text, uuid, bigint, text, integer) from public;
grant execute on function public.claims_sync_link(text, uuid, bigint, text, integer) to anon, authenticated, service_role;

insert into public.security_public_rpcs (fn, why)
values ('claims_sync_link', 'Pi Turo reader 1.6.1: links a claim case to its Turo incident from Turo''s claims list; worker token (tesla_worker_ok) checked inside')
on conflict do nothing;
