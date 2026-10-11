-- Nickel: more proof (2026-10-10). Worker RPCs for the Pi matcher (token = db_watchdog_ok, same as the other
-- settlement_*_t functions). Part 2 of 4.
--
-- First-party proof that exists in this database:
--   bestly_mail                 his mailbox (subject, sender, body) - note it only goes back to 2026-04-09
--   home_hub_inventory          the Pi, Mac mini, router, services
--   home_hub_snapshots          what Home Assistant / Homebridge see on his home network (Dyson, Hue, HomePods, projector,
--                               EcoFlow, SmartRent lock, his iPhone, Mac mini, MacBook Air)
--   turo_reviews / turo_vehicle_state   the Teslas on his Turo host account (Model 3 2020, Model Y 2021)
-- Not here: bank data (Mercury is not in this database), InventoryProof (lives on his phone).

create or replace function public.settlement_facts_t(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'question', question, 'answer', answer) order by key)
                   from settlement_facts), '[]'::jsonb);
end $$;

-- Matcher verdict + fact_key. Like settlement_judge_t, plus:
--  * stores fact_key (lower-case slug)
--  * a claim still in 'found' follows the new verdict (so re-judging an 'ask' that is now provable moves it to ready);
--    claims in any other status keep their status (answered, skipped, approved, filed ... are never overwritten)
--  * p_match = 'ask' with the fact already answered: applies the answer straight away (yes -> ready with answer evidence, no -> skipped)
create or replace function public.settlement_judge2_t(p_token text, p_settlement uuid, p_match text, p_evidence jsonb,
  p_question text default null, p_fact_key text default null, p_fact_question text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_ans boolean;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if p_match not in ('proven', 'likely', 'ask', 'no') then raise exception 'bad match'; end if;
  v_key := nullif(left(trim(both '-' from regexp_replace(lower(coalesce(p_fact_key, '')), '[^a-z0-9]+', '-', 'g')), 60), '');
  insert into settlement_claims (settlement_id, match, evidence, question, status, fact_key)
  values (p_settlement, p_match, coalesce(p_evidence, '[]'::jsonb), p_question,
          case p_match when 'no' then 'skipped' when 'ask' then 'found' else 'ready' end, v_key)
  on conflict (settlement_id) do update set
     match = excluded.match, evidence = excluded.evidence,
     question = coalesce(excluded.question, settlement_claims.question),
     fact_key = coalesce(excluded.fact_key, settlement_claims.fact_key),
     status = case when settlement_claims.status = 'found' then excluded.status else settlement_claims.status end,
     updated_at = now()
  returning id into v_id;
  perform settlement_log(v_id, 'judged', jsonb_build_object('match', p_match, 'fact', v_key));
  if p_match = 'ask' and v_key is not null then
    insert into settlement_facts (key, question) values (v_key, coalesce(nullif(trim(coalesce(p_fact_question, '')), ''), nullif(trim(coalesce(p_question, '')), ''), v_key))
    on conflict (key) do nothing;
    select answer into v_ans from settlement_facts where key = v_key;
    if v_ans is not null then perform settlement_fact_apply(v_key, v_ans, null); end if;
  end if;
  return v_id;
end $$;

-- Deeper mail search: subject, sender and (optionally) body of bestly_mail, any term, optional date window.
-- snippet = about 160 characters around the first hit (body preferred, else subject/sender).
create or replace function public.settlement_mail_search2_t(p_token text, p_terms text[], p_since date default null,
  p_until date default null, p_body boolean default true, p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_terms text[]; v_lim int := least(greatest(coalesce(p_limit, 40), 1), 60);
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  select array_agg(distinct lower(trim(t))) into v_terms from unnest(coalesce(p_terms, '{}')) t where length(trim(t)) >= 3;
  if v_terms is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'from', x.frm, 'subject', x.subject, 'sent_at', x.sent_at, 'snippet', x.snip)
                     order by x.sent_at desc)
    from (
      select m.id, coalesce(m.from_name, m.from_addr) as frm, m.subject, m.sent_at,
             case when h.bpos is not null then substr(h.body, greatest(h.bpos - 60, 1), 160)
                  else substr(h.head, greatest(coalesce(h.hpos, 1) - 60, 1), 160) end as snip
      from bestly_mail m
      cross join lateral (
        select lower(coalesce(m.subject, '') || ' | ' || coalesce(m.from_name, '') || ' <' || coalesce(m.from_addr, '') || '>') as headl,
               coalesce(m.subject, '') || ' | ' || coalesce(m.from_name, '') || ' <' || coalesce(m.from_addr, '') || '>' as head,
               case when p_body then regexp_replace(left(coalesce(m.body_text, ''), 20000), '\s+', ' ', 'g') else '' end as body
      ) b
      cross join lateral (
        select b.head as head, b.body as body,
               (select min(position(t in b.headl)) filter (where position(t in b.headl) > 0) from unnest(v_terms) t) as hpos,
               case when p_body then (select min(position(t in lower(b.body))) filter (where position(t in lower(b.body)) > 0) from unnest(v_terms) t) end as bpos
      ) h
      where (h.hpos is not null or h.bpos is not null)
        and (p_since is null or m.sent_at >= p_since)
        and (p_until is null or m.sent_at < p_until + 1)
      order by m.sent_at desc
      limit v_lim
    ) x), '[]'::jsonb);
