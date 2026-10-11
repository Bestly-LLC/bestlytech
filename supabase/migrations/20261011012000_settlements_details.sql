-- Nickel: richer eligibility info per settlement (2026-10-10).
-- Jared: "each card needs richer information, I need to know more if I qualify."
--   settlements.details       jsonb  - who qualifies, class period, places, exclusions, payouts, proof, how to check, official links
--   settlement_claims.reasoning text - Nickel's 1-3 plain sentences on why he might qualify and what would prove it
-- Worker RPCs (Pi settlement-finder, watchdog token): settlement_needs_details_t, settlement_details_t, settlement_reason_t.
-- details shape (the settlements page reads exactly this):
--   {who_qualifies:[..], class_period:{start,end}, locations:[..], excluded:[..], payout_no_proof, payout_with_proof,
--    proof_examples:[..], how_to_check, official_site, claim_form, fetched_at}

-- chunk 1: columns
alter table public.settlements add column if not exists details jsonb;
alter table public.settlement_claims add column if not exists reasoning text;

-- chunk 2: what still needs details (stale > 14 days or never) or a reasoning line
create or replace function public.settlement_needs_details_t(p_token text, p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select s.id, s.source_key, s.name, s.defendant, s.administrator, s.claim_url, s.info_url, s.class_definition,
           s.proof_required, s.est_payout, s.deadline, s.payout_methods, s.source, s.raw, s.details,
           c.id as claim_id, c.match as claim_match, c.status as claim_status, c.question as claim_question,
           c.fact_key as claim_fact_key, c.evidence as claim_evidence, c.reasoning as claim_reasoning, c.answer as claim_answer,
           (s.details is null or coalesce(nullif(s.details->>'fetched_at', '')::timestamptz, 'epoch'::timestamptz) < now() - interval '14 days') as need_details
      from settlements s left join settlement_claims c on c.settlement_id = s.id
     where s.status = 'open'
       and (s.deadline is null or s.deadline >= (now() at time zone 'America/Los_Angeles')::date)
       and (s.details is null
            or coalesce(nullif(s.details->>'fetched_at', '')::timestamptz, 'epoch'::timestamptz) < now() - interval '14 days'
            or (c.id is not null and c.match <> 'no' and c.reasoning is null))
     order by (c.id is not null and c.match <> 'no' and c.status in ('found', 'ready', 'approved', 'needs_you', 'filing')) desc,
              (c.id is not null and c.match <> 'no') desc,
              (c.id is not null) desc,
              s.deadline nulls last
     limit greatest(1, least(coalesce(p_limit, 40), 200))) x), '[]'::jsonb);
end $$;

-- chunk 3: save details (shape-checked, trimmed) and reasoning
create or replace function public.settlement_details_t(p_token text, p_settlement uuid, p_details jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then raise exception 'details must be a json object'; end if;
  v := p_details || jsonb_build_object('fetched_at', coalesce(nullif(p_details->>'fetched_at', ''), to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  -- keep the arrays arrays and the period an object so the page never trips on a bad shape
  if jsonb_typeof(v->'who_qualifies') is distinct from 'array' then v := v || '{"who_qualifies":[]}'; end if;
  if jsonb_typeof(v->'locations') is distinct from 'array' then v := v || '{"locations":[]}'; end if;
  if jsonb_typeof(v->'excluded') is distinct from 'array' then v := v || '{"excluded":[]}'; end if;
  if jsonb_typeof(v->'proof_examples') is distinct from 'array' then v := v || '{"proof_examples":[]}'; end if;
  if jsonb_typeof(v->'class_period') is distinct from 'object' then v := v || '{"class_period":{"start":null,"end":null}}'; end if;
  update settlements set details = v where id = p_settlement;
  return found;
end $$;

create or replace function public.settlement_reason_t(p_token text, p_claim uuid, p_reasoning text,
  p_question text default null, p_fact_question text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_key text; v_n int; v_q text := nullif(trim(coalesce(p_question, '')), ''); v_fq text := nullif(trim(coalesce(p_fact_question, '')), '');
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  update settlement_claims set reasoning = nullif(left(trim(coalesce(p_reasoning, '')), 700), ''),
         -- sharper wording (specific dates and places) only while the claim is still waiting on his answer
         question = case when v_q is not null and length(v_q) between 12 and 200 and status = 'found' and answer is null then v_q else question end,
         updated_at = now()
   where id = p_claim returning fact_key into v_key;
  if not found then return false; end if;
  -- the shared fact question stays generic: only reworded when this claim is the only one resting on an unanswered fact
  if v_fq is not null and v_key is not null and length(v_fq) between 12 and 200 then
    select count(*) into v_n from settlement_claims where fact_key = v_key;
    if v_n = 1 then update settlement_facts set question = v_fq, updated_at = now() where key = v_key and answer is null; end if;
  end if;
  return true;
end $$;

-- chunk 4: allowlist (Ares' Auto-Fixer would otherwise lock them within the hour)
insert into public.security_public_rpcs (fn, why) values
  ('settlement_needs_details_t', 'Pi settlement details phase (watchdog token)'),
  ('settlement_details_t', 'Pi settlement details phase (watchdog token)'),
  ('settlement_reason_t', 'Pi settlement details phase (watchdog token)')
on conflict (fn) do nothing;
