-- Stuck card + Waiting card for the Command Center home (Jared, 2026-10-27).
--
-- NOT APPLIED. Written on branch stuck-card; production rollout waits for Jared's explicit go.
--
-- What it adds
--   outside_claims            claims that live outside Bestly (first row: the Kemper check), admin-only
--   stuck_undo                one row per Command Center fix, valid 24 hours
--   stuck_seen / stuck_state  episode tracking for pushes, plus a heartbeat for the watchdog
--   admin_stuck_items()       what the card shows: stuck items (with their blocks), waiting items, recent fixes
--   admin_stuck_fix()         Jared's tap: fix one block or all of them, writes an undo row and a claim_events row
--   admin_stuck_undo()        puts it back (24 hours)
--   outside_claims_check()    daily: reply from the insurer? mark replied. Reply overdue? queue the Ava errand (needs his tap)
--   stuck_sweep(), stuck_push()   tracks episodes, pushes once per item after 1 hour, signed by the responsible employee
--   stuck_feed_selftest()     watchdog: raises stuck.feed (owned by Claims Closer), heals what it can
--
-- Hard rules kept
--   Nothing here emails anyone. Releasing a hold, completing a trip and syncing happen only from admin_stuck_fix(),
--   which is Jared's tap; no cron job ever calls it.
--   The cron schedules are at the bottom, commented out. Enable at rollout.

-- ───────────────────────── tables ─────────────────────────

