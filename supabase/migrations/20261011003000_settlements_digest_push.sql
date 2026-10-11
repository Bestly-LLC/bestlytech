-- Nickel digest push (2026-10-10). The 9:05 AM digest now carries lock-screen buttons: "Yes, file all" and "Open".
--
-- SWORN STATEMENT RULE: a Yes only approves the exact claims that were NAMED in that notification. Each digest freezes its
-- claim ids in settlement_digests.claim_ids; settlement_digest_approve approves only those ids, and only if they are still
-- 'ready' (a claim he skipped or that expired since is left alone, a claim that became Ready later is never touched).
-- The notification says what Yes means: "Yes = you swear you're in each class: <names>".
--
-- HOW A TAP FLOWS (the house pattern for actionable notifications, see bestly_memory house/wall/round3-audio-alarm-focus):
--   settlement_daily() -> settlement_digest_push() -> ha_push_enqueue (actions) -> ha_push_dispatch -> home_hub_commands
--   (target homeassistant, action notify) -> Home Assistant iOS notification with buttons.
--   Tap "Yes, file all" -> HA fires mobile_app_notification_action {action: "SETTLE_YES_<digest id>"} -> a listener on the Pi
--   (tools/settlement-digest/ha_action_listener.py) calls settlement_digest_action_t(token, digest, 'yes')
--   -> settlement_digest_approve -> claims 'approved' -> Mac mini filer takes them -> "Nickel: Filing N claims" push.
--   Tap the notification body or "Open" -> https://bestly.tech/admin/settlements?digest=<id>, one big confirm button
--   (settlement_digest_get / settlement_digest_confirm). That page path works with no Pi listener at all.
--
-- The web-push router (notify_route) cannot carry buttons (only HA can, and it sends only critical/live activities to HA),
-- so the digest goes straight to ha_push_enqueue and writes its own notify_ledger row and silent bell row, as the router does.
-- No DROP statements; everything is create or replace / if not exists.

create table if not exists public.settlement_digests (
  id uuid primary key default gen_random_uuid(),
  day date,
  claim_ids uuid[] not null default '{}',
  sent_at timestamptz default now(),
  acted_at timestamptz,
  action text,
  approved_n integer
);
alter table public.settlement_digests add column if not exists approved_n integer;
alter table public.settlement_digests enable row level security;
-- No policies: read through settlement_digest_get (admin) and written by the functions below.

-- ------------------------------------------------------------------ approve exactly the digest's claims
create or replace function public.settlement_digest_approve(p_digest uuid, p_via text default 'lockscreen') returns jsonb
language plpgsql security definer set search_path = public as $$
declare d settlement_digests; n int := 0; v_total int; v_title text; v_body text;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  select * into d from settlement_digests where id = p_digest for update;
  if not found then return jsonb_build_object('state', 'missing', 'n', 0); end if;
  if d.acted_at is not null then
    return jsonb_build_object('state', 'already', 'n', coalesce(d.approved_n, 0));
  end if;
  if d.sent_at < now() - interval '3 days' then
    return jsonb_build_object('state', 'expired', 'n', 0);
  end if;
  v_total := coalesce(cardinality(d.claim_ids), 0);

  -- Only the ids named in this digest, only if still Ready, still open and not past deadline.
  with u as (
    update settlement_claims c set status = 'approved', approved_at = now(), updated_at = now()
    from settlements s
    where s.id = c.settlement_id and c.id = any(d.claim_ids) and c.status = 'ready' and s.status = 'open'
      and (s.deadline is null or s.deadline >= v_today)
    returning c.id),
  l as (
    insert into settlement_events (claim_id, kind, detail)
    select id, 'approved', jsonb_build_object('by', 'jared', 'digest', p_digest, 'via', p_via) from u
    returning 1)
  select count(*) into n from u;

  update settlement_digests set acted_at = now(), action = coalesce(nullif(p_via, ''), 'lockscreen'), approved_n = n where id = p_digest;

  if p_via <> 'page' then
    if n > 0 then
      v_title := 'Filing ' || n || ' claim' || case when n = 1 then '' else 's' end;
      v_body := 'Approved from your lock screen. I will tell you if a site needs you to hit submit.'
                || case when n < v_total then ' ' || (v_total - n) || ' changed since the digest and were left out.' else '' end;
    else
      v_title := 'Nothing filed';
      v_body := 'Those claims changed since the digest (skipped or expired), so none were approved. Open the page to review.';
    end if;
    perform settlement_notify(v_title, v_body, 'digest', 'https://bestly.tech/admin/settlements', 'digestok.' || p_digest::text);
  end if;
  return jsonb_build_object('state', 'approved', 'n', n, 'total', v_total);
