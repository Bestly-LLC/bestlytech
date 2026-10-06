-- Claims Closer v2 core (2026-10-06), docs/claims-closer-v2-opusplan.md phases 1, 2, 3, 4, 7, 10 (schema + RPCs).
-- Jared: "All I want to do is submit claim, then let it book, then go to the appointment." Fully hands-off: guest messages,
-- shop estimate requests and the Turo invoice go out on their own (reviewGuard / moneyGuard / Scout consults stay).
-- Only booking waits for Jared's "Book it". Nothing here spends Jared's money; the parking garage is never contacted without a yes.
--
--   claims_settings       one row: autonomy full | guest_approval, home, max shop miles, shops per request
--   claim_cases (+cols)   Turo status / next action / deadline / invoice max / guest answer / damage report (synced by the Pi reader)
--   claim_evidence        before/after photos pulled from Turo into the private claim-evidence bucket
--   claim_shops           body shops (seeded), ranked by quality, Tesla experience, distance
--   claim_estimates       one row per shop asked: requested -> replied -> received (amount, OEM, repair vs replace) | declined | no_reply
--   claim_turo_actions    queue the Pi reader works inside Turo (create_invoice | mark_insurer | escalate), claimed like claims_send_claim
--   claim_questions       Claims Closer asking Scout / Jared when it is unsure (claims_ask), answered on the Claims page
--   triggers              shop reply mail (bestly_mail) wakes the case
--   claims_watch          10-minute self-heal: stale evidence sync, stuck Turo actions, silent shops
-- Everything is signed "Claims Closer" (claims_notify).

-- ---------------------------------------------------------------- bucket
insert into storage.buckets (id, name, public) values ('claim-evidence', 'claim-evidence', false) on conflict (id) do nothing;

-- ---------------------------------------------------------------- settings
create table if not exists public.claims_settings (
  id boolean primary key default true check (id),
  autonomy text not null default 'full' check (autonomy in ('full', 'guest_approval')),
  home_lat double precision not null default 34.0857,
  home_lng double precision not null default -118.3714,
  max_shop_miles numeric not null default 15,
  shops_per_request int not null default 3,
  updated_at timestamptz not null default now()
);
insert into public.claims_settings (id) values (true) on conflict do nothing;
alter table public.claims_settings enable row level security;
revoke all on public.claims_settings from anon, authenticated;

-- ---------------------------------------------------------------- case columns
alter table public.claim_cases
  add column if not exists turo_status text,
  add column if not exists turo_next_action text,
  add column if not exists turo_deadline timestamptz,
  add column if not exists invoice_max numeric,
  add column if not exists guest_response jsonb,
  add column if not exists damage_report jsonb,
  add column if not exists turo_invoice jsonb,
  add column if not exists synced_at timestamptz,
  add column if not exists chosen_shop_id uuid,
  add column if not exists chosen_estimate_id uuid,
  add column if not exists estimates_requested_at timestamptz,
  add column if not exists repair_booking jsonb,
  add column if not exists next_check_at timestamptz;

-- ---------------------------------------------------------------- evidence
create table if not exists public.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.claim_cases(id) on delete cascade,
  uuid text not null unique,                    -- Turo's photo uuid; never downloaded twice
  kind text not null,                           -- before | after
  step text, description text,
  storage_path text not null,
  taken_at timestamptz, width int, height int, bytes int,
  created_at timestamptz not null default now()
);
create index if not exists claim_evidence_case_idx on public.claim_evidence (case_id, kind, taken_at);
alter table public.claim_evidence enable row level security;
revoke all on public.claim_evidence from anon, authenticated;

-- ---------------------------------------------------------------- shops
create table if not exists public.claim_shops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null, address text, phone text, email text, website text, booking_url text,
  lat double precision, lng double precision, distance_mi numeric,
  rating numeric, rating_count int,
  tesla_experience boolean not null default false,
  photo_estimates boolean not null default true,
  oem_capable boolean not null default false,
  oem_only boolean not null default false,       -- only ever worth asking when the repair is covered in full
  warranty text, notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.claim_shops enable row level security;
revoke all on public.claim_shops from anon, authenticated;

