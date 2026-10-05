-- 2026-10-05 The coach sometimes skipped a call with the prompt's placeholder as its reason ("<a few words>", "...").
-- Such a skip is saved as failed instead, so the next run (or the next free model) reviews the call properly.
create or replace function public.coach_save(p_source text, p_call uuid, p_review jsonb, p_provider text, p_model text, p_error text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_flags text[]; v_no bigint; v_status text;
begin
  -- a skip must say why: a blank or copied-placeholder reason means the model didn't really look, so retry the call
  if coalesce((p_review->>'skip')::boolean, false) and p_error is null
     and (length(trim(coalesce(p_review->>'went_well', ''))) < 6 or p_review->>'went_well' ~* '[<>]|\.\.\.|few words') then
    p_error := 'skipped without a real reason';
  end if;
  v_status := case when p_error is not null then 'failed' when coalesce((p_review->>'skip')::boolean, false) then 'skipped' else 'done' end;
  v_flags := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_review->'rule_flags', '[]')) x where x <> ''), '{}');
  if p_source = 'roofguard' then
    select call_no into v_no from rg_calls where id = p_call;
    insert into rg_call_reviews as r (call_id, call_no, status, scores, impulse, objections, went_well, work_on, rule_flags, overall, confidence,
                                      playbook_arms, provider, model, error)
    values (p_call, v_no, v_status, p_review->'scores', p_review->'impulse',
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_review->'objections', '[]')) x), '{}'),
            left(p_review->>'went_well', 400), left(p_review->>'work_on', 400), v_flags,
            (p_review->>'overall')::numeric, (p_review->>'confidence')::numeric,
            (select playbook_arms from rg_calls where id = p_call), p_provider, p_model, left(p_error, 400))
    on conflict (call_id) do update set status = excluded.status,
      scores = case when excluded.status = 'failed' then r.scores else excluded.scores end,
      impulse = case when excluded.status = 'failed' then r.impulse else excluded.impulse end,
      objections = excluded.objections, went_well = coalesce(excluded.went_well, r.went_well),
      work_on = case when excluded.status = 'failed' then r.work_on else excluded.work_on end,
      rule_flags = excluded.rule_flags,
      overall = case when excluded.status = 'failed' then r.overall else excluded.overall end,
      confidence = case when excluded.status = 'failed' then r.confidence else excluded.confidence end,
      provider = excluded.provider, model = excluded.model, error = excluded.error, tries = r.tries + 1, updated_at = now();
    if v_status = 'done' and cardinality(v_flags) > 0 then
      perform scout_notify(p_title => 'RoofGuard Ava: my coach flagged call #' || coalesce(v_no::text, '?'),
        p_body => 'Hard-rule check: ' || array_to_string(v_flags, ', ') || '. Open the call on /admin/roofguard to hear it.',
        p_severity => 'warning', p_push => true, p_url => '/admin/roofguard#scorecard', p_dedupe => 'rg-coach-flag-' || p_call);
    end if;
  else
    select call_no into v_no from ava_calls where id = p_call;
    insert into ava_call_reviews as r (call_id, call_no, status, scores, went_well, work_on, rule_flags, overall, provider, model, error)
    values (p_call, v_no, v_status, p_review->'scores', left(p_review->>'went_well', 400), left(p_review->>'work_on', 400), v_flags,
            (p_review->>'overall')::numeric, p_provider, p_model, left(p_error, 400))
    on conflict (call_id) do update set status = excluded.status,
      scores = case when excluded.status = 'failed' then r.scores else excluded.scores end,
      went_well = coalesce(excluded.went_well, r.went_well),
      work_on = case when excluded.status = 'failed' then r.work_on else excluded.work_on end,
      rule_flags = excluded.rule_flags,
      overall = case when excluded.status = 'failed' then r.overall else excluded.overall end,
      provider = excluded.provider, model = excluded.model, error = excluded.error, tries = r.tries + 1, updated_at = now();
    if v_status = 'done' and cardinality(v_flags) > 0 then
      perform scout_notify(p_title => 'Ava: my coach flagged call #' || coalesce(v_no::text, '?'),
        p_body => 'Check: ' || array_to_string(v_flags, ', ') || '. Open the call on /admin/ava.',
        p_severity => 'warning', p_push => true, p_url => '/admin/ava', p_dedupe => 'ava-coach-flag-' || p_call);
    end if;
  end if;
end $$;
revoke all on function public.coach_save(text, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.coach_save(text, uuid, jsonb, text, text, text) to service_role;

