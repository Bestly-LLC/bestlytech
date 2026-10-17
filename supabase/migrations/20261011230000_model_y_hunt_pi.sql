-- Model Y Hunter moves off the Claude scheduled task onto the Pi (Jared, 2026-10-11 2:20 PM): free, daily 7:57 AM PT.
--
-- Old home (Claude scheduled task, DISABLED once the Pi version ran OK, kept as the fallback):
--   trig_01DAVaR3LQHduUdgj6SYuDkh  "Used Model Y FSD Hunt"   (slug model-y-hunt)
-- New home: Pi cron job model_y_hunt (tools/model-y-hunt/). Free AI only for reading free-text listings.
--
-- The seen-listings log used to be a memory file; it is now this table. Nothing here holds a person's name, phone or email
-- (no seller contact is ever stored), so there is nothing for the Privacy Clerk to map.
-- All functions are service role only (the Pi); nothing is callable by anon, so nothing goes on security_public_rpcs.

create table if not exists public.model_y_seen (
  key text primary key,                       -- 'fme:<listing id>' or 'cl:<posting id>'
  source text not null,                       -- 'findmyelectric' | 'craigslist'
  url text not null,
  vin text,
  year integer,
  trim text,
  price integer,                              -- price on the most recent look
  first_price integer,
  miles integer,
  city text,
  state text,
  distance_mi integer,                        -- straight-line miles from West Hollywood
  hw4_evidence text,
  fsd_grade text check (fsd_grade in ('CONFIRMED', 'LIKELY')),
  fsd_evidence text,
  verdict text not null default 'pending' check (verdict in ('match', 'rejected', 'pending')),
  reject_reason text,
  first_seen date not null default current_date,
  last_seen date not null default current_date,
  alerted_at timestamptz,                     -- when the match was told to Jared (the 7 PM recap)
  price_history jsonb not null default '[]'::jsonb
);
create index if not exists model_y_seen_last_seen_idx on public.model_y_seen (last_seen);
create index if not exists model_y_seen_vin_idx on public.model_y_seen (vin) where vin is not null;
alter table public.model_y_seen enable row level security;
revoke all on public.model_y_seen from anon, authenticated;

-- The hunt criteria. Numbers live here (bounded setter below), not in code.
create table if not exists public.model_y_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  max_price integer not null default 30000 check (max_price between 5000 and 100000),
  radius_mi integer not null default 100 check (radius_mi between 10 and 400),
  updated_at timestamptz not null default now()
);
insert into public.model_y_settings (id) values (true) on conflict (id) do nothing;
alter table public.model_y_settings enable row level security;
revoke all on public.model_y_settings from anon, authenticated;

create or replace function public.model_y_settings_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(s) - 'id' from model_y_settings s where id
$$;
revoke all on function public.model_y_settings_get() from public, anon, authenticated;
grant execute on function public.model_y_settings_get() to service_role;

create or replace function public.model_y_set(p_enabled boolean default null, p_max_price integer default null, p_radius_mi integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'Admins only'; end if;
  if p_max_price is not null and p_max_price not between 5000 and 100000 then raise exception 'Max price must be $5,000 to $100,000'; end if;
  if p_radius_mi is not null and p_radius_mi not between 10 and 400 then raise exception 'Radius must be 10 to 400 miles'; end if;
  update model_y_settings set enabled = coalesce(p_enabled, enabled), max_price = coalesce(p_max_price, max_price),
         radius_mi = coalesce(p_radius_mi, radius_mi), updated_at = now() where id;
  return model_y_settings_get();
end $$;
revoke all on function public.model_y_set(boolean, integer, integer) from public, anon;
grant execute on function public.model_y_set(boolean, integer, integer) to authenticated, service_role;

-- Everything seen in the last N days, as compact rows (the Pi diffs against this).
create or replace function public.model_y_seen_list(p_days integer default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'vin', vin, 'verdict', verdict, 'price', price, 'source', source,
           'reject_reason', reject_reason, 'last_seen', last_seen, 'alerted', alerted_at is not null)), '[]'::jsonb)
    from model_y_seen where last_seen >= current_date - greatest(p_days, 1)
$$;
revoke all on function public.model_y_seen_list(integer) from public, anon, authenticated;
grant execute on function public.model_y_seen_list(integer) to service_role;