create or replace function public.claims_miles(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns numeric language sql immutable as $$
  select round((3958.8 * 2 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))))::numeric, 1)
$$;

insert into public.claim_shops (slug, name, address, phone, email, website, booking_url, lat, lng, rating, rating_count, tesla_experience, photo_estimates, oem_capable, oem_only, warranty, notes) values
 ('pristine-fairfax', 'Pristine Collision Center', '919 N Fairfax Ave, West Hollywood, CA 90046', '(323) 456-4551', 'fairfax@pristinecollisioncenter.com',
  'https://pristinecollisioncenter.com', 'https://pristinecollisioncenter.com/booking', 34.0878186, -118.3616813, 4.7, 168, true, true, true, false,
  'Lifetime paint warranty', 'Closest shop. OEM-certified. Reviews mention Tesla work.'),
 ('pristine-hollywood', 'Pristine Collision Center Hollywood', '7318 Sunset Blvd, Los Angeles, CA 90046', '(323) 366-2610', 'hollywood@pristinecollisioncenter.com',
  'https://pristinecollisioncenter.com', 'https://pristinecollisioncenter.com/booking', 34.0978568, -118.3503839, 5.0, 50, true, true, true, false,
  null, 'Same company as the Fairfax shop. Tesla reviews.'),
 ('premium-collision', 'Premium Collision Center', '7068 Lexington Ave, West Hollywood, CA 90038', '(323) 464-2200', 'pccoffice@premiumcollisioncenter.com',
  'https://premiumcollisioncenter.com', 'https://www.carwise.com/auto-body-shops/book-appointment/premium-collision-center-inc-west-hollywood-ca-90038/491425', 34.092412, -118.343502, 4.8, 212, false, true, false, false,
  null, 'Takes photo estimates online (Carwise).'),
 ('paulee-kenduco', 'Paulee Body Shop (Kenduco)', '1115 S La Cienega Blvd, Los Angeles, CA 90035', '(310) 652-5373', 'general@pauleebodyshop.com',
  'https://pauleebodyshop.com', null, 34.0563889, -118.3763889, 4.4, 150, false, true, false, false,
  null, 'Jared used them before (Gus).'),
 ('ace-tech', 'Ace Tech Collision Center', '4334 W Pico Blvd, Los Angeles, CA 90019', '(323) 935-5000', null,
  'https://acetechauto.com', 'https://acetechauto.com/book-repair', 34.0477623, -118.3292757, 4.7, 432, true, true, true, false,
  null, 'Tesla Approved Body Shop. Many Tesla reviews. No public email; Ava calls.'),
 ('agc-collision', 'AGC Collision Center', '3424 Sunset Blvd, Los Angeles, CA 90026', '(323) 663-8076', 'info@agccollision.com',
  'https://agccollision.com', null, 34.0879053, -118.2764202, 4.7, 261, true, true, true, false,
  null, 'EV-certified. Tesla reviews.'),
 ('crashfix', 'CrashFix', '2222 S Sepulveda Blvd, Los Angeles, CA 90064', '(310) 731-9009', null,
  null, null, 34.039788, -118.4373493, 5.0, 89, true, true, false, false,
  null, 'Bumper repair specialists (repair vs replace). No public email; Ava calls.'),
 ('avio-coachcraft', 'Avio Coach Craft', '2245 Pontius Ave, Los Angeles, CA 90064', '(310) 312-1128', 'info@aviocoachcraft.com',
  'https://aviocoachcraft.com', null, 34.0384928, -118.4376436, 4.9, 196, true, true, true, false,
  'Lifetime warranty on work', 'Tesla Approved Body Shop (OEM path).'),
 ('tesla-collision-nh', 'Tesla Collision North Hollywood', '13005 Sherman Way, North Hollywood, CA 91605', '(818) 299-9196', null,
  'https://www.tesla.com/findus/location/bodyshop/teslacollisionnorthhollywood', null, 34.2008697, -118.4161667, 1.0, 5, true, false, true, true,
  null, 'Tesla''s own body shop. Far, poor reviews. Only when a third party pays everything.')
