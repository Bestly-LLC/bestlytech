-- W7 wall round 4 (2026-09-28): "Hey Scout" voice on the wall Pi.
-- state.voice {on, sensitivity 'low'|'normal'|'high'} (admin Voice card), a wake/turn log for tuning false wakes,
-- the Pi's voice status, and the admin read RPC. Writes come only from the voice-ask edge function (Home Hub agent key).

create table if not exists public.wall_voice_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null,              -- turn | wake | ignored | empty
  outcome text,                    -- command | empty | junk | ignored | error
  why text,                        -- ignored: muted | dnd | away; error: stt | llm
  score real,                      -- wake word score (0..1)
  model text,                      -- hey_scout | hey_jarvis
  heard text,                      -- what Scout heard (text only; audio is never stored)
  reply text,
  lat jsonb                        -- seconds per stage
);
create index if not exists wall_voice_log_at on public.wall_voice_log (at desc);
alter table public.wall_voice_log enable row level security;
revoke all on public.wall_voice_log from anon, authenticated;

create table if not exists public.wall_voice_status (
  id int primary key default 1 check (id = 1),
  status jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
alter table public.wall_voice_status enable row level security;
revoke all on public.wall_voice_status from anon, authenticated;

-- state.voice cleaner (its own function so other workers' cleaners stay untouched)
create or replace function public.wall_clean_r4voice(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare v jsonb; cur jsonb := '{}'::jsonb;
begin
  if not (p ? 'voice') then return '{}'::jsonb; end if;
  v := p->'voice';
  if jsonb_typeof(v) = 'null' then return '{"voice": null}'::jsonb; end if;
  if jsonb_typeof(v) <> 'object' then return '{}'::jsonb; end if;
  if jsonb_typeof(v->'on') = 'boolean' then cur := cur || jsonb_build_object('on', v->'on'); end if;
  if v->>'sensitivity' in ('low', 'normal', 'high') then cur := cur || jsonb_build_object('sensitivity', v->>'sensitivity'); end if;
  if cur = '{}'::jsonb then return '{}'::jsonb; end if;
  return jsonb_build_object('voice', jsonb_build_object('on', coalesce((cur->>'on')::boolean, true),
                                                        'sensitivity', coalesce(cur->>'sensitivity', 'normal')));
end $$;

-- add the cleaner to wall_admin_set in place (other round-4 workers edit the same function today, so patch the
-- live definition instead of replacing it from an old copy)
do $$
declare def text;
begin
  def := pg_get_functiondef('public.wall_admin_set(jsonb)'::regprocedure);
  if position('wall_clean_r4voice' in def) = 0 then
    def := regexp_replace(def, '(\|\|\s*wall_clean_toggles\(coalesce\(p_patch, ''\{\}''::jsonb\)\))',
                          '\1 || wall_clean_r4voice(coalesce(p_patch, ''{}''::jsonb))');
    if position('wall_clean_r4voice' in def) = 0 then raise exception 'wall_admin_set anchor not found'; end if;
    execute def;
  end if;
end $$;

-- default: on, normal sensitivity
update public.wall_state set state = state || '{"voice": {"on": true, "sensitivity": "normal"}}'::jsonb,
       version = version + 1, updated_at = now()
 where id = 1 and not (state ? 'voice');

-- admin Voice card: switch state + what the Pi reports + the last thing heard + a tuning summary
create or replace function public.wall_admin_voice() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st jsonb; last_turn record; s record;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select state->'voice' into st from wall_state where id = 1;
  select * into s from wall_voice_status where id = 1;
  select at, heard, reply into last_turn from wall_voice_log where kind = 'turn' and outcome = 'command' order by at desc limit 1;
  return jsonb_build_object(
    'voice', coalesce(st, '{"on": true, "sensitivity": "normal"}'::jsonb),
    'status', s.status, 'status_at', s.at,
    'last', case when last_turn.at is null then null else jsonb_build_object('at', last_turn.at, 'heard', last_turn.heard, 'reply', last_turn.reply) end,
    'day', (select jsonb_build_object(
              'commands', count(*) filter (where outcome = 'command'),
              'false_wakes', count(*) filter (where outcome in ('empty', 'junk')),
              'ignored', count(*) filter (where outcome = 'ignored'),
              'errors', count(*) filter (where outcome = 'error'))
            from wall_voice_log where at > now() - interval '24 hours'),
    'recent', (select coalesce(jsonb_agg(r order by r.at desc), '[]'::jsonb) from (
                 select at, kind, outcome, why, score, model, left(heard, 120) heard from wall_voice_log order by at desc limit 12) r));
end $$;
revoke execute on function public.wall_admin_voice() from public, anon;
grant execute on function public.wall_admin_voice() to authenticated;
