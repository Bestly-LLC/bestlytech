-- Stuck card fix buttons (Jared, 2026-10-28): "make it stupid easy for me".
--
-- NOT APPLIED. Written on branch stuck-fix-buttons; production rollout waits for Jared's explicit go.
-- Builds on 20261027220000_stuck_card.sql (live). Safe to run twice (create if not exists / create or replace).
--
-- Every stuck AI-employee item now carries a server-side verdict ("fix"): what kind of trouble it is and which ONE button is
-- the most likely fix.
--   auth       401/403, expired or revoked key   -> primary "Update key" (deep link to the page where the key is pasted)
--   transient  free AI did not answer, rate limit, timeout, 5xx, network  -> primary "Retry now" (re-runs the job right away)
--   other      anything else                     -> primary "Have Scout fix it" (a Scout autopilot job with the error and the log tail)
-- "More" on every item: Have Scout fix it (when it is not already the primary), Prompt for Claude (a copy-ready prompt), Snooze 1 day.
--
-- What is new
--   stuck_actions        one row per tap or automatic retry: working -> done / failed / needs_yes, with a plain reason (the log)
--   stuck_snooze         "Snooze 1 day" (undoable through stuck_undo, the same 24-hour Undo the claim fixes use)
--   pi_run_requests      "run this Pi job now" queue. NOTHING like it existed (the Pi only ran jobs from cron), so this is new; the
--                        Pi side is tools/stuck-retry/run_requests.py (a one-minute Pi cron job). Without it a Pi retry fails
--                        after 3 minutes with a plain reason, and the card moves on to Scout.
--   stuck_classify()     the classifier (pure function, tested in src/components/admin/cc/stuckFix.sql.test.ts)
--   stuck_retry_target() how an employee is re-run: its Pi job (pi_jobs), or its own pg_cron job (cloud), or not at all
--   admin_stuck_run()    Jared's tap: retry | scout | snooze      admin_stuck_action()  the card polls this while an action works
--   admin_stuck_prompt() the "Prompt for Claude" text           stuck_scout_brief()   what Scout is asked (read by fix-ladder op stuck_scout)
--   stuck_auto_retry()   called by stuck_sweep(): a transient item stuck 1 hr+ gets Retry now once (at most once per item per 6 hrs)
--   stuck_feed_selftest  extended: classifier samples, retry path, ledger sanity, stale Pi requests (raises stuck.feed)
--
-- Hard rules kept
--   Auth items and Scout runs are NEVER automatic. Auto retry only touches transient items, only when the free AI is healthy for
--   free-AI errors, and only pushes Jared when the retry fails (signed by the employee). Switch: stuck_state.auto_retry.
--   No array || 'literal' anywhere (that threw "malformed array literal"): text arrays are built with array_append(x, 'text'::text).

-- ───────────────────────── tables ─────────────────────────

alter table public.stuck_state add column if not exists auto_retry boolean not null default true;   -- off switch for the automatic retry

create table if not exists public.stuck_actions (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  employee_slug text,
  employee_name text,
  kind text not null check (kind in ('retry', 'auto_retry', 'scout')),
  status text not null default 'working' check (status in ('working', 'done', 'failed', 'needs_yes')),
  via text,                         -- 'pi' | 'cloud' | 'scout'
  job text,                         -- the Pi job or pg_cron job that was re-run
  request_id uuid,                  -- pi_run_requests.id
  thread_id uuid,                   -- the Scout thread (admin_chat_threads.id)
  beat_before timestamptz,          -- agent_beats.at when the retry started: a newer beat means it ran
  wait_beat boolean not null default false,
  note text,                        -- the plain reason shown on the card (the employee signs it)
  auto boolean not null default false,
  by_user uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  notified_at timestamptz
);
create index if not exists stuck_actions_item_idx on public.stuck_actions (item_id, created_at desc);
create index if not exists stuck_actions_open_idx on public.stuck_actions (status) where status = 'working';
alter table public.stuck_actions enable row level security;
revoke all on public.stuck_actions from anon, authenticated;

create table if not exists public.stuck_snooze (
  item_id text primary key,
  until timestamptz not null,
  by_user uuid,
  created_at timestamptz not null default now()
);
alter table public.stuck_snooze enable row level security;
revoke all on public.stuck_snooze from anon, authenticated;

create table if not exists public.pi_run_requests (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  action_id uuid,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'expired')),
  summary text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index if not exists pi_run_requests_open_idx on public.pi_run_requests (created_at) where status in ('queued', 'running');
alter table public.pi_run_requests enable row level security;
revoke all on public.pi_run_requests from anon, authenticated;

-- ───────────────────────── small helpers ─────────────────────────

