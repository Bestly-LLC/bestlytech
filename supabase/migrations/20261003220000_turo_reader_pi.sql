-- 2026-10-03 Opus plan (docs/pi-move-opusplan-2026-10-03.md): the Pi reads Turo (trips + inbox) in plain Chromium and
-- the wall shows the same Turo events as Jared's phone: new booking, guest message, trip changed/extended, cancelled.
-- Also: demo key stops piling up pending Tesla invites; shortcut pings no longer pop false "New booking" cards.
-- Applied live on 2026-10-03 (apply_migration: demo_key_revoke_before_rotate, wall_turo_ping_classify,
-- turo_reader_pi_tables; the rest via execute_sql). This file is the record.

-- ---------------------------------------------------------------- reader state + inbox
create table if not exists public.turo_reader_state (
  id int primary key default 1 check (id = 1),
  seen_at timestamptz, signed_in boolean, last_error text, version text,
  last_trips_at timestamptz, last_inbox_at timestamptz, poke_at timestamptz,
  updated_at timestamptz default now()
);
insert into public.turo_reader_state (id) values (1) on conflict do nothing;
alter table public.turo_reader_state enable row level security;
revoke all on public.turo_reader_state from anon, authenticated;

create table if not exists public.turo_inbox (
  message_id text primary key, conversation_id text, reservation_id bigint, sent_at timestamptz,
  role text, author text, body text, change_pending boolean,
  first_seen_at timestamptz not null default now(), shown_at timestamptz
);
create index if not exists turo_inbox_sent_idx on public.turo_inbox (sent_at desc);
alter table public.turo_inbox enable row level security;
revoke all on public.turo_inbox from anon, authenticated;

alter table public.wall_turo_pings add column if not exists kind text;

