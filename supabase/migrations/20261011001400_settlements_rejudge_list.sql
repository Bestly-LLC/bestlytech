-- Nickel: one-off re-judge support (2026-10-10). The Pi matcher's --rejudge-asks pass needs the claims that are still
-- sitting at "ask" (status found) together with their settlement, so it can look for proof again with the deeper search
-- and give them a fact_key. Worker RPC, watchdog token. Read-only.
create or replace function public.settlement_rejudge_list_t(p_token text, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select s.*, c.id as claim_id, c.question as claim_question, c.fact_key as claim_fact_key
      from settlement_claims c join settlements s on s.id = c.settlement_id
     where c.status = 'found' and c.match = 'ask' and s.status = 'open'
       and (s.deadline is null or s.deadline >= (now() at time zone 'America/Los_Angeles')::date)
     order by s.deadline nulls last limit p_limit) x), '[]'::jsonb);
end $$;

insert into public.security_public_rpcs (fn, why) values
  ('settlement_rejudge_list_t', 'Pi settlement matcher (watchdog token)')
on conflict (fn) do nothing;