-- Where an employee runs, in words Jared knows. Names the device exactly.
create or replace function public.stuck_where(p_runs_on text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_runs_on is null then 'an unknown place'
    when p_runs_on ~* '^pi\M|\mpi$|raspberry' then 'bestly-pi (the home server)'
    when p_runs_on ~* 'mac[ _-]?mini' then 'the Mac mini (jareds-mac-mini-2)'
    when p_runs_on ~* 'macbook' then 'the MacBook Air'
    when p_runs_on ~* 'cloud|supabase' then 'Supabase (cloud)'
    when p_runs_on ~* 'claude' then 'a Claude scheduled task'
    else p_runs_on end
$$;

-- ───────────────────────── the classifier ─────────────────────────
-- Looks at the FIRST line of the error only (a traceback below it mentions "timeout" in code lines that mean nothing).
-- Order matters: auth wins over transient (a 401 is never "try again"), transient wins over other.
-- Returns {kind, service, service_name, label, tail, link, link_label}. label + tail are plain words for someone non-technical.
create or replace function public.stuck_classify(p_text text, p_slug text default null) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  raw text := btrim(coalesce(p_text, ''), E' \t\r\n');
  parts text[]; l text; whole text; k text := 'other'; svc text; nm text; lab text; tail text; lnk text := '/admin/settings';
begin
  parts := regexp_split_to_array(raw, E'\n');
  l := coalesce(parts[1], '');
  if l ~* '^traceback' and array_length(parts, 1) > 1 then l := parts[array_length(parts, 1)]; end if;   -- a bare traceback: its last line names the error
  l := lower(left(btrim(l), 700));
  whole := l || ' ' || lower(coalesce(p_slug, ''));

  if l ~ '\m(401|403)\M'
     or l ~ 'unauthori[sz]ed|forbidden|invalid[ _-]?(api[ _-]?)?(key|token)|invalid_grant|bad credentials|access denied|not authenticated'
     or l ~ '(token|key|credentials?|password|session|login)( has| was| is| were)?( been)? (expired|revoked|rejected|refused|invalid|denied)'
     or l ~ '(expired|revoked|invalid|rejected) (token|key|credentials?|session|login)'
     or l ~ 'refused the (token|key)|authenticat(ion|e)[ a-z]{0,12}(failed|error|required|denied)'
     or l ~ 'needs? an? (new|fresh|valid) .{0,24}(token|key|login|password)'
     or l ~ 'sign(ed)? ?in again|signed out|log ?in (failed|required|expired)|not allowed from this ip|ip (allow|white)list'
  then
    k := 'auth';
  elsif l ~ 'free ai.{0,40}(did not answer|didn.t answer|not answering|isn.t answering|is out|out of room|unavailable|busy|down)|no (ideas|candidates|answer) from free ai|every free ai provider'
  then
    k := 'transient'; svc := 'free_ai';
  elsif l ~ 'rate.?limit|\m429\M|too many requests|time[d]? ?-?out|timeout|deadline exceeded|connection (reset|refused|aborted|error|closed)|econnreset|econnrefused'
     or l ~ 'network (is )?unreachable|temporary failure|name or service not known|could not resolve|remote end closed|broken pipe|ssl.{0,30}(eof|handshake)'
     or l ~ '\m(http|status|error|code)[ :=]*5(0[0-4]|2[0-4])\M|internal server error|bad gateway|service unavailable|gateway time|try again'
  then
    k := 'transient';
  end if;

  if k = 'auth' then
    svc := case
      when whole ~ 'mercury' then 'mercury'
      when whole ~ 'vercel' then 'vercel'
      when whole ~ 'supabase' then 'supabase'
      when whole ~ 'cloudflare' then 'cloudflare'
      when whole ~ 'ipostal' then 'ipostal'
      when whole ~ 'tesla' then 'tesla'
      when whole ~ 'turo|park my share' then 'turo'
      when whole ~ 'github' then 'github'
      when whole ~ 'elevenlabs' then 'elevenlabs'
      when whole ~ 'resend' then 'resend'
      else null end;
    nm := case svc when 'mercury' then 'Mercury' when 'vercel' then 'Vercel' when 'supabase' then 'Supabase' when 'cloudflare' then 'Cloudflare'
                   when 'ipostal' then 'iPostal1' when 'tesla' then 'Tesla' when 'turo' then 'Turo' when 'github' then 'GitHub'
                   when 'elevenlabs' then 'ElevenLabs' when 'resend' then 'Resend' else null end;
    lnk := case svc when 'mercury' then '/admin/cost-cutter#mercury-tokens'
                    when 'vercel' then '/admin/security#audit-tokens' when 'supabase' then '/admin/security#audit-tokens'
                    when 'cloudflare' then '/admin/security#audit-tokens' when 'ipostal' then '/admin/security#audit-tokens'
                    when 'tesla' then '/admin/turo#settings' when 'turo' then '/admin/turo#settings'
                    else '/admin/settings' end;
    lab := case when nm is not null then nm || '''s key stopped working' else 'A saved key stopped working' end;
    tail := 'Paste a new one.';
  elsif k = 'transient' then
    if svc = 'free_ai' then lab := 'The free AI didn''t answer'; tail := 'It was busy or down. Trying again usually fixes it.';
    else lab := 'A temporary error'; tail := 'It looks like a hiccup. Trying again usually fixes it.'; end if;
  else
    lab := 'Last check-in was not OK'; tail := 'The error does not say what to do. Scout can look into it.';
  end if;

  return jsonb_build_object('kind', k, 'service', svc, 'service_name', nm, 'label', lab, 'tail', tail,
                            'link', lnk, 'link_label', case when k = 'auth' then 'Update key' end);
end $$;

-- Known errors and the verdict each must get. The watchdog runs these; the vitest file runs the same list.
-- Returns the samples the classifier gets wrong (empty array = healthy).
create or replace function public.stuck_classify_selftest() returns text[]
language plpgsql immutable set search_path = public as $$
declare s record; bad text[] := '{}'; got text;
begin
  for s in
    select * from (values
      ('RuntimeError: HTTP 401 https://api.mercury.com/api/v1/accounts' || E'\n  File "x.py", line 189, in urlopen\n    return opener.open(url, data, timeout)', 'pi-penny-bank', 'auth'),
      ('RuntimeError: Mercury refused the token (HTTP 401); needs a new read-only token', 'settlement-mercury', 'auth'),
      ('HTTP Error 403: Forbidden', null, 'auth'),
      ('Invalid API key provided', null, 'auth'),
      ('The Vercel token expired', 'security-audit', 'auth'),
      ('skip: Mercury token is not allowed from this IP (add the Pi''s address to the token allowlist)', null, 'auth'),
      ('Free AI did not answer this week; will try again next run', 'improver', 'transient'),
      ('429 Too Many Requests', null, 'transient'),
      ('RuntimeError: HTTP 503 Service Unavailable', null, 'transient'),
      ('urllib.error.URLError: <urlopen error timed out>', null, 'transient'),
      ('ConnectionResetError: connection reset by peer', null, 'transient'),
      ('RuntimeError: settlement_upsert_t -> HTTP 400: {"code":"P0001","message":"not allowed"}', 'settlements', 'other'),
      ('RuntimeError: Studio promo failed 3 tries: quality score 7/10: make it clearer', 'daily-post', 'other'),
      ('76 jobs, 8 failing', 'pi-runner', 'other'),
      ('RuntimeError: that failed' || E'\n  return opener.open(url, data, timeout)\n  HTTP Error 401', null, 'other'),
      ('', null, 'other'),
      (null, null, 'other')
    ) as t(txt, slug, want)
  loop
    got := stuck_classify(s.txt, s.slug)->>'kind';
    if got is distinct from s.want then
      bad := array_append(bad, (coalesce(left(s.txt, 40), '(empty)') || ' should be ' || s.want || ' but was ' || coalesce(got, 'null'))::text);
    end if;
  end loop;
  return bad;
end $$;

-- ───────────────────────── how an employee is re-run ─────────────────────────
-- pi     its Pi job (bestly_agents.pulse src 'pi_job', key = pi_jobs.job, job enabled): queued in pi_run_requests, the Pi runs it
-- cloud  its own pg_cron job (pulse.job or one of pulse.also): the same command cron would run, now. Only a plain
--        "select schema.function(...)" is ever executed; anything else is not a retry target.
-- none   nothing safe to re-run (Mac mini services, Claude scheduled tasks, external): the card goes to Scout instead
create or replace function public.stuck_retry_target(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, cron as $$
declare a bestly_agents; v_src text; v_key text; j text; c text;
begin
  select * into a from bestly_agents where slug = p_slug;
  if a.slug is null then return jsonb_build_object('via', 'none'); end if;
  v_src := coalesce(a.pulse->>'src', 'none');
  v_key := a.pulse->>'key';
  if v_src = 'pi_job' and v_key is not null and exists (select 1 from pi_jobs p where p.job = v_key and p.enabled) then
    return jsonb_build_object('via', 'pi', 'job', v_key);
  end if;
  for j in
    select s.x from (select a.pulse->>'job' as x union all select jsonb_array_elements_text(case jsonb_typeof(a.pulse->'also') when 'array' then a.pulse->'also' when 'string' then jsonb_build_array(a.pulse->'also') else '[]'::jsonb end)) s
     where s.x is not null
  loop
    select cj.command into c from cron.job cj where cj.jobname = j and cj.active;
    if c is not null
       and c ~* '^\s*select\s+(public\.)?[a-z_0-9]+\(.*\)\s*;?\s*$'
       and c !~* '\m(delete|drop|truncate|insert|update|alter|grant)\M'
       and position(';' in rtrim(btrim(c), E'; \n')) = 0
    then
      return jsonb_build_object('via', 'cloud', 'job', j, 'wait_beat', v_src = 'beat');
    end if;
  end loop;
  return jsonb_build_object('via', 'none');
end $$;

-- FreeLLM is healthy when a host reports it running within 20 minutes and the monitor has no open FreeLLM incident.
create or replace function public.stuck_freellm_healthy() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from service_hosts h where h.service = 'freellm' and h.active and h.present and h.reported_at > now() - interval '20 minutes')
     and not exists (select 1 from monitor_issues m where m.status = 'open' and m.key in ('ai.free.freellm', 'ai.freellm'))
$$;

-- ───────────────────────── the feed (stuck_items_core: agent items now carry a verdict) ─────────────────────────

create or replace function public.stuck_items_core() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  nb constant text := E' ';
  v_cc text := coalesce((select name from bestly_agents where slug = 'claims-closer'), 'Claims Closer');
  items jsonb := '[]'::jsonb;
  r record; a record; blocks jsonb; since timestamptz; te timestamptz; hc timestamptz;
  v_link boolean; gt jsonb; guest text; undo_sync timestamptz; fixable integer; v_work boolean := false;
  v_who text; v_money text; v_reason text;
  v_cls jsonb; v_rt jsonb; v_can boolean; v_fix jsonb;
begin
  -- 1. open claims
  for r in select * from claim_cases c where c.status not in ('paid', 'closed') and not coalesce(c.history, false) order by c.opened_at loop
    blocks := '[]'::jsonb; since := null; v_link := null; hc := null;
    guest := coalesce(nullif(btrim(r.guest_first), ''), 'the guest');
    te := greatest((select t.ends_at from turo_trips t where t.reservation_id = r.reservation_id), r.trip_end);
    select g.host_completed_at, true into hc, v_link from lax_guest_links g where g.reservation_id = r.reservation_id;
    v_link := coalesce(v_link, false);
    gt := claims_gate(r.id);

    -- trip ended, Jared has not tapped Complete, and no compliant first message has gone out since
    if te is not null and te <= now() and hc is null and not coalesce((gt->>'first_done')::boolean, false) then
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'trip_complete', 'label', 'Trip not marked complete',
        'detail', 'I can''t contact ' || guest || ' until it is.',
        'fix_action', case when v_link then 'trip_complete' end, 'fix_label', case when v_link then 'Complete' end));
      since := least(since, te);
    end if;

    -- the watchdog paused outgoing messages (Jared's tap only, never automatic)
    if coalesce(r.outbound_hold, false) then
      v_reason := nullif(btrim(coalesce(r.outbound_hold_reason, '')), '');
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'hold', 'label', 'Paused by the watchdog',
        'detail', coalesce(upper(left(v_reason, 1)) || substr(v_reason, 2), 'The watchdog stopped outgoing messages')
                  || case when r.outbound_hold_at is not null
                          then ', ' || to_char(r.outbound_hold_at at time zone 'America/Los_Angeles', 'FMMon FMDD') || ' at ' || stuck_clock(r.outbound_hold_at) else '' end || '.',
        'fix_action', 'hold', 'fix_label', 'Release'));
      since := least(since, coalesce(r.outbound_hold_at, r.updated_at));
    end if;

    -- never synced with Turo
    if r.synced_at is null and r.opened_at < now() - interval '15 minutes' then
      select max(u.created_at) into undo_sync from stuck_undo u
       where u.item_id = 'claim:' || r.id and u.undone_at is null and u.created_at > now() - interval '60 minutes'
         and u.snapshot->'steps' @> '[{"block":"sync"}]'::jsonb;
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'sync', 'label', 'Not synced with Turo',
        'detail', case when undo_sync is not null then 'Asked for a sync at ' || stuck_clock(undo_sync) || '. Waiting on Turo.'
                       else 'I can''t see Turo''s status or deadlines.' end,
        'fix_action', 'sync', 'fix_label', case when undo_sync is not null then 'Sync again' else 'Sync' end));
      since := least(since, r.opened_at);
    end if;

    -- work waiting 15+ minutes and the worker has not picked it up (same test claims_tick uses)
    if r.needs_work and r.updated_at < now() - interval '15 minutes' and coalesce(r.last_run_at, 'epoch'::timestamptz) < now() - interval '15 minutes' then
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'work', 'label', 'Waiting to be worked',
        'detail', 'This has been waiting ' || stuck_span(greatest(r.updated_at, coalesce(r.last_run_at, r.updated_at))) || ' and I haven''t started.',
        'fix_action', 'wake', 'fix_label', 'Wake it'));
      since := least(since, greatest(r.updated_at, coalesce(r.last_run_at, r.updated_at)));
      v_work := true;
    end if;

    if jsonb_array_length(blocks) > 0 then
      select count(*) into fixable from jsonb_array_elements(blocks) b where b->>'fix_action' is not null;
      items := items || jsonb_build_array(jsonb_build_object(
        'kind', 'stuck', 'item_id', 'claim:' || r.id, 'employee_slug', 'claims-closer', 'employee_name', v_cc,
        'title', case when nullif(btrim(r.guest_first), '') is null then 'A claim' else btrim(r.guest_first) || '''s claim' end,
        'subtitle', concat_ws(' · ', 'Reservation ' || r.reservation_id, nullif(btrim(coalesce(r.car, '')), ''),
                              case when r.turo_claim_no is not null then 'Turo claim ' || r.turo_claim_no end),
        'stuck_since', since, 'blocks', blocks,
        'footer', case when fixable > 0 then 'You can undo for 24' || nb || 'hrs. — ' || v_cc else 'Still needs a look. — ' || v_cc end));
    end if;
  end loop;

  -- 2. employees whose last check-in said "not OK" for 15+ minutes.
  --    Each carries a verdict ("fix", from stuck_classify): auth -> Update key, transient -> Retry now (when the job can be re-run),
  --    everything else -> Have Scout fix it. The card draws the buttons from this; the server decides, the page just shows it.
  for a in
    select ag.slug, ag.name, ag.role, ag.runs_on, b.at, b.summary, coalesce(s.first_seen_at, b.at) as first_bad
      from bestly_agents ag
      join agent_beats b on b.slug = ag.slug
      left join stuck_seen s on s.item_id = 'agent:' || ag.slug
     where ag.kind = 'agent' and ag.status in ('active', 'new') and b.ok = false
       and coalesce(s.first_seen_at, b.at) < now() - interval '15 minutes'
       and b.at > now() - interval '3 days'
     order by coalesce(s.first_seen_at, b.at)
  loop
    continue when a.slug = 'claims-closer' and v_work;   -- already shown on the claim itself
    v_cls := stuck_classify(a.summary, a.slug);
    v_rt := stuck_retry_target(a.slug);
    v_can := coalesce(v_rt->>'via', 'none') <> 'none';
    v_fix := v_cls || jsonb_build_object(
      'retry', v_can, 'retry_via', v_rt->>'via', 'retry_job', v_rt->>'job', 'where', stuck_where(a.runs_on),
      'primary', case v_cls->>'kind' when 'auth' then 'key'
                                     when 'transient' then case when v_can then 'retry' else 'scout' end
                                     else 'scout' end,
      'error', nullif(stuck_short(a.summary, 160), ''));
    items := items || jsonb_build_array(jsonb_build_object(
      'kind', 'stuck', 'item_id', 'agent:' || a.slug, 'employee_slug', a.slug, 'employee_name', a.name,
      'title', a.name, 'subtitle', a.role, 'stuck_since', a.first_bad,
      'blocks', jsonb_build_array(jsonb_build_object('id', 'beat', 'label', v_cls->>'label',
        'detail', v_cls->>'tail', 'fix_action', null, 'fix_label', null)),
      'fix', v_fix,
      'footer', 'Still not reporting OK. — ' || a.name));
  end loop;

  -- 3. waiting on someone outside Bestly
  for r in select * from outside_claims o where o.status in ('waiting', 'escalated') order by o.reply_due_at nulls last loop
    v_who := coalesce((select name from bestly_agents where slug = r.owner_slug), 'Claims Closer');
    select string_agg(x, ' + ') into v_money from unnest(array[stuck_money(r.check_amount), stuck_money(r.shortfall_amount)]) as t(x) where x is not null;
    items := items || jsonb_build_array(jsonb_build_object(
      'kind', 'waiting', 'item_id', 'outside:' || r.id, 'employee_slug', r.owner_slug, 'employee_name', v_who,
      'title', r.title, 'subtitle', case when v_money is not null then v_money || ' owed' else r.insurer end,
      'stuck_since', r.last_sent_at,
      'link', case when r.status = 'escalated' then '/admin/pipeline' end,
      'link_label', case when r.status = 'escalated' then 'Open errands' end,
      'blocks', jsonb_build_array(
        jsonb_build_object('id', 'sent', 'label', stuck_ordinal(r.emails_sent) || ' email sent', 'detail', stuck_when(r.last_sent_at), 'fix_action', null, 'fix_label', null),
        jsonb_build_object('id', 'due', 'label', 'Reply due',
          'detail', case when r.status = 'escalated' then 'Passed ' || stuck_day(r.reply_due_at) else stuck_day(r.reply_due_at) end, 'fix_action', null, 'fix_label', null),
        jsonb_build_object('id', 'next', 'label', case when r.status = 'escalated' then 'Supervisor call' else 'If no reply' end,
          'detail', case when r.status = 'escalated' then 'Queued for Ava. Tap Call now.' else coalesce(r.if_no_reply, 'Nothing set up yet') end,
          'fix_action', null, 'fix_label', null)),
      'footer', case when r.status = 'escalated' then 'One tap places the call. — ' || v_who else 'Nothing for you to do. — ' || v_who end));
  end loop;

  return coalesce((select jsonb_agg(x order by ord) from (
      select x, row_number() over (order by (x->>'kind') = 'waiting', (x->>'stuck_since')::timestamptz nulls last) as ord
        from jsonb_array_elements(items) x) s), '[]'::jsonb);