-- Upsert one listing. Returns {new, old_price, dropped}. A price change is appended to price_history.
create or replace function public.model_y_seen_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r model_y_seen; v_new boolean := false; v_old integer; v_price integer := nullif(p->>'price', '')::integer;
begin
  select * into r from model_y_seen where key = p->>'key';
  if r.key is null then
    insert into model_y_seen (key, source, url, vin, year, trim, price, first_price, miles, city, state, distance_mi, hw4_evidence,
                              fsd_grade, fsd_evidence, verdict, reject_reason, price_history)
    values (p->>'key', coalesce(p->>'source', 'unknown'), coalesce(p->>'url', ''), p->>'vin', nullif(p->>'year', '')::integer, p->>'trim',
            v_price, v_price, nullif(p->>'miles', '')::integer, p->>'city', p->>'state', nullif(p->>'distance_mi', '')::integer,
            p->>'hw4_evidence', p->>'fsd_grade', p->>'fsd_evidence', coalesce(p->>'verdict', 'pending'), p->>'reject_reason',
            case when v_price is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('d', current_date, 'price', v_price)) end);
    v_new := true;
  else
    v_old := r.price;
    update model_y_seen set
      url = coalesce(nullif(p->>'url', ''), url), vin = coalesce(p->>'vin', vin), year = coalesce(nullif(p->>'year', '')::integer, year),
      trim = coalesce(p->>'trim', trim), price = coalesce(v_price, price), miles = coalesce(nullif(p->>'miles', '')::integer, miles),
      city = coalesce(p->>'city', city), state = coalesce(p->>'state', state),
      distance_mi = coalesce(nullif(p->>'distance_mi', '')::integer, distance_mi),
      hw4_evidence = coalesce(p->>'hw4_evidence', hw4_evidence), fsd_grade = coalesce(p->>'fsd_grade', fsd_grade),
      fsd_evidence = coalesce(p->>'fsd_evidence', fsd_evidence), verdict = coalesce(p->>'verdict', verdict),
      reject_reason = case when coalesce(p->>'verdict', verdict) = 'match' then null else coalesce(p->>'reject_reason', reject_reason) end,
      last_seen = current_date,
      price_history = case when v_price is not null and v_price is distinct from r.price
                           then price_history || jsonb_build_array(jsonb_build_object('d', current_date, 'price', v_price)) else price_history end
     where key = r.key;
  end if;
  if coalesce((p->>'alerted')::boolean, false) then
    update model_y_seen set alerted_at = now() where key = p->>'key' and alerted_at is null;
  end if;
  return jsonb_build_object('new', v_new, 'old_price', v_old, 'dropped', (v_old is not null and v_price is not null and v_price < v_old));
end $$;
revoke all on function public.model_y_seen_save(jsonb) from public, anon, authenticated;
grant execute on function public.model_y_seen_save(jsonb) to service_role;

-- Keep only the last 60 days of listings.
create or replace function public.model_y_seen_prune() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from model_y_seen where last_seen < current_date - 60;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.model_y_seen_prune() from public, anon, authenticated;
grant execute on function public.model_y_seen_prune() to service_role;

-- ------------------------------------------------------------------ watchdog + team card
insert into public.pi_jobs (job, description, max_gap_min, enabled, replaced_claude_task) values
 ('model_y_hunt', 'Model Y Hunter: daily 7:57 AM scan for used Model Y with FSD, HW4, under $30k near West Hollywood (free, public sources only)', 1560, true, 'trig_01DAVaR3LQHduUdgj6SYuDkh')
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, replaced_claude_task = excluded.replaced_claude_task;

select public.team_onboard($j$[
 {"slug":"model-y-hunt","name":"Model Y Hunter","role":"Car shopper","reports_to":"jared","dept":"desk","runs_on":"pi","icon":"car",
  "schedule":"Daily 7:57 AM","welcome":false,
  "what_it_does":"Looks every morning for a used Tesla Model Y with FSD bought outright, HW4, under $30k within 100 mi of West Hollywood, and tells you only about new ones.",
  "pulse":{"src":"pi_job","key":"model_y_hunt","gap":1560,"alert":true},
  "owns":["modely."]}
]$j$::jsonb);

insert into public.notification_owners (prefix, agent_slug, note)
values ('modely', 'model-y-hunt', 'Model Y Hunter: new listings, source trouble')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;