-- ---------------------------------------------------------------- wall card for any Turo event
create or replace function public.wall_turo_notice(p_kind text, p_eye text, p_title text, p_text text default null, p_res bigint default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform wall_sig_broadcast('turo_notice', jsonb_build_object('kind', p_kind, 'eye', left(p_eye, 60), 'title', left(p_title, 120),
    'text', left(p_text, 240), 'id', coalesce(p_res::text, '') || '-' || p_kind || '-' || extract(epoch from now())::bigint));
exception when others then null;
end $$;

-- ---------------------------------------------------------------- Pi reader RPCs (worker token)
create or replace function public.turo_reader_note(p_token text, p_signed_in boolean, p_error text default null,
  p_trips boolean default false, p_inbox boolean default false, p_version text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare st turo_reader_state;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update turo_reader_state set seen_at = now(), signed_in = coalesce(p_signed_in, signed_in),
    last_error = case when p_signed_in is null then last_error else left(p_error, 300) end,
    version = coalesce(p_version, version),
    last_trips_at = case when p_trips then now() else last_trips_at end,
    last_inbox_at = case when p_inbox then now() else last_inbox_at end, updated_at = now()
  where id = 1 returning * into st;
  if p_trips then
    update turo_sender_settings set last_ingest_at = now(), last_ingest = jsonb_build_object('source', 'pi', 'at', now()), updated_at = now() where id = 1;
  end if;
  return jsonb_build_object('poke', st.poke_at is not null and st.poke_at > coalesce(st.last_trips_at, 'epoch'));
end $$;

create or replace function public.turo_reader_fresh(p_token text) returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  return exists (select 1 from turo_reader_state where id = 1 and signed_in and last_trips_at > now() - interval '10 minutes');
end $$;

create or replace function public.turo_inbox_put(p_token text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare x jsonb; m jsonb; n int; n_shown int := 0; v_role text; v_sent timestamptz; v_author text; v_body text;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  for x in select v from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) v loop
    m := x->'mostRecentMessage';
    continue when m is null or m->>'id' is null;
    v_role := upper(coalesce(m->>'authorDriverRole', ''));
    v_sent := to_timestamp(((m->>'sent')::numeric) / 1000.0);
    v_author := m->'author'->>'firstName';
    v_body := btrim(regexp_replace(coalesce(m->>'text', ''), '\s+', ' ', 'g'));
    insert into turo_inbox (message_id, conversation_id, reservation_id, sent_at, role, author, body, change_pending)
    values (m->>'id', x->>'conversationId', nullif(x->'reservation'->>'id','')::bigint, v_sent, v_role, v_author, v_body,
            coalesce((x->'reservation'->>'hasPendingChangeRequest')::boolean, false))
    on conflict (message_id) do nothing;
    get diagnostics n = row_count;
    if n > 0 and v_role = 'GUEST' and v_sent > now() - interval '30 minutes' then
      if v_body = '' then
        v_body := case when coalesce(jsonb_array_length(m->'media'->'images'), 0) > 0 then 'Sent a photo' else 'New message' end;
      end if;
      perform wall_turo_notice('message', 'Message from ' || coalesce(v_author, 'your guest'),
        case when length(v_body) <= 70 then v_body else left(v_body, 67) || '...' end,
        case when length(v_body) > 70 then left(v_body, 240) end,
        nullif(x->'reservation'->>'id','')::bigint);
      update turo_inbox set shown_at = now() where message_id = m->>'id';
      n_shown := n_shown + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'shown', n_shown);
end $$;

-- ---------------------------------------------------------------- trip changed / extended / cancelled
create or replace function public.wall_turo_trip_change() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare f text := 'Dy, Mon DD FMHH12:MI AM'; who text;
begin
  if tg_op <> 'UPDATE' then return old; end if;
  if new.reservation_id <= 0 or new.ends_at < now() then return new; end if;
  who := coalesce(new.guest_first, 'Your guest');
  if new.ends_at is distinct from old.ends_at and new.starts_at = old.starts_at then
    perform wall_turo_notice('change', case when new.ends_at > old.ends_at then 'Trip extended' else 'Trip shortened' end,
      who || ' now returns ' || to_char(new.ends_at at time zone 'America/Los_Angeles', f), null, new.reservation_id);
  elsif new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    perform wall_turo_notice('change', 'Trip changed', who || ' moved their trip',
      'Pickup ' || to_char(new.starts_at at time zone 'America/Los_Angeles', f) || ', return ' || to_char(new.ends_at at time zone 'America/Los_Angeles', f), new.reservation_id);
  end if;
  return new;
exception when others then return coalesce(new, old);
end $$;
create or replace trigger wall_turo_trip_change after update of starts_at, ends_at on public.turo_trips
  for each row execute function public.wall_turo_trip_change();

-- Cancellation = a future trip leaving the feed; turo-ingest calls this for each one it prunes.
create or replace function public.wall_turo_trip_cancelled(p_res bigint, p_first text, p_starts timestamptz, p_ends timestamptz)
returns void language plpgsql security definer set search_path to 'public' as $$
declare f text := 'Dy, Mon DD FMHH12:MI AM';
begin
  if p_res <= 0 or p_starts <= now() then return; end if;
  perform wall_turo_notice('cancel', 'Trip cancelled', coalesce(p_first, 'A guest') || '''s trip is off',
    'Was ' || to_char(p_starts at time zone 'America/Los_Angeles', f) || ' to ' || to_char(p_ends at time zone 'America/Los_Angeles', f), p_res);
end $$;
revoke all on function public.wall_turo_trip_cancelled(bigint, text, timestamptz, timestamptz) from anon, authenticated, public;

-- ---------------------------------------------------------------- iPhone shortcut ping: classify + poke the Pi
create or replace function public.wall_turo_ping_kind(t text) returns text language sql immutable as $$
  select case
    when coalesce(btrim(t),'') = '' then 'unknown'
    when t ~* 'cancel' then 'cancel'
    when t ~* '(modif|change[ds]? (their|the|your) trip|extend|extension|new (trip )?time)' then 'change'
    when t ~* '(sent you a message|new message|messaged|wrote|replied|: )' and t !~* 'booked' then 'message'
    when t ~* '(booked|new (trip|booking|reservation)|instant book|reserved)' then 'booking'
    when t ~* '(review|rated)' then 'review'
    when t ~* '(remind|starts? (soon|tomorrow|today)|ends? (soon|tomorrow|today)|check.?in|check.?out)' then 'reminder'
    else 'other' end
$$;

create or replace function public.wall_turo_ping(p_key text, p_text text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare k text; t text; g text; c text; m text[]; r public.wall_turo_pings; car text; v_kind text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'wall_turo_ping_key';
  if k is null or coalesce(p_key, '') <> k then raise exception 'bad key'; end if;
  update turo_reader_state set poke_at = now() where id = 1;   -- ask the Pi to read Turo right now
  if (select count(*) from wall_turo_pings where at > now() - interval '10 minutes') >= 6 then
    return jsonb_build_object('ok', false, 'error', 'slow down');
  end if;
  t := left(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]<>]', ' ', 'g'), 500);
  v_kind := wall_turo_ping_kind(t);
  m := regexp_match(t, '([A-Z][[:alpha:]''.-]{1,20})(?: [A-Z]\.?)? (?:has )?booked', 'i');
  if m is not null and lower(m[1]) not in ('you', 'trip', 'guest', 'new', 'turo', 'been', 'just') then g := initcap(m[1]); end if;
  m := regexp_match(t, 'your ([[:alnum:] -]{3,40}?)(?: for | from | on |[.!,]|$)', 'i');
  if m is not null then c := btrim(m[1]); end if;
  select coalesce(v.display_name, 'the Tesla') into car from turo_vehicle_state v order by v.observed_at desc nulls last limit 1;
  insert into wall_turo_pings (text, guest, car, kind) values (nullif(t, ''), g, coalesce(c, car), v_kind) returning * into r;
  if v_kind = 'booking' then
    perform wall_sig_broadcast('turo_booking', jsonb_build_object(
      'id', 'ping-' || r.id, 'guest', g, 'car', coalesce(c, car, 'the Tesla'), 'starts_at', null, 'ends_at', null,
      'days', null, 'earnings', null, 'ping', true));
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'kind', v_kind, 'guest', g, 'car', coalesce(c, car));
end $$;

-- ---------------------------------------------------------------- watchdog (admin Trip apps health + Scout)
create or replace function public.turo_reader_watchdog() returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare st turo_reader_state; mac_ok boolean;
begin
  select * into st from turo_reader_state where id = 1;
  select last_ingest_at > now() - interval '30 minutes' into mac_ok from turo_sender_settings where id = 1;
  if st.seen_at is null or st.seen_at < now() - interval '10 minutes' then
    perform trip_health_set('turo_reader', 'Pi Turo reader (bookings + messages)', case when mac_ok then 'warn' else 'fail' end,
      'Pi reader last checked in ' || coalesce(to_char(st.seen_at at time zone 'America/Los_Angeles', 'Mon DD FMHH12:MI AM'), 'never')
      || '. systemd restarts it.' || case when mac_ok then ' The Mac mini is syncing bookings meanwhile (no guest messages on the wall).' else ' The Mac mini fallback is not syncing either.' end, null);
  elsif st.signed_in is not true then
    perform trip_health_set('turo_reader', 'Pi Turo reader (bookings + messages)', case when mac_ok then 'warn' else 'fail' end,
      'Turo is signed out on the Pi. Sign in once at http://bestly-pi:6080/vnc.html?autoconnect=1&resize=scale (home Wi-Fi).'
      || case when mac_ok then ' The Mac mini is syncing bookings meanwhile.' else '' end, null);
  elsif st.last_error is not null then
    perform trip_health_set('turo_reader', 'Pi Turo reader (bookings + messages)', 'warn', st.last_error, null);
  else
    perform trip_health_set('turo_reader', 'Pi Turo reader (bookings + messages)', 'ok', null, null);
  end if;
  return to_jsonb(st);
end $$;
select cron.schedule('turo-reader-watchdog', '*/5 * * * *', 'select public.turo_reader_watchdog()');
