-- Scout free-AI fallback (branch scout-free-fallback, 2026-10-27). NOT APPLIED: a migration FILE only, applied at rollout.
--
-- Jared: "Scout should never [just say free AI is out of room]. He should be switching providers, and if he's out, he should
-- suggest a new one for me to connect." The code side is supabase/functions/_shared/free-llm.ts + free-llm-status.ts (+ admin-chat).
-- This file is the database side:
--   1. llm_providers.outage_note        a plain-words reason a human (or an incident) writes for a long outage; Scout quotes it, never invents it
--   2. llm_provider_candidates          the ordered list of vetted no-training free providers (mirror of CANDIDATES in free-llm-status.ts)
--   3. llm_keys() / _llm_key_store()    accept the candidates' Vault key names (sambanova_api_key, cerebras_api_key)
--   4. llm_candidates_autoconnect()     when Jared saves a candidate's key in Vault, the provider row is created (enabled, private_ok) by itself
--   5. scout_provider_offline_watch()   a provider dark for 1 hour or more raises an alert signed by Scout (key scout.provider_offline.<name>)
--   6. scout_free_fallback_selftest()   watchdog: the offline alert fires, the alert path works, candidates exist; bestly_raise on failure
--   7. cron lines, commented: enable at rollout
-- Alert owner: notification_owners prefix "scout" -> Scout, so every key below is signed by Scout.
-- UNDO is at the bottom.

-- 1. outage note ----------------------------------------------------------------------------------------------------------------
alter table public.llm_providers add column if not exists outage_note text;
comment on column public.llm_providers.outage_note is
  'Plain-words reason for a long outage, written by a person or an incident (e.g. the Pi is down until its new drive arrives). Scout quotes it in the out-of-room reply; the offline watch clears it once the provider answers again.';