end $$;

-- ───────────────────────── what the card shows for an action ─────────────────────────

create or replace function public.stuck_action_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', a.id, 'kind', a.kind, 'status', a.status, 'note', a.note, 'thread_id', a.thread_id,
                            'auto', a.auto, 'via', a.via, 'at', a.created_at, 'finished_at', a.finished_at, 'by', a.employee_name)
    from stuck_actions a where a.id = p_id
$$;

-- The card's feed: items (each with its verdict, its latest action and its undo), minus snoozed ones,
-- plus recent fixes whose item is no longer stuck (an Undo for 24 hours, or the retry that worked, for 3 hours).
create or replace function public.admin_stuck_items() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; fixed jsonb; worked jsonb; nb constant text := chr(160);
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  v := stuck_items_core();
  select coalesce(jsonb_agg(
           (case when x.item #>> '{fix,primary}' = 'retry' and r.failed
                 then jsonb_set(x.item, '{fix,primary}', '"scout"'::jsonb) else x.item end)
           || case when u.id is not null
                   then jsonb_build_object('undo', jsonb_build_object('id', u.id, 'label', u.label, 'until', u.expires_at, 'at', u.created_at, 'kind', u.action))
                   else '{}'::jsonb end
           || case when ac.id is not null then jsonb_build_object('action', stuck_action_json(ac.id)) else '{}'::jsonb end
           order by x.ord), '[]'::jsonb)
    into v
    from jsonb_array_elements(v) with ordinality as x(item, ord)
    left join lateral (select uu.* from stuck_undo uu
                        where uu.item_id = x.item->>'item_id' and uu.undone_at is null and uu.expires_at > now()
                        order by uu.created_at desc limit 1) u on true
    left join lateral (select aa.id from stuck_actions aa
                        where aa.item_id = x.item->>'item_id' and aa.created_at > now() - interval '24 hours'
                        order by aa.created_at desc limit 1) ac on true
    left join lateral (select exists (select 1 from stuck_actions fa
                                       where fa.item_id = x.item->>'item_id' and fa.kind in ('retry', 'auto_retry')
                                         and fa.status = 'failed' and fa.created_at > now() - interval '6 hours') as failed) r on true
   where not exists (select 1 from stuck_snooze z where z.item_id = x.item->>'item_id' and z.until > now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'fixed', 'item_id', f.item_id, 'employee_slug', f.employee_slug, 'employee_name', f.employee_name,
           'title', f.label, 'subtitle', f.subtitle, 'stuck_since', f.created_at, 'blocks', '[]'::jsonb,
           'footer', 'You can undo for 24' || nb || 'hrs. — ' || coalesce(f.employee_name, 'Claims Closer'),
           'undo', jsonb_build_object('id', f.id, 'label', f.label, 'until', f.expires_at, 'at', f.created_at, 'kind', f.action)) order by f.created_at desc), '[]'::jsonb)
    into fixed
    from (select distinct on (uu.item_id) uu.* from stuck_undo uu
           where uu.undone_at is null and uu.expires_at > now()
           order by uu.item_id, uu.created_at desc) f
   where not exists (select 1 from jsonb_array_elements(v) y where y->>'item_id' = f.item_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'fixed', 'item_id', w.item_id, 'employee_slug', w.employee_slug, 'employee_name', w.employee_name,
           'title', coalesce(w.employee_name, 'An employee'), 'subtitle', null, 'stuck_since', w.finished_at, 'blocks', '[]'::jsonb,
           'footer', null, 'action', stuck_action_json(w.id)) order by w.finished_at desc), '[]'::jsonb)
    into worked
    from (select distinct on (a.item_id) a.id, a.item_id, a.employee_slug, a.employee_name, a.finished_at from stuck_actions a
           where a.status = 'done' and a.finished_at > now() - interval '3 hours'
           order by a.item_id, a.finished_at desc) w
   where not exists (select 1 from jsonb_array_elements(v) y where y->>'item_id' = w.item_id)
     and not exists (select 1 from jsonb_array_elements(fixed) y where y->>'item_id' = w.item_id)
     and not exists (select 1 from stuck_snooze z where z.item_id = w.item_id and z.until > now());

  return v || fixed || worked;