end $$;

-- What he owns that sits on his home network: [{source, kind, name, brand}]. Names come straight from the inventory and
-- the Home Assistant / Homebridge snapshots; brand is only filled in when the name says it (Dyson, Hue, HomePod ...).
create or replace function public.settlement_devices_t(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('source', d.src, 'kind', d.kind, 'name', d.name,
      'brand', case
        when d.name ~* 'dyson|pure cool' then 'Dyson'
        when d.name ~* '\mhue\M' then 'Philips Hue'
        when d.name ~* 'homepod|iphone|macbook|mac mini|airplay|apple' then 'Apple'
        when d.name ~* 'nebula|capsule' then 'Anker Nebula'
        when d.name ~* 'delta 2|ecoflow' then 'EcoFlow'
        when d.name ~* 'raspberry|bestly-pi' then 'Raspberry Pi'
        when d.name ~* 'verizon' then 'Verizon'
        when d.name ~* 'smartrent' then 'SmartRent'
        else null end) order by d.src, d.name)
    from (
      select 'home_hub_inventory' as src, kind, name from home_hub_inventory where kind in ('device', 'network')
      union
      select 'homeassistant', dev->>'domain', dev->>'name'
        from home_hub_snapshots s, jsonb_array_elements(coalesce(s.data->'devices', '[]'::jsonb)) dev
       where s.source = 'homeassistant' and dev->>'domain' in ('fan', 'lock', 'media_player')
         and dev->>'name' !~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}@' and dev->>'name' !~* 'start nebula cast'
         and dev->>'name' !~ '^(TV|Desk|Desk \(6\)|Studio)$'
      union
      select 'homeassistant', 'battery device',
             regexp_replace(b->>'name', '\s+(Main\s+)?Battery([ _]level)?$', '', 'i')
        from home_hub_snapshots s, jsonb_array_elements(coalesce(s.data->'batteries', '[]'::jsonb)) b
       where s.source = 'homeassistant'
      union
      (select 'homeassistant', 'integration', 'Philips Hue bridge and lights'
        from home_hub_snapshots s, jsonb_array_elements(coalesce(s.data->'devices', '[]'::jsonb)) dev
       where s.source = 'homeassistant' and dev->>'name' ~* '^hue ' limit 1)
      union
      select 'homebridge', 'plugin', p->>'name'
        from home_hub_snapshots s, jsonb_array_elements(coalesce(s.data->'plugins', '[]'::jsonb)) p
       where s.source = 'homebridge' and p->>'name' in ('SmartRent', 'Dyson')
    ) d where d.name is not null), '[]'::jsonb);
end $$;

-- Vehicles on his Turo host account: [{make, model, year, name, source}]. Parsed from the vehicle strings Turo shows
-- ("Tesla Model 3 2020"). These are fleet cars he hosts, so a class that needs personal ownership/lease is not proven by them.
create or replace function public.settlement_vehicles_t(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('make', v.make, 'model', v.model, 'year', v.yr, 'name', v.vehicle, 'source', 'turo_host_account') order by v.yr, v.vehicle)
    from (
      select distinct r.vehicle,
             (regexp_match(r.vehicle, '^(\S+)\s+(.+?)\s+((?:19|20)\d{2})$'))[1] as make,
             (regexp_match(r.vehicle, '^(\S+)\s+(.+?)\s+((?:19|20)\d{2})$'))[2] as model,
             ((regexp_match(r.vehicle, '^(\S+)\s+(.+?)\s+((?:19|20)\d{2})$'))[3])::int as yr
        from turo_reviews r where r.vehicle ~ '^\S+\s+.+\s+(19|20)\d{2}$'
    ) v), '[]'::jsonb);
end $$;

insert into public.security_public_rpcs (fn, why) values
  ('settlement_facts_t', 'Pi settlement matcher (watchdog token)'),
  ('settlement_judge2_t', 'Pi settlement matcher (watchdog token)'),
  ('settlement_mail_search2_t', 'Pi settlement matcher (watchdog token)'),
  ('settlement_devices_t', 'Pi settlement matcher (watchdog token)'),
  ('settlement_vehicles_t', 'Pi settlement matcher (watchdog token)')
on conflict (fn) do nothing;
