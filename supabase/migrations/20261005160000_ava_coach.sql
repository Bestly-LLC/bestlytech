-- 2026-10-05 The Coach, merged into the Scorecard (Jared: "build the coach so she gets better after every call; the coach
-- lives in or is merged with Scorecard"). Plan: docs/ava-learning-opusplan.md. Both Avas, kept separate (rg_* goes with
-- RoofGuard if it's ever sold; ava_* stays with personal Ava).
--
--   1. Every finished call gets a coach's review (ava-coach edge function, free AI on private providers, no paid AI):
--        RoofGuard Ava: the 5 Steps to a Sale scored 1-5 + impulse factors + objection tags + went well + one thing to
--        work on + hard-rule flags.   Personal Ava: name, message, urgency, callback, warm and brief, privacy.
--   2. Every Monday the coach reads the week and writes 1-3 small playbook changes (rg_playbook / ava_playbook).
--        RoofGuard: small wording changes start testing on their own; anything bigger waits for Jared ("Your call").
--        Each test runs on half her calls (A/B, arms saved on rg_calls.playbook_arms). rg_playbook_decide promotes the
--        winner or rolls the loser back. Personal Ava: every change waits for Jared's tap (too few calls to A/B).
--   3. The live playbook reaches her through the coach_notes dynamic variable: rg_coach_notes() / ava_coach_notes().
--        The hard rules, AI disclosure, DNC handling, hours and caps live outside it and the coach can't touch them;
--        playbook_guard() rejects any rule that tries.
--   4. Watchdog (coach_watch): calls with no review 30+ minutes after ending are retried every 10 minutes; if the coach
--        hasn't saved a review in 2 hours while calls wait, the owning Ava raises it (rg.coach / ava.coach).

-- ------------------------------------------------------------------ reviews
create table if not exists public.rg_call_reviews (
  call_id     uuid primary key references public.rg_calls(id) on delete cascade,
  call_no     bigint,
  status      text not null default 'done' check (status in ('done','failed','skipped')),
  scores      jsonb,                 -- {opening, qualify, present, close, rehash}: 1-5, null = step never reached
  impulse     jsonb,                 -- {indifference, honest_urgency, bolt_match, sounds_human}: 1-5
  objections  text[] not null default '{}',
  went_well   text,
  work_on     text,
  rule_flags  text[] not null default '{}',
  overall     numeric,               -- 1-5
  confidence  numeric,               -- 1-5: direct close, no hedging, short replies
  playbook_arms jsonb,
  provider    text, model text,
  tries       int not null default 1,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.ava_call_reviews (
  call_id     uuid primary key references public.ava_calls(id) on delete cascade,
  call_no     bigint,
  status      text not null default 'done' check (status in ('done','failed','skipped')),
  scores      jsonb,                 -- {name, message, urgency, callback, warm_brief, privacy}: 1-5, null = not applicable
  went_well   text,
  work_on     text,
  rule_flags  text[] not null default '{}',
  overall     numeric,
  provider    text, model text,
  tries       int not null default 1,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.rg_call_reviews enable row level security;
alter table public.ava_call_reviews enable row level security;
revoke all on public.rg_call_reviews from anon, authenticated;
revoke all on public.ava_call_reviews from anon, authenticated;

-- ------------------------------------------------------------------ playbook (the learned section of her script)
create table if not exists public.rg_playbook (
  id          uuid primary key default gen_random_uuid(),
  rule        text not null,
  why         text,
  kind        text not null default 'other' check (kind in ('comeback','wording','pacing','close','flow','other')),
  size        text not null default 'small' check (size in ('small','big')),
  status      text not null default 'proposed' check (status in ('proposed','testing','live','rolled_back','declined','retired')),
  origin      text not null default 'coach' check (origin in ('coach','incident','jared')),
  started_at  timestamptz,
  decided_at  timestamptz,
  result      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.ava_playbook (like public.rg_playbook including all);
alter table public.rg_playbook enable row level security;
alter table public.ava_playbook enable row level security;
revoke all on public.rg_playbook from anon, authenticated;
revoke all on public.ava_playbook from anon, authenticated;

alter table public.rg_calls add column if not exists playbook_arms jsonb;

-- a rule may never touch her hard rules (RoofGuard's list + the AI disclosure), and stays one short instruction
create or replace function public.playbook_guard(p_rule text) returns text
language sql immutable as $$
  select case
    when p_rule is null or length(trim(p_rule)) < 12 then 'too short'
    when length(p_rule) > 260 then 'too long (one short instruction only)'
    when p_rule ~* '\mreplac(e|ement|ing)\M' then 'says "replacement" (always roof renewal)'
    when p_rule ~* '\minsur(ance|ed|er)\M' then 'mentions insurance'
    when p_rule ~* '(deadline|expires?|limited time|only today|last chance|ends (this|on))' then 'invents urgency or a deadline'
    when p_rule ~* '(our partners|other (companies|buildings) (like|such as)|already (working|signed) with)' then 'implies partners or social proof we do not have'
    when p_rule ~* '(not an? (ai|bot|robot)|real person|i''?m (a )?human|deny|pretend)' then 'touches the AI disclosure'
    when p_rule ~* '(do not call|dnc|calling hours|cap|budget|max duration|record(ed|ing) line)' then 'touches calling rules'
    when p_rule ~* '(\$\s*\d|percent|% (off|savings)|you will (save|earn|make))' then 'makes a money promise or projection'
    when p_rule ~* '(ignore|override|forget) (the |your |all )?(rules|instructions|prompt)' then 'tries to override her instructions'
  end
$$;

-- ------------------------------------------------------------------ what the coach reads
-- transcript as plain lines, agent/user, opener excluded from nothing (the coach scores the opener too)
create or replace function public.coach_transcript(t jsonb) returns text
language sql immutable as $$
  select string_agg(case when x->>'role' = 'agent' then 'AVA: ' else 'THEM: ' end
                    || regexp_replace(coalesce(nullif(x->>'original_message', ''), x->>'message', ''), '\s+', ' ', 'g'), E'\n' order by o)
    from jsonb_array_elements(coalesce(t, '[]'::jsonb)) with ordinality e(x, o)
   where coalesce(nullif(x->>'original_message', ''), x->>'message', '') <> ''
$$;

create or replace function public.coach_next(p_source text, p_limit int default 4) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_source = 'roofguard' then
    return (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
      select c.id, c.call_no, c.direction, c.outcome, c.opener_key, c.dm_reached, c.kept_talking, c.is_test, c.duration_sec,
             c.summary, c.notes, c.playbook_arms, l.company, l.category,
             left(coach_transcript(c.transcript), 9000) transcript
        from rg_calls c left join rg_leads l on l.id = c.lead_id
        left join rg_call_reviews r on r.call_id = c.id
       where c.deleted_at is null and c.transcript is not null and jsonb_array_length(c.transcript) > 2
         and coalesce(c.duration_sec, 0) >= 10 and coalesce(c.ended_at, c.updated_at) > now() - interval '14 days'
         and (r.call_id is null or (r.status = 'failed' and r.tries < 3 and r.updated_at < now() - interval '20 minutes'))
       order by coalesce(c.ended_at, c.updated_at) desc limit p_limit) q);
  elsif p_source = 'ava' then
    return (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
      select c.id, c.call_no, c.direction, c.purpose, c.caller_name, c.summary, c.message, c.urgent, c.callback_wanted,
             c.forwarded, c.is_spam, c.duration_sec, left(coach_transcript(c.transcript), 9000) transcript
        from ava_calls c left join ava_call_reviews r on r.call_id = c.id
       where c.deleted_at is null and c.transcript is not null and jsonb_array_length(c.transcript) > 2
         and coalesce(c.duration_sec, 0) >= 10 and coalesce(c.ended_at, c.created_at) > now() - interval '14 days'
         and (r.call_id is null or (r.status = 'failed' and r.tries < 3 and r.updated_at < now() - interval '20 minutes'))
       order by coalesce(c.ended_at, c.created_at) desc limit p_limit) q);
  end if;
  raise exception 'source must be roofguard or ava';
end $$;
revoke all on function public.coach_next(text, int) from public, anon, authenticated;
grant execute on function public.coach_next(text, int) to service_role;

-- ------------------------------------------------------------------ the coach writes
create or replace function public.coach_save(p_source text, p_call uuid, p_review jsonb, p_provider text, p_model text, p_error text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_flags text[]; v_no bigint;
begin
  v_flags := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_review->'rule_flags', '[]')) x where x <> ''), '{}');
  if p_source = 'roofguard' then
    select call_no into v_no from rg_calls where id = p_call;
    insert into rg_call_reviews as r (call_id, call_no, status, scores, impulse, objections, went_well, work_on, rule_flags, overall, confidence,
                                      playbook_arms, provider, model, error)
    values (p_call, v_no, case when p_error is null then 'done' else 'failed' end, p_review->'scores', p_review->'impulse',
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_review->'objections', '[]')) x), '{}'),
            left(p_review->>'went_well', 400), left(p_review->>'work_on', 400), v_flags,
            (p_review->>'overall')::numeric, (p_review->>'confidence')::numeric,
            (select playbook_arms from rg_calls where id = p_call), p_provider, p_model, left(p_error, 400))
    on conflict (call_id) do update set status = excluded.status, scores = coalesce(excluded.scores, r.scores), impulse = coalesce(excluded.impulse, r.impulse),
      objections = excluded.objections, went_well = coalesce(excluded.went_well, r.went_well), work_on = coalesce(excluded.work_on, r.work_on),
      rule_flags = excluded.rule_flags, overall = coalesce(excluded.overall, r.overall), confidence = coalesce(excluded.confidence, r.confidence),
      provider = excluded.provider, model = excluded.model, error = excluded.error, tries = r.tries + 1, updated_at = now();
    -- a hard-rule slip goes to Jared right away, from RoofGuard Ava
    if p_error is null and cardinality(v_flags) > 0 then
      perform scout_notify(p_title => 'RoofGuard Ava: my coach flagged call #' || coalesce(v_no::text, '?'),
        p_body => 'Hard-rule check: ' || array_to_string(v_flags, ', ') || '. Open the call on /admin/roofguard to hear it.',
        p_severity => 'warning', p_push => true, p_url => '/admin/roofguard#scorecard', p_dedupe => 'rg-coach-flag-' || p_call);
    end if;
  else
    select call_no into v_no from ava_calls where id = p_call;
    insert into ava_call_reviews as r (call_id, call_no, status, scores, went_well, work_on, rule_flags, overall, provider, model, error)
    values (p_call, v_no, case when p_error is null then 'done' else 'failed' end, p_review->'scores',
            left(p_review->>'went_well', 400), left(p_review->>'work_on', 400), v_flags, (p_review->>'overall')::numeric,
            p_provider, p_model, left(p_error, 400))
    on conflict (call_id) do update set status = excluded.status, scores = coalesce(excluded.scores, r.scores),
      went_well = coalesce(excluded.went_well, r.went_well), work_on = coalesce(excluded.work_on, r.work_on), rule_flags = excluded.rule_flags,
      overall = coalesce(excluded.overall, r.overall), provider = excluded.provider, model = excluded.model, error = excluded.error,
      tries = r.tries + 1, updated_at = now();
    if p_error is null and cardinality(v_flags) > 0 then
      perform scout_notify(p_title => 'Ava: my coach flagged call #' || coalesce(v_no::text, '?'),
        p_body => 'Check: ' || array_to_string(v_flags, ', ') || '. Open the call on /admin/ava.',
        p_severity => 'warning', p_push => true, p_url => '/admin/ava', p_dedupe => 'ava-coach-flag-' || p_call);
    end if;
  end if;
