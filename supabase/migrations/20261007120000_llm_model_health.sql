-- Scout chief of staff, step 1: which FreeLLM models really call tools. Plan: docs/scout-chief-of-staff-opusplan.md
create table if not exists public.llm_model_health (
  model text primary key,
  provider text not null default 'freellm',
  ok_tool_calls boolean,                 -- null = never probed
  last_probe_at timestamptz,
  last_ms integer,
  fails_24h integer not null default 0,
  strikes integer not null default 0,
  benched_until timestamptz,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.llm_model_health enable row level security;
revoke all on public.llm_model_health from anon, authenticated;

-- Admin read-only view for the Scout settings page.
create or replace function public.llm_model_health_admin()
returns setof public.llm_model_health language sql security definer set search_path = public as $$
  select * from public.llm_model_health where public.has_role(auth.uid(), 'admin') order by ok_tool_calls desc nulls last, model;
$$;
revoke all on function public.llm_model_health_admin() from public, anon;
grant execute on function public.llm_model_health_admin() to authenticated;

-- Pi prober reports a batch: [{model, ok, note, ms}]
create or replace function public.llm_model_health_report(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.llm_model_health(model, ok_tool_calls, last_probe_at, last_ms, note, benched_until, updated_at)
    values (r->>'model', (r->>'ok')::boolean, now(), (r->>'ms')::int, left(r->>'note', 200),
            case when (r->>'ok')::boolean then null else now() + interval '24 hours' end, now())
    on conflict (model) do update set
      ok_tool_calls = excluded.ok_tool_calls, last_probe_at = now(), last_ms = excluded.last_ms, note = excluded.note,
      benched_until = case when excluded.ok_tool_calls then null else now() + interval '24 hours' end,
      strikes = case when excluded.ok_tool_calls then 0 else public.llm_model_health.strikes end,
      updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.llm_model_health_report(jsonb) from public, anon, authenticated;
grant execute on function public.llm_model_health_report(jsonb) to service_role;

-- Scout records a strike (text tool call, loop, empty reply) and benches the model for a while.
create or replace function public.llm_model_strike(p_model text, p_reason text, p_bench_minutes integer default 360)
returns void language sql security definer set search_path = public as $$
  insert into public.llm_model_health(model, strikes, fails_24h, benched_until, note, updated_at)
  values (p_model, 1, 1, now() + make_interval(mins => greatest(1, p_bench_minutes)), left(p_reason, 200), now())
  on conflict (model) do update set strikes = public.llm_model_health.strikes + 1,
    fails_24h = public.llm_model_health.fails_24h + 1,
    benched_until = now() + make_interval(mins => greatest(1, p_bench_minutes)), note = left(p_reason, 200), updated_at = now();
$$;
revoke all on function public.llm_model_strike(text, text, integer) from public, anon, authenticated;
grant execute on function public.llm_model_strike(text, text, integer) to service_role;
