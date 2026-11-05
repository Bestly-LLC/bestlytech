-- QUIETGATE_20261105. Jared's rule: 11 PM to 7 AM Los Angeles time, only emergencies (critical/error) make a sound.
-- Everything else is held silently and lands in the 7 AM digest. Undo: bestly_memory house/undo/quiet-hours-gate-2026-11-05.

alter table public.admin_notifications add column if not exists quiet_held boolean not null default false;

-- Is a moment inside a quiet window? (LA time, window may wrap midnight; DST handled by the time zone name.)
create or replace function public._notify_quiet_at(p_at timestamptz, p_start time, p_end time)
returns boolean language sql immutable set search_path to 'public' as $$
  select case when p_start > p_end
    then ((p_at at time zone 'America/Los_Angeles')::time >= p_start or (p_at at time zone 'America/Los_Angeles')::time < p_end)
    else ((p_at at time zone 'America/Los_Angeles')::time >= p_start and (p_at at time zone 'America/Los_Angeles')::time < p_end) end
$$;

-- Server-side gate: every bell row written in quiet hours (or DND) that is not an emergency is filed silent,
-- so even an admin tab still running old code makes no sound, and the alert goes to the 7 AM digest instead.
create or replace function public.admin_notifications_quiet_gate() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare q jsonb; v_emp text; v_sec text;
begin
  if coalesce(new.silent, false) then return new; end if;
  q := public.notify_quiet_now();
  if not coalesce((q->>'quiet')::boolean, false) then return new; end if;
  if lower(coalesce(new.severity, 'info')) in ('critical', 'error') and coalesce((q->>'urgent_through')::boolean, true) then return new; end if;
  new.silent := true;
  new.quiet_held := true;
  v_emp := coalesce(nullif(new.agent_slug, ''), nullif(new.kind, ''), 'scout');
  v_sec := case when coalesce(new.title, '') ~* '^(fixed|healed)|working again|back up|recovered' then 'fixed' else 'fyi' end;
  begin
    perform public._bestly_digest_add(v_emp, v_sec, new.title, new.body,
      coalesce(new.dedupe_key, 'note-' || md5(coalesce(new.title, '') || '|' || coalesce(new.body, ''))), 'bestlyadmin://today');
  exception when others then null; end;
  return new;
end $$;

drop trigger if exists zz_admin_notifications_quiet_gate on public.admin_notifications;
create trigger zz_admin_notifications_quiet_gate before insert on public.admin_notifications
  for each row execute function public.admin_notifications_quiet_gate();

-- One window everywhere: his stated rule (Nov 2 2026). The bell had 10 PM to 8 AM.
update public.admin_notify_prefs set quiet_on = true, quiet_start = '23:00', quiet_end = '07:00', updated_at = now() where id = 1;
update public.bestly_app_notify set quiet_start = '23:00', quiet_end = '07:00', updated_at = now() where id = 1;

-- HomePod speech: never in quiet hours unless the caller marks a real emergency (set_config('bestly.announce_emergency','1',true)).
create or replace function public.bestly_announce(p_title text, p_message text)
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare id uuid;
begin
  if coalesce((public.notify_quiet_now()->>'quiet')::boolean, false)
     and coalesce(current_setting('bestly.announce_emergency', true), '') <> '1' then
    begin
      perform public._bestly_digest_add('scout', 'fyi', coalesce(p_title, 'Bestly alert'), p_message,
        'announce-' || md5(coalesce(p_title, '') || '|' || coalesce(p_message, '')), 'bestlyadmin://today');
    exception when others then null; end;
    return null;
  end if;

  -- At most 4 spoken alerts an hour so a loop can't keep the house awake.
  if (select count(*) from home_hub_commands where target = 'homeassistant' and action = 'announce' and created_at > now() - interval '1 hour') >= 4 then return null; end if;
  insert into home_hub_commands (target, action, payload)
  values ('homeassistant', 'announce', jsonb_build_object('title', left(coalesce(p_title, 'Bestly'), 120), 'message', left(p_message, 400), 'volume', 0.6, 'url', 'https://bestly.tech/admin/turo/lax-pass'))
  returning home_hub_commands.id into id;

  insert into admin_notifications (kind, title, body, url, severity, silent, agent_slug, dedupe_key)
  values ('announce', left(coalesce(p_title, 'Bestly alert'), 120), left(p_message, 400),
          'https://bestly.tech/admin/turo/lax-pass', 'warning', true, 'key-keeper', 'announce-' || id::text);
  return id;
end $function$;

-- Watchdog (cron notify-quiet-watchdog, hourly at :52), tied to Scout through bestly_raise.
create or replace function public.notify_quiet_watchdog()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_all int; v_silent int; p public.admin_notify_prefs; n public.bestly_app_notify; v_span numeric;
        v_leak int := 0; v_app_leak int := 0; v_gate boolean; v_synced boolean := false;
