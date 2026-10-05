-- Claims Closer (team slug claims-closer), 2026-10-04.
-- Sees a Turo damage claim through to payment without Jared chasing it by hand.
--
--   1. Scout's mail pipe (bestly_mail insert) spots Turo claim mail and opens/updates a case on its own:
--      "resolve directly process" -> new case; reimbursement invoices, payments and other Turo claim mail -> case events.
--   2. turo_inbox insert (Pi Turo reader) -> a guest reply on a case's reservation wakes the worker.
--   3. claims_tick() (cron, every 2 min) wakes the claims-closer edge function only when there is work,
--      runs the 9 AM daily deadline check, and checks in with Team Watch (agent_beat) every run.
--   4. The edge function drafts the next message with free AI; Jared approves/edits/rejects at /admin/claims.
--      NOTHING goes to a guest without Jared's yes.
--   5. Approved drafts go out through the Link Sender (Mac mini turo_sender.py, unchanged): turo_sender_claim
--      hands them out in "claims-only" mode (turo_sender_settings.claims_enabled) even while guest-link
--      sending (enabled) stays off; turo_sender_done marks them sent.

-- ---------------------------------------------------------------- tables
create table if not exists public.claim_cases (
  id uuid primary key default gen_random_uuid(),
  reservation_id bigint not null unique,
  guest_first text, guest_last text, vin text,
  trip_end timestamptz,
  path text not null default 'resolve_directly',            -- resolve_directly | turo_claim
  status text not null default 'open',                      -- open | waiting_guest | insurance | invoiced | paid | escalated | closed
  goal text,                                                -- the plan, in plain words
  opened_at timestamptz not null default now(),
  estimate_due_at timestamptz,                              -- share a pro estimate with the guest by
  escalate_by timestamptz,                                  -- last moment to hand it to Turo (20 days from trip end)
  estimate_amount numeric,
  guest_max numeric default 500,                            -- guest plan out-of-pocket max when resolving directly
  insurer jsonb not null default '{}'::jsonb,               -- {name, policy, claim_no, adjuster, phone, email}
  invoices jsonb not null default '[]'::jsonb,              -- [{amount, due_text, mail_id, paid}]
  facts text,                                               -- what the drafter must know (damage, shop, etc.)
  last_host_msg_at timestamptz, last_guest_msg_at timestamptz,
  follow_up_at timestamptz,
  needs_work boolean not null default true, work_reason text,
  last_run_at timestamptz, last_daily_at date,
  opened_from_mail bigint,
  updated_at timestamptz not null default now()
);
alter table public.claim_cases enable row level security;
revoke all on public.claim_cases from anon, authenticated;

create table if not exists public.claim_drafts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.claim_cases(id) on delete cascade,
  reservation_id bigint not null,
  kind text not null default 'reply',                       -- insurance_ask | follow_up | reply | invoice_note | escalation | other
  body text not null,
  reason text,                                              -- why Claims Closer wrote it (shown to Jared)
  for_message_id text,                                      -- guest message it answers
  status text not null default 'pending',                   -- pending | approved | sending | sent | failed | rejected | superseded | done
  verify_snippet text,
  attempts int not null default 0, last_error text,
  created_at timestamptz not null default now(), approved_at timestamptz, claimed_at timestamptz, sent_at timestamptz,
  verified boolean, notified_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists claim_drafts_status_idx on public.claim_drafts (status, approved_at);
create index if not exists claim_drafts_case_idx on public.claim_drafts (case_id, created_at desc);
alter table public.claim_drafts enable row level security;
revoke all on public.claim_drafts from anon, authenticated;

create table if not exists public.claim_events (
  id bigserial primary key,
  case_id uuid references public.claim_cases(id) on delete cascade,
  reservation_id bigint,
  at timestamptz not null default now(),
  kind text not null,                                       -- opened | mail | guest_msg | draft | approved | rejected | sent | send_failed | deadline | note
  title text, detail jsonb, mail_id bigint
);
create index if not exists claim_events_case_idx on public.claim_events (case_id, at desc);
alter table public.claim_events enable row level security;
revoke all on public.claim_events from anon, authenticated;

alter table public.turo_sender_settings add column if not exists claims_enabled boolean not null default true;

-- ---------------------------------------------------------------- helpers
-- Next good time to nudge a guest: +24h, moved into 9 AM - 7 PM Los Angeles.
create or replace function public.claims_daytime(p timestamptz) returns timestamptz language plpgsql immutable as $$
declare l timestamp := p at time zone 'America/Los_Angeles';
begin
  if extract(hour from l) < 9 then l := date_trunc('day', l) + interval '9 hours';
  elsif extract(hour from l) >= 19 then l := date_trunc('day', l) + interval '1 day 9 hours';
  end if;
  return l at time zone 'America/Los_Angeles';
