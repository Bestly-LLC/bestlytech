-- Parker, the Parking Pass Clerk (Jared, 2026-10-13): fetches the LAX garage QR from Park My Share by itself.
--
-- Before: once a month Jared grabbed the new lobby QR from the Park My Share portal and dropped a screenshot on the Turo
-- settings page. Now a Pi job (tools/lax-code-fetch/lax_code_fetch.py, cron every 30 min, free, no AI) signs in to the
-- Park My Share API (iq.parkimo.com, the same one app.parkmycarshare.com uses), reads the host QR codes, and saves the one
-- Park My Share marks ACTIVE and not yet expired. Same save path as the page: guests' links and saved Wallet passes update.
--
-- "Certain it's a new, active code": a code is only saved when Park My Share says status = active and its expiration is
-- in the future. After saving, lax_fetch_save re-reads what guests are shown (lax_pass_current_row) and returns whether it
-- matches; the job retries, then reports, if it doesn't.
--
-- Self-heal: re-login every run; network/5xx retried with backoff; if the API changes shape the job falls back to a
-- headless browser that signs in to the portal and reads the codes off the page. lax_fetch_watch (pg_cron) asks the Pi
-- for an immediate run whenever this month's code is missing, and raises lax.code.fetch (owned by Parker) only when
-- retries didn't fix it. A rejected login is the one thing only Jared can fix: that alert says so right away.
--
-- The login is saved from Turo Watch > Settings through lax_fetch_connect: write-only into Vault (pi:parkmyshare:*),
-- read by the Pi through pi_secret_get. The page only ever sees when it was saved.

