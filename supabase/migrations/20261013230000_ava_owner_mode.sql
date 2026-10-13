-- 2026-10-13 Ava owner mode (docs/ava-owner-mode-opusplan.md).
-- Jared calls from his own cell: owner mode is automatic (ava-assistant init hook sets caller_is_jared, the workflow skips the
-- greeting node). A spoken PIN is only the backup for another phone or a web call: the verify_owner tool posts what he said to
-- ava-admin /verify, which turns every way a PIN can be heard into digits and compares them to a salted hash in Vault.
-- The PIN itself is never in this file, a prompt, a procedure, a log or a memory row: it is set from the Owner PIN card on
-- /admin/ava (ava_owner_pin_set, admin only, writes straight to Vault). This migration contains no digits of it.
--
-- 1. snapshots of Ava's dashboard config (so a change to her prompt / workflow / procedures can be put back)
-- 2. owner PIN state: meta (set-at time, lock), attempts (3 a call, 10 a day, 30 minute lock), owner sessions (a call that proved the PIN)
-- 3. RPCs: probe / result / health / crypt (service role only), set / status (admin only)
-- 4. team card refreshed (same slug, same owner: Ava)

-- ------------------------------------------------------------------ 1. snapshots
alter table public.ava_admin_bridge_state add column if not exists snapshots jsonb not null default '[]'::jsonb;
comment on column public.ava_admin_bridge_state.snapshots is
  'Newest-first list of Ava dashboard config snapshots {id, at, version_id, seq, label, prompt, workflow, procedures, guardrails, tool_ids}. Any 6-digit PIN near "PIN"/"passcode" is redacted before it is stored.';

-- ------------------------------------------------------------------ 2. PIN state
create table if not exists public.ava_owner_pin_meta (
  id            boolean primary key default true check (id),
  set_at        timestamptz,
  set_by        uuid,
  exposed       boolean not null default true,     -- true until Jared changes it from the card (the first one was typed in chat and sat in her prompt)
  lock_until    timestamptz,
  last_lock_at  timestamptz,
  lock_reason   text
);
insert into public.ava_owner_pin_meta (id) values (true) on conflict (id) do nothing;

create table if not exists public.ava_owner_pin_attempts (
  id              bigint generated always as identity primary key,
  ts              timestamptz not null default now(),
  conversation_id text,
  scope           text not null default 'live' check (scope in ('live', 'selftest')),
  ok              boolean not null default false     -- written false BEFORE the compare, flipped to true on a match
);
create index if not exists ava_owner_pin_attempts_ts on public.ava_owner_pin_attempts (ts desc);
create index if not exists ava_owner_pin_attempts_conv on public.ava_owner_pin_attempts (conversation_id, scope, ts desc);

create table if not exists public.ava_owner_sessions (
  conversation_id text primary key,
  verified_at     timestamptz not null default now(),
  via             text not null default 'pin'
);

alter table public.ava_owner_pin_meta enable row level security;
alter table public.ava_owner_pin_attempts enable row level security;
alter table public.ava_owner_sessions enable row level security;
revoke all on public.ava_owner_pin_meta, public.ava_owner_pin_attempts, public.ava_owner_sessions from anon, authenticated;
grant select on public.ava_owner_pin_attempts to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ava_owner_pin_attempts' and policyname = 'ava_owner_pin_attempts_admin_read') then
    create policy ava_owner_pin_attempts_admin_read on public.ava_owner_pin_attempts for select to authenticated
      using (coalesce(public.has_role(auth.uid(), 'admin'::app_role), false));
  end if;
end $$;
-- meta and sessions: no policy and no grant = service role only (the card reads through ava_owner_pin_status)

-- ------------------------------------------------------------------ 3a. service-only helpers
-- crypt() with a fresh or given salt (the selftest uses it on a random throwaway PIN, never the real one)
create or replace function public.ava_owner_pin_crypt(p_value text, p_salt text default null)
returns text language sql security definer set search_path = public, extensions as $$
  select extensions.crypt(p_value, coalesce(p_salt, extensions.gen_salt('bf', 10)))
$$;
revoke all on function public.ava_owner_pin_crypt(text, text) from public, anon, authenticated;
grant execute on function public.ava_owner_pin_crypt(text, text) to service_role;

-- is a PIN set, and is it a bcrypt hash (never returns the hash)
create or replace function public.ava_owner_pin_health()
returns jsonb language plpgsql stable security definer set search_path = public, vault, extensions as $$
declare v text; m public.ava_owner_pin_meta;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'ava_owner_pin' limit 1;
  select * into m from public.ava_owner_pin_meta where id;
  return jsonb_build_object('set', coalesce(v, '') <> '', 'wellformed', coalesce(v, '') ~ '^\$2[aby]\$10\$.{53}$',
    'set_at', m.set_at, 'exposed', m.exposed, 'locked', coalesce(m.lock_until > now(), false), 'lock_until', m.lock_until);
end $$;
revoke all on function public.ava_owner_pin_health() from public, anon, authenticated;
grant execute on function public.ava_owner_pin_health() to service_role;