on conflict (slug) do nothing;
update public.claim_shops s set distance_mi = claims_miles(c.home_lat, c.home_lng, s.lat, s.lng) from public.claims_settings c where s.distance_mi is null;

-- ---------------------------------------------------------------- estimates
create table if not exists public.claim_estimates (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.claim_cases(id) on delete cascade,
  shop_id uuid not null references public.claim_shops(id),
  channel text not null default 'email' check (channel in ('email', 'call', 'web', 'walk_in')),
  ref text,                                      -- short code in the email subject, used to match replies
  requested_at timestamptz not null default now(),
  followup_at timestamptz, call_at timestamptz, call_id uuid,
  status text not null default 'requested' check (status in ('requested', 'replied', 'received', 'declined', 'no_reply', 'needs_visit')),
  replied_at timestamptz,
  amount numeric, oem boolean, repair_vs_replace text, line_items jsonb, doc_path text,
  mail_id uuid, notes text,
  chosen boolean not null default false, chosen_reason text,
  created_at timestamptz not null default now()
);
create index if not exists claim_estimates_case_idx on public.claim_estimates (case_id, status);
alter table public.claim_estimates enable row level security;
revoke all on public.claim_estimates from anon, authenticated;

-- ---------------------------------------------------------------- Turo action queue (worked by the Pi reader)
create table if not exists public.claim_turo_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.claim_cases(id) on delete cascade,
  kind text not null check (kind in ('create_invoice', 'mark_insurer', 'escalate')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'done', 'failed', 'cancelled')),
  attempts int not null default 0,
  result jsonb, error text,
  created_at timestamptz not null default now(), claimed_at timestamptz, done_at timestamptz
);
create index if not exists claim_turo_actions_idx on public.claim_turo_actions (status, created_at);
alter table public.claim_turo_actions enable row level security;
revoke all on public.claim_turo_actions from anon, authenticated;

-- ---------------------------------------------------------------- questions (Scout consult)
create table if not exists public.claim_questions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.claim_cases(id) on delete cascade,
  key text,                                      -- dedupe: one open question per (case, key)
  kind text not null default 'decision',         -- decision | fyi
  question text not null,
  options jsonb not null default '[]'::jsonb,    -- [{value, label}]
  answer text, asked_at timestamptz not null default now(), answered_at timestamptz, answered_by text
);
create unique index if not exists claim_questions_open_key on public.claim_questions (case_id, key) where answered_at is null and key is not null;
alter table public.claim_questions enable row level security;
revoke all on public.claim_questions from anon, authenticated;

-- ---------------------------------------------------------------- Scout consult: claims_ask / claims_answer
create or replace function public.claims_ask(p_case uuid, p_question text, p_options jsonb default '[]'::jsonb,
  p_key text default null, p_kind text default 'decision') returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; c claim_cases; v_who text;