end $$;
revoke all on function public.coach_save(text, uuid, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.coach_save(text, uuid, jsonb, text, text, text) to service_role;

-- what the weekly pass reads: the week's reviews in short form, the current playbook, and recent reply-guard incidents
create or replace function public.coach_week(p_source text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_source = 'roofguard' then
    return jsonb_build_object(
      'reviews', (select coalesce(jsonb_agg(jsonb_build_object('call', r.call_no, 'outcome', c.outcome, 'opener', c.opener_key,
                    'scores', r.scores, 'impulse', r.impulse, 'objections', r.objections, 'work_on', r.work_on, 'went_well', r.went_well)
                    order by r.created_at desc), '[]')
                  from rg_call_reviews r join rg_calls c on c.id = r.call_id
                 where r.status = 'done' and r.created_at > now() - interval '7 days' and not coalesce(c.is_test, false)),
      'playbook', (select coalesce(jsonb_agg(jsonb_build_object('rule', rule, 'status', status)), '[]') from rg_playbook
                    where status in ('proposed','testing','live') or (status = 'rolled_back' and decided_at > now() - interval '30 days')),
      'incidents', (select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'detail', left(coalesce(i.excerpt, ''), 200))), '[]')
                      from (select * from ava_reply_incidents where source = 'roofguard' and created_at > now() - interval '7 days' limit 20) i));
  end if;
  return jsonb_build_object(
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object('call', r.call_no, 'direction', c.direction, 'scores', r.scores,
                  'work_on', r.work_on, 'went_well', r.went_well) order by r.created_at desc), '[]')
                from ava_call_reviews r join ava_calls c on c.id = r.call_id
               where r.status = 'done' and r.created_at > now() - interval '7 days'),
    'playbook', (select coalesce(jsonb_agg(jsonb_build_object('rule', rule, 'status', status)), '[]') from ava_playbook
                  where status in ('proposed','testing','live')),
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'detail', left(coalesce(i.excerpt, ''), 200))), '[]')
                    from (select * from ava_reply_incidents where source = 'ava' and created_at > now() - interval '7 days' limit 20) i));
