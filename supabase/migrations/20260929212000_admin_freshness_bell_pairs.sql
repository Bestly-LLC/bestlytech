-- Admin freshness (2026-09-29), part 3: bell notes clear when their problem is reported fixed, and repeats collapse.
create or replace function public.admin_freshness_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  n int;
  s jsonb := '{}'::jsonb;
begin
  -- Picks belong to their day. Yesterday's stay until today's morning picks exist; older ones always go.
  -- (Scout's morning run still sees unfinished work as candidates and re-picks it fresh.)
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'pick' and status in ('open', 'snoozed')
     and (day < v_today - 1
          or (day < v_today and exists (select 1 from scout_daily t where t.kind = 'pick' and t.day = v_today)));
  get diagnostics n = row_count; s := s || jsonb_build_object('picks', n);

  -- The wrap is only today's.
  update scout_daily set status = 'done', done_at = now()
   where kind = 'wrap' and status = 'open' and day < v_today;
  get diagnostics n = row_count; s := s || jsonb_build_object('wraps', n);

  -- Email reply drafts: 3 days after the mail they answer; a newer draft for the same subject replaces an older one.
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'draft' and status = 'open' and day < v_today - 3;
  get diagnostics n = row_count; s := s || jsonb_build_object('drafts_old', n);
  update scout_daily d set status = 'expired', done_at = now()
   where d.kind = 'draft' and d.status = 'open'
     and exists (select 1 from scout_daily e where e.kind = 'draft' and e.status = 'open' and e.id <> d.id
                   and lower(e.title) = lower(d.title) and (e.created_at, e.id) > (d.created_at, d.id));
  get diagnostics n = row_count; s := s || jsonb_build_object('drafts_dup', n);

  -- Meeting to-dos are real work: only near-identical duplicates (same owner, within 3 days) collapse to the newest,
  -- and to-dos untouched for 21 days age out.
  update scout_daily d set status = 'expired', done_at = now(),
         action = coalesce(d.action, '{}'::jsonb) || jsonb_build_object('expired_why', 'duplicate', 'dup_of', e.id)
    from scout_daily e
   where d.kind = 'call' and e.kind = 'call' and d.status = 'open' and e.status = 'open' and d.id <> e.id
     and lower(coalesce(d.action->>'owner', 'jared')) = lower(coalesce(e.action->>'owner', 'jared'))
     and abs(d.day - e.day) <= 3
     and (e.created_at, e.id) > (d.created_at, d.id)
     and extensions.similarity(lower(d.title), lower(e.title)) >= 0.6;
  get diagnostics n = row_count; s := s || jsonb_build_object('calls_dup', n);
  update scout_daily set status = 'expired', done_at = now()
   where kind = 'call' and status = 'open' and day < v_today - 21;
  get diagnostics n = row_count; s := s || jsonb_build_object('calls_old', n);

  -- Bell: FYIs clear themselves. Silent after 1 h, success/info after 12 h, warnings after 3 days, anything after 7 days.
  -- (A problem card is also cleared the moment its issue resolves - bestly_raise already does that for monitor cards.)
  update admin_notifications set read_at = now()
   where read_at is null
     and ((silent and created_at < now() - interval '1 hour')
          or (severity in ('success', 'info') and created_at < now() - interval '12 hours')
          or (severity = 'warning' and created_at < now() - interval '3 days')
          or created_at < now() - interval '7 days');
  get diagnostics n = row_count; s := s || jsonb_build_object('bell_read', n);

  -- A problem note clears when a later "working again / is back / fixed" note about the same thing arrives.
  update admin_notifications p set read_at = now()
   where p.read_at is null and p.severity <> 'success'
     and p.title !~* '(working again|is back|is fine|healthy|resolved|reaching|fixed|normally again|steady)'
     and exists (select 1 from admin_notifications r
                  where r.created_at > p.created_at and r.created_at < p.created_at + interval '3 days'
                    and (r.severity = 'success' or r.title ~* '(working again|is back|is fine|healthy|resolved|reaching|fixed|normally again|steady)')
                    and extensions.similarity(lower(p.title), lower(r.title)) >= 0.45);
  get diagnostics n = row_count; s := s || jsonb_build_object('bell_fixed', n);
  -- Repeats of the same note collapse to the newest one.
  update admin_notifications p set read_at = now()
   where p.read_at is null
     and exists (select 1 from admin_notifications r
                  where r.read_at is null and r.id <> p.id and r.kind = p.kind and lower(r.title) = lower(p.title)
                    and (r.created_at, r.id) > (p.created_at, p.id));
  get diagnostics n = row_count; s := s || jsonb_build_object('bell_repeat', n);

  insert into admin_freshness_runs (stats) values (s);
  delete from admin_freshness_runs where at < now() - interval '14 days';
  return s;
end $$;
revoke all on function public.admin_freshness_sweep() from public, anon, authenticated;