end $$;

create or replace function public.claims_res_from_mail(p_subject text, p_body text) returns bigint language sql immutable as $$
  select coalesce(substring(p_subject from '#\s*(\d{7,})'), substring(p_body from 'reservation/(\d{7,})'),
                  substring(p_body from 'reservation #\s*(\d{7,})'), substring(p_body from 'Reservation ID #\s*(\d{7,})'))::bigint
$$;

-- Claims Closer signs its own alerts (Jared's rule: every notification comes from the employee responsible).
create or replace function public.claims_notify(p_title text, p_body text default null, p_severity text default 'info', p_dedupe text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v text;
begin
  if p_dedupe is not null and exists (select 1 from claim_events where kind = 'notify' and detail->>'key' = p_dedupe) then return 'duplicate'; end if;
  v := notify_route('Claims Closer: ' || left(p_title, 170), coalesce(p_body, ''),
         case p_severity when 'critical' then 'critical' when 'warning' then 'time-sensitive' else 'active' end,
         'Claims Closer', 'https://bestly.tech/admin/claims', null, p_dedupe, null, null, false, now());
  insert into claim_events (kind, title, detail) values ('notify', left(p_title, 200), jsonb_build_object('key', p_dedupe, 'channel', v));
  return v;
exception when others then
  begin perform admin_notify('claims-closer', 'Claims Closer: ' || p_title, p_body, '/admin/claims', null, p_severity, p_dedupe); exception when others then null; end;
  return 'bell';
end $$;
revoke all on function public.claims_notify(text, text, text, text) from anon, authenticated, public;

-- Open (or return) the case for a reservation. Used by the mail trigger and by hand.
create or replace function public.claims_open_case(p_res bigint, p_path text default 'resolve_directly',
  p_mail_id bigint default null, p_at timestamptz default now())
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare t turo_trips; c uuid; v_last_host timestamptz;
begin
  select id into c from claim_cases where reservation_id = p_res;
  if c is not null then return c; end if;
  select * into t from turo_trips where reservation_id = p_res;
  select max(sent_at) into v_last_host from turo_inbox where reservation_id = p_res and role = 'HOST';
  insert into claim_cases (reservation_id, guest_first, guest_last, vin, trip_end, path, goal,
                           estimate_due_at, escalate_by, opened_at, last_host_msg_at, follow_up_at, opened_from_mail,
                           needs_work, work_reason)
  values (p_res, t.guest_first, t.guest_last, t.vin, t.ends_at, coalesce(p_path, 'resolve_directly'),
          'Get the full repair paid through the guest''s personal auto insurance. Fallback: invoice the guest''s plan max ($500), '
          || 'then escalate to Turo before the cutoff only if the estimate is above Jared''s damage responsibility.',
          case when p_path = 'resolve_directly' then p_at + interval '72 hours' end,
          coalesce(t.ends_at, p_at) + interval '20 days', p_at, v_last_host,
          case when v_last_host is not null then claims_daytime(v_last_host + interval '24 hours') end,
          p_mail_id, true, 'case opened')
  returning id into c;
  insert into claim_events (case_id, reservation_id, kind, title, mail_id)
    values (c, p_res, 'opened', 'Case opened for ' || coalesce(t.guest_first, 'guest') || ' (' || p_res || ')', p_mail_id);
  perform claims_notify('Opened a case: ' || coalesce(t.guest_first || ' ' || coalesce(t.guest_last, ''), 'reservation ' || p_res),
    'Turo says the claim is in. I''ll watch the guest''s replies and draft each message for your OK.', 'info', 'claims-open-' || p_res);
  return c;
end $$;
revoke all on function public.claims_open_case(bigint, text, bigint, timestamptz) from anon, authenticated, public;

-- ---------------------------------------------------------------- Scout's mail pipe -> Claims Closer
create or replace function public.claims_mail_seen(m public.bestly_mail) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_res bigint; v_subj text := regexp_replace(coalesce(m.subject, ''), '\s+', ' ', 'g'); v_body text := coalesce(m.body_text, '');
        c claim_cases; v_kind text; v_amt numeric; v_due text;
begin
  if coalesce(m.from_addr, '') !~* 'turo\.com' then return; end if;
  v_res := claims_res_from_mail(v_subj, v_body);
  if v_res is null then return; end if;

  v_kind := case
    when v_subj ~* 'resolve directly process' then 'resolve_started'
    when m.from_addr ~* 'claims\.turo\.com' and v_subj ~* '(claim|damage)' then 'claim_mail'
    when v_subj ~* 'reimbursement invoice' and v_body ~* 'until' then 'invoice_sent'
    when v_subj ~* '(invoice|reimbursement)' and (v_subj || ' ' || v_body) ~* '(has been paid|was paid|paid the|payment received|you.ve been paid)' then 'invoice_paid'
    when v_subj ~* 'reimbursement|invoice' and v_body ~* 'disput' then 'invoice_disputed'
    else null end;

  select * into c from claim_cases where reservation_id = v_res;
  if c.id is null then
    if v_kind in ('resolve_started', 'claim_mail') then
      perform claims_open_case(v_res, case when v_kind = 'resolve_started' then 'resolve_directly' else 'turo_claim' end, m.id, coalesce(m.sent_at, now()));
      select * into c from claim_cases where reservation_id = v_res;
    else
      return;   -- Turo mail for a trip with no claim: not our business
    end if;
  end if;

  if exists (select 1 from claim_events where mail_id = m.id and kind = 'mail') then return; end if;
  insert into claim_events (case_id, reservation_id, kind, title, detail, mail_id)
    values (c.id, v_res, 'mail', left(v_subj, 200), jsonb_build_object('kind', v_kind, 'from', m.from_addr, 'excerpt', left(v_body, 600)), m.id);

  if v_kind = 'invoice_sent' then
    v_amt := nullif(replace(substring(v_body from 'Total charge\s*-\s*\$([0-9.,]+)'), ',', ''), '')::numeric;
    v_due := substring(v_body from 'until ([A-Z][a-z]+ \d{1,2} at \d{1,2}:\d{2} ?[AP]M)');
    update claim_cases set invoices = invoices || jsonb_build_array(jsonb_build_object('amount', v_amt, 'due_text', v_due, 'mail_id', m.id, 'paid', false)),
      status = case when status in ('open', 'waiting_guest') then 'invoiced' else status end, updated_at = now() where id = c.id;
  elsif v_kind = 'invoice_paid' then
    update claim_cases set invoices = (select coalesce(jsonb_agg(i || jsonb_build_object('paid', true)), '[]'::jsonb) from jsonb_array_elements(invoices) i),
      needs_work = true, work_reason = 'Turo says an invoice was paid', updated_at = now() where id = c.id;
  elsif v_kind = 'invoice_disputed' then
    update claim_cases set needs_work = true, work_reason = 'guest disputed an invoice', updated_at = now() where id = c.id;
    perform claims_notify(coalesce(c.guest_first, 'guest') || ' disputed an invoice',
      'You can escalate to Turo from the Claims tab. Cutoff ' || to_char(c.escalate_by at time zone 'America/Los_Angeles', 'Dy Mon DD FMHH12:MI AM') || '.',
      'warning', 'claims-dispute-' || m.id);
  else
    update claim_cases set needs_work = true, work_reason = coalesce(v_kind, 'new Turo mail'), updated_at = now() where id = c.id;
  end if;
end $$;
revoke all on function public.claims_mail_seen(public.bestly_mail) from anon, authenticated, public;

create or replace function public.claims_mail_trg() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform claims_mail_seen(new);
  return new;
exception when others then
  begin perform bestly_raise('claims.mail', 'problem', 'warning', 'Claims Closer could not read a Turo email', left(sqlerrm, 300), 'turo'); exception when others then null; end;
  return new;   -- never block mail ingestion
end $$;
create or replace trigger claims_mail_trg after insert on public.bestly_mail for each row execute function public.claims_mail_trg();

-- ---------------------------------------------------------------- guest replies (Pi Turo reader)
create or replace function public.claims_inbox_trg() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare c claim_cases;
begin
  if new.reservation_id is null then return new; end if;
  select * into c from claim_cases where reservation_id = new.reservation_id and status not in ('paid', 'closed');
  if c.id is null then return new; end if;
  if upper(coalesce(new.role, '')) = 'GUEST' then
    update claim_cases set last_guest_msg_at = greatest(coalesce(last_guest_msg_at, 'epoch'), new.sent_at), follow_up_at = null,
      needs_work = true, work_reason = 'guest replied', updated_at = now() where id = c.id;
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (c.id, new.reservation_id, 'guest_msg', coalesce(new.author, 'Guest') || ' replied', jsonb_build_object('message_id', new.message_id, 'body', left(new.body, 1000)));
  elsif upper(coalesce(new.role, '')) = 'HOST' then
    update claim_cases set last_host_msg_at = greatest(coalesce(last_host_msg_at, 'epoch'), new.sent_at), updated_at = now() where id = c.id;
  end if;
  return new;
exception when others then return new;
end $$;
create or replace trigger claims_inbox_trg after insert on public.turo_inbox for each row execute function public.claims_inbox_trg();

-- ---------------------------------------------------------------- admin (bestly.tech/admin/claims)
create or replace function public.claims_admin() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'sender', (select jsonb_build_object('claims_enabled', claims_enabled, 'links_enabled', enabled, 'seen_at', seen_at, 'last_error', last_error) from turo_sender_settings where id = 1),
    'beat', (select to_jsonb(b) from agent_beats b where slug = 'claims-closer'),
    'cases', coalesce((select jsonb_agg(jsonb_build_object(
      'case', to_jsonb(c),
      'drafts', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from (select * from claim_drafts where case_id = c.id order by created_at desc limit 12) d), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (select id, at, kind, title, detail from claim_events where case_id = c.id order by at desc limit 25) e), '[]'::jsonb)
    ) order by (c.status in ('paid','closed')), c.opened_at desc) from claim_cases c), '[]'::jsonb));
