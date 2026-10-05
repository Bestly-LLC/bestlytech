-- Calendar logins, appointment length/constraints, and the two-line recording + assistant check (2026-10-05).
--
-- 1. Vault allowlist. Reading (ava_secret, service role only) now also allows the names the Calendars card writes
--    (ava_caldav_icloud_user / _pass, ava_caldav_nextcloud_user / _pass) and the Nextcloud login Bestly already keeps in Vault
--    (nextcloud_base_url, nextcloud_user, nextcloud_app_password), which the calendar code reads server-side only, never printed.
--    The old wall_icloud_* secrets are NOT on the list: they are not reused without Jared's OK.
--    Writing (ava_secret_put, service role only) allows the ava_caldav_* names plus the earlier setup names.
-- 2. ava_cal_secret_put / ava_cal_secret_status: admin-only RPCs behind the Calendars card. The password goes from the browser straight
--    into Vault; nothing is ever read back (status returns only true/false per field).
-- 3. ava_calls.appt_duration_min / appt_constraints from the post-call analysis, carried onto the "Find times" action.
-- 4. ava_impersonation_check: an inbound or forwarded call must have the recording notice in her first TWO lines, and a forwarded call (the
--    voice may be Jared's clone) must also say "assistant" in them. "I'm Jared" / "this is Jared" is still flagged. Outbound keeps the
--    disclosure rule. Calls where she only got one line in (caller hung up) are not judged.

create or replace function public.ava_secret(p_name text)
returns text language plpgsql stable security definer set search_path = public, vault as $$
begin
  if p_name not in ('elevenlabs_api_key', 'telnyx_api_key', 'ava_webhook_secret', 'ava_sip_password', 'ava_init_secret', 'rg_init_secret',
                    'ava_caldav_icloud_user', 'ava_caldav_icloud_pass', 'ava_caldav_nextcloud_user', 'ava_caldav_nextcloud_pass',
                    'nextcloud_base_url', 'nextcloud_user', 'nextcloud_app_password') then
    raise exception 'ava_secret: % is not an Ava secret', p_name;
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1);
end $$;

