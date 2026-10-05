-- Ava voice picker + Jared's voice clone (2026-10-05). See docs/ava-voice-clone-opusplan.md.
--
-- Part A (both Avas, keyed by source): a daily counter for "Hear her say..." sample plays (cap 40 per Pacific day per Ava).
-- Part B (personal Ava only): the clone's id and switches on ava_settings, a per-call tag on ava_calls, a private storage
-- bucket for the raw recording (removed right after the clone exists), and the impersonation guard.
-- No existing constraint is changed: the guard reuses ava_reply_incidents.kind = 'repeat' with subkind = 'impersonation'.

-- ---------- A. sample-play counter ----------
create table if not exists public.ava_voice_usage (
  source text not null check (source in ('ava', 'roofguard')),
  day date not null,
  says integer not null default 0,
  primary key (source, day)
);
alter table public.ava_voice_usage enable row level security;
create policy "admin read ava_voice_usage" on public.ava_voice_usage for select using (public.has_role(auth.uid(), 'admin'));
grant select on public.ava_voice_usage to authenticated;

-- Takes one sample play. ok = false once today's cap is used up. Pacific day. Edge functions only (service role).
create or replace function public.ava_voice_say_take(p_source text, p_cap integer default 40)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_day date := (now() at time zone 'America/Los_Angeles')::date; v_n integer;
begin
  if p_source not in ('ava', 'roofguard') then raise exception 'unknown source %', p_source; end if;
  insert into ava_voice_usage (source, day, says) values (p_source, v_day, 0) on conflict (source, day) do nothing;
  update ava_voice_usage set says = says + 1 where source = p_source and day = v_day and says < p_cap returning says into v_n;
  if v_n is null then
    select says into v_n from ava_voice_usage where source = p_source and day = v_day;
    return jsonb_build_object('ok', false, 'says', v_n, 'cap', p_cap);
  end if;
  return jsonb_build_object('ok', true, 'says', v_n, 'cap', p_cap);
end $function$;
revoke execute on function public.ava_voice_say_take(text, integer) from public, anon, authenticated;

-- ---------- B. Jared's voice ----------
alter table public.ava_settings add column if not exists jared_voice_id text;
alter table public.ava_settings add column if not exists jared_voice_for_contacts boolean not null default false;
-- set by the impersonation guard: voice mode stays off until Jared turns it back on
alter table public.ava_settings add column if not exists jared_voice_paused_at timestamptz;
alter table public.ava_settings add column if not exists jared_voice_paused_why text;
alter table public.ava_calls add column if not exists voice text not null default 'ava';
alter table public.ava_calls add constraint ava_calls_voice_check check (voice in ('ava', 'jared'));

-- private bucket for the raw recording: admins only; the edge function removes the file once the clone exists
insert into storage.buckets (id, name, public, file_size_limit) values ('ava-voice', 'ava-voice', false, 26214400) on conflict (id) do nothing;
create policy "ava voice: admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'ava-voice' and public.has_role(auth.uid(), 'admin'));
create policy "ava voice: admin writes" on storage.objects for insert to authenticated
  with check (bucket_id = 'ava-voice' and public.has_role(auth.uid(), 'admin'));
create policy "ava voice: admin deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'ava-voice' and public.has_role(auth.uid(), 'admin'));

-- ---------- impersonation guard ----------
-- In a voice-mode call (voice = 'jared'): no disclosure in her first two lines, or "this is Jared" / "I'm Jared" anywhere
-- (Jared's own name with 's is fine: "Jared's AI assistant"). Hit = high Scout alert + voice mode off until Jared turns it on.
create or replace function public.ava_impersonation_check(p_call_id uuid, p_call_no bigint, p_transcript jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer; v_first text; v_hit text; v_why text; v_excerpt text; v_llm text; v_new boolean;
begin
  select count(*) into v_n from jsonb_array_elements(coalesce(p_transcript, '[]'::jsonb)) e
   where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '';
  if v_n = 0 then return; end if;

  select string_agg(msg, ' ' order by ord) into v_first from (
    select coalesce(e->>'message', '') as msg, ord from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
     where e->>'role' = 'agent' and coalesce(e->>'message', '') <> '' order by ord limit 2) f;
  select left(coalesce(e->>'message', ''), 200) into v_hit from jsonb_array_elements(p_transcript) with ordinality x(e, ord)
   where e->>'role' = 'agent' and coalesce(e->>'message', '') ~* '\m(this is|i''m|i am) jared(?![''’]s)\M'
   order by ord limit 1;

  if v_first !~* '(\mai\M|artificial|\massistant\M)' then
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
    -- the call already has a "repeat" row: add the finding to it (once)
    update ava_reply_incidents set excerpt = coalesce(excerpt, '') || ' | Voice mode: ' || v_why, healed = coalesce(healed, 'voice mode switched off')
     where call_id = p_call_id and kind = 'repeat' and coalesce(excerpt, '') not like '%Voice mode:%';
  end if;

  update ava_settings set jared_voice_paused_at = now(), jared_voice_paused_why = left('Call #' || coalesce(p_call_no::text, '?') || ': ' || v_why, 200)
   where id and jared_voice_paused_at is null;

  perform scout_notify('Ava (assistant): voice mode broke the rules on call #' || coalesce(p_call_no::text, '?'),
    'Speaking in your voice, ' || v_why || '. Voice mode is off until you turn it back on at /admin/ava.', 'high', true,
    'https://bestly.tech/admin/ava', 'ava-impersonation-' || p_call_id::text);
exception when others then
  -- the guard must never break call logging
  raise warning 'ava_impersonation_check failed: %', sqlerrm;
end $function$;
revoke execute on function public.ava_impersonation_check(uuid, bigint, jsonb) from public, anon, authenticated;

-- personal Ava's trigger: same as before, plus the impersonation check on voice-mode calls
create or replace function public.ava_calls_reply_guard_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare s ava_settings;
begin
  if new.transcript is not null and (tg_op = 'INSERT' or old.transcript is distinct from new.transcript) then
    perform ava_reply_guard('ava', new.id, new.call_no, new.transcript);
    if new.voice = 'jared' then
      perform ava_impersonation_check(new.id, new.call_no, new.transcript);
    end if;
    select * into s from ava_settings where id;
    if new.direction = 'inbound' and new.contact_id is null and new.phone is distinct from coalesce(s.jared_cell, '+18165007236') then
      perform ava_long_call_check('ava', new.id, new.call_no, new.duration_sec,
        coalesce(new.message, '') <> '' or coalesce(new.callback_wanted, false) or new.callback_number is not null,
        coalesce(new.duration_sec, 0) / 60.0 * s.cost_voice_per_min + ceil(coalesce(new.duration_sec, 0) / 60.0) * s.cost_phone_per_min + coalesce(new.llm_cost, 0));
    end if;
  end if;
  return new;
end $function$;
