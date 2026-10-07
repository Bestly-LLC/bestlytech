-- 2026-10-07 Scout chief of staff, step 6: Pi jobs, Scout Health watch, team cards (docs/scout-chief-of-staff-opusplan.md).

insert into public.pi_jobs (job, description, max_gap_min, enabled) values
 ('freellm_keys', 'FreeLLM Keys: every minute, adds keys queued on the Scout AI page to FreeLLM, deletes the Vault copy, reports per-provider key counts.', 5, true),
 ('model_prober', 'Model Prober: daily 4:17 AM, sends each free model one tool-calling test and records which ones Scout may trust.', 1560, true)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, enabled = true;

-- Scout Health: every 10 minutes. Problems are signed by Scout and held for the 7 PM recap unless they are one of the 4 kinds that interrupt.
create or replace function public.scout_health_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; rt int; bt timestamptz; out jsonb := '{}'::jsonb;
begin
  -- 1. a chat answer that took more than 30 tool calls in 15 minutes
  select count(*) into n from (select thread_id from admin_chat_actions where created_at > now() - interval '15 minutes' group by thread_id having count(*) > 30) x;
  perform bestly_raise('scout.health.runaway', case when n > 0 then 'problem' else 'resolved' end, 'warning',
    case when n > 0 then 'Scout: a chat used more than 30 tool calls in 15 minutes' else 'Scout: chat tool use is back to normal' end,
    'Scout checks the answer budget every 10 minutes. A chat that runs this long usually means a model is looping; it is benched after its strike and the next model takes over.', 'ai', null, true);
  out := out || jsonb_build_object('runaway', n);
  -- 2. a reply that leaked tool syntax or filler
  select count(*) into n from admin_chat_messages where role = 'assistant' and created_at > now() - interval '15 minutes'
     and body ~* '(<invoke|function_call>|NEEDS_TOOLS|no action needed)';
  perform bestly_raise('scout.health.leak', case when n > 0 then 'problem' else 'resolved' end, 'warning',
    case when n > 0 then 'Scout: a reply leaked tool syntax' else 'Scout: replies are clean' end,
    'A chat reply contained raw tool syntax or filler text. The output scrub should have stopped it; the model behind it is struck in the Models Scout trusts list.', 'ai', null, true);
  out := out || jsonb_build_object('leaks', n);
  -- 3. fewer than 2 trusted free routes
  select count(*) into rt from llm_model_health where ok_tool_calls and (benched_until is null or benched_until < now());
  perform bestly_raise('scout.health.routes', case when rt < 2 and exists (select 1 from llm_model_health) then 'problem' else 'resolved' end, 'warning',
    case when rt < 2 then 'Scout: fewer than 2 trusted free models are healthy' else 'Scout: free models are healthy' end,
    'Add another free AI key on the Scout AI page, or wait for benched models to come back.', 'ai', 'An extra free AI key on the Scout AI page helps', true);
  out := out || jsonb_build_object('healthy_routes', rt);
  -- 4. the Code Worker stopped reporting (only once it has ever reported)
  select beat_at into bt from code_worker_status where id;
  if bt is not null then
    perform bestly_raise('code.worker.down', case when bt < now() - interval '10 minutes' then 'problem' else 'resolved' end, 'warning',
      case when bt < now() - interval '10 minutes' then 'Code Worker has not checked in for 10 minutes' else 'Code Worker is checking in' end,
      'The Code Worker on the Mac mini does Scout''s coding jobs. Restart it with: launchctl kickstart -k gui/$(id -u)/tech.bestly.code-worker', 'ai', null, false);
    out := out || jsonb_build_object('worker_beat', bt);
  end if;
  return out;
end $$;
revoke all on function public.scout_health_watch() from public, anon, authenticated;
grant execute on function public.scout_health_watch() to service_role;

select cron.schedule('scout-health-watch', '*/10 * * * *', $c$select public.scout_health_watch()$c$);

select public.team_onboard($j$[
 {"slug":"model-prober","name":"Model Prober","role":"Tests the free AI models","tool_of":"scout","runs_on":"pi","icon":"flask-conical","schedule":"daily 4:17 AM",
  "what_it_does":"Sends every free AI model one tool-calling test each morning and records which ones really work, so Scout only talks to models that can do the job and benches the rest.",
  "pulse":{"src":"pi_job","key":"model_prober","gap":1560},
  "owns":["freellm.model","scout.health"]},
 {"slug":"freellm-keys","name":"Free AI Keys","role":"Adds the free AI keys you paste","tool_of":"scout","runs_on":"pi","icon":"key-round","schedule":"every minute",
  "what_it_does":"When you paste a free AI key on the Scout AI page, this adds it to the free AI router within a minute, deletes the saved copy, and keeps the per-provider key counts on that page up to date. More keys means Scout stays fast when one runs out.",
  "pulse":{"src":"pi_job","key":"freellm_keys","gap":5},
  "owns":["freellm.keys"]}
]$j$::jsonb);