create or replace function public.ava_secret_put(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if p_name not in ('ava_webhook_secret', 'ava_sip_password', 'ava_init_secret', 'rg_init_secret',
                    'ava_caldav_icloud_user', 'ava_caldav_icloud_pass', 'ava_caldav_nextcloud_user', 'ava_caldav_nextcloud_pass') then
    raise exception 'ava_secret_put: % not allowed', p_name;
  end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then perform vault.create_secret(p_value, p_name, 'Ava assistant: set from the admin form or by setup');
  else perform vault.update_secret(v_id, p_value); end if;
end $$;

-- the Calendars card writes here (admin session only)
create or replace function public.ava_cal_secret_put(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_name not in ('ava_caldav_icloud_user', 'ava_caldav_icloud_pass', 'ava_caldav_nextcloud_user', 'ava_caldav_nextcloud_pass') then
    raise exception 'not a calendar login field';
  end if;
  if p_value is null or btrim(p_value) = '' or length(p_value) > 200 then raise exception 'empty or too long'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then perform vault.create_secret(btrim(p_value), p_name, 'Ava calendars: set from the Calendars card');
  else perform vault.update_secret(v_id, btrim(p_value)); end if;
end $$;
revoke execute on function public.ava_cal_secret_put(text, text) from public, anon;
grant execute on function public.ava_cal_secret_put(text, text) to authenticated;

-- which fields hold a value (booleans only; never the value)
create or replace function public.ava_cal_secret_status()
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'icloud_user', exists (select 1 from vault.decrypted_secrets where name = 'ava_caldav_icloud_user' and coalesce(decrypted_secret, '') <> ''),
    'icloud_pass', exists (select 1 from vault.decrypted_secrets where name = 'ava_caldav_icloud_pass' and coalesce(decrypted_secret, '') <> ''),
    'nextcloud_override', exists (select 1 from vault.decrypted_secrets where name = 'ava_caldav_nextcloud_pass' and coalesce(decrypted_secret, '') <> ''),
    'nextcloud_shared', exists (select 1 from vault.decrypted_secrets where name = 'nextcloud_app_password' and coalesce(decrypted_secret, '') <> '')
      and exists (select 1 from vault.decrypted_secrets where name = 'nextcloud_user' and coalesce(decrypted_secret, '') <> ''));
end $$;
revoke execute on function public.ava_cal_secret_status() from public, anon;
grant execute on function public.ava_cal_secret_status() to authenticated;

-- appointment length and constraints from the post-call analysis
alter table public.ava_calls
  add column if not exists appt_duration_min integer,
  add column if not exists appt_constraints text;

create or replace function public.ava_calls_actions_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.intent is not null and new.direction = 'inbound' and coalesce(new.is_spam, false) = false and new.deleted_at is null then
    perform ava_actions_make('ava', new.id, new.intent, coalesce(new.counterpart_phone, new.callback_number, new.phone), new.caller_name,
                             new.counterpart_business, coalesce(new.message, new.summary), new.appointment_purpose, new.preferred_times);
    -- what the caller said about length and availability rides on the "Find times" action
    update ava_actions set payload = payload || jsonb_build_object('appt_duration_min', coalesce(new.appt_duration_min, 60),
        'appt_constraints', coalesce(nullif(btrim(new.appt_constraints), ''), nullif(btrim(new.preferred_times), '')))
     where source = 'ava' and call_id = new.id and kind = 'find_times' and status = 'open';
  end if;
  return new;
exception when others then
  raise warning 'ava_calls_actions_trg failed: %', sqlerrm;
  return new;
end $function$;

create or replace function public.ava_impersonation_check(p_call_id uuid, p_call_no bigint, p_transcript jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer; v_first text; v_hit text; v_why text; v_excerpt text; v_llm text; v_new boolean; v_fwd boolean := false; v_dir text;
begin
  select count(*) into v_n from jsonb_array_elements(coalesce(p_transcript, '[]'::jsonb)) e
   where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '';
  if v_n = 0 then return; end if;
  select coalesce(forwarded, false), direction into v_fwd, v_dir from ava_calls where id = p_call_id;

  select string_agg(msg, ' ' order by ord) into v_first from (
    select coalesce(e->>'message', '') as msg, ord from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
     where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '' order by ord limit 2) f;
  select left(coalesce(e->>'message', ''), 200) into v_hit from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
   where e->>'role' = 'agent' and coalesce(e->>'message', '') ~* '\m(this is|i''m|i am) jared(?![''’]s)\M'
   order by ord limit 1;

  if v_dir = 'outbound' then
    if v_first !~* '(\mai\M|artificial|\massistant\M)' then
      v_why := 'no disclosure in her first two lines'; v_excerpt := left(v_first, 200);
    end if;
  elsif v_n >= 2 then
    -- inbound / forwarded: short opener, then the recording notice on her next turn. A forwarded call may be in his voice, so it also needs "assistant".
    if v_first !~* '\mrecord(ed|ing|s)?\M' then
      v_why := 'no recording notice in her first two lines'; v_excerpt := left(v_first, 200);
    elsif v_fwd and v_first !~* '\massistant\M' then
      v_why := 'forwarded call without "assistant" in her first two lines'; v_excerpt := left(v_first, 200);
    end if;
  end if;
  if v_hit is not null then
    v_why := coalesce(v_why || ' and ', '') || 'she said she was Jared'; v_excerpt := v_hit;
  end if;
  if v_why is null then return; end if;

  select llm into v_llm from ava_settings where id;
  insert into ava_reply_incidents (source, call_id, call_no, kind, subkind, excerpt, llm, healed)
  values ('ava', p_call_id, p_call_no, 'repeat', 'impersonation', v_excerpt, v_llm, 'voice mode switched off')
  on conflict (call_id, kind) do nothing
  returning true into v_new;
  if v_new is null then
    update ava_reply_incidents set excerpt = coalesce(excerpt, '') || ' | Voice mode: ' || v_why, healed = coalesce(healed, 'voice mode switched off')
     where call_id = p_call_id and kind = 'repeat' and coalesce(excerpt, '') not like '%Voice mode:%';
  end if;

  update ava_settings set jared_voice_paused_at = now(), jared_voice_paused_why = left('Call #' || coalesce(p_call_no::text, '?') || ': ' || v_why, 200)
   where id and jared_voice_paused_at is null;

  perform scout_notify('Ava (assistant): voice mode broke the rules on call #' || coalesce(p_call_no::text, '?'),
    'Speaking in your voice, ' || v_why || '. Voice mode is off until you turn it back on at /admin/ava.', 'warning', true,
    'https://bestly.tech/admin/ava', 'ava-impersonation-' || p_call_id::text);
exception when others then
  raise warning 'ava_impersonation_check failed: %', sqlerrm;
end $function$;
revoke execute on function public.ava_impersonation_check(uuid, bigint, jsonb) from public, anon, authenticated;

-- Ava's team card (same slug: updates in place). No new cron: the calendar check rides on ava-watch.
select public.team_onboard($j$[
 {"slug":"ava","name":"Ava","role":"Personal Assistant","reports_to":"jared","dept":"desk","runs_on":"cloud","icon":"hand-helping","welcome":false,
  "schedule":"answers (816) 429-9495 any time","admin_url":"/admin/ava","sort":5,
  "what_it_does":"Answers your personal line, (816) 429-9495, and the calls you miss on your own cell, casually, with a quick recording notice on her second line. Takes messages, makes calls for you, and can connect a call to your cell. After each call she suggests the next step as a button on the message: Find times, Call back, Reply by call, Mark done. Find times reads your iCloud and Nextcloud calendars (free or busy only, never the details; a Turo trip blocks only an hour around pickup and return) and lists up to six open slots inside your hours. Nothing dials until you tap a slot and confirm; then she calls the person back, offers that time with two backups, and when they agree she adds it to the calendar you marked. Checks the calendar logins from ava-watch (alert: Ava (assistant): can't read your calendar, which also greys out Find times) and reports bookings (Ava (assistant): booked your ... for ...). Plays along with spam callers for up to two minutes and tracks each company for Do Not Call claims.",
  "pulse":{"src":"at","table":"ava_line_health","col":"checked_at","ok":"ok","sum":"case when ok then 'Line OK' else 'Line problem' end","where":"source = 'ava'","gap":30,"alert":true,"also":["ava-watch","ava-followups"]},
  "owns":["ava"]}
]$j$::jsonb);
