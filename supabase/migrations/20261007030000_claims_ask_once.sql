-- Claims Closer asked Jared the same garage question three times (3:28, 3:42, 3:44 PM on Oct 6) and every ask buzzed twice
-- ("Claims Closer: ..." plus a "System Monitor: ..." copy, then a "Fixed: ..." when answered).
--   * A question key is asked ONCE per case, ever. Answered or open, the same row comes back; nothing new is inserted or pushed.
--   * The bestly_raise copy is gone: questions are Claims Closer's own (Jared's rule: alerts are signed by the employee who
--     owns them), and the Claims page + Needs you already carry them.
create or replace function public.claims_ask(p_case uuid, p_question text, p_options jsonb default '[]'::jsonb,
  p_key text default null, p_kind text default 'decision') returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; c claim_cases; v_who text;
begin
  select * into c from claim_cases where id = p_case;
  v_who := coalesce(c.guest_first, 'a case');
  if p_key is not null then
    select id into v_id from claim_questions where case_id = p_case and key = p_key order by asked_at limit 1;
    if v_id is not null then return v_id; end if;
  else
    -- no key: the same wording on the same case is the same question
    select id into v_id from claim_questions where case_id = p_case and question = left(p_question, 600) order by asked_at limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into claim_questions (case_id, key, kind, question, options) values (p_case, p_key, p_kind, left(p_question, 600), coalesce(p_options, '[]'::jsonb)) returning id into v_id;
  insert into claim_events (case_id, reservation_id, kind, title, detail)
    values (p_case, c.reservation_id, 'question', case when p_kind = 'fyi' then 'FYI: ' else 'Asked Jared: ' end || left(p_question, 160), jsonb_build_object('question_id', v_id));
  if p_kind = 'fyi' then
    perform claims_notify('FYI on ' || v_who || '''s claim', left(p_question, 220), 'info', 'claims-ask-' || v_id);
  else
    perform claims_notify('Needs your answer on ' || v_who || '''s claim', left(p_question, 220), 'warning', 'claims-ask-' || v_id);
  end if;
  return v_id;
end $$;
revoke all on function public.claims_ask(uuid, text, jsonb, text, text) from anon, authenticated, public;

-- clean up the repeat garage questions: keep the first (answered "yes"); retire the copies
update public.claim_questions q set answer = coalesce(q.answer, 'yes'), answered_at = coalesce(q.answered_at, now()), handled_at = coalesce(q.handled_at, now())
where q.key = 'garage-claim' and q.id <> (select id from public.claim_questions f where f.case_id = q.case_id and f.key = 'garage-claim' order by asked_at limit 1);
delete from public.claim_questions q
where q.key = 'garage-claim' and q.id <> (select id from public.claim_questions f where f.case_id = q.case_id and f.key = 'garage-claim' order by asked_at limit 1);
