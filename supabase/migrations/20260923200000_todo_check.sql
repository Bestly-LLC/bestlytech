-- "Check if it's done" for to-dos (scout_daily kind pick / call). Plan: docs/todo-check-opusplan.md
--
--   todo-check edge fn gathers evidence (todo_evidence below, Deck, GitHub) and asks a model to judge.
--   Nightly at 10 PM LA it checks every open to-do and closes the ones it is sure about
--   (todo_check_settings: threshold, 2+ kinds of evidence, never a to-do Jared already corrected).
--   Every result has Put back and a thumbs down. A thumbs down or a put-back:
--     reopens the to-do, raises the auto-close bar, marks the lessons that misled it as losses,
--     and asks todo-check to write a new lesson (scout_lessons scope 'todo-check') that the next
--     check reads. Too many misreads in 30 days pauses auto-close and tells Jared.
--   todo_check_watchdog (hourly) re-runs a missed nightly pass, retries lessons that failed to write,
--   and raises a Scout alert when checks keep erroring.

create table if not exists public.todo_check_settings (
  id int primary key default 1 check (id = 1),
  auto_close boolean not null default true,
  threshold real not null default 0.9,
  min_sources int not null default 2,
  note text,
  updated_at timestamptz not null default now()
);
insert into public.todo_check_settings (id) values (1) on conflict do nothing;
alter table public.todo_check_settings enable row level security;
drop policy if exists "Admins read todo check settings" on public.todo_check_settings;
create policy "Admins read todo check settings" on public.todo_check_settings for select to authenticated using (has_role(auth.uid(), 'admin'));

