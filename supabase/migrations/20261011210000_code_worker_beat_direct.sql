-- Code Worker showed "sick: haven't checked in since 5:25 PM Oct 10" while it ran fine (429 beats a day).
-- Cause: code_worker_beat_t called agent_beat(..., p_token) with the db-watchdog token, but agent_beat only accepts
-- an admin or the Home Hub agent key. The call raised, the surrounding `exception when others then null` hid it, and
-- agent_beats never updated. Fix: the caller is already authenticated by db_watchdog_ok above, so write the check-in
-- row directly (same upsert agent_beat does; its triggers still log and graduate).
create or replace function public.code_worker_beat_t(p_token text, p_info jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_paid boolean;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  update code_worker_status set beat_at = now(), info = p_info where id;
  begin
    insert into agent_beats (slug, at, ok, summary)
    values ('code-worker', now(), true, case when p_info->>'busy' is not null then 'working on a code job' else 'idle' end)
    on conflict (slug) do update set at = now(), ok = excluded.ok, summary = excluded.summary;
  exception when others then null;  -- the Team page check-in must never break the worker's heartbeat
  end;
  select coalesce(paid_ai_ok, false) into v_paid from scout_settings where id;
  return jsonb_build_object('paid_ai_ok', coalesce(v_paid, false));
end $$;
