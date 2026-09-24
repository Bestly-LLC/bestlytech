-- free-llm phase 1: provider switchboard, spend columns, key storage, shadow log, watchdog.
-- Plan: docs/scout-free-llm-opusplan.md. Additive only.

-- 1. Providers: the off switch + cooldowns
create table if not exists public.llm_providers (
  name text primary key,
  enabled boolean not null default true,
  private_ok boolean not null default false,
  cooldown_until timestamptz,
  cooldown_reason text,
  daily_cap int,
  last_ok_at timestamptz,
  last_error text,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.llm_providers enable row level security;
insert into public.llm_providers (name, enabled, private_ok, daily_cap, note) values
  ('groq',       true,  true,  900,  'No retention by default. 8K tokens/min, 1000 req/day, 200K tokens/day per model. console.groq.com'),
  ('cloudflare', true,  true,  9000, 'Workers AI. Contract: no training. daily_cap = Neurons (free = 10,000/day).'),
  ('local',      true,  true,  null, 'Mac mini Ollama via fix_ai_jobs. Never leaves the house. Needs partner_ai_status.seen_at < 3 min.'),
  ('anthropic',  true,  true,  null, 'Paid. Always gated by ai_budget(scope).'),
  ('gemini',     false, false, 450,  'Free tier TRAINS on prompts + human review. privacy=public only. No key yet.'),
  ('openrouter', false, false, 45,   'Free endpoints mostly train. 50 req/day without credit (never buy). privacy=public only. No key yet.')
on conflict (name) do nothing;

-- 2. ai_spend: provider mix
alter table public.ai_spend add column if not exists provider text;
alter table public.ai_spend add column if not exists ok boolean not null default true;
alter table public.ai_spend add column if not exists ms int;
alter table public.ai_spend add column if not exists free_units numeric;
alter table public.ai_spend add column if not exists outcome text;
create index if not exists ai_spend_at_provider on public.ai_spend (at, provider);

create or replace view public.ai_spend_mix_today with (security_invoker = true) as
  with d as (select (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles') as since)
  select coalesce(provider, case when model ilike 'claude%' then 'anthropic' when model ilike 'gpt%' then 'openai' else 'other' end) as provider,
         count(*) filter (where ok) as ok_calls,
         count(*) filter (where not ok) as failed_calls,
         sum(input_tokens + output_tokens) filter (where ok) as tokens,
         round(sum(cost_usd), 4) as cost_usd,
         round(sum(coalesce(free_units, 0)), 0) as free_units
    from public.ai_spend, d where at >= d.since
   group by 1;

-- 3. Keys: Vault only. Read by service role; set by admin (or pasted in the Supabase Vault UI).
create or replace function public.llm_keys()
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets
   where name in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id','gemini_api_key','openrouter_api_key');
$$;
revoke all on function public.llm_keys() from public, anon, authenticated;
grant execute on function public.llm_keys() to service_role;

create or replace function public._llm_key_store(p_name text, p_value text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if p_name not in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id','gemini_api_key','openrouter_api_key') then
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
   where name = case when p_name like 'groq%' then 'groq' when p_name like 'cloudflare%' then 'cloudflare'
                     when p_name like 'gemini%' then 'gemini' else 'openrouter' end;
end $$;
revoke all on function public._llm_key_store(text, text) from public, anon, authenticated;

create or replace function public.llm_key_set(p_name text, p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require_admin();
  perform public._llm_key_store(p_name, p_value);
  return jsonb_build_object('ok', true, 'name', p_name);
end $$;
revoke all on function public.llm_key_set(text, text) from public, anon;
grant execute on function public.llm_key_set(text, text) to authenticated;

-- 4. Shadow log (phase 2)
create table if not exists public.llm_shadow (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  job text not null,
  ref text,
  free_provider text,
  free_model text,
  free_json jsonb,
  paid_json jsonb,
  agree_score numeric,
  note text
);
alter table public.llm_shadow enable row level security;

-- 5. Watchdog: failing providers cool down + raise; free side broken -> raise; near Cloudflare cap -> warn; keys missing -> needs Jared.
create or replace function public.free_llm_watch()
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare
  r record; v_out jsonb := '[]'::jsonb;
  since_day timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  v_cf numeric; v_paid int; v_free int; v_keys int;
begin
  for r in
    select p.name,
           count(s.id) as n,
           count(s.id) filter (where not s.ok) as bad
      from llm_providers p left join ai_spend s on s.provider = p.name and s.at > now() - interval '1 hour'
     where p.enabled and p.name <> 'anthropic'
     group by p.name
  loop
    if r.n >= 3 and r.bad * 2 > r.n then
      update llm_providers set cooldown_until = greatest(coalesce(cooldown_until, now()), now() + interval '1 hour'),
             cooldown_reason = format('%s of %s calls failed in the last hour', r.bad, r.n), updated_at = now()
       where name = r.name;
      perform bestly_raise('ai.free.' || r.name, 'problem', 'warning',
        'Free AI: ' || r.name || ' is failing',
        format('%s of %s calls failed in the last hour. Paused for 1 hour; Scout uses the next provider meanwhile.', r.bad, r.n), 'ai', null, true);
      v_out := v_out || jsonb_build_object('cooldown', r.name);
    elsif r.n >= 2 and r.bad = 0 then
      perform bestly_raise('ai.free.' || r.name, 'resolved', 'info', 'Free AI: ' || r.name || ' working again');
    end if;
  end loop;

  select coalesce(sum(free_units), 0) into v_cf from ai_spend where provider = 'cloudflare' and at >= since_day;
  if v_cf > 8000 then
    perform bestly_raise('ai.free.cloudflare_cap', 'problem', 'info', 'Free AI: Cloudflare near today''s free limit',
      format('About %s of 10,000 free Neurons used today. Scout moves to the next provider at 9,000.', round(v_cf)), 'ai', null, true);
  else
    perform bestly_raise('ai.free.cloudflare_cap', 'resolved', 'info', null);
  end if;

  -- Only calls made through _shared/free-llm.ts (provider set); legacy direct Claude calls are not counted.
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

  return jsonb_build_object('ok', true, 'actions', v_out, 'cloudflare_units', v_cf, 'paid_24h', v_paid, 'free_24h', v_free, 'keys', v_keys);
end $$;
revoke all on function public.free_llm_watch() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('free-llm-watch','free-llm-canary');
select cron.schedule('free-llm-watch', '*/15 * * * *', 'select public.free_llm_watch()');
select cron.schedule('free-llm-canary', '30 12 * * *',
  $c$select public.invoke_edge_function('free-llm', '{"op":"canary"}'::jsonb, 120000)$c$);