begin
  select * into c from claim_cases where id = p_case;
  v_who := coalesce(c.guest_first, 'a case');
  if p_key is not null then
    select id into v_id from claim_questions where case_id = p_case and key = p_key and answered_at is null;
    if v_id is not null then return v_id; end if;
  end if;
  insert into claim_questions (case_id, key, kind, question, options) values (p_case, p_key, p_kind, left(p_question, 600), coalesce(p_options, '[]'::jsonb)) returning id into v_id;
  insert into claim_events (case_id, reservation_id, kind, title, detail)
    values (p_case, c.reservation_id, 'question', case when p_kind = 'fyi' then 'FYI for Scout: ' else 'Asked Scout: ' end || left(p_question, 160), jsonb_build_object('question_id', v_id));
  if p_kind = 'fyi' then
    perform claims_notify('FYI on ' || v_who || '''s claim', left(p_question, 220), 'info', 'claims-ask-' || v_id);
  else
    begin
      perform bestly_raise('claims.ask.' || v_id, 'problem', 'warning', 'Claims Closer needs an answer on ' || v_who || '''s claim', left(p_question, 400), 'turo', left(p_question, 200), false);
    exception when others then null; end;
  end if;
  return v_id;
end $$;
revoke all on function public.claims_ask(uuid, text, jsonb, text, text) from anon, authenticated, public;

create or replace function public.claims_answer(p_id uuid, p_answer text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare q claim_questions; c claim_cases;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update claim_questions set answer = left(p_answer, 600), answered_at = now(), answered_by = case when auth.role() = 'service_role' then 'scout' else 'jared' end
    where id = p_id and answered_at is null returning * into q;
  if q.id is null then return jsonb_build_object('ok', false, 'error', 'already answered or not found'); end if;
  select * into c from claim_cases where id = q.case_id;
  update claim_cases set needs_work = true, work_reason = 'question answered', updated_at = now() where id = q.case_id;
  insert into claim_events (case_id, reservation_id, kind, title, detail)
    values (q.case_id, c.reservation_id, 'answer', 'Answered: ' || left(p_answer, 120), jsonb_build_object('question_id', q.id));
  begin perform bestly_raise('claims.ask.' || q.id, 'resolved', 'info', 'Answered', null, 'turo', null, false); exception when others then null; end;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claims_answer(uuid, text) from anon, public;
grant execute on function public.claims_answer(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- Pi reader: evidence sync
create or replace function public.claims_sync_list(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('case_id', c.id, 'reservation_id', c.reservation_id, 'incident_id', c.turo_incident_id,
      'claim_no', c.turo_claim_no, 'synced_at', c.synced_at,
      'known', coalesce((select jsonb_agg(e.uuid) from claim_evidence e where e.case_id = c.id), '[]'::jsonb)))
    from claim_cases c where c.turo_incident_id is not null and not c.history and c.status not in ('paid', 'closed')), '[]'::jsonb);
end $$;
revoke all on function public.claims_sync_list(text) from anon, authenticated, public;
grant execute on function public.claims_sync_list(text) to anon;

-- p_data: {status, next_action, deadline (Turo local time, LA), invoice_max, host_deductible, guest_max, invoice, guest_response, damage_report}
create or replace function public.claims_sync_put(p_token text, p_case uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c claim_cases; v_next text := nullif(p_data->>'next_action', ''); v_dl timestamptz; v_changed text[] := '{}';
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  select * into c from claim_cases where id = p_case for update;
  if c.id is null then return jsonb_build_object('ok', false); end if;
  v_dl := case when nullif(p_data->>'deadline', '') is null then c.turo_deadline else ((p_data->>'deadline')::timestamp at time zone 'America/Los_Angeles') end;
  if v_next is not null and v_next is distinct from c.turo_next_action then v_changed := v_changed || 'next_action'; end if;
  if p_data->'guest_response' is not null and p_data->'guest_response' <> 'null'::jsonb and p_data->'guest_response' is distinct from c.guest_response then v_changed := v_changed || 'guest_response'; end if;
  if p_data->'invoice' is not null and p_data->'invoice' <> 'null'::jsonb and p_data->'invoice' is distinct from c.turo_invoice then v_changed := v_changed || 'invoice'; end if;
  update claim_cases set
    turo_status = coalesce(nullif(p_data->>'status', ''), turo_status),
    turo_next_action = coalesce(v_next, turo_next_action),
    turo_deadline = v_dl,
    invoice_max = coalesce((p_data->>'invoice_max')::numeric, invoice_max),
    host_responsibility = coalesce((p_data->>'host_deductible')::numeric, host_responsibility),
    guest_max = coalesce((p_data->>'guest_max')::numeric, guest_max),
    turo_invoice = case when p_data->'invoice' is null or p_data->'invoice' = 'null'::jsonb then turo_invoice else p_data->'invoice' end,
    guest_response = case when p_data->'guest_response' is null or p_data->'guest_response' = 'null'::jsonb then guest_response else p_data->'guest_response' end,
    damage_report = case when p_data->'damage_report' is null or p_data->'damage_report' = 'null'::jsonb then damage_report else p_data->'damage_report' end,
    synced_at = now(),
    needs_work = needs_work or cardinality(v_changed) > 0 or c.synced_at is null,
    work_reason = case when cardinality(v_changed) > 0 then 'Turo changed: ' || array_to_string(v_changed, ', ') else work_reason end,
    updated_at = now()
  where id = p_case;
  if cardinality(v_changed) > 0 then
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (p_case, c.reservation_id, 'turo', case when 'next_action' = any(v_changed) then 'Turo now says: ' || v_next else 'Turo updated the claim' end,
              jsonb_build_object('changed', v_changed, 'next_action', v_next));
  end if;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end $$;
revoke all on function public.claims_sync_put(text, uuid, jsonb) from anon, authenticated, public;
grant execute on function public.claims_sync_put(text, uuid, jsonb) to anon;

-- ---------------------------------------------------------------- Pi reader: Turo actions (create invoice etc.)
create or replace function public.claims_turo_claim(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
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
end $$;
revoke all on function public.claims_turo_claim(text) from anon, authenticated, public;
grant execute on function public.claims_turo_claim(text) to anon;

create or replace function public.claims_turo_done(p_token text, p_id uuid, p_ok boolean, p_result jsonb default null, p_error text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare a claim_turo_actions; c claim_cases;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update claim_turo_actions set status = case when p_ok then 'done' else 'failed' end, result = p_result, error = left(p_error, 400), done_at = now()
    where id = p_id and status = 'sending' returning * into a;
  if a.id is null then return; end if;
  select * into c from claim_cases where id = a.case_id;
  if p_ok then
    if a.kind = 'create_invoice' then
      update claim_cases set status = case when status in ('open', 'waiting_guest') then 'invoiced' else status end,
        turo_invoice = coalesce(p_result, turo_invoice), needs_work = true, work_reason = 'Turo invoice created', updated_at = now() where id = a.case_id;
    else
      update claim_cases set needs_work = true, work_reason = 'Turo action done: ' || a.kind, updated_at = now() where id = a.case_id;
    end if;
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (a.case_id, c.reservation_id, 'turo_action', 'Done in Turo: ' || replace(a.kind, '_', ' '), jsonb_build_object('action_id', a.id, 'result', p_result));
    perform claims_notify(case a.kind when 'create_invoice' then 'Invoice posted to ' || coalesce(c.guest_first, 'the guest') || ' in Turo'
                          else 'Done in Turo: ' || replace(a.kind, '_', ' ') end,
      case when a.kind = 'create_invoice' then 'The estimate is attached and the invoice for ' || coalesce('$' || (a.payload->>'amount'), 'the amount') || ' is on the claim.' else 'Updated on the claim.' end,
      'info', 'claims-turo-' || a.id);
  else
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (a.case_id, c.reservation_id, 'turo_action_failed', 'Turo action failed: ' || replace(a.kind, '_', ' '), jsonb_build_object('action_id', a.id, 'error', left(p_error, 300)));
    if a.attempts >= 2 or coalesce(p_error, '') ~* 'signed out|blocked' then
      perform claims_ask(a.case_id, 'I could not ' || replace(a.kind, '_', ' ') || ' in Turo (' || left(coalesce(p_error, 'unknown error'), 160) || '). Should I try again, or will you do it by hand?',
        '[{"value":"retry","label":"Try again"},{"value":"by_hand","label":"I will do it"}]'::jsonb, 'turo-action-' || a.id, 'decision');
    end if;
  end if;
end $$;
revoke all on function public.claims_turo_done(text, uuid, boolean, jsonb, text) from anon, authenticated, public;
grant execute on function public.claims_turo_done(text, uuid, boolean, jsonb, text) to anon;

-- ---------------------------------------------------------------- shop replies wake the case
create or replace function public.claims_shop_mail_trg() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare e claim_estimates; v_dom text := lower(split_part(coalesce(new.from_addr, ''), '@', 2));
begin
  if v_dom = '' or v_dom in ('bestly.tech', 'turo.com', 'claims.turo.com') then return new; end if;
  select x.* into e from claim_estimates x join claim_shops s on s.id = x.shop_id
    where x.status in ('requested', 'replied', 'received', 'needs_visit') and x.channel = 'email'
      and coalesce(new.sent_at, now()) >= x.requested_at - interval '2 minutes'
      and (lower(s.email) = lower(new.from_addr)
           or (v_dom not in ('gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'me.com', 'aol.com') and lower(split_part(coalesce(s.email, ''), '@', 2)) = v_dom)
           or (x.ref is not null and coalesce(new.subject, '') ilike '%' || x.ref || '%'))
    order by x.requested_at desc limit 1;
  if e.id is null then return new; end if;
  update claim_estimates set status = case when status = 'received' then status else 'replied' end, mail_id = new.id, replied_at = now() where id = e.id;
  update claim_cases set needs_work = true, work_reason = 'a shop replied', updated_at = now() where id = e.case_id;
  insert into claim_events (case_id, reservation_id, kind, title, detail, mail_id)
    select e.case_id, c.reservation_id, 'shop_mail', 'Shop replied: ' || left(coalesce(new.from_name, new.from_addr), 60), jsonb_build_object('estimate_id', e.id, 'subject', left(new.subject, 160)), new.id
    from claim_cases c where c.id = e.case_id;
  return new;
exception when others then return new;
end $$;
create or replace trigger claims_shop_mail_trg after insert on public.bestly_mail for each row execute function public.claims_shop_mail_trg();

-- ---------------------------------------------------------------- settings + manual estimate (Claims page)
create or replace function public.claims_settings_set(p_autonomy text default null, p_max_miles numeric default null, p_shops int default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_autonomy is not null and p_autonomy not in ('full', 'guest_approval') then raise exception 'bad autonomy'; end if;
  update claims_settings set autonomy = coalesce(p_autonomy, autonomy), max_shop_miles = coalesce(p_max_miles, max_shop_miles),
    shops_per_request = coalesce(p_shops, shops_per_request), updated_at = now() where id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claims_settings_set(text, numeric, int) from anon, public;
grant execute on function public.claims_settings_set(text, numeric, int) to authenticated;

create or replace function public.claims_estimate_add(p_case uuid, p_shop uuid, p_amount numeric, p_oem boolean default false, p_notes text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be above 0'; end if;
  insert into claim_estimates (case_id, shop_id, channel, status, amount, oem, notes, replied_at)
    values (p_case, p_shop, 'walk_in', 'received', p_amount, p_oem, left(p_notes, 400), now());
  update claim_cases set needs_work = true, work_reason = 'estimate added by hand', updated_at = now() where id = p_case;
  insert into claim_events (case_id, kind, title, detail) values (p_case, 'note', 'Jared added an estimate', jsonb_build_object('amount', p_amount, 'shop_id', p_shop));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.claims_estimate_add(uuid, uuid, numeric, boolean, text) from anon, public;
grant execute on function public.claims_estimate_add(uuid, uuid, numeric, boolean, text) to authenticated;

-- ---------------------------------------------------------------- the Claims page data
create or replace function public.claims_admin() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'sender', (select jsonb_build_object('claims_enabled', claims_enabled, 'links_enabled', enabled, 'seen_at', seen_at, 'last_error', last_error) from turo_sender_settings where id = 1),
    'beat', (select to_jsonb(b) from agent_beats b where slug = 'claims-closer'),
    'settings', (select to_jsonb(s) from claims_settings s where id),
    'reader', (select jsonb_build_object('seen_at', seen_at, 'signed_in', signed_in, 'version', version, 'last_error', last_error) from turo_reader_state where id = 1),
    'shops', coalesce((select jsonb_agg(to_jsonb(s) order by s.distance_mi) from claim_shops s where s.active), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(jsonb_build_object(
      'case', to_jsonb(c),
      'drafts', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc) from (select * from claim_drafts where case_id = c.id order by created_at desc limit 12) d), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (select id, at, kind, title, detail from claim_events where case_id = c.id order by at desc limit 40) e), '[]'::jsonb),
      'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'uuid', v.uuid, 'kind', v.kind, 'step', v.step, 'taken_at', v.taken_at, 'path', v.storage_path) order by v.kind, v.taken_at) from claim_evidence v where v.case_id = c.id), '[]'::jsonb),
      'estimates', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'shop_id', x.shop_id, 'shop', s.name, 'distance_mi', s.distance_mi, 'phone', s.phone, 'channel', x.channel,
          'status', x.status, 'requested_at', x.requested_at, 'replied_at', x.replied_at, 'amount', x.amount, 'oem', x.oem, 'repair_vs_replace', x.repair_vs_replace,
          'notes', x.notes, 'chosen', x.chosen, 'chosen_reason', x.chosen_reason) order by x.chosen desc, x.amount nulls last, x.requested_at)
          from claim_estimates x join claim_shops s on s.id = x.shop_id where x.case_id = c.id), '[]'::jsonb),
      'questions', coalesce((select jsonb_agg(to_jsonb(q) order by q.asked_at desc) from (select * from claim_questions where case_id = c.id order by asked_at desc limit 8) q), '[]'::jsonb),
      'turo_actions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (select id, kind, status, payload, error, created_at, done_at from claim_turo_actions where case_id = c.id order by created_at desc limit 5) t), '[]'::jsonb)
    ) order by (c.status in ('paid','closed')), c.opened_at desc) from claim_cases c), '[]'::jsonb));
