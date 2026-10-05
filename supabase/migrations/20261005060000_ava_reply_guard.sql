-- Reply guard (Jared, 2026-10-04, after call #8 where Ava said "tool_code print(default_api.end_call(...))" out loud).
-- Watches every finished call on both Avas (personal ava_calls + RoofGuard rg_calls):
--   code_leak  Ava spoke code, a tool name or a {{variable}}       → Scout alert + self-heal: switch to the next model and re-run setup
--   no_hangup  she said goodbye but the call kept going 10+ sec    → Scout alert, logged for learning
--   repeat     she said the same line twice in one call             → logged for learning
-- Every incident lands in ava_reply_incidents, which the self-learning Coach reads (docs/ava-learning-opusplan.md).

-- 1. model chain: primary first. gemini-2.5-flash-lite is deprecated and caused the leak.
alter table public.rg_settings  add column if not exists llm_fallbacks text[] not null default array['gpt-4.1-mini','claude-haiku-4-5','gemini-3.5-flash'];
alter table public.ava_settings add column if not exists llm_fallbacks text[] not null default array['gpt-4.1-mini','claude-haiku-4-5','gemini-3.5-flash'];
update public.rg_settings  set llm = 'gpt-4.1-mini' where llm is distinct from 'gpt-4.1-mini';
update public.ava_settings set llm = 'gpt-4.1-mini' where llm is distinct from 'gpt-4.1-mini';

-- 2. incidents
create table if not exists public.ava_reply_incidents (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ava', 'roofguard')),
  call_id uuid not null,
  call_no bigint,
  kind text not null check (kind in ('code_leak', 'no_hangup', 'repeat')),
  excerpt text,
  llm text,
  healed text,                    -- what the guard did about it, e.g. 'switched gemini-2.5-flash-lite → claude-haiku-4-5'
  reviewed_at timestamptz,        -- set by the Coach / Jared once learned from
  created_at timestamptz not null default now(),
  unique (call_id, kind)
);
alter table public.ava_reply_incidents enable row level security;
create policy "admin ava_reply_incidents" on public.ava_reply_incidents for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
grant select, update on public.ava_reply_incidents to authenticated;

-- 3. the scan (pure: what's wrong with this transcript)
create or replace function public.ava_reply_scan(p_transcript jsonb)
 returns table(kind text, excerpt text) language sql immutable set search_path to 'public'
as $function$
  with t as (
    select ord, e->>'role' role, coalesce(e->>'message', '') msg, coalesce((e->>'time_in_call_secs')::int, 0) secs
      from jsonb_array_elements(coalesce(p_transcript, '[]'::jsonb)) with ordinality x(e, ord)
  ), last_t as (select max(secs) m from t)
  select 'code_leak', left(msg, 240) from t
   where role = 'agent' and msg ~* '(tool_code|default_api|print\(|end_call\(|transfer_to_number\(|voicemail_detection\(|system__|\{\{|\}\}|```|function_call|<tool)'
  union all
  select 'no_hangup', left(msg, 240) from t, last_t
   where role = 'agent' and msg ~* '\m(goodbye|bye now|have a (good|great) (day|one|night)|thanks for your time)\M' and last_t.m - t.secs >= 10
  union all
  select 'repeat', left(msg, 240) from (
    select msg, count(*) n from t where role = 'agent' and length(msg) > 25 group by msg) r where n > 1
$function$;

-- 4. log + alert + heal
create or replace function public.ava_reply_guard(p_source text, p_call_id uuid, p_call_no bigint, p_transcript jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_llm text; v_chain text[]; v_next text; v_healed text; v_new boolean;
begin
  if p_source = 'roofguard' then select llm, llm_fallbacks into v_llm, v_chain from rg_settings where id;
  else select llm, llm_fallbacks into v_llm, v_chain from ava_settings limit 1; end if;

  for r in select distinct on (s.kind) s.kind, s.excerpt from ava_reply_scan(p_transcript) s loop
    v_healed := null; v_new := null;
    insert into ava_reply_incidents (source, call_id, call_no, kind, excerpt, llm)
    values (p_source, p_call_id, p_call_no, r.kind, r.excerpt, v_llm)
    on conflict (call_id, kind) do nothing
    returning true into v_new;
    continue when v_new is null;    -- already handled

    if r.kind = 'code_leak' then
      -- self-heal: move to the next model in the chain that isn't the one that leaked, and re-run setup
      select m into v_next from unnest(v_chain) with ordinality u(m, i)
       where m is distinct from v_llm
         and m not in (select llm from ava_reply_incidents where kind = 'code_leak' and source = p_source and llm is not null and created_at > now() - interval '7 days')
       order by i limit 1;
      if v_next is not null then
        if p_source = 'roofguard' then
          update rg_settings set llm = v_next where id;
          perform invoke_edge_function('roofguard-caller', '{"action":"setup"}'::jsonb, 120000);
        else
          update ava_settings set llm = v_next;
          perform invoke_edge_function('ava-assistant', '{"action":"setup"}'::jsonb, 120000);
        end if;
        v_healed := 'switched ' || coalesce(v_llm, '?') || ' → ' || v_next;
      else
        v_healed := 'no safe model left in the chain; needs a look';
      end if;
      update ava_reply_incidents set healed = v_healed where call_id = p_call_id and kind = r.kind;
      perform scout_notify(
        (case when p_source = 'roofguard' then 'RoofGuard Ava' else 'Ava' end) || ' spoke code on call #' || coalesce(p_call_no::text, '?'),
        'She said: "' || left(r.excerpt, 140) || '". Guard ' || v_healed || '.', 'high', true,
        case when p_source = 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end,
        'ava-reply-guard-' || p_call_id::text);
    elsif r.kind = 'no_hangup' then
      perform scout_notify(
        (case when p_source = 'roofguard' then 'RoofGuard Ava' else 'Ava' end) || ' didn''t hang up on call #' || coalesce(p_call_no::text, '?'),
        'She said goodbye but the line stayed open. Logged for her next review.', 'medium', false,
        case when p_source = 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end,
        'ava-reply-guard-hangup-' || p_call_id::text);
    end if;
  end loop;
exception when others then
  -- the guard must never break call logging
  raise warning 'ava_reply_guard failed: %', sqlerrm;
end $function$;

-- 5. run it whenever a call's transcript lands
create or replace function public.rg_calls_reply_guard_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.transcript is not null and new.moved_to_ava_at is null and (tg_op = 'INSERT' or old.transcript is distinct from new.transcript) then
    perform ava_reply_guard('roofguard', new.id, new.call_no, new.transcript);
  end if;
  return new;
end $function$;

create or replace function public.ava_calls_reply_guard_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.transcript is not null and (tg_op = 'INSERT' or old.transcript is distinct from new.transcript) then
    perform ava_reply_guard('ava', new.id, new.call_no, new.transcript);
  end if;
  return new;
end $function$;

create trigger rg_calls_reply_guard after insert or update of transcript on public.rg_calls
  for each row execute function public.rg_calls_reply_guard_trg();
create trigger ava_calls_reply_guard after insert or update of transcript on public.ava_calls
  for each row execute function public.ava_calls_reply_guard_trg();

-- 6. backfill: log what already happened (no model switch for history; today's switch is done above)
insert into public.ava_reply_incidents (source, call_id, call_no, kind, excerpt, llm, healed)
select 'roofguard', c.id, c.call_no, s.kind, s.excerpt, 'gemini-2.5-flash-lite',
       case when s.kind = 'code_leak' then 'switched gemini-2.5-flash-lite → gpt-4.1-mini (by hand, 2026-10-04)' end
  from public.rg_calls c, lateral (select distinct on (kind) kind, excerpt from public.ava_reply_scan(c.transcript)) s
 where c.moved_to_ava_at is null and c.transcript is not null
on conflict (call_id, kind) do nothing;
insert into public.ava_reply_incidents (source, call_id, call_no, kind, excerpt, llm)
select 'ava', c.id, c.call_no, s.kind, s.excerpt, 'gemini-2.5-flash-lite'
  from public.ava_calls c, lateral (select distinct on (kind) kind, excerpt from public.ava_reply_scan(c.transcript)) s
 where c.transcript is not null
on conflict (call_id, kind) do nothing;
