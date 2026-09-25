-- The risk in both of these is over-silencing: a receipt rule that matches a real alert, or a
-- quiet window left somewhere it swallows the day. Both fail silently by definition, so watch them.
create or replace function public.notify_quiet_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_all int; v_silent int; p public.admin_notify_prefs; v_span numeric;
begin
  select count(*), count(*) filter (where silent) into v_all, v_silent
    from public.admin_notifications where created_at > now() - interval '24 hours';

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
      format('Quiet hours run %s to %s — about %s hours. Only warnings are getting through.',
             to_char(p.quiet_start, 'HH12:MI AM'), to_char(p.quiet_end, 'HH12:MI AM'), round(v_span)), 'ops');
  else
    perform public.bestly_raise('notify.quietwide', 'resolved', 'info', null);
  end if;

  if p.dnd_until is not null and p.dnd_until > now() + interval '25 hours' then
    update public.admin_notify_prefs set dnd_until = null, updated_at = now() where id = 1;
    perform public.bestly_raise('notify.dndstuck', 'problem', 'warning',
      'Alerts: Do Not Disturb was stuck on', 'It was set past its one-day cap, so it has been cleared.', 'ops', null, true);
  end if;

  return jsonb_build_object('ok', true, 'alerts_24h', v_all, 'receipts', v_silent, 'quiet_span_h', round(coalesce(v_span, 0)));
end $$;

select cron.schedule('notify-quiet-watchdog', '52 * * * *', $$select public.notify_quiet_watchdog()$$);
