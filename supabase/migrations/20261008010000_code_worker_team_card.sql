-- Code Worker goes live on the Mac mini (launchd tech.bestly.code-worker, 2026-10-07). House rule: every bot gets a team card.
-- Its 30 s heartbeat also checks in through agent_beat so the Team page sees it.

create or replace function public.code_worker_beat_t(p_token text, p_info jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_paid boolean;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  update code_worker_status set beat_at = now(), info = p_info where id;
  begin
    perform agent_beat('code-worker', true, case when p_info->>'busy' is not null then 'working on a code job' else 'idle' end, p_token);
  exception when others then null;  -- the Team page check-in must never break the worker's heartbeat
  end;
  select coalesce(paid_ai_ok, false) into v_paid from scout_settings where id;
  return jsonb_build_object('paid_ai_ok', coalesce(v_paid, false));
end $$;

select public.team_onboard($j$[
 {"slug":"code-worker","name":"Code Worker","role":"Writes and ships code for Scout","tool_of":"scout","runs_on":"mac-mini","icon":"code","schedule":"always on",
  "what_it_does":"When Scout gets a coding job (change a page, fix a bug, build a new site), this does it on the Mac mini: gets a fresh copy, has free AI write the code, checks the build passes, saves it to GitHub and puts it live. Free AI gets 3 tries; paid AI only takes over when the Paid AI switch is on or you tap yes. A failed live build is undone automatically.",
  "pulse":{"src":"beat","gap":300},
  "owns":["code."]}
]$j$::jsonb);