end $$;
revoke all on function public.claims_admin() from anon, public;
grant execute on function public.claims_admin() to authenticated;

-- ---------------------------------------------------------------- tick (adds next_check_at) + the 10-minute watchdog
create or replace function public.claims_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_now_la timestamp := now() at time zone 'America/Los_Angeles'; v_daily boolean; v_work int; v_stuck int; v_open int;
begin
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
end $$;
revoke all on function public.claims_tick() from anon, authenticated, public;

create or replace function public.claims_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_stale int; v_signed boolean; v_stuck int; v_silent int; r record;
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

  -- 2. Turo actions stuck 'sending' 10+ min -> failed + a question (claims_turo_claim also fails them; this one tells Jared)
  for r in select a.id, a.case_id, a.kind from claim_turo_actions a where a.status = 'sending' and a.claimed_at < now() - interval '10 minutes' loop
    update claim_turo_actions set status = 'failed', error = 'reader stopped mid-action; check Turo before retrying', done_at = now() where id = r.id;
    perform claims_ask(r.case_id, 'The ' || replace(r.kind, '_', ' ') || ' in Turo stopped halfway. Please check the claim in Turo, then tell me whether to try again.',
      '[{"value":"retry","label":"Try again"},{"value":"done","label":"It went through"}]'::jsonb, 'turo-stuck-' || r.id, 'decision');
  end loop;

  -- 3. shop requests silent 72 h -> no_reply, and the worker asks the next shop
  for r in select e.id, e.case_id from claim_estimates e where e.status = 'requested' and e.requested_at < now() - interval '72 hours' loop
    update claim_estimates set status = 'no_reply' where id = r.id;
    update claim_cases set needs_work = true, work_reason = 'a shop never replied', updated_at = now() where id = r.case_id;
  end loop;
  select count(*) into v_silent from claim_estimates where status = 'requested' and requested_at < now() - interval '24 hours';
  return jsonb_build_object('stale', v_stale, 'silent_24h', v_silent);
end $$;
revoke all on function public.claims_watch() from anon, authenticated, public;

do $$ begin
  perform cron.unschedule('claims-watch') where exists (select 1 from cron.job where jobname = 'claims-watch');
  perform cron.schedule('claims-watch', '*/10 * * * *', 'select public.claims_watch()');
end $$;

-- ---------------------------------------------------------------- team card (CLAUDE.md: every automatic job on /admin/team)
select public.team_onboard($j$[
 {"slug":"claims-closer","name":"Claims Closer","role":"Damage claim negotiator","reports_to":"turo-reader","runs_on":"cloud","icon":"scale",
  "schedule":"every 2 min when a case needs work; Turo sync every 10 min; watchdog every 10 min; deadline check 9 AM",
  "what_it_does":"Sees a Turo damage claim through to payment. Reads the evidence from Turo, asks body shops for photo estimates, picks the best one, posts the Turo invoice, works the guest and their insurer, and asks Scout when unsure. Only booking the repair waits for Jared.",
  "admin_url":"/admin/claims","welcome":false,
  "pulse":{"src":"cron","job":"claims-closer-tick","gap":10,"also":["claims-watch"]},
  "owns":["claims."]}
]$j$::jsonb);
