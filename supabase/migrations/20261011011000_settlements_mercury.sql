-- Nickel: payment tracking through Mercury (2026-10-10). Jared: "they should track payments on each through Mercury".
-- Every settlement claim shows the money that actually landed. One ledger (settlement_payments) takes rows from three
-- places: the old paid signals (mail / email / "Got paid" button -> trigger), and Mercury deposits (Pi job
-- settlement-mercury -> settlement_mercury_ingest_t, matched to a claim by administrator / settlement name, or by exact
-- amount for PayPal / Venmo / Zelle transfers).
--
-- Applied in chunks (part 1 tables, part 2 ledger trigger, part 3 admin RPCs, part 4 ingest, part 5 card). No DROP,
-- no top-level UPDATE / DELETE: DROP statements auto-cancel from chat. Data fixes live inside functions.
-- READ-ONLY toward the bank: nothing here or in the worker moves money or calls a Mercury write endpoint.
--
-- privacy_data_map: no rows needed. settlement_payments and settlement_unmatched_bank hold no emails or phones:
-- counterparty is a company / person NAME from the bank feed, and ingest scrubs any email or phone number out of the
-- description before it is stored.

-- ------------------------------------------------------------------ part 1: tables
create table if not exists public.settlement_payments (
  id bigserial primary key,
  claim_id uuid not null references public.settlement_claims(id) on delete cascade,
  source text not null check (source in ('mercury', 'paypal', 'mail', 'email', 'button')),
  amount_cents integer,
  posted_at timestamptz,
  counterparty text,
  description text,
  txn_id text not null unique,                  -- 'mercury:<id>' or 'claim:<claim id>:<via>'
  created_at timestamptz not null default now()
);
create index if not exists settlement_payments_claim_idx on public.settlement_payments (claim_id, posted_at desc);
alter table public.settlement_payments enable row level security;
-- No policies: the page reads through settlement_payments_list(); workers write through token RPCs.

alter table public.settlement_claims add column if not exists paid_source text;

-- Bank credits that look like settlement money but could not be tied to exactly one claim (the existing
-- settlement_unmatched only allows via mail / email and its constraint cannot be altered from chat).
create table if not exists public.settlement_unmatched_bank (
  id bigserial primary key,
  txn_id text not null unique,                  -- 'mercury:<id>'
  amount_cents integer,
  posted_at timestamptz,
  counterparty text,
  description text,
  why text,                                     -- 'no claim matched' | 'more than one claim matched'
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.settlement_unmatched_bank enable row level security;

-- ------------------------------------------------------------------ part 2: ledger trigger (mail / email / button)
create or replace function public.settlement_payments_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and new.paid_via in ('mail', 'email', 'button') then
    insert into settlement_payments (claim_id, source, amount_cents, posted_at, txn_id)
    values (new.id, new.paid_via, new.amount_cents, coalesce(new.paid_at, now()), 'claim:' || new.id || ':' || new.paid_via)
    on conflict (txn_id) do update
      set amount_cents = coalesce(excluded.amount_cents, settlement_payments.amount_cents);
  elsif old.status = 'paid' and new.status <> 'paid' then
    -- "Undo" on an automatic check-off: those ledger rows were guesses. Bank rows (Mercury) stay: that money landed.
    delete from settlement_payments where claim_id = new.id and source in ('mail', 'email', 'button') and txn_id like 'claim:%';
  end if;
  return new;
exception when others then
  return new;  -- never break marking a claim paid
end $$;

create or replace trigger settlement_payments_ledger after update of status, amount_cents on public.settlement_claims
  for each row execute function public.settlement_payments_ledger();

-- Claims already paid before this existed get their ledger row once (insert only).
insert into public.settlement_payments (claim_id, source, amount_cents, posted_at, txn_id)
select c.id, c.paid_via, c.amount_cents, coalesce(c.paid_at, c.updated_at), 'claim:' || c.id || ':' || c.paid_via
  from public.settlement_claims c
 where c.status = 'paid' and c.paid_via in ('mail', 'email', 'button')
on conflict (txn_id) do nothing;

-- ------------------------------------------------------------------ part 3: admin RPCs (the page)
-- One row per payment. Where Mercury shows the real deposit for a claim, the earlier guesses (mail / email / button)
-- for that same claim are left out so the money is not counted twice.
create or replace function public.settlement_payments_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'claim_id', p.claim_id, 'source', p.source, 'amount_cents', p.amount_cents,
             'posted_at', p.posted_at, 'counterparty', p.counterparty, 'txn_id', p.txn_id)
           order by p.posted_at desc nulls last, p.id desc)
      from settlement_payments p
     where p.source = 'mercury'
        or not exists (select 1 from settlement_payments m where m.claim_id = p.claim_id and m.source = 'mercury')), '[]'::jsonb);