end $$;
revoke all on function public.claims_admin() from anon, public;
grant execute on function public.claims_admin() to authenticated;

-- approve (optionally with Jared's edited text) | reject. Approving a guest message queues it for the Link Sender.
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

-- facts Jared adds (estimate, insurer, notes) or closing the case. Null = leave as is.
create or replace function public.claims_case_update(p_id uuid, p_estimate numeric default null, p_facts text default null,
  p_status text default null, p_insurer jsonb default null, p_redraft boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_status is not null and p_status not in ('open','waiting_guest','insurance','invoiced','paid','escalated','closed') then raise exception 'bad status'; end if;
  update claim_cases set estimate_amount = coalesce(p_estimate, estimate_amount), facts = coalesce(p_facts, facts),
    status = coalesce(p_status, status), insurer = case when p_insurer is null then insurer else insurer || p_insurer end,
    needs_work = needs_work or p_redraft or p_estimate is not null, work_reason = case when p_redraft then 'Jared asked for a new draft'
      when p_estimate is not null then 'estimate added' else work_reason end, updated_at = now()
  where id = p_id;
  insert into claim_events (case_id, kind, title, detail)
    values (p_id, 'note', 'Jared updated the case', jsonb_strip_nulls(jsonb_build_object('estimate', p_estimate, 'status', p_status, 'insurer', p_insurer, 'redraft', nullif(p_redraft, false))));
  if p_redraft then perform invoke_edge_function('claims-closer', '{"op":"tick"}'::jsonb, 60000); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claims_case_update(uuid, numeric, text, text, jsonb, boolean) from anon, public;
grant execute on function public.claims_case_update(uuid, numeric, text, text, jsonb, boolean) to authenticated;

-- claims-only mode switch for the Link Sender
create or replace function public.claims_sender_set(p_on boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update turo_sender_settings set claims_enabled = p_on, updated_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'claims_enabled', p_on);
end $$;
revoke all on function public.claims_sender_set(boolean) from anon, public;
grant execute on function public.claims_sender_set(boolean) to authenticated;

-- ---------------------------------------------------------------- the tick (cron every 2 min) + watchdog
create or replace function public.claims_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_now_la timestamp := now() at time zone 'America/Los_Angeles'; v_daily boolean; v_work int; v_stuck int; v_open int;
begin
  select count(*) into v_open from claim_cases where status not in ('paid', 'closed');
  v_daily := extract(hour from v_now_la) >= 9 and exists (select 1 from claim_cases where status not in ('paid','closed')
             and (last_daily_at is null or last_daily_at < v_now_la::date));
  select count(*) into v_work from claim_cases where status not in ('paid', 'closed')
    and (needs_work or (follow_up_at is not null and follow_up_at <= now()));
  -- work that has waited 15+ minutes means the worker is not draining
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
  end if;
  return jsonb_build_object('work', v_work, 'daily', v_daily, 'stuck', v_stuck);
end $$;
revoke all on function public.claims_tick() from anon, authenticated, public;

do $$ begin
  perform cron.unschedule('claims-closer-tick') where exists (select 1 from cron.job where jobname = 'claims-closer-tick');
  perform cron.schedule('claims-closer-tick', '*/2 * * * *', 'select public.claims_tick()');
end $$;