end $$;

-- ───────────────────────── what a human (or Claude, or Scout) needs to know about one stuck item ─────────────────────────

create or replace function public.stuck_context(p_item_id text) returns jsonb
language plpgsql stable security definer set search_path = public, cron as $$
declare
  it jsonb; v_slug text; a bestly_agents; b agent_beats; fx jsonb; v_logs text; v_hosts text; v_rerun text; v_rt jsonb; v_cmd text;
  v_error text; v_where text; v_blocks text; v_name text; v_role text; v_sched text; v_since text;
begin
  select x into it from jsonb_array_elements(stuck_items_core()) x where x->>'item_id' = p_item_id and x->>'kind' = 'stuck';
  if it is null then raise exception 'That one is already fixed.'; end if;
  fx := it->'fix';
  v_name := coalesce(it->>'employee_name', 'An employee');
  v_since := stuck_span((it->>'stuck_since')::timestamptz);
  select string_agg('- ' || (bl->>'label') || coalesce(': ' || (bl->>'detail'), ''), E'\n') into v_blocks from jsonb_array_elements(it->'blocks') bl;

  if p_item_id like 'agent:%' then
    v_slug := substr(p_item_id, 7);
    select * into a from bestly_agents where slug = v_slug;
    select * into b from agent_beats where slug = v_slug;
    v_role := a.role; v_sched := coalesce(a.schedule, 'not written down');
    v_where := stuck_where(a.runs_on);
    v_error := coalesce(nullif(btrim(left(b.summary, 1200)), ''), 'No reason given.');
    if coalesce(a.pulse->>'src', '') = 'pi_job' and a.pulse->>'key' is not null then
      select string_agg(stuck_when(r.ran_at) || ' ' || case when r.ok then 'ok' else 'FAILED' end || ': ' || regexp_replace(left(coalesce(r.summary, ''), 240), E'\\s*\\n\\s*', ' | ', 'g'), E'\n' order by r.ran_at desc)
        into v_logs from (select * from pi_job_runs where job = a.pulse->>'key' order by ran_at desc limit 5) r;
    else
      select string_agg(stuck_when(l.at) || ' ' || case when l.ok then 'ok' else 'FAILED' end || ': ' || regexp_replace(left(coalesce(l.summary, ''), 240), E'\\s*\\n\\s*', ' | ', 'g'), E'\n' order by l.at desc)
        into v_logs from (select * from agent_beat_log where slug = v_slug order by at desc limit 5) l;
    end if;
    select string_agg(h.service || ' on ' || h.host || ' (' || h.runner || ' ' || h.unit || ', '
                      || case when h.active then 'running' else 'stopped' end || ', last report ' || stuck_when(h.reported_at) || ')', E'\n')
      into v_hosts from service_hosts h
     where h.present and (h.service = v_slug or h.service = regexp_replace(v_slug, '^pi-', '') or h.service = replace(coalesce(a.pulse->>'key', '-'), '_', '-'));
    v_rt := stuck_retry_target(v_slug);
    if v_rt->>'via' = 'pi' then v_rerun := 'On bestly-pi: /opt/bestly/cron/run.sh ' || (v_rt->>'job');
    elsif v_rt->>'via' = 'cloud' then
      select cj.command into v_cmd from cron.job cj where cj.jobname = v_rt->>'job';
      v_rerun := 'In Supabase SQL (this is what the ' || (v_rt->>'job') || ' schedule runs): ' || coalesce(btrim(v_cmd), '?');
    else v_rerun := 'There is no one-tap re-run for this employee. Find how it is started on ' || v_where || '.';
    end if;
  else
    v_role := 'Turo claims'; v_sched := 'every 2 min when a case needs work'; v_where := 'Supabase (cloud), with the Turo reader on bestly-pi';
    v_error := coalesce(v_blocks, 'No reason given.');
    select string_agg(stuck_when(e.created_at) || ' ' || e.kind || ': ' || left(coalesce(e.title, ''), 200), E'\n' order by e.created_at desc)
      into v_logs from (select * from claim_events where case_id = nullif(substr(p_item_id, 7), '')::uuid order by created_at desc limit 5) e;
    v_hosts := null;
    v_rerun := 'The card''s own buttons (admin_stuck_fix) release a hold, mark the trip complete, ask for a sync, or wake the worker.';
  end if;

  return jsonb_build_object('item_id', p_item_id, 'name', v_name, 'role', v_role, 'slug', coalesce(v_slug, 'claims-closer'),
    'since', v_since, 'error', v_error, 'where', v_where, 'schedule', v_sched, 'kind', coalesce(fx->>'kind', 'other'),
    'logs', coalesce(v_logs, 'No runs on record.'), 'hosts', v_hosts, 'rerun', v_rerun, 'blocks', v_blocks);
end $$;

