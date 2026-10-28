-- Scout: working-note sweep (2026-10-28). NOT APPLIED. Branch scout-free-fallback only.
--
-- The bug (seen live Oct 28, thread aa1cff9e sat two days at "Working: waiting for the free AI to free up (0 steps)"):
-- admin-chat posted the note, then slept 30 s inside the invocation that was about to end, and only then called itself for the
-- next hop. The platform killed the invocation before the timer fired, so nothing ever ran again and the note stayed forever.
--
-- The fix is in two layers:
--   1. admin-chat (code): the next hop is fired at once with `not_before` in its body; the NEW invocation does the waiting
--      (_shared/hop-wait.ts). Nothing depends on a timer in a dying invocation any more.
--   2. This file: a sweep that catches ANY note starting "Working:" that has not changed for 3+ minutes (whatever killed it).
--        - the note is the last message in its thread and the run can be resumed -> re-kick the run ONCE (resume hop, service key);
--        - still frozen 4 minutes after that kick, or there is nothing to resume -> replace the note with a plain "Stopped ..."
--          message that says why, and raise a Scout-signed alert (bestly_raise, key prefix scout. -> Scout);
--        - a newer message exists in the thread (he wrote, or the run moved on) -> the note is an orphan, close it quietly.
--        - a PARKED run (run_state.resume_at set: every free provider was out, admin-chat posted ONE waiting note and fired no hop) is
--          left alone until resume_at, then resumed (fresh hop numbering, fresh wall clock); after a full day of waiting it is stopped.
--      The run's memory (run_state) is kept, so "keep going" resumes exactly where it stopped.
--      Parking makes this sweep the durable resumer: with the cron off, a parked run waits until someone says keep going.
--
-- Note: scout_run_rescue() from 20261010233000_scout_v43_search_and_run_rescue.sql did the same job but is NOT in the live database
-- any more (function, table and cron are all gone), which is why nothing caught this. This file does not depend on it and does
-- not recreate it.
--
--   1. scout_working_note_sweeps           bookkeeping: one row per note, kicks and give-ups
--   2. scout_stuck_note_text()             the plain stopped message
--   3. scout_working_note_sweep()          the sweep (p_rows / p_dry make it testable with made-up rows)
--   4. scout_working_note_sweep_selftest() watchdog: the sweep decides right and the alert path works; bestly_raise on failure
--   5. cron lines, commented: enable at rollout
--   UNDO at the bottom.

