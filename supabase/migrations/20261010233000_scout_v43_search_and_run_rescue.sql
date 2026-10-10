-- Scout v43 (2026-10-10 audit): search_code + the run watchdog.
--
-- 1. admin_git_call allows bestly-git's new read-only 'search' action (file names + GitHub code search), so Scout
--    finds a file in one call instead of read_file guesses (the Oct 10 Live Activity thread: 48 messages, never found).
-- 2. scout_run_rescue(): a free run's hop chain sometimes dies mid-job (edge time limit), leaving "Working: …" frozen
--    until Jared types Keep going (8 times Oct 7-10). Every 2 min this re-fires the next hop for a run that has been
--    silent 4+ min, if he hasn't written since. Twice per run at most; then it closes the note honestly and Scout tells him.

create or replace function public.admin_git_call(p_body jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  v_key text; v_action text := coalesce(p_body->>'action','whoami');
  v_repo text := coalesce(p_body->>'repo','Bestly-LLC/hoku-clean');
  v_req bigint; v_paths text[];
begin
  if auth.uid() is not null then
    perform public.admin_require_admin();
  end if;

  if v_action not in ('whoami','list','get','put','delete','commit','search') then
    raise exception 'admin_git_call: unsupported action %', v_action;
  end if;
  if v_repo not in ('Bestly-LLC/hoku-clean','Bestly-LLC/bestlytech') then
    raise exception 'admin_git_call: repo not allowed %', v_repo;
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then raise exception 'admin_git_call: service_role_key missing from vault'; end if;

  select net.http_post(
    url := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/bestly-git',
    body := p_body,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
    timeout_milliseconds := 25000
  ) into v_req;

  if v_action in ('put','delete','commit') then
    if v_action = 'commit' then
      select array_agg(f->>'path') into v_paths from jsonb_array_elements(coalesce(p_body->'files','[]'::jsonb)) f;
    else
      v_paths := array[coalesce(p_body->>'path','?')];
    end if;
    insert into public.admin_site_changes (repo, action, paths, message, request_id)
    values (v_repo, v_action, coalesce(v_paths,'{}'), p_body->>'message', v_req);
  end if;

  return v_req;
end;
$function$;

-- Rescue counts live here, not in run_state: admin-chat rewrites run_state every hop.
create table if not exists public.scout_run_rescues (
  thread_id uuid not null,
  chain_from text not null,
  rescues int not null default 0,
  gave_up_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (thread_id, chain_from)
);
alter table public.scout_run_rescues enable row level security;

create or replace function public.scout_run_rescue()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  r record; v_key text; v_n int := 0; v_gave int := 0; v_count int;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null then return jsonb_build_object('ok', false, 'error', 'service_role_key missing'); end if;

  for r in
    select t.id, t.title, t.run_state, m.id as note_id, m.created_at as note_at
    from public.admin_chat_threads t
    join public.admin_chat_messages m on m.id = nullif(t.run_state->>'progress_msg_id','')::uuid
    where t.run_state is not null
      and coalesce(t.run_state->>'chain_from','') <> ''
      and m.body like 'Working:%'
      and m.created_at < now() - interval '4 minutes'
      and m.created_at > now() - interval '30 minutes'
      and (t.busy_until is null or t.busy_until < now())
      and not exists (select 1 from public.admin_chat_messages u where u.thread_id = t.id and u.created_at > m.created_at)
  loop
    insert into public.scout_run_rescues (thread_id, chain_from) values (r.id, r.run_state->>'chain_from')
    on conflict (thread_id, chain_from) do update set rescues = scout_run_rescues.rescues + 1, updated_at = now()
    returning rescues into v_count;

    if v_count >= 2 then
      -- Twice already: stop pretending it is working. Close the note, keep the memory for his Keep going, tell him (signed by Scout).
      update public.admin_chat_messages
         set body = 'Stopped after ' || coalesce(r.run_state->>'steps','some') || ' steps: the run kept dropping on my side. Say keep going and I pick it up exactly here.'
       where id = r.note_id;
      update public.admin_chat_threads set run_state = run_state - 'progress_msg_id' where id = r.id;
      update public.scout_run_rescues set gave_up_at = now() where thread_id = r.id and chain_from = r.run_state->>'chain_from';
      perform public.scout_notify(
        'Scout: a job stopped mid-way', 'Scout here. "' || left(coalesce(r.title,'A chat'), 60) || '" kept dropping on my side, twice. It is saved; say keep going in that chat.',
        'warning', false, '/admin', 'scout.run_rescue.' || r.id::text);
      v_gave := v_gave + 1;
      continue;
    end if;

    perform net.http_post(
      url := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/admin-chat',
      body := jsonb_build_object('thread_id', r.id, 'body', 'keep going', 'resume', true,
                                 'auto_continue', coalesce((r.run_state->>'hop')::int, 0) + 1,
                                 'chain_from', r.run_state->>'chain_from'),
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      timeout_milliseconds := 2000);
    v_n := v_n + 1;
  end loop;

  delete from public.scout_run_rescues where updated_at < now() - interval '2 days';
  return jsonb_build_object('ok', true, 'rescued', v_n, 'gave_up', v_gave);
end;
$function$;

revoke all on function public.scout_run_rescue() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('scout-run-rescue') where exists (select 1 from cron.job where jobname = 'scout-run-rescue');
end $$;
select cron.schedule('scout-run-rescue', '*/2 * * * *', $c$select public.scout_run_rescue()$c$);

select public.team_onboard($j$[
 {"slug":"run-rescue","name":"Run Rescue","role":"Restarts Scout jobs that stall","tool_of":"scout","runs_on":"cloud","icon":"life-buoy","schedule":"every 2 min",
  "what_it_does":"When Scout is working on something for you and the job silently stops (the note freezes on Working…), this picks it back up from the same spot within a few minutes, so you don't have to type Keep going. If it drops twice, it tells you and leaves it saved.",
  "pulse":{"src":"cron","job":"scout-run-rescue","gap":6},
  "owns":["scout.run_rescue"]}
]$j$::jsonb);