create table if not exists public.todo_checks (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.scout_daily(id) on delete cascade,
  trigger text not null default 'button' check (trigger in ('button', 'sweep', 'nightly')),
  verdict text check (verdict in ('done', 'partly', 'not_done', 'unknown')),
  confidence real,
  summary text,
  remaining text,
  next_step text,
  evidence jsonb not null default '[]',
  searched jsonb not null default '{}',
  lessons_used uuid[] not null default '{}',
  model text,
  auto_closed boolean not null default false,
  feedback text check (feedback in ('up', 'down', 'undo')),
  feedback_note text,
  feedback_at timestamptz,
  learned boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists todo_checks_todo on public.todo_checks (todo_id, created_at desc);
create index if not exists todo_checks_recent on public.todo_checks (created_at desc);
alter table public.todo_checks enable row level security;
drop policy if exists "Admins read todo checks" on public.todo_checks;
create policy "Admins read todo checks" on public.todo_checks for select to authenticated using (has_role(auth.uid(), 'admin'));

-- Full-text indexes for the evidence search (small tables today; keeps it fast as mail grows).
create index if not exists bestly_mail_fts on public.bestly_mail
  using gin (to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' || coalesce(body_text, '')));
create index if not exists bestly_memory_fts on public.bestly_memory
  using gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')));

-- How many of the terms a document matches (so one common word can't carry a hit).
create or replace function public._term_hits(p_doc tsvector, p_terms text[]) returns int
language sql immutable as $$
  select count(*)::int from unnest(p_terms) t where p_doc @@ plainto_tsquery('english', t);
$$;

-- Everything in the database that could prove a to-do happened. Terms come from todo-check,
-- already reduced to plain words. Vault: names and dates only, never a secret's value.
create or replace function public.todo_evidence(p_terms text[], p_since timestamptz, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
declare
  q tsquery;
  need int := case when coalesce(array_length(p_terms, 1), 0) >= 3 then 2 else 1 end;
  hl text := 'MaxFragments=2, MaxWords=28, MinWords=8, StartSel=«, StopSel=»';
  out jsonb := '{}';
begin
  if coalesce(array_length(p_terms, 1), 0) = 0 then return out; end if;
  select to_tsquery('english', string_agg(quote_literal(t) || ':*', ' | ')) into q
    from (select regexp_replace(lower(t), '[^a-z0-9]', '', 'g') t from unnest(p_terms) t) s where t <> '';
  if q is null then return out; end if;

  out := out || jsonb_build_object('mail', coalesce((
    select jsonb_agg(x) from (
      select 'mail:' || m.id as id, m.mailbox, m.from_name, m.from_addr, m.subject, m.sent_at,
             ts_headline('english', left(coalesce(m.body_text, ''), 20000), q, hl) as quote
        from bestly_mail m,
             lateral (select to_tsvector('english', coalesce(m.subject, '') || ' ' || coalesce(m.from_name, '') || ' ' || coalesce(m.body_text, '')) v) d
       where m.sent_at >= p_since and d.v @@ q and _term_hits(d.v, p_terms) >= need
       order by _term_hits(d.v, p_terms) desc, ts_rank_cd(d.v, q) desc, m.sent_at desc limit 6) x), '[]'));

  out := out || jsonb_build_object('memory', coalesce((
    select jsonb_agg(x) from (
      select 'memory:' || b.id as id, b.area || '/' || b.key as key, b.title, b.updated_at,
             ts_headline('english', coalesce(b.body, ''), q, hl) as quote
        from bestly_memory b,
             lateral (select to_tsvector('english', coalesce(b.title, '') || ' ' || coalesce(b.body, '')) v) d
       where b.active and b.updated_at >= p_since and d.v @@ q and _term_hits(d.v, p_terms) >= need
       order by _term_hits(d.v, p_terms) desc, ts_rank_cd(d.v, q) desc limit 5) x), '[]'));

  out := out || jsonb_build_object('meetings', coalesce((
    select jsonb_agg(x) from (
      select 'meeting:' || r.id as id, r.name, r.started_at,
             ts_headline('english', left(coalesce(r.transcript, ''), 60000), q, hl) as quote
        from meeting_recordings r,
             lateral (select to_tsvector('english', left(coalesce(r.transcript, ''), 60000)) v) d
       where r.started_at > p_since + interval '1 hour' and d.v @@ q and _term_hits(d.v, p_terms) >= need
       order by r.started_at desc limit 3) x), '[]'));

  out := out || jsonb_build_object('vault', coalesce((
    select jsonb_agg(x) from (
      select 'vault:' || s.name as id, s.name, s.description, s.created_at, s.updated_at
        from vault.secrets s
       where s.updated_at >= p_since
         and exists (select 1 from unnest(p_terms) t where length(t) >= 4
                      and (s.name ilike '%' || t || '%' or coalesce(s.description, '') ilike '%' || t || '%'))
       order by s.updated_at desc limit 5) x), '[]'));

  out := out || jsonb_build_object('scout_actions', coalesce((
    select jsonb_agg(x) from (
      select 'action:' || a.id as id, a.tool, a.ok, a.created_at, left(a.args::text, 300) as args, left(coalesce(a.result::text, ''), 300) as result
        from admin_chat_actions a,
             lateral (select to_tsvector('english', a.tool || ' ' || a.args::text || ' ' || coalesce(a.result::text, '')) v) d
       where a.created_at >= p_since and d.v @@ q and _term_hits(d.v, p_terms) >= need
       order by a.created_at desc limit 5) x), '[]'));

  out := out || jsonb_build_object('mac_jobs', coalesce((
    select jsonb_agg(x) from (
      select 'job:' || j.id as id, j.title, j.status, j.exit_code, j.finished_at, left(coalesce(j.output, ''), 300) as output
        from mac_jobs j,
             lateral (select to_tsvector('english', j.title || ' ' || coalesce(j.why, '')) v) d
       where j.created_at >= p_since and d.v @@ q and _term_hits(d.v, p_terms) >= need
       order by j.created_at desc limit 4) x), '[]'));

  out := out || jsonb_build_object('related_todos', coalesce((
    select jsonb_agg(x) from (
      select 'todo:' || t.id as id, t.kind, t.title, t.status, t.done_at
        from scout_daily t,
             lateral (select to_tsvector('english', t.title || ' ' || coalesce(t.why, '')) v) d
       where t.id is distinct from p_exclude and t.created_at >= p_since - interval '7 days'
         and t.kind in ('pick', 'call', 'draft') and t.status in ('done', 'handed')
         and d.v @@ q and _term_hits(d.v, p_terms) >= need
       order by t.done_at desc nulls last limit 5) x), '[]'));

  return out;
end $$;
revoke all on function public.todo_evidence(text[], timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.todo_evidence(text[], timestamptz, uuid) to service_role;

-- The one Vault secret todo-check reads (GitHub commit search). Service role only.
create or replace function public.todo_check_github_token() returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'github_token' limit 1;
$$;
revoke all on function public.todo_check_github_token() from public, anon, authenticated;
grant execute on function public.todo_check_github_token() to service_role;

-- Thumbs up / thumbs down / put back. Reopens a to-do Scout closed, tunes the bar, queues a lesson.
create or replace function public.todo_check_feedback(p_check uuid, p_kind text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.todo_checks;
  t public.scout_daily;
  reopened boolean := false;
begin
  if auth.role() <> 'service_role' and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_kind not in ('up', 'down', 'undo') then raise exception 'kind must be up, down or undo'; end if;
  update todo_checks set feedback = p_kind, feedback_note = nullif(left(trim(coalesce(p_note, '')), 500), ''), feedback_at = now(),
         learned = case when p_kind = 'up' then learned else false end
   where id = p_check returning * into c;
  if c.id is null then raise exception 'no such check'; end if;
  select * into t from scout_daily where id = c.todo_id;

  if p_kind in ('down', 'undo') then
    -- put it back if Scout (or a tap on its verdict) closed it
    if t.status = 'done' and (c.auto_closed or (t.action->'auto_closed'->>'check_id') = c.id::text or p_kind = 'undo') then
      update scout_daily set status = 'open', done_at = null, action = action - 'auto_closed' where id = t.id;
      reopened := true;
    end if;
    -- a wrong auto-close raises the bar right away
    if c.auto_closed then
      update todo_check_settings set threshold = least(0.98, threshold + 0.02), updated_at = now(),
             note = 'raised after a put-back on ' || to_char(now() at time zone 'America/Los_Angeles', 'Mon DD HH12:MI AM') where id = 1;
    end if;
    update scout_lessons set losses = losses + 1, updated_at = now() where id = any(c.lessons_used);
    perform invoke_edge_function('todo-check', jsonb_build_object('op', 'learn', 'check_id', c.id), 60000);
  else
    update scout_lessons set wins = wins + 1, updated_at = now() where id = any(c.lessons_used);
  end if;

  update scout_daily set action = jsonb_set(action, '{check,feedback}', to_jsonb(p_kind))
   where id = c.todo_id and (action->'check'->>'id') = c.id::text;
  perform todo_check_tune();
  return jsonb_build_object('ok', true, 'reopened', reopened);
end $$;
revoke all on function public.todo_check_feedback(uuid, text, text) from public, anon;
grant execute on function public.todo_check_feedback(uuid, text, text) to authenticated, service_role;

-- Keeps auto-close honest: 30 days of put-backs decide the bar, and too many pause it.
create or replace function public.todo_check_tune() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; b int; s public.todo_check_settings;
begin
  select count(*) filter (where auto_closed), count(*) filter (where auto_closed and feedback in ('down', 'undo'))
    into a, b from todo_checks where created_at > now() - interval '30 days';
  select * into s from todo_check_settings where id = 1;
  if a >= 5 and b::real / a > 0.3 and s.auto_close then
    update todo_check_settings set auto_close = false, updated_at = now(),
           note = format('paused: %s of %s auto-closes were put back in 30 days', b, a) where id = 1;
    perform scout_notify('Scout stopped closing to-dos on its own',
      format('%s of the last %s it closed were wrong. It still checks when you tap. Turn it back on in the to-do menu.', b, a),
      'warning', true, '/admin', 'todo-check.paused.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'));
  elsif a >= 5 and b::real / a > 0.1 then
    update todo_check_settings set threshold = least(0.98, greatest(threshold, 0.93)), updated_at = now() where id = 1;
  elsif a >= 20 and b = 0 then
    update todo_check_settings set threshold = greatest(0.85, threshold - 0.01), updated_at = now() where id = 1;
  end if;
  return jsonb_build_object('auto_closed_30d', a, 'put_back_30d', b);
end $$;
revoke all on function public.todo_check_tune() from public, anon, authenticated;
grant execute on function public.todo_check_tune() to service_role;

-- Admin toggle for auto-close (the to-do menu).
create or replace function public.todo_check_set_auto(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update todo_check_settings set auto_close = p_on, updated_at = now(),
         note = case when p_on then 'turned on by Jared' else 'turned off by Jared' end where id = 1;
  return (select to_jsonb(s) from todo_check_settings s where id = 1);
end $$;
revoke all on function public.todo_check_set_auto(boolean) from public, anon;
grant execute on function public.todo_check_set_auto(boolean) to authenticated;

-- Watchdog: heal first, alert only if healing didn't work.
create or replace function public.todo_check_watchdog() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  la_now timestamp := now() at time zone 'America/Los_Angeles';
  last_night timestamptz;
  errs int; stuck int; healed text[] := '{}';
begin
  select max(ran_at) into last_night from scout_daily_runs where job = 'todo-check';
  -- the nightly pass runs at 10 PM LA; after 11 PM with no run today, run it now
  if extract(hour from la_now) >= 23 and (last_night is null or (last_night at time zone 'America/Los_Angeles')::date < la_now::date) then
    perform invoke_edge_function('todo-check', '{"op":"nightly","force":true}'::jsonb, 150000);
    healed := healed || 'reran nightly pass';
  end if;
  if last_night is not null and last_night < now() - interval '50 hours' then
    perform scout_notify('To-do checker has not run in 2 days',
      'The nightly check of your to-dos keeps missing. Scout already tried to rerun it. Open Monitor.',
      'warning', true, '/admin/monitor', 'todo-check.missed.' || to_char(la_now, 'YYYY-MM-DD'));
  end if;

  -- lessons that failed to write after a thumbs down
  select count(*) into stuck from todo_checks where feedback in ('down', 'undo') and not learned and feedback_at < now() - interval '10 minutes' and feedback_at > now() - interval '3 days';
  if stuck > 0 then
    perform invoke_edge_function('todo-check', '{"op":"learn_backlog"}'::jsonb, 120000);
    healed := healed || format('retried %s lessons', stuck);
  end if;

  select count(*) into errs from todo_checks where created_at > now() - interval '24 hours' and error is not null;
  if errs >= 5 then
    perform scout_notify('To-do checker is erroring',
      format('%s checks failed in the last day. Latest: %s', errs,
        (select left(error, 200) from todo_checks where error is not null order by created_at desc limit 1)),
      'warning', false, '/admin', 'todo-check.errors.' || to_char(la_now, 'YYYY-MM-DD'));
  end if;
  return jsonb_build_object('ok', true, 'healed', healed, 'errors_24h', errs, 'last_nightly', last_night);
end $$;
revoke all on function public.todo_check_watchdog() from public, anon, authenticated;

insert into public.ai_caps (fn, per_day, per_who_hour, note)
values ('todo-check', 300, 60, 'Check if a to-do is done: button, sweep and the nightly pass')
on conflict (fn) do nothing;

select cron.unschedule(jobid) from cron.job where jobname in ('todo-check-tick', 'todo-check-watchdog');
select cron.schedule('todo-check-tick', '35 * * * *', $$select public.invoke_edge_function('todo-check', '{"op":"tick"}'::jsonb, 150000)$$);
select cron.schedule('todo-check-watchdog', '50 * * * *', $$select public.todo_check_watchdog()$$);