end $$;
revoke all on function public.coach_week(text) from public, anon, authenticated;
grant execute on function public.coach_week(text) to service_role;

-- the weekly pass proposes; RoofGuard small changes start testing right away (at most 2 tests at once), the rest wait
create or replace function public.coach_propose(p_source text, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v_bad text; v_kept int := 0; v_rejected jsonb := '[]'; v_testing int; v_status text; v_tbl text;
begin
  v_tbl := case when p_source = 'roofguard' then 'rg_playbook' else 'ava_playbook' end;
  for r in select * from jsonb_array_elements(coalesce(p_rules, '[]')) limit 3 loop
    v_bad := playbook_guard(r->>'rule');
    if v_bad is not null then v_rejected := v_rejected || jsonb_build_object('rule', r->>'rule', 'why', v_bad); continue; end if;
    -- same idea already in play
    if p_source = 'roofguard' then
      continue when exists (select 1 from rg_playbook p where p.status in ('proposed','testing','live') and text_overlap(p.rule, r->>'rule') >= 0.6);
      select count(*) into v_testing from rg_playbook where status = 'testing';
      v_status := case when coalesce(r->>'size', 'small') = 'small' and v_testing < 2 then 'testing' else 'proposed' end;
      insert into rg_playbook (rule, why, kind, size, status, started_at)
      values (trim(r->>'rule'), left(r->>'why', 500),
              case when r->>'kind' in ('comeback','wording','pacing','close','flow') then r->>'kind' else 'other' end,
              case when r->>'size' = 'big' then 'big' else 'small' end, v_status, case when v_status = 'testing' then now() end);
    else
      continue when exists (select 1 from ava_playbook p where p.status in ('proposed','live') and text_overlap(p.rule, r->>'rule') >= 0.6);
      insert into ava_playbook (rule, why, kind, size, status)
      values (trim(r->>'rule'), left(r->>'why', 500),
              case when r->>'kind' in ('comeback','wording','pacing','close','flow') then r->>'kind' else 'other' end,
              case when r->>'size' = 'big' then 'big' else 'small' end, 'proposed');
    end if;
    v_kept := v_kept + 1;
  end loop;
  return jsonb_build_object('kept', v_kept, 'rejected', v_rejected);
end $$;
revoke all on function public.coach_propose(text, jsonb) from public, anon, authenticated;
grant execute on function public.coach_propose(text, jsonb) to service_role;

-- ------------------------------------------------------------------ what reaches her on a call
-- RoofGuard: live rules always; each rule under test goes to a random half of her calls. Returns the text + the arms.
create or replace function public.rg_coach_notes() returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare v_arms jsonb := '{}'; v_lines text[] := '{}'; p record; v_on boolean;
begin
  for p in select id, rule, status from rg_playbook where status in ('live','testing') order by status desc, created_at loop
    if p.status = 'live' then v_lines := v_lines || ('- ' || p.rule);
    else
      v_on := random() < 0.5;
      v_arms := v_arms || jsonb_build_object(p.id::text, v_on);
      if v_on then v_lines := v_lines || ('- ' || p.rule); end if;
    end if;
  end loop;
  return jsonb_build_object('text', coalesce(array_to_string(v_lines, E'\n'), ''), 'arms', v_arms);
end $$;
revoke all on function public.rg_coach_notes() from public, anon, authenticated;
grant execute on function public.rg_coach_notes() to service_role;

create or replace function public.ava_coach_notes() returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(string_agg('- ' || rule, E'\n' order by created_at), '') from ava_playbook where status = 'live'
$$;
revoke all on function public.ava_coach_notes() from public, anon, authenticated;
grant execute on function public.ava_coach_notes() to service_role;

-- ------------------------------------------------------------------ RoofGuard tests: keep the winner, roll back the loser
-- Calls that reached a person (not voicemail / no answer), outbound, not tests. Score per arm:
--   3 x booked rate + kept-talking rate + 0.1 x average coach overall. Decide at 40 a side; stop early at 20 a side if
--   the rule is doing worse than half as well; after 21 days decide on what there is (15+ a side) or roll back.
create or replace function public.rg_playbook_decide() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p record; s record; v_done int := 0; v_verdict text; v_owner text := 'RoofGuard Ava';
begin
  for p in select * from rg_playbook where status = 'testing' loop
    select count(*) filter (where (c.playbook_arms->>p.id::text)::boolean) n_on,
           count(*) filter (where not (c.playbook_arms->>p.id::text)::boolean) n_off,
           coalesce(3 * avg((c.outcome = 'booked')::int) filter (where (c.playbook_arms->>p.id::text)::boolean), 0)
             + coalesce(avg(coalesce(c.kept_talking, false)::int) filter (where (c.playbook_arms->>p.id::text)::boolean), 0)
             + 0.1 * coalesce(avg(r.overall) filter (where (c.playbook_arms->>p.id::text)::boolean), 0) s_on,
           coalesce(3 * avg((c.outcome = 'booked')::int) filter (where not (c.playbook_arms->>p.id::text)::boolean), 0)
             + coalesce(avg(coalesce(c.kept_talking, false)::int) filter (where not (c.playbook_arms->>p.id::text)::boolean), 0)
             + 0.1 * coalesce(avg(r.overall) filter (where not (c.playbook_arms->>p.id::text)::boolean), 0) s_off
      into s
      from rg_calls c left join rg_call_reviews r on r.call_id = c.id and r.status = 'done'
     where c.playbook_arms ? p.id::text and not coalesce(c.is_test, false) and coalesce(c.direction, 'outbound') = 'outbound'
       and coalesce(c.outcome, '') not in ('no_answer', 'voicemail_left', '');
    v_verdict := case
      when s.n_on >= 40 and s.n_off >= 40 then case when s.s_on >= s.s_off then 'live' else 'rolled_back' end
      when s.n_on >= 20 and s.n_off >= 20 and s.s_off > 0 and s.s_on < 0.5 * s.s_off then 'rolled_back'
      when p.started_at < now() - interval '21 days' then case when s.n_on >= 15 and s.n_off >= 15 and s.s_on >= s.s_off then 'live' else 'rolled_back' end
    end;
    continue when v_verdict is null;
    update rg_playbook set status = v_verdict, decided_at = now(), updated_at = now(),
           result = jsonb_build_object('calls_with', s.n_on, 'calls_without', s.n_off, 'score_with', round(s.s_on, 3), 'score_without', round(s.s_off, 3))
     where id = p.id;
    perform scout_notify(p_title => v_owner || ': ' || case when v_verdict = 'live' then 'a new move worked, keeping it' else 'a new move didn''t help, dropped it' end,
      p_body => '"' || p.rule || '" ' || format('(%s calls with it, %s without).', s.n_on, s.n_off),
      p_severity => 'info', p_push => false, p_url => '/admin/roofguard#scorecard', p_dedupe => 'rg-playbook-' || p.id || '-' || v_verdict);
    v_done := v_done + 1;
  end loop;
  -- a waiting small change starts testing when a slot opens
  update rg_playbook set status = 'testing', started_at = now(), updated_at = now()
   where id in (select id from rg_playbook where status = 'proposed' and size = 'small' and origin = 'coach'
                 order by created_at limit greatest(0, 2 - (select count(*) from rg_playbook where status = 'testing')));
  return jsonb_build_object('decided', v_done);
end $$;
revoke all on function public.rg_playbook_decide() from public, anon, authenticated;

-- ------------------------------------------------------------------ Jared's taps
create or replace function public.admin_playbook_set(p_source text, p_id uuid, p_action text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_action not in ('approve','decline','retire','restore') then raise exception 'bad action'; end if;
  if p_source = 'roofguard' then
    update rg_playbook set updated_at = now(),
      status = case p_action when 'approve' then 'testing' when 'decline' then 'declined' when 'retire' then 'retired' else 'live' end,
      started_at = case when p_action = 'approve' then now() else started_at end,
      decided_at = case when p_action in ('decline','retire','restore') then now() else decided_at end
     where id = p_id;
  else
    -- personal Ava: approve = live right away (too few calls to A/B)
    update ava_playbook set updated_at = now(),
      status = case p_action when 'approve' then 'live' when 'decline' then 'declined' when 'retire' then 'retired' else 'live' end,
      decided_at = now()
     where id = p_id;
  end if;
end $$;
revoke all on function public.admin_playbook_set(text, uuid, text) from public, anon;
grant execute on function public.admin_playbook_set(text, uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ what the Scorecard reads
create or replace function public.admin_coach(p_source text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() and not (p_source = 'roofguard' and coalesce((select has_role(auth.uid(), 'partner')), false)) then
    raise exception 'not allowed';
  end if;
  if p_source = 'roofguard' then
    return jsonb_build_object(
      'weeks', (select coalesce(jsonb_agg(w order by w.week), '[]') from (
          select date_trunc('week', r.created_at at time zone 'America/Los_Angeles')::date week, count(*) n,
                 round(avg((r.scores->>'opening')::numeric), 1) opening, round(avg((r.scores->>'qualify')::numeric), 1) qualify,
                 round(avg((r.scores->>'present')::numeric), 1) present, round(avg((r.scores->>'close')::numeric), 1) "close",
                 round(avg((r.scores->>'rehash')::numeric), 1) rehash, round(avg(r.overall), 1) overall, round(avg(r.confidence), 1) confidence
            from rg_call_reviews r join rg_calls c on c.id = r.call_id
           where r.status = 'done' and r.created_at > now() - interval '8 weeks' and not coalesce(c.is_test, false)
           group by 1) w),
      'focus', (select r.work_on from rg_call_reviews r where r.status = 'done' and r.work_on is not null order by r.created_at desc limit 1),
      'objections', (select coalesce(jsonb_object_agg(o, n), '{}') from (
          select o, count(*) n from rg_call_reviews r, unnest(r.objections) o where r.created_at > now() - interval '30 days' group by o) x),
      'playbook', (select coalesce(jsonb_agg(to_jsonb(p) order by case p.status when 'proposed' then 0 when 'testing' then 1 when 'live' then 2 else 3 end, p.created_at desc), '[]')
                     from rg_playbook p where p.status <> 'declined' or p.updated_at > now() - interval '7 days'),
      'testing_counts', (select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
            'with', (select count(*) from rg_calls c where (c.playbook_arms->>p.id::text)::boolean and not coalesce(c.is_test, false)
                       and coalesce(c.outcome, '') not in ('no_answer','voicemail_left','')),
            'without', (select count(*) from rg_calls c where not (c.playbook_arms->>p.id::text)::boolean and not coalesce(c.is_test, false)
                       and coalesce(c.outcome, '') not in ('no_answer','voicemail_left','')))), '{}')
          from rg_playbook p where p.status = 'testing'),
      'reviews', (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('outcome', c.outcome, 'company', l.company) order by r.created_at desc), '[]')
                    from (select * from rg_call_reviews where status = 'done' order by created_at desc limit 25) r
                    join rg_calls c on c.id = r.call_id left join rg_leads l on l.id = c.lead_id),
      'pending', (select count(*) from rg_calls c where c.transcript is not null and coalesce(c.duration_sec, 0) >= 10 and c.deleted_at is null
                    and coalesce(c.ended_at, c.updated_at) > now() - interval '14 days'
                    and not exists (select 1 from rg_call_reviews r where r.call_id = c.id and r.status <> 'failed')));
  end if;
  return jsonb_build_object(
    'weeks', (select coalesce(jsonb_agg(w order by w.week), '[]') from (
        select date_trunc('week', r.created_at at time zone 'America/Los_Angeles')::date week, count(*) n,
               round(avg((r.scores->>'name')::numeric), 1) "name", round(avg((r.scores->>'message')::numeric), 1) message,
               round(avg((r.scores->>'warm_brief')::numeric), 1) warm_brief, round(avg((r.scores->>'privacy')::numeric), 1) privacy,
               round(avg(r.overall), 1) overall
          from ava_call_reviews r where r.status = 'done' and r.created_at > now() - interval '8 weeks' group by 1) w),
    'focus', (select r.work_on from ava_call_reviews r where r.status = 'done' and r.work_on is not null order by r.created_at desc limit 1),
    'playbook', (select coalesce(jsonb_agg(to_jsonb(p) order by case p.status when 'proposed' then 0 when 'live' then 1 else 2 end, p.created_at desc), '[]')
                   from ava_playbook p where p.status <> 'declined' or p.updated_at > now() - interval '7 days'),
    'reviews', (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('direction', c.direction, 'caller', c.caller_name) order by r.created_at desc), '[]')
                  from (select * from ava_call_reviews where status = 'done' order by created_at desc limit 25) r join ava_calls c on c.id = r.call_id),
    'pending', (select count(*) from ava_calls c where c.transcript is not null and coalesce(c.duration_sec, 0) >= 10 and c.deleted_at is null
                  and coalesce(c.ended_at, c.created_at) > now() - interval '14 days'
                  and not exists (select 1 from ava_call_reviews r where r.call_id = c.id and r.status <> 'failed')));
