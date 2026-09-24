-- The portal fires partner-ai the moment Eli sends, so this is the safety net, not the path:
-- it catches a question whose fire-and-forget invoke never landed (tab closed, offline, 500).
select cron.schedule('partner-ai-drain', '* * * * *',
  $$select public.invoke_edge_function('partner-ai', '{"op":"tick"}'::jsonb, 120000)$$);

-- Self-healing watchdog: a question nobody answered is the one failure Eli actually feels.
create or replace function public.partner_ai_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_stuck int; v_fails int; v_free int;
begin
  select count(*) into v_stuck from public.partner_chat
   where role = 'user' and status in ('pending', 'working') and created_at < now() - interval '6 minutes';

  if v_stuck > 0 then
    -- Heal first, ask questions later: put them back in the queue and kick the drain.
    update public.partner_chat set status = 'pending', updated_at = now()
     where role = 'user' and status = 'working' and created_at < now() - interval '6 minutes';
    perform public.invoke_edge_function('partner-ai', '{"op":"tick"}'::jsonb, 120000);
    perform public.bestly_raise('ai.partner.stuck', 'problem', 'warning',
      'Partner Scout: a question is unanswered',
      format('%s question(s) have waited more than 6 minutes. Requeued and the drain was kicked; the free providers may all be down.', v_stuck),
      'ai', null, true);
  else
    perform public.bestly_raise('ai.partner.stuck', 'resolved', 'info', null);
  end if;

  -- Free-only is the point of this path, so notice if it ever stops being free.
  select count(*) filter (where provider = 'anthropic'), count(*) filter (where provider <> 'anthropic' and ok)
    into v_fails, v_free
    from public.ai_spend where fn = 'partner-ai' and at > now() - interval '24 hours';
  if v_fails > 0 then
    perform public.bestly_raise('ai.partner.paid', 'problem', 'warning',
      'Partner Scout: a paid model was used',
      format('%s paid call(s) in 24 hours on a path that is meant to be free only.', v_fails), 'ai');
  else
    perform public.bestly_raise('ai.partner.paid', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'stuck', v_stuck, 'paid_24h', v_fails, 'free_24h', v_free);
end $$;

select cron.schedule('partner-ai-watchdog', '8-59/10 * * * *', $$select public.partner_ai_watchdog()$$);
