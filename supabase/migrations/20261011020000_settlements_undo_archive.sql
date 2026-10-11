-- Settlements page v2 (Jared, 2026-10-10 6:20 PM): "give me an undo button, and archive", and richer cards.
-- 1. archived_at on claims + settlement_archive(): archiving hides a claim from every list except Archived; status is untouched.
-- 2. Audit trigger: every change to a claim's status/archive/answer/payment fields writes a 'change' event with before/after
--    snapshots and who did it. settlement_undo_last(claim) puts the claim back to the 'before' snapshot of its latest change,
--    only if nothing has moved since. settlement_recent_changes() feeds the page's Recent list.
-- 3. settlements_board() now also returns archived_at, fact_key, reasoning, paid_source, details and created_at.

alter table public.settlement_claims add column if not exists archived_at timestamptz;

create or replace function public.settlement_claim_snapshot(c public.settlement_claims) returns jsonb
language sql immutable as $$
  select jsonb_build_object('status', c.status, 'approved_at', c.approved_at, 'filed_at', c.filed_at, 'confirmation', c.confirmation,
    'paid_at', c.paid_at, 'paid_via', c.paid_via, 'paid_ref', c.paid_ref, 'amount_cents', c.amount_cents, 'answer', c.answer,
    'archived_at', c.archived_at, 'needs_you_url', c.needs_you_url, 'needs_you_why', c.needs_you_why, 'evidence', c.evidence);
$$;

create or replace function public.settlement_claims_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.status, old.archived_at, old.answer, old.amount_cents, old.confirmation, old.paid_at)
     is not distinct from (new.status, new.archived_at, new.answer, new.amount_cents, new.confirmation, new.paid_at) then
    return new;
  end if;
  insert into settlement_events (claim_id, kind, detail)
  values (new.id, 'change', jsonb_build_object(
    'before', settlement_claim_snapshot(old), 'after', settlement_claim_snapshot(new),
    'by', case when auth.uid() is not null then 'jared' else 'nickel' end,
    'undo', coalesce(current_setting('settlement.undo', true), '') = '1'));
  return new;
exception when others then
  return new; -- the audit log must never block a real change
end $$;

create or replace trigger settlement_claims_audit after update on public.settlement_claims
  for each row execute function public.settlement_claims_audit();

create or replace function public.settlement_archive(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  update settlement_claims set archived_at = case when p_on then now() else null end, updated_at = now() where id = p_id;
end $$;

-- Puts a claim back the way it was before its most recent change. Refuses if the claim has moved on since (a worker filed it, money
-- arrived), so an undo can never overwrite something newer.
create or replace function public.settlement_undo_last(p_claim uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e settlement_events; c settlement_claims; b jsonb;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select * into c from settlement_claims where id = p_claim for update;
  if not found then raise exception 'That claim no longer exists.'; end if;
  select * into e from settlement_events where claim_id = p_claim and kind = 'change' order by id desc limit 1;
  if not found then raise exception 'Nothing to undo on this claim.'; end if;
  if (e.detail->'after'->>'status') is distinct from c.status
     or (e.detail->'after'->>'archived_at') is distinct from (to_jsonb(c.archived_at)->>0) then
    raise exception 'This claim changed again since then, so it can''t be undone from here.';
  end if;
  if c.status in ('filing') then raise exception 'Nickel is filing this one right now. Try again in a few minutes.'; end if;
  b := e.detail->'before';
  perform set_config('settlement.undo', '1', true);
  update settlement_claims set
    status = b->>'status',
    approved_at = (b->>'approved_at')::timestamptz, filed_at = (b->>'filed_at')::timestamptz, confirmation = b->>'confirmation',
    paid_at = (b->>'paid_at')::timestamptz, paid_via = b->>'paid_via', paid_ref = b->>'paid_ref',
    amount_cents = (b->>'amount_cents')::int, answer = (b->>'answer')::boolean, archived_at = (b->>'archived_at')::timestamptz,
    needs_you_url = b->>'needs_you_url', needs_you_why = b->>'needs_you_why', evidence = coalesce(b->'evidence', evidence),
    updated_at = now()
  where id = p_claim;
  perform set_config('settlement.undo', '', true);
  return jsonb_build_object('status', b->>'status', 'was', e.detail->'after'->>'status');
end $$;

create or replace function public.settlement_recent_changes(p_limit integer default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select e.id, e.at, e.claim_id, s.name, e.detail->>'by' as by, (e.detail->>'undo')::boolean as is_undo,
           e.detail->'before'->>'status' as from_status, e.detail->'after'->>'status' as to_status,
           (e.detail->'before'->>'archived_at') is distinct from (e.detail->'after'->>'archived_at') as archive_change,
           (e.detail->'after'->>'archived_at') is not null as archived,
           (e.id = (select max(e2.id) from settlement_events e2 where e2.claim_id = e.claim_id and e2.kind = 'change')
             and (e.detail->'after'->>'status') = c.status) as undoable
    from settlement_events e
    join settlement_claims c on c.id = e.claim_id
    join settlements s on s.id = c.settlement_id
    where e.kind = 'change'
    order by e.id desc limit least(greatest(p_limit, 1), 50)) x), '[]'::jsonb);
end $$;

create or replace function public.settlements_board() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select jsonb_build_object(
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'status', c.status, 'match', c.match, 'evidence', c.evidence, 'question', c.question, 'answer', c.answer,
        'approved_at', c.approved_at, 'filed_at', c.filed_at, 'confirmation', c.confirmation, 'payout_method', c.payout_method,
        'needs_you_url', c.needs_you_url, 'needs_you_why', c.needs_you_why, 'amount_cents', c.amount_cents,
        'paid_at', c.paid_at, 'paid_via', c.paid_via, 'paid_source', c.paid_source, 'notes', c.notes,
        'fact_key', c.fact_key, 'reasoning', c.reasoning, 'archived_at', c.archived_at, 'created_at', c.created_at, 'updated_at', c.updated_at,
        'settlement', jsonb_build_object('name', s.name, 'defendant', s.defendant, 'administrator', s.administrator,
           'claim_url', s.claim_url, 'info_url', s.info_url, 'class_definition', s.class_definition,
           'proof_required', s.proof_required, 'est_payout', s.est_payout, 'deadline', s.deadline, 'status', s.status,
           'details', s.details))
        order by s.deadline nulls last, c.created_at)
      from settlement_claims c join settlements s on s.id = c.settlement_id
      where c.status <> 'skipped' or c.updated_at > now() - interval '30 days' or c.archived_at is not null), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'via', via, 'summary', summary, 'amount_cents', amount_cents, 'at', at) order by at desc)
      from settlement_unmatched where not resolved), '[]'::jsonb),
    'paid_total_cents', coalesce((select sum(amount_cents) from settlement_claims where status = 'paid'), 0),
    'paid_count', (select count(*) from settlement_claims where status = 'paid'),
    'paid_unknown_amount', (select count(*) from settlement_claims where status = 'paid' and amount_cents is null),
    'open_settlements', (select count(*) from settlements where status = 'open'),
    'last_scan', (select max(found_at) from settlements),
    'worker', (select jsonb_build_object('last_ok_at', last_ok_at, 'last_summary', last_summary, 'ok', last_ok) from pi_jobs where job = 'settlement-finder'),
    'filer', (select jsonb_build_object('at', at, 'ok', ok, 'summary', summary) from agent_beats where slug = 'settlement-filer' order by at desc limit 1)
  ) into v;
  return v;
end $$;