create or replace function public.llm_provider_outage_set(p_name text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.llm_providers set outage_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where name = p_name;
  if not found then raise exception 'unknown llm provider: %', p_name; end if;
  return jsonb_build_object('ok', true, 'name', p_name, 'outage_note', nullif(trim(coalesce(p_note, '')), ''));
end $$;
revoke all on function public.llm_provider_outage_set(text, text) from public, anon, authenticated;
grant execute on function public.llm_provider_outage_set(text, text) to service_role;
-- At rollout, for the Hestia outage (text is data, not code):
--   select public.llm_provider_outage_set('freellm', 'down until Hestia is rebuilt on its new drive (arrives Wed Oct 28, 1 to 4 PM)');

-- 2. candidates -----------------------------------------------------------------------------------------------------------------
create table if not exists public.llm_provider_candidates (
  name text primary key,
  rank int not null,
  label text not null,
  kind text not null check (kind in ('free', 'trial')),
  key_name text not null unique,
  key_url text not null,
  base_url text not null,
  model text not null,
  daily_cap int not null,
  why text not null,
  free_tier text not null,
  policy_urls text[] not null,
  checked date not null,
  status text not null default 'candidate' check (status in ('candidate', 'connected', 'rejected')),
  updated_at timestamptz not null default now()
);
alter table public.llm_provider_candidates enable row level security;
revoke all on public.llm_provider_candidates from anon, authenticated;

insert into public.llm_provider_candidates (name, rank, label, kind, key_name, key_url, base_url, model, daily_cap, why, free_tier, policy_urls, checked) values
  ('sambanova', 1, 'SambaNova Cloud', 'free', 'sambanova_api_key', 'https://cloud.sambanova.ai/apis',
   'https://api.sambanova.ai/v1/chat/completions', 'gpt-oss-120b', 18,
   'its terms limit use of your prompts to answering you and nothing else (no training), and the free plan needs no credit card',
   'no card needed; 20 requests a minute, 20 a day, 200,000 tokens a day, on gpt-oss-120b, Llama 3.3 70B and DeepSeek V3.1',
   array['https://sambanova.ai/hubfs/23945802/PubSec/fast-api-program-tos.pdf', 'https://community.sambanova.ai/t/data-handling-and-retention/1314', 'https://docs.sambanova.ai/docs/en/models/rate-limits'],
   '2026-10-27'),
  ('cerebras', 2, 'Cerebras', 'trial', 'cerebras_api_key', 'https://cloud.cerebras.ai',
   'https://api.cerebras.ai/v1/chat/completions', 'gpt-oss-120b', 400,
   'its terms say it gets no right to train on your prompts and its privacy policy says it keeps no inputs or outputs',
   'a $5 trial credit for 30 days (needs a card on file), then pay as you go; gpt-oss-120b gets 1,000,000 tokens a day while it lasts',
   array['https://www.cerebras.ai/terms-of-service', 'https://www.cerebras.ai/privacy-policy', 'https://inference-docs.cerebras.ai/support/rate-limits'],
   '2026-10-27')
on conflict (name) do nothing;

-- 3. keys: the same Vault whitelist as before, plus the candidates' key names -----------------------------------------------------
create or replace function public.llm_keys()
returns jsonb language sql stable security definer set search_path = public, vault as $$
  -- 2026-10-03: Jared saved the FreeLLM key as "Scout-FreeLLM"; accept it as freellm_api_key.
  -- 2026-10-27: plus the key names in llm_provider_candidates (sambanova_api_key, cerebras_api_key).
  select coalesce(jsonb_object_agg(case when name = 'Scout-FreeLLM' then 'freellm_api_key' else name end, decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets
   where name in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id','gemini_api_key','openrouter_api_key','freellm_api_key','freellm_base_url','Scout-FreeLLM')
      or name in (select key_name from public.llm_provider_candidates);
$$;

create or replace function public._llm_key_store(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid; v_cand text;
begin
  select name into v_cand from public.llm_provider_candidates where key_name = p_name;
  if p_name not in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id','gemini_api_key','openrouter_api_key') and v_cand is null then
    raise exception 'llm key name not allowed: %', p_name;
  end if;
  if coalesce(length(trim(p_value)), 0) < 8 then raise exception 'empty key'; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(trim(p_value), p_name, 'free-llm provider key (docs/scout-free-llm-opusplan.md)');
  else
    perform vault.update_secret(v_id, trim(p_value));
  end if;
  update public.llm_providers set cooldown_until = null, cooldown_reason = null, updated_at = now()
   where name = coalesce(v_cand, case when p_name like 'groq%' then 'groq' when p_name like 'cloudflare%' then 'cloudflare'
                                       when p_name like 'gemini%' then 'gemini' else 'openrouter' end);
end $$;
revoke all on function public._llm_key_store(text, text) from public, anon, authenticated;

-- 4. autoconnect: key saved in Vault -> provider row appears, enabled, private_ok (these are vetted no-training providers) ----------
create or replace function public.llm_candidates_autoconnect()
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare c record; v_done text[] := '{}';
begin
  for c in select * from public.llm_provider_candidates where status = 'candidate' order by rank loop
    if exists (select 1 from vault.secrets where name = c.key_name) then
      insert into public.llm_providers (name, enabled, private_ok, daily_cap, note)
        values (c.name, true, true, c.daily_cap, c.label || ': connected automatically ' || now()::date || '. No-training policy: ' || c.policy_urls[1])
        on conflict (name) do update set enabled = true, private_ok = true, daily_cap = excluded.daily_cap,
          cooldown_until = null, cooldown_reason = null, updated_at = now();
      update public.llm_provider_candidates set status = 'connected', updated_at = now() where name = c.name;
      v_done := array_append(v_done, c.name);
    end if;
  end loop;
  return jsonb_build_object('connected', to_jsonb(v_done));
end $$;
revoke all on function public.llm_candidates_autoconnect() from public, anon, authenticated;
grant execute on function public.llm_candidates_autoconnect() to service_role;

-- 5. offline watch --------------------------------------------------------------------------------------------------------------
create or replace function public._llm_pt_when(p_ts timestamptz)
returns text language sql stable as $$
  select case
           when (p_ts at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date then 'today at '
           when (p_ts at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date - 1 then 'yesterday at '
           else to_char(p_ts at time zone 'America/Los_Angeles', 'Mon FMDD') || ' at '
         end || to_char(p_ts at time zone 'America/Los_Angeles', 'FMHH12:MI AM');
$$;

-- A provider that has not answered for 1 hour or more AND is failing because it cannot be reached (not because it is rate-limited)
-- raises scout.provider_offline.<name>, signed by Scout. p_rows lets the self-test hand in made-up rows (always a dry run).
create or replace function public.scout_provider_offline_watch(p_rows jsonb default null, p_dry boolean default false, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v_dry boolean := p_dry or p_rows is not null;
  v_raise text[] := '{}'; v_clear text[] := '{}';
  v_key text; v_err_at timestamptz; v_kind text; v_unreach boolean; v_down boolean; v_label text; v_cause text; v_body text;
begin
  for r in
    select * from jsonb_to_recordset(coalesce(p_rows, (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.llm_providers p)))
      as x(name text, enabled boolean, private_ok boolean, last_ok_at timestamptz, last_error text, cooldown_until timestamptz, cooldown_reason text, outage_note text)
  loop
    continue when r.name = 'anthropic';
    v_key := 'scout.provider_offline.' || r.name;
    v_label := case r.name when 'freellm' then 'The Pi''s free AI (FreeLLM)' when 'local' then 'The Mac mini''s local AI' when 'groq' then 'Groq'
                           when 'cloudflare' then 'Cloudflare' else r.name end;
    v_err_at := nullif(substring(coalesce(r.last_error, '') from '^(\d{4}-\d\d-\d\dT[\d:.]+Z)'), '')::timestamptz;
    v_kind := lower(coalesce(substring(coalesce(r.last_error, '') from '^\S+\s+([a-z_]+):'), ''));
    -- "cannot be reached": a recent connect/DNS/timeout/5xx error newer than the last success, or FreeLLM's own host watch keeping it paused
    v_unreach := (v_err_at is not null and r.last_ok_at is not null and v_err_at > r.last_ok_at and v_err_at > p_now - interval '3 hours'
                  and v_kind in ('timeout', 'error')
                  and r.last_error ~* '(error sending request|dns error|failed to lookup|connection (refused|reset)|timed? ?out|timeout|[^0-9]5\d\d[^0-9])')
              or (coalesce(r.cooldown_reason, '') ~* '^freellm_watch:' and r.cooldown_until is not null and r.cooldown_until > p_now - interval '30 minutes');
    v_down := coalesce(r.enabled, false) and coalesce(r.private_ok, false)
              and r.last_ok_at is not null and r.last_ok_at < p_now - interval '1 hour' and v_unreach;
    if v_down then
      v_cause := case when coalesce(r.last_error, '') || coalesce(r.cooldown_reason, '') ~* 'resolve host|dns error|failed to lookup' then 'The cloud cannot find it on the network.'
                      when coalesce(r.last_error, '') ~* 'refused|reset' then 'It refuses the connection.'
                      else 'The cloud cannot reach it.' end;
      v_body := coalesce(nullif(trim(coalesce(r.outage_note, '')), ''), v_cause)
        || ' Scout is answering from the other free providers meanwhile. If every free provider runs out, Scout names one new no-training free provider to connect.';
      v_raise := array_append(v_raise, v_key);
      if not v_dry then
        perform public.bestly_raise(v_key, 'problem', 'warning',
          v_label || ' has been offline since ' || public._llm_pt_when(r.last_ok_at), v_body, 'ai', null, false);
      end if;
    else
      if exists (select 1 from public.monitor_issues where key = v_key and status = 'open') then
        v_clear := array_append(v_clear, v_key);
        if not v_dry then
          perform public.bestly_raise(v_key, 'resolved', 'info', v_label || ' is answering again', null, 'ai', null, true);
        end if;
      end if;
      -- it answered in the last 10 minutes: whatever outage note was on it is over
      if not v_dry and coalesce(r.outage_note, '') <> '' and r.last_ok_at is not null and r.last_ok_at > p_now - interval '10 minutes' then
        update public.llm_providers set outage_note = null, updated_at = now() where name = r.name;
      end if;
    end if;
  end loop;
  return jsonb_build_object('would_raise', to_jsonb(v_raise), 'cleared', to_jsonb(v_clear), 'dry', v_dry);
end $$;
revoke all on function public.scout_provider_offline_watch(jsonb, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.scout_provider_offline_watch(jsonb, boolean, timestamptz) to service_role;

-- 6. self-test watchdog ---------------------------------------------------------------------------------------------------------
-- Proves, with made-up rows, that a Pi dark for 2 hours WOULD raise the Scout-signed alert (and a healthy provider, a rate-limited one and a
-- deliberately-private-off one would not), that bestly_raise works end to end, and that the candidate list and key whitelist are in place.
-- The fallback MESSAGE is self-tested in the free-llm edge function (op fallback_selftest), which the cron below calls right after.
-- Any failure raises scout.free_fallback.selftest (signed by Scout); a pass resolves it.
create or replace function public.scout_free_fallback_selftest()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fail text[] := '{}'; r jsonb; v_n int; v_src text;
begin
  begin
    r := public.scout_provider_offline_watch(jsonb_build_array(
      jsonb_build_object('name', 'freellm', 'enabled', true, 'private_ok', true, 'last_ok_at', now() - interval '2 hours',
        'last_error', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ' error: error sending request for url (x): dns error: failed to lookup address'),
      jsonb_build_object('name', 'groq', 'enabled', true, 'private_ok', true, 'last_ok_at', now() - interval '3 hours',
        'last_error', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ' rate_limited: 429 rate limit'),
      jsonb_build_object('name', 'gemini', 'enabled', true, 'private_ok', false, 'last_ok_at', now() - interval '5 hours',
        'last_error', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ' error: timeout')
    ), true);
    if not ((r -> 'would_raise') ? 'scout.provider_offline.freellm') then v_fail := array_append(v_fail, 'a Pi dark for 2 hours would not raise its alert'); end if;
    if (r -> 'would_raise') ? 'scout.provider_offline.groq' then v_fail := array_append(v_fail, 'a rate-limited provider was treated as offline'); end if;
    if (r -> 'would_raise') ? 'scout.provider_offline.gemini' then v_fail := array_append(v_fail, 'a private-off provider raised an alert'); end if;
  exception when others then v_fail := array_append(v_fail, 'offline watch crashed: ' || sqlerrm);
  end;
  begin
    perform public.bestly_raise('scout.free_fallback.selftest_probe', 'problem', 'info', 'Scout free-AI fallback self-test', 'probe', 'ai', null, true);
    perform public.bestly_raise('scout.free_fallback.selftest_probe', 'resolved', 'info', 'Scout free-AI fallback self-test probe closed');
  exception when others then v_fail := array_append(v_fail, 'bestly_raise failed: ' || sqlerrm);
  end;
  select count(*) into v_n from public.llm_provider_candidates;
  if v_n < 1 then v_fail := array_append(v_fail, 'llm_provider_candidates is empty'); end if;
  select prosrc into v_src from pg_proc where proname = 'llm_keys' and pronamespace = 'public'::regnamespace;
  if coalesce(v_src, '') not like '%llm_provider_candidates%' then v_fail := array_append(v_fail, 'llm_keys() does not list the candidate keys'); end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'llm_providers' and column_name = 'outage_note') then
    v_fail := array_append(v_fail, 'llm_providers.outage_note is missing');
  end if;
  if array_length(v_fail, 1) > 0 then
    perform public.bestly_raise('scout.free_fallback.selftest', 'problem', 'warning', 'Scout''s free-AI fallback self-test failed',
      array_to_string(v_fail, '; '), 'ai', null, false);
  else
    perform public.bestly_raise('scout.free_fallback.selftest', 'resolved', 'info', 'Scout''s free-AI fallback self-test passes');
  end if;
  return jsonb_build_object('ok', coalesce(array_length(v_fail, 1), 0) = 0, 'failures', to_jsonb(v_fail));
end $$;
revoke all on function public.scout_free_fallback_selftest() from public, anon, authenticated;
grant execute on function public.scout_free_fallback_selftest() to service_role;

-- 7. cron: ENABLE AT ROLLOUT (commented on purpose) ---------------------------------------------------------------------------------
-- select cron.schedule('scout-provider-offline-watch', '8-59/10 * * * *', $$ select public.scout_provider_offline_watch(); select public.llm_candidates_autoconnect(); $$);
-- select cron.schedule('scout-free-fallback-selftest', '17 */6 * * *', $$ select public.scout_free_fallback_selftest(); select public.invoke_edge_function('free-llm', '{"op":"fallback_selftest"}'::jsonb, 60000); $$);

-- UNDO -------------------------------------------------------------------------------------------------------------------------
-- select cron.unschedule('scout-provider-offline-watch'); select cron.unschedule('scout-free-fallback-selftest');
-- drop function if exists public.scout_free_fallback_selftest();
-- drop function if exists public.scout_provider_offline_watch(jsonb, boolean, timestamptz);
-- drop function if exists public._llm_pt_when(timestamptz);
-- drop function if exists public.llm_candidates_autoconnect();
-- drop function if exists public.llm_provider_outage_set(text, text);
-- -- put llm_keys() and _llm_key_store() back exactly as they were before this file:
-- create or replace function public.llm_keys() returns jsonb language sql stable security definer set search_path = public, vault as $f$
--   select coalesce(jsonb_object_agg(case when name = 'Scout-FreeLLM' then 'freellm_api_key' else name end, decrypted_secret), '{}'::jsonb)
--     from vault.decrypted_secrets
--    where name in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id','gemini_api_key','openrouter_api_key','freellm_api_key','freellm_base_url','Scout-FreeLLM');
-- $f$;
-- create or replace function public._llm_key_store(p_name text, p_value text) returns void language plpgsql security definer set search_path = public, vault as $f$
-- declare v_id uuid;
-- begin
--   if p_name not in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id','gemini_api_key','openrouter_api_key') then raise exception 'llm key name not allowed: %', p_name; end if;
--   if coalesce(length(trim(p_value)), 0) < 8 then raise exception 'empty key'; end if;
--   select id into v_id from vault.secrets where name = p_name;
--   if v_id is null then perform vault.create_secret(trim(p_value), p_name, 'free-llm provider key (docs/scout-free-llm-opusplan.md)');
--   else perform vault.update_secret(v_id, trim(p_value)); end if;
--   update public.llm_providers set cooldown_until = null, cooldown_reason = null, updated_at = now()
--    where name = case when p_name like 'groq%' then 'groq' when p_name like 'cloudflare%' then 'cloudflare' when p_name like 'gemini%' then 'gemini' else 'openrouter' end;
-- end $f$;
-- -- providers a candidate key already created (only if you want them gone):  delete from public.llm_providers where name in (select name from public.llm_provider_candidates where status = 'connected');
-- drop table if exists public.llm_provider_candidates;
-- alter table public.llm_providers drop column if exists outage_note;
-- -- open alerts: update public.monitor_issues set status = 'resolved', resolved_at = now() where key like 'scout.provider_offline.%' or key like 'scout.free_fallback.%';
