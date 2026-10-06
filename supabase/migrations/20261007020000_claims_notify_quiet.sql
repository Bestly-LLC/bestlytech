-- Claims Closer notifications follow the autonomy rule (CLAUDE.md, 2026-10-06): only security, money, a real person waiting or something
-- down an hour interrupts Jared. interrupt_class() treats every notification whose source is "Claims Closer" as money, so routine
-- progress (shops asked, quote in, invoice posted, insurer named) would have pushed to his phone. Now:
--   * success / info  -> held on purpose: the same silent bell row + evening-recap line notify_route writes for gated news
--   * warning / critical -> notify_route as before (a question that needs him, a booking confirmed, a reminder, a deadline about to be missed)
-- claims_ask (decision) now also pushes once, so a question Scout carries is not left to sit in Needs you alone.
create or replace function public.claims_notify(p_title text, p_body text default null, p_severity text default 'info', p_dedupe text default null) returns text
language plpgsql security definer set search_path to 'public' as $$
declare v text; v_key text := coalesce(nullif(p_dedupe, ''), md5(lower(coalesce(p_title, '') || '|' || coalesce(p_body, ''))));
begin
  if p_dedupe is not null and exists (select 1 from claim_events where kind = 'notify' and detail->>'key' = p_dedupe) then return 'duplicate'; end if;
  if p_severity in ('success', 'info') then
    insert into autonomy_held (title, body, source, level) values (left('Claims Closer: ' || p_title, 200), left(coalesce(p_body, ''), 500), 'Claims Closer', 'active');
    begin
      insert into admin_notifications (kind, title, body, url, severity, dedupe_key, silent)
      values ('claims-closer', left('Claims Closer: ' || p_title, 200), left(coalesce(p_body, ''), 500), 'https://bestly.tech/admin/claims', 'info', v_key, true)
      on conflict (dedupe_key) do nothing;
    exception when others then null; end;
    v := 'held';
  else
    v := notify_route('Claims Closer: ' || left(p_title, 170), coalesce(p_body, ''),
           case p_severity when 'critical' then 'critical' else 'time-sensitive' end,
           'Claims Closer', 'https://bestly.tech/admin/claims', null, p_dedupe, null, null, false, now());
  end if;
  insert into claim_events (kind, title, detail) values ('notify', left(p_title, 200), jsonb_build_object('key', p_dedupe, 'channel', v));
  return v;
exception when others then
  begin perform admin_notify('claims-closer', 'Claims Closer: ' || p_title, p_body, '/admin/claims', null, p_severity, p_dedupe); exception when others then null; end;
  return 'bell';
end $$;
revoke all on function public.claims_notify(text, text, text, text) from anon, authenticated, public;

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
    perform claims_notify('Needs your answer on ' || v_who || '''s claim', left(p_question, 220), 'warning', 'claims-ask-' || v_id);
  end if;
  return v_id;
end $$;
revoke all on function public.claims_ask(uuid, text, jsonb, text, text) from anon, authenticated, public;
