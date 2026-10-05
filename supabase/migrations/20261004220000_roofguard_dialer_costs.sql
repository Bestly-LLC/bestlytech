-- Dialer + cost total (Spark, 2026-10-04).
--  * Personal calls: Jared types a number and a reason, Ava calls as "Jared's AI assistant" (not RoofGuard).
--    Logged against a placeholder lead, flagged as test, never counted in her KPIs, never auto-called back.
--  * Cost total for /admin/roofguard: ElevenLabs $0.08 per call minute (same on every plan; getmacha.com/blog/
--    elevenlabs-agents-pricing-explained), the AI model's real per-call cost (from each transcript's llm_usage),
--    Telnyx about $0.007 per minute billed by the started minute, plus the number ($1 upfront, $1 a month).

alter table public.rg_settings add column if not exists personal_lead_id uuid references public.rg_leads(id) on delete set null;
alter table public.rg_settings add column if not exists cost_voice_per_min numeric not null default 0.08;
alter table public.rg_settings add column if not exists cost_phone_per_min numeric not null default 0.007;
alter table public.rg_settings add column if not exists cost_number_monthly numeric not null default 1.00;
alter table public.rg_settings add column if not exists number_bought_on date not null default '2026-10-04';

with ins as (
  insert into public.rg_leads (company, state, timezone, risk_tier, contacts, category, pitch, pitch_source, enrich_status, dnc, priority, notes)
  values ('Personal call', 'CA', 'America/Los_Angeles', 'LOW', '[]'::jsonb, 'generic', 'n/a', 'bespoke', 'not_found', true, 0,
          'Placeholder for Ava''s personal calls from the admin dialer. Never dialed by the queue.')
  returning id)
update public.rg_settings set personal_lead_id = (select id from ins) where id and personal_lead_id is null;

-- demo and personal calls never schedule automatic callbacks
create or replace function public.rg_calls_followup_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id in (select x from rg_settings, unnest(array[demo_lead_id, personal_lead_id]) x where id and x is not null) then
    return new;
  end if;
  if new.status = 'completed' and new.outcome = 'callback_set' and new.callback_at is not null
     and new.callback_at > now() - interval '1 hour' then
    insert into rg_followups (lead_id, call_id, to_number, due_at, is_test, note)
    values (new.lead_id, new.id, new.to_number, new.callback_at, new.is_test,
            left(coalesce(new.summary, new.notes, 'Asked for a callback'), 300))
    on conflict (call_id) do update set due_at = excluded.due_at, note = excluded.note, updated_at = now()
      where rg_followups.status = 'scheduled';
  end if;
  if tg_op = 'INSERT' and not new.is_test then
    update rg_followups set status = 'done', result_call_id = new.id, updated_at = now()
     where lead_id = new.lead_id and not is_test and status = 'scheduled' and due_at < now() + interval '1 hour';
  end if;
  return new;
end $$;

-- what every call cost: voice minutes, phone minutes (rounded up), and the AI model's actual price
create or replace function public.rg_call_cost(c rg_calls, s rg_settings)
returns numeric language sql immutable as $$
  select coalesce(c.duration_sec, 0) / 60.0 * s.cost_voice_per_min
       + ceil(coalesce(c.duration_sec, 0) / 60.0) * s.cost_phone_per_min
       + coalesce((select sum(coalesce((u.value->'input'->>'price')::numeric, 0) + coalesce((u.value->'output_total'->>'price')::numeric, 0)
                                + coalesce((u.value->'input_cache_read'->>'price')::numeric, 0) + coalesce((u.value->'input_cache_write'->>'price')::numeric, 0))
                     from jsonb_array_elements(coalesce(c.transcript, '[]'::jsonb)) t,
                          jsonb_each(coalesce(t->'llm_usage'->'model_usage', '{}'::jsonb)) u), 0)
$$;

create or replace function public.rg_costs()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s rg_settings; v_months int; v jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  select * into s from rg_settings where id;
  v_months := 1 + (extract(year from age(now(), s.number_bought_on)) * 12 + extract(month from age(now(), s.number_bought_on)))::int;
  with c as (
    select x.*, rg_call_cost(x, s) cost, (x.queued_at at time zone 'America/Los_Angeles')::date d from rg_calls x
  )
  select jsonb_build_object(
    'calls_total', round(coalesce(sum(cost), 0), 2),
    'today', round(coalesce(sum(cost) filter (where d = (now() at time zone 'America/Los_Angeles')::date), 0), 2),
    'month', round(coalesce(sum(cost) filter (where date_trunc('month', d) = date_trunc('month', (now() at time zone 'America/Los_Angeles')::date)), 0), 2),
    'minutes', round(coalesce(sum(duration_sec), 0) / 60.0, 1),
    'calls', count(*),
    'voice', round(coalesce(sum(coalesce(duration_sec, 0)), 0) / 60.0 * s.cost_voice_per_min, 2),
    'phone', round(coalesce(sum(ceil(coalesce(duration_sec, 0) / 60.0)), 0) * s.cost_phone_per_min, 2),
    'ai', round(coalesce(sum(cost), 0) - coalesce(sum(coalesce(duration_sec, 0)), 0) / 60.0 * s.cost_voice_per_min
                - coalesce(sum(ceil(coalesce(duration_sec, 0) / 60.0)), 0) * s.cost_phone_per_min, 2),
    'number', s.cost_number_monthly * (v_months + 1),   -- $1 upfront + $1 per month started
    'per_meeting', (select round((coalesce(sum(cost), 0) + s.cost_number_monthly * (v_months + 1)) / nullif(count(*) filter (where outcome = 'booked' and not is_test), 0), 2) from c),
    'rates', jsonb_build_object('voice_per_min', s.cost_voice_per_min, 'phone_per_min', s.cost_phone_per_min, 'number_monthly', s.cost_number_monthly))
  into v from c;
  return v || jsonb_build_object('total', round((v->>'calls_total')::numeric + (v->>'number')::numeric, 2));
end $$;
revoke execute on function public.rg_costs() from public, anon;
grant execute on function public.rg_costs() to authenticated;
revoke execute on function public.rg_call_cost(rg_calls, rg_settings) from public, anon;

-- KPIs ignore personal calls too (they're flagged test already; this keeps them out even if a flag is missed)
create or replace function public.rg_ava_calls()
returns table(id uuid, at timestamptz, wk date, day date, connected boolean, dm boolean, pitched boolean, booked boolean,
              outcome text, duration_sec int, transcript jsonb)
language sql stable security definer set search_path = public as $$
  select c.id, c.queued_at,
         date_trunc('week', c.queued_at at time zone 'America/Los_Angeles')::date,
         (c.queued_at at time zone 'America/Los_Angeles')::date,
         (c.status = 'completed' and c.outcome is not null and c.outcome not in ('voicemail_left', 'no_answer')),
         (coalesce(c.dm_reached, false) or c.outcome = 'booked'),
         (coalesce(c.kept_talking, false) or c.outcome = 'booked'),
         (c.outcome = 'booked'),
         c.outcome, c.duration_sec, c.transcript
    from rg_calls c
   where not c.is_test
     and c.lead_id is distinct from (select demo_lead_id from rg_settings where id)
     and c.lead_id is distinct from (select personal_lead_id from rg_settings where id)
$$;
revoke execute on function public.rg_ava_calls() from public, anon, authenticated;
