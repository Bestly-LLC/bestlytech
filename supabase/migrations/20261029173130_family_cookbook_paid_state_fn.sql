-- ai_spend.scope only allows background/chat/public/patterns, so family spend is tagged by fn = 'family-cookbook' instead.
create or replace function public.family_paid_state()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select paid_on, paid_cap_usd from public.family_settings where id),
       sp as (select coalesce(sum(cost_usd), 0) as spent from public.ai_spend
               where fn = 'family-cookbook' and provider = 'anthropic'
                 and at >= (date_trunc('month', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'))
  select jsonb_build_object('on', s.paid_on, 'cap', s.paid_cap_usd, 'spent', round(sp.spent, 4),
                            'ok', s.paid_on and sp.spent < s.paid_cap_usd,
                            'month', to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM'))
    from s, sp
$$;
