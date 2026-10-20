-- Command Center v2 (Jared, 2026-10-20): the data behind the four lead cards on the admin home.
--
--   cc_mercury_pulse   one row: Mercury balances, 30-day in/out, trailing burn, recurring bills, next expected deposit.
--                      Written by the Pi job `mercury_pulse` (read-only Mercury token, IPv4) through cc_mercury_ingest().
--   cc_wx_events       one row: the calendar + Turo items the projection wall already shows on its weather scenes
--                      (wall wx_keep rules, all calendars). Written by the Pi job `cc_wx_events` through cc_wx_ingest().
--   admin_command_center()  one read-only bundle for Money / Turo / AI team / My day / Call next (+ open cc.* issues).
--   admin_cc_wx_events()    the calendar items for the weather card (admin only; no public token in the browser).
--
-- Everything here is read-only for the browser. The two ingest functions are service_role only.

create table if not exists public.cc_mercury_pulse (
  id          int primary key default 1 check (id = 1),
  accounts    jsonb not null default '[]'::jsonb,   -- [{name,last4,balance}]
  total       numeric,
  in_30d      numeric,
  out_30d     numeric,
  burn_daily  numeric,                               -- trailing 30-day spend per day (operating spend only)
  bills       jsonb not null default '[]'::jsonb,   -- [{name,amount,next,every_days}]
  next_deposit jsonb,                                -- {amount,expected_at,basis}
  updated_at  timestamptz not null default now()
);
alter table public.cc_mercury_pulse enable row level security;   -- no policies: only the definer functions below read it

create table if not exists public.cc_wx_events (
  id          int primary key default 1 check (id = 1),
  events      jsonb not null default '[]'::jsonb,
  calendar_at timestamptz,                           -- when the wall last refreshed its calendar
  err         text,
  updated_at  timestamptz not null default now()
);
alter table public.cc_wx_events enable row level security;

