-- Ava answers Jared's missed cell calls (2026-10-05). Jared dials *71 8164299495 on Verizon, and calls he doesn't answer
-- on +18165007236 forward to Ava's line. She answers as his assistant (his cloned voice when he wants), takes a message.
--
--   ava_calls.forwarded / forwarded_from      this call came through the cell (set by the init / post-call hooks)
--   ava_settings.forward_enabled / _at / forward_voice
--                                             the switch on /admin/ava ("Ava answers my missed calls") and which voice
--   ava_init_debug                            the last 50 init / post-call payload shapes (keys + non-secret values), so the
--                                             first real forwarded call shows where the phone company puts the diversion
--   ava_impersonation_check                   forwarded + Jared-voice calls must say "assistant" and "recorded" up front
--   ava_watch                                 info alert when forwarding has been on 48 hours and nothing was detected
-- No existing constraint changes. Voice mode pause-on-violation is unchanged.

-- ---------- columns ----------
alter table public.ava_calls add column if not exists forwarded boolean not null default false;
alter table public.ava_calls add column if not exists forwarded_from text;
alter table public.ava_settings add column if not exists forward_enabled boolean not null default false;
alter table public.ava_settings add column if not exists forward_enabled_at timestamptz;
alter table public.ava_settings add column if not exists forward_voice text not null default 'jared';
alter table public.ava_settings add constraint ava_settings_forward_voice_check check (forward_voice in ('jared', 'ava'));

-- the clock for the 48-hour check starts when Jared flips the switch on
create or replace function public.ava_settings_forward_trg() returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.forward_enabled then
    if tg_op = 'INSERT' or old.forward_enabled is distinct from true then new.forward_enabled_at := now(); end if;
  else
    new.forward_enabled_at := null;
  end if;
  return new;
end $function$;
create trigger ava_settings_forward before insert or update of forward_enabled on public.ava_settings
  for each row execute function public.ava_settings_forward_trg();

create index if not exists ava_calls_forwarded_idx on public.ava_calls (created_at desc) where forwarded;

-- ---------- init / post-call payload shapes ----------
create table if not exists public.ava_init_debug (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('init', 'post')),
  keys jsonb not null default '[]'::jsonb,       -- top-level (init) or data.* (post) key names
  fields jsonb not null default '{}'::jsonb,     -- flattened scalar paths -> short values; secret-looking keys are never stored
  forwarded boolean not null default false,
  forwarded_from text,
  note text
);
alter table public.ava_init_debug enable row level security;
create policy "admin read ava_init_debug" on public.ava_init_debug for select to authenticated using (public.has_role(auth.uid(), 'admin'));
grant select on public.ava_init_debug to authenticated;

-- keep the last 50
create or replace function public.ava_init_debug_trim() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  delete from public.ava_init_debug where id in (select id from public.ava_init_debug order by id desc offset 50);
  return null;
end $function$;
create trigger ava_init_debug_trim after insert on public.ava_init_debug for each statement execute function public.ava_init_debug_trim();