-- Step 1 of a try. Checks the lock and the limits, writes the attempt row as a FAILURE first (so a crash mid-compare cannot be
-- retried for free), then hands back crypt(candidate, stored) for each candidate so the edge function can compare in constant time.
-- scope 'selftest' (the hourly stub) has its own counters, a 10 minute window and never touches the real lock.
create or replace function public.ava_owner_pin_probe(p_conv text, p_scope text, p_candidates text[])
returns jsonb language plpgsql security definer set search_path = public, vault, extensions as $$
declare v text; m public.ava_owner_pin_meta; fails_call int; fails_day int; att bigint; c text; hs text[] := '{}';
begin
  if p_scope not in ('live', 'selftest') then p_scope := 'live'; end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = 'ava_owner_pin' limit 1;
  if coalesce(v, '') = '' then return jsonb_build_object('status', 'unset'); end if;
  select * into m from public.ava_owner_pin_meta where id;
  if p_scope = 'live' and m.lock_until is not null and m.lock_until > now() then
    return jsonb_build_object('status', 'locked', 'lock_until', m.lock_until);
  end if;
  select count(*) into fails_call from public.ava_owner_pin_attempts
   where conversation_id = p_conv and scope = p_scope and not ok and (p_scope = 'live' or ts > now() - interval '10 minutes');
  if fails_call >= 3 then return jsonb_build_object('status', 'locked_call'); end if;
  if p_scope = 'live' then
    select count(*) into fails_day from public.ava_owner_pin_attempts
     where scope = 'live' and not ok and ts > greatest(now() - interval '24 hours', coalesce(m.last_lock_at, '-infinity'::timestamptz));
    if fails_day >= 10 then
      update public.ava_owner_pin_meta set lock_until = now() + interval '30 minutes', last_lock_at = now(), lock_reason = 'daily' where id;
      return jsonb_build_object('status', 'locked', 'lock_until', now() + interval '30 minutes');
    end if;
  end if;
  insert into public.ava_owner_pin_attempts (conversation_id, scope, ok) values (p_conv, p_scope, false) returning id into att;
  foreach c in array coalesce(p_candidates, '{}') loop
    if c ~ '^[0-9]{6}$' then hs := hs || extensions.crypt(c, v); end if;
  end loop;
  return jsonb_build_object('status', 'ready', 'attempt_id', att, 'stored', v, 'hashes', to_jsonb(hs), 'tries_left', greatest(0, 2 - fails_call));
end $$;
revoke all on function public.ava_owner_pin_probe(text, text, text[]) from public, anon, authenticated;
grant execute on function public.ava_owner_pin_probe(text, text, text[]) to service_role;

-- Step 2: the verdict. A match flips the attempt and (live scope) marks the call as an owner call for 2 hours.
-- A third miss on one call, or the tenth of the day, locks the PIN for 30 minutes and leaves a note signed Ava.
-- (Old attempt and session rows are trimmed by ava-admin /verify, not here.)
create or replace function public.ava_owner_pin_result(p_attempt bigint, p_ok boolean)
returns jsonb language plpgsql security definer set search_path = public, vault, extensions as $$
declare a public.ava_owner_pin_attempts; m public.ava_owner_pin_meta; fails_call int; fails_day int; locked boolean := false; why text;
begin
  select * into a from public.ava_owner_pin_attempts where id = p_attempt;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'no_attempt'); end if;
  if p_ok then
    update public.ava_owner_pin_attempts set ok = true where id = a.id;
    if a.scope = 'live' then
      insert into public.ava_owner_sessions (conversation_id, verified_at, via) values (a.conversation_id, now(), 'pin')
      on conflict (conversation_id) do update set verified_at = now();
      if exists (select 1 from public.monitor_issues where key = 'ava.admin-bridge.pin-lock' and status = 'open') then
        perform public.bestly_raise('ava.admin-bridge.pin-lock', 'resolved', 'info', 'the owner PIN is open again', null, 'ava');
      end if;
    end if;
    return jsonb_build_object('ok', true);
  end if;
  select count(*) into fails_call from public.ava_owner_pin_attempts
   where conversation_id = a.conversation_id and scope = a.scope and not ok and (a.scope = 'live' or ts > now() - interval '10 minutes');
  if a.scope = 'live' then
    select * into m from public.ava_owner_pin_meta where id;
    select count(*) into fails_day from public.ava_owner_pin_attempts
     where scope = 'live' and not ok and ts > greatest(now() - interval '24 hours', coalesce(m.last_lock_at, '-infinity'::timestamptz));
    if fails_call >= 3 or fails_day >= 10 then
      locked := true; why := case when fails_call >= 3 then 'three wrong tries on one call' else 'ten wrong tries in a day' end;
      update public.ava_owner_pin_meta set lock_until = now() + interval '30 minutes', last_lock_at = now(), lock_reason = why where id;
      perform public.bestly_raise('ava.admin-bridge.pin-lock', 'problem', 'warning', 'I locked the owner PIN for 30 minutes',
        'Someone got the owner PIN wrong (' || why || ') on a call to me at ' || to_char(now() at time zone 'America/Los_Angeles', 'FMHH12:MI AM') ||
        ' Pacific. Nothing was opened. It unlocks by itself at ' || to_char((now() + interval '30 minutes') at time zone 'America/Los_Angeles', 'FMHH12:MI AM') ||
        ' Pacific; calling from your own cell still works. If that was not you, change the PIN on the Ava page.', 'ava');
    end if;
  elsif fails_call >= 3 then
    locked := true;
  end if;
  return jsonb_build_object('ok', false, 'locked', locked, 'tries_left', greatest(0, 3 - fails_call));