end $$;
revoke all on function public.settlement_digest_approve(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the push itself (buttons)
create or replace function public.settlement_digest_push(p_digest uuid, p_names text[], p_ask integer, p_needs integer) returns text
language plpgsql security definer set search_path = public as $$
declare n int := coalesce(cardinality(p_names), 0); v_list text; v_body text; v_title text;
  v_url text := 'https://bestly.tech/admin/settlements?digest=' || p_digest::text;
  v_tag text := 'settle.digest.' || p_digest::text; v_short text[];
begin
  if n = 0 then return 'none'; end if;
  -- "Apple iPhone Battery Class Action Settlement" -> "Apple iPhone Battery"; first 3 names only so nothing gets cut off.
  select coalesce(array_agg(coalesce(nullif(btrim(regexp_replace(x, '\s*(class action\s*)?settlement$', '', 'i')), ''), x)), '{}')
    into v_short from (select x from unnest(p_names) with ordinality t(x, i) order by i limit 3) q;
  v_list := case when n <= 1 then v_short[1]
                 when n = 2 then v_short[1] || ' and ' || v_short[2]
                 when n = 3 then v_short[1] || ', ' || v_short[2] || ' and ' || v_short[3]
                 else v_short[1] || ', ' || v_short[2] || ', ' || v_short[3] || ' and ' || (n - 3) || ' more' end;
  v_title := 'Nickel: ' || n || ' settlement' || case when n = 1 then '' else 's' end || ' ready to file';
  v_body := 'Yes = you swear you''re in each class: ' || v_list || '.'
            || case when n > 3 then ' Tap Open to see all ' || n || '.' else '' end
            || case when coalesce(p_ask, 0) > 0 then ' ' || p_ask || ' quick question' || case when p_ask = 1 then '' else 's' end || ' too.' else '' end;
  perform ha_push_enqueue(
    v_title, v_body, 'time-sensitive', 'Nickel', v_url, 'nickel', v_tag,
    jsonb_build_array(
      jsonb_build_object('action', 'SETTLE_YES_' || p_digest::text, 'title', 'Yes, file all', 'authenticationRequired', true),
      jsonb_build_object('action', 'URI', 'title', 'Open', 'uri', v_url)),
    null, false, now());
  begin
    insert into notify_ledger (dedupe_key, channel, level, title, source) values (v_tag, 'ha', 'time-sensitive', left(v_title, 200), 'Nickel');
  exception when others then null; end;
  begin
    insert into admin_notifications (kind, title, body, url, severity, dedupe_key, silent)
    values ('settlements', left(v_title, 200), left(v_body, 500), v_url, 'info', v_tag, true)
    on conflict (dedupe_key) do nothing;
  exception when others then null; end;
  return 'ha';
end $$;
revoke all on function public.settlement_digest_push(uuid, text[], integer, integer) from public, anon, authenticated;

-- ------------------------------------------------------------------ daily job: same as before, plus the digest row and buttons
create or replace function public.settlement_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_ready int; v_ask int; v_needs int; v_body text; v_soon record;
  v_ids uuid[]; v_names text[]; v_digest uuid; v_existing uuid;
begin
  update settlement_claims c set status = 'expired', updated_at = now() from settlements s
   where s.id = c.settlement_id and c.status in ('found', 'ready') and s.deadline < v_today;
  select count(*) filter (where c.status = 'ready'), count(*) filter (where c.status = 'found' and c.match = 'ask'),
         count(*) filter (where c.status = 'needs_you'),
         array_agg(c.id order by s.deadline nulls last, c.created_at) filter (where c.status = 'ready'),
         array_agg(s.name order by s.deadline nulls last, c.created_at) filter (where c.status = 'ready')
    into v_ready, v_ask, v_needs, v_ids, v_names
    from settlement_claims c join settlements s on s.id = c.settlement_id;

  if v_ready > 0 then
    -- Freeze exactly these claims in a digest. A same-day rerun with the same set reuses the digest and does not push again.
    select id into v_existing from settlement_digests
     where day = v_today and acted_at is null
       and (select array_agg(x order by x) from unnest(claim_ids) x) = (select array_agg(x order by x) from unnest(v_ids) x)
     order by sent_at desc limit 1;
    if v_existing is null then
      insert into settlement_digests (day, claim_ids) values (v_today, v_ids) returning id into v_digest;
      perform settlement_digest_push(v_digest, v_names, v_ask, v_needs);
    end if;
  elsif v_ask + v_needs > 0 then
    v_body := concat_ws(' ',
      case when v_ask > 0 then v_ask || ' need a quick yes/no.' end,
      case when v_needs > 0 then v_needs || ' need you to hit submit.' end);
    perform settlement_notify('Settlements need a quick answer', v_body, 'digest', 'https://bestly.tech/admin/settlements', 'digest.' || v_today::text);
  end if;

  -- deadline under 72 hours and still not filed
  for v_soon in
    select c.id, s.name, s.deadline from settlement_claims c join settlements s on s.id = c.settlement_id
    where c.status in ('found', 'ready', 'needs_you') and c.match <> 'no' and s.deadline between v_today and v_today + 3
  loop
    perform settlement_notify('Deadline ' || to_char(v_soon.deadline, 'Mon FMDD') || ': ' || v_soon.name,
      'Last chance to file this one.', 'deadline', 'https://bestly.tech/admin/settlements', 'deadline.' || v_soon.id::text);
  end loop;
  return jsonb_build_object('ready', v_ready, 'ask', v_ask, 'needs_you', v_needs, 'digest', coalesce(v_digest, v_existing));
end $$;
revoke all on function public.settlement_daily() from public, anon, authenticated;

-- ------------------------------------------------------------------ page RPCs (admin session)
create or replace function public.settlement_digest_get(p_digest uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d settlement_digests; v jsonb;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select * into d from settlement_digests where id = p_digest;
  if not found then return null; end if;
  select jsonb_build_object(
    'id', d.id, 'sent_at', d.sent_at, 'acted_at', d.acted_at, 'action', d.action, 'approved_n', d.approved_n,
    'expired', d.acted_at is null and d.sent_at < now() - interval '3 days',
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'status', c.status, 'name', s.name, 'defendant', s.defendant, 'administrator', s.administrator,
        'deadline', s.deadline, 'est_payout', s.est_payout, 'class_definition', s.class_definition,
        'proof_required', s.proof_required, 'evidence', c.evidence) order by t.i)
      from unnest(d.claim_ids) with ordinality t(cid, i)
      join settlement_claims c on c.id = t.cid join settlements s on s.id = c.settlement_id), '[]'::jsonb))
  into v;
  return v;
end $$;

create or replace function public.settlement_digest_confirm(p_digest uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  return settlement_digest_approve(p_digest, 'page');
end $$;

revoke all on function public.settlement_digest_get(uuid) from public, anon;
revoke all on function public.settlement_digest_confirm(uuid) from public, anon;
grant execute on function public.settlement_digest_get(uuid) to authenticated;
grant execute on function public.settlement_digest_confirm(uuid) to authenticated;

-- ------------------------------------------------------------------ lock-screen callback (Pi listener, home-hub agent key or watchdog token)
create or replace function public.settlement_digest_action_t(p_token text, p_digest uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (db_watchdog_ok(p_token) or p_token = get_home_hub_agent_key()) then raise exception 'not allowed'; end if;
  if p_action = 'yes' then
    return settlement_digest_approve(p_digest, 'lockscreen');
  end if;
  return jsonb_build_object('state', 'ignored');
end $$;

insert into public.security_public_rpcs (fn, why) values
  ('settlement_digest_action_t', 'Pi listener for the Nickel digest lock-screen Yes button (home-hub agent key or watchdog token)')
on conflict (fn) do nothing;
