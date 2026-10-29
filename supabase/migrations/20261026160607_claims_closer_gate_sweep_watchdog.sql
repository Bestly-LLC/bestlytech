-- Claims Closer return gate (2026-10-26), part 2: gate sweep, outbound watchdog, hold release.
-- Applied from chat on 2026-10-26 as version 20261026160607; this file is the recorded statement.
create or replace function public.claims_gate_sweep() returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare r record; gt jsonb; te timestamptz; v_wake int := 0; v_rem int := 0;
begin
  for r in select * from claim_cases where status not in ('paid', 'closed') and not coalesce(history, false) loop
    gt := claims_gate(r.id);
    if r.held_for_gate and (gt->>'ok')::boolean then
      update claim_cases set needs_work = true, work_reason = 'trip complete; releasing held messages', held_for_gate = false, updated_at = now() where id = r.id;
      v_wake := v_wake + 1;
    end if;
    te := nullif(gt->>'trip_end', '')::timestamptz;
    if te is not null and now() > te + interval '24 hours' and not (gt->>'first_done')::boolean then
      if claims_notify('Tap Complete trip for ' || coalesce(r.guest_first, 'the guest'),
           coalesce(r.guest_first, 'The guest') || '''s trip ended ' || to_char(te at time zone 'America/Los_Angeles', 'FMDy Mon FMDD "at" FMHH12:MI AM')
           || ' and the damage claim is open. Tap Complete trip on the guest trip page and I will message them. I am holding everything until you do.',
           'warning', 'claims-complete-reminder-' || r.id) <> 'duplicate' then v_rem := v_rem + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('woke', v_wake, 'reminders', v_rem);
end $fn$;

create or replace function public.claims_guard_watch() returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare eff timestamptz; r record; v_issue text; ts timestamptz; allowed numeric[]; m text[]; v_n int := 0; v_msg text;
  wording constant text := 'deductible|out[- ]of[- ]pocket|protection|\mplan (max|cap)|(turo|coverage|insurance) plan|\mcap(s|ped)?\M|\mmax(imum)?\M|turo[''’]s\M|(through|via|in|on|using) (the )?turo\M|turo (app|polic|process|team|support|insurance|rules?)|\mreview|\mrating|\mstars?\M|clause 2\.6|car sharing agreement';
begin
  select gate_effective_at into eff from claims_settings where id = true;
  eff := coalesce(eff, now());
  for r in select d.id, d.case_id, d.status, d.body, d.sent_at, d.claimed_at, d.created_at, c.guest_first, c.reservation_id, c.estimate_amount, c.invoices
             from claim_drafts d join claim_cases c on c.id = d.case_id
            where d.kind <> 'escalation' and d.status in ('approved', 'sending', 'sent', 'failed')
              and greatest(d.created_at, coalesce(d.sent_at, d.claimed_at, d.created_at)) >= eff loop
    if exists (select 1 from claim_events e where e.kind = 'guard' and e.detail->>'draft_id' = r.id::text) then continue; end if;
    v_issue := null;
    ts := coalesce(r.sent_at, r.claimed_at);
    if r.status in ('sent', 'sending') and ts is not null and ts >= eff then v_issue := claims_sent_violation(r.case_id, ts, r.id); end if;
    if v_issue is null and r.created_at >= eff then
      if r.body ~* wording then v_issue := 'a message mentions Turo plans, caps, policies or reviews';
      else
        allowed := coalesce(array[r.estimate_amount], '{}'::numeric[]) || coalesce((select array_agg((i->>'amount')::numeric) from jsonb_array_elements(coalesce(r.invoices, '[]'::jsonb)) i where i->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'), '{}'::numeric[]);
        for m in select regexp_matches(r.body, '\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)', 'g') loop
          if not exists (select 1 from unnest(allowed) a where abs(a - replace(m[1], ',', '')::numeric) < 0.01) then
            v_issue := 'a message has a dollar figure that is not the repair estimate'; exit;
          end if;
        end loop;
      end if;
    end if;
    if v_issue is not null then
      update claim_drafts set status = 'held', last_error = left('Held by the Claims Closer watchdog: ' || v_issue, 300), updated_at = now() where id = r.id and status in ('approved', 'failed');
      update claim_cases set outbound_hold = true, outbound_hold_reason = v_issue, outbound_hold_at = now(), updated_at = now() where id = r.case_id;
      insert into claim_events (case_id, reservation_id, kind, title, detail) values (r.case_id, r.reservation_id, 'guard', 'Held outbound messages: ' || v_issue, jsonb_build_object('draft_id', r.id, 'issue', v_issue));
      perform claims_notify('Held ' || coalesce(r.guest_first, 'the guest') || '''s messages',
        'Reservation ' || r.reservation_id || ': ' || v_issue || '. I stopped everything going out on this case until you clear it.', 'warning', 'claims-guard-' || r.id);
      v_n := v_n + 1;
    end if;
  end loop;
  for r in select a.id, a.case_id, a.status, a.payload, a.claimed_at, a.done_at, a.created_at, c.guest_first, c.reservation_id
             from claim_turo_actions a join claim_cases c on c.id = a.case_id
            where a.kind = 'create_invoice' and a.status in ('queued', 'sending', 'done') and a.created_at >= eff loop
    if exists (select 1 from claim_events e where e.kind = 'guard' and e.detail->>'action_id' = r.id::text) then continue; end if;
    v_issue := null;
    ts := coalesce(r.claimed_at, r.done_at);
    if r.status in ('sending', 'done') and ts is not null then v_issue := claims_sent_violation(r.case_id, ts, r.id); end if;
    if v_issue is null and coalesce(r.payload->>'message', '') ~* wording then v_issue := 'an invoice message mentions Turo plans, caps, policies or reviews'; end if;
    if v_issue is not null then
      update claim_turo_actions set status = 'cancelled', error = left('Held by the Claims Closer watchdog: ' || v_issue, 300), done_at = now() where id = r.id and status = 'queued';
      update claim_cases set outbound_hold = true, outbound_hold_reason = v_issue, outbound_hold_at = now(), updated_at = now() where id = r.case_id;
      insert into claim_events (case_id, reservation_id, kind, title, detail) values (r.case_id, r.reservation_id, 'guard', 'Held outbound messages: ' || v_issue, jsonb_build_object('action_id', r.id, 'issue', v_issue));
      perform claims_notify('Held ' || coalesce(r.guest_first, 'the guest') || '''s invoice',
        'Reservation ' || r.reservation_id || ': ' || v_issue || '. I stopped everything going out on this case until you clear it.', 'warning', 'claims-guard-act-' || r.id);
      v_n := v_n + 1;
    end if;
  end loop;
  perform bestly_raise('claims.guard', 'resolved', 'info', 'Claims Closer guard check is running', null, 'turo', null, true);
  return jsonb_build_object('held', v_n);
exception when others then
  v_msg := left(sqlerrm, 300);
  begin perform bestly_raise('claims.guard', 'problem', 'warning', 'Claims Closer guard check failed', v_msg, 'turo', null, false); exception when others then null; end;
  return jsonb_build_object('error', v_msg);
end $fn$;

create or replace function public.claims_hold_release(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is not null and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update claim_cases set outbound_hold = false, outbound_hold_reason = null, needs_work = true, work_reason = 'hold cleared', updated_at = now() where id = p_case;
  insert into claim_events (case_id, kind, title) values (p_case, 'note', 'Outbound hold cleared');
  return jsonb_build_object('ok', true);
end $fn$;
