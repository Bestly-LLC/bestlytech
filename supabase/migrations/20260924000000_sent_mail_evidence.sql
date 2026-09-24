-- Jared's Sent mail, for the to-do checker only ("did I email X?"). Kept apart from bestly_mail on
-- purpose: a dozen things read bestly_mail (cleanup rules, reply drafts, Today, gap checks) and none
-- of them expect his own sent messages. Filled by ~/.bestly/sent_sync.py on the Mac mini every 10 min
-- through bestly_sent_upsert() (the mail bridge's proxy key). 60 days kept. sent_mail_watchdog alerts
-- when the sync stops.

create table if not exists public.bestly_sent_mail (
  id uuid primary key default gen_random_uuid(),
  mailbox text not null,
  message_id text not null,
  to_addrs text,
  subject text,
  sent_at timestamptz,
  body_text text,
  created_at timestamptz not null default now(),
  unique (mailbox, message_id)
);
create index if not exists bestly_sent_mail_at on public.bestly_sent_mail (sent_at desc);
create index if not exists bestly_sent_mail_fts on public.bestly_sent_mail
  using gin (to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(to_addrs, '') || ' ' || coalesce(body_text, '')));
alter table public.bestly_sent_mail enable row level security;
drop policy if exists "Admins read sent mail" on public.bestly_sent_mail;
create policy "Admins read sent mail" on public.bestly_sent_mail for select to authenticated using (has_role(auth.uid(), 'admin'));

create table if not exists public.bestly_sent_state (
  mailbox text primary key,
  last_uid bigint not null default 0,
  uid_validity bigint,
  last_run timestamptz,
  last_error text
);
alter table public.bestly_sent_state enable row level security;

-- The Mac calls these with the publishable key + the bridge's proxy key (checked here).
create or replace function public.bestly_sent_state_get(p_key text, p_mailbox text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not bestly_mail_key_ok(p_key) then raise exception 'bad key'; end if;
  return coalesce((select to_jsonb(s) from bestly_sent_state s where mailbox = p_mailbox), jsonb_build_object('mailbox', p_mailbox, 'last_uid', 0));
end $$;

create or replace function public.bestly_sent_upsert(p_key text, p_mailbox text, p_rows jsonb, p_last_uid bigint, p_uid_validity bigint, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not bestly_mail_key_ok(p_key) then raise exception 'bad key'; end if;
  if jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0 then
    with ins as (
      insert into bestly_sent_mail (mailbox, message_id, to_addrs, subject, sent_at, body_text)
      select p_mailbox, left(r->>'message_id', 500), left(r->>'to', 2000), left(r->>'subject', 500),
             nullif(r->>'sent_at', '')::timestamptz, left(r->>'body', 20000)
        from jsonb_array_elements(p_rows) r
       where coalesce(r->>'message_id', '') <> ''
      on conflict (mailbox, message_id) do nothing
      returning 1)
    select count(*) into n from ins;
  end if;
  insert into bestly_sent_state (mailbox, last_uid, uid_validity, last_run, last_error)
  values (p_mailbox, coalesce(p_last_uid, 0), p_uid_validity, now(), p_error)
  on conflict (mailbox) do update set
    last_uid = greatest(case when bestly_sent_state.uid_validity is distinct from excluded.uid_validity then 0 else bestly_sent_state.last_uid end, excluded.last_uid),
    uid_validity = excluded.uid_validity, last_run = now(), last_error = excluded.last_error;
  return jsonb_build_object('ok', true, 'inserted', n);
end $$;
revoke all on function public.bestly_sent_state_get(text, text) from public;
revoke all on function public.bestly_sent_upsert(text, text, jsonb, bigint, bigint, text) from public;
grant execute on function public.bestly_sent_state_get(text, text) to anon, authenticated, service_role;
grant execute on function public.bestly_sent_upsert(text, text, jsonb, bigint, bigint, text) to anon, authenticated, service_role;

-- Watchdog: the sync reports every 10 min; quiet for 2 hours = tell Scout (launchd restarts it on its own).
create or replace function public.sent_mail_watchdog() returns jsonb
language plpgsql security definer set search_path = public as $$
declare last timestamptz; errs text;
begin
  select max(last_run), string_agg(mailbox || ': ' || last_error, '; ') filter (where last_error is not null)
    into last, errs from bestly_sent_state;
  if last is not null and last < now() - interval '2 hours' then
    perform scout_notify('Sent-mail sync stopped',
      'The Mac mini has not synced your Sent mail since ' || to_char(last at time zone 'America/Los_Angeles', 'Mon DD HH12:MI AM') ||
      '. The to-do checker can''t see emails you sent until it runs. Usually: the Mac is asleep or the mail password changed.',
      'warning', false, '/admin', 'sent-mail.stale.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'));
  elsif errs is not null then
    perform scout_notify('Sent-mail sync has an error', left(errs, 400), 'info', false, '/admin',
      'sent-mail.err.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'));
  end if;
  delete from bestly_sent_mail where sent_at < now() - interval '60 days';
  return jsonb_build_object('last_run', last, 'errors', errs);
end $$;
revoke all on function public.sent_mail_watchdog() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'sent-mail-watchdog';
select cron.schedule('sent-mail-watchdog', '25 * * * *', $c$select public.sent_mail_watchdog()$c$);

-- to-do evidence: add what Jared sent (all Sent mail + the partner copies)
create or replace function public.todo_evidence_sent(p_terms text[], p_since timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q tsquery; need int := case when coalesce(array_length(p_terms, 1), 0) >= 3 then 2 else 1 end;
  hl text := 'MaxFragments=2, MaxWords=28, MinWords=8, StartSel=«, StopSel=»';
begin
  if coalesce(array_length(p_terms, 1), 0) = 0 then return '[]'; end if;
  select to_tsquery('english', string_agg(quote_literal(t) || ':*', ' | ')) into q
    from (select regexp_replace(lower(t), '[^a-z0-9]', '', 'g') t from unnest(p_terms) t) s where t <> '';
  if q is null then return '[]'; end if;
  return coalesce((select jsonb_agg(x) from (
    select * from (
      select 'sent:' || m.id as id, m.mailbox, m.to_addrs, m.subject, m.sent_at,
             ts_headline('english', left(coalesce(m.body_text, ''), 20000), q, hl) as quote,
             _term_hits(d.v, p_terms) as hits
        from bestly_sent_mail m,
             lateral (select to_tsvector('english', coalesce(m.subject, '') || ' ' || coalesce(m.to_addrs, '') || ' ' || coalesce(m.body_text, '')) v) d
       where m.sent_at >= p_since and d.v @@ q
      union all
      select 'psent:' || p.id, p.account, array_to_string(p.to_addrs, ', '), p.subject, p.sent_at,
             ts_headline('english', left(coalesce(p.body_text, ''), 20000), q, hl),
             _term_hits(d.v, p_terms)
        from partner_mail p,
             lateral (select to_tsvector('english', coalesce(p.subject, '') || ' ' || array_to_string(p.to_addrs, ' ') || ' ' || coalesce(p.body_text, '')) v) d
       where p.sent_at >= p_since and d.v @@ q
    ) u where hits >= need
    order by hits desc, sent_at desc limit 6) x), '[]');
end $$;
revoke all on function public.todo_evidence_sent(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.todo_evidence_sent(text[], timestamptz) to service_role;
