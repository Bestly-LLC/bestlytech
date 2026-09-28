-- Wall round 4, worker W2 (strip + widgets), 2026-09-28. Plan: docs/wall-round4-2026-09-28-opusplan.md
--  1. Packages: wall_packages (from the deliveries feed), admin check-off wall_package_done / wall_admin_packages,
--     wall_pi_feeds.packages[] and .deliveries[] exclude the ones checked off.
--  2. Mail: sender + what per piece ("Chase — card statement"), never a bare "Letter"; the Pi labels pieces from the
--     scan image (wall_pi_mail_label / wall_pi_mail_redo), mail.items[] = today's one-liners, bullets "Mon · Chase — ...".
--     wall_today(): the "Mail today" card's second line lists today's pieces.
--  3. Energy: today_cents / month_cents.
--  4. Turo: turo.calendar[{date, status, guest?, car?, part?}] for today + 29 days. No blocked-date source exists in the
--     turo_* tables (turo_day_prices "blocked" = the price robot's gate, not the car's availability), so days are
--     booked or open; the widget already draws blocked when a source appears.
--  5. Claude usage: feed "claude" {pct, label, resets_at, source, spent_usd, cap_usd} = Scout's Anthropic API spend today
--     (ai_spend) vs its daily caps (scout_settings). claude.ai plan limits have no API. Stale -> wall_feeds_watch.
--  6. Widget switches: turoCal, claude.
--  7. Watchdog wall_r4w2_watch (every 10 min): calendar present, mail pieces labeled, vision reader healthy, packages sync.

-- ───────────────────────── 1. packages ─────────────────────────
create table if not exists public.wall_packages (
  id          bigint generated always as identity primary key,
  key         text not null unique,
  carrier     text,
  what        text,
  eta         text,
  status      text,
  source      text not null default 'email',
  done        boolean not null default false,
  done_at     timestamptz,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
alter table public.wall_packages enable row level security;
revoke all on public.wall_packages from anon, authenticated;

create or replace function public.wall_package_key(p jsonb)
returns text language sql immutable set search_path to 'public' as $$
  select left(coalesce(nullif(p->>'key', ''), coalesce(p->>'carrier', '?') || ':' || coalesce(p->>'what', '?')), 200)
$$;

create or replace function public.wall_packages_sync_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare e jsonb;
begin
  if new.kind <> 'deliveries' or jsonb_typeof(new.data) <> 'array' then return new; end if;
  for e in select * from jsonb_array_elements(new.data) loop
    insert into wall_packages (key, carrier, what, eta, status, source)
    values (wall_package_key(e), left(e->>'carrier', 40), left(e->>'what', 80), left(e->>'eta', 40), left(e->>'status', 30),
            case when e->>'carrier' = 'USPS' and e->>'at' is null then 'usps' else 'email' end)
    on conflict (key) do update set carrier = excluded.carrier, what = excluded.what, eta = excluded.eta,
                                    status = excluded.status, last_seen = now();
  end loop;
  return new;
end $$;
drop trigger if exists wall_packages_sync on public.wall_feeds;
create trigger wall_packages_sync after insert or update of data on public.wall_feeds
  for each row when (new.kind = 'deliveries') execute function public.wall_packages_sync_trg();

-- the deliveries feed minus what Jared checked off, each with its package id (order kept)
create or replace function public.wall_packages_open(p_items jsonb)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(e || jsonb_build_object('id', p.id) order by o), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) with ordinality x(e, o)
    left join wall_packages p on p.key = wall_package_key(e)
   where p.done is not true
$$;

create or replace function public.wall_admin_packages()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare cur jsonb;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select data into cur from wall_feeds where kind = 'deliveries';
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'carrier', p.carrier, 'what', p.what, 'eta', p.eta, 'status', p.status, 'source', p.source,
      'done', p.done, 'done_at', p.done_at, 'first_seen', p.first_seen, 'last_seen', p.last_seen,
      'on_wall', not p.done and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cur) = 'array' then cur else '[]'::jsonb end) e
                                        where wall_package_key(e) = p.key))
      order by p.done, p.last_seen desc)
    from wall_packages p where p.last_seen > now() - interval '21 days' or not p.done), '[]'::jsonb);