create table if not exists public.outside_claims (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  insurer text not null,
  adjuster_org text,
  claim_no text,
  insured_name text,
  check_amount numeric(12,2),
  check_note text,
  shortfall_amount numeric(12,2),
  emails_sent integer not null default 1,
  last_sent_at timestamptz,
  last_sent_from text,
  last_sent_to text,
  last_sent_cc text,
  reply_due_at timestamptz,
  reply_domain text not null,
  if_no_reply text,
  escalation_name text,
  escalation_role text,
  escalation_phone text,
  escalation_ext text,
  owner_slug text not null default 'claims-closer',
  status text not null default 'waiting' check (status in ('waiting','replied','escalated','closed')),
  replied_at timestamptz,
  reply_mail_id uuid,
  escalated_at timestamptz,
  errand_id uuid references public.ava_errands(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.outside_claims enable row level security;
revoke all on public.outside_claims from anon, authenticated;
grant select on public.outside_claims to authenticated;
drop policy if exists outside_claims_admin_read on public.outside_claims;
create policy outside_claims_admin_read on public.outside_claims for select to authenticated using (public.team_is_admin());

create table if not exists public.stuck_undo (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  employee_slug text,
  employee_name text,
  label text not null,
  subtitle text,
  action text not null,
  snapshot jsonb not null default '{}'::jsonb,
  by_user uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  undone_at timestamptz
);
create index if not exists stuck_undo_item_idx on public.stuck_undo (item_id, created_at desc);
alter table public.stuck_undo enable row level security;
revoke all on public.stuck_undo from anon, authenticated;

create table if not exists public.stuck_seen (
  item_id text primary key,
  kind text not null default 'stuck',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  pushed_at timestamptz,
  push_count integer not null default 0
);
alter table public.stuck_seen enable row level security;
revoke all on public.stuck_seen from anon, authenticated;

create table if not exists public.stuck_state (
  id boolean primary key default true check (id),
  swept_at timestamptz,
  checked_at timestamptz,
  last_error text,
  push_agents boolean not null default false,   -- push for generic "agent not OK" items too (off: ~20 Pi jobs are not-OK today)
  created_at timestamptz not null default now()
);
insert into public.stuck_state (id) values (true) on conflict do nothing;
alter table public.stuck_state enable row level security;
revoke all on public.stuck_state from anon, authenticated;

-- Alerts keyed stuck.* are Claims Closer's (signed by her in the bell and on the phone).
insert into public.notification_owners (prefix, agent_slug, note)
values ('stuck', 'claims-closer', 'Stuck card feed on the Command Center home (2026-10-27)')
on conflict (prefix) do nothing;

-- The first outside claim: the Kemper check.
insert into public.outside_claims (
  slug, title, insurer, adjuster_org, claim_no, insured_name,
  check_amount, check_note, shortfall_amount, emails_sent,
  last_sent_at, last_sent_from, last_sent_to, last_sent_cc,
  reply_due_at, reply_domain, if_no_reply,
  escalation_name, escalation_role, escalation_phone, escalation_ext, owner_slug, notes)
values (
  'kemper-26123598964', 'Kemper check', 'Infinity Insurance', 'Kemper', '26123598964', 'Noe Lazo Lazo',
  1647.81, 'Check mailed to Tesla, not received', 946.39, 3,
  ('2026-10-27 14:06:00'::timestamp at time zone 'America/Los_Angeles'), 'jaredbest@icloud.com', 'skennedy@kemper.com', 'jhuitron@kemper.com',
  ('2026-10-31 23:59:59'::timestamp at time zone 'America/Los_Angeles'), 'kemper.com', 'Ava calls their supervisor',
  'Terrell Frasier', 'Supervisor', '800-353-6737', '1512117', 'claims-closer',
  'Infinity Insurance | Kemper. $1,647.81 check was mailed to Tesla and not received; $946.39 shortfall on top. Escalation: supervisor Terrell Frasier, 800-353-6737 ext. 1512117, by Ava errand call.')
on conflict (slug) do nothing;

-- ───────────────────────── small formatters (Pacific, 12-hour, no-break spaces) ─────────────────────────

create or replace function public.stuck_clock(p_ts timestamptz) returns text
language sql stable set search_path = public as $$
  select case when p_ts is null then '' else replace(to_char(p_ts at time zone 'America/Los_Angeles', 'FMHH12:MI AM'), ' ', E' ') end
$$;

-- "Today, 2:06 PM" / "Yesterday, 9:25 AM" / "Mon, Oct 26, 9:25 AM"
create or replace function public.stuck_when(p_ts timestamptz) returns text
language sql stable set search_path = public as $$
  select case
    when p_ts is null then ''
    when (p_ts at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date then 'Today, '
    when (p_ts at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date - 1 then 'Yesterday, '
    else to_char(p_ts at time zone 'America/Los_Angeles', 'FMDy, Mon FMDD') || ', ' end
  || public.stuck_clock(p_ts)
$$;

-- "Fri, Oct 31"
create or replace function public.stuck_day(p_ts timestamptz) returns text
language sql stable set search_path = public as $$
  select case when p_ts is null then '' else to_char(p_ts at time zone 'America/Los_Angeles', 'FMDy, Mon FMDD') end
$$;

-- "45 min", "3 hrs", "2 days" since p_from (number and unit joined by a no-break space)
create or replace function public.stuck_span(p_from timestamptz) returns text
language sql stable set search_path = public as $$
  select case when m < 60 then m || E' min'
              when m < 48 * 60 then (m / 60) || E' ' || case when m / 60 = 1 then 'hr' else 'hrs' end
              else (m / 1440) || E' days' end
    from (select greatest(0, floor(extract(epoch from (now() - p_from)) / 60))::int as m) x
$$;

-- First line of a message, shortened at a word boundary. Never an ellipsis.
create or replace function public.stuck_short(p_text text, p_max integer default 140) returns text
language sql immutable set search_path = public as $$
  select case when length(l) <= p_max then l else regexp_replace(left(l, p_max), '\s+\S*$', '') end
    from (select btrim(split_part(coalesce(p_text, ''), E'\n', 1)) as l) x
$$;

create or replace function public.stuck_ordinal(p_n integer) returns text
language sql immutable set search_path = public as $$
  select case p_n when 1 then 'First' when 2 then 'Second' when 3 then 'Third' when 4 then 'Fourth' when 5 then 'Fifth'
                  when 6 then 'Sixth' when 7 then 'Seventh' when 8 then 'Eighth' when 9 then 'Ninth' when 10 then 'Tenth'
                  else p_n || 'th' end
$$;

create or replace function public.stuck_money(p_n numeric) returns text
language sql immutable set search_path = public as $$
  select case when p_n is null then null else '$' || to_char(p_n, 'FM999,999,990.00') end
$$;

-- ───────────────────────── the feed ─────────────────────────

-- Internal: every stuck and waiting item right now. No auth check (cron uses it); not granted to the browser.
-- Block shape: {id, label, detail, fix_action, fix_label}. fix_action null means "nothing to tap".
create or replace function public.stuck_items_core() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  nb constant text := E' ';
  v_cc text := coalesce((select name from bestly_agents where slug = 'claims-closer'), 'Claims Closer');
  items jsonb := '[]'::jsonb;
  r record; a record; blocks jsonb; since timestamptz; te timestamptz; hc timestamptz;
  v_link boolean; gt jsonb; guest text; undo_sync timestamptz; fixable integer; v_work boolean := false;
  v_who text; v_money text; v_reason text;
begin
  -- 1. open claims
  for r in select * from claim_cases c where c.status not in ('paid', 'closed') and not coalesce(c.history, false) order by c.opened_at loop
    blocks := '[]'::jsonb; since := null; v_link := null; hc := null;
    guest := coalesce(nullif(btrim(r.guest_first), ''), 'the guest');
    te := greatest((select t.ends_at from turo_trips t where t.reservation_id = r.reservation_id), r.trip_end);
    select g.host_completed_at, true into hc, v_link from lax_guest_links g where g.reservation_id = r.reservation_id;
    v_link := coalesce(v_link, false);
    gt := claims_gate(r.id);

    -- trip ended, Jared has not tapped Complete, and no compliant first message has gone out since
    if te is not null and te <= now() and hc is null and not coalesce((gt->>'first_done')::boolean, false) then
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'trip_complete', 'label', 'Trip not marked complete',
        'detail', 'I can''t contact ' || guest || ' until it is.',
        'fix_action', case when v_link then 'trip_complete' end, 'fix_label', case when v_link then 'Complete' end));
      since := least(since, te);
    end if;

    -- the watchdog paused outgoing messages (Jared's tap only, never automatic)
    if coalesce(r.outbound_hold, false) then
      v_reason := nullif(btrim(coalesce(r.outbound_hold_reason, '')), '');
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'hold', 'label', 'Paused by the watchdog',
        'detail', coalesce(upper(left(v_reason, 1)) || substr(v_reason, 2), 'The watchdog stopped outgoing messages')
                  || case when r.outbound_hold_at is not null
                          then ', ' || to_char(r.outbound_hold_at at time zone 'America/Los_Angeles', 'FMMon FMDD') || ' at ' || stuck_clock(r.outbound_hold_at) else '' end || '.',
        'fix_action', 'hold', 'fix_label', 'Release'));
      since := least(since, coalesce(r.outbound_hold_at, r.updated_at));
    end if;

    -- never synced with Turo
    if r.synced_at is null and r.opened_at < now() - interval '15 minutes' then
      select max(u.created_at) into undo_sync from stuck_undo u
       where u.item_id = 'claim:' || r.id and u.undone_at is null and u.created_at > now() - interval '60 minutes'
         and u.snapshot->'steps' @> '[{"block":"sync"}]'::jsonb;
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'sync', 'label', 'Not synced with Turo',
        'detail', case when undo_sync is not null then 'Asked for a sync at ' || stuck_clock(undo_sync) || '. Waiting on Turo.'
                       else 'I can''t see Turo''s status or deadlines.' end,
        'fix_action', 'sync', 'fix_label', case when undo_sync is not null then 'Sync again' else 'Sync' end));
      since := least(since, r.opened_at);
    end if;

    -- work waiting 15+ minutes and the worker has not picked it up (same test claims_tick uses)
    if r.needs_work and r.updated_at < now() - interval '15 minutes' and coalesce(r.last_run_at, 'epoch'::timestamptz) < now() - interval '15 minutes' then
      blocks := blocks || jsonb_build_array(jsonb_build_object('id', 'work', 'label', 'Waiting to be worked',
        'detail', 'This has been waiting ' || stuck_span(greatest(r.updated_at, coalesce(r.last_run_at, r.updated_at))) || ' and I haven''t started.',
        'fix_action', 'wake', 'fix_label', 'Wake it'));
      since := least(since, greatest(r.updated_at, coalesce(r.last_run_at, r.updated_at)));
      v_work := true;
    end if;

    if jsonb_array_length(blocks) > 0 then
      select count(*) into fixable from jsonb_array_elements(blocks) b where b->>'fix_action' is not null;
      items := items || jsonb_build_array(jsonb_build_object(
        'kind', 'stuck', 'item_id', 'claim:' || r.id, 'employee_slug', 'claims-closer', 'employee_name', v_cc,
        'title', case when nullif(btrim(r.guest_first), '') is null then 'A claim' else btrim(r.guest_first) || '''s claim' end,
        'subtitle', concat_ws(' · ', 'Reservation ' || r.reservation_id, nullif(btrim(coalesce(r.car, '')), ''),
                              case when r.turo_claim_no is not null then 'Turo claim ' || r.turo_claim_no end),
        'stuck_since', since, 'blocks', blocks,
        'footer', case when fixable > 0 then 'You can undo for 24' || nb || 'hrs. — ' || v_cc else 'Still needs a look. — ' || v_cc end));
    end if;
  end loop;

  -- 2. employees whose last check-in said "not OK" for 15+ minutes (no tap to fix: the monitors own those)
  for a in
    select ag.slug, ag.name, ag.role, b.at, b.summary, coalesce(s.first_seen_at, b.at) as first_bad
      from bestly_agents ag
      join agent_beats b on b.slug = ag.slug
      left join stuck_seen s on s.item_id = 'agent:' || ag.slug
     where ag.kind = 'agent' and ag.status in ('active', 'new') and b.ok = false
       and coalesce(s.first_seen_at, b.at) < now() - interval '15 minutes'
       and b.at > now() - interval '3 days'
     order by coalesce(s.first_seen_at, b.at)
  loop
    continue when a.slug = 'claims-closer' and v_work;   -- already shown on the claim itself
    items := items || jsonb_build_array(jsonb_build_object(
      'kind', 'stuck', 'item_id', 'agent:' || a.slug, 'employee_slug', a.slug, 'employee_name', a.name,
      'title', a.name, 'subtitle', a.role, 'stuck_since', a.first_bad,
      'blocks', jsonb_build_array(jsonb_build_object('id', 'beat', 'label', 'Last check-in was not OK',
        'detail', coalesce(nullif(stuck_short(a.summary, 140), ''), 'No reason given.'), 'fix_action', null, 'fix_label', null)),
      'footer', 'Still not reporting OK. — ' || a.name));
  end loop;

  -- 3. waiting on someone outside Bestly
  for r in select * from outside_claims o where o.status in ('waiting', 'escalated') order by o.reply_due_at nulls last loop
    v_who := coalesce((select name from bestly_agents where slug = r.owner_slug), 'Claims Closer');
    select string_agg(x, ' + ') into v_money from unnest(array[stuck_money(r.check_amount), stuck_money(r.shortfall_amount)]) as t(x) where x is not null;
    items := items || jsonb_build_array(jsonb_build_object(
      'kind', 'waiting', 'item_id', 'outside:' || r.id, 'employee_slug', r.owner_slug, 'employee_name', v_who,
      'title', r.title, 'subtitle', case when v_money is not null then v_money || ' owed' else r.insurer end,
      'stuck_since', r.last_sent_at,
      'link', case when r.status = 'escalated' then '/admin/pipeline' end,
      'link_label', case when r.status = 'escalated' then 'Open errands' end,
      'blocks', jsonb_build_array(
        jsonb_build_object('id', 'sent', 'label', stuck_ordinal(r.emails_sent) || ' email sent', 'detail', stuck_when(r.last_sent_at), 'fix_action', null, 'fix_label', null),
        jsonb_build_object('id', 'due', 'label', 'Reply due',
          'detail', case when r.status = 'escalated' then 'Passed ' || stuck_day(r.reply_due_at) else stuck_day(r.reply_due_at) end, 'fix_action', null, 'fix_label', null),
        jsonb_build_object('id', 'next', 'label', case when r.status = 'escalated' then 'Supervisor call' else 'If no reply' end,
          'detail', case when r.status = 'escalated' then 'Queued for Ava. Tap Call now.' else coalesce(r.if_no_reply, 'Nothing set up yet') end,
          'fix_action', null, 'fix_label', null)),
      'footer', case when r.status = 'escalated' then 'One tap places the call. — ' || v_who else 'Nothing for you to do. — ' || v_who end));
  end loop;

  return coalesce((select jsonb_agg(x order by ord) from (
      select x, row_number() over (order by (x->>'kind') = 'waiting', (x->>'stuck_since')::timestamptz nulls last) as ord
        from jsonb_array_elements(items) x) s), '[]'::jsonb);
end $$;

-- The card's feed: items, each with its undo when a fix is still undoable, plus recent fixes whose item is no longer stuck.
create or replace function public.admin_stuck_items() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; fixed jsonb;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  v := stuck_items_core();
  select coalesce(jsonb_agg(
           case when u.id is not null
                then x.item || jsonb_build_object('undo', jsonb_build_object('id', u.id, 'label', u.label, 'until', u.expires_at, 'at', u.created_at))
                else x.item end order by x.ord), '[]'::jsonb)
    into v
    from jsonb_array_elements(v) with ordinality as x(item, ord)
    left join lateral (select uu.* from stuck_undo uu
                        where uu.item_id = x.item->>'item_id' and uu.undone_at is null and uu.expires_at > now()
                        order by uu.created_at desc limit 1) u on true;
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'fixed', 'item_id', f.item_id, 'employee_slug', f.employee_slug, 'employee_name', f.employee_name,
           'title', f.label, 'subtitle', f.subtitle, 'stuck_since', f.created_at, 'blocks', '[]'::jsonb,
           'footer', 'You can undo for 24' || E' ' || 'hrs. — ' || coalesce(f.employee_name, 'Claims Closer'),
           'undo', jsonb_build_object('id', f.id, 'label', f.label, 'until', f.expires_at, 'at', f.created_at)) order by f.created_at desc), '[]'::jsonb)
    into fixed
    from (select distinct on (uu.item_id) uu.* from stuck_undo uu
           where uu.undone_at is null and uu.expires_at > now()
           order by uu.item_id, uu.created_at desc) f
   where not exists (select 1 from jsonb_array_elements(v) y where y->>'item_id' = f.item_id);
  return v || fixed;
end $$;

-- ───────────────────────── Jared's tap: fix, and undo ─────────────────────────

-- p_action: a block id ('trip_complete' | 'hold' | 'sync' | 'wake'... see fix_action) or 'all'.
-- Only claim items are fixable; every fix is one undo row (24 hours) plus one claim_events row.
create or replace function public.admin_stuck_fix(p_item_id text, p_action text default 'all') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r claim_cases; v_case uuid; present text[]; want text[]; steps jsonb := '[]'::jsonb; labels text[] := '{}';
  g_ret timestamptz; g_set timestamptz; g_hc timestamptz; g_after timestamptz;
  b_hold boolean; b_reason text; b_hold_at timestamptz; b_need boolean; b_wreason text; b_next timestamptz;
  v_name text; v_undo uuid; v_sub text;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_item_id is null or p_item_id !~ '^claim:[0-9a-f-]{36}$' then raise exception 'There is nothing to tap on this one.'; end if;
  v_case := substr(p_item_id, 7)::uuid;
  select * into r from claim_cases where id = v_case for update;
  if r.id is null then raise exception 'No such claim.'; end if;

  select coalesce(array_agg(b->>'fix_action'), '{}') into present
    from jsonb_array_elements(stuck_items_core()) i, jsonb_array_elements(i->'blocks') b
   where i->>'item_id' = p_item_id and b->>'fix_action' is not null;
  if coalesce(p_action, 'all') = 'all' then want := present;
  elsif p_action = any (present) then want := array[p_action];
  else raise exception 'That one is already fixed.'; end if;
  if cardinality(want) = 0 then raise exception 'Nothing left to fix here.'; end if;

  v_name := coalesce((select name from bestly_agents where slug = 'claims-closer'), 'Claims Closer');
  v_sub := 'Reservation ' || r.reservation_id;

  -- 1. Complete trip (same three stamps host_trip_complete writes, looked up by reservation instead of token)
  if 'trip_complete' = any (want) then
    select g.returned_at, g.settled_at, g.host_completed_at into g_ret, g_set, g_hc
      from lax_guest_links g where g.reservation_id = r.reservation_id for update;
    update lax_guest_links set returned_at = coalesce(returned_at, now()), settled_at = coalesce(settled_at, now()),
           host_completed_at = coalesce(host_completed_at, now())
     where reservation_id = r.reservation_id returning host_completed_at into g_after;
    if g_after is null then raise exception 'This trip has no guest page to complete.'; end if;
    steps := steps || jsonb_build_array(jsonb_build_object('block', 'trip_complete', 'reservation_id', r.reservation_id,
      'before', jsonb_build_object('returned_at', g_ret, 'settled_at', g_set, 'host_completed_at', g_hc), 'after_hc', g_after));
    labels := labels || 'Trip marked complete';
  end if;

  -- 2. Release the hold (the existing claims_hold_release does the write and logs its own note)
  if 'hold' = any (want) then
    select outbound_hold, outbound_hold_reason, outbound_hold_at, needs_work, work_reason, next_check_at
      into b_hold, b_reason, b_hold_at, b_need, b_wreason, b_next from claim_cases where id = r.id;
    perform claims_hold_release(r.id);
    steps := steps || jsonb_build_array(jsonb_build_object('block', 'hold',
      'before', jsonb_build_object('outbound_hold', b_hold, 'outbound_hold_reason', b_reason, 'outbound_hold_at', b_hold_at,
                                   'needs_work', b_need, 'work_reason', b_wreason, 'next_check_at', b_next)));
    labels := labels || 'Hold released';
  end if;

  -- 3. Sync: poke the Pi reader (the path claims_watch uses) and put the case back on the worker's list
  if 'sync' = any (want) then
    select needs_work, work_reason, next_check_at into b_need, b_wreason, b_next from claim_cases where id = r.id;
    update turo_reader_state set poke_at = now() where id = 1;
    update claim_cases set needs_work = true, work_reason = 'sync asked from Command Center', next_check_at = now(), updated_at = now() where id = r.id;
    steps := steps || jsonb_build_array(jsonb_build_object('block', 'sync',
      'before', jsonb_build_object('needs_work', b_need, 'work_reason', b_wreason, 'next_check_at', b_next)));
    labels := labels || 'Sync asked';
  end if;

  -- 4. Wake: run the worker now (the same call claims_tick makes every 2 minutes)
  if 'wake' = any (want) then
    select needs_work, work_reason, next_check_at into b_need, b_wreason, b_next from claim_cases where id = r.id;
    update claim_cases set next_check_at = now(), updated_at = now() where id = r.id;
    begin perform invoke_edge_function('claims-closer', '{"op":"tick"}'::jsonb, 120000); exception when others then null; end;
    steps := steps || jsonb_build_array(jsonb_build_object('block', 'wake',
      'before', jsonb_build_object('needs_work', b_need, 'work_reason', b_wreason, 'next_check_at', b_next)));
    labels := labels || 'Worker woken';
  end if;

  insert into stuck_undo (item_id, employee_slug, employee_name, label, subtitle, action, snapshot, by_user)
  values (p_item_id, 'claims-closer', v_name, array_to_string(labels, ', '), v_sub, coalesce(p_action, 'all'),
          jsonb_build_object('case_id', r.id, 'steps', steps), auth.uid())
  returning id into v_undo;

  insert into claim_events (case_id, reservation_id, kind, title, detail)
  values (r.id, r.reservation_id, 'note', 'Fixed from Command Center: ' || array_to_string(labels, ', '),
          jsonb_build_object('by', auth.uid(), 'undo_id', v_undo, 'blocks', to_jsonb(want)));

  return jsonb_build_object('ok', true, 'undo_id', v_undo, 'fixed', to_jsonb(labels), 'employee', v_name);
end $$;

-- Puts the case back the way it was, inside 24 hours. A step is skipped, not forced, if something changed it since.
-- It cannot recall a message that already went out after the fix.
create or replace function public.admin_stuck_undo(p_undo_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u stuck_undo; s record; v_case uuid; v_res bigint; n integer; done_ text[] := '{}'; skipped text[] := '{}';
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  select * into u from stuck_undo where id = p_undo_id for update;
  if u.id is null then raise exception 'That fix is gone.'; end if;
  if u.undone_at is not null then raise exception 'Already undone.'; end if;
  if u.expires_at <= now() then raise exception 'The 24 hours to undo are up.'; end if;
  v_case := (u.snapshot->>'case_id')::uuid;
  select reservation_id into v_res from claim_cases where id = v_case;

  for s in select x as step from jsonb_array_elements(u.snapshot->'steps') with ordinality as t(x, ord) order by ord desc loop
    n := 0;
    if s.step->>'block' = 'trip_complete' then
      update lax_guest_links set
             returned_at = (s.step->'before'->>'returned_at')::timestamptz,
             settled_at = (s.step->'before'->>'settled_at')::timestamptz,
             host_completed_at = (s.step->'before'->>'host_completed_at')::timestamptz
       where reservation_id = (s.step->>'reservation_id')::bigint
         and host_completed_at is not distinct from (s.step->>'after_hc')::timestamptz;
      get diagnostics n = row_count;
    elsif s.step->>'block' = 'hold' then
      update claim_cases set
             outbound_hold = coalesce((s.step->'before'->>'outbound_hold')::boolean, false),
             outbound_hold_reason = s.step->'before'->>'outbound_hold_reason',
             outbound_hold_at = (s.step->'before'->>'outbound_hold_at')::timestamptz,
             needs_work = coalesce((s.step->'before'->>'needs_work')::boolean, false),
             work_reason = s.step->'before'->>'work_reason',
             next_check_at = (s.step->'before'->>'next_check_at')::timestamptz,
             updated_at = now()
       where id = v_case and not coalesce(outbound_hold, false);
      get diagnostics n = row_count;
    elsif s.step->>'block' in ('sync', 'wake') then
      update claim_cases set
             needs_work = coalesce((s.step->'before'->>'needs_work')::boolean, false),
             work_reason = s.step->'before'->>'work_reason',
             next_check_at = (s.step->'before'->>'next_check_at')::timestamptz,
             updated_at = now()
       where id = v_case;
      get diagnostics n = row_count;
    end if;
    if n > 0 then done_ := done_ || (s.step->>'block'); else skipped := skipped || (s.step->>'block'); end if;
  end loop;

  update stuck_undo set undone_at = now() where id = u.id;
  insert into claim_events (case_id, reservation_id, kind, title, detail)
  values (v_case, v_res, 'note', 'Undid Command Center fix: ' || u.label,
          jsonb_build_object('by', auth.uid(), 'undo_id', u.id, 'restored', to_jsonb(done_), 'skipped', to_jsonb(skipped)));
  return jsonb_build_object('ok', true, 'restored', to_jsonb(done_), 'skipped', to_jsonb(skipped), 'label', u.label);
end $$;

-- ───────────────────────── daily check on claims outside Bestly ─────────────────────────
-- Reply from the insurer's domain in bestly_mail: mark replied and tell Jared (signed by the owner employee).
-- Reply overdue: queue the Ava errand exactly as the Pipeline page does (an ava_errands row, status 'open').
-- An open errand does nothing until Jared taps "Call now" in Pipeline, so the call is always his tap.
-- This function never sends email and never dials.
create or replace function public.outside_claims_check() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; m record; v_pat text; v_errand uuid; v_replied integer := 0; v_escalated integer := 0; v_err text[] := '{}';
  v_title text; v_who text; v_details text;
begin
  for r in select * from outside_claims where status = 'waiting' order by created_at loop
    begin
      v_pat := '@([a-z0-9-]+\.)*' || replace(lower(r.reply_domain), '.', '\.') || '>?\s*$';
      select * into m from bestly_mail
       where lower(from_addr) ~ v_pat and sent_at > coalesce(r.last_sent_at, r.created_at)
       order by sent_at limit 1;

      if m.id is not null then
        update outside_claims set status = 'replied', replied_at = m.sent_at, reply_mail_id = m.id, updated_at = now() where id = r.id;
        insert into claim_events (kind, title, detail, mail_id)
        values ('insurer', 'Reply from ' || coalesce(r.adjuster_org, r.insurer) || ' on claim ' || coalesce(r.claim_no, ''),
                jsonb_build_object('outside_claim', r.id, 'from', m.from_addr), m.id);
        perform claims_notify(coalesce(r.adjuster_org, r.insurer) || ' replied',
          m.from_addr || ' wrote back on ' || stuck_when(m.sent_at) || ' about claim ' || coalesce(r.claim_no, '') || '. Their message is in the mail inbox.',
          'warning', 'outside-claim-replied-' || r.id);
        v_replied := v_replied + 1;

      elsif r.reply_due_at is not null and r.reply_due_at < now() then
        if r.errand_id is null and r.escalation_phone is not null then
          v_title := 'Call ' || coalesce(r.adjuster_org, r.insurer) || ' supervisor about claim ' || coalesce(r.claim_no, '');
          v_who := coalesce(r.escalation_name, 'Supervisor') || ', ' || coalesce(r.adjuster_org, r.insurer) || ' ' || lower(coalesce(r.escalation_role, 'supervisor'));
          v_details := 'No reply to the ' || lower(stuck_ordinal(r.emails_sent)) || ' email (sent ' || stuck_when(r.last_sent_at) || '). '
            || coalesce(r.insurer, '') || ', claim ' || coalesce(r.claim_no, '') || ', insured ' || coalesce(r.insured_name, '') || '. '
            || coalesce(r.check_note || ' (' || stuck_money(r.check_amount) || '). ', '')
            || coalesce('Shortfall ' || stuck_money(r.shortfall_amount) || '. ', '')
            || case when r.escalation_ext is not null then 'Dial extension ' || r.escalation_ext || ' after the line picks up.' else '' end;
          insert into ava_errands (title, who, phone, details, due_by)
          values (left(v_title, 200), left(v_who, 200), left(regexp_replace(r.escalation_phone, '\D', '', 'g'), 40), left(v_details, 2000),
                  (now() at time zone 'America/Los_Angeles')::date)
          returning id into v_errand;
          update outside_claims set status = 'escalated', escalated_at = now(), errand_id = v_errand, updated_at = now() where id = r.id;
          insert into claim_events (kind, title, detail)
          values ('insurer', coalesce(r.adjuster_org, r.insurer) || ' never replied; Ava errand queued',
                  jsonb_build_object('outside_claim', r.id, 'errand_id', v_errand));
          perform claims_notify(coalesce(r.adjuster_org, r.insurer) || ' never replied',
            'The reply was due ' || stuck_day(r.reply_due_at) || '. I queued a call to ' || coalesce(r.escalation_name, 'their supervisor')
            || ' for Ava. Nothing has been dialed or emailed. Tap Call now on the errand in Pipeline when you are ready.',
            'warning', 'outside-claim-escalated-' || r.id);
          v_escalated := v_escalated + 1;
        end if;
      end if;
    exception when others then
      v_err := v_err || (r.slug || ': ' || left(sqlerrm, 160));
    end;
  end loop;
  update stuck_state set checked_at = now(), last_error = nullif(array_to_string(v_err, '; '), '') where id;
  return jsonb_build_object('replied', v_replied, 'escalated', v_escalated, 'errors', to_jsonb(v_err));
end $$;

-- ───────────────────────── tracking and the 1 hour push ─────────────────────────

-- One push per item per stuck episode, after 1 hour, signed by the responsible employee.
-- Claims Closer's go through claims_notify (her name, her dedupe ledger); everyone else's through notify_route in their own name.
-- Generic "agent not OK" items push only when stuck_state.push_agents is true. At most 3 pushes per run.
create or replace function public.stuck_push() returns integer
language plpgsql security definer set search_path = public as $$
declare i jsonb; n integer := 0; v_key text; v_first timestamptz; v_title text; v_body text; v_name text; v_agents boolean;
begin
  select push_agents into v_agents from stuck_state where id;
  for i in
    select x from jsonb_array_elements(stuck_items_core()) x
     where x->>'kind' = 'stuck' and (x->>'stuck_since')::timestamptz < now() - interval '1 hour'
     order by (x->>'stuck_since')::timestamptz
  loop
    exit when n >= 3;
    continue when (i->>'item_id') like 'agent:%' and not coalesce(v_agents, false);
    insert into stuck_seen (item_id, kind, first_seen_at) values (i->>'item_id', 'stuck', coalesce((i->>'stuck_since')::timestamptz, now())) on conflict (item_id) do nothing;
    select first_seen_at into v_first from stuck_seen where item_id = i->>'item_id' and pushed_at is null;
    continue when v_first is null;                       -- already pushed for this episode

    v_name := coalesce(i->>'employee_name', 'Bestly');
    v_title := (i->>'title') || ' is stuck';
    v_body := (select string_agg(b->>'label', '; ') from jsonb_array_elements(i->'blocks') b) || '. Open the Command Center to fix it.';
    v_key := 'stuck-push-' || (i->>'item_id') || '-' || to_char(v_first, 'YYYYMMDDHH24MI');
    begin
      if i->>'employee_slug' = 'claims-closer' then
        perform claims_notify(v_title, v_body, 'warning', v_key);
      else
        perform notify_route(v_name || ': ' || left(v_title, 170), v_body, 'time-sensitive', v_name, 'https://bestly.tech/admin', null, v_key, null, null, false, now());
      end if;
    exception when others then null;
    end;
    update stuck_seen set pushed_at = now(), push_count = push_count + 1 where item_id = i->>'item_id';
    n := n + 1;
  end loop;
  return n;
end $$;

-- Every 5 minutes: remember when each item became stuck (so "15+ min" and "1 hr+" survive beats that keep overwriting), forget the fixed ones, push.
create or replace function public.stuck_sweep() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_items jsonb; v_ids text[]; v_pushed integer; v_msg text;
begin
  v_items := stuck_items_core();
  select coalesce(array_agg(x->>'item_id'), '{}') into v_ids from jsonb_array_elements(v_items) x where x->>'kind' = 'stuck';
  insert into stuck_seen (item_id, kind, first_seen_at, last_seen_at)
  select x->>'item_id', 'stuck', coalesce((x->>'stuck_since')::timestamptz, now()), now()
    from jsonb_array_elements(v_items) x where x->>'kind' = 'stuck'
  on conflict (item_id) do update set last_seen_at = now();
  delete from stuck_seen where not (item_id = any (v_ids));
  v_pushed := stuck_push();
  update stuck_state set swept_at = now(), last_error = null where id;
  return jsonb_build_object('stuck', cardinality(v_ids), 'pushed', v_pushed);
exception when others then
  v_msg := left(sqlerrm, 300);
  update stuck_state set last_error = v_msg where id;
  return jsonb_build_object('error', v_msg);
end $$;

-- ───────────────────────── watchdog ─────────────────────────
-- Raises stuck.feed (owner: Claims Closer, via notification_owners 'stuck') when the card's feed cannot be trusted:
-- the feed errors, a claim on hold is missing from it, the sweep has gone quiet, or the daily outside-claims check was missed.
-- It tries the obvious self-heal first (run the sweep / run the check) and only then raises.
create or replace function public.stuck_feed_selftest() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st stuck_state; v_items jsonb; v_probs text[] := '{}'; n_hold integer; n_seen integer; v_healed boolean := false;
begin
  select * into st from stuck_state where id;

  begin
    v_items := stuck_items_core();
    select count(*) into n_hold from claim_cases where status not in ('paid', 'closed') and not coalesce(history, false) and coalesce(outbound_hold, false);
    select count(*) into n_seen from jsonb_array_elements(v_items) i
     where i->>'item_id' like 'claim:%' and exists (select 1 from jsonb_array_elements(i->'blocks') b where b->>'id' = 'hold');
    if n_hold <> n_seen then v_probs := v_probs || (n_hold || ' claim(s) are on hold but the card shows ' || n_seen); end if;
  exception when others then
    v_probs := v_probs || ('the feed raised an error: ' || left(sqlerrm, 160));
  end;

  if coalesce(st.swept_at, st.created_at) < now() - interval '20 minutes' then
    begin perform stuck_sweep(); exception when others then null; end;
    select * into st from stuck_state where id;
    if coalesce(st.swept_at, st.created_at) < now() - interval '20 minutes' then v_probs := v_probs || 'the 5-minute sweep has not run in over 20 minutes';
    else v_healed := true; end if;
  end if;

  if exists (select 1 from outside_claims where status = 'waiting' and reply_due_at < now() - interval '36 hours') then
    begin perform outside_claims_check(); exception when others then null; end;
    if exists (select 1 from outside_claims where status = 'waiting' and reply_due_at < now() - interval '36 hours') then
      v_probs := v_probs || 'an outside claim is 36+ hours past its reply date and the daily check did not act on it';
    else v_healed := true; end if;
  end if;

  if cardinality(v_probs) > 0 then
    perform bestly_raise('stuck.feed', 'problem', 'warning', 'The stuck card is not trustworthy', array_to_string(v_probs, '; ') || '.', 'turo', null, false);
  else
    perform bestly_raise('stuck.feed', 'resolved', 'info', 'The stuck card is working', null, 'turo', null, true);
  end if;
  return jsonb_build_object('problems', to_jsonb(v_probs), 'healed', v_healed);
end $$;

-- ───────────────────────── who can call what ─────────────────────────

do $$ declare f text; begin
  foreach f in array array['admin_stuck_items()', 'admin_stuck_fix(text,text)', 'admin_stuck_undo(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['stuck_items_core()', 'outside_claims_check()', 'stuck_push()', 'stuck_sweep()', 'stuck_feed_selftest()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ───────────────────────── schedules: enable at rollout ─────────────────────────
-- Not scheduled by this file. At rollout, run these (times are UTC; 16:17 UTC is 9:17 AM Pacific in summer, 8:17 AM in winter):
--
-- select cron.schedule('stuck-sweep',           '*/5 * * * *',    'select public.stuck_sweep()');
-- select cron.schedule('outside-claims-check',  '17 16 * * *',    'select public.outside_claims_check()');
-- select cron.schedule('stuck-feed-selftest',   '3-59/15 * * * *','select public.stuck_feed_selftest()');
--
-- Also at rollout: the watchdog is Claims Closer's, so add the three job names to her pulse "also" list in bestly_agents
-- ('stuck-sweep', 'outside-claims-check', 'stuck-feed-selftest') so Scout sees them go quiet.

-- ───────────────────────── UNDO (this migration) ─────────────────────────
-- Run in this order to take everything back out:
--
-- select cron.unschedule('stuck-sweep')          where exists (select 1 from cron.job where jobname = 'stuck-sweep');
-- select cron.unschedule('outside-claims-check') where exists (select 1 from cron.job where jobname = 'outside-claims-check');
-- select cron.unschedule('stuck-feed-selftest')  where exists (select 1 from cron.job where jobname = 'stuck-feed-selftest');
-- select public.bestly_raise('stuck.feed', 'resolved', 'info', 'Stuck card removed', null, 'turo', null, true);
-- drop function if exists public.stuck_feed_selftest();
-- drop function if exists public.stuck_sweep();
-- drop function if exists public.stuck_push();
-- drop function if exists public.outside_claims_check();
-- drop function if exists public.admin_stuck_undo(uuid);
-- drop function if exists public.admin_stuck_fix(text, text);
-- drop function if exists public.admin_stuck_items();
-- drop function if exists public.stuck_items_core();
-- drop function if exists public.stuck_money(numeric);
-- drop function if exists public.stuck_ordinal(integer);
-- drop function if exists public.stuck_short(text, integer);
-- drop function if exists public.stuck_span(timestamptz);
-- drop function if exists public.stuck_day(timestamptz);
-- drop function if exists public.stuck_when(timestamptz);
-- drop function if exists public.stuck_clock(timestamptz);
-- delete from public.notification_owners where prefix = 'stuck';
-- -- If any outside_claims row was escalated, its Ava errand lives on in ava_errands (drop it from the Pipeline page if unwanted).
-- drop table if exists public.stuck_state;
-- drop table if exists public.stuck_seen;
-- drop table if exists public.stuck_undo;
-- drop table if exists public.outside_claims;
--
-- A fix made from the card is undone from the card (24 hours). After the tables are dropped, a fix is undone by hand:
-- trip complete: update lax_guest_links set host_completed_at = null where reservation_id = <id>;
-- hold: update claim_cases set outbound_hold = true where id = <id>;
