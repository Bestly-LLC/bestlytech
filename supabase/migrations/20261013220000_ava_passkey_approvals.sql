-- 2026-10-13 Phase B of docs/ava-fix-issues-opusplan.md: approve and undo with a passkey tap.
--
-- THE PHONE CALL NEVER APPROVES ANYTHING. Ava only creates a pending request here (ava_approval_create) and pushes a short link
-- (bestly.tech/y/<code>). The approval happens in Jared's signed-in admin browser after a fresh WebAuthn ceremony with
-- userVerification "required" (webauthn-authenticate, actions approval_options / approval_verify). That edge function records a
-- verified assertion on THIS approval row; ava_approval_decide refuses unless the assertion is under 60 seconds old, belongs to the
-- same signed-in admin, and the page's hash of the action matches. The page then runs the action with the admin JWT, the same way the
-- Fix Ladder pane's "Yes, do it" does (admin-chat as Jared, not autopilot). No grant table, no service-path write mode, nothing in admin-chat changes.
--
-- Privacy: ava_approvals holds no phone or email (conversation_id is an ElevenLabs call id), so there is nothing to add to privacy_data_map.
-- If a phone or email column is ever added here, add its privacy_data_map row in the same migration.

create table if not exists public.ava_approvals (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[a-z0-9]{7}$'),
  kind            text not null check (kind in ('approve', 'undo')),
  issue_key       text not null,
  issue_title     text not null,
  action_text     text not null,                 -- the exact message Scout gets ("Yes, do it: ...")
  action_hash     text not null,                 -- sha256 hex of action_text; the page sends it back so what he saw is what runs
  source_text     text not null,                 -- the incident's scout_ask (approve) or the log row's undo_sql (undo) at request time
  action_plain    text not null,                 -- plain words for the push and the page
  autofix_id      bigint,                        -- security_autofix_log.id for undo
  conversation_id text,                          -- the live Ava call that asked
  verified_call   boolean not null default false,-- true only when ava-admin proved a live Ava call from Jared's number; selftest rows are false and can never be approved
  status          text not null default 'pending' check (status in ('pending', 'approved', 'running', 'done', 'failed', 'declined', 'expired')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '10 minutes',
  push_sent_at    timestamptz,
  push_result     text,
  challenge       text,                          -- WebAuthn challenge for THIS approval only (never in webauthn_challenges, so it cannot sign anyone in)
  challenge_at    timestamptz,
  challenge_n     int not null default 0,
  assertion_at    timestamptz,                   -- set by webauthn-authenticate after a verified, user-verified assertion; consumed by decide
  assertion_user  uuid,
  assertion_cred  text,
  decided_at      timestamptz,
  decided_by      uuid,
  run_thread_id   uuid,
  run_started_at  timestamptz,
  finished_at     timestamptz,
  result          text
);
create index if not exists ava_approvals_pending_idx on public.ava_approvals (status, expires_at);
create index if not exists ava_approvals_conv_idx on public.ava_approvals (conversation_id, created_at desc);

alter table public.ava_approvals enable row level security;
revoke all on public.ava_approvals from anon, authenticated;
-- admins can read everything except the challenge and the assertion bookkeeping
grant select (id, code, kind, issue_key, issue_title, action_plain, conversation_id, verified_call, status, created_at, expires_at, push_sent_at,
              decided_at, decided_by, run_thread_id, run_started_at, finished_at, result)
  on public.ava_approvals to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ava_approvals' and policyname = 'ava_approvals_admin_read') then
    create policy ava_approvals_admin_read on public.ava_approvals for select to authenticated using (public.has_role(auth.uid(), 'admin'));
  end if;
end $$;

-- ---------- helpers ----------
create or replace function public.ava_approval_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare a constant text := 'abcdefghjkmnpqrstuvwxyz23456789'; b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex'); s text := ''; i int;
begin
  for i in 0..6 loop s := s || substr(a, (get_byte(b, i) % 31) + 1, 1); end loop;
  return s;
end $$;

-- True when the thing the request was about has changed since it was asked for (a different fix is waiting, the incident moved on, the undo already happened).
create or replace function public.ava_approval_stale(r public.ava_approvals) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare i record; cur text;
begin
  if r.kind = 'approve' then
    select status, fix_stage, scout_ask into i from public.monitor_issues where key = r.issue_key;
    if not found then return true; end if;
    return i.status <> 'open' or i.fix_stage <> 'needs_yes' or coalesce(i.scout_ask, '') <> r.source_text;
  end if;
  select undo_sql into cur from public.security_autofix_log where id = r.autofix_id and ok;
  if not found or cur is distinct from r.source_text then return true; end if;
  return exists (select 1 from public.ava_approvals o where o.kind = 'undo' and o.autofix_id = r.autofix_id and o.id <> r.id and o.status in ('approved', 'running', 'done'));
end $$;

-- ---------- ava-admin (service role only): create a request, then push it ----------
create or replace function public.ava_approval_create(p_kind text, p_issue_key text, p_title text, p_action_text text, p_source_text text, p_plain text,
                                                      p_autofix_id bigint, p_conversation text, p_verified boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_hash text; r public.ava_approvals; n int; v_code text; v_day timestamptz;
begin
  if p_kind not in ('approve', 'undo') then return jsonb_build_object('ok', false, 'reason', 'bad_kind'); end if;
  update public.ava_approvals set status = 'expired' where status = 'pending' and expires_at <= now();
  v_hash := encode(sha256(convert_to(p_action_text, 'UTF8')), 'hex');
  -- the same request is already waiting: hand it back, never a second push
  select * into r from public.ava_approvals where status = 'pending' and kind = p_kind and issue_key = p_issue_key and action_hash = v_hash
     and expires_at > now() and verified_call = coalesce(p_verified, false) order by created_at desc limit 1;
  if found then return jsonb_build_object('ok', true, 'existing', true, 'code', r.code, 'expires_at', r.expires_at, 'pushed', r.push_sent_at is not null); end if;
  if coalesce(p_verified, false) then
    select count(*) into n from public.ava_approvals where status = 'pending' and expires_at > now() and verified_call;
    if n >= 5 then return jsonb_build_object('ok', false, 'reason', 'too_many_pending'); end if;
    v_day := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
    select count(*) into n from public.ava_approvals where verified_call and created_at >= v_day;
    if n >= 20 then return jsonb_build_object('ok', false, 'reason', 'daily_cap'); end if;
  end if;
  loop
    v_code := public.ava_approval_code();
    exit when not exists (select 1 from public.ava_approvals where code = v_code);
  end loop;
  insert into public.ava_approvals (code, kind, issue_key, issue_title, action_text, action_hash, source_text, action_plain, autofix_id, conversation_id, verified_call)
  values (v_code, p_kind, p_issue_key, left(p_title, 200), p_action_text, v_hash, p_source_text, left(p_plain, 300), p_autofix_id, p_conversation, coalesce(p_verified, false))
  returning * into r;
  return jsonb_build_object('ok', true, 'existing', false, 'code', r.code, 'expires_at', r.expires_at, 'pushed', false);
end $$;

-- One push per approval. The ONLY place that sets ava.requested_now, which interrupt_class() reads (see below).
create or replace function public.ava_approval_push(p_code text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare r public.ava_approvals; res text;
begin
  select * into r from public.ava_approvals where code = lower(trim(p_code)) for update;
  if not found or r.status <> 'pending' or r.push_sent_at is not null or r.expires_at <= now() or not r.verified_call then return 'skipped'; end if;
  perform set_config('ava.requested_now', r.code, true);
  res := public.notify_route(
    p_title := case r.kind when 'undo' then 'Ava: tap to undo' else 'Ava: tap to approve' end,
    p_body := r.action_plain,
    p_level := 'time-sensitive',
    p_source := 'ava_approvals',
    p_url := 'https://bestly.tech/y/' || r.code,
    p_tag := 'ava-approval-' || r.code);
  perform set_config('ava.requested_now', '', true);
  update public.ava_approvals set push_sent_at = now(), push_result = res where id = r.id;
  return res;
end $$;

-- ---------- the page (signed-in admin JWT) ----------
create or replace function public.ava_approval_get(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r public.ava_approvals;
begin
  perform public.admin_require_admin();
  select * into r from public.ava_approvals where code = lower(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.status = 'pending' and r.expires_at <= now() then update public.ava_approvals set status = 'expired' where id = r.id; r.status := 'expired'; end if;
  return jsonb_build_object('ok', true, 'approval', jsonb_build_object(
    'code', r.code, 'kind', r.kind, 'title', r.issue_title, 'action_text', r.action_text, 'action_plain', r.action_plain, 'action_hash', r.action_hash,
    'status', r.status, 'created_at', r.created_at, 'expires_at', r.expires_at, 'seconds_left', greatest(0, floor(extract(epoch from (r.expires_at - now()))))::int,
    'from_call', r.conversation_id is not null and r.verified_call, 'selftest', not r.verified_call,
    'stale', r.status = 'pending' and public.ava_approval_stale(r), 'thread_id', r.run_thread_id, 'result', r.result));
end $$;

-- The decision. Core takes the user id so the watchdog can exercise every refusal; the public wrapper pins it to auth.uid().
create or replace function public.ava_approval_decide_core(p_code text, p_decision text, p_hash text, p_uid uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r public.ava_approvals; v_thread uuid; v_when text;
begin
  select * into r from public.ava_approvals where code = lower(trim(p_code)) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', case r.status when 'expired' then 'expired' when 'declined' then 'declined' else 'used' end);
  end if;
  if r.expires_at <= now() then
    update public.ava_approvals set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  v_when := to_char(now() at time zone 'America/Los_Angeles', 'FMHH12:MI AM');
  if p_decision = 'decline' then
    update public.ava_approvals set status = 'declined', decided_at = now(), decided_by = p_uid, assertion_at = null where id = r.id;
    if r.verified_call then
      begin
        perform public.notify_route(p_title := 'Ava (voice): you said no to ' || left(r.issue_title, 100) || ' at ' || v_when, p_body := 'Nothing ran.',
          p_level := 'passive', p_source := 'Ava', p_url := 'https://bestly.tech/admin', p_tag := 'ava-declined-' || r.code);
      exception when others then null; end;
    end if;
    return jsonb_build_object('ok', true, 'decision', 'declined');
  end if;
  if p_decision <> 'approve' then return jsonb_build_object('ok', false, 'reason', 'bad_decision'); end if;
  if p_hash is distinct from r.action_hash then return jsonb_build_object('ok', false, 'reason', 'mismatch'); end if;
  -- the passkey tap: recorded by webauthn-authenticate on this very row, fresh, user-verified, same admin
  if r.assertion_at is null or r.assertion_at < now() - interval '60 seconds' or r.assertion_user is distinct from p_uid or p_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_tap');
  end if;
  if not r.verified_call then return jsonb_build_object('ok', false, 'reason', 'selftest'); end if;
  if public.ava_approval_stale(r) then
    update public.ava_approvals set status = 'expired', result = 'changed', assertion_at = null where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'changed');
  end if;
  -- the one reusable "Ava (voice)" chat is where Scout's answer lands, so Ava can read it back on `check`
  select id into v_thread from public.admin_chat_threads where user_id = p_uid and title = 'Ava (voice)' order by created_at limit 1;
  if v_thread is null then
    insert into public.admin_chat_threads (user_id, title) values (p_uid, 'Ava (voice)') returning id into v_thread;
  end if;
  update public.ava_approvals set status = 'approved', decided_at = now(), decided_by = p_uid, assertion_at = null, run_thread_id = v_thread where id = r.id;
  begin
    perform public.notify_route(p_title := 'Ava (voice): you ' || case r.kind when 'undo' then 'undid ' else 'approved ' end || left(r.issue_title, 100) || ' at ' || v_when,
      p_body := 'Your Face ID tap. Scout is running it now.', p_level := 'passive', p_source := 'Ava', p_url := 'https://bestly.tech/admin', p_tag := 'ava-approved-' || r.code);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'decision', 'approved', 'kind', r.kind, 'issue_key', r.issue_key, 'title', r.issue_title, 'action_text', r.action_text, 'thread_id', v_thread);
end $$;

create or replace function public.ava_approval_decide(p_code text, p_decision text, p_hash text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.admin_require_admin();
  return public.ava_approval_decide_core(p_code, p_decision, p_hash, auth.uid());
end $$;

create or replace function public.ava_approval_started(p_code text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.admin_require_admin();
  update public.ava_approvals set status = 'running', run_started_at = now() where code = lower(trim(p_code)) and status = 'approved' and decided_by = auth.uid();
  return found;
end $$;

create or replace function public.ava_approval_finished(p_code text, p_ok boolean, p_note text default null) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.admin_require_admin();
  update public.ava_approvals set status = case when p_ok then 'done' else 'failed' end, finished_at = now(), result = coalesce(left(p_note, 300), result)
   where code = lower(trim(p_code)) and status in ('approved', 'running') and decided_by = auth.uid();
  return found;
end $$;

-- ---------- watchdog helpers (service role only; the :17 selftest in ava-admin calls these) ----------
create or replace function public.ava_approvals_sweep() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a int;
begin
  -- Rows are never deleted (a handful a day, and they are the audit trail); old pending ones just expire.
  update public.ava_approvals set status = 'expired' where status = 'pending' and expires_at <= now(); get diagnostics a = row_count;
  return jsonb_build_object('expired', a,
    'pending', (select count(*) from public.ava_approvals where status = 'pending' and expires_at > now()),
    'approved_waiting_over_30m', (select count(*) from public.ava_approvals where status in ('approved', 'running') and decided_at < now() - interval '30 minutes'));
end $$;

-- Exercises every refusal against throwaway rows inside a sub-transaction that is always rolled back, so nothing is ever left behind.
create or replace function public.ava_approval_selftest() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare uid constant uuid := '00000000-0000-0000-0000-0000000000a1'; other constant uuid := '00000000-0000-0000-0000-0000000000a2';
        h constant text := encode(sha256(convert_to('Yes, do it: selftest', 'UTF8')), 'hex');
        checks jsonb := '[]'; got text;
begin
  begin
  insert into public.ava_approvals (code, kind, issue_key, issue_title, action_text, action_hash, source_text, action_plain, status, expires_at)
  values ('zzs0001', 'approve', '__selftest__', 'selftest', 'Yes, do it: selftest', h, 'selftest', 'selftest', 'pending', now() - interval '1 minute'),
         ('zzs0002', 'approve', '__selftest__', 'selftest', 'Yes, do it: selftest', h, 'selftest', 'selftest', 'approved', now() + interval '5 minutes'),
         ('zzs0003', 'approve', '__selftest__', 'selftest', 'Yes, do it: selftest', h, 'selftest', 'selftest', 'pending', now() + interval '5 minutes'),
         ('zzs0004', 'approve', '__selftest__', 'selftest', 'Yes, do it: selftest', h, 'selftest', 'selftest', 'pending', now() + interval '5 minutes'),
         ('zzs0005', 'approve', '__selftest__', 'selftest', 'Yes, do it: selftest', h, 'selftest', 'selftest', 'pending', now() + interval '5 minutes');
  update public.ava_approvals set assertion_at = now() - interval '2 minutes', assertion_user = uid where code = 'zzs0004';   -- a stale tap
  update public.ava_approvals set assertion_at = now(), assertion_user = other where code = 'zzs0005';                         -- a fresh tap by someone else
  got := public.ava_approval_decide_core('zzs0001', 'approve', h, uid) ->> 'reason';  checks := checks || jsonb_build_object('name', 'expired_refused', 'ok', got = 'expired', 'got', got);
  got := public.ava_approval_decide_core('zzs0002', 'approve', h, uid) ->> 'reason';  checks := checks || jsonb_build_object('name', 'used_refused', 'ok', got = 'used', 'got', got);
  got := public.ava_approval_decide_core('zzs0003', 'approve', 'not-the-hash', uid) ->> 'reason'; checks := checks || jsonb_build_object('name', 'mismatch_refused', 'ok', got = 'mismatch', 'got', got);
  got := public.ava_approval_decide_core('zzs0003', 'approve', h, uid) ->> 'reason';  checks := checks || jsonb_build_object('name', 'no_tap_refused', 'ok', got = 'no_tap', 'got', got);
  got := public.ava_approval_decide_core('zzs0004', 'approve', h, uid) ->> 'reason';  checks := checks || jsonb_build_object('name', 'old_tap_refused', 'ok', got = 'no_tap', 'got', got);
  got := public.ava_approval_decide_core('zzs0005', 'approve', h, uid) ->> 'reason';  checks := checks || jsonb_build_object('name', 'other_users_tap_refused', 'ok', got = 'no_tap', 'got', got);
  update public.ava_approvals set assertion_at = now(), assertion_user = uid where code = 'zzs0003';
  got := public.ava_approval_decide_core('zzs0003', 'approve', h, uid) ->> 'reason';  checks := checks || jsonb_build_object('name', 'selftest_rows_never_approve', 'ok', got = 'selftest', 'got', got);
  got := public.ava_approval_decide_core('nope000', 'approve', h, uid) ->> 'reason';  checks := checks || jsonb_build_object('name', 'unknown_code_refused', 'ok', got = 'not_found', 'got', got);
  raise exception 'ava_approval_selftest_rollback';
  exception when others then
    if sqlerrm <> 'ava_approval_selftest_rollback' then raise; end if;
  end;
  return jsonb_build_object('ok', not exists (select 1 from jsonb_array_elements(checks) c where (c ->> 'ok') <> 'true'), 'checks', checks);
end $$;

-- ---------- grants ----------
do $$
declare f text;
begin
  foreach f in array array[
    'ava_approval_code()', 'ava_approval_stale(public.ava_approvals)',
    'ava_approval_create(text,text,text,text,text,text,bigint,text,boolean)', 'ava_approval_push(text)',
    'ava_approval_decide_core(text,text,text,uuid)', 'ava_approvals_sweep()', 'ava_approval_selftest()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['ava_approval_get(text)', 'ava_approval_decide(text,text,text)', 'ava_approval_started(text)', 'ava_approval_finished(text,boolean,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------- the one new interrupt class: requested_now ----------
-- Jared asked for it ON a verified live Ava call and Ava wrote a pending ava_approvals row, so a real person (him) is waiting right now.
-- Everything is checked, not just the wording: the source is exactly 'ava_approvals', the title is Ava's tap title, the transaction-local setting
-- ava.requested_now (set only inside ava_approval_push, service role only) names a pending, un-pushed, unexpired row that was created by a verified call.
-- Nothing else can reach it. The function is now STABLE (it reads a table); the rest is the 2026-10-06 definition, unchanged.
create or replace function public.interrupt_class(p_title text, p_body text, p_source text, p_level text)
returns text language plpgsql stable set search_path to 'public' as $function$
declare t text := lower(coalesce(p_title, '') || ' ' || coalesce(p_body, '')); s text := lower(coalesce(p_source, ''));
        ti text := lower(coalesce(p_title, ''));
begin
  if p_level = 'critical' then return 'critical'; end if;
  if s = 'ava_approvals' and coalesce(p_title, '') like 'Ava: tap to %'
     and coalesce(current_setting('ava.requested_now', true), '') <> ''
     and exists (select 1 from public.ava_approvals a
                  where a.code = current_setting('ava.requested_now', true) and a.status = 'pending' and a.verified_call and a.push_sent_at is null
                    and a.expires_at > now() and a.created_at > now() - interval '15 minutes') then
    return 'requested_now';
  end if;
  -- Good news never interrupts; it goes to the recap.
  if ti ~ '^\s*(fixed|resolved)\y' or ti ~ '(is working again|back to normal|is back\y|is steady|recovered|caught up|reachable again|all clear)' then
    return null;
  end if;
  if ti ~ '^(your day|today''s recap|bestly today)' then return 'recap'; end if;
  -- The Fix Ladder's "Scout found the fix and needs your yes" is a paid-AI ask, not a person waiting: drop that line first.
  t := regexp_replace(t, '(next: )?scout (found the fix and )?needs your yes[^.]*\.?', '', 'g');
  -- Usage meters (GPU minutes, today's spend, credit left) are not money moving: drop them first.
  t := regexp_replace(t, '(charged \$\s?[0-9.,]+ for [^·\n]*|today \$\s?[0-9.,]+[^·\n]*|credit \$\s?[0-9.,]+ left[^·\n]*)', '', 'g');
  if s in ('blue steel', 'claims closer') or s like 'turo%' and t ~ '(pick-?up|drop-?off|return|check-?in)'
     or t ~ '(\$\s?[1-9]|refund|chargeback|charged (you|your)|card was charged|charge failed|not billed|payment|payout|invoice|deposit|parking ticket|citation|\ytowed?\y|move blue steel|street sweeping)' then
    return 'money';
  end if;
  if t ~ '(ready for your ok|is waiting (on|for) you|wrote back|replied to you|for your reply|message from (?!jared)|left (you )?a (message|voicemail)|new lead|booking request|wants to (talk|book|meet)|asked for you)' then
    return 'person';
  end if;
  if t ~ '(sign-?in request|login request|approve (this|the|a) (sign|login|device)|suspicious|breach|intrud|unauthori[sz]ed|break-?in|moved with no trip|is unlocked|smoke|water leak|weather alert|earthquake|tsunami|flood warning|couldn.t fix (a|this|the) security|security risk)' then
    return 'security';
  end if;
  if t ~ '(still down|down for (an hour|over an hour|[0-9]+ h)|nobody could fix)' then return 'down'; end if;
  return null;
end $function$;

-- ---------- team card: same slug, same owner (Ava) ----------
select public.team_onboard('[{
  "slug": "ava-admin-bridge",
  "name": "Admin Bridge",
  "role": "Ava''s line into the admin",
  "what_it_does": "Lets Ava answer Jared when he calls and asks about the business: what needs him, how the agents did today, what is broken, and start or pause Maya''s campaigns or place one call. For issues she can list what is open, send one back up the Fix Ladder (Try again), or hand Scout a read-only question and read the answer back (10 a day, writes stay blocked). She can never approve or undo a fix herself: when he says yes do it, she sends a request to his phone (bestly.tech/y/code) and he taps it and confirms with Face ID in his signed-in admin; only then does the fix run, through the same Yes, do it path the alert pane uses. Requests expire in 10 minutes, are single use, and are capped at 5 waiting and 20 a day. Only Jared''s two numbers get in, every change is read back and needs a yes, calls through it are capped at 20 a day, and every action rings a quiet note signed Ava. Checks itself hourly at :17 (the tools are still on Ava, the shared secret still matches, the answers are fast, an expired, used or mismatched approval is refused, the tap page loads); fixes what it can and tells Jared as Ava if it cannot. Log of the last actions is on /admin/ava.",
  "tool_of": "ava",
  "runs_on": "cloud",
  "schedule": "live on every call Jared makes to Ava; self-test hourly at :17",
  "icon": "plug",
  "admin_url": "/admin/ava",
  "sort": 60,
  "pulse": {"src": "cron", "job": "ava-admin-bridge-selftest", "gap": 130}
}]'::jsonb);
