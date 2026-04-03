
-- Create trigger function to sync granted_access → subscriptions
CREATE OR REPLACE FUNCTION public.sync_granted_access_to_subscriptions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.subscriptions (email, plan, status, stripe_customer_id)
  VALUES (LOWER(TRIM(NEW.email)), 'lifetime', 'active', 'granted_' || NEW.id::text)
  ON CONFLICT (email, plan) DO UPDATE SET
    status = 'active',
    updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger on granted_access table
CREATE TRIGGER trg_sync_granted_access_to_subscriptions
AFTER INSERT ON public.granted_access
FOR EACH ROW
EXECUTE FUNCTION public.sync_granted_access_to_subscriptions();

-- Backfill existing granted_access users who have no subscription
INSERT INTO public.subscriptions (email, plan, status, stripe_customer_id)
SELECT LOWER(TRIM(ga.email)), 'lifetime', 'active', 'granted_' || ga.id::text
FROM public.granted_access ga
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s
  WHERE LOWER(TRIM(s.email)) = LOWER(TRIM(ga.email))
  AND s.status = 'active'
)
ON CONFLICT DO NOTHING;
