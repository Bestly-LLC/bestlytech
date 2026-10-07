-- Code Worker reports back into the chat thread that asked (one message per finished job).
create or replace function public.code_job_finish_t(p_token text, p_id uuid, p_status text, p_result jsonb default null, p_log text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j code_jobs; msg text; r jsonb := coalesce(p_result, '{}'::jsonb);
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if p_status not in ('done','failed','needs_yes') then raise exception 'bad status'; end if;
  update code_jobs set status = p_status, result = p_result, log_tail = coalesce(right(p_log, 6000), log_tail),
         finished_at = now(), note = null where id = p_id returning * into j;
  if j.thread_id is null or j.reported_at is not null then return; end if;
  if p_status = 'done' then
    msg := 'Done. ' || coalesce(r->>'summary', 'The change is built and shipped.')
        || case when r->>'live_url' is not null then E'\nLive: ' || (r->>'live_url') else '' end
        || case when r->>'commit_sha' is not null then E'\nCommit: ' || left(r->>'commit_sha', 7) else '' end;
  elsif p_status = 'needs_yes' then
    msg := 'Free AI could not get this to build in 3 tries: ' || coalesce(r->>'reason', 'the build kept failing') || '. Paid AI costs about 5 to 50 cents; yes turns the Paid AI switch on for one hour.'
        || E'\n\nOPTIONS: Use paid AI for this one | Drop it';
  else
    msg := 'The code job stopped: ' || coalesce(r->>'reason', 'it failed') || '. Nothing was shipped.';
  end if;
  insert into admin_chat_messages (thread_id, role, body) values (j.thread_id, 'assistant', msg);
  update admin_chat_threads set updated_at = now() where id = j.thread_id;
  update code_jobs set reported_at = now() where id = p_id;
end $$;
revoke all on function public.code_job_finish_t(text,uuid,text,jsonb,text) from public;
grant execute on function public.code_job_finish_t(text,uuid,text,jsonb,text) to anon, authenticated, service_role;

-- Jared tapped "Use paid AI for this one": put the waiting job back in the queue with paid allowed.
create or replace function public.code_job_requeue_paid(p_thread uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  update code_jobs set status = 'queued', paid_ok = true, reported_at = null, attempts = 0
   where thread_id = p_thread and status = 'needs_yes';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.code_job_requeue_paid(uuid) from public, anon, authenticated;
grant execute on function public.code_job_requeue_paid(uuid) to service_role;
