-- Dynamic next-action buttons on messages (2026-10-05), both Avas.
-- The voice platform's own post-call analysis (no extra AI spend) now also returns: intent, counterpart_business, counterpart_phone,
-- appointment_purpose, preferred_times, next_actions, and (outbound booking calls) booked_slot. They are stored on the call rows, and a
-- trigger turns intent into rows of ava_actions that the message list and call sheets show as pill buttons:
--   appointment -> "Find times that work"   callback -> "Call back"   question -> "Reply by call"   always -> "Done" and "Dismiss"
-- Nothing here dials. Every call still waits for Jared's tap.

alter table public.ava_calls
  add column if not exists intent text,
  add column if not exists counterpart_business text,
  add column if not exists counterpart_phone text,
  add column if not exists appointment_purpose text,
  add column if not exists preferred_times text,
  add column if not exists next_actions text,
  add column if not exists booked_slot text,
  add column if not exists booking jsonb;
alter table public.ava_calls add constraint ava_calls_intent_check
  check (intent is null or intent in ('appointment', 'callback', 'question', 'info_only', 'spam', 'other'));

alter table public.rg_calls
  add column if not exists intent text,
  add column if not exists counterpart_business text,
  add column if not exists counterpart_phone text,
  add column if not exists appointment_purpose text,
  add column if not exists preferred_times text,
  add column if not exists next_actions text;
alter table public.rg_calls add constraint rg_calls_intent_check
  check (intent is null or intent in ('appointment', 'callback', 'question', 'info_only', 'spam', 'other'));

create table if not exists public.ava_actions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ava', 'roofguard')),
  call_id uuid not null,                       -- ava_calls.id or rg_calls.id
  kind text not null check (kind in ('find_times', 'call_back', 'reply_by_call', 'done', 'dismiss')),
  label text not null,
  payload jsonb not null default '{}'::jsonb,  -- phone, name, business, purpose, preferred_times, appointment_purpose, message, intent
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, call_id, kind)
);
create index if not exists ava_actions_open on public.ava_actions (source, status, created_at desc);
create index if not exists ava_actions_call on public.ava_actions (call_id);
alter table public.ava_actions enable row level security;
create policy "admin ava_actions" on public.ava_actions for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
grant select, update on public.ava_actions to authenticated;

create or replace function public.ava_actions_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger ava_actions_touch before update on public.ava_actions for each row execute function public.ava_actions_touch();

-- one place that decides which buttons a call gets
create or replace function public.ava_actions_make(p_source text, p_call_id uuid, p_intent text, p_phone text, p_name text, p_business text,
                                                   p_message text, p_appt text, p_times text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_who text; v_msg text; v_payload jsonb; v_purpose text;
begin
  if p_intent is null or p_intent in ('spam') then return; end if;
  v_who := coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_business), ''), 'them');
  v_msg := left(regexp_replace(coalesce(p_message, ''), '\s+', ' ', 'g'), 240);
  if p_intent = 'appointment' then
    v_purpose := coalesce(nullif(btrim(p_appt), ''), 'a meeting with Jared');
  elsif p_intent = 'callback' then
    v_purpose := 'Calling ' || v_who || ' back about their message to Jared' || case when v_msg <> '' then ': "' || v_msg || '"' else '' end
      || '. Check you have it right and ask if there is anything to add. Do not promise what Jared will do or when; say you will pass it on.';
  elsif p_intent = 'question' then
    v_purpose := 'Calling ' || v_who || ' back to answer their question' || case when v_msg <> '' then ': "' || v_msg || '"' else '' end
      || '. Answer only from what you can share; for anything else say you will pass it on.';
  end if;
  v_payload := jsonb_build_object('phone', p_phone, 'name', v_who, 'business', p_business, 'purpose', left(coalesce(v_purpose, ''), 580),
    'appointment_purpose', p_appt, 'preferred_times', p_times, 'message', v_msg, 'intent', p_intent);

  if p_intent = 'appointment' then
    insert into ava_actions (source, call_id, kind, label, payload) values (p_source, p_call_id, 'find_times', 'Find times that work', v_payload)
    on conflict (source, call_id, kind) do nothing;
  elsif p_intent = 'callback' then
    insert into ava_actions (source, call_id, kind, label, payload) values (p_source, p_call_id, 'call_back', 'Call back', v_payload)
    on conflict (source, call_id, kind) do nothing;
  elsif p_intent = 'question' then
    insert into ava_actions (source, call_id, kind, label, payload) values (p_source, p_call_id, 'reply_by_call', 'Reply by call', v_payload)
    on conflict (source, call_id, kind) do nothing;
  end if;
  insert into ava_actions (source, call_id, kind, label, payload) values (p_source, p_call_id, 'done', 'Done', v_payload)
  on conflict (source, call_id, kind) do nothing;
  insert into ava_actions (source, call_id, kind, label, payload) values (p_source, p_call_id, 'dismiss', 'Dismiss', v_payload)
  on conflict (source, call_id, kind) do nothing;
end $function$;
revoke execute on function public.ava_actions_make(text, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.ava_calls_actions_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.intent is not null and new.direction = 'inbound' and coalesce(new.is_spam, false) = false and new.deleted_at is null then
    perform ava_actions_make('ava', new.id, new.intent, coalesce(new.counterpart_phone, new.callback_number, new.phone), new.caller_name,
                             new.counterpart_business, coalesce(new.message, new.summary), new.appointment_purpose, new.preferred_times);
  end if;
  return new;
exception when others then
  raise warning 'ava_calls_actions_trg failed: %', sqlerrm;
  return new;
end $function$;
create trigger ava_calls_actions after insert or update of intent on public.ava_calls
  for each row execute function public.ava_calls_actions_trg();

create or replace function public.rg_calls_actions_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.intent is not null and new.direction = 'inbound' and new.deleted_at is null then
    perform ava_actions_make('roofguard', new.id, new.intent, coalesce(new.counterpart_phone, new.callback_number, new.to_number), new.caller_name,
                             new.counterpart_business, coalesce(new.message, new.summary), new.appointment_purpose, new.preferred_times);
  end if;
  return new;
exception when others then
  raise warning 'rg_calls_actions_trg failed: %', sqlerrm;
  return new;
end $function$;
create trigger rg_calls_actions after insert or update of intent on public.rg_calls
  for each row execute function public.rg_calls_actions_trg();
