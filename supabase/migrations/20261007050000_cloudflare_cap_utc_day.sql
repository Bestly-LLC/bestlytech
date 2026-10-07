-- 2026-10-06: Cloudflare free-cap counting follows Cloudflare's own day (00:00 UTC), not LA's.
--
-- Scout reported "Cloudflare is 34x over its 9,000 cap, nothing enforces it" and asked Jared to paste
-- cron.schedule('enforce-free-llm-cap', ...). Both were wrong:
--   * 307,990 was TOKENS; the cap is NEURONS. Tracked neurons sit at ~9,100/day: the ladder's
--     daily_cap check (free-llm.ts usedToday) was already enforcing it.
--   * free_llm_watch() already runs every 15 min (cron job free-llm-watch) and never paused capped
--     providers anyway, so the pasted job would only have doubled it.
-- The real defect: usedToday() and this watch counted from LA midnight (07:00 UTC) while the 10,000
-- free neurons reset at 00:00 UTC. So 5 PM-midnight PT skipped fresh free capacity, and after
-- midnight PT the evening's use was forgotten and calls ran into Cloudflare's own 429 wall.
-- Edge side (free-llm.ts): UTC day for Cloudflare, and a daily-allocation 429 now pauses until 00:00 UTC.

create or replace function public.free_llm_watch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'vault'
as $function$
declare
  r record; v_out jsonb := '[]'::jsonb;
  -- Cloudflare's free neurons reset at 00:00 UTC, so count its day from there.
  since_cf_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_cf numeric; v_paid int; v_free int; v_keys int; v_live int;
  v_capped int; v_models int;
begin
  -- 2026-09-30: rate_limited (429) is quota, not failure. The ladder already benches
  -- the model and moves on, so it no longer counts toward "is failing".
  for r in
    select p.name,
           count(s.id) as n,
           count(s.id) filter (where not s.ok
             and coalesce(s.outcome,'') !~* '^(error: empty reply|bad_json|invalid|error: 400|skipped|rate_limited)') as bad
      from llm_providers p left join ai_spend s on s.provider = p.name and s.at > now() - interval '1 hour'
     where p.enabled and p.name <> 'anthropic'
     group by p.name
  loop
    select count(*) into v_live from llm_providers
     where enabled and name in ('groq','cloudflare') and name <> r.name
       and (cooldown_until is null or cooldown_until < now());
    if r.n >= 3 and r.bad * 2 > r.n then
      if v_live > 0 then
        update llm_providers set cooldown_until = greatest(coalesce(cooldown_until, now()), now() + interval '15 minutes'),
               cooldown_reason = format('%s of %s calls failed in the last hour', r.bad, r.n), updated_at = now()
         where name = r.name;
        v_out := v_out || jsonb_build_object('cooldown', r.name);
      end if;
      perform bestly_raise('ai.free.' || r.name, 'problem', 'warning',
        'Free AI: ' || r.name || ' is failing',
        format('%s of %s calls failed in the last hour. %s', r.bad, r.n,
          case when v_live > 0 then 'Paused 15 min; Scout uses the next provider meanwhile.' else 'Not paused: it is the last free provider working.' end),
        'ai', null, true);
    elsif r.n >= 2 and r.bad = 0 then
      perform bestly_raise('ai.free.' || r.name, 'resolved', 'info', 'Free AI: ' || r.name || ' working again');
    end if;
  end loop;

  -- Groq daily cap: info only (200K tokens/day per model, rolling window).
  select count(distinct model) filter (where outcome ilike '%tokens per day%'),
         count(distinct model)
    into v_capped, v_models
    from ai_spend where provider = 'groq' and at > now() - interval '1 hour';
  if v_capped >= 2 then
    perform bestly_raise('ai.free.groq_cap', 'problem', 'info', 'Free AI: Groq used up today''s free tokens',
      format('%s of %s Groq models hit the 200K tokens/day free limit. Scout falls to Cloudflare / Mac mini / paid-with-yes until it refills.', v_capped, v_models),
      'ai', null, true);
  elsif v_models >= 1 and v_capped = 0 then
    perform bestly_raise('ai.free.groq_cap', 'resolved', 'info', null);
  end if;

  select coalesce(sum(free_units), 0) into v_cf from ai_spend where provider = 'cloudflare' and at >= since_cf_day;
  if v_cf > 8000 then
    perform bestly_raise('ai.free.cloudflare_cap', 'problem', 'info', 'Free AI: Cloudflare near today''s free limit',
      format('About %s of 10,000 free Neurons used today. Scout moves to the next provider at 9,000; it resets at 5 PM PT (00:00 UTC).', round(v_cf)), 'ai', null, true);
  else
    perform bestly_raise('ai.free.cloudflare_cap', 'resolved', 'info', null);
  end if;

  select count(*) filter (where provider = 'anthropic'),
         count(*) filter (where provider in ('groq','cloudflare','local'))
    into v_paid, v_free
    from ai_spend where ok and scope = 'background' and at > now() - interval '24 hours';
  if v_free > 0 and v_paid >= 4 and v_paid > v_free then
    perform bestly_raise('ai.free.fallback_high', 'problem', 'warning', 'Free AI: Scout is mostly paying',
      format('%s paid vs %s free background calls in 24 hours. The free providers are failing or skipped.', v_paid, v_free), 'ai');
  elsif v_paid <= v_free then
    perform bestly_raise('ai.free.fallback_high', 'resolved', 'info', null);
  end if;

  select count(*) into v_keys from vault.secrets where name in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id');
  if v_keys < 3 then
    perform bestly_raise('ai.free.keys', 'problem', 'info', 'Free AI: keys not set',
      'Scout runs on paid AI until the free keys are in Vault.', 'ai',
      'Add 3 Vault secrets in the Supabase dashboard (Integrations > Vault): groq_api_key, cloudflare_ai_token, cloudflare_account_id. Steps: docs/scout-free-llm-opusplan.md section 5.');
  else
    perform bestly_raise('ai.free.keys', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'actions', v_out, 'cloudflare_units', v_cf, 'paid_24h', v_paid, 'free_24h', v_free, 'keys', v_keys, 'groq_capped_models', v_capped);
end $function$;

-- Scout's manual pause (01:47 UTC) ran to 2026-10-08 00:00 UTC, a full extra day: Cloudflare had
-- already reset at 00:00 UTC. The ladder's UTC-day cap now guards it, so lift that one pause.
update public.llm_providers
   set cooldown_until = null, cooldown_reason = null, updated_at = now()
 where name = 'cloudflare' and cooldown_reason like 'Daily free cap hit%';
