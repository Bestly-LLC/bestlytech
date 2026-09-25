-- admin_git() promised a synchronous GitHub commit and never delivered one. It enqueued
-- the request through pg_net (admin_git_call) and then polled for the answer inside the
-- SAME transaction. pg_net's worker only sees a queued request once that transaction
-- commits, so the loop always spun for its full timeout, returned
-- "timed out waiting for bestly-git", and the commit landed the instant the function
-- exited. Two sessions in a row (2026-09-24 and 2026-09-25) read that as a failure and
-- had to go and check admin_site_changes to learn the commit was fine — the response row
-- was stamped exactly p_timeout_s after the request, every time.
--
-- Nothing can wait for pg_net inside one statement, so stop pretending. Enqueue, hand back
-- the request id at once, and let the caller poll admin_git_poll() from a separate
-- statement — which is what admin-chat (Scout) already does.

create or replace function public.admin_git(p_body jsonb, p_timeout_s integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_req bigint;
begin
  -- p_timeout_s is kept only so existing callers and the generated types still match.
  v_req := public.admin_git_call(p_body);
  return jsonb_build_object(
    'ok', null,
    'pending', true,
    'request_id', v_req,
    'action', coalesce(p_body->>'action', 'whoami'),
    'next', format(
      'pg_net sends this only after the current transaction commits, so it cannot be awaited here. '
      || 'From a NEW statement run: select public.admin_git_poll(%s) — null while GitHub is still answering, then {ok, status, body}.',
      v_req));
end $$;

comment on function public.admin_git(jsonb, integer) is
  'Enqueue a bestly-git call and return its pg_net request id. It cannot wait for the answer (pg_net only sends after commit); poll admin_git_poll(request_id) from a separate statement.';