end $$;
revoke all on function public.admin_coach(text) from public, anon;
grant execute on function public.admin_coach(text) to authenticated, service_role;

-- one call's review, for the call sheet
create or replace function public.admin_call_review(p_source text, p_call uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() and not (p_source = 'roofguard' and coalesce((select has_role(auth.uid(), 'partner')), false)) then
    raise exception 'not allowed';
  end if;
  if p_source = 'roofguard' then return (select to_jsonb(r) from rg_call_reviews r where r.call_id = p_call); end if;
  return (select to_jsonb(r) from ava_call_reviews r where r.call_id = p_call);
end $$;
revoke all on function public.admin_call_review(text, uuid) from public, anon;
grant execute on function public.admin_call_review(text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ watchdog
create or replace function public.coach_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_rg int; v_ava int; v_rg_last timestamptz; v_ava_last timestamptz;
begin
  select count(*) into v_rg from rg_calls c where c.transcript is not null and jsonb_array_length(c.transcript) > 2 and coalesce(c.duration_sec, 0) >= 10
     and c.deleted_at is null and coalesce(c.ended_at, c.updated_at) between now() - interval '3 days' and now() - interval '30 minutes'
     and not exists (select 1 from rg_call_reviews r where r.call_id = c.id and r.status <> 'failed');
  select count(*) into v_ava from ava_calls c where c.transcript is not null and jsonb_array_length(c.transcript) > 2 and coalesce(c.duration_sec, 0) >= 10
     and c.deleted_at is null and coalesce(c.ended_at, c.created_at) between now() - interval '3 days' and now() - interval '30 minutes'
     and not exists (select 1 from ava_call_reviews r where r.call_id = c.id and r.status <> 'failed');
  select max(updated_at) into v_rg_last from rg_call_reviews where status = 'done';
  select max(updated_at) into v_ava_last from ava_call_reviews where status = 'done';

  if v_rg > 0 and coalesce(v_rg_last, '-infinity') < now() - interval '2 hours' then
    perform bestly_raise('rg.coach', 'problem', 'warning', 'RoofGuard Ava: my coach is behind',
      format('%s calls are waiting for a review. The coach retries every 10 minutes on free AI; nothing reviewed since %s.', v_rg,
             coalesce(to_char(v_rg_last at time zone 'America/Los_Angeles', 'FMHH12:MI AM Mon FMDD'), 'it started')), 'team', null, false);
  elsif exists (select 1 from monitor_issues where key = 'rg.coach' and status = 'open') then
    perform bestly_raise('rg.coach', 'resolved', 'info', 'RoofGuard Ava: my coach caught up');
  end if;
  if v_ava > 0 and coalesce(v_ava_last, '-infinity') < now() - interval '2 hours' then
    perform bestly_raise('ava.coach', 'problem', 'warning', 'Ava: my coach is behind',
      format('%s calls are waiting for a review. The coach retries every 10 minutes on free AI.', v_ava), 'team', null, false);
  elsif exists (select 1 from monitor_issues where key = 'ava.coach' and status = 'open') then
    perform bestly_raise('ava.coach', 'resolved', 'info', 'Ava: my coach caught up');
  end if;
  return jsonb_build_object('rg_waiting', v_rg, 'ava_waiting', v_ava);
end $$;
revoke all on function public.coach_watch() from public, anon, authenticated;

-- every 10 minutes: review new calls (free AI), decide finished tests, check the coach itself
select cron.schedule('ava-coach', '3-59/10 * * * *',
  $$select public.invoke_edge_function('ava-coach', '{"op":"review"}'::jsonb, 150000); select public.rg_playbook_decide(); select public.coach_watch();$$);
-- Mondays 10:05 AM Pacific (after The Improver): the week's lessons -> playbook changes
select cron.schedule('ava-coach-weekly', '5 17 * * 1', $$select public.invoke_edge_function('ava-coach', '{"op":"weekly"}'::jsonb, 150000);$$);
