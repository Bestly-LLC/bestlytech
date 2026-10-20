-- Hermes, Mail Clerk (2026-10-19, Jared) -- part 2 of 4: RPCs for the Pi and for Jared

-- RPCs the Pi calls (service role only; the Pi never gets a way to approve anything) -------------------------------------

create or replace function public.hermes_file_item_t(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid; v_aid uuid;
  v_event text := case when coalesce(p->>'event','') in ('arrived','package','payment','security','receipt','account','other','unverified') then p->>'event' else 'other' end;
  v_type text := case when coalesce(p->>'mail_type','') in ('bill','check','government','bank','legal','junk','package','other') then p->>'mail_type' else null end;
  v_ver boolean := coalesce((p->>'verified')::boolean, false);
  v_test boolean := coalesce((p->>'is_test')::boolean, false);
  v_back boolean := coalesce((p->>'backfill')::boolean, false);
  v_sender text := public.hermes_name(p->>'sender', 60);
  v_amt integer; v_due date; v_recv timestamptz; v_act text; v_label text; v_sum text; v_title text; v_body text; v_cred text; v_push boolean := false;
begin
  begin v_amt := nullif(p->>'amount_cents','')::integer; if v_amt is not null and (v_amt < 0 or v_amt > 100000000) then v_amt := null; end if; exception when others then v_amt := null; end;
  begin v_due := nullif(p->>'due_date','')::date; exception when others then v_due := null; end;
  begin v_recv := coalesce(nullif(p->>'received_at','')::timestamptz, now()); exception when others then v_recv := now(); end;
  v_label := case when v_type is null then null else initcap(v_type) || ' - ' || v_sender end;
  v_sum := left(coalesce(p->>'summary', ''), 300);

  insert into public.hermes_items (msg_id, mailbox_uid, received_at, from_domain, subject, event, mail_type, label, sender, summary,
                                   amount_cents, due_date, has_image, verified, confidence, ai, item_ref, is_test, details)
  values (left(p->>'msg_id', 300), nullif(p->>'mailbox_uid','')::bigint, v_recv, left(p->>'from_domain', 80), left(p->>'subject', 160),
          v_event, v_type, v_label, case when v_type is null then null else v_sender end, v_sum, v_amt, v_due,
          coalesce((p->>'has_image')::boolean, false), v_ver,
          case when coalesce(p->>'confidence','') ~ '^[0-9.]+$' then (p->>'confidence')::numeric else null end,
          left(p->>'ai', 60), left(p->>'item_ref', 80), v_test, jsonb_build_object('backfill', v_back))
  on conflict (msg_id) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('duplicate', true); end if;

  select cred_state into v_cred from public.hermes_state where id;

  if not v_ver then
    -- a look-alike: filed and left alone. One quiet line a day, signed Ares.
    perform public.hermes_done('hermes:spoof:' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD'),
      'Blocked an email pretending to be iPostal1', 'It failed the sender check, so nothing in it was trusted.', 'security-auditor');
    return jsonb_build_object('item_id', v_id);
  end if;

  if v_back then
    return jsonb_build_object('item_id', v_id, 'backfill', true);
  end if;

  -- 1. the ask (paid actions never start on their own)
  if v_event in ('arrived','package','other') then
    v_act := case when v_event = 'package' and v_type is distinct from 'junk' then 'package'
                  when v_type = 'check' then 'deposit_check'
                  when v_type in ('bill','government','legal','bank') then 'scan'
                  when v_type = 'package' then 'package'
                  else null end;
    if v_act is not null then
      insert into public.hermes_actions (item_id, action, reason, priority)
      values (v_id, v_act,
              left(v_sender || case when v_type is not null then ' (' || v_type || ')' else '' end
                   || case when v_amt is not null then ', $' || to_char(v_amt / 100.0, 'FM999,999,990.00') else '' end
                   || case when v_due is not null then ', due ' || to_char(v_due, 'FMMon FMDD, YYYY') else '' end, 240),
              v_type in ('check','bill','government','legal'))
      on conflict do nothing
      returning id into v_aid;
      if v_aid is not null then update public.hermes_items set status = 'asked' where id = v_id; end if;
    end if;
  end if;

  -- 2. who gets interrupted: money (checks, bills), government or legal notices, a failed iPostal1 payment
  if not v_test then
    if v_aid is not null and (v_type in ('check','government','legal') or (v_type = 'bill' and (v_amt is not null or v_due is not null))) then
      v_title := public.hermes_ask_title(v_type, v_act, v_sender);
      v_body := left(v_sender || case when v_amt is not null then ', $' || to_char(v_amt / 100.0, 'FM999,999,990.00') else '' end
                     || case when v_due is not null then ', due ' || to_char(v_due, 'FMMon FMDD, YYYY') else '' end
                     || case when coalesce(v_cred, 'missing') in ('missing','rejected') then '. Add the iPostal1 login first so Hermes can act.'
                             else '. Tap Approve in Needs you; Hermes spends nothing until you do.' end, 300);
      perform public.hermes_alert('hermes:ask:' || v_aid::text, v_title, v_body, '/admin', false);
    elsif v_event = 'payment' then
      perform public.hermes_alert('hermes:pay:' || v_id::text, 'Hermes: iPostal1 payment failed',
        'iPostal1 says a payment did not go through' || case when v_amt is not null then ' ($' || to_char(v_amt / 100.0, 'FM999,999,990.00') || ')' else '' end
        || '. Open iPostal1 billing and update the card.', 'https://app.ipostal1.com/', false);
    end if;
  end if;

  -- 3. everything else is a recap line, never a ping
  if not v_test then
    perform public.hermes_done('hermes:filed:' || v_id::text,
      case when v_event = 'payment' then 'Caught a failed iPostal1 payment notice'
           when v_event in ('receipt','account') then 'Filed an iPostal1 ' || v_event || ' notice'
           when v_event = 'security' then 'Filed an iPostal1 account alert'
           when v_type is not null then 'Filed a ' || v_type || ' from ' || v_sender
           else 'Filed an iPostal1 notice' end);
  end if;

  return jsonb_build_object('item_id', v_id, 'action', v_act);
end $$;

create or replace function public.hermes_take_approved_t(p_limit integer default 6) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare a record; out jsonb := '[]'::jsonb;
begin
  for a in
    select x.id, x.action, i.item_ref, i.sender, i.subject, i.mail_type, i.received_at, i.is_test
      from public.hermes_actions x join public.hermes_items i on i.id = x.item_id
     where x.status = 'approved' and x.decided_by is not null and x.decided_at > now() - interval '24 hours'
     order by x.decided_at
     limit greatest(1, least(coalesce(p_limit, 6), 10))
     for update of x skip locked
  loop
    update public.hermes_actions set status = 'running', started_at = now(), attempts = attempts + 1, lease_until = now() + interval '12 minutes'
     where id = a.id;
    if a.is_test then
      update public.hermes_actions set status = 'done', finished_at = now(), lease_until = null,
             result = jsonb_build_object('note', 'test item, nothing was clicked') where id = a.id;
      continue;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('id', a.id, 'action', a.action,
             'item', jsonb_build_object('item_ref', a.item_ref, 'sender', a.sender, 'subject', a.subject, 'mail_type', a.mail_type, 'received_at', a.received_at)));
  end loop;
  return out;