create or replace function public.cc_mercury_ingest(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cc_mercury_pulse as c (id, accounts, total, in_30d, out_30d, burn_daily, bills, next_deposit, updated_at)
  values (1, coalesce(p->'accounts','[]'::jsonb), nullif(p->>'total','')::numeric, nullif(p->>'in_30d','')::numeric,
          nullif(p->>'out_30d','')::numeric, nullif(p->>'burn_daily','')::numeric,
          coalesce(p->'bills','[]'::jsonb), p->'next_deposit', now())
  on conflict (id) do update set accounts = excluded.accounts, total = excluded.total, in_30d = excluded.in_30d,
    out_30d = excluded.out_30d, burn_daily = excluded.burn_daily, bills = excluded.bills,
    next_deposit = excluded.next_deposit, updated_at = now();
end $$;

create or replace function public.cc_wx_ingest(p_events jsonb, p_calendar_at timestamptz, p_err text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into cc_wx_events as c (id, events, calendar_at, err, updated_at)
  values (1, coalesce(p_events,'[]'::jsonb), p_calendar_at, left(p_err, 300), now())
  on conflict (id) do update set events = excluded.events, calendar_at = excluded.calendar_at,
    err = excluded.err, updated_at = now();
end $$;

revoke all on function public.cc_mercury_ingest(jsonb) from public, anon, authenticated;
revoke all on function public.cc_wx_ingest(jsonb, timestamptz, text) from public, anon, authenticated;
grant execute on function public.cc_mercury_ingest(jsonb) to service_role;
grant execute on function public.cc_wx_ingest(jsonb, timestamptz, text) to service_role;

create or replace function public.admin_cc_wx_events()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r cc_wx_events;
begin
  perform public.admin_require_admin();
  select * into r from cc_wx_events where id = 1;
  if not found then return jsonb_build_object('events', '[]'::jsonb, 'updated_at', null, 'calendar_at', null, 'err', 'not yet'); end if;
  return jsonb_build_object('events', r.events, 'updated_at', r.updated_at, 'calendar_at', r.calendar_at, 'err', r.err);
end $$;

create or replace function public.admin_command_center()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m cc_mercury_pulse;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  v_spend numeric; v_cap numeric; v_runway_days numeric;
  v_turo jsonb; v_ready jsonb; v_owed numeric := 0;
  v_ai jsonb; v_stuck jsonb; v_emps jsonb; v_calls jsonb; v_leads jsonb; v_issues jsonb;
begin
  perform public.admin_require_admin();

  -- Money -------------------------------------------------------------------------------------------------
  select * into m from cc_mercury_pulse where id = 1;
  if found and m.burn_daily is not null and m.burn_daily > 0 and m.total is not null then
    v_runway_days := floor(m.total / m.burn_daily);
  end if;

  -- Turo --------------------------------------------------------------------------------------------------
  begin v_ready := admin_car_ready(); exception when others then v_ready := null; end;
  begin v_turo := turo_widget(); exception when others then v_turo := null; end;
  begin v_owed := coalesce((v_turo->'owed')::text::numeric, 0); exception when others then v_owed := 0; end;

  -- AI team -----------------------------------------------------------------------------------------------
  select coalesce(sum(cost_usd), 0) into v_spend from ai_spend where at >= v_day_start;
  select coalesce(chat_cap_usd, 0) + coalesce(background_cap_usd, 0) into v_cap from scout_settings limit 1;

  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into v_stuck from (
    select jsonb_build_object('slug', b.slug, 'name', coalesce(a.name, b.slug), 'at', b.at, 'summary', left(b.summary, 160), 'kind', 'job') x
      from (select distinct on (slug) slug, at, ok, summary from agent_beats order by slug, at desc) b
      left join bestly_agents a on a.slug = b.slug
     where b.ok is false and b.at > now() - interval '3 days' and coalesce(a.status, 'active') = 'active'
    union all
    select jsonb_build_object('slug', j.job, 'name', coalesce(j.description, j.job), 'at', j.last_run_at, 'summary', left(coalesce(j.last_summary, ''), 160), 'kind', 'pi')
      from pi_jobs j
     where j.enabled and j.consecutive_failures >= 2
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'role', role, 'schedule', schedule) order by sort, name), '[]'::jsonb) into v_emps
    from bestly_agents
   where status = 'active' and schedule ~* '[0-9]{1,2}(:[0-9]{2})?\s?(am|pm)' and coalesce(private, false) is false;

  v_ai := jsonb_build_object('spend_today', round(v_spend, 3), 'cap', v_cap,
          'employees', (select count(*) from bestly_agents where status = 'active'));

  -- My day ------------------------------------------------------------------------------------------------
  select jsonb_build_object('count', count(*), 'top', coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title) order by created_at desc) filter (where rn <= 3), '[]'::jsonb))
    into v_calls
    from (select id, title, created_at, row_number() over (order by created_at desc) rn
            from scout_daily
           where kind = 'call' and status = 'open' and day >= current_date - 21
             and lower(coalesce(action->>'owner', 'jared')) = 'jared') c;

  -- Call next: Hunter's own ranking over the leads Maya and RoofGuard can actually dial --------------------------
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_leads from (
    select jsonb_build_object('table', s.lead_table, 'company', coalesce(m2.company, r.company), 'window', s.best_window,
             'why', left(s.reason, 140), 'priority', s.priority, 'tz', coalesce(m2.timezone, r.timezone)) x
      from hunter_lead_scores s
      left join maya_leads m2 on s.lead_table = 'maya_leads' and m2.id::text = s.lead_id::text
      left join rg_leads r on s.lead_table = 'rg_leads' and r.id::text = s.lead_id::text
     where (s.lead_table = 'maya_leads' and m2.status = 'queued' and coalesce(m2.dnc, false) is false and m2.phone is not null)
        or (s.lead_table = 'rg_leads' and r.call_status = 'not_called' and coalesce(r.dnc, false) is false and coalesce(r.archived, false) is false and r.phone is not null)
     order by s.priority desc nulls last
     limit 3
  ) t;

  -- Open issues the watchdog raised about the page's own sources ---------------------------------------------------
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'title', title, 'severity', severity, 'since', opened_at) order by opened_at), '[]'::jsonb)
    into v_issues from monitor_issues where status = 'open' and key like 'cc.%';

  return jsonb_build_object(
    'at', now(),
    'money', case when m.id is null then null else jsonb_build_object(
        'accounts', m.accounts, 'total', m.total, 'in_30d', m.in_30d, 'out_30d', m.out_30d, 'burn_daily', m.burn_daily,
        'runway_days', v_runway_days,
        'runway_date', case when v_runway_days is null then null else (current_date + v_runway_days::int) end,
        'bills', m.bills, 'next_deposit', m.next_deposit, 'updated_at', m.updated_at, 'estimate', true) end,
    'turo', jsonb_build_object('widget', v_turo, 'ready', v_ready, 'owed', v_owed,
        'trips', coalesce((select jsonb_agg(jsonb_build_object(
            'id', t.reservation_id, 'guest', trim(coalesce(t.guest_first, 'Guest') || ' ' || coalesce(left(t.guest_last, 1) || '.', '')),
            'car', (select v.display_name from turo_vehicle_state v where v.vin = t.vin),
            'starts_at', t.starts_at, 'ends_at', t.ends_at, 'earnings', t.earnings, 'in_progress', t.in_progress) order by t.starts_at)
          from (select * from turo_trips
                 where ends_at > now() and coalesce(status, '') not ilike '%cancel%' and coalesce(status, '') <> 'test'
                 order by starts_at limit 4) t), '[]'::jsonb)),
    'ai', v_ai || jsonb_build_object('stuck', v_stuck, 'employees', v_emps, 'employee_count', (v_ai->>'employees')::int),
    'myday', jsonb_build_object('calls', v_calls),
    'leads', jsonb_build_object('next', v_leads,
        'maya_queued', (select count(*) from maya_leads where status = 'queued'),
        'rg_found', (select count(*) from rg_leads where not coalesce(archived, false))),
    'issues', v_issues
  );
end $$;

revoke all on function public.admin_command_center() from public, anon;
revoke all on function public.admin_cc_wx_events() from public, anon;
grant execute on function public.admin_command_center() to authenticated, service_role;
grant execute on function public.admin_cc_wx_events() to authenticated, service_role;

comment on function public.admin_command_center() is
  'Admin home bundle (Command Center v2, 2026-10-20). Read-only. Money comes from cc_mercury_pulse (Pi job mercury_pulse).';
