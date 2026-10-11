-- Nickel: "answer once" (2026-10-10). One yes/no about a fact (owned an iPhone, lives in California, used Facebook)
-- now settles every settlement that rests on the same fact. Applied as part 1 of 4 (facts, proof RPCs, housekeeping,
-- admin status emails). No DROP statements (they auto-cancel from chat).
--
-- Rules kept: nothing is filed from here. A fact only moves a claim between found / ready / skipped and records the
-- answer as evidence. Claims that are approved / filing / needs_you / filed / paid / denied are never touched.
-- Marker on a claim moved by a fact: notes = 'fact:<key>=yes' or 'fact:<key>=no', so a later change of answer can
-- revive or undo exactly those claims and nothing else (a claim Jared skipped himself, or a duplicate, stays skipped).

alter table public.settlement_claims add column if not exists fact_key text;
create index if not exists settlement_claims_fact_idx on public.settlement_claims (fact_key) where fact_key is not null;

create table if not exists public.settlement_facts (
  key text primary key,
  question text not null,
  answer boolean,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.settlement_facts enable row level security;
-- No policies: the page reads through settlement_facts_list(); the Pi reads through settlement_facts_t().

-- Internal: record the fact and move every claim that rests on it. No admin check (callers guard); not callable by clients.
create or replace function public.settlement_fact_apply(p_key text, p_answer boolean, p_question text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_key text := lower(trim(coalesce(p_key, ''))); v_q text; n int := 0;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if v_key = '' then return 0; end if;
  insert into settlement_facts (key, question, answer, answered_at)
  values (v_key, coalesce(nullif(trim(coalesce(p_question, '')), ''), v_key), p_answer, case when p_answer is null then null else now() end)
  on conflict (key) do update set answer = p_answer, answered_at = case when p_answer is null then null else now() end, updated_at = now();
  select question into v_q from settlement_facts where key = v_key;

  if p_answer is true then
    with u as (
      update settlement_claims c set status = 'ready', answer = true, notes = 'fact:' || v_key || '=yes',
        evidence = case when exists (select 1 from jsonb_array_elements(c.evidence) e where e->>'kind' = 'answer') then c.evidence
                        else c.evidence || jsonb_build_array(jsonb_build_object('kind', 'answer', 'summary', 'You said yes: ' || v_q)) end,
        updated_at = now()
      from settlements s
      where s.id = c.settlement_id and c.fact_key = v_key and s.status = 'open'
        and (s.deadline is null or s.deadline >= v_today)
        and (c.status = 'found' or (c.status = 'skipped' and c.notes = 'fact:' || v_key || '=no'))
      returning c.id)
    insert into settlement_events (claim_id, kind, detail)
      select id, 'fact_answered', jsonb_build_object('fact', v_key, 'yes', true) from u;
    get diagnostics n = row_count;
  elsif p_answer is false then
    with u as (
      update settlement_claims c set status = 'skipped', answer = false, notes = 'fact:' || v_key || '=no',
        evidence = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(c.evidence) e where e->>'kind' <> 'answer'),
        updated_at = now()
      where c.fact_key = v_key and (c.status = 'found' or (c.status = 'ready' and c.notes = 'fact:' || v_key || '=yes'))
      returning c.id)
    insert into settlement_events (claim_id, kind, detail)
      select id, 'fact_answered', jsonb_build_object('fact', v_key, 'yes', false) from u;
    get diagnostics n = row_count;
  else
    -- forget: undo only what this fact did
    with u as (
      update settlement_claims c set status = 'found', answer = null, notes = null,
        evidence = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(c.evidence) e where e->>'kind' <> 'answer'),
        updated_at = now()
      where c.fact_key = v_key and c.status in ('ready', 'skipped')
        and c.notes in ('fact:' || v_key || '=yes', 'fact:' || v_key || '=no')
      returning c.id)
    insert into settlement_events (claim_id, kind, detail)
      select id, 'fact_forgotten', jsonb_build_object('fact', v_key) from u;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;
revoke all on function public.settlement_fact_apply(text, boolean, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ admin RPCs (the page)
create or replace function public.settlement_facts_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'key', f.key, 'question', f.question, 'answer', f.answer, 'answered_at', f.answered_at,
      'claims_count', (select count(*) from settlement_claims c join settlements s on s.id = c.settlement_id
                        where c.fact_key = f.key and c.status not in ('expired') and s.status = 'open'))
    order by (f.answer is not null), f.question)
    from settlement_facts f), '[]'::jsonb);
end $$;

-- Answer a fact once. p_answer null = forget. Returns how many claims moved.
create or replace function public.settlement_fact_set(p_key text, p_answer boolean) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'key required'; end if;
  return settlement_fact_apply(p_key, p_answer, null);
end $$;

-- Same signature as before. Now also records the fact behind this claim and settles its siblings.
create or replace function public.settlement_answer(p_id uuid, p_yes boolean) returns text
language plpgsql security definer set search_path = public as $$
declare c settlement_claims;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select * into c from settlement_claims where id = p_id;
  if found and c.fact_key is not null and c.status in ('found', 'ready') then
    perform settlement_fact_apply(c.fact_key, p_yes, c.question);
  end if;
  update settlement_claims set answer = p_yes,
    status = case when p_yes then 'ready' else 'skipped' end,
    evidence = case when p_yes and not exists (select 1 from jsonb_array_elements(evidence) e where e->>'kind' = 'answer')
                    then evidence || jsonb_build_array(jsonb_build_object('kind', 'answer', 'summary', 'You said yes: ' || coalesce(question, '')))
                    else evidence end,
    updated_at = now()
  where id = p_id and status in ('found', 'ready');
  perform settlement_log(p_id, 'answered', jsonb_build_object('yes', p_yes));
  return case when p_yes then 'ready' else 'skipped' end;
end $$;

revoke all on function public.settlement_facts_list() from public, anon;
revoke all on function public.settlement_fact_set(text, boolean) from public, anon;
grant execute on function public.settlement_facts_list() to authenticated;
grant execute on function public.settlement_fact_set(text, boolean) to authenticated;
