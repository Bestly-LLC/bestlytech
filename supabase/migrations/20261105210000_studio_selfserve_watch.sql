-- Studio self-serve watchdog + sweep schedule (Nov 5 2026). Owner: Spark (prefix studio.selfserve).
-- Plan: bestly_memory plan/studio-selfserve-golive-2026-11-04.

-- studio-re's sweep proves it was called by our cron: it sends the existing studio_notify_key from Vault and
-- the database compares it here, so the key never appears in function code, chat or logs.
create or replace function public.studio_sweep_key_ok(p_key text)
returns boolean language sql stable security definer set search_path to 'public', 'vault' as $$
  select coalesce(length(p_key) >= 20 and p_key = (select decrypted_secret from vault.decrypted_secrets where name = 'studio_notify_key' limit 1), false);
$$;
revoke all on function public.studio_sweep_key_ok(text) from public, anon, authenticated;
grant execute on function public.studio_sweep_key_ok(text) to service_role;

insert into public.notification_owners (prefix, agent_slug, note)
values ('studio.selfserve', 'spark', 'Studio self-serve sign-up at bestly.tech/studio/start: sweep, waiting list, sign-ups that paid but have no billing row')
on conflict (prefix) do nothing;

-- Every 10 minutes. Self-heals what it can (re-runs the sweep), raises only what a person must look at.
create or replace function public.studio_selfserve_watch()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare n_wait int; n_nobill int; n_stuckpre int; v_last timestamptz;
begin
  -- 1. people waiting on a network that is open, not told within 2 hours: the sweep is failing
  select count(*) into n_wait from studio_network_waits w join studio_networks n on n.platform = w.platform
   where n.open and w.notified_at is null and n.updated_at < now() - interval '2 hours';
  if n_wait > 0 then
    perform net.http_post(url := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/studio-re',
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-sweep-key', (select decrypted_secret from vault.decrypted_secrets where name = 'studio_notify_key')),
      body := '{"action":"sweep"}'::jsonb, timeout_milliseconds := 20000);
    perform bestly_raise('studio.selfserve.waits', 'problem', 'warning',
      n_wait || ' people are still waiting to hear a network opened',
      'Their network is open but the "it is open" email has not gone out in 2 hours. Spark re-ran the sweep. If this stays, check studio-re logs (action sweep) and RESEND_API_KEY.',
      'studio', null, true);
  else
    perform bestly_raise('studio.selfserve.waits', 'resolved', 'info', 'Waiting-list emails are caught up', null, 'studio');
  end if;

  -- 2. paid (converted) but no billing row: they would never be allowed to post
  select count(*) into n_nobill from studio_signups s
   where s.status = 'converted' and s.client_slug is not null
     and not exists (select 1 from studio_billing b where b.client_slug = s.client_slug);
  if n_nobill > 0 then
    perform bestly_raise('studio.selfserve.billing-missing', 'problem', 'error',
      n_nobill || ' paying Studio sign-up(s) have no billing row',
      'A self-serve customer finished checkout but studio_billing has no row, so studio_entitlement says they cannot post. Check stripe-webhook logs (studio provision) and re-run studio_provision_client for the signup.',
      'studio', 'Look at the Stripe webhook for this sign-up', false);
  else
    perform bestly_raise('studio.selfserve.billing-missing', 'resolved', 'info', 'Every paying sign-up has billing', null, 'studio');
  end if;

  -- 3. a pre-client (connected, never paid) older than 30 days: switch its accounts off so nothing can post
  update social_accounts sa set active = false
    from studio_signups s join approval_clients c on c.slug = s.pre_client_slug
   where sa.client_id = c.id and s.client_slug is null and s.pre_client_slug is not null
     and s.updated_at < now() - interval '30 days' and sa.active;
  get diagnostics n_stuckpre = row_count;

  return jsonb_build_object('ok', true, 'waits_stuck', n_wait, 'paid_no_billing', n_nobill, 'old_preclient_accounts_off', n_stuckpre);
exception when others then
  begin perform bestly_raise('studio.selfserve.watch', 'problem', 'warning', 'studio_selfserve_watch itself failed', left(sqlerrm, 300), 'studio'); exception when others then null; end;
  return jsonb_build_object('ok', false, 'error', left(sqlerrm, 300));
end $$;
revoke all on function public.studio_selfserve_watch() from public, anon, authenticated;

select cron.schedule('studio-selfserve-watch', '6-59/10 * * * *', $$select public.studio_selfserve_watch()$$);
select cron.schedule('studio-selfserve-sweep', '26 * * * *', $$select net.http_post(
     url := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/studio-re',
     headers := jsonb_build_object('Content-Type','application/json',
                  'x-sweep-key', (select decrypted_secret from vault.decrypted_secrets where name = 'studio_notify_key')),
     body := '{"action":"sweep"}'::jsonb, timeout_milliseconds := 20000)$$);