create table if not exists public.lax_fetch_state (
  id boolean primary key default true check (id),
  run_now_at timestamptz,           -- set by "Check now", by saving the login, or by the watchdog
  last_try_at timestamptz,
  last_ok_at timestamptz,
  last_saved_at timestamptz,        -- last time a NEW code went to guests
  last_kind text,                   -- ok | same | saved | auth | down | nocode | expired | verify | nofacility
  last_result text,
  last_error text,
  last_method text,                 -- api | browser
  last_expires timestamptz,         -- expiration Park My Share gave the active code
  facility text,                    -- the garage the code is for
  fails integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.lax_fetch_state (id) values (true) on conflict (id) do nothing;
alter table public.lax_fetch_state enable row level security;

create or replace function public.lax_fetch_configured()
returns boolean language sql stable security definer set search_path = public, vault as $$
  select exists (select 1 from vault.secrets where name = 'pi:parkmyshare:email')
     and exists (select 1 from vault.secrets where name = 'pi:parkmyshare:password')
$$;
revoke all on function public.lax_fetch_configured() from public, anon, authenticated;

-- ------------------------------------------------------------------ Pi side (service role only)
-- Does the job need to talk to Park My Share this run? Cheap: no network unless one of these is true.
create or replace function public.lax_fetch_gate()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s lax_fetch_state; v_month date := lax_month_now(); v_now_payload text; v_day int;
  v_need boolean := false; v_why text := 'nothing due';
begin
  select * into s from lax_fetch_state where id;
  if not lax_fetch_configured() then return jsonb_build_object('configured', false); end if;
  select payload into v_now_payload from lax_parking_codes where valid_month = v_month order by created_at desc limit 1;
  v_day := extract(day from (now() at time zone 'America/Los_Angeles'))::int;
  if s.run_now_at is not null and (s.last_try_at is null or s.run_now_at > s.last_try_at) then
    v_need := true; v_why := 'asked';
  elsif v_now_payload is null then
    -- missing this month's code: every run, backing off to every 2 hours after 3 failures in a row
    if s.fails < 3 or s.last_try_at is null or s.last_try_at < now() - interval '2 hours' then v_need := true; v_why := 'missing'; end if;
  elsif s.last_ok_at is null or s.last_ok_at < now() - interval '20 hours' then
    v_need := true; v_why := 'daily';            -- catches a code Park My Share replaced mid-month
  elsif v_day >= 26 and (s.last_try_at is null or s.last_try_at < now() - interval '6 hours') then
    v_need := true; v_why := 'month-end';
  end if;
  return jsonb_build_object('configured', true, 'need', v_need, 'why', v_why, 'month_now', v_month,
    'now_payload', v_now_payload, 'facility', s.facility, 'fails', s.fails);
end $$;

-- Saves an ACTIVE code for this month (same effect as lax_pass_set from the page), then checks what guests are shown.
create or replace function public.lax_fetch_save(p_payload text, p_expires timestamptz default null, p_facility text default null, p_method text default 'api')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_month date := lax_month_now(); v_code text := btrim(coalesce(p_payload, '')); r lax_parking_codes; c lax_parking_codes;
  v_note text; v_prev text;
begin
  if v_code = '' or length(v_code) > 300 then raise exception 'lax_fetch_save: bad code'; end if;
  if p_expires is not null and p_expires <= now() then raise exception 'lax_fetch_save: code already expired'; end if;
  -- Already what guests are shown for this month: nothing to do. (A different code added by hand later wins over an older
  -- copy of this one, so compare with what guests actually see, not with any row.)
  c := lax_pass_current_row();
  if c.valid_month = v_month and c.payload = v_code then
    return jsonb_build_object('saved', false, 'same', true, 'month', v_month, 'guests_see', true);
  end if;
  select payload into v_prev from lax_parking_codes order by valid_month desc, created_at desc limit 1;
  select note into v_note from lax_parking_codes where valid_month = v_month order by created_at desc limit 1;  -- keep the guest note
  insert into lax_parking_codes (payload, valid_month, note) values (v_code, v_month, v_note) returning * into r;
  insert into lax_pass_log (kind, detail) values ('set', jsonb_build_object('id', r.id, 'month', v_month, 'by', 'lax-code-fetch',
    'method', p_method, 'expires', p_expires, 'facility', p_facility));
  begin
    perform public.invoke_edge_function('wallet-pass', '{"op":"push"}'::jsonb);
  exception when others then
    insert into lax_pass_log (kind, detail) values ('push_error', jsonb_build_object('error', sqlerrm));
  end;
  update lax_fetch_state set last_saved_at = now(), updated_at = now() where id;
  c := lax_pass_current_row();
  -- Good news, signed by Parker: the bell + evening recap, no push.
  perform scout_notify('Parker: new LAX garage code is live',
    'I pulled ' || trim(to_char(v_month, 'FMMonth')) || '''s active code from Park My Share' ||
    case when p_expires is not null then ' (good until ' || to_char(p_expires at time zone 'America/Los_Angeles', 'FMMon FMDD') || ')' else '' end ||
    '. Guest links and saved Wallet passes have it now.',
    'info', false, '/admin/turo#settings', 'lax.code.saved.' || r.id);
  return jsonb_build_object('saved', true, 'same', false, 'month', v_month, 'id', r.id,
    'guests_see', c.payload = v_code, 'changed_from_last', v_prev is distinct from v_code);
end $$;

-- One report per run that did work. Raises/clears lax.code.fetch (owner: Parker).
create or replace function public.lax_fetch_report(p_ok boolean, p_kind text, p_result text default null, p_error text default null,
  p_method text default null, p_expires timestamptz default null, p_facility text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s lax_fetch_state; v_missing boolean := not exists (select 1 from lax_parking_codes where valid_month = lax_month_now());
begin
  update lax_fetch_state set
    last_try_at = now(), last_kind = left(p_kind, 20), last_result = left(p_result, 400), last_error = left(p_error, 600),
    last_method = coalesce(p_method, last_method), last_expires = coalesce(p_expires, last_expires),
    facility = coalesce(p_facility, facility),
    last_ok_at = case when p_ok then now() else last_ok_at end,
    fails = case when p_ok then 0 else fails + 1 end, updated_at = now()
  where id returning * into s;

  if p_ok then
    perform bestly_raise('lax.code.fetch', 'resolved', 'info', null, 'Parker read Park My Share fine again.', 'turo');
  elsif p_kind = 'auth' then
    -- the one failure nobody but Jared can fix
    perform bestly_raise('lax.code.fetch', 'problem', 'warning', 'Parker: Park My Share turned down the saved login',
      'I can''t sign in to Park My Share to get the LAX garage code. Re-enter the login on Turo Watch > Settings > Park My Share and I''ll try again right away.' ||
      case when v_missing then ' Guests don''t have this month''s code yet.' else ' Guests still have a working code.' end,
      'turo', 'Re-enter the Park My Share login on Turo Watch > Settings');
  elsif s.fails >= 3 then
    perform bestly_raise('lax.code.fetch', 'problem', case when v_missing then 'error' else 'warning' end,
      'Parker: can''t get the LAX garage code from Park My Share',
      'Tried ' || s.fails || ' times in a row (' || coalesce(p_kind, 'error') || ': ' || left(coalesce(p_error, p_result, 'no detail'), 240) || '). ' ||
      'I retry on my own and switch to the browser when the app''s API fails. ' ||
      case when v_missing then 'Guests don''t have this month''s code yet: until I''m back, drop a screenshot on Turo Watch > Settings.'
           else 'Guests still have a working code.' end,
      'turo', null);
  end if;
  return to_jsonb(s);
end $$;

revoke all on function public.lax_fetch_gate(), public.lax_fetch_save(text, timestamptz, text, text),
  public.lax_fetch_report(boolean, text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.lax_fetch_gate(), public.lax_fetch_save(text, timestamptz, text, text),
  public.lax_fetch_report(boolean, text, text, text, text, timestamptz, text) to service_role;

-- ------------------------------------------------------------------ admin side
create or replace function public.lax_fetch_admin()
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
declare s lax_fetch_state; v_e timestamptz; v_p timestamptz; j pi_jobs;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  select * into s from lax_fetch_state where id;
  select updated_at into v_e from vault.secrets where name = 'pi:parkmyshare:email';
  select updated_at into v_p from vault.secrets where name = 'pi:parkmyshare:password';
  select * into j from pi_jobs where job = 'lax_code_fetch';
  return jsonb_build_object(
    'configured', v_e is not null and v_p is not null, 'email_at', v_e, 'password_at', v_p,
    'run_now_pending', s.run_now_at is not null and (s.last_try_at is null or s.run_now_at > s.last_try_at),
    'last_try_at', s.last_try_at, 'last_ok_at', s.last_ok_at, 'last_saved_at', s.last_saved_at,
    'last_kind', s.last_kind, 'last_result', s.last_result, 'last_error', s.last_error, 'last_method', s.last_method,
    'last_expires', s.last_expires, 'facility', s.facility, 'fails', s.fails,
    'job_seen_at', j.last_run_at, 'job_ok', j.last_ok);
end $$;

create or replace function public.lax_fetch_connect(p_email text default null, p_password text default null)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_pw text := coalesce(p_password, ''); v_id uuid;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if v_email = '' and v_pw = '' then raise exception 'Add the email or the password'; end if;
  if v_email <> '' then
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'That doesn''t look like an email address'; end if;
    select id into v_id from vault.secrets where name = 'pi:parkmyshare:email';
    if v_id is null then perform vault.create_secret(v_email, 'pi:parkmyshare:email', 'Parker: Park My Share login email (saved from Turo Watch)');
    else perform vault.update_secret(v_id, v_email, 'pi:parkmyshare:email'); end if;
  end if;
  if v_pw <> '' then
    if length(v_pw) > 200 then raise exception 'Password is too long'; end if;
    v_id := null;
    select id into v_id from vault.secrets where name = 'pi:parkmyshare:password';
    if v_id is null then perform vault.create_secret(v_pw, 'pi:parkmyshare:password', 'Parker: Park My Share login password (saved from Turo Watch)');
    else perform vault.update_secret(v_id, v_pw, 'pi:parkmyshare:password'); end if;
  end if;
  update lax_fetch_state set run_now_at = now(), fails = 0, updated_at = now() where id;   -- try it right away
  return lax_fetch_admin();
end $$;

create or replace function public.lax_fetch_run_now()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update lax_fetch_state set run_now_at = now(), updated_at = now() where id;
  return lax_fetch_admin();
end $$;

revoke all on function public.lax_fetch_admin(), public.lax_fetch_connect(text, text), public.lax_fetch_run_now() from public, anon;
grant execute on function public.lax_fetch_admin(), public.lax_fetch_connect(text, text), public.lax_fetch_run_now() to authenticated;

-- ------------------------------------------------------------------ watchdog + self-heal (pg_cron, every 30 min)
create or replace function public.lax_fetch_watch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s lax_fetch_state; j pi_jobs; v_month_start timestamptz := (lax_month_now()::timestamp at time zone 'America/Los_Angeles');
  v_missing boolean := not exists (select 1 from lax_parking_codes where valid_month = lax_month_now()); out jsonb := '{}'::jsonb;
begin
  if not lax_fetch_configured() then return jsonb_build_object('configured', false); end if;
  select * into s from lax_fetch_state where id;
  select * into j from pi_jobs where job = 'lax_code_fetch';
  -- self-heal: this month's code is missing and nothing has tried in 40 min -> ask the Pi to try now
  if v_missing and (s.last_try_at is null or s.last_try_at < now() - interval '40 minutes')
     and (s.run_now_at is null or s.run_now_at < now() - interval '40 minutes') then
    update lax_fetch_state set run_now_at = now(), updated_at = now() where id;
    out := out || '{"nudged": true}';
  end if;
  -- the Pi job itself went quiet (pi_jobs_watch also catches this; this one says what it means for guests)
  if j.job is not null and (j.last_run_at is null or j.last_run_at < now() - interval '2 hours') then
    perform bestly_raise('lax.code.fetch', 'problem', case when v_missing then 'error' else 'warning' end,
      'Parker: the Pi isn''t running my Park My Share check',
      'No run since ' || coalesce(to_char(j.last_run_at at time zone 'America/Los_Angeles', 'FMMon FMDD FMHH12:MI AM'), 'never') ||
      '. Check the crontab line "run.sh lax_code_fetch" on bestly-pi.' ||
      case when v_missing then ' Guests don''t have this month''s code yet.' else '' end, 'turo', null);
    out := out || '{"pi_quiet": true}';
  elsif not v_missing and s.fails = 0 then
    perform bestly_raise('lax.code.fetch', 'resolved', 'info', null, 'Parker is running and guests have a current code.', 'turo');
  end if;
  -- still missing 6 hours into the month after retries: guests at the garage would be stuck
  if v_missing and now() > v_month_start + interval '6 hours' and s.fails >= 1 then
    perform bestly_raise('lax.code.fetch', 'problem', 'error', 'Parker: no LAX garage code for this month yet',
      'Park My Share hasn''t given me an active code for ' || trim(to_char(lax_month_now(), 'FMMonth')) || ' (' ||
      coalesce(s.last_kind, '?') || ': ' || left(coalesce(s.last_error, s.last_result, 'no detail'), 200) || '). ' ||
      'I keep trying every 30 minutes. If a guest picks up at LAX soon, drop a screenshot on Turo Watch > Settings.', 'turo', null);
    out := out || '{"missing_alert": true}';
  end if;
  return out;
end $$;
revoke all on function public.lax_fetch_watch() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'lax-fetch-watch';
select cron.schedule('lax-fetch-watch', '7,37 * * * *', 'select public.lax_fetch_watch()');

-- The old daily reminder told Jared to fetch the code himself. With Parker connected and healthy it stays quiet;
-- it still speaks up if Parker isn't set up or has failed 3+ times in a row.
create or replace function public.lax_pass_reminder()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_month date := lax_month_now();
  v_last date := (v_month + interval '1 month' - interval '1 day')::date;
  v_next date := (v_month + interval '1 month')::date;
  v_has_now boolean := exists (select 1 from lax_parking_codes where valid_month = v_month);
  v_has_next boolean := exists (select 1 from lax_parking_codes where valid_month = v_next);
  v_mname text := trim(to_char(v_month, 'FMMonth'));
  v_nname text := trim(to_char(v_next, 'FMMonth'));
begin
  if lax_fetch_configured() and coalesce((select fails from lax_fetch_state where id), 0) < 3 then return; end if;
  if v_today = v_last and not v_has_next then
    perform lax_pass_alert('expires-' || to_char(v_month, 'YYYY-MM'),
      'LAX parking code expires tonight',
      'The ' || v_mname || ' Park My Share QR stops working at midnight. The ' || v_nname || ' code is issued tomorrow (the 1st). Grab it from the portal and drop it in, and guests plus saved Wallet passes update on their own.',
      'warning');
  end if;
  if not v_has_now and exists (select 1 from lax_parking_codes) then
    perform lax_pass_alert('expired-' || to_char(v_today, 'YYYY-MM-DD'),
      'LAX parking code expired. Upload the ' || v_mname || ' one',
      'Guests are still seeing last month''s QR, which the garage no longer accepts. Grab the ' || v_mname || ' code from the Park My Share portal and drop it in.',
      'critical');
  end if;
end $$;

-- ------------------------------------------------------------------ Pi watchdog row + team card
insert into public.pi_jobs (job, description, max_gap_min, enabled) values
 ('lax_code_fetch', 'Parker: reads the active LAX garage QR from Park My Share (API, browser fallback) every 30 min when due, free, no AI', 75, true)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, enabled = true;

select public.team_onboard($j$[
 {"slug":"lax-code-fetch","name":"Parker","role":"Parking Pass Clerk","reports_to":"lax-concierge","dept":"turo","runs_on":"pi","icon":"qr-code",
  "schedule":"Every 30 min when a check is due (daily, month-end, or code missing)","admin_url":"/admin/turo#settings","welcome":false,
  "what_it_does":"Gets the LAX garage QR from Park My Share by itself and sends it to guests and Wallet passes.",
  "pulse":{"src":"pi_job","key":"lax_code_fetch","gap":75,"alert":true,"also":["lax-fetch-watch","lax-pass-reminder"]},
  "owns":["lax.code"]}
]$j$::jsonb);

insert into public.notification_owners (prefix, agent_slug, note)
values ('lax.code', 'lax-code-fetch', 'Parker: LAX garage code from Park My Share (login, missing code, Pi job quiet)')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;