end $$;

-- Bank credits waiting for a human (could be a settlement check, could be something else).
create or replace function public.settlement_bank_unmatched_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'txn_id', u.txn_id, 'amount_cents', u.amount_cents,
           'posted_at', u.posted_at, 'counterparty', u.counterparty, 'description', u.description, 'why', u.why)
           order by u.posted_at desc nulls last)
      from settlement_unmatched_bank u where not u.resolved), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ part 4: Mercury ingest
-- Word-boundary match, so the administrator "Rust" does not light up on "trust".
create or replace function public.settlement_has_word(p_text text, p_term text) returns boolean
language sql immutable as $$
  select p_term is not null and length(btrim(p_term)) >= 4
     and coalesce(p_text, '') ~* ('\m' || regexp_replace(btrim(p_term), '([^a-zA-Z0-9 ])', '\\\1', 'g') || '\M');
$$;

-- Record one bank deposit against a claim (idempotent on txn_id). Marks the claim paid when it is not yet.
create or replace function public.settlement_bank_credit(p_claim uuid, p_txn text, p_cents integer, p_posted timestamptz,
  p_counterparty text, p_description text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c settlement_claims; s settlements; v_new_paid boolean := false; v_amt text;
begin
  select * into c from settlement_claims where id = p_claim for update;
  if not found then return false; end if;
  insert into settlement_payments (claim_id, source, amount_cents, posted_at, counterparty, description, txn_id)
  values (p_claim, 'mercury', p_cents, p_posted, left(p_counterparty, 120), left(p_description, 300), p_txn)
  on conflict (txn_id) do nothing;
  if not found then return false; end if;
  v_new_paid := c.status <> 'paid';
  update settlement_claims set
    amount_cents = coalesce(amount_cents, p_cents),
    status = 'paid',
    paid_at = case when c.status = 'paid' then coalesce(paid_at, p_posted) else coalesce(p_posted, now()) end,
    paid_source = 'mercury',
    paid_ref = case when c.status = 'paid' then coalesce(paid_ref, p_txn) else p_txn end,
    updated_at = now()
   where id = p_claim;
  perform settlement_log(p_claim, 'paid_mercury', jsonb_build_object('txn', p_txn, 'amount_cents', p_cents, 'was_paid', not v_new_paid));
  select * into s from settlements where id = c.settlement_id;
  v_amt := ' $' || to_char(p_cents / 100.0, 'FM999,990.00');
  perform settlement_notify('Money in' || v_amt || ': ' || s.name,
    'Landed in Mercury' || case when p_counterparty is not null then ' from ' || left(p_counterparty, 60) else '' end
      || case when v_new_paid then '. I checked the claim off.' else '. Now the claim shows the exact amount.' end,
    'paid', 'https://bestly.tech/admin/settlements', 'bank.' || p_txn);
  return true;
end $$;

-- Pi job -> credits from Mercury. p_txns = [{id, amount (dollars), postedAt, counterpartyName, bankDescription, note, kind}].
create or replace function public.settlement_mercury_ingest_t(p_token text, p_txns jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t jsonb; v_id text; v_txn text; v_cents int; v_posted timestamptz; v_cp text; v_desc text; v_text text;
  v_ids uuid[]; v_narrow uuid[]; v_hint boolean; v_money boolean; v_admin boolean; v_why text;
  n_matched int := 0; n_unmatched int := 0; n_skipped int := 0; n_new_paid int := 0;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  for t in select * from jsonb_array_elements(coalesce(p_txns, '[]'::jsonb)) loop
    v_id := t->>'id';
    v_txn := 'mercury:' || v_id;
    begin v_cents := round((t->>'amount')::numeric * 100)::int; exception when others then v_cents := null; end;
    -- credits only; money moving between his own Mercury accounts and failed / cancelled rows are never settlements
    if v_id is null or v_cents is null or v_cents <= 0
       or lower(coalesce(t->>'kind', '')) in ('internaltransfer', 'treasurytransfer')
       or lower(coalesce(t->>'status', 'sent')) in ('failed', 'cancelled', 'reversed', 'blocked')
       or exists (select 1 from settlement_payments where txn_id = v_txn)
       or exists (select 1 from settlement_unmatched_bank where txn_id = v_txn) then
      n_skipped := n_skipped + 1; continue;
    end if;
    begin v_posted := coalesce(nullif(t->>'postedAt', '')::timestamptz, nullif(t->>'date', '')::timestamptz, now());
    exception when others then v_posted := now(); end;
    v_cp := nullif(btrim(coalesce(t->>'counterpartyName', '')), '');
    v_desc := concat_ws(' | ', nullif(btrim(coalesce(t->>'bankDescription', '')), ''), nullif(btrim(coalesce(t->>'note', '')), ''));
    -- keep emails and phone numbers out of the stored text
    v_desc := regexp_replace(regexp_replace(v_desc, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'),
                             '\+?[0-9][0-9 ().-]{8,}[0-9]', '[number]', 'g');
    v_text := lower(coalesce(v_cp, '') || ' ' || coalesce(v_desc, ''));
    v_hint := v_text ~ '(settlement|class action|claims? (admin|payment|fund)|claimant)';

    -- candidates: claims still waiting for money (or paid with no amount recorded yet)
    with cand as (
      select c.id, c.amount_cents,
        ( settlement_has_word(v_text, s.administrator)
          or settlement_has_word(v_text, regexp_replace(s.name, '\s*(class action\s*)?settlement$', '', 'i'))
          or exists (select 1 from settlement_admins a
                      where v_text ilike a.pattern and a.label not in ('Settlement administrator', 'Claims administrator', 'Settlement fund', 'Class action')
                        and coalesce(s.administrator, '') ilike '%' || a.label || '%') ) as strong,
        ( v_hint and settlement_has_word(v_text, s.defendant) ) as weak
      from settlement_claims c join settlements s on s.id = c.settlement_id
      where c.status in ('filed', 'approved', 'filing', 'needs_you') or (c.status = 'paid' and c.amount_cents is null))
    select coalesce(array(select id from cand where strong), '{}'), coalesce(array(select id from cand where weak), '{}')
      into v_ids, v_narrow;
    if cardinality(v_ids) = 0 then v_ids := v_narrow; end if;
    if cardinality(v_ids) > 1 then
      v_narrow := array(select c.id from settlement_claims c where c.id = any(v_ids) and c.amount_cents = v_cents);
      if cardinality(v_narrow) = 1 then v_ids := v_narrow; end if;
    end if;
    v_why := case when cardinality(v_ids) > 1 then 'more than one claim matched' else 'no claim matched' end;
    -- PayPal / Venmo / Zelle: the sender name says nothing, so only an exact amount ties it to one claim
    if cardinality(v_ids) = 0 and v_text ~ '(paypal|venmo|zelle|cash ?app)' then
      v_ids := array(select c.id from settlement_claims c
                      where c.amount_cents = v_cents and (c.status in ('filed', 'approved', 'filing', 'needs_you')));
      if cardinality(v_ids) > 1 then v_why := 'more than one claim matched'; end if;
    end if;

    if cardinality(v_ids) = 1 then
      if exists (select 1 from settlement_claims where id = v_ids[1] and status <> 'paid') then n_new_paid := n_new_paid + 1; end if;
      if settlement_bank_credit(v_ids[1], v_txn, v_cents, v_posted, v_cp, v_desc) then n_matched := n_matched + 1; else n_skipped := n_skipped + 1; end if;
    else
      select exists (select 1 from settlement_admins a where v_text ilike a.pattern) into v_admin;
      v_money := v_admin or v_hint or cardinality(v_ids) > 1;
      if v_money and v_text !~ '(^|\W)(turo|stripe|mercury io|app store)(\W|$)' then
        insert into settlement_unmatched_bank (txn_id, amount_cents, posted_at, counterparty, description, why)
        values (v_txn, v_cents, v_posted, left(v_cp, 120), left(v_desc, 300), v_why) on conflict (txn_id) do nothing;
        n_unmatched := n_unmatched + 1;
        perform settlement_notify('Bank deposit to sort: $' || to_char(v_cents / 100.0, 'FM999,990.00'),
          coalesce(left(v_cp, 60), 'Unknown sender') || ' looks like settlement money but I could not tie it to one claim. Pick the claim on the Settlements page.',
          'recap', 'https://bestly.tech/admin/settlements', 'bank.unmatched.' || v_txn);
      else
        n_skipped := n_skipped + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('matched', n_matched, 'unmatched', n_unmatched, 'skipped', n_skipped, 'newly_paid', n_new_paid);
end $$;

-- Admin picks the claim for a parked bank deposit (or dismisses it with no claim).
create or replace function public.settlement_bank_unmatched_resolve(p_unmatched bigint, p_claim uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare u settlement_unmatched_bank;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select * into u from settlement_unmatched_bank where id = p_unmatched;
  if not found then return; end if;
  if p_claim is not null then
    perform settlement_bank_credit(p_claim, u.txn_id, u.amount_cents, u.posted_at, u.counterparty, u.description);
  end if;
  update settlement_unmatched_bank set resolved = true where id = p_unmatched;
end $$;

revoke all on function public.settlement_payments_list(), public.settlement_bank_unmatched_list(),
  public.settlement_bank_unmatched_resolve(bigint, uuid) from public, anon;
grant execute on function public.settlement_payments_list(), public.settlement_bank_unmatched_list(),
  public.settlement_bank_unmatched_resolve(bigint, uuid) to authenticated, service_role;
revoke all on function public.settlement_bank_credit(uuid, text, integer, timestamptz, text, text), public.settlement_payments_ledger() from public, anon, authenticated;
revoke all on function public.settlement_mercury_ingest_t(text, jsonb) from public;
grant execute on function public.settlement_mercury_ingest_t(text, jsonb) to anon, authenticated, service_role;

-- Public-key RPC the Pi calls with the publishable key (token-gated inside): keep the Auto-Fixer off it.
insert into public.security_public_rpcs (fn, why) values
  ('settlement_mercury_ingest_t', 'Pi settlement-mercury job (watchdog token)')
on conflict (fn) do nothing;

-- ------------------------------------------------------------------ part 5: the employee
insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('settlement-mercury', 'Bank Watch: matches Mercury deposits to settlement claims (read-only Mercury API)', 300, true)
on conflict (job) do nothing;

select public.team_onboard($j$[
 {"slug":"settlement-mercury","name":"Bank Watch","role":"Matches Mercury deposits to settlements","tool_of":"settlements","runs_on":"pi","icon":"landmark",
  "schedule":"Every 2 hours",
  "what_it_does":"Checks your Mercury account every two hours and matches any deposit from a settlement (checks you deposited, PayPal transfers, administrator payments) to the right claim, so each one shows exactly what you got and when.",
  "pulse":{"src":"pi_job","key":"settlement-mercury","gap":300,"alert":true},
  "owns":["settle.bank."]}
]$j$::jsonb);