end $$;

create or replace function public.wall_package_done(p_id bigint, p_done boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r wall_packages;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update wall_packages set done = coalesce(p_done, true), done_at = case when coalesce(p_done, true) then now() end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'no such package'; end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'done', r.done);
end $$;
revoke all on function public.wall_admin_packages() from anon;
revoke all on function public.wall_package_done(bigint, boolean) from anon;
grant execute on function public.wall_admin_packages() to authenticated;
grant execute on function public.wall_package_done(bigint, boolean) to authenticated;
revoke all on function public.wall_packages_open(jsonb) from public, anon, authenticated;

-- seed from the current feed
update public.wall_feeds set data = data where kind = 'deliveries' and data is not null;

-- ───────────────────────── 2. mail ─────────────────────────
alter table public.wall_mail_pieces add column if not exists sender text;
alter table public.wall_mail_pieces add column if not exists what text;
alter table public.wall_mail_pieces add column if not exists via text;          -- vision | ocr | old
alter table public.wall_mail_pieces add column if not exists tries int not null default 0;

-- one line for a piece: "Chase — card statement" / "Letter from Chase" / "Letter (sender not readable)"; never a bare "Letter"
create or replace function public.wall_mail_line(p_sender text, p_what text, p_summary text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when nullif(btrim(p_sender), '') is not null and nullif(btrim(p_what), '') is not null
      then left(btrim(p_sender), 28) || ' — ' || left(case when substr(btrim(p_what), 2, 1) ~ '[a-z]' then lower(left(btrim(p_what), 1)) || substr(btrim(p_what), 2) else btrim(p_what) end, 30)
    when nullif(btrim(p_sender), '') is not null then 'Letter from ' || left(btrim(p_sender), 30)
    when nullif(btrim(p_summary), '') is not null and btrim(p_summary) !~* '^(letter|mail|unknown|\(unreadable\))\.?$' then left(btrim(p_summary), 60)
    else 'Letter (sender not readable)' end
$$;

create or replace function public.wall_feeds_build_mail()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare today date := (now() at time zone 'America/Los_Angeles')::date; since date := today - 6;
        digests jsonb; cnt int; bullets jsonb; items jsonb; n_today int;
begin
  select coalesce(meta->'digests', '{}'::jsonb) into digests from wall_feeds where kind = 'mail';
  select coalesce(sum(greatest(coalesce((v->>'mailpieces')::int, 0),
                   (select count(*) from wall_mail_pieces p where p.day = d.key::date and p.kind = 'mail'))), 0)
    into cnt from jsonb_each(digests) d(key, v) where d.key::date >= since;
  cnt := greatest(cnt, (select count(*) from wall_mail_pieces where day >= since and kind = 'mail'));
  select coalesce((digests->today::text->>'mailpieces')::int, (select count(*) from wall_mail_pieces where day = today and kind = 'mail'))
    into n_today;
  -- "Mon · Chase — card statement" (same line on the same day twice -> "×2"), newest first
  select coalesce(jsonb_agg(b order by d desc, b), '[]'::jsonb) into bullets from (
    select to_char(day, 'Dy') || ' · ' || l || case when count(*) > 1 then ' ×' || count(*) else '' end as b, day as d
      from (select day, wall_mail_line(sender, what, summary) as l from wall_mail_pieces
             where day >= since and kind = 'mail' and (summary is not null or sender is not null)) x
     group by day, l
     order by day desc limit 8) q;
  select coalesce(jsonb_agg(wall_mail_line(sender, what, summary) order by key), '[]'::jsonb) into items
    from wall_mail_pieces where day = today and kind = 'mail' and (summary is not null or sender is not null);
  return jsonb_build_object('bullets', bullets, 'items', items, 'count', cnt, 'today', coalesce(n_today, 0), 'since', since,
                            'pending', (select count(*) from wall_mail_pieces where day >= since and summary is null));
end $$;

-- OCR fallback path (wall-feeds edge fn): now also sender / what
create or replace function public.wall_mail_pieces_done(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    update wall_mail_pieces
       set sender = coalesce(sender, left(nullif(btrim(r->>'sender'), ''), 40)),
           what = coalesce(what, left(nullif(btrim(r->>'what'), ''), 40)),
           via = coalesce(via, 'ocr'),
           summary = wall_mail_line(coalesce(sender, r->>'sender'), coalesce(what, r->>'what'), r->>'summary'),
           ocr = null, summarized_at = now()
     where key = r->>'key' and summary is null;
    n := n + 1;
  end loop;
  perform wall_feed_set('mail', wall_feeds_build_mail());
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- the Pi read the scan image (vision model, then local OCR as fallback): rows [{key, day, sender, what, via, fail?, err?}]
create or replace function public.wall_pi_mail_label(p_token text, p_rows jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; n int := 0; bad int := 0;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 40 then raise exception 'bad rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce((r->>'fail')::boolean, false) then
      -- image unreadable: keep the local OCR text for the text model (wall-feeds edge fn); after 3 tries say so plainly
      insert into wall_mail_pieces (key, day, tries, ocr) values (left(r->>'key', 220), (r->>'day')::date, 1, left(nullif(r->>'ocr', ''), 1500))
      on conflict (key) do update set tries = wall_mail_pieces.tries + 1, ocr = coalesce(excluded.ocr, wall_mail_pieces.ocr),
        summary = case when wall_mail_pieces.summary is null and wall_mail_pieces.tries + 1 >= 3 and excluded.ocr is null
                       then 'Letter (sender not readable)' else wall_mail_pieces.summary end,
        summarized_at = case when wall_mail_pieces.summary is null and wall_mail_pieces.tries + 1 >= 3 and excluded.ocr is null
                             then now() else wall_mail_pieces.summarized_at end;
      bad := bad + 1;
    else
      insert into wall_mail_pieces (key, day, sender, what, via, summary, summarized_at, ocr)
      values (left(r->>'key', 220), (r->>'day')::date, left(nullif(btrim(r->>'sender'), ''), 40), left(nullif(btrim(r->>'what'), ''), 40),
              left(r->>'via', 12), wall_mail_line(r->>'sender', r->>'what', null), now(), null)
      on conflict (key) do update set sender = excluded.sender, what = excluded.what, via = excluded.via,
                                      summary = excluded.summary, summarized_at = now(), ocr = null, tries = wall_mail_pieces.tries + 1;
      n := n + 1;
    end if;
  end loop;
  update wall_feeds set meta = meta || case when p_error is not null
           then jsonb_build_object('vision_err', left(p_error, 300), 'vision_err_at', now())
           else jsonb_build_object('vision_ok_at', now(), 'vision_err', null) end
   where kind = 'mail' and (p_error is not null or n > 0);
  perform wall_feed_set('mail', wall_feeds_build_mail());
  return jsonb_build_object('ok', true, 'labeled', n, 'failed', bad);
end $$;

-- pieces the Pi should (re)read from the image: never labeled, labeled before round 4 (no sender), or a bare "Letter" (max 3 tries)
create or replace function public.wall_pi_mail_redo(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(key) from wall_mail_pieces
                    where day >= (now() at time zone 'America/Los_Angeles')::date - 8 and kind = 'mail' and tries < 3
                      and sender is null and (summary is null or via = 'old' or summary ~* '^(letter|mail)\.?$' or summary ~* 'not readable')), '[]'::jsonb);
end $$;

-- the free-vision key for the Pi's mail reader (Vault only; same gate as wall_pi_icloud)
create or replace function public.wall_pi_vision_keys(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'vault' as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'groq', (select decrypted_secret from vault.decrypted_secrets where name = 'groq_api_key' limit 1),
    'gemini', (select decrypted_secret from vault.decrypted_secrets where name in ('gemini_api_key', 'lax_ask_gemini_key') order by name = 'gemini_api_key' desc limit 1));
end $$;

-- old bare "Letter" rows: mark them for a re-read (the Pi still has those digests for 8 days)
update public.wall_mail_pieces set summary = null, tries = 0
 where sender is null and summary ~* '^(letter|mail)\.?$' and day >= (now() at time zone 'America/Los_Angeles')::date - 8;
update public.wall_mail_pieces set via = 'old' where via is null and summary is not null;

-- "Mail today" card: the second line lists today's pieces
create or replace function public.wall_today()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with d as (
    select max(day) as day from scout_daily
     where kind = 'pick' and status = 'open'
       and day >= (now() at time zone 'America/Los_Angeles')::date - 1
  ), picks as (
    select slot, title, why, action->>'from' as src from scout_daily, d
     where scout_daily.day = d.day and kind = 'pick' and status = 'open'
  ), urgent as (
    select 'urgent' as kind, title, coalesce(needs_jared, left(body, 120)) as why from monitor_issues
     where status = 'open' and severity = 'error' and key not like 'wall.test%'
     order by opened_at desc limit 1
  ), needs as (
    select 'needs' as kind, title, needs_jared as why from monitor_issues
     where status = 'open' and needs_jared is not null and severity <> 'error'
     order by opened_at desc limit 1
  ), usps as (
    -- USPS Informed Delivery digest for today (counts parsed by the Mac mail puller), shown until 7 PM
    select nullif(substring(body_text from 'mailpieces=(\d+)'), '')::int as mp,
           nullif(substring(body_text from 'packages=(\d+)'), '')::int as pk
      from bestly_mail
     where from_addr ilike '%informeddelivery.usps.com'
       and (sent_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date
       and extract(hour from now() at time zone 'America/Los_Angeles') < 19
     order by sent_at desc limit 1
  ), pieces as (
    -- round 4 (W2): what today's pieces are, from the scans ("Chase — card statement · DMV — registration renewal")
    select string_agg(l, ' · ' order by key) as line from (
      select key, wall_mail_line(sender, what, summary) as l from wall_mail_pieces
       where kind = 'mail' and day = (now() at time zone 'America/Los_Angeles')::date
         and (summary is not null or sender is not null)) x
  ), mail as (
    select 'mail' as kind,
      case when mp is null then 'Mail is coming today'
           when mp = 0 and coalesce(pk,0) = 0 then null
           when mp = 0 then pk || ' USPS package' || case when pk > 1 then 's' else '' end || ' today'
           else mp || ' piece' || case when mp > 1 then 's' else '' end || ' of mail today'
             || case when coalesce(pk,0) > 0 then ' + ' || pk || ' package' || case when pk > 1 then 's' else '' end else '' end
      end as title,
      coalesce((select left(line, 140) from pieces), 'Scans are in your USPS Informed Delivery email.') as why
    from usps
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(x order by ord) from (
        select 0 as ord, jsonb_build_object('kind', kind, 'title', title, 'why', why, 'from', 'Monitor') as x from urgent
        union all select 1, jsonb_build_object('kind', kind, 'title', title, 'why', why, 'from', 'USPS') from mail where title is not null
        union all select 2, jsonb_build_object('kind', 'focus', 'title', title, 'why', why, 'from', src) from picks where slot = 'focus'
        union all select 3, jsonb_build_object('kind', 'decision', 'title', title, 'why', why, 'from', src) from picks where slot = 'decision'
        union all select 4, jsonb_build_object('kind', 'quick', 'title', title, 'why', why, 'from', src) from picks where slot = 'quick'
        union all select 5, jsonb_build_object('kind', kind, 'title', title, 'why', why, 'from', 'Monitor') from needs
      ) s), '[]'::jsonb),
    'drafts', (select count(*) from scout_daily where kind = 'draft' and status = 'open'
                and day >= (now() at time zone 'America/Los_Angeles')::date - 1),
    'done_today', (select count(*) from scout_daily where kind = 'pick' and status <> 'open'
                    and done_at >= date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'),
    'needs_you', (select count(*) from monitor_issues where status = 'open' and needs_jared is not null));
$function$;

-- ───────────────────────── 3. energy in cents ─────────────────────────
create or replace function public.wall_feeds_energy_tick()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare ws wall_state; f wall_feeds; m jsonb; tz text := 'America/Los_Angeles';
        mode text; fresh boolean; w_proj numeric; w_chg numeric; w numeric; rate numeric;
        day text := to_char(now() at time zone tz, 'YYYY-MM-DD'); mon text := to_char(now() at time zone tz, 'YYYY-MM');
        last_at timestamptz; last_w numeric; dt_h numeric; day_wh numeric; mon_wh numeric; out jsonb;
begin
  select * into ws from wall_state where id = 1;
  select * into f from wall_feeds where kind = 'energy';
  m := coalesce(f.meta, '{}'::jsonb);
  fresh := ws.status_at > now() - interval '10 minutes';
  mode := case when not coalesce(fresh, false) then 'off'
               else coalesce(ws.status->>'page_mode', ws.state->>'mode', 'board') end;
  w_proj := case when mode = 'off' then 0.5 when mode = 'ambient' then 18 else 22 end;
  w_chg := case when fresh and coalesce((ws.status->'health'->>'charging')::boolean, false)
                then least(65, greatest(0, coalesce((ws.status->'health'->>'watts')::numeric, 0))) else 0 end;
  w := round(w_proj + w_chg + 6 + 1.5, 1);
  rate := case when extract(month from now() at time zone tz) between 6 and 9 then 26.4 else 24.6 end;
  last_at := (m->>'last_at')::timestamptz; last_w := (m->>'last_w')::numeric;
  dt_h := case when last_at is null then 0 else least(extract(epoch from (now() - last_at)), 1200) / 3600.0 end;
  day_wh := case when m->>'day' = day then coalesce((m->>'day_wh')::numeric, 0) else 0 end
            + dt_h * (coalesce(last_w, w) + w) / 2;
  mon_wh := case when m->>'month' = mon then coalesce((m->>'month_wh')::numeric, 0) else 0 end
            + dt_h * (coalesce(last_w, w) + w) / 2;
  m := m || jsonb_build_object('day', day, 'day_wh', round(day_wh, 3), 'month', mon, 'month_wh', round(mon_wh, 3),
                               'last_at', now(), 'last_w', w, 'since', coalesce(m->>'since', now()::text));
  out := jsonb_build_object('watts', w, 'rate_c_kwh', rate,
           'today_usd', round(day_wh / 1000 * rate / 100, 2), 'month_usd', round(mon_wh / 1000 * rate / 100, 2),
           'today_cents', round(day_wh / 1000 * rate, 1), 'month_cents', round(mon_wh / 1000 * rate, 1),
           'today_kwh', round(day_wh / 1000, 3), 'month_kwh', round(mon_wh / 1000, 3),
           'projector', mode, 'estimate', true, 'since', m->>'since');
  perform wall_feed_set('energy', out, null, m);
  return out;
end $function$;

-- ───────────────────────── 4. Turo 30-day calendar ─────────────────────────
create or replace function public.wall_turo_calendar(p_days int default 30)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with d as (
    select (now() at time zone 'America/Los_Angeles')::date + g as day from generate_series(0, greatest(1, least(p_days, 60)) - 1) g
  ), t as (
    select tr.starts_at at time zone 'America/Los_Angeles' as s, tr.ends_at at time zone 'America/Los_Angeles' as e,
           tr.guest_first, coalesce(v.display_name, 'Car') as car
      from turo_trips tr left join turo_vehicle_state v on v.vin = tr.vin
     where tr.ends_at > now() - interval '1 day' and tr.ends_at > tr.starts_at
       and coalesce(tr.status, '') not ilike '%cancel%' and coalesce(tr.status, '') <> 'test'
  )
  select coalesce(jsonb_agg(x order by day), '[]'::jsonb) from (
    select d.day, jsonb_strip_nulls(jsonb_build_object(
             'date', to_char(d.day, 'YYYY-MM-DD'),
             'status', case when b.guest_first is not null or b.car is not null then 'booked' else 'open' end,
             'guest', coalesce(b.gs, b.guest_first), 'car', b.car, 'part', b.part, 'n', nullif(b.n, 1))) as x
      from d
      left join lateral (
        select min(t.guest_first) filter (where t.s::date = d.day) as gs, min(t.guest_first) as guest_first, min(t.car) as car, count(*) as n,
               case when count(*) > 1 then 'turn'
                    when bool_or(t.s::date = d.day) and bool_or(t.e::date = d.day) then 'single'
                    when bool_or(t.s::date = d.day) then 'start'
                    when bool_or(t.e::date = d.day) then 'end' else 'mid' end as part
          from t where t.s < (d.day + 1)::timestamp and t.e > d.day::timestamp
        having count(*) > 0) b on true
  ) q
$$;
revoke all on function public.wall_turo_calendar(int) from public, anon, authenticated;

create or replace function public.wall_feeds_turo()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare tz text := 'America/Los_Angeles';
        d0 timestamptz := date_trunc('day', now() at time zone tz) at time zone tz;
        w0 timestamptz := date_trunc('week', now() at time zone tz) at time zone tz;
        today numeric; week numeric; last_pay record; unpaid numeric; unpaid_end timestamptz; nxt record;
begin
  with t as (select earnings, starts_at s, ends_at e from turo_trips
              where earnings is not null and ends_at > starts_at
                and coalesce(status, '') not ilike '%cancel%' and coalesce(status, '') <> 'test')
  select coalesce(sum(earnings * greatest(0, extract(epoch from (least(e, d0 + interval '1 day') - greatest(s, d0)))) / extract(epoch from (e - s))), 0),
         coalesce(sum(earnings * greatest(0, extract(epoch from (least(e, w0 + interval '7 days') - greatest(s, w0)))) / extract(epoch from (e - s))), 0)
    into today, week from t;
  select (regexp_match(body_text, 'earnings payment of \$([0-9,]+\.[0-9]{2})'))[1] as amt, sent_at into last_pay
    from bestly_mail where from_addr ilike '%turo.com' and subject ilike '%earnings are on the way%'
   order by sent_at desc limit 1;
  select sum(earnings), max(ends_at) into unpaid, unpaid_end from turo_trips
   where ends_at <= now() and ends_at > coalesce(last_pay.sent_at, now() - interval '7 days') - interval '12 hours'
     and earnings is not null and coalesce(status, '') not ilike '%cancel%' and coalesce(status, '') <> 'test';
  if unpaid is null then
    select earnings, ends_at into nxt from turo_trips
     where ends_at > now() and earnings is not null and coalesce(status, '') not ilike '%cancel%' and coalesce(status, '') <> 'test'
     order by ends_at limit 1;
    unpaid := nxt.earnings; unpaid_end := nxt.ends_at;
  end if;
  return jsonb_build_object(
    'today', round(today, 2), 'week', round(week, 2),
    'next_payout', round(unpaid, 2),
    'next_payout_at', case when unpaid_end is not null then greatest(unpaid_end + interval '1 day', now()) end,
    'next_payout_estimate', true,
    'last_payout', case when last_pay.amt is not null then replace(last_pay.amt, ',', '')::numeric end,
    'last_payout_at', last_pay.sent_at,
    'calendar', wall_turo_calendar(30),
    'calendar_blocked', false);   -- no blocked-date source in turo_* yet (see header)
end $function$;

-- ───────────────────────── 5. Claude usage (Scout's Anthropic API spend) ─────────────────────────
create or replace function public.wall_feeds_claude()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare tz text := 'America/Los_Angeles';
        d0 timestamptz := date_trunc('day', now() at time zone tz) at time zone tz;
        spent numeric; calls int; cap numeric; out jsonb;
begin
  select coalesce(sum(cost_usd), 0), count(*) filter (where cost_usd > 0) into spent, calls from ai_spend where at >= d0;
  select coalesce(chat_cap_usd, 5) + coalesce(background_cap_usd, 1) into cap from scout_settings limit 1;
  cap := coalesce(cap, 6);
  out := jsonb_build_object(
    'pct', least(100, round(100 * spent / nullif(cap, 0)))::int,
    'label', 'Scout''s Claude API spend today',
    'short', 'Claude today',
    'spent_usd', round(spent, 2), 'cap_usd', round(cap, 2), 'calls', calls,
    'resets_at', d0 + interval '1 day',
    'source', 'ai_spend: Anthropic API calls by Scout vs its daily caps (claude.ai plan limits have no API)');
  perform wall_feed_set('claude', out);
  return out;
end $$;
revoke all on function public.wall_feeds_claude() from public, anon, authenticated;
insert into public.wall_feeds (kind, interval_min) values ('claude', 5) on conflict (kind) do nothing;

create or replace function public.wall_feeds_refresh()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r jsonb := '{}'::jsonb;
begin
  begin perform wall_feed_set('turo', wall_feeds_turo()); r := r || '{"turo":"ok"}';
  exception when others then perform wall_feed_set('turo', null, sqlerrm); r := r || jsonb_build_object('turo', sqlerrm); end;
  begin perform wall_feeds_energy_tick(); r := r || '{"energy":"ok"}';
  exception when others then perform wall_feed_set('energy', null, sqlerrm); r := r || jsonb_build_object('energy', sqlerrm); end;
  begin perform wall_feeds_claude(); r := r || '{"claude":"ok"}';
  exception when others then perform wall_feed_set('claude', null, sqlerrm); r := r || jsonb_build_object('claude', sqlerrm); end;
  begin update wall_feeds set data = wall_feeds_build_mail() where kind = 'mail' and data is not null;
  exception when others then null; end;
  return r;
end $function$;

create or replace function public.wall_feeds_watch()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f wall_feeds; bad boolean; why text; out jsonb := '{}'::jsonb; kick boolean := false;
        who jsonb := '{"news":"the wall-feeds function","air":"the wall-feeds function","leo":"the wall-feeds function",
                        "deliveries":"the wall-feeds function","turo":"the 5-minute database refresh","energy":"the 5-minute database refresh",
                        "claude":"the 5-minute database refresh (Scout''s Claude API spend)",
                        "mail":"the Pi mail reader (/opt/bestly/feeds, bestly-wall-feeds.timer)","habits":"the Pi feed reader (bestly-wall-feeds.timer)",
                        "appstore":"the Mac mini App Store check (launchd tech.bestly.wall-appstore)"}';
begin
  for f in select * from wall_feeds loop
    bad := coalesce(f.at, f.created_at) < now() - make_interval(mins => f.interval_min * 3)
           or (f.error is not null and f.error_at > coalesce(f.at, '-infinity') and coalesce(f.at, f.created_at) < now() - make_interval(mins => f.interval_min));
    if bad then
      why := case when f.at is null then 'has not loaded yet' else 'last updated ' || to_char(f.at at time zone 'America/Los_Angeles', 'Mon FMDD FMHH12:MI AM') end;
      perform bestly_raise('wall.feeds.' || f.kind, 'problem', 'warning',
        'Wall ' || f.kind || ' feed is stale',
        'The wall''s ' || f.kind || ' widget ' || why || ' (should refresh every ' || f.interval_min || ' min). Fed by '
          || coalesce(who->>f.kind, 'a feed job') || '.' || coalesce(' Last error: ' || f.error, ''),
        'wall', null, false);
      out := out || jsonb_build_object(f.kind, 'stale');
      if f.kind in ('news', 'air', 'leo', 'deliveries') then kick := true; end if;
      if f.kind in ('turo', 'energy', 'claude') then perform wall_feeds_refresh(); end if;
    else
      perform bestly_raise('wall.feeds.' || f.kind, 'resolved', 'info', 'Wall ' || f.kind || ' feed is back', null, 'wall');
    end if;
  end loop;
  if kick then perform invoke_edge_function('wall-feeds', '{"op":"tick","why":"watchdog"}'::jsonb, 120000); end if;
  return out;
end $function$;

-- ───────────────────────── feeds to the Pi ─────────────────────────
create or replace function public.wall_pi_feeds(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare m jsonb; pk jsonb;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  select jsonb_object_agg(kind,
           case when data is null or jsonb_typeof(data) = 'null' or data->>'available' = 'false'
                     or at is null or at < now() - make_interval(mins => interval_min * 6) then null else data end)
    into m from wall_feeds;
  pk := case when jsonb_typeof(m->'deliveries') = 'array' then wall_packages_open(m->'deliveries') end;
  return jsonb_build_object(
    'news', m->'news', 'mail', m->'mail', 'deliveries', pk, 'packages', pk, 'appstore', m->'appstore',
    'turo', m->'turo', 'air', m->'air', 'energy', m->'energy', 'habits', m->'habits', 'leo', m->'leo',
    'claude', m->'claude', 'at', now());
end $function$;

-- ───────────────────────── 6. widget switches ─────────────────────────
create or replace function public.wall_clean_widgets(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $function$
declare out jsonb := '{}'::jsonb; w jsonb := '{}'::jsonb; k text;
begin
  if jsonb_typeof(p->'widgets') = 'object' then
    foreach k in array array['news','mail','turo$','air','energy','habits','leo','appstore','turoCal','claude'] loop
      if jsonb_typeof(p->'widgets'->k) = 'boolean' then w := w || jsonb_build_object(k, p->'widgets'->k); end if;
    end loop;
    out := out || jsonb_build_object('widgets', w);
  elsif p ? 'widgets' and jsonb_typeof(p->'widgets') = 'null' then
    out := out || '{"widgets": null}'::jsonb;
  end if;
  if jsonb_typeof(p->'bookingDemo') = 'number' then
    out := out || jsonb_build_object('bookingDemo', p->'bookingDemo');
  end if;
  return out;
end $function$;

-- ───────────────────────── 7. watchdog ─────────────────────────
create or replace function public.wall_r4w2_watch()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare t jsonb; m wall_feeds; waiting int; out jsonb := '{}'::jsonb;
begin
  -- Turo calendar: 30 days in the turo feed (self-heal: rebuild it now)
  select data into t from wall_feeds where kind = 'turo';
  if jsonb_typeof(t->'calendar') is distinct from 'array' or jsonb_array_length(t->'calendar') < 30 then
    perform wall_feeds_refresh();
    select data into t from wall_feeds where kind = 'turo';
  end if;
  if jsonb_typeof(t->'calendar') is distinct from 'array' or jsonb_array_length(t->'calendar') < 30 then
    perform bestly_raise('wall.turo_calendar', 'problem', 'warning', 'Wall Turo calendar is missing',
      'The 30-day Turo calendar on the wall has no days. It is built by wall_turo_calendar() in the 5-minute refresh.', 'wall', null, false);
    out := out || '{"turo_calendar":"missing"}';
  else
    perform bestly_raise('wall.turo_calendar', 'resolved', 'info', 'Wall Turo calendar is fine', null, 'wall');
  end if;
  -- Mail: pieces still unlabeled 3 h after they arrived, or the Pi's image reader keeps failing
  select * into m from wall_feeds where kind = 'mail';
  select count(*) into waiting from wall_mail_pieces
   where day >= (now() at time zone 'America/Los_Angeles')::date - 2 and summary is null and sender is null and created_at < now() - interval '3 hours'
     and (tries > 0 or created_at > now() - interval '1 day');
  if waiting > 0 or (m.meta->>'vision_err' is not null and (m.meta->>'vision_err_at')::timestamptz > now() - interval '2 hours'
                     and coalesce((m.meta->>'vision_ok_at')::timestamptz, '-infinity') < now() - interval '12 hours') then
    perform bestly_raise('wall.mail_reader', 'problem', 'warning', 'Wall mail summaries are stuck',
      case when waiting > 0 then waiting || ' mail piece(s) have no summary after 3 hours. ' else '' end
        || coalesce('Image reader: ' || (m.meta->>'vision_err') || '. ', '')
        || 'The Pi reads the USPS scans (/opt/bestly/feeds/feeds.py, bestly-wall-feeds.timer; Groq vision, then local OCR).', 'wall', null, false);
    out := out || jsonb_build_object('mail', waiting);
  else
    perform bestly_raise('wall.mail_reader', 'resolved', 'info', 'Wall mail summaries are flowing', null, 'wall');
  end if;
  -- Packages: the feed has items but the table didn't pick them up (trigger broken) -> resync
  if exists (select 1 from wall_feeds f, jsonb_array_elements(case when jsonb_typeof(f.data) = 'array' then f.data else '[]'::jsonb end) e
              where f.kind = 'deliveries' and not exists (select 1 from wall_packages p where p.key = wall_package_key(e))) then
    update wall_feeds set data = data where kind = 'deliveries';
    out := out || '{"packages":"resynced"}';
  end if;
  return out;
end $$;
revoke all on function public.wall_r4w2_watch() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('wall-r4w2-watch') where exists (select 1 from cron.job where jobname = 'wall-r4w2-watch');
  perform cron.schedule('wall-r4w2-watch', '3-59/10 * * * *', 'select public.wall_r4w2_watch()');
end $$;

select public.wall_feeds_refresh();