end $$;

create or replace function public.hermes_action_report_t(p_id uuid, p_status text, p_result jsonb default '{}'::jsonb, p_error text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare a public.hermes_actions; i public.hermes_items; v_phrase text;
begin
  select * into a from public.hermes_actions where id = p_id for update;
  if not found or a.status <> 'running' then return jsonb_build_object('ignored', true); end if;
  select * into i from public.hermes_items where id = a.item_id;
  if p_status = 'done' then
    update public.hermes_actions set status = 'done', finished_at = now(), lease_until = null, result = coalesce(p_result, '{}'::jsonb), error = null where id = p_id;
    update public.hermes_items set status = 'acted' where id = a.item_id;
    v_phrase := case a.action
      when 'scan' then 'Opened and scanned the ' || coalesce(i.mail_type, 'letter') || ' from ' || coalesce(i.sender, 'an unknown sender')
      when 'deposit_check' then 'Sent the check from ' || coalesce(i.sender, 'an unknown sender') || ' for deposit'
      when 'shred' then 'Shredded the ' || coalesce(i.mail_type, 'letter') || ' from ' || coalesce(i.sender, 'an unknown sender')
      when 'recycle' then 'Recycled the ' || coalesce(i.mail_type, 'letter') || ' from ' || coalesce(i.sender, 'an unknown sender')
      when 'forward' then 'Forwarded the ' || coalesce(i.mail_type, 'letter') || ' from ' || coalesce(i.sender, 'an unknown sender')
      else 'Handled the package from ' || coalesce(i.sender, 'an unknown sender') end;
    perform public.hermes_done('hermes:acted:' || p_id::text, v_phrase, 'Approved by Jared.');
    return jsonb_build_object('ok', true);
  elsif p_status = 'retry' and a.attempts < 4 then
    perform set_config('hermes.retry', 'ok', true);   -- nothing was clicked, so the same approval stands
    update public.hermes_actions set status = 'approved', lease_until = null, error = left(p_error, 300) where id = p_id;
    perform set_config('hermes.retry', '', true);
    return jsonb_build_object('retry', true);
  else
    update public.hermes_actions set status = 'failed', finished_at = now(), lease_until = null, error = left(coalesce(p_error, 'gave up after several tries'), 300) where id = p_id;
    return jsonb_build_object('failed', true);
  end if;
end $$;

create or replace function public.hermes_login_report_t(p_purpose text, p_action uuid, p_ok boolean, p_ip text, p_session text, p_note text, p_rejected boolean default false) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.hermes_logins (purpose, action_id, ok, egress_ip, session_tag, note)
  values (case when p_purpose = 'action' then 'action' else 'view' end, p_action, coalesce(p_ok, false), left(p_ip, 64), left(p_session, 40), left(p_note, 200));
  if coalesce(p_ok, false) then
    update public.hermes_state set cred_state = 'working', last_login_ok_at = now(), cred_note = null, updated_at = now() where id;
  else
    update public.hermes_state set cred_state = case when coalesce(p_rejected, false) then 'rejected' else 'trouble' end,
           last_login_fail_at = now(), cred_note = left(p_note, 200), updated_at = now() where id;
  end if;
end $$;

create or replace function public.hermes_view_needed_t() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('needed',
    s.enabled and (s.cred_state = 'saved' or (s.cred_state = 'trouble' and coalesce(s.last_login_fail_at, now() - interval '1 day') < now() - interval '30 minutes')))
  from public.hermes_state s where s.id
$$;

create or replace function public.hermes_guard_beat_t(p_moved bigint default 0) returns void
language sql security definer set search_path to 'public' as $$
  update public.hermes_state set guard_beat_at = now(), guard_moved_run = coalesce(p_moved, 0), updated_at = now() where id
$$;

create or replace function public.hermes_poll_t(p_filed integer default 0, p_note text default null) returns void
language sql security definer set search_path to 'public' as $$
  update public.hermes_state set last_poll_at = now(), last_note = left(p_note, 200), updated_at = now() where id
$$;

-- RPCs Jared's signed-in admin calls -------------------------------------------------------------------------------------

-- The only way a paid action gets approved. Jared's tap.
create or replace function public.hermes_action_decide(p_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare a public.hermes_actions;
begin
  if not coalesce(public.team_is_admin(), false) then raise exception 'admin only'; end if;
  select * into a from public.hermes_actions where id = p_id for update;
  if not found or a.status <> 'proposed' then raise exception 'that ask is no longer open'; end if;
  perform set_config('hermes.tap', 'ok', true);
  update public.hermes_actions set status = case when p_approve then 'approved' else 'declined' end where id = p_id;
  perform set_config('hermes.tap', '', true);
  if not p_approve then update public.hermes_items set status = 'filed' where id = a.item_id; end if;
  update public.admin_notifications set read_at = now() where dedupe_key = 'hermes:ask:' || p_id::text and read_at is null;
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'declined' end);
end $$;

-- "Open and scan this one" tapped on an item card in the Team page: the tap is the approval.
create or replace function public.hermes_action_request(p_item uuid, p_action text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not coalesce(public.team_is_admin(), false) then raise exception 'admin only'; end if;
  if p_action not in ('scan','shred','forward','recycle','deposit_check','package') then raise exception 'unknown action'; end if;
  if not exists (select 1 from public.hermes_items where id = p_item and verified) then raise exception 'item not found'; end if;
  insert into public.hermes_actions (item_id, action, reason) values (p_item, p_action, 'You asked for this') returning id into v_id;
  perform set_config('hermes.tap', 'ok', true);
  update public.hermes_actions set status = 'approved' where id = v_id;
  perform set_config('hermes.tap', '', true);
  update public.hermes_items set status = 'asked' where id = p_item;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  raise exception 'that is already waiting';
end $$;

-- The iPostal1 login. Written straight into Vault as one JSON secret; never readable from the browser again.
create or replace function public.hermes_login_save(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path to 'public', 'vault' as $$
declare v_email text := nullif(btrim(p_email), ''); v_pw text := p_password; v_id uuid;
begin
  if not coalesce(public.team_is_admin(), false) then raise exception 'admin only'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'that does not look like an email address'; end if;
  if v_pw is null or length(v_pw) < 4 or length(v_pw) > 200 then raise exception 'that password looks too short or too long'; end if;
  select id into v_id from vault.secrets where name = 'pi:ipostal1_login';
  if v_id is null then
    perform vault.create_secret(jsonb_build_object('email', v_email, 'password', v_pw)::text, 'pi:ipostal1_login',
      'iPostal1 virtual mailbox login for Hermes (Mail Clerk). JSON {email, password}. Written by the iPostal1 slot on /admin/security. Only the Pi reads it.');
  else
    perform vault.update_secret(v_id, jsonb_build_object('email', v_email, 'password', v_pw)::text);
  end if;
  update public.hermes_state set cred_state = 'saved', cred_saved_at = now(), cred_note = null, updated_at = now() where id;
  return public.hermes_login_status();
end $$;

create or replace function public.hermes_login_status() returns jsonb
language plpgsql stable security definer set search_path to 'public', 'vault' as $$
declare s public.hermes_state; v_email text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.team_is_admin(), false) then raise exception 'admin only'; end if;
  select * into s from public.hermes_state where id;
  select (decrypted_secret::jsonb)->>'email' into v_email from vault.decrypted_secrets where name = 'pi:ipostal1_login';
  return jsonb_build_object('state', s.cred_state, 'saved_at', s.cred_saved_at, 'last_ok_at', s.last_login_ok_at, 'last_fail_at', s.last_login_fail_at,
    'note', s.cred_note,
    'hint', case when v_email is null then null else left(v_email, 1) || repeat('•', greatest(length(split_part(v_email, '@', 1)) - 1, 2)) || '@' || split_part(v_email, '@', 2) end);
exception when others then
  return jsonb_build_object('state', coalesce(s.cred_state, 'missing'));
end $$;

-- Hermes can be paused from the Team card.
create or replace function public.hermes_set_enabled(p_on boolean) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not coalesce(public.team_is_admin(), false) then raise exception 'admin only'; end if;
  update public.hermes_state set enabled = coalesce(p_on, true), updated_at = now() where id;
end $$;

-- grants: Pi-only functions go to service_role; Jared's go to signed-in users (each checks team_is_admin inside)
revoke all on function public.hermes_file_item_t(jsonb), public.hermes_take_approved_t(integer), public.hermes_action_report_t(uuid, text, jsonb, text),
  public.hermes_login_report_t(text, uuid, boolean, text, text, text, boolean), public.hermes_view_needed_t(), public.hermes_guard_beat_t(bigint),
  public.hermes_poll_t(integer, text), public.hermes_actions_guard() from public, anon, authenticated;
grant execute on function public.hermes_file_item_t(jsonb), public.hermes_take_approved_t(integer), public.hermes_action_report_t(uuid, text, jsonb, text),
  public.hermes_login_report_t(text, uuid, boolean, text, text, text, boolean), public.hermes_view_needed_t(), public.hermes_guard_beat_t(bigint),
  public.hermes_poll_t(integer, text) to service_role;
revoke all on function public.hermes_action_decide(uuid, boolean), public.hermes_action_request(uuid, text), public.hermes_login_save(text, text),
  public.hermes_login_status(), public.hermes_set_enabled(boolean), public.hermes_name(text, integer), public.hermes_ask_title(text, text, text) from public, anon;
grant execute on function public.hermes_action_decide(uuid, boolean), public.hermes_action_request(uuid, text), public.hermes_login_save(text, text),
  public.hermes_login_status(), public.hermes_set_enabled(boolean), public.hermes_name(text, integer), public.hermes_ask_title(text, text, text) to authenticated, service_role;