end $$;
revoke all on function public.ava_owner_pin_result(bigint, boolean) from public, anon, authenticated;
grant execute on function public.ava_owner_pin_result(bigint, boolean) to service_role;

-- ------------------------------------------------------------------ 3b. the Owner PIN card on /admin/ava (admin session only)
create or replace function public.ava_owner_pin_set(p_pin text)
returns timestamptz language plpgsql security definer set search_path = public, vault, extensions as $$
declare v_id uuid; v_hash text;
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then raise exception 'Admins only'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then raise exception 'The PIN is six digits'; end if;
  v_hash := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));
  select id into v_id from vault.secrets where name = 'ava_owner_pin';
  if v_id is null then perform vault.create_secret(v_hash, 'ava_owner_pin', 'Ava owner PIN: bcrypt hash only. Set from the Owner PIN card on /admin/ava.');
  else perform vault.update_secret(v_id, v_hash); end if;
  update public.ava_owner_pin_meta set set_at = now(), set_by = auth.uid(), exposed = false, lock_until = null, last_lock_at = now(), lock_reason = null where id;
  update public.ava_owner_sessions set verified_at = '-infinity'::timestamptz where conversation_id is not null;   -- every call that proved the old PIN has to prove the new one
  return now();
end $$;
revoke all on function public.ava_owner_pin_set(text) from public, anon;
grant execute on function public.ava_owner_pin_set(text) to authenticated, service_role;

-- what the card shows: when it was set, whether it is the exposed original, whether it is locked. Never the PIN or the hash.
create or replace function public.ava_owner_pin_status()
returns jsonb language plpgsql stable security definer set search_path = public, vault as $$
declare m public.ava_owner_pin_meta; v text; f int; lastok timestamptz;
begin
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then raise exception 'Admins only'; end if;
  select * into m from public.ava_owner_pin_meta where id;
  select decrypted_secret into v from vault.decrypted_secrets where name = 'ava_owner_pin' limit 1;
  select count(*) into f from public.ava_owner_pin_attempts where scope = 'live' and not ok and ts > now() - interval '24 hours';
  select max(ts) into lastok from public.ava_owner_pin_attempts where scope = 'live' and ok;
  return jsonb_build_object('set', coalesce(v, '') <> '', 'set_at', m.set_at, 'exposed', m.exposed,
    'locked_until', case when m.lock_until > now() then m.lock_until end, 'failed_24h', f, 'last_verified_at', lastok);
end $$;
revoke all on function public.ava_owner_pin_status() from public, anon;
grant execute on function public.ava_owner_pin_status() to authenticated, service_role;

-- ------------------------------------------------------------------ 4. team card: same slug, same owner (Ava), same pulse job
select public.team_onboard('[{
  "slug": "ava-admin-bridge",
  "name": "Admin Bridge",
  "role": "Ava''s line into the admin",
  "what_it_does": "Lets Ava answer Jared when he calls and asks about the business: what needs him, how the agents did today, what is broken, and start or pause Maya''s campaigns or place one call. For issues she can list what is open, send one back up the Fix Ladder (Try again), or hand Scout a read-only question and read the answer back (10 a day, writes stay blocked). She can never approve or undo a fix herself: when he says yes do it, she sends a request to his phone (bestly.tech/y/code) and he taps it and confirms with Face ID in his signed-in admin; only then does the fix run. Owner mode is automatic when Jared calls from his own cell (no greeting, no code). From another phone or the web he can say a PIN once: the verify_owner tool turns however it was heard into digits and checks a salted hash in Vault (3 tries a call, 10 a day, then locked 30 minutes with a note signed Ava); that unlocks status, numbers, call ops and the fix list, but approving or undoing a fix still needs his own phone and Face ID. The PIN is set from the Owner PIN card on /admin/ava and is never in her prompt. Checks itself hourly at :17 (the tools are still on Ava including verify_owner, the shared secret still matches, the answers are fast, an approve never runs, no PIN-looking number has crept into her prompt, procedures or workflow, the Jared path still skips the greeting, the PIN check still works end to end); fixes what it can and tells Jared as Ava if it cannot. Log of the last actions is on /admin/ava.",
  "tool_of": "ava",
  "runs_on": "cloud",
  "schedule": "live on every call Jared makes to Ava; self-test hourly at :17",
  "icon": "plug",
  "admin_url": "/admin/ava",
  "sort": 60,
  "pulse": {"src": "cron", "job": "ava-admin-bridge-selftest", "gap": 130}
}]'::jsonb);
