-- Claims Closer v2, part 2 (2026-10-06), docs/claims-closer-v2-opusplan.md phases 4, 5, 6, 8.
--   * security_public_rpcs: the four Pi-facing claims RPCs from 20261006230000 were never allowlisted; Ares's Auto-Fixer would have
--     locked them within an hour and the Pi would stop syncing / posting invoices.
--   * claims_turo_done: dry runs record their result and change nothing; a failed Turo action is retried once (the reader re-reads
--     the incident first, so a retry can never double an invoice), then it becomes a question for Jared.
--   * Booking (phase 6): claims_book (the "Book it" tap), claims_book_manual ("I booked it myself"), reminders in claims_watch.
--   * Insurer + third party (phase 5): claim_cases.insurer is filled by the worker from the guest's reply; the parking garage is a
--     claims_ask the worker raises once (never contacted without a yes).
-- Everything is signed "Claims Closer" (claims_notify).

-- ---------------------------------------------------------------- Pi-facing RPCs on the allowlist
insert into public.security_public_rpcs (fn, why) values
 ('claims_sync_list',  'Pi Turo reader: open claims to sync; worker token (tesla_worker_ok) checked inside'),
 ('claims_sync_put',   'Pi Turo reader: writes a claim''s Turo status/next action/damage report; worker token checked inside'),
 ('claims_turo_claim', 'Pi Turo reader: claims the next queued Turo action (create invoice); worker token checked inside'),
 ('claims_turo_done',  'Pi Turo reader: reports a Turo action result; worker token checked inside')
on conflict (fn) do nothing;