-- ───────────────────────── Retry now ─────────────────────────
-- Internal (Jared's tap goes through admin_stuck_run; the sweep calls this with p_auto = true).
-- Re-runs the employee's own job right away and logs one stuck_actions row; stuck_actions_settle() writes the outcome.
create or replace function public.stuck_run_retry(p_item_id text, p_auto boolean default false, p_by uuid default null) returns jsonb
language plpgsql security definer set search_path = public, cron as $$
declare it jsonb; v_slug text; rt jsonb; v_beat timestamptz; v_cmd text; aid uuid; req uuid; v_wait boolean; v_name text;
begin
  if p_item_id is null or p_item_id !~ '^agent:' then raise exception 'Retry only works on an employee''s own job.'; end if;
  select x into it from jsonb_array_elements(stuck_items_core()) x where x->>'item_id' = p_item_id and x->>'kind' = 'stuck';
  if it is null then raise exception 'That one is already fixed.'; end if;
  v_slug := substr(p_item_id, 7);
  v_name := coalesce(it->>'employee_name', v_slug);
  rt := stuck_retry_target(v_slug);
  if coalesce(rt->>'via', 'none') = 'none' then raise exception 'There is no retry for this one. Ask Scout instead.'; end if;
  v_wait := coalesce((rt->>'wait_beat')::boolean, false);
  select at into v_beat from agent_beats where slug = v_slug;

  insert into stuck_actions (item_id, employee_slug, employee_name, kind, via, job, beat_before, wait_beat, auto, by_user, note)
  values (p_item_id, v_slug, v_name, case when p_auto then 'auto_retry' else 'retry' end, rt->>'via', rt->>'job', v_beat, v_wait, p_auto, p_by,
          case when rt->>'via' = 'pi' then 'Asked bestly-pi to run ' || (rt->>'job') || ' again right now.' else 'Running ' || (rt->>'job') || ' again right now.' end)
  returning id into aid;

  if rt->>'via' = 'pi' then
    insert into pi_run_requests (job, action_id) values (rt->>'job', aid) returning id into req;
    update stuck_actions set request_id = req where id = aid;
  else
    select cj.command into v_cmd from cron.job cj where cj.jobname = rt->>'job' and cj.active;
    begin
      execute v_cmd;
      if not v_wait then
        update stuck_actions set status = 'done', finished_at = now(), note = 'Ran ' || (rt->>'job') || ' just now. It finished without an error.' where id = aid;
      end if;
    exception when others then
      update stuck_actions set status = 'failed', finished_at = now(), note = 'It could not start: ' || stuck_short(sqlerrm, 140) || '.' where id = aid;
    end;
  end if;
  return stuck_action_json(aid);
end $$;

-- ───────────────────────── Have Scout fix it ─────────────────────────
-- Opens an Autopilot thread (so it follows Scout's existing approval rules: anything that needs Jared's yes comes back as NEEDS_YES)
-- and asks fix-ladder (op stuck_scout) to send the brief to admin-chat with autopilot:true. The edge call is fire-and-forget here.
create or replace function public.stuck_run_scout(p_item_id text, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_name text; aid uuid; tid uuid;
begin
  select x into it from jsonb_array_elements(stuck_items_core()) x where x->>'item_id' = p_item_id and x->>'kind' = 'stuck';
  if it is null then raise exception 'That one is already fixed.'; end if;
  v_name := coalesce(it->>'employee_name', 'An employee');
  insert into admin_chat_threads (user_id, title) values (p_by, left('Autopilot: ' || v_name || ' is stuck', 70)) returning id into tid;
  insert into stuck_actions (item_id, employee_slug, employee_name, kind, via, thread_id, by_user, note)
  values (p_item_id, it->>'employee_slug', v_name, 'scout', 'scout', tid, p_by, 'Scout is looking into it.')
  returning id into aid;
  begin
    perform invoke_edge_function('fix-ladder', jsonb_build_object('op', 'stuck_scout', 'action_id', aid), 30000);
  exception when others then
    update stuck_actions set status = 'failed', finished_at = now(), note = 'Scout could not be reached: ' || stuck_short(sqlerrm, 140) || '.' where id = aid;
  end;
  return stuck_action_json(aid);
end $$;

-- ───────────────────────── Jared's tap ─────────────────────────
create or replace function public.admin_stuck_run(p_item_id text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_until timestamptz; v_undo uuid; v_name text;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_action is null or p_action not in ('retry', 'scout', 'snooze') then raise exception 'That button does not exist.'; end if;
  select x into it from jsonb_array_elements(stuck_items_core()) x where x->>'item_id' = p_item_id and x->>'kind' = 'stuck';
  if it is null then raise exception 'That one is already fixed.'; end if;
  if p_action <> 'snooze' and exists (select 1 from stuck_actions a where a.item_id = p_item_id and a.status = 'working' and a.created_at > now() - interval '15 minutes') then
    raise exception 'I am already working on this one.';
  end if;

  if p_action = 'retry' then return stuck_run_retry(p_item_id, false, auth.uid()); end if;
  if p_action = 'scout' then return stuck_run_scout(p_item_id, auth.uid()); end if;

  -- snooze: hidden from the card and the pushes for a day; Undo (24 hours) brings it back
  v_name := coalesce(it->>'employee_name', 'An employee');
  v_until := now() + interval '1 day';
  insert into stuck_snooze (item_id, until, by_user) values (p_item_id, v_until, auth.uid())
  on conflict (item_id) do update set until = excluded.until, by_user = excluded.by_user, created_at = now();
  insert into stuck_undo (item_id, employee_slug, employee_name, label, subtitle, action, snapshot, by_user)
  values (p_item_id, it->>'employee_slug', v_name, 'Snoozed for 1' || chr(160) || 'day', 'Comes back ' || stuck_when(v_until), 'snooze',
          jsonb_build_object('snooze', true), auth.uid())
  returning id into v_undo;
  return jsonb_build_object('ok', true, 'undo_id', v_undo, 'snoozed_until', v_until, 'employee', v_name);
end $$;

-- The card polls this every few seconds while an action is working. It settles whatever has finished, then answers.
create or replace function public.admin_stuck_action(p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  perform stuck_actions_settle();
  return stuck_action_json(p_action_id);
end $$;

-- ───────────────────────── outcomes: working -> done / failed / needs_yes ─────────────────────────
-- Called by the card's poll and by the 5-minute sweep. Each outcome is a plain sentence; the card signs it with the employee's name.
-- A failed AUTOMATIC retry is the only thing here that pushes Jared (once, signed by the employee).
create or replace function public.stuck_actions_settle() returns integer
language plpgsql security definer set search_path = public as $$
declare
  a stuck_actions; r pi_run_requests; b agent_beats; n integer := 0; v_status text; v_note text; v_reply text; v_hit text[]; v_line text;
  v_cls jsonb; v_bridge boolean := false; v_busy boolean;
begin
  for a in select * from stuck_actions where status = 'working' order by created_at for update skip locked loop
    v_status := null; v_note := null;

    if a.kind in ('retry', 'auto_retry') and a.via = 'pi' then
      select * into r from pi_run_requests where id = a.request_id;
      if r.id is null then
        v_status := 'failed'; v_note := 'The request to bestly-pi went missing.';
      elsif r.status = 'done' then
        v_status := 'done'; v_note := a.job || ' ran fine on bestly-pi at ' || stuck_clock(r.finished_at) || '.'; v_bridge := true;
      elsif r.status = 'failed' then
        v_cls := stuck_classify(r.summary, a.employee_slug);
        v_status := 'failed'; v_note := 'It ran again on bestly-pi and failed. ' || (v_cls->>'label') || ': ' || coalesce(nullif(stuck_short(r.summary, 110), ''), 'no reason given') || '.';
      elsif r.status = 'expired' or (r.status = 'queued' and r.created_at < now() - interval '3 minutes') then
        update pi_run_requests set status = 'expired', finished_at = now() where id = r.id and status = 'queued';
        v_status := 'failed'; v_note := 'bestly-pi did not pick this up within 3' || chr(160) || 'minutes. Its retry runner may be off.';
      elsif r.status = 'running' and r.claimed_at < now() - interval '15 minutes' then
        update pi_run_requests set status = 'failed', summary = 'ran longer than 15 minutes', finished_at = now() where id = r.id;
        v_status := 'failed'; v_note := 'It was still running on bestly-pi after 15' || chr(160) || 'minutes, so I stopped waiting.';
      end if;

    elsif a.kind in ('retry', 'auto_retry') then   -- cloud: the employee's own check-in is the answer
      select * into b from agent_beats where slug = a.employee_slug;
      if b.at is not null and b.at >= a.created_at then
        if b.ok then
          v_status := 'done'; v_note := 'Checked in OK at ' || stuck_clock(b.at) || '.';
        else
          v_cls := stuck_classify(b.summary, a.employee_slug);
          v_status := 'failed'; v_note := 'It ran again and failed. ' || (v_cls->>'label') || ': ' || coalesce(nullif(stuck_short(b.summary, 110), ''), 'no reason given') || '.';
        end if;
      elsif a.created_at < now() - interval '5 minutes' then
        v_status := 'failed'; v_note := 'It did not check in within 5' || chr(160) || 'minutes.';
      end if;

    elsif a.kind = 'scout' then
      select m.body into v_reply from admin_chat_messages m where m.thread_id = a.thread_id and m.role = 'assistant' order by m.created_at desc limit 1;
      if v_reply is null then
        if a.created_at < now() - interval '10 minutes' then
          v_status := 'failed'; v_note := 'Scout did not answer within 10' || chr(160) || 'minutes. Open the thread to see where it stopped.';
        end if;
      else
        v_hit := null;
        for v_hit in select regexp_matches(v_reply, '^(FIXED|NEEDS_YES|STUCK):[ \t]*(.+)$', 'gn') loop null; end loop;   -- keeps the last verdict line
        v_busy := v_reply ~* 'free AI (is out of room|isn.t answering right now)|waiting for the free AI|tried every free AI provider|Every free AI provider is out right now' and length(v_reply) < 2500;
        if v_hit is not null then
          v_line := stuck_short(v_hit[2], 220);
          if v_hit[1] = 'FIXED' then v_status := 'done'; v_note := 'Scout says it is fixed: ' || v_line;
          elsif v_hit[1] = 'NEEDS_YES' then v_status := 'needs_yes'; v_note := 'Scout found a fix but needs your yes: ' || v_line;
          else v_status := 'failed'; v_note := 'Scout could not fix it: ' || v_line;
          end if;
        elsif v_busy and a.created_at > now() - interval '10 minutes' then
          null;   -- the free AI was busy; Scout carries on by itself, so keep waiting
        elsif a.created_at < now() - interval '3 minutes' then
          v_status := 'failed'; v_note := 'Scout answered without a clear result: ' || coalesce(nullif(stuck_short(regexp_replace(btrim(v_reply), '^.*\n', ''), 200), ''), 'no text') || '.';
        end if;
      end if;
    end if;

    if v_status is not null then
      update stuck_actions set status = v_status, note = v_note, finished_at = now() where id = a.id;
      n := n + 1;
      if a.auto and v_status = 'failed' and a.notified_at is null then
        begin
          perform notify_route(left(coalesce(a.employee_name, 'Bestly') || ': my automatic retry did not work', 190),
                               v_note || ' Open the Command Center to fix it.', 'time-sensitive', coalesce(a.employee_name, 'Bestly'),
                               'https://cloud.bestly.tech/admin', null, 'stuck-autoretry-' || a.id, null, null, false, now());
        exception when others then null;
        end;
        update stuck_actions set notified_at = now() where id = a.id;
      end if;
    end if;
  end loop;

  if v_bridge then   -- a Pi retry that worked: copy the fresh job state into the check-ins now so the card clears on this tap
    begin perform team_beat_bridge(); exception when others then null; end;
  end if;
  return n;
end $$;

-- ───────────────────────── Undo (snooze joins the claim fixes) ─────────────────────────
create or replace function public.admin_stuck_undo(p_undo_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u stuck_undo; s record; v_case uuid; v_res bigint; n integer; done_ text[] := '{}'; skipped text[] := '{}';
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  select * into u from stuck_undo where id = p_undo_id for update;
  if u.id is null then raise exception 'That fix is gone.'; end if;
  if u.undone_at is not null then raise exception 'Already undone.'; end if;
  if u.expires_at <= now() then raise exception 'The 24 hours to undo are up.'; end if;

  if u.action = 'snooze' then   -- not a claim: just wake the item up again
    delete from stuck_snooze where item_id = u.item_id;
    update stuck_undo set undone_at = now() where id = u.id;
    return jsonb_build_object('ok', true, 'restored', '[]'::jsonb, 'skipped', '[]'::jsonb, 'label', u.label);
  end if;

  v_case := (u.snapshot->>'case_id')::uuid;
  select reservation_id into v_res from claim_cases where id = v_case;

  for s in select x as step from jsonb_array_elements(u.snapshot->'steps') with ordinality as t(x, ord) order by ord desc loop
    n := 0;
    if s.step->>'block' = 'trip_complete' then
      update lax_guest_links set
             returned_at = (s.step->'before'->>'returned_at')::timestamptz,
             settled_at = (s.step->'before'->>'settled_at')::timestamptz,
             host_completed_at = (s.step->'before'->>'host_completed_at')::timestamptz
       where reservation_id = (s.step->>'reservation_id')::bigint
         and host_completed_at is not distinct from (s.step->>'after_hc')::timestamptz;
      get diagnostics n = row_count;
    elsif s.step->>'block' = 'hold' then
      update claim_cases set
             outbound_hold = coalesce((s.step->'before'->>'outbound_hold')::boolean, false),
             outbound_hold_reason = s.step->'before'->>'outbound_hold_reason',
             outbound_hold_at = (s.step->'before'->>'outbound_hold_at')::timestamptz,
             needs_work = coalesce((s.step->'before'->>'needs_work')::boolean, false),
             work_reason = s.step->'before'->>'work_reason',
             next_check_at = (s.step->'before'->>'next_check_at')::timestamptz,
             updated_at = now()
       where id = v_case and not coalesce(outbound_hold, false);
      get diagnostics n = row_count;
    elsif s.step->>'block' in ('sync', 'wake') then
      update claim_cases set
             needs_work = coalesce((s.step->'before'->>'needs_work')::boolean, false),
             work_reason = s.step->'before'->>'work_reason',
             next_check_at = (s.step->'before'->>'next_check_at')::timestamptz,
             updated_at = now()
       where id = v_case;
      get diagnostics n = row_count;
    end if;
    if n > 0 then done_ := array_append(done_, (s.step->>'block')::text); else skipped := array_append(skipped, (s.step->>'block')::text); end if;
  end loop;

  update stuck_undo set undone_at = now() where id = u.id;
  insert into claim_events (case_id, reservation_id, kind, title, detail)
  values (v_case, v_res, 'note', 'Undid Command Center fix: ' || u.label,
          jsonb_build_object('by', auth.uid(), 'undo_id', u.id, 'restored', to_jsonb(done_), 'skipped', to_jsonb(skipped)));
  return jsonb_build_object('ok', true, 'restored', to_jsonb(done_), 'skipped', to_jsonb(skipped), 'label', u.label);
end $$;

-- ───────────────────────── Prompt for Claude / the brief Scout gets ─────────────────────────

create or replace function public.stuck_kind_sentence(p_kind text) returns text
language sql immutable set search_path = public as $$
  select case p_kind
    when 'auth' then 'A saved key or login was refused (401/403, expired or revoked). The fix is almost always a new key pasted into the right page; check that before changing code.'
    when 'transient' then 'The error looks temporary (free AI did not answer, rate limit, timeout, 5xx or network). A plain re-run usually works; if it keeps failing, find out why.'
    else 'The error does not match a known pattern. Find the real cause.' end
$$;

-- What Jared pastes into Claude. Plain text; nothing is copied until he taps Copy on the card.
create or replace function public.admin_stuck_prompt(p_item_id text) returns text
language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  c := stuck_context(p_item_id);
  return 'Fix this Bestly employee end to end. The Command Center says it has been stuck for ' || (c->>'since') || '.' || E'\n\n'
    || 'EMPLOYEE: ' || (c->>'name') || ' (' || coalesce(c->>'role', '-') || '), slug ' || (c->>'slug') || E'\n'
    || 'RUNS FROM: ' || (c->>'where') || E'\n'
    || 'SCHEDULE: ' || (c->>'schedule') || E'\n\n'
    || 'WHAT IT SAID LAST:' || E'\n' || (c->>'error') || E'\n\n'
    || 'WHAT KIND OF TROUBLE: ' || stuck_kind_sentence(c->>'kind') || E'\n\n'
    || 'RECENT RUNS (newest first):' || E'\n' || (c->>'logs') || E'\n\n'
    || case when c->>'hosts' is not null then 'SERVICES (service_hosts):' || E'\n' || (c->>'hosts') || E'\n\n' else '' end
    || 'RE-RUN IT: ' || (c->>'rerun') || E'\n\n'
    || 'WHERE THINGS LIVE' || E'\n'
    || '- Site + admin: repo Bestly-LLC/bestlytech (Vite + React + TS), Vercel deploys main. Read CLAUDE.md first. Commit and push when done.' || E'\n'
    || '- Supabase project rcqfqhguwpmaarseifqg. Check-ins land in public.agent_beats; the Command Center card is public.admin_stuck_items(). Migrations are append-only.' || E'\n'
    || '- Pi jobs run through /opt/bestly/cron/run.sh and report with public.pi_job_report(); Mac mini services are launchd (tech.bestly.*). Secrets live only in Supabase Vault.' || E'\n\n'
    || 'FIXED MEANS' || E'\n'
    || '1. The root cause is found and fixed, not just the symptom.' || E'\n'
    || '2. After a re-run, this shows ok = true: select ok, summary, at from public.agent_beats where slug = ''' || (c->>'slug') || ''';' || E'\n'
    || '3. The employee is gone from the stuck card: it no longer appears in public.stuck_items_core() as item ''' || (c->>'item_id') || '''.' || E'\n'
    || '4. If it could happen again, add a scout_lessons row so Scout fixes it alone next time.';
end $$;

-- What Scout is asked (fix-ladder op stuck_scout reads this with the service key). Same verdict lines as the fix ladder.
create or replace function public.stuck_scout_brief(p_action_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a stuck_actions; c jsonb;
begin
  select * into a from stuck_actions where id = p_action_id and kind = 'scout';
  if a.id is null then return null; end if;
  c := stuck_context(a.item_id);
  return jsonb_build_object('thread_id', a.thread_id, 'item_id', a.item_id, 'ask', left(
    'Autopilot fix attempt from the Command Center. Jared tapped "Have Scout fix it" and is not watching.' || E'\n'
    || 'Employee: ' || (c->>'name') || ' (' || coalesce(c->>'role', '-') || '), slug ' || (c->>'slug') || '. Stuck for ' || (c->>'since') || '.' || E'\n'
    || 'Runs from: ' || (c->>'where') || '. Schedule: ' || (c->>'schedule') || '.' || E'\n'
    || 'Its last check-in said:' || E'\n' || (c->>'error') || E'\n\n'
    || 'Recent runs, newest first:' || E'\n' || (c->>'logs') || E'\n\n'
    || case when c->>'hosts' is not null then 'Services:' || E'\n' || (c->>'hosts') || E'\n\n' else '' end
    || 'How to re-run it: ' || (c->>'rerun') || E'\n'
    || 'Fixed means: its next check-in reports ok (agent_beats.ok = true for ' || (c->>'slug') || ') and it leaves public.stuck_items_core().' || E'\n\n'
    || 'Find the root cause with your tools and fix it if you can do that without Jared''s yes. Anything that needs his yes will be refused, so do not try it; describe it instead.' || E'\n'
    || 'If you fix it, save what worked with learn so next time is instant. Keep it to a few tool calls.' || E'\n'
    || 'End your reply with exactly ONE of these as the last line:' || E'\n'
    || 'FIXED: <what you did, one line Jared will read>' || E'\n'
    || 'NEEDS_YES: <the exact single action you would take with his yes, one line>' || E'\n'
    || 'STUCK: <why, one line>', 5900));
end $$;

-- ───────────────────────── the Pi side: run a job on request ─────────────────────────
-- The Pi runner (tools/stuck-retry/run_requests.py, a one-minute Pi cron job) calls these two with the service role.
create or replace function public.pi_run_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r pi_run_requests;
begin
  update pi_run_requests set status = 'expired', finished_at = now() where status = 'queued' and created_at < now() - interval '10 minutes';
  select * into r from pi_run_requests q
   where q.status = 'queued' and exists (select 1 from pi_jobs j where j.job = q.job and j.enabled)
   order by q.created_at limit 1 for update skip locked;
  if r.id is null then return null; end if;
  update pi_run_requests set status = 'running', claimed_at = now() where id = r.id;
  return jsonb_build_object('id', r.id, 'job', r.job);
end $$;

create or replace function public.pi_run_finish(p_id uuid, p_ok boolean, p_summary text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update pi_run_requests set status = case when p_ok then 'done' else 'failed' end, summary = left(p_summary, 1000), finished_at = now()
   where id = p_id and status = 'running';
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ───────────────────────── pushes stay quiet for snoozed items ─────────────────────────

create or replace function public.stuck_push() returns integer
language plpgsql security definer set search_path = public as $$
declare i jsonb; n integer := 0; v_key text; v_first timestamptz; v_title text; v_body text; v_name text; v_agents boolean;
begin
  select push_agents into v_agents from stuck_state where id;
  for i in
    select x from jsonb_array_elements(stuck_items_core()) x
     where x->>'kind' = 'stuck' and (x->>'stuck_since')::timestamptz < now() - interval '1 hour'
       and not exists (select 1 from stuck_snooze z where z.item_id = x->>'item_id' and z.until > now())   -- snoozed: stay quiet
     order by (x->>'stuck_since')::timestamptz
  loop
    exit when n >= 3;
    continue when (i->>'item_id') like 'agent:%' and not coalesce(v_agents, false);
    insert into stuck_seen (item_id, kind, first_seen_at) values (i->>'item_id', 'stuck', coalesce((i->>'stuck_since')::timestamptz, now())) on conflict (item_id) do nothing;
    select first_seen_at into v_first from stuck_seen where item_id = i->>'item_id' and pushed_at is null;
    continue when v_first is null;                       -- already pushed for this episode

    v_name := coalesce(i->>'employee_name', 'Bestly');
    v_title := (i->>'title') || ' is stuck';
    v_body := (select string_agg(b->>'label', '; ') from jsonb_array_elements(i->'blocks') b) || '. Open the Command Center to fix it.';
    v_key := 'stuck-push-' || (i->>'item_id') || '-' || to_char(v_first, 'YYYYMMDDHH24MI');
    begin
      if i->>'employee_slug' = 'claims-closer' then
        perform claims_notify(v_title, v_body, 'warning', v_key);
      else
        perform notify_route(v_name || ': ' || left(v_title, 170), v_body, 'time-sensitive', v_name, 'https://bestly.tech/admin', null, v_key, null, null, false, now());
      end if;
    exception when others then null;
    end;
    update stuck_seen set pushed_at = now(), push_count = push_count + 1 where item_id = i->>'item_id';
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────────────────── automatic Retry now ─────────────────────────
-- Called by stuck_sweep() every 5 minutes. A TRANSIENT employee item stuck for 1 hour or more gets one "Retry now", at most once per
-- item per 6 hours (counting Jared's own retries too, so we never stack tries). Free-AI errors wait until FreeLLM is healthy, then
-- go, so the tries are not wasted while it is down. Never touches auth items or Scout, never touches snoozed items, at most 3 per sweep.
-- Every attempt is a stuck_actions row (auto = true): that is the log. A success is silent; a failure pushes Jared once, signed by the
-- employee (stuck_actions_settle). Pass p_dry = true to see what would run (the watchdog does).
create or replace function public.stuck_auto_retry(p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st stuck_state; it jsonb; fx jsonb; n integer := 0; v_ids text[] := '{}'; v_free boolean;
begin
  select * into st from stuck_state where id;
  if not coalesce(st.auto_retry, true) then return jsonb_build_object('ran', 0, 'picked', '[]'::jsonb, 'off', true); end if;
  v_free := stuck_freellm_healthy();
  for it in
    select x from jsonb_array_elements(stuck_items_core()) x
     where x->>'kind' = 'stuck' and x->>'item_id' like 'agent:%'
     order by (x->>'stuck_since')::timestamptz
  loop
    exit when n >= 3;
    fx := it->'fix';
    continue when fx is null or fx->>'kind' is distinct from 'transient' or not coalesce((fx->>'retry')::boolean, false);
    continue when (it->>'stuck_since')::timestamptz > now() - interval '1 hour';
    continue when fx->>'service' = 'free_ai' and not v_free;
    continue when exists (select 1 from stuck_snooze z where z.item_id = it->>'item_id' and z.until > now());
    continue when exists (select 1 from stuck_actions a where a.item_id = it->>'item_id'
                           and ((a.kind in ('retry', 'auto_retry') and a.created_at > now() - interval '6 hours') or a.status = 'working'));
    v_ids := array_append(v_ids, (it->>'item_id')::text);
    n := n + 1;
    if not p_dry then
      begin perform stuck_run_retry(it->>'item_id', true, null);
      exception when others then n := n - 1; v_ids := v_ids[1:cardinality(v_ids) - 1];
      end;
    end if;
  end loop;
  return jsonb_build_object('ran', case when p_dry then 0 else n end, 'picked', to_jsonb(v_ids), 'dry', p_dry);
end $$;

-- Every 5 minutes: remember when each item became stuck, forget the fixed ones, settle finished actions, auto-retry, push.
create or replace function public.stuck_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_items jsonb; v_ids text[]; v_pushed integer; v_msg text; v_settled integer := 0; v_auto jsonb;
begin
  v_items := stuck_items_core();
  select coalesce(array_agg(x->>'item_id'), '{}') into v_ids from jsonb_array_elements(v_items) x where x->>'kind' = 'stuck';
  insert into stuck_seen (item_id, kind, first_seen_at, last_seen_at)
  select x->>'item_id', 'stuck', coalesce((x->>'stuck_since')::timestamptz, now()), now()
    from jsonb_array_elements(v_items) x where x->>'kind' = 'stuck'
  on conflict (item_id) do update set last_seen_at = now();
  delete from stuck_seen where not (item_id = any (v_ids));
  begin v_settled := stuck_actions_settle(); exception when others then v_settled := -1; end;
  begin v_auto := stuck_auto_retry(); exception when others then v_auto := jsonb_build_object('error', left(sqlerrm, 200)); end;
  v_pushed := stuck_push();
  update stuck_state set swept_at = now(), last_error = nullif(v_auto->>'error', '') where id;
  return jsonb_build_object('stuck', cardinality(v_ids), 'pushed', v_pushed, 'settled', v_settled, 'auto', v_auto);
exception when others then
  v_msg := left(sqlerrm, 300);
  update stuck_state set last_error = v_msg where id;
  return jsonb_build_object('error', v_msg);
end $$;

-- ───────────────────────── watchdog ─────────────────────────
-- Raises stuck.feed (owner: Claims Closer, via notification_owners 'stuck') when the card cannot be trusted. New in this version:
-- the classifier gets a wrong answer on a known error, a stuck employee has no fix button, the retry path raises or an employee's
-- retry target is malformed, automatic retry ran twice inside 6 hours on one item (the cap is broken), a fix has been "working"
-- for 20+ minutes, or a Pi retry request sits unpicked for 5+ minutes (the runner on bestly-pi is off).
-- It tries the obvious self-heal first (run the sweep / the daily check / settle) and only then raises.
create or replace function public.stuck_feed_selftest() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st stuck_state; v_items jsonb; v_probs text[] := '{}'; n_hold integer; n_seen integer; v_healed boolean := false;
  v_bad text[]; v_n integer; v_rt jsonb; v_sl record;
begin
  select * into st from stuck_state where id;

  begin
    v_items := stuck_items_core();
    select count(*) into n_hold from claim_cases where status not in ('paid', 'closed') and not coalesce(history, false) and coalesce(outbound_hold, false);
    select count(*) into n_seen from jsonb_array_elements(v_items) i
     where i->>'item_id' like 'claim:%' and exists (select 1 from jsonb_array_elements(i->'blocks') b where b->>'id' = 'hold');
    if n_hold <> n_seen then v_probs := array_append(v_probs, (n_hold || ' claim(s) are on hold but the card shows ' || n_seen)::text); end if;
  exception when others then
    v_probs := array_append(v_probs, ('the feed raised an error: ' || left(sqlerrm, 160))::text);
  end;

  -- the classifier still gives the right verdict for the errors we know
  begin
    v_bad := stuck_classify_selftest();
    if cardinality(v_bad) > 0 then
      v_probs := array_append(v_probs, ('the error classifier is wrong on ' || cardinality(v_bad) || ' known error(s): ' || array_to_string(v_bad, ', '))::text);
    end if;
  exception when others then
    v_probs := array_append(v_probs, ('the error classifier raised an error: ' || left(sqlerrm, 160))::text);
  end;

  -- every stuck employee has a verdict and one primary button, and a Retry button only where a retry exists
  begin
    select count(*) into v_n from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) i
     where i->>'item_id' like 'agent:%'
       and (i->'fix' is null
            or (i->'fix'->>'primary') is null or (i->'fix'->>'primary') not in ('key', 'retry', 'scout')
            or ((i->'fix'->>'primary') = 'retry' and not coalesce((i->'fix'->>'retry')::boolean, false)));
    if v_n > 0 then v_probs := array_append(v_probs, (v_n || ' stuck employee(s) have no fix button')::text); end if;
  exception when others then
    v_probs := array_append(v_probs, ('checking the fix buttons raised an error: ' || left(sqlerrm, 160))::text);
  end;

  -- the retry path: every employee resolves to pi / cloud / none, and the automatic pass can pick (dry run, runs nothing)
  begin
    for v_sl in select slug from bestly_agents where kind = 'agent' and status in ('active', 'new') loop
      v_rt := stuck_retry_target(v_sl.slug);
      if coalesce(v_rt->>'via', 'none') not in ('pi', 'cloud', 'none') then
        v_probs := array_append(v_probs, ('the retry target for ' || v_sl.slug || ' is malformed')::text);
        exit;
      end if;
    end loop;
    perform stuck_auto_retry(true);
  exception when others then
    v_probs := array_append(v_probs, ('the retry path raised an error: ' || left(sqlerrm, 160))::text);
  end;

  -- the 6-hour cap held: no item has two automatic retries inside 6 hours
  select count(*) into v_n from (select item_id from stuck_actions where kind = 'auto_retry' and created_at > now() - interval '6 hours'
                                  group by item_id having count(*) > 1) x;
  if v_n > 0 then v_probs := array_append(v_probs, (v_n || ' item(s) were retried automatically twice inside 6 hours')::text); end if;

  -- an action must not stay "working"
  if exists (select 1 from stuck_actions where status = 'working' and created_at < now() - interval '20 minutes') then
    begin perform stuck_actions_settle(); exception when others then null; end;
    if exists (select 1 from stuck_actions where status = 'working' and created_at < now() - interval '20 minutes') then
      v_probs := array_append(v_probs, 'a fix has been working for over 20 minutes with no answer'::text);
    else v_healed := true; end if;
  end if;

  -- a Pi retry that nobody picked up: the runner on bestly-pi is off
  if exists (select 1 from pi_run_requests where status = 'queued' and created_at < now() - interval '5 minutes') then
    v_probs := array_append(v_probs, 'a Pi retry request has waited 5+ minutes; the retry runner on bestly-pi (job run_requests) may be off'::text);
  end if;

  if coalesce(st.swept_at, st.created_at) < now() - interval '20 minutes' then
    begin perform stuck_sweep(); exception when others then null; end;
    select * into st from stuck_state where id;
    if coalesce(st.swept_at, st.created_at) < now() - interval '20 minutes' then v_probs := array_append(v_probs, 'the 5-minute sweep has not run in over 20 minutes'::text);
    else v_healed := true; end if;
  end if;

  if exists (select 1 from outside_claims where status = 'waiting' and reply_due_at < now() - interval '36 hours') then
    begin perform outside_claims_check(); exception when others then null; end;
    if exists (select 1 from outside_claims where status = 'waiting' and reply_due_at < now() - interval '36 hours') then
      v_probs := array_append(v_probs, 'an outside claim is 36+ hours past its reply date and the daily check did not act on it'::text);
    else v_healed := true; end if;
  end if;

  if cardinality(v_probs) > 0 then
    perform bestly_raise('stuck.feed', 'problem', 'warning', 'The stuck card is not trustworthy', array_to_string(v_probs, '; ') || '.', 'turo', null, false);
  else
    perform bestly_raise('stuck.feed', 'resolved', 'info', 'The stuck card is working', null, 'turo', null, true);
  end if;
  return jsonb_build_object('problems', to_jsonb(v_probs), 'healed', v_healed);
end $$;

-- ───────────────────────── who can call what ─────────────────────────

do $$ declare f text; begin
  foreach f in array array['admin_stuck_items()', 'admin_stuck_undo(uuid)', 'admin_stuck_run(text,text)', 'admin_stuck_action(uuid)', 'admin_stuck_prompt(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['stuck_where(text)', 'stuck_classify(text,text)', 'stuck_classify_selftest()', 'stuck_kind_sentence(text)', 'stuck_retry_target(text)',
                           'stuck_freellm_healthy()', 'stuck_action_json(uuid)', 'stuck_context(text)', 'stuck_run_retry(text,boolean,uuid)',
                           'stuck_run_scout(text,uuid)', 'stuck_actions_settle()', 'stuck_scout_brief(uuid)', 'stuck_auto_retry(boolean)',
                           'pi_run_claim()', 'pi_run_finish(uuid,boolean,text)', 'stuck_items_core()', 'stuck_push()', 'stuck_sweep()', 'stuck_feed_selftest()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ───────────────────────── schedules ─────────────────────────
-- Nothing new to schedule: stuck-sweep (every 5 minutes) now also settles finished actions and runs the automatic retry,
-- and stuck-feed-selftest (every 15 minutes) now also checks the classifier and the retry path.
-- Pi side (one new one-minute job; see tools/stuck-retry/README.md):  * * * * *  /opt/bestly/cron/run.sh run_requests
-- Edge side: redeploy the fix-ladder function (new op stuck_scout). Page side: this branch.

-- ───────────────────────── UNDO (this migration) ─────────────────────────
-- Run in this order to take it back out. Nothing from 20261027220000_stuck_card.sql is dropped.
--
-- 1. Put the six functions this file replaced back to their 20261027220000_stuck_card.sql versions: re-run the `create or replace`
--    block for each of  stuck_items_core, admin_stuck_items, admin_stuck_undo, stuck_push, stuck_sweep, stuck_feed_selftest
--    from that file (it already carries the array_append fix, so it matches what was live before this change).
-- 2. Drop what this file added:
--
-- drop function if exists public.pi_run_finish(uuid, boolean, text);
-- drop function if exists public.pi_run_claim();
-- drop function if exists public.stuck_scout_brief(uuid);
-- drop function if exists public.admin_stuck_prompt(text);
-- drop function if exists public.stuck_kind_sentence(text);
-- drop function if exists public.admin_stuck_action(uuid);
-- drop function if exists public.admin_stuck_run(text, text);
-- drop function if exists public.stuck_actions_settle();
-- drop function if exists public.stuck_auto_retry(boolean);
-- drop function if exists public.stuck_run_scout(text, uuid);
-- drop function if exists public.stuck_run_retry(text, boolean, uuid);
-- drop function if exists public.stuck_context(text);
-- drop function if exists public.stuck_action_json(uuid);
-- drop function if exists public.stuck_freellm_healthy();
-- drop function if exists public.stuck_retry_target(text);
-- drop function if exists public.stuck_classify_selftest();
-- drop function if exists public.stuck_classify(text, text);
-- drop function if exists public.stuck_where(text);
-- drop table if exists public.pi_run_requests;
-- drop table if exists public.stuck_snooze;
-- drop table if exists public.stuck_actions;
-- alter table public.stuck_state drop column if exists auto_retry;
-- delete from public.stuck_undo where action = 'snooze';
--
-- Order matters only for step 1 first (the old stuck_items_core must be back before the new helper functions go).
-- Then redeploy the previous fix-ladder (op stuck_scout is simply never called) and remove the Pi job:
--   crontab: delete the run_requests line; update pi_jobs set enabled = false where job = 'run_requests';
