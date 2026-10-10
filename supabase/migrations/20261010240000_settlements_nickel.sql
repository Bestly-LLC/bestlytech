-- Nickel, Settlements Clerk (2026-10-10). ("Penny" was taken by the Cost Cutter the same day.) Jared: an AI employee that applies for class action settlements on his behalf,
-- tracks them, and checks a claim off as paid from any of three signals: USPS Informed Delivery mail, a payment email,
-- or his "Got paid" button. Plan: bestly_memory ops/plan/class-action-claims-opusplan.
--
-- HARD RULE (do not loosen): a claim form is a sworn statement that he is a class member. Nothing is filed without
-- his yes. His chosen flow (2026-10-10 3:57 PM, option A): one daily digest, one "Yes, file all" tap that approves
-- every claim currently shown as Ready. Claims whose membership rests only on his memory are asked as a yes/no first.
--
-- Naming: "claims" (tables, prefix, /admin/claims) already belongs to Claims Closer (Turo damage claims), so everything
-- here is settlement_* and alerts use the prefix "settle.".

-- ------------------------------------------------------------------ tables
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  source_key text unique not null,              -- stable id from the finder (source + slug)
  name text not null,                           -- "Apple iPhone Battery Settlement"
  defendant text,
  administrator text,                           -- "Epiq", "Kroll", ...
  claim_url text,
  info_url text,
  class_definition text,
  proof_required boolean,
  est_payout text,
  deadline date,
  payout_methods text[] default '{}',
  status text not null default 'open' check (status in ('open', 'closed')),
  source text,
  raw jsonb default '{}'::jsonb,
  found_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settlement_claims (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null unique references public.settlements(id) on delete cascade,
  match text not null default 'ask' check (match in ('proven', 'likely', 'ask', 'no')),
  evidence jsonb not null default '[]'::jsonb,  -- [{kind:'email'|'bank'|'order'|'answer', ref, summary}]
  question text,                                -- the one yes/no shown when match = 'ask'
  answer boolean,
  status text not null default 'found' check (status in
    ('found', 'ready', 'approved', 'filing', 'needs_you', 'filed', 'paid', 'denied', 'skipped', 'expired')),
  approved_at timestamptz,
  filed_at timestamptz,
  confirmation text,
  payout_method text,
  needs_you_url text,                           -- prefilled form link when a CAPTCHA blocks the filer
  needs_you_why text,
  amount_cents integer,
  paid_at timestamptz,
  paid_via text check (paid_via in ('mail', 'email', 'button')),
  paid_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists settlement_claims_status_idx on public.settlement_claims (status);

create table if not exists public.settlement_events (
  id bigint generated always as identity primary key,
  claim_id uuid references public.settlement_claims(id) on delete cascade,
  kind text not null,
  detail jsonb default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists settlement_events_claim_idx on public.settlement_events (claim_id, at desc);

-- Settlement administrators: how their mail and email look. Used to spot a check in the mailbox.
create table if not exists public.settlement_admins (
  pattern text primary key,                     -- ILIKE pattern
  label text not null
);
insert into public.settlement_admins (pattern, label) values
  ('%epiq%', 'Epiq'), ('%kroll%', 'Kroll'), ('%jnd %', 'JND'), ('%jnd legal%', 'JND'), ('%jndla%', 'JND'),
  ('%angeion%', 'Angeion'), ('%simpluris%', 'Simpluris'), ('%rust consulting%', 'Rust Consulting'),
  ('%a.b. data%', 'A.B. Data'), ('%ab data%', 'A.B. Data'), ('%verita%', 'Verita'), ('%kccllc%', 'KCC'),
  ('%kurtzman%', 'KCC'), ('%cpt group%', 'CPT Group'), ('%atticus%', 'Atticus'), ('%analytics consulting%', 'Analytics Consulting'),
  ('%gilardi%', 'Gilardi'), ('%heffler%', 'Heffler'), ('%ilym%', 'ILYM'), ('%settlement administrator%', 'Settlement administrator'),
  ('%claims administrator%', 'Claims administrator'), ('%settlement fund%', 'Settlement fund'), ('%class action%', 'Class action')
on conflict (pattern) do nothing;

-- Mail pieces / emails that look like settlement money but could not be tied to one claim. Shown on the page to sort.
create table if not exists public.settlement_unmatched (
  id bigint generated always as identity primary key,
  via text not null check (via in ('mail', 'email')),
  ref text not null unique,
  summary text,
  amount_cents integer,
  at timestamptz not null default now(),
  resolved boolean not null default false
);

alter table public.settlements enable row level security;
alter table public.settlement_claims enable row level security;
alter table public.settlement_events enable row level security;
alter table public.settlement_admins enable row level security;
alter table public.settlement_unmatched enable row level security;
-- No policies: the page reads through the admin RPCs below; workers write through token RPCs.

-- ------------------------------------------------------------------ helpers
create or replace function public.settlement_log(p_claim uuid, p_kind text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into settlement_events (claim_id, kind, detail) values (p_claim, p_kind, coalesce(p_detail, '{}'::jsonb));
$$;

-- Alerts signed by Nickel. Per Jared's autonomy rules only money arriving, a deadline about to be missed, and the
-- daily digest he asked for (his explicit choice, 2026-10-10) interrupt. Everything else waits for the 7 PM recap.
create or replace function public.settlement_notify(p_title text, p_body text default null, p_kind text default 'recap',
  p_url text default 'https://bestly.tech/admin/settlements', p_dedupe text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v text; v_title text := 'Nickel: ' || left(p_title, 170);
  v_key text := 'settle.' || coalesce(nullif(p_dedupe, ''), md5(lower(v_title || '|' || coalesce(p_body, ''))));
begin
  if p_kind in ('paid', 'deadline', 'digest') then
    perform set_config('autonomy.allow', '1', true);
    v := notify_route(v_title, coalesce(p_body, ''), case when p_kind = 'paid' then 'active' else 'time-sensitive' end,
                      'Nickel', p_url, null, v_key, null, null, false, now());
  else
    insert into autonomy_held (title, body, source, level) values (left(v_title, 200), left(coalesce(p_body, ''), 500), 'Nickel', 'active');
    begin
      insert into admin_notifications (kind, title, body, url, severity, dedupe_key, silent)
      values ('settlements', left(v_title, 200), left(coalesce(p_body, ''), 500), p_url, 'info', v_key, true)
      on conflict (dedupe_key) do nothing;
    exception when others then null; end;
    v := 'held';
  end if;
  return v;
exception when others then
  begin perform admin_notify('settlements', v_title, p_body, p_url, null, 'warning', v_key); exception when others then null; end;
  return 'bell';
end $$;

-- Pull a dollar amount like "$12.34" or "$1,203.00" out of text.
create or replace function public.settlement_amount_cents(p text) returns integer
language sql immutable as $$
  select (replace((regexp_match(coalesce(p, ''), '\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)'))[1], ',', '')::numeric * 100)::int;
$$;

-- Core: mark a claim paid (idempotent). Used by the button, the mail trigger and the email trigger.
create or replace function public.settlement_paid_internal(p_id uuid, p_via text, p_ref text, p_amount_cents integer default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare c settlement_claims; s settlements; v_amt text;
begin
  select * into c from settlement_claims where id = p_id for update;
  if not found then return false; end if;
  if c.status = 'paid' then
    if p_amount_cents is not null and c.amount_cents is null then
      update settlement_claims set amount_cents = p_amount_cents, updated_at = now() where id = p_id;
    end if;
    return false;
  end if;
  update settlement_claims set status = 'paid', paid_at = now(), paid_via = p_via, paid_ref = p_ref,
         amount_cents = coalesce(p_amount_cents, amount_cents), updated_at = now() where id = p_id;
  perform settlement_log(p_id, 'paid', jsonb_build_object('via', p_via, 'ref', p_ref, 'amount_cents', p_amount_cents));
  select * into s from settlements where id = c.settlement_id;
  v_amt := case when coalesce(p_amount_cents, c.amount_cents) is not null
                then ' $' || to_char(coalesce(p_amount_cents, c.amount_cents) / 100.0, 'FM999,990.00') else '' end;
  if p_via <> 'button' then
    perform settlement_notify(
      case p_via when 'mail' then 'Check likely in your mailbox: ' || s.name
                 else 'Money in' || v_amt || ': ' || s.name end,
      case p_via when 'mail' then 'USPS shows mail from ' || coalesce(s.administrator, 'the settlement administrator')
                   || ' today. I checked it off. Not a check? Tap Undo on the Settlements page.'
                 else 'A payment email arrived. I checked it off.' end,
      'paid', 'https://bestly.tech/admin/settlements', 'paid.' || p_id::text);
  end if;
  return true;
end $$;

-- ------------------------------------------------------------------ paid detection: USPS Informed Delivery
-- wall_mail_pieces rows are filled in by the mail reader (sender/what read off the envelope scan).
create or replace function public.settlement_check_mail() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_text text := lower(coalesce(new.sender, '') || ' ' || coalesce(new.what, '') || ' ' || coalesce(new.summary, '') || ' ' || coalesce(new.ocr, ''));
  v_hit uuid; v_n int := 0; v_admin boolean;
begin
  if coalesce(new.sender, new.summary, new.ocr) is null then return new; end if;
  -- 1) a specific claim: the settlement name, defendant or administrator shows on the envelope
  for v_hit in
    select c.id from settlement_claims c join settlements s on s.id = c.settlement_id
    where c.status in ('filed', 'approved', 'filing', 'needs_you')
      and ( (length(coalesce(s.defendant, '')) >= 4 and v_text like '%' || lower(s.defendant) || '%')
         or (length(coalesce(s.administrator, '')) >= 4 and v_text like '%' || lower(s.administrator) || '%')
         or (length(s.name) >= 6 and v_text like '%' || lower(regexp_replace(s.name, '\s*(class action\s*)?settlement$', '', 'i')) || '%') )
  loop
    v_n := v_n + 1;
    if v_n = 1 then perform settlement_paid_internal(v_hit, 'mail', new.key, null); end if;
  end loop;
  if v_n > 0 then return new; end if;
  -- 2) looks like settlement mail but names no claim we filed: park it for him to sort
  select exists (select 1 from settlement_admins a where v_text ilike a.pattern) into v_admin;
  if v_admin then
    insert into settlement_unmatched (via, ref, summary) values ('mail', new.key, coalesce(new.summary, new.sender))
    on conflict (ref) do nothing;
  end if;
  return new;
exception when others then
  return new;  -- never break the mail reader
end $$;

drop trigger if exists settlement_check_mail on public.wall_mail_pieces;
create trigger settlement_check_mail after insert or update of sender, what, summary, ocr on public.wall_mail_pieces
  for each row execute function public.settlement_check_mail();

-- ------------------------------------------------------------------ paid detection + filing receipts: email
create or replace function public.settlement_check_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_text text := lower(coalesce(new.from_name, '') || ' ' || coalesce(new.from_addr, '') || ' ' || coalesce(new.subject, '') || ' '
                             || left(coalesce(new.body_text, ''), 4000));
  v_pay boolean; v_receipt boolean; v_hit uuid; v_amt int; v_conf text; v_admin boolean;
begin
  v_pay := v_text ~ '(you''ve got money|sent you \$|paid you|payment (has been )?(issued|sent|is on its way)|your settlement payment|digital payment|virtual (prepaid )?card|e-?check|claim payment|has been deposited)';
  v_receipt := v_text ~ '(claim (has been )?(received|submitted)|thank you for (submitting|filing) your claim|claim (id|number|confirmation))';
  if not (v_pay or v_receipt) then return new; end if;
  select c.id into v_hit from settlement_claims c join settlements s on s.id = c.settlement_id
   where c.status not in ('paid', 'skipped', 'expired', 'denied')
     and ( (length(coalesce(s.defendant, '')) >= 4 and v_text like '%' || lower(s.defendant) || '%')
        or (length(s.name) >= 6 and v_text like '%' || lower(regexp_replace(s.name, '\s*(class action\s*)?settlement$', '', 'i')) || '%') )
   order by c.filed_at desc nulls last limit 1;
  v_amt := settlement_amount_cents(new.subject || ' ' || left(coalesce(new.body_text, ''), 4000));
  if v_hit is not null then
    if v_pay then
      perform settlement_paid_internal(v_hit, 'email', coalesce(new.message_id, new.id::text), v_amt);
    elsif v_receipt then
      v_conf := (regexp_match(v_text, 'claim (?:id|number|confirmation)(?: number)?[:#\s]*([a-z0-9-]{5,})'))[1];
      update settlement_claims set status = case when status in ('found', 'ready', 'approved', 'filing', 'needs_you') then 'filed' else status end,
             filed_at = coalesce(filed_at, new.sent_at, now()), confirmation = coalesce(confirmation, upper(v_conf)), updated_at = now()
       where id = v_hit;
      perform settlement_log(v_hit, 'receipt_email', jsonb_build_object('ref', coalesce(new.message_id, new.id::text), 'confirmation', v_conf));
    end if;
  elsif v_pay then
    select exists (select 1 from settlement_admins a where v_text ilike a.pattern) into v_admin;
    if v_admin then
      insert into settlement_unmatched (via, ref, summary, amount_cents)
      values ('email', coalesce(new.message_id, new.id::text), left(coalesce(new.from_name, new.from_addr) || ' — ' || coalesce(new.subject, ''), 200), v_amt)
      on conflict (ref) do nothing;
    end if;
  end if;
  return new;
exception when others then
  return new;  -- never break mail sync
end $$;

drop trigger if exists settlement_check_email on public.bestly_mail;
create trigger settlement_check_email after insert on public.bestly_mail
  for each row execute function public.settlement_check_email();

-- ------------------------------------------------------------------ admin RPCs (the page)
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
        'paid_at', c.paid_at, 'paid_via', c.paid_via, 'notes', c.notes,
        'settlement', jsonb_build_object('name', s.name, 'defendant', s.defendant, 'administrator', s.administrator,
           'claim_url', s.claim_url, 'info_url', s.info_url, 'class_definition', s.class_definition,
           'proof_required', s.proof_required, 'est_payout', s.est_payout, 'deadline', s.deadline, 'status', s.status))
        order by s.deadline nulls last, c.created_at)
      from settlement_claims c join settlements s on s.id = c.settlement_id
      where c.status <> 'skipped' or c.updated_at > now() - interval '30 days'), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'via', via, 'summary', summary, 'amount_cents', amount_cents, 'at', at) order by at desc)
      from settlement_unmatched where not resolved), '[]'::jsonb),
    'paid_total_cents', coalesce((select sum(amount_cents) from settlement_claims where status = 'paid'), 0),
    'paid_count', (select count(*) from settlement_claims where status = 'paid'),
    'paid_unknown_amount', (select count(*) from settlement_claims where status = 'paid' and amount_cents is null),
    'last_scan', (select max(found_at) from settlements),
    'worker', (select jsonb_build_object('last_ok_at', last_ok_at, 'last_summary', last_summary, 'ok', last_ok) from pi_jobs where job = 'settlement-finder')
  ) into v;
  return v;
