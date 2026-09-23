-- Caps for the paid AI that anyone on the internet could trigger (found in the 2026-09-23 spend audit):
--   report-missed-banner  public; every report called ai-generate-pattern (OpenAI gpt-4o, up to 3 calls)
--   probe-report          public; called Gemini 2.5 Pro on every request
--   voice-to-claude       public unless a token secret was set; Whisper + Claude via OpenRouter
--   ai-generate-pattern   the OpenAI choke point (cron, report-missed-banner, cy-autofix, render-banner,
--                         auto-retry); cy-autofix and render-banner reset its per-domain attempt count
--
-- ai_gate(fn, who) is asked before every paid call: a per-day cap for the function and a per-hour cap
-- for one caller (a hashed IP, or a domain). Caps live in ai_caps so they can be changed without a deploy.
-- Every call that goes ahead is also logged in ai_spend (scope 'public' or 'patterns') with its cost.

alter table public.ai_spend drop constraint if exists ai_spend_scope_check;
alter table public.ai_spend add constraint ai_spend_scope_check check (scope in ('background','chat','public','patterns'));

create table if not exists public.ai_caps (
  fn text primary key,
  per_day int not null,          -- paid calls a day (Los Angeles day) for this function
  per_who_hour int not null,     -- paid calls an hour for one caller (hashed IP or domain)
  note text,
  updated_at timestamptz not null default now()
);
alter table public.ai_caps enable row level security;
drop policy if exists "Admins manage ai caps" on public.ai_caps;
create policy "Admins manage ai caps" on public.ai_caps for all to authenticated
  using (has_role(auth.uid(), 'admin')) with check (has_role(auth.uid(), 'admin'));
grant select, update on public.ai_caps to authenticated;

insert into public.ai_caps (fn, per_day, per_who_hour, note) values
  ('ai-generate-pattern', 200, 6, 'OpenAI calls (gpt-4o / 4o-mini). who = domain. One domain run is up to 3 calls.'),
  ('report-missed-banner', 300, 10, 'Reports that may start AI. who = hashed IP. Over the cap the report is still saved; AI runs on the next scheduled pass.'),
  ('probe-report', 100, 10, 'Gemini 2.5 Pro calls. who = hashed IP.'),
  ('voice-to-claude', 50, 20, 'Whisper + Claude via OpenRouter. Admin or shared token only.')
on conflict (fn) do nothing;

create table if not exists public.ai_gate_hits (
  id bigint generated always as identity primary key,
  fn text not null,
  who text not null,
  at timestamptz not null default now()
);
create index if not exists ai_gate_hits_fn_at on public.ai_gate_hits (fn, at desc);
create index if not exists ai_gate_hits_who on public.ai_gate_hits (fn, who, at desc);
alter table public.ai_gate_hits enable row level security;
drop policy if exists "Admins read gate hits" on public.ai_gate_hits;
create policy "Admins read gate hits" on public.ai_gate_hits for select to authenticated using (has_role(auth.uid(), 'admin'));

create or replace function public.ai_gate(p_fn text, p_who text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c ai_caps;
  since_day timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  n_day int; n_who int;
begin
  select * into c from ai_caps where fn = p_fn;
  if c.fn is null then return jsonb_build_object('ok', false, 'reason', 'no cap set for ' || p_fn); end if;
  -- one caller at a time for a given function, so parallel requests can't slip past the count
  perform pg_advisory_xact_lock(hashtext('ai_gate:' || p_fn));
  select count(*) into n_day from ai_gate_hits where fn = p_fn and at >= since_day;
  if n_day >= c.per_day then
    return jsonb_build_object('ok', false, 'reason', 'daily cap', 'used', n_day, 'cap', c.per_day);
  end if;
  select count(*) into n_who from ai_gate_hits where fn = p_fn and who = coalesce(p_who, '?') and at > now() - interval '1 hour';
  if n_who >= c.per_who_hour then
    return jsonb_build_object('ok', false, 'reason', 'hourly cap for this caller', 'used', n_who, 'cap', c.per_who_hour);
  end if;
  insert into ai_gate_hits (fn, who) values (p_fn, coalesce(p_who, '?'));
  -- once a day, tell Jared when a cap is first reached
  if n_day + 1 = c.per_day then
    perform admin_notify('scout', 'Paid AI cap reached: ' || p_fn,
      p_fn || ' made ' || c.per_day || ' paid AI calls today and is paused until midnight. If that looks wrong, something may be abusing it.',
      '/admin', 'ai-cap', 'warning', 'ai.cap:' || p_fn || ':' || (now() at time zone 'America/Los_Angeles')::date);
  end if;
  return jsonb_build_object('ok', true, 'used', n_day + 1, 'cap', c.per_day);
end $$;
revoke all on function public.ai_gate(text, text) from public, anon, authenticated;
grant execute on function public.ai_gate(text, text) to service_role;

-- keep the hits table small
create or replace function public.ai_gate_prune() returns void language sql security definer set search_path = public as $$
  delete from ai_gate_hits where at < now() - interval '3 days';
$$;

select cron.schedule('ai-gate-prune', '40 3 * * *', 'select public.ai_gate_prune()');
