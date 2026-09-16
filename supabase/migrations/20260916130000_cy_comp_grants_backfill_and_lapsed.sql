-- Cookie Yeti: comp access that the admin can actually see and revoke. Idempotent.
-- Based on the LIVE definitions (pg_get_functiondef) as of 2026-09-16.

-- 1) Grant to a lapsed customer silently did nothing: the ON CONFLICT ... WHERE only matched comp
--    rows, so an existing canceled/expired Stripe row was left untouched and the grant looked saved.
--    Now:
--      no subscriptions row          -> insert an active lifetime comp (unchanged behaviour)
--      existing comp row             -> make sure it is active (unchanged behaviour)
--      active / past_due Stripe row  -> raise, so the insert is rolled back and the admin sees why
--      canceled / expired Stripe row -> convert it to an active comp. The customer id becomes
--        granted_<grant id> so a late Stripe webhook for the old customer (matched on
--        stripe_customer_id) can't cancel the comp, and revoking the grant removes it. A later
--        checkout upserts on email and turns it back into a real Stripe row. The old Stripe ids
--        are kept in admin_activity_log.
CREATE OR REPLACE FUNCTION public.sync_granted_access_to_subscriptions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(trim(NEW.email));
  v_sub public.subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_sub FROM public.subscriptions WHERE email = v_email FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.subscriptions (email, plan, status, stripe_customer_id)
    VALUES (v_email, 'lifetime', 'active', 'granted_' || NEW.id::text);

  ELSIF coalesce(v_sub.stripe_customer_id, '') LIKE 'granted\_%' THEN
    UPDATE public.subscriptions SET status = 'active', updated_at = now()
     WHERE id = v_sub.id AND status <> 'active';

  ELSIF v_sub.status IN ('active', 'past_due') THEN
    RAISE EXCEPTION 'This email already has an active paid subscription (% plan, status %). Nothing was granted.',
      v_sub.plan, replace(v_sub.status, '_', ' ')
      USING errcode = 'P0001',
            hint = 'Cancel the subscription in Stripe first if you want to replace it with comp access.';

  ELSE
    UPDATE public.subscriptions
       SET plan = 'lifetime',
           status = 'active',
           stripe_customer_id = 'granted_' || NEW.id::text,
           current_period_end = NULL,
           updated_at = now()
     WHERE id = v_sub.id;

    INSERT INTO public.admin_activity_log (event_type, description, metadata)
    VALUES ('access_granted_converted',
      'Lapsed Stripe subscription converted to comp access',
      jsonb_build_object('grant_id', NEW.id, 'subscription_id', v_sub.id,
        'previous_plan', v_sub.plan, 'previous_status', v_sub.status,
        'previous_stripe_customer_id', v_sub.stripe_customer_id,
        'previous_stripe_subscription_id', v_sub.stripe_subscription_id,
        'previous_period_end', v_sub.current_period_end));
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Backfill: lifetime comps that exist in subscriptions (stripe_customer_id 'granted_%') but have
--    no granted_access row were invisible on Granted Access and could not be revoked. Give each one
--    a grant row. The sync + log triggers are paused for this insert only, so subscriptions rows are
--    not touched at all (not even updated_at) and no fake "access granted" events are logged.
DO $backfill$
DECLARE
  v_count int;
BEGIN
  ALTER TABLE public.granted_access DISABLE TRIGGER trg_sync_granted_access_to_subscriptions;
  ALTER TABLE public.granted_access DISABLE TRIGGER trg_log_granted_access;

  INSERT INTO public.granted_access (email, granted_by, reason, created_at)
  SELECT lower(trim(s.email)), 'backfill', 'Existing comp access (backfilled so it can be revoked)', coalesce(s.created_at, now())
    FROM public.subscriptions s
   WHERE s.stripe_customer_id LIKE 'granted\_%'
     AND s.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.granted_access g WHERE g.email = lower(trim(s.email)));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  ALTER TABLE public.granted_access ENABLE TRIGGER trg_sync_granted_access_to_subscriptions;
  ALTER TABLE public.granted_access ENABLE TRIGGER trg_log_granted_access;

  IF v_count > 0 THEN
    INSERT INTO public.admin_activity_log (event_type, description, metadata)
    VALUES ('access_grants_backfilled', v_count || ' existing comp subscriptions linked to Granted Access',
      jsonb_build_object('count', v_count, 'migration', '20260916130000'));
  END IF;
END
$backfill$;