-- ---------------------------------------------------------------- Turo actions: dry run, one retry
create or replace function public.claims_turo_done(p_token text, p_id uuid, p_ok boolean, p_result jsonb default null, p_error text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare a claim_turo_actions; c claim_cases; v_dry boolean;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  select * into a from claim_turo_actions where id = p_id and status = 'sending';
  if a.id is null then return; end if;
  v_dry := coalesce((a.payload->>'dry_run')::boolean, false);
  select * into c from claim_cases where id = a.case_id;

  if v_dry then   -- a rehearsal: every check ran, nothing was posted, nothing changes on the case
    update claim_turo_actions set status = case when p_ok then 'done' else 'failed' end, result = p_result, error = left(p_error, 400), done_at = now() where id = a.id;
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (a.case_id, c.reservation_id, 'turo_action', 'Dry run of ' || replace(a.kind, '_', ' ') || (case when p_ok then ' passed' else ' failed' end), jsonb_build_object('action_id', a.id, 'result', p_result, 'error', left(p_error, 300)));
    return;
  end if;

  if p_ok then
    update claim_turo_actions set status = 'done', result = p_result, error = null, done_at = now() where id = a.id;
    if a.kind = 'create_invoice' then
      update claim_cases set status = case when status in ('open', 'waiting_guest') then 'invoiced' else status end,
        turo_invoice = coalesce(nullif(p_result->'invoice', 'null'::jsonb), turo_invoice), needs_work = true, work_reason = 'Turo invoice created', updated_at = now() where id = a.case_id;
    else
      update claim_cases set needs_work = true, work_reason = 'Turo action done: ' || a.kind, updated_at = now() where id = a.case_id;
    end if;
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (a.case_id, c.reservation_id, 'turo_action', 'Done in Turo: ' || replace(a.kind, '_', ' '), jsonb_build_object('action_id', a.id, 'result', p_result));
    perform claims_notify(case a.kind when 'create_invoice' then 'Invoice posted to ' || coalesce(c.guest_first, 'the guest') || ' in Turo'
                          else 'Done in Turo: ' || replace(a.kind, '_', ' ') end,
      case when a.kind = 'create_invoice' then 'The invoice for ' || coalesce('$' || (a.payload->>'amount'), 'the amount') || ' is on the claim with the damage photos.' else 'Updated on the claim.' end,
      'success', 'claims-turo-' || a.id);
  else
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (a.case_id, c.reservation_id, 'turo_action_failed', 'Turo action failed: ' || replace(a.kind, '_', ' '), jsonb_build_object('action_id', a.id, 'error', left(p_error, 300), 'attempt', a.attempts));
    if a.attempts < 2 and coalesce(p_error, '') !~* 'signed out|blocked|not within|mismatch|does not do' then
      update claim_turo_actions set status = 'queued', error = left(p_error, 400), result = p_result where id = a.id;   -- the reader re-reads the incident first, so this is safe
    else
      update claim_turo_actions set status = 'failed', result = p_result, error = left(p_error, 400), done_at = now() where id = a.id;
      perform claims_ask(a.case_id, 'I could not ' || replace(a.kind, '_', ' ') || ' in Turo (' || left(coalesce(p_error, 'unknown error'), 160) || '). Should I try again, or will you do it by hand?',
        '[{"value":"retry","label":"Try again"},{"value":"by_hand","label":"I will do it"}]'::jsonb, 'turo-action-' || a.id, 'decision');
    end if;
  end if;
end $$;
revoke all on function public.claims_turo_done(text, uuid, boolean, jsonb, text) from anon, authenticated, public;
grant execute on function public.claims_turo_done(text, uuid, boolean, jsonb, text) to anon;

-- ---------------------------------------------------------------- phase 6: Book it
-- repair_booking jsonb: {state: requested|calling|booked|failed|manual, requested_at, tries, call_id, shop_id, dropoff_at, pickup_at, days, notes,
--                        slots_offered[], reminded_eve, reminded_morning, calendar}
create or replace function public.claims_book(p_case uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c claim_cases;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into c from claim_cases where id = p_case for update;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'no case'); end if;
  if c.chosen_shop_id is null or c.estimate_amount is null then return jsonb_build_object('ok', false, 'error', 'no shop chosen yet'); end if;
  if coalesce(c.repair_booking->>'state', '') in ('requested', 'calling', 'booked', 'manual') then return jsonb_build_object('ok', true, 'already', c.repair_booking->>'state'); end if;
  update claim_cases set repair_booking = jsonb_build_object('state', 'requested', 'requested_at', now(), 'tries', 0, 'shop_id', c.chosen_shop_id),
    needs_work = true, work_reason = 'Jared tapped Book it', updated_at = now() where id = p_case;
  insert into claim_events (case_id, reservation_id, kind, title, detail) values (p_case, c.reservation_id, 'booking', 'Jared tapped Book it', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claims_book(uuid) from anon, public;
grant execute on function public.claims_book(uuid) to authenticated;

create or replace function public.claims_book_manual(p_case uuid, p_dropoff timestamptz, p_pickup timestamptz default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c claim_cases;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into c from claim_cases where id = p_case for update;
  if c.id is null then return jsonb_build_object('ok', false); end if;
  update claim_cases set repair_booking = jsonb_build_object('state', 'manual', 'shop_id', c.chosen_shop_id, 'dropoff_at', p_dropoff, 'pickup_at', p_pickup, 'notes', left(p_note, 300)),
    needs_work = true, work_reason = 'booked by hand', updated_at = now() where id = p_case;
  insert into claim_events (case_id, reservation_id, kind, title, detail) values (p_case, c.reservation_id, 'booking', 'Jared booked the repair himself', jsonb_build_object('dropoff_at', p_dropoff));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claims_book_manual(uuid, timestamptz, timestamptz, text) from anon, public;
grant execute on function public.claims_book_manual(uuid, timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------- the watchdog: adds booking reminders and a stuck-call check
create or replace function public.claims_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_stale int; v_signed boolean; v_silent int; r record; v_now_la timestamp := now() at time zone 'America/Los_Angeles'; v_drop timestamptz; v_who text; v_shop text; v_rem int := 0;
begin
  -- 1. evidence sync stale 30+ min while a case with a Turo incident is open: poke the Pi, tell Scout if the reader is the problem
  select count(*) into v_stale from claim_cases where turo_incident_id is not null and not history and status not in ('paid', 'closed')
    and coalesce(synced_at, 'epoch') < now() - interval '30 minutes';
  select coalesce(signed_in, false) into v_signed from turo_reader_state where id = 1;
  if v_stale > 0 then
    update turo_reader_state set poke_at = now() where id = 1;
    perform bestly_raise('claims.sync', 'problem', 'warning', 'Claims Closer cannot read Turo',
      v_stale || ' open claim(s) have not synced from Turo in 30+ minutes' || case when v_signed then ' (the reader is signed in, so the claims read itself is failing).' else ' (the Pi reader is signed out of Turo).' end, 'turo', null, false);
  else
    perform bestly_raise('claims.sync', 'resolved', 'info', 'Claims Closer can read Turo again', null, 'turo', null, true);
  end if;

  -- 2. Turo actions stuck 'sending' 10+ min -> failed + a question (never retried blind: it may have gone through)
  for r in select a.id, a.case_id, a.kind from claim_turo_actions a where a.status = 'sending' and a.claimed_at < now() - interval '10 minutes' loop
    update claim_turo_actions set status = 'failed', error = 'reader stopped mid-action; check Turo before retrying', done_at = now() where id = r.id;
    perform claims_ask(r.case_id, 'The ' || replace(r.kind, '_', ' ') || ' in Turo stopped halfway. Please check the claim in Turo, then tell me whether to try again.',
      '[{"value":"retry","label":"Try again"},{"value":"done","label":"It went through"}]'::jsonb, 'turo-stuck-' || r.id, 'decision');
  end loop;
  -- a queued Turo action the Pi has not picked up in 15+ min: poke it
  if exists (select 1 from claim_turo_actions where status = 'queued' and created_at < now() - interval '15 minutes') then
    update turo_reader_state set poke_at = now() where id = 1;
  end if;

  -- 3. shop requests silent 72 h -> no_reply, and the worker asks the next shop
  for r in select e.id, e.case_id from claim_estimates e where e.status = 'requested' and e.requested_at < now() - interval '72 hours' loop
    update claim_estimates set status = 'no_reply' where id = r.id;
    update claim_cases set needs_work = true, work_reason = 'a shop never replied', updated_at = now() where id = r.case_id;
  end loop;
  select count(*) into v_silent from claim_estimates where status = 'requested' and requested_at < now() - interval '24 hours';

  -- 4. booking reminders (Claims Closer signs them): the evening before at 6 PM, the morning of at 7 AM
  for r in select c.id, c.guest_first, c.repair_booking rb, s.name shop from claim_cases c left join claim_shops s on s.id = c.chosen_shop_id
           where c.repair_booking->>'state' in ('booked', 'manual') and c.repair_booking->>'dropoff_at' is not null and c.status not in ('paid', 'closed') loop
    v_drop := (r.rb->>'dropoff_at')::timestamptz; v_who := coalesce(r.guest_first, 'the'); v_shop := coalesce(r.shop, 'the shop');
    if v_drop > now() and (v_drop at time zone 'America/Los_Angeles')::date = v_now_la::date + 1 and extract(hour from v_now_la) >= 18 and not coalesce((r.rb->>'reminded_eve')::boolean, false) then
      perform claims_notify('Drop the Tesla at ' || v_shop || ' tomorrow',
        to_char(v_drop at time zone 'America/Los_Angeles', 'FMDay Mon FMDD "at" FMHH12:MI AM') || ' at ' || v_shop || ' for ' || v_who || '''s repair. Nothing else to do tonight.', 'warning', 'claims-rem-eve-' || r.id);
      update claim_cases set repair_booking = repair_booking || '{"reminded_eve": true}'::jsonb where id = r.id; v_rem := v_rem + 1;
    elsif v_drop > now() and (v_drop at time zone 'America/Los_Angeles')::date = v_now_la::date and extract(hour from v_now_la) between 7 and 11 and not coalesce((r.rb->>'reminded_morning')::boolean, false) then
      perform claims_notify('Repair drop-off today at ' || to_char(v_drop at time zone 'America/Los_Angeles', 'FMHH12:MI AM'),
        'Take the Tesla to ' || v_shop || ' this morning. The estimate is already with them.', 'warning', 'claims-rem-morning-' || r.id);
      update claim_cases set repair_booking = repair_booking || '{"reminded_morning": true}'::jsonb where id = r.id; v_rem := v_rem + 1;
    end if;
  end loop;
  return jsonb_build_object('stale', v_stale, 'silent_24h', v_silent, 'reminders', v_rem);
end $$;
revoke all on function public.claims_watch() from anon, authenticated, public;

-- ---------------------------------------------------------------- team card: say what the worker owns now
select public.team_onboard($j$[
 {"slug":"claims-closer","name":"Claims Closer","role":"Damage claim negotiator","reports_to":"turo-reader","runs_on":"cloud","icon":"scale",
  "schedule":"every 2 min when a case needs work; Turo sync + action queue on the Pi every 2 to 10 min; watchdog and booking reminders every 10 min; deadline check 9 AM",
  "what_it_does":"Sees a Turo damage claim through to payment. Reads the evidence from Turo, asks body shops for photo estimates (email, Ava calls), picks the best one, posts the Turo invoice, works the guest and their insurer, and asks Scout when unsure. Only booking the repair waits for Jared's Book it tap; then Ava books the drop-off and Claims Closer reminds him.",
  "admin_url":"/admin/claims","welcome":false,
  "pulse":{"src":"cron","job":"claims-closer-tick","gap":10,"also":["claims-watch"]},
  "owns":["claims."]}
]$j$::jsonb);
