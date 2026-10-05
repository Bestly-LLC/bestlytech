-- Ava's calendars + the shorter forwarded-call greeting (2026-10-05).
--
-- 1. Calendar credentials live ONLY in Vault. The existing allowlisted ava_secret / ava_secret_put get four more names:
--    nextcloud_caldav_user, nextcloud_caldav_app_password, icloud_apple_id, icloud_app_password.
--    Jared types each one into the Calendars card on /admin/ava; the ava-assistant edge function (admin JWT) writes it straight to Vault.
--    Neither function is callable by the browser: service role only, as before.
-- 2. ava_settings.calendars (jsonb): which calendars count for free/busy, which one Ava books on, the hours she offers, the last checks.
-- 3. Greeting change: forwarded calls now open with "Hey, Jared's phone. What's up?" and the recording notice comes right after the
--    caller's first reply. The impersonation guard now asks for the recording notice within her first THREE lines (not "assistant"
--    in the first two) and still flags "this is Jared" / "I'm Jared". Calls that are not forwarded keep the disclosure rule.

create or replace function public.ava_secret(p_name text)
returns text language plpgsql stable security definer set search_path = public, vault as $$
begin
  if p_name not in ('elevenlabs_api_key', 'telnyx_api_key', 'ava_webhook_secret', 'ava_sip_password', 'ava_init_secret', 'rg_init_secret',
                    'nextcloud_caldav_user', 'nextcloud_caldav_app_password', 'icloud_apple_id', 'icloud_app_password') then
    raise exception 'ava_secret: % is not an Ava secret', p_name;
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1);
end $$;

create or replace function public.ava_secret_put(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if p_name not in ('ava_webhook_secret', 'ava_sip_password', 'ava_init_secret', 'rg_init_secret',
                    'nextcloud_caldav_user', 'nextcloud_caldav_app_password', 'icloud_apple_id', 'icloud_app_password') then
    raise exception 'ava_secret_put: % not allowed', p_name;
  end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then perform vault.create_secret(p_value, p_name, 'Ava assistant: set from the admin form or by setup');
  else perform vault.update_secret(v_id, p_value); end if;
end $$;

alter table public.ava_settings add column if not exists calendars jsonb not null default '{}'::jsonb;

create or replace function public.ava_impersonation_check(p_call_id uuid, p_call_no bigint, p_transcript jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer; v_first text; v_first3 text; v_hit text; v_why text; v_excerpt text; v_llm text; v_new boolean; v_fwd boolean := false;
begin
  select count(*) into v_n from jsonb_array_elements(coalesce(p_transcript, '[]'::jsonb)) e
   where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '';
  if v_n = 0 then return; end if;
  select coalesce(forwarded, false) into v_fwd from ava_calls where id = p_call_id;

  select string_agg(msg, ' ' order by ord) into v_first from (
    select coalesce(e->>'message', '') as msg, ord from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
     where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '' order by ord limit 2) f;
  select string_agg(msg, ' ' order by ord) into v_first3 from (
    select coalesce(e->>'message', '') as msg, ord from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
     where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '' order by ord limit 3) f;
  select left(coalesce(e->>'message', ''), 200) into v_hit from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
   where e->>'role' = 'agent' and coalesce(e->>'message', '') ~* '\m(this is|i''m|i am) jared(?![''’]s)\M'
   order by ord limit 1;

  if v_fwd then
    -- forwarded: the short opener has no disclosure by design; California needs the recording notice, so it must come within her first three lines
    if v_first3 !~* '\mrecord(ed|ing|s)?\M' then
      v_why := 'forwarded call without the recording notice in her first three lines'; v_excerpt := left(v_first3, 200);
    end if;
  elsif v_first !~* '(\mai\M|artificial|\massistant\M)' then
    v_why := 'no disclosure in her first two lines'; v_excerpt := left(v_first, 200);
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
    'Speaking in your voice, ' || v_why || '. Voice mode is off until you turn it back on at /admin/ava.', 'high', true,
    'https://bestly.tech/admin/ava', 'ava-impersonation-' || p_call_id::text);
exception when others then
  raise warning 'ava_impersonation_check failed: %', sqlerrm;
end $function$;
revoke execute on function public.ava_impersonation_check(uuid, bigint, jsonb) from public, anon, authenticated;
