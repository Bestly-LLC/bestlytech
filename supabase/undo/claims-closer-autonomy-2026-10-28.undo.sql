-- UNDO for migrations 20261028151000_claims_autonomy_core.sql and 20261028151100_claims_autonomy_functions.sql
-- (Claims Closer autonomy build, branch claims-closer-autonomy-2026-10-28).
-- Saved BEFORE any change: the exact definitions that were live in production on 2026-10-28 ~1:50 PM PT (pg_get_functiondef).
-- Run this whole file to put the five replaced functions back and drop everything the build added.
-- Data in the new tables is dropped with them (they only hold rows this build wrote).

-- 1. put the replaced functions back ------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claims_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_now_la timestamp := now() at time zone 'America/Los_Angeles'; v_daily boolean; v_work int; v_stuck int; v_open int;
begin
  begin perform public.claims_gate_sweep(); exception when others then null; end;
  select count(*) into v_open from claim_cases where status not in ('paid', 'closed');
  v_daily := extract(hour from v_now_la) >= 9 and exists (select 1 from claim_cases where status not in ('paid','closed')
             and (last_daily_at is null or last_daily_at < v_now_la::date));
  select count(*) into v_work from claim_cases where status not in ('paid', 'closed')
    and (needs_work or (follow_up_at is not null and follow_up_at <= now()) or (next_check_at is not null and next_check_at <= now()));
  select count(*) into v_stuck from claim_cases where status not in ('paid', 'closed') and needs_work
    and updated_at < now() - interval '15 minutes' and coalesce(last_run_at, 'epoch') < now() - interval '15 minutes';

  if v_daily then
    perform invoke_edge_function('claims-closer', '{"op":"daily"}'::jsonb, 120000);
  elsif v_work > 0 then
    perform invoke_edge_function('claims-closer', '{"op":"tick"}'::jsonb, 120000);
  elsif v_stuck = 0 then
    perform agent_beat('claims-closer', true, case when v_open = 0 then 'No open claims' else v_open || ' open claim' || case when v_open = 1 then '' else 's' end || ', nothing new' end);
  end if;
  if v_stuck > 0 then
    perform agent_beat('claims-closer', false, v_stuck || ' claim(s) waiting 15+ min; the worker is not running');
    perform bestly_raise('claims.stuck', 'problem', 'warning', 'Claims Closer is not working its cases',
      'claims-closer edge function has not run for 15+ minutes while a case waits.', 'turo', null, false);
  else
    perform bestly_raise('claims.stuck', 'resolved', 'info', 'Claims Closer is working its cases', null, 'turo', null, true);
  end if;
  return jsonb_build_object('work', v_work, 'daily', v_daily, 'stuck', v_stuck);
end $function$;

CREATE OR REPLACE FUNCTION public.claims_gate_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.claims_turo_claim(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare out jsonb;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  -- a send stuck 'sending' 10+ min fails and is NOT retried (it may have gone through); the watchdog tells Jared
  update claim_turo_actions set status = 'failed', error = 'reader stopped mid-action; check Turo before retrying', done_at = now()
    where status = 'sending' and claimed_at < now() - interval '10 minutes';
  with a as (
    update claim_turo_actions t set status = 'sending', claimed_at = now(), attempts = attempts + 1
    where t.id in (select x.id from claim_turo_actions x where x.status = 'queued' and x.attempts < 2 order by x.created_at limit 1)
    returning t.id, t.kind, t.payload, t.case_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'payload', a.payload, 'case_id', a.case_id,
      'incident_id', c.turo_incident_id, 'reservation_id', c.reservation_id)), '[]'::jsonb) into out
    from a join claim_cases c on c.id = a.case_id;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.claims_mail_seen(m bestly_mail)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_res bigint; v_subj text := regexp_replace(coalesce(m.subject, ''), '\s+', ' ', 'g'); v_body text := coalesce(m.body_text, '');
        c claim_cases; v_kind text; v_amt numeric; v_due text;