end $$;

-- "Yes, file all": approves every claim currently Ready. Each Ready claim was shown to him with its class definition.
create or replace function public.settlement_approve_all(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  with u as (
    update settlement_claims c set status = 'approved', approved_at = now(), updated_at = now()
    from settlements s where s.id = c.settlement_id and c.status = 'ready' and s.status = 'open'
      and (s.deadline is null or s.deadline >= (now() at time zone 'America/Los_Angeles')::date)
      and (p_ids is null or c.id = any(p_ids))
    returning c.id)
  select count(*) into n from u;
  insert into settlement_events (claim_id, kind, detail)
    select id, 'approved', jsonb_build_object('by', 'jared', 'batch', p_ids is null) from settlement_claims
    where status = 'approved' and approved_at > now() - interval '5 seconds';
  return n;
end $$;

-- Answer the one yes/no for a claim Nickel could not prove from records.
create or replace function public.settlement_answer(p_id uuid, p_yes boolean) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  update settlement_claims set answer = p_yes,
    status = case when p_yes then 'ready' else 'skipped' end,
    evidence = case when p_yes then evidence || jsonb_build_array(jsonb_build_object('kind', 'answer', 'summary', 'You said yes: ' || coalesce(question, ''))) else evidence end,
    updated_at = now()
  where id = p_id and status in ('found', 'ready');
  perform settlement_log(p_id, 'answered', jsonb_build_object('yes', p_yes));
  return case when p_yes then 'ready' else 'skipped' end;
end $$;

create or replace function public.settlement_skip(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  update settlement_claims set status = 'skipped', updated_at = now() where id = p_id and status not in ('filed', 'paid');
  perform settlement_log(p_id, 'skipped', '{}'::jsonb);
end $$;

-- The "Got paid" button. Amount optional.
create or replace function public.settlement_mark_paid(p_id uuid, p_amount_cents integer default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  perform settlement_paid_internal(p_id, 'button', 'jared', p_amount_cents);
end $$;

-- Undo an automatic check-off (the mail was not a check).
create or replace function public.settlement_undo_paid(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  update settlement_claims set status = 'filed', paid_at = null, paid_via = null, paid_ref = null, updated_at = now()
   where id = p_id and status = 'paid';
  perform settlement_log(p_id, 'undo_paid', '{}'::jsonb);
end $$;

-- Mark that he filed one himself (from the needs-you link), optionally with the confirmation number.
create or replace function public.settlement_mark_filed(p_id uuid, p_confirmation text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  update settlement_claims set status = 'filed', filed_at = coalesce(filed_at, now()), confirmation = coalesce(nullif(p_confirmation, ''), confirmation),
         needs_you_url = null, needs_you_why = null, updated_at = now()
   where id = p_id and status in ('approved', 'filing', 'needs_you', 'ready');
  perform settlement_log(p_id, 'filed_by_jared', jsonb_build_object('confirmation', p_confirmation));
end $$;

-- Assign an unmatched mail piece / email to a claim (marks it paid) or dismiss it.
create or replace function public.settlement_unmatched_resolve(p_unmatched bigint, p_claim uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare u settlement_unmatched;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select * into u from settlement_unmatched where id = p_unmatched;
  if p_claim is not null then perform settlement_paid_internal(p_claim, u.via, u.ref, u.amount_cents); end if;
  update settlement_unmatched set resolved = true where id = p_unmatched;
end $$;

-- ------------------------------------------------------------------ worker RPCs (Pi finder, Mac mini filer)
-- Token = the house watchdog token (db_watchdog_ok), same as the Code Worker.
create or replace function public.settlement_upsert_t(p_token text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v_id uuid;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into settlements (source_key, name, defendant, administrator, claim_url, info_url, class_definition, proof_required,
                             est_payout, deadline, payout_methods, status, source, raw)
    values (r->>'source_key', r->>'name', r->>'defendant', r->>'administrator', r->>'claim_url', r->>'info_url', r->>'class_definition',
            (r->>'proof_required')::boolean, r->>'est_payout', nullif(r->>'deadline', '')::date,
            coalesce(array(select jsonb_array_elements_text(r->'payout_methods')), '{}'), coalesce(r->>'status', 'open'), r->>'source', coalesce(r->'raw', '{}'::jsonb))
    on conflict (source_key) do update set
      name = excluded.name, defendant = coalesce(excluded.defendant, settlements.defendant),
      administrator = coalesce(excluded.administrator, settlements.administrator),
      claim_url = coalesce(excluded.claim_url, settlements.claim_url), info_url = coalesce(excluded.info_url, settlements.info_url),
      class_definition = coalesce(excluded.class_definition, settlements.class_definition),
      proof_required = coalesce(excluded.proof_required, settlements.proof_required),
      est_payout = coalesce(excluded.est_payout, settlements.est_payout), deadline = coalesce(excluded.deadline, settlements.deadline),
      payout_methods = case when cardinality(excluded.payout_methods) > 0 then excluded.payout_methods else settlements.payout_methods end,
      status = excluded.status, updated_at = now()
    returning id into v_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Settlements the matcher has not judged yet (or open ones with no claim row).
create or replace function public.settlement_unjudged_t(p_token text, p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(to_jsonb(s)) from (
    select s.* from settlements s left join settlement_claims c on c.settlement_id = s.id
    where s.status = 'open' and c.id is null
      and (s.deadline is null or s.deadline >= (now() at time zone 'America/Los_Angeles')::date)
    order by s.deadline nulls last limit p_limit) s), '[]'::jsonb);
end $$;

-- Matcher verdict. 'no' rows are kept (so they are not judged again) but never shown.
create or replace function public.settlement_judge_t(p_token text, p_settlement uuid, p_match text, p_evidence jsonb, p_question text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  insert into settlement_claims (settlement_id, match, evidence, question, status)
  values (p_settlement, p_match, coalesce(p_evidence, '[]'::jsonb), p_question,
          case p_match when 'no' then 'skipped' when 'ask' then 'found' else 'ready' end)
  on conflict (settlement_id) do update set match = excluded.match, evidence = excluded.evidence,
     question = coalesce(excluded.question, settlement_claims.question), updated_at = now()
  returning id into v_id;
  perform settlement_log(v_id, 'judged', jsonb_build_object('match', p_match));
  return v_id;
end $$;

-- Filer: claims he approved, oldest first. Takes them (status filing) so two runs never double-file.
create or replace function public.settlement_take_approved_t(p_token text, p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  with t as (
    update settlement_claims c set status = 'filing', updated_at = now()
    where c.id in (select id from settlement_claims where status = 'approved'
                     or (status = 'filing' and updated_at < now() - interval '2 hours')
                   order by approved_at limit p_limit for update skip locked)
    returning c.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'evidence', t.evidence, 'settlement', to_jsonb(s))), '[]'::jsonb) into v
  from t join settlements s on s.id = t.settlement_id;
  return v;
end $$;

-- Filer result: filed (with confirmation) or needs_you (CAPTCHA etc., with a prefilled link and why).
create or replace function public.settlement_filed_t(p_token text, p_id uuid, p_ok boolean, p_confirmation text default null,
  p_payout_method text default null, p_needs_you_url text default null, p_why text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if p_ok then
    update settlement_claims set status = 'filed', filed_at = now(), confirmation = p_confirmation, payout_method = p_payout_method,
           needs_you_url = null, needs_you_why = null, updated_at = now() where id = p_id;
    perform settlement_log(p_id, 'filed', jsonb_build_object('confirmation', p_confirmation, 'payout', p_payout_method));
  else
    update settlement_claims set status = 'needs_you', needs_you_url = p_needs_you_url, needs_you_why = p_why, updated_at = now() where id = p_id;
    perform settlement_log(p_id, 'needs_you', jsonb_build_object('why', p_why));
  end if;
end $$;

-- Evidence source for the matcher: his own email, searched by keywords (subjects + senders only, last 8 years).
create or replace function public.settlement_mail_search_t(p_token text, p_terms text[], p_limit integer default 8) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'from', coalesce(from_name, from_addr), 'subject', subject, 'sent_at', sent_at)) from (
    select id, from_name, from_addr, subject, sent_at from bestly_mail m
    where exists (select 1 from unnest(p_terms) t where length(t) >= 3 and
                  (m.subject ilike '%' || t || '%' or m.from_name ilike '%' || t || '%' or m.from_addr ilike '%' || t || '%'))
    order by sent_at desc limit p_limit) x), '[]'::jsonb);
end $$;

insert into public.security_public_rpcs (fn, why) values
  ('settlement_upsert_t', 'Pi settlement finder (watchdog token)'),
  ('settlement_unjudged_t', 'Pi settlement finder (watchdog token)'),
  ('settlement_judge_t', 'Pi settlement matcher (watchdog token)'),
  ('settlement_mail_search_t', 'Pi settlement matcher (watchdog token)'),
  ('settlement_take_approved_t', 'Mac mini settlement filer (watchdog token)'),
  ('settlement_filed_t', 'Mac mini settlement filer (watchdog token)')
on conflict (fn) do nothing;

revoke all on function public.settlement_paid_internal(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.settlement_notify(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.settlement_log(uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ daily digest + deadlines (pg_cron, free, no AI)
create or replace function public.settlement_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_ready int; v_ask int; v_needs int; v_names text; v_body text; v_soon record;
begin
  update settlement_claims c set status = 'expired', updated_at = now() from settlements s
   where s.id = c.settlement_id and c.status in ('found', 'ready') and s.deadline < v_today;
  select count(*) filter (where c.status = 'ready'), count(*) filter (where c.status = 'found' and c.match = 'ask'),
         count(*) filter (where c.status = 'needs_you'),
         string_agg(s.name, ', ' order by s.deadline nulls last) filter (where c.status = 'ready')
    into v_ready, v_ask, v_needs, v_names
    from settlement_claims c join settlements s on s.id = c.settlement_id;
  if v_ready + v_ask + v_needs > 0 then
    v_body := concat_ws(' ',
      case when v_ready > 0 then v_ready || ' ready to file: ' || left(v_names, 300) || '. Yes, file all = you are in each class.' end,
      case when v_ask > 0 then v_ask || ' need a quick yes/no.' end,
      case when v_needs > 0 then v_needs || ' need you to hit submit.' end);
    perform settlement_notify(
      case when v_ready > 0 then v_ready || ' settlement' || case when v_ready = 1 then '' else 's' end || ' ready to file'
           else 'Settlements need a quick answer' end,
      v_body, 'digest', 'https://bestly.tech/admin/settlements', 'digest.' || v_today::text);
  end if;
  -- deadline under 72 hours and still not filed
  for v_soon in
    select c.id, s.name, s.deadline from settlement_claims c join settlements s on s.id = c.settlement_id
    where c.status in ('found', 'ready', 'needs_you') and c.match <> 'no' and s.deadline between v_today and v_today + 3
  loop
    perform settlement_notify('Deadline ' || to_char(v_soon.deadline, 'Mon FMDD') || ': ' || v_soon.name,
      'Last chance to file this one.', 'deadline', 'https://bestly.tech/admin/settlements', 'deadline.' || v_soon.id::text);
  end loop;
  return jsonb_build_object('ready', v_ready, 'ask', v_ask, 'needs_you', v_needs);
end $$;
revoke all on function public.settlement_daily() from public, anon, authenticated;

-- 9:05 AM Pacific daylight (16:05 UTC). The finder runs on the Pi at 7:20 AM so the digest is fresh.
select cron.unschedule('settlement-daily') where exists (select 1 from cron.job where jobname = 'settlement-daily');
select cron.schedule('settlement-daily', '5 16 * * *', $c$select public.settlement_daily()$c$);

-- ------------------------------------------------------------------ the employee
insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('settlement-finder', 'Nickel: finds open class action settlements and checks which ones Jared qualifies for (free AI)', 1560, true)
on conflict (job) do nothing;

select public.team_onboard($j$[
 {"slug":"settlements","name":"Nickel","role":"Settlements Clerk","reports_to":"scout","runs_on":"pi","icon":"badge-dollar-sign",
  "schedule":"Daily 7:20 AM finder, 9:05 AM digest; mail and email checks all day","admin_url":"/admin/settlements",
  "what_it_does":"Finds open class action settlements every morning and checks your email and receipts to see which ones you are actually part of. Sends one digest a day; one tap on Yes, file all and he files them (if a site has a CAPTCHA, he hands you the filled-in form to submit). Then he watches your USPS mail scans and your inbox and checks each claim off the moment a check or payment shows up. You can also tap Got paid.",
  "pulse":{"src":"pi_job","key":"settlement-finder","gap":1560,"alert":true,"also":["settlement-daily"]},
  "owns":["settle."]}
]$j$::jsonb);

insert into public.notification_owners (prefix, agent_slug, note)
values ('settle', 'settlements', 'Class action settlements: digest, deadlines, money arriving')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;
