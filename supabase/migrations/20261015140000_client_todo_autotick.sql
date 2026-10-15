-- Client to-dos for "pay this Mercury invoice" and "sign this contract" tick themselves off (Jared, 2026-10-15).
-- Pi job tools/todo-autotick (stdlib Python, no AI, hourly) lists the open to-dos that carry a Mercury invoice id or a
-- LibreSign uuid in client_todos.source, checks Mercury (GET only) / the public LibreSign sign page, and calls the done RPC.
--
-- 1. client_todo_autotick_open()  : open to-dos with source.mercury_invoice_id or source.libresign_uuid.
-- 2. client_todo_autotick_done()  : marks one done (done_by = 'auto'), only if still open, the source kind matches and the
--                                   evidence agrees with it (invoice: status Paid; contract: signed true). Idempotent.
--    Both are service_role only (the Pi calls them with the service key, same as pi_secret / scout_notify), so they are NOT
--    on security_public_rpcs: anon must never be able to tick a client's to-do.
-- 3. pi_jobs heartbeat 'todo-autotick' (enabled = false until the install has had one good run), hourly, max_gap_min 180.
-- 4. Team card "Tally".
--
-- No new table holds emails or phones, so no privacy_data_map rows.
--
-- UNDO: drop function public.client_todo_autotick_open(); drop function public.client_todo_autotick_done(uuid, jsonb);
--       delete from public.pi_jobs where job = 'todo-autotick'; update public.bestly_agents set status = 'retired' where slug = 'tally';
--       delete from public.notification_owners where prefix = 'todo-autotick';

create or replace function public.client_todo_autotick_open()
returns table (todo_id uuid, client_slug text, kind text, mercury_invoice_id text, libresign_uuid text)
language sql
security definer
set search_path = public
as $$
  select t.id, c.slug, t.source->>'kind',
         nullif(t.source->>'mercury_invoice_id', ''), nullif(t.source->>'libresign_uuid', '')
    from public.client_todos t
    join public.approval_clients c on c.id = t.client_id
   where t.status = 'open'
     and t.source is not null
     and ((t.source->>'kind' = 'invoice'  and coalesce(t.source->>'mercury_invoice_id', '') <> '')
       or (t.source->>'kind' = 'contract' and coalesce(t.source->>'libresign_uuid', '') <> ''))
   order by t.created_at;
$$;

create or replace function public.client_todo_autotick_done(p_todo uuid, p_evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  ev jsonb := coalesce(p_evidence, '{}'::jsonb);
  n int;
begin
  select id, status, source into t from public.client_todos where id = p_todo for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no such to-do'); end if;
  if t.status = 'done' then return jsonb_build_object('ok', true, 'changed', false, 'reason', 'already done'); end if;
  if t.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'not open (' || t.status || ')'); end if;

  if t.source->>'kind' = 'invoice' then
    if ev->>'kind' is distinct from 'invoice'
       or ev->>'mercury_invoice_id' is distinct from t.source->>'mercury_invoice_id'
       or lower(coalesce(ev->>'status', '')) <> 'paid' then
      return jsonb_build_object('ok', false, 'reason', 'evidence does not show this invoice paid');
    end if;
  elsif t.source->>'kind' = 'contract' then
    if ev->>'kind' is distinct from 'contract'
       or ev->>'libresign_uuid' is distinct from t.source->>'libresign_uuid'
       or coalesce(ev->>'signed', '') <> 'true' then
      return jsonb_build_object('ok', false, 'reason', 'evidence does not show this contract signed');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'source kind is not invoice or contract');
  end if;

  update public.client_todos
     set status = 'done', done_at = now(), done_by = 'auto',
         source = t.source || jsonb_build_object('autotick', ev || jsonb_build_object('at', now()))
   where id = p_todo and status = 'open';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'changed', n = 1);
end;
$$;

revoke all on function public.client_todo_autotick_open() from public, anon, authenticated;
revoke all on function public.client_todo_autotick_done(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.client_todo_autotick_open() to service_role;
grant execute on function public.client_todo_autotick_done(uuid, jsonb) to service_role;

insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('todo-autotick',
        'Tally: hourly. Ticks off client to-dos for paying a Mercury invoice (status Paid) or signing a LibreSign contract (all signers signed). Read-only on Mercury and LibreSign; writes only client_todos through client_todo_autotick_done. Pi worker tools/todo-autotick.',
        180, false)
on conflict (job) do update set description = excluded.description,
                                max_gap_min = excluded.max_gap_min;

select public.team_onboard($j$[
 {"slug":"tally","name":"Tally","role":"Ticks off client to-dos when an invoice is paid or a contract is signed","reports_to":"scout","runs_on":"pi","icon":"check-circle",
  "schedule":"Every hour",
  "what_it_does":"Every hour it looks at the open client to-dos that point at a Mercury invoice or a LibreSign contract. If Mercury says the invoice is Paid, or every signer has signed the contract, it ticks the to-do off for the client. It only reads Mercury and LibreSign, it never ticks anything on a guess, and if either one cannot be reached it leaves the to-do open and says so.",
  "pulse":{"src":"pi_job","key":"todo-autotick","gap":180,"alert":true},
  "owns":["todo-autotick"]}
]$j$::jsonb);