begin
  if coalesce(m.from_addr, '') !~* 'turo\.com' then return; end if;
  v_res := claims_res_from_mail(v_subj, v_body);
  if v_res is null then return; end if;

  v_kind := case
    when v_subj ~* 'resolve directly process' then 'resolve_started'
    when m.from_addr ~* 'claims\.turo\.com' and v_subj ~* '(claim|damage)' then 'claim_mail'
    when (v_subj || ' ' || v_body) ~* '(has been charged|has been paid|was paid|accepted the reimbursement invoice|payment received|paid invoice)' then 'invoice_paid'
    when v_subj ~* 'reimbursement invoice' and v_body ~* 'until' then 'invoice_sent'
    when v_subj ~* 'reimbursement|invoice' and v_body ~* 'disput' then 'invoice_disputed'
    else null end;

  select * into c from claim_cases where reservation_id = v_res;
  if c.id is null then
    if v_kind in ('resolve_started', 'claim_mail') then
      perform claims_open_case(v_res, case when v_kind = 'resolve_started' then 'resolve_directly' else 'turo_claim' end, m.id, coalesce(m.sent_at, now()));
      select * into c from claim_cases where reservation_id = v_res;
    else
      return;
    end if;
  end if;

  if exists (select 1 from claim_events where mail_id = m.id and kind = 'mail') then return; end if;
  insert into claim_events (case_id, reservation_id, kind, title, detail, mail_id)
    values (c.id, v_res, 'mail', left(v_subj, 200), jsonb_build_object('kind', v_kind, 'from', m.from_addr, 'excerpt', left(v_body, 600)), m.id);

  if v_kind = 'invoice_sent' then
    v_amt := nullif(replace(substring(v_body from 'Total charge\s*-\s*\$([0-9.,]+)'), ',', ''), '')::numeric;
    v_due := substring(v_body from 'until ([A-Z][a-z]+ \d{1,2} at \d{1,2}:\d{2} ?[AP]M)');
    update claim_cases set invoices = invoices || jsonb_build_array(jsonb_build_object('amount', v_amt, 'due_text', v_due, 'mail_id', m.id, 'paid', false)),
      updated_at = now() where id = c.id;
  elsif v_kind = 'invoice_paid' then
    v_amt := nullif(replace(substring(v_body from 'Total charge\s*-\s*\$([0-9.,]+)'), ',', ''), '')::numeric;
    update claim_cases set invoices = (select coalesce(jsonb_agg(case when v_amt is null or (i->>'amount')::numeric = v_amt then i || jsonb_build_object('paid', true) else i end), '[]'::jsonb)
                                        from jsonb_array_elements(invoices) i),
      updated_at = now() where id = c.id;
  elsif v_kind = 'invoice_disputed' then
    update claim_cases set needs_work = true, work_reason = 'guest disputed an invoice', updated_at = now() where id = c.id;
    perform claims_notify(coalesce(c.guest_first, 'guest') || ' disputed an invoice',
      'You can escalate to Turo from the Claims tab. Cutoff ' || to_char(c.escalate_by at time zone 'America/Los_Angeles', 'Dy Mon DD FMHH12:MI AM') || '.',
      'warning', 'claims-dispute-' || m.id);
  else
    update claim_cases set needs_work = true, work_reason = coalesce(v_kind, 'new Turo mail'), updated_at = now() where id = c.id;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.claims_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- 2. drop everything this build added -----------------------------------------------------------------------------------------------