-- 1. bookkeeping ------------------------------------------------------------------------------------------------------------------
create table if not exists public.scout_working_note_sweeps (
  note_id     uuid primary key,
  thread_id   uuid not null,
  note_at     timestamptz not null,     -- the note's created_at when we last acted (the run moves it every time it edits the note)
  kicks       int not null default 0,
  kicked_at   timestamptz,
  gave_up_at  timestamptz,
  resolved_at timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.scout_working_note_sweeps enable row level security;
revoke all on public.scout_working_note_sweeps from public, anon, authenticated;

-- 2. the stopped message: plain words, says why, says how to continue, no ellipsis ----------------------------------------------------
create or replace function public.scout_stuck_note_text(p_steps int, p_waiting boolean, p_resting text[], p_kind text default 'frozen')
returns text
language sql
immutable
as $fn$
  select 'Stopped after ' || coalesce(p_steps, 0) || case when coalesce(p_steps, 0) = 1 then ' step' else ' steps' end || ': '
      || case when p_kind = 'parked_day'
              then 'every free AI provider stayed out of room for a full day, so I stopped waiting.'
              when p_waiting
              then 'the free AI had no room, I waited for it, and the next step never started, even after I restarted it once.'
              else 'the next step never started, even after I restarted it once.' end
      || case when coalesce(array_length(p_resting, 1), 0) > 0 then ' Resting right now: ' || array_to_string(p_resting, ', ') || '.' else '' end
      || ' Your request is saved. Say keep going and I pick it up here.';
$fn$;

-- 3. the sweep --------------------------------------------------------------------------------------------------------------------
-- p_rows: made-up candidate rows for the self-test (same keys as the real query below); p_dry: decide only, change nothing.
create or replace function public.scout_working_note_sweep(p_rows jsonb default null, p_dry boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $fn$
declare
  v_rows jsonb;
  x jsonb;
  v_acts jsonb := '[]'::jsonb;
  v_act text;
  v_id uuid; v_tid uuid; v_body text; v_title text; v_chain text; v_hop int;
  v_note_at timestamptz; v_swept timestamptz; v_kicked_at timestamptz; v_kicks int;
  v_later boolean; v_busy boolean; v_steps int; v_resting text[]; v_key text;
  v_resume_at timestamptz; v_parked_since timestamptz; v_kind text; v_cont int;
  v_kicked int := 0; v_closed int := 0; v_gave int := 0; v_errs text[] := '{}';
begin
  if p_rows is null then
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      select m.id as note_id, m.thread_id, m.body, m.created_at as note_at, t.title,
             coalesce(t.run_state ->> 'chain_from', '') as chain_from,
             coalesce(nullif(t.run_state ->> 'hop', '')::int, 0) as hop,
             t.run_state ->> 'resume_at' as resume_at, t.run_state ->> 'parked_since' as parked_since,
             (t.busy_until is not null and t.busy_until > p_now) as busy,
             exists (select 1 from public.admin_chat_messages u where u.thread_id = m.thread_id and u.created_at > m.created_at) as has_later,
             coalesce(s.kicks, 0) as kicks, s.kicked_at, s.note_at as swept_note_at
        from public.admin_chat_messages m
        join public.admin_chat_threads t on t.id = m.thread_id
        left join public.scout_working_note_sweeps s on s.note_id = m.id
       where m.role = 'assistant'
         and m.body like 'Working:%'
         and m.created_at < p_now - interval '3 minutes'
         and m.created_at > p_now - interval '7 days'
       order by m.created_at
       limit 50
    ) q;
  else
    v_rows := p_rows;
  end if;

  select coalesce(array_agg(name order by name), '{}') into v_resting
    from public.llm_providers where enabled and cooldown_until is not null and cooldown_until > p_now;

  for x in select value from jsonb_array_elements(v_rows) loop
    v_id := (x ->> 'note_id')::uuid;
    v_tid := (x ->> 'thread_id')::uuid;
    v_body := coalesce(x ->> 'body', '');
    v_title := coalesce(nullif(x ->> 'title', ''), 'A chat');
    v_chain := coalesce(x ->> 'chain_from', '');
    v_hop := coalesce(nullif(x ->> 'hop', '')::int, 0);
    v_note_at := (x ->> 'note_at')::timestamptz;
    v_swept := nullif(x ->> 'swept_note_at', '')::timestamptz;
    v_kicked_at := nullif(x ->> 'kicked_at', '')::timestamptz;
    v_kicks := coalesce(nullif(x ->> 'kicks', '')::int, 0);
    v_later := coalesce((x ->> 'has_later')::boolean, false);
    v_busy := coalesce((x ->> 'busy')::boolean, false);
    v_resume_at := nullif(x ->> 'resume_at', '')::timestamptz;
    v_parked_since := nullif(x ->> 'parked_since', '')::timestamptz;
    v_kind := 'frozen';
    v_steps := coalesce(substring(v_body from '\((\d+) steps?\)')::int, 0);

    if v_note_at > p_now - interval '3 minutes' then
      v_act := 'fresh';                                                    -- changed within 3 minutes: the run is alive
    elsif v_later then
      v_act := 'close_orphan';                                             -- something newer is in the thread: this note is a leftover
    elsif v_busy then
      v_act := 'wait';                                                     -- a request holds the thread right now
    elsif v_resume_at is not null and v_parked_since is not null and v_parked_since < p_now - interval '1 day' then
      v_act := 'give_up'; v_kind := 'parked_day';                          -- parked a full day: stop waiting, say so
    elsif v_resume_at is not null and v_resume_at > p_now then
      v_act := 'parked';                                                   -- every free provider is out; the run is waiting for resume_at on purpose
    elsif v_swept is not distinct from v_note_at and v_kicks >= 1 then
      v_act := case when v_kicked_at is not null and v_kicked_at > p_now - interval '4 minutes' then 'wait' else 'give_up' end;
    elsif v_chain = '' then
      v_act := 'give_up';                                                  -- nothing to resume from
    else
      v_act := 'kick';
    end if;

    v_acts := v_acts || jsonb_build_array(jsonb_build_object('note_id', v_id, 'action', v_act));
    if p_dry or v_act in ('fresh', 'wait', 'parked') then continue; end if;

    begin
      if v_act = 'kick' then
        v_cont := case when v_resume_at is not null then 1 else v_hop + 1 end;   -- a parked run restarts its hop numbering
        perform public.invoke_edge_function('admin-chat',
          jsonb_build_object('thread_id', v_tid, 'body', 'keep going', 'resume', true, 'auto_continue', v_cont, 'chain_from', v_chain), 2000);
        insert into public.scout_working_note_sweeps (note_id, thread_id, note_at, kicks, kicked_at, updated_at)
        values (v_id, v_tid, v_note_at, 1, p_now, now())
        on conflict (note_id) do update
          set note_at = excluded.note_at, kicks = 1, kicked_at = excluded.kicked_at, gave_up_at = null, resolved_at = null, updated_at = now();
        v_kicked := v_kicked + 1;

      elsif v_act = 'close_orphan' then
        update public.admin_chat_messages
           set body = 'Stopped after ' || v_steps || case when v_steps = 1 then ' step' else ' steps' end || ': a newer message came in, so this run was dropped.'
         where id = v_id and body like 'Working:%';
        v_closed := v_closed + 1;

      elsif v_act = 'give_up' then
        update public.admin_chat_messages
           set body = public.scout_stuck_note_text(v_steps, v_body ilike '%waiting for the free AI%', v_resting, v_kind)
         where id = v_id and body like 'Working:%';
        -- keep the run's memory so "keep going" resumes here, but drop the pointer to the note we just closed
        update public.admin_chat_threads
           set run_state = run_state - 'progress_msg_id'
         where id = v_tid and run_state is not null and run_state ->> 'progress_msg_id' = v_id::text;
        insert into public.scout_working_note_sweeps (note_id, thread_id, note_at, kicks, kicked_at, gave_up_at, updated_at)
        values (v_id, v_tid, v_note_at, v_kicks, v_kicked_at, p_now, now())
        on conflict (note_id) do update set gave_up_at = excluded.gave_up_at, resolved_at = null, updated_at = now();
        v_key := 'scout.working_note_stuck.' || left(v_tid::text, 8);
        perform public.bestly_raise(v_key, 'problem', 'warning', case when v_kind = 'parked_day' then 'Scout stopped waiting on a job' else 'Scout stopped a job that froze' end,
          'Scout here. "' || v_title || case when v_kind = 'parked_day' then '" waited after ' else '" froze after ' end || v_steps || case when v_steps = 1 then ' step' else ' steps' end
            || case when v_kind = 'parked_day'
                    then '. Every free provider stayed out of room for a full day, so I stopped waiting and kept your request. Say keep going in that chat and I pick it up.'
                    else '. I restarted it once and it did not move, so I closed the note and kept your request. Say keep going in that chat and I pick it up.' end
            || case when coalesce(array_length(v_resting, 1), 0) > 0 then ' Resting providers: ' || array_to_string(v_resting, ', ') || '.' else '' end,
          'ai', 'Say keep going in that chat', false);
        v_gave := v_gave + 1;
      end if;
    exception when others then
      v_errs := array_append(v_errs, v_act || ' ' || v_id::text || ': ' || sqlerrm);
    end;
  end loop;

  if not p_dry then
    -- close alerts for chats that carried on (he wrote after the stop) or after a day
    for x in
      select to_jsonb(s) as value from public.scout_working_note_sweeps s
       where s.gave_up_at is not null and s.resolved_at is null
         and (s.gave_up_at < p_now - interval '1 day'
              or exists (select 1 from public.admin_chat_messages u where u.thread_id = s.thread_id and u.role = 'user' and u.created_at > s.gave_up_at))
    loop
      begin
        perform public.bestly_raise('scout.working_note_stuck.' || left((x ->> 'thread_id'), 8), 'resolved', 'info', 'Scout picked a frozen job back up');
        update public.scout_working_note_sweeps set resolved_at = p_now where note_id = (x ->> 'note_id')::uuid;
      exception when others then
        v_errs := array_append(v_errs, 'resolve: ' || sqlerrm);
      end;
    end loop;

    if array_length(v_errs, 1) > 0 then
      perform public.bestly_raise('scout.working_note_sweep', 'problem', 'warning', 'Scout''s working-note sweep hit an error',
        'Scout here. The sweep that restarts frozen jobs failed: ' || array_to_string(v_errs, '; '), 'ai', null, false);
    else
      perform public.bestly_raise('scout.working_note_sweep', 'resolved', 'info', 'Scout''s working-note sweep runs clean');
    end if;
  end if;

  return jsonb_build_object('ok', coalesce(array_length(v_errs, 1), 0) = 0, 'dry', p_dry, 'kicked', v_kicked, 'closed', v_closed,
                            'gave_up', v_gave, 'errors', to_jsonb(v_errs), 'actions', v_acts);
end
$fn$;
revoke all on function public.scout_working_note_sweep(jsonb, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.scout_working_note_sweep(jsonb, boolean, timestamptz) to service_role;

-- 4. watchdog self-test -------------------------------------------------------------------------------------------------------------
-- Made-up rows through the sweep in dry mode (nothing changes), the stopped-message builder, and the alert path end to end.
-- On any failure it raises scout.working_note_sweep.selftest through bestly_raise (signed by Scout); on pass it resolves it.
create or replace function public.scout_working_note_sweep_selftest()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $fn$
declare
  v_fail text[] := '{}';
  v_now timestamptz := clock_timestamp();
  ia uuid := gen_random_uuid(); ib uuid := gen_random_uuid(); ic uuid := gen_random_uuid(); id_ uuid := gen_random_uuid();
  ie uuid := gen_random_uuid(); iff uuid := gen_random_uuid(); ig uuid := gen_random_uuid(); ih uuid := gen_random_uuid();
  ii uuid := gen_random_uuid(); ij uuid := gen_random_uuid(); ik uuid := gen_random_uuid();
  r jsonb; v_txt text;
  v_rows jsonb;
begin
  v_rows := jsonb_build_array(
    -- A: last message, stale 5 min, can resume, never kicked -> kick
    jsonb_build_object('note_id', ia, 'thread_id', gen_random_uuid(), 'body', 'Working: waiting for the free AI to free up (0 steps)', 'note_at', v_now - interval '5 minutes', 'chain_from', 'x', 'hop', 2),
    -- B: kicked 6 min ago and the note never moved -> give up
    jsonb_build_object('note_id', ib, 'thread_id', gen_random_uuid(), 'body', 'Working: checking the database (4 steps)', 'note_at', v_now - interval '10 minutes', 'swept_note_at', v_now - interval '10 minutes', 'kicks', 1, 'kicked_at', v_now - interval '6 minutes', 'chain_from', 'x'),
    -- C: kicked 1 min ago -> wait (the restarted run is still working)
    jsonb_build_object('note_id', ic, 'thread_id', gen_random_uuid(), 'body', 'Working: checking the database (4 steps)', 'note_at', v_now - interval '10 minutes', 'swept_note_at', v_now - interval '10 minutes', 'kicks', 1, 'kicked_at', v_now - interval '1 minute', 'chain_from', 'x'),
    -- D: a newer message exists -> close the orphan
    jsonb_build_object('note_id', id_, 'thread_id', gen_random_uuid(), 'body', 'Working: updating data (8 steps)', 'note_at', v_now - interval '20 minutes', 'has_later', true, 'chain_from', 'x'),
    -- E: nothing to resume from -> give up
    jsonb_build_object('note_id', ie, 'thread_id', gen_random_uuid(), 'body', 'Working: waiting for the free AI to free up (0 steps)', 'note_at', v_now - interval '5 minutes', 'chain_from', ''),
    -- F: kicked before, but the note has moved since (a new stall) -> kick again
    jsonb_build_object('note_id', iff, 'thread_id', gen_random_uuid(), 'body', 'Working: checking the database (9 steps)', 'note_at', v_now - interval '5 minutes', 'swept_note_at', v_now - interval '30 minutes', 'kicks', 1, 'kicked_at', v_now - interval '29 minutes', 'chain_from', 'x'),
    -- G: a request holds the thread -> wait
    jsonb_build_object('note_id', ig, 'thread_id', gen_random_uuid(), 'body', 'Working: checking the database (2 steps)', 'note_at', v_now - interval '5 minutes', 'busy', true, 'chain_from', 'x'),
    -- H: changed a minute ago -> fresh, leave alone
    jsonb_build_object('note_id', ih, 'thread_id', gen_random_uuid(), 'body', 'Working: checking the database (2 steps)', 'note_at', v_now - interval '1 minute', 'chain_from', 'x'),
    -- I: parked (every free provider out), resume_at still ahead -> leave it parked, however old the note is
    jsonb_build_object('note_id', ii, 'thread_id', gen_random_uuid(), 'body', 'Working: waiting for the free AI (0 steps).', 'note_at', v_now - interval '40 minutes', 'chain_from', 'x', 'resume_at', v_now + interval '3 minutes', 'parked_since', v_now - interval '2 hours'),
    -- J: parked and resume_at is due -> resume it
    jsonb_build_object('note_id', ij, 'thread_id', gen_random_uuid(), 'body', 'Working: waiting for the free AI (0 steps).', 'note_at', v_now - interval '40 minutes', 'chain_from', 'x', 'resume_at', v_now - interval '1 minute', 'parked_since', v_now - interval '2 hours'),
    -- K: parked for more than a day -> stop waiting
    jsonb_build_object('note_id', ik, 'thread_id', gen_random_uuid(), 'body', 'Working: waiting for the free AI (0 steps).', 'note_at', v_now - interval '40 minutes', 'chain_from', 'x', 'resume_at', v_now - interval '1 minute', 'parked_since', v_now - interval '25 hours')
  );
  begin
    r := public.scout_working_note_sweep(v_rows, true, v_now);
    if (select count(*) from jsonb_array_elements(r -> 'actions')) <> 11 then v_fail := array_append(v_fail, 'sweep did not return one decision per row'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ia) is distinct from 'kick' then v_fail := array_append(v_fail, 'a frozen paused run was not re-kicked'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ib) is distinct from 'give_up' then v_fail := array_append(v_fail, 'a run still frozen after its kick was not stopped'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ic) is distinct from 'wait' then v_fail := array_append(v_fail, 'a run kicked a minute ago was not given time'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = id_) is distinct from 'close_orphan' then v_fail := array_append(v_fail, 'a leftover note was not closed'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ie) is distinct from 'give_up' then v_fail := array_append(v_fail, 'a run with nothing to resume was not stopped'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = iff) is distinct from 'kick' then v_fail := array_append(v_fail, 'a new stall on a kicked note was not re-kicked'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ig) is distinct from 'wait' then v_fail := array_append(v_fail, 'a busy thread was touched'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ih) is distinct from 'fresh' then v_fail := array_append(v_fail, 'a live run was touched'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ii) is distinct from 'parked' then v_fail := array_append(v_fail, 'a parked run was woken or stopped early'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ij) is distinct from 'kick' then v_fail := array_append(v_fail, 'a parked run whose time came was not resumed'); end if;
    if (select a ->> 'action' from jsonb_array_elements(r -> 'actions') a where (a ->> 'note_id')::uuid = ik) is distinct from 'give_up' then v_fail := array_append(v_fail, 'a run parked for over a day was not stopped'); end if;
  exception when others then v_fail := array_append(v_fail, 'sweep crashed: ' || sqlerrm);
  end;

  v_txt := public.scout_stuck_note_text(3, true, array['cloudflare', 'groq']);
  if v_txt is null or v_txt like '%...%' or v_txt like '%…%' then v_fail := array_append(v_fail, 'stopped message has an ellipsis'); end if;
  if v_txt not like '%Say keep going%' or v_txt not like '%3 steps%' or v_txt not like '%no room%' or v_txt not like '%cloudflare, groq%' then v_fail := array_append(v_fail, 'stopped message is missing why / steps / how to continue'); end if;
  if public.scout_stuck_note_text(1, false, '{}') not like 'Stopped after 1 step:%' then v_fail := array_append(v_fail, 'one step is not singular'); end if;
  if public.scout_stuck_note_text(0, true, '{}', 'parked_day') not like '%full day%' or public.scout_stuck_note_text(0, true, '{}', 'parked_day') like '%restarted%' then v_fail := array_append(v_fail, 'the parked-for-a-day message is wrong'); end if;

  if to_regprocedure('public.invoke_edge_function(text,jsonb,integer)') is null then v_fail := array_append(v_fail, 'invoke_edge_function is missing, so the sweep cannot re-kick'); end if;

  begin
    perform public.bestly_raise('scout.working_note_sweep.selftest_probe', 'problem', 'info', 'Scout working-note sweep self-test', 'probe', 'ai', null, true);
    perform public.bestly_raise('scout.working_note_sweep.selftest_probe', 'resolved', 'info', 'Scout working-note sweep self-test probe closed');
  exception when others then v_fail := array_append(v_fail, 'bestly_raise failed: ' || sqlerrm);
  end;

  if array_length(v_fail, 1) > 0 then
    perform public.bestly_raise('scout.working_note_sweep.selftest', 'problem', 'warning', 'Scout''s working-note sweep self-test failed',
      array_to_string(v_fail, '; '), 'ai', null, false);
  else
    perform public.bestly_raise('scout.working_note_sweep.selftest', 'resolved', 'info', 'Scout''s working-note sweep self-test passes');
  end if;
  return jsonb_build_object('ok', coalesce(array_length(v_fail, 1), 0) = 0, 'failures', to_jsonb(v_fail));
end
$fn$;
revoke all on function public.scout_working_note_sweep_selftest() from public, anon, authenticated;
grant execute on function public.scout_working_note_sweep_selftest() to service_role;

-- 5. cron: ENABLE AT ROLLOUT (commented on purpose) -----------------------------------------------------------------------------------
-- select cron.schedule('scout-working-note-sweep', '*/2 * * * *', $$ select public.scout_working_note_sweep(); $$);
-- select cron.schedule('scout-working-note-sweep-selftest', '23 */6 * * *', $$ select public.scout_working_note_sweep_selftest(); $$);

-- UNDO -------------------------------------------------------------------------------------------------------------------------------
-- select cron.unschedule('scout-working-note-sweep'); select cron.unschedule('scout-working-note-sweep-selftest');
-- drop function if exists public.scout_working_note_sweep_selftest();
-- drop function if exists public.scout_working_note_sweep(jsonb, boolean, timestamptz);
-- drop function if exists public.scout_stuck_note_text(int, boolean, text[], text);
-- drop table if exists public.scout_working_note_sweeps;
-- (notes the sweep already closed keep their "Stopped ..." text; nothing else was changed. The code side needs no undo: a hop
--  without not_before simply starts at once.)