-- ---------- impersonation guard: forwarded + Jared voice ----------
-- Forwarded call in Jared's voice: her first two lines must contain "assistant" and "recorded". Any "this is Jared" / "I'm Jared"
-- still trips it. Everything else (alert, voice mode off until Jared turns it back on) is as before.
create or replace function public.ava_impersonation_check(p_call_id uuid, p_call_no bigint, p_transcript jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer; v_first text; v_hit text; v_why text; v_excerpt text; v_llm text; v_new boolean; v_fwd boolean := false;
begin
  select count(*) into v_n from jsonb_array_elements(coalesce(p_transcript, '[]'::jsonb)) e
   where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '';
  if v_n = 0 then return; end if;
  select coalesce(forwarded, false) into v_fwd from ava_calls where id = p_call_id;

  select string_agg(msg, ' ' order by ord) into v_first from (
    select coalesce(e->>'message', '') as msg, ord from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
     where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '' order by ord limit 2) f;
  select left(coalesce(e->>'message', ''), 200) into v_hit from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
   where e->>'role' = 'agent' and coalesce(e->>'message', '') ~* '\m(this is|i''m|i am) jared(?![''’]s)\M'
   order by ord limit 1;

  if v_fwd then
    if v_first !~* '\massistant\M' or v_first !~* '\mrecorded\M' then
      v_why := 'forwarded call without "assistant" and "recorded line" in her first two lines'; v_excerpt := left(v_first, 200);
    end if;
  elsif v_first !~* '(\mai\M|artificial|\massistant\M)' then
    v_why := 'no disclosure in her first two lines'; v_excerpt := left(v_first, 200);
  end if;
  if v_hit is not null then
    v_why := coalesce(v_why || ' and ', '') || 'she said she was Jared'; v_excerpt := v_hit;
  end if;
  if v_why is null then return; end if;

  select llm into v_llm from ava_settings where id;
  insert into ava_reply_incidents (source, call_id, call_no, kind, subkind, excerpt, llm, healed)
  values ('ava', p_call_id, p_call_no, 'repeat', 'impersonation', v_excerpt, v_llm, 'voice mode switched off')
  on conflict (call_id, kind) do nothing
  returning true into v_new;
  if v_new is null then
    update ava_reply_incidents set excerpt = coalesce(excerpt, '') || ' | Voice mode: ' || v_why, healed = coalesce(healed, 'voice mode switched off')
     where call_id = p_call_id and kind = 'repeat' and coalesce(excerpt, '') not like '%Voice mode:%';
  end if;

  update ava_settings set jared_voice_paused_at = now(), jared_voice_paused_why = left('Call #' || coalesce(p_call_no::text, '?') || ': ' || v_why, 200)
   where id and jared_voice_paused_at is null;

  perform scout_notify('Ava (assistant): voice mode broke the rules on call #' || coalesce(p_call_no::text, '?'),
    'Speaking in your voice, ' || v_why || '. Voice mode is off until you turn it back on at /admin/ava.', 'high', true,
    'https://bestly.tech/admin/ava', 'ava-impersonation-' || p_call_id::text);
exception when others then
  raise warning 'ava_impersonation_check failed: %', sqlerrm;
end $function$;
revoke execute on function public.ava_impersonation_check(uuid, bigint, jsonb) from public, anon, authenticated;

-- ---------- watchdog: forwarding is on but nothing has ever been detected ----------
create or replace function public.ava_watch()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_stuck int; s ava_settings;
begin
  select * into s from ava_settings where id;
  with x as (update ava_calls set status = 'failed', summary = coalesce(summary, '[watchdog: no report after 30 min]')
              where status in ('queued', 'in_progress') and created_at < now() - interval '30 minutes' returning id)
  select count(*) into v_stuck from x;
  if s.agent_id is null or s.phone_number_id is null then
    perform bestly_raise('ava.assistant', 'problem', 'warning', 'Ava (personal) is not answering her line',
      'Her voice agent or phone number is not set up. Open /admin/ava and run Setup.', 'ava', null, true);
  elsif v_stuck >= 3 then
    perform bestly_raise('ava.assistant', 'problem', 'warning', 'Ava (personal) calls not reporting back',
      format('%s calls never got a post-call report. Check the Ava webhook in ElevenLabs.', v_stuck), 'ava', null, true);
  else
    perform bestly_raise('ava.assistant', 'resolved', 'info', 'Ava (personal) healthy', null, 'ava');
  end if;

  -- forwarding: on for 48 hours and not one call marked as forwarded. Once per time Jared turns it on.
  if s.forward_enabled and s.forward_enabled_at is not null and s.forward_enabled_at < now() - interval '48 hours'
     and not exists (select 1 from ava_calls where forwarded and created_at >= s.forward_enabled_at) then
    perform scout_notify('Ava (assistant): forwarded calls aren''t being detected yet',
      'Missed-call forwarding has been on for over 2 days and no call has been marked Forwarded. If nobody missed-called you, ignore this. '
      || 'If someone did, the phone company may not be passing the forwarding details. The last payloads are saved in the debug log; ask Claude to read it and fix the detection.',
      'info', true, 'https://bestly.tech/admin/ava', 'ava-forward-undetected-' || to_char(s.forward_enabled_at, 'YYYYMMDDHH24MISS'));
  end if;

  -- line check: Telnyx routing, incoming calls on, init webhook set. Heals itself by re-running setup. Also retries evidence copies.
  begin perform invoke_edge_function('ava-assistant', '{"action":"health"}'::jsonb, 150000);
  exception when others then null; end;
  return jsonb_build_object('stuck_fixed', v_stuck);
end $function$;