-- (reconciled against both migrations on 2026-10-28; keep this list in step with them)
-- triggers first
drop trigger if exists claims_tesla_mail_trg on public.bestly_mail;
drop trigger if exists claims_progress_event on public.claim_events;
drop trigger if exists claims_progress_case on public.claim_cases;
-- functions (new in part 1 and part 2; the five replaced ones were restored above)
drop function if exists public.claims_autonomy_get();
drop function if exists public.claims_autonomy_set(text, text);
drop function if exists public.claims_autonomy_sweep();
drop function if exists public.claims_hold_autorelease();
drop function if exists public.claims_gate_ignoring_hold(uuid);
drop function if exists public.claims_stuck_alert();
drop function if exists public.claims_waiting_on(uuid);
drop function if exists public.claims_question_sweep();
drop function if exists public.claims_auto_complete_trips(boolean);
drop function if exists public.claims_car_parked_where(text);
drop function if exists public.claims_haversine_m(double precision, double precision, double precision, double precision);
drop function if exists public.claims_pt(timestamptz);
drop function if exists public.claims_booking_reminders();
drop function if exists public.claims_watchdog();
drop function if exists public.claims_link_turo_ids(uuid, text, bigint);
drop function if exists public.claims_set_windows(uuid, jsonb);
drop function if exists public.claims_windows_due();
drop function if exists public.claims_payment_seen(text, numeric, text, timestamptz, jsonb, uuid);
drop function if exists public.claims_match_hermes_checks();
drop function if exists public.claims_match_mercury_deposits();
drop function if exists public.claims_add_estimate(uuid, text, numeric, boolean, text, jsonb);
drop function if exists public.claims_tesla_mail_trg();
drop function if exists public.claims_unlinked_list(text);
drop function if exists public.claims_link_put(text, uuid, text, bigint);
drop function if exists public.claims_progress_event_trg();
drop function if exists public.claims_progress_case_trg();
drop function if exists public.claims_event_is_progress(text, text, jsonb);
-- allowlist and privacy rows this build added
delete from public.security_public_rpcs where fn in ('claims_unlinked_list', 'claims_link_put');
delete from public.privacy_data_map where (table_name, column_name) in (('claim_insurer_track', 'adjuster_email'), ('claim_insurer_track', 'adjuster_phone'), ('claim_outside_claims', 'adjuster_email'),
  ('claim_outside_claims', 'adjuster_phone'), ('claims_send_log', 'recipient'));
-- the Tesla Service shop row (only if nothing references it)
delete from public.claim_shops s where s.slug = 'tesla-service' and not exists (select 1 from public.claim_estimates e where e.shop_id = s.id);
-- tables (they hold only rows this build wrote)
drop table if exists public.claims_send_log;
drop table if exists public.claim_trip_complete_log;
drop table if exists public.claim_outside_claims;
drop table if exists public.claim_insurer_track;
drop table if exists public.claim_payments;
drop table if exists public.claim_windows;
drop table if exists public.claim_decisions;
drop table if exists public.claims_autonomy_settings;
-- columns
alter table public.claim_questions drop column if exists nudged_at;
alter table public.claim_questions drop column if exists scout_at;
alter table public.claim_questions drop column if exists self_answered;
alter table public.claim_questions drop column if exists meta;
alter table public.claim_questions drop column if exists retired_at;
alter table public.claim_questions drop column if exists retired_reason;
alter table public.claim_questions drop column if exists snoozed_until;
alter table public.claim_cases drop column if exists last_progress_at;
alter table public.claim_cases drop column if exists stuck_alert_at;
alter table public.lax_guest_links drop column if exists host_completed_source;
alter table public.lax_guest_links drop column if exists host_completed_evidence;
-- claim_estimates.status goes back to its six original values. Rows closed by "Drop this shop" become declined first so the constraint can be restored.
update public.claim_estimates set status = 'declined' where status = 'closed';
alter table public.claim_estimates drop constraint if exists claim_estimates_status_check;
alter table public.claim_estimates add constraint claim_estimates_status_check
  check (status = any (array['requested', 'replied', 'received', 'declined', 'no_reply', 'needs_visit']));
-- data the backfills wrote (data only; the Cody ids are Turo's real ids, so leaving them is also fine):
--   update claim_cases set turo_claim_no = null, turo_incident_id = null where reservation_id = 62622707;
--   update claim_cases set insurer = '{}'::jsonb where reservation_id = 62622707;   -- Progressive policy seeded by the build
--   the invoice "kind" labels on Cody's and Willie's invoices are harmless; strip with: update claim_cases set invoices = (select jsonb_agg(i - 'kind') from jsonb_array_elements(invoices) i) where reservation_id in (62622707, 59754331);
-- Redeploy the previous claims-closer edge function (the one that was live before this branch) from git history on main.