begin
  -- Quiet-hours holds are not "receipts", so they stay out of the over-silenced check.
  select count(*), count(*) filter (where silent) into v_all, v_silent
    from public.admin_notifications where created_at > now() - interval '24 hours' and not quiet_held;

  if v_all >= 10 and v_silent::numeric / v_all > 0.66 then
    perform public.bestly_raise('notify.oversilent', 'problem', 'warning',
      'Alerts: too many are being silenced',
      format('%s of %s alerts in 24 hours were filed as receipts. The rule that marks "Done on the Mac mini", "Checked" and "working again" may be matching real alerts.', v_silent, v_all),
      'ops');
  else
    perform public.bestly_raise('notify.oversilent', 'resolved', 'info', null);
  end if;

  select * into p from public.admin_notify_prefs where id = 1;
  v_span := case when p.quiet_start > p.quiet_end
                 then 24 - extract(epoch from (p.quiet_start - p.quiet_end)) / 3600
                 else extract(epoch from (p.quiet_end - p.quiet_start)) / 3600 end;
  if p.quiet_on and v_span > 16 then
    perform public.bestly_raise('notify.quietwide', 'problem', 'warning',
      'Alerts: quiet hours cover most of the day',
      format('Quiet hours run %s to %s, about %s hours. Only emergencies are getting through.',
             to_char(p.quiet_start, 'FMHH12:MI AM'), to_char(p.quiet_end, 'FMHH12:MI AM'), round(v_span)), 'ops');
  else
    perform public.bestly_raise('notify.quietwide', 'resolved', 'info', null);
  end if;

  if p.dnd_until is not null and p.dnd_until > now() + interval '25 hours' then
    update public.admin_notify_prefs set dnd_until = null, updated_at = now() where id = 1;
    perform public.bestly_raise('notify.dndstuck', 'problem', 'warning',
      'Alerts: Do Not Disturb was stuck on', 'It was set past its one-day cap, so it has been cleared.', 'ops', null, true);
  end if;

  -- QUIETGATE_20261105 checks.
  -- 1. The phone app follows the bell's window (the bell is where he changes it).
  select * into n from public.bestly_app_notify where id = 1;
  if p.quiet_on and n.id is not null and (n.quiet_start <> p.quiet_start or n.quiet_end <> p.quiet_end) then
    update public.bestly_app_notify set quiet_start = p.quiet_start, quiet_end = p.quiet_end, updated_at = now() where id = 1;
    v_synced := true;
  end if;

  -- 2. The gate trigger must exist and be on. If not, put it back.
  select exists (select 1 from pg_trigger where tgrelid = 'public.admin_notifications'::regclass
                  and tgname = 'zz_admin_notifications_quiet_gate' and tgenabled <> 'D') into v_gate;
  if not v_gate then
    execute 'drop trigger if exists zz_admin_notifications_quiet_gate on public.admin_notifications';
    execute 'create trigger zz_admin_notifications_quiet_gate before insert on public.admin_notifications for each row execute function public.admin_notifications_quiet_gate()';
  end if;

  -- 3. Leaks: a sound-making, non-emergency bell row written inside quiet hours in the last 70 minutes.
  if p.quiet_on then
    with x as (
      update public.admin_notifications set silent = true, quiet_held = true
       where created_at > now() - interval '70 minutes' and not silent
         and lower(coalesce(severity, 'info')) not in ('critical', 'error')
         and public._notify_quiet_at(created_at, p.quiet_start, p.quiet_end)
      returning 1)
    select count(*) into v_leak from x;
    select count(*) into v_app_leak from public.bestly_app_outbox
     where status = 'sent' and class <> 'safety' and sent_at > now() - interval '70 minutes'
       and public._notify_quiet_at(sent_at, p.quiet_start, p.quiet_end);
  end if;

  if not v_gate or v_leak > 0 or v_app_leak > 0 then
    perform public.bestly_raise('notify.quietleak', 'problem', case when v_app_leak > 0 then 'warning' else 'info' end,
      'Quiet hours: something made a sound',
      format('Gate %s. %s bell alerts slipped through and were silenced. %s phone pushes went out in quiet hours that were not safety alerts.',
             case when v_gate then 'was on' else 'was off and has been put back' end, v_leak, v_app_leak),
      'ops', null, v_app_leak = 0);
  else
    perform public.bestly_raise('notify.quietleak', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'alerts_24h', v_all, 'receipts', v_silent, 'quiet_span_h', round(coalesce(v_span, 0)),
    'gate_on', v_gate, 'leaks_silenced', v_leak, 'app_leaks', v_app_leak, 'window_synced', v_synced);
end $function$;
