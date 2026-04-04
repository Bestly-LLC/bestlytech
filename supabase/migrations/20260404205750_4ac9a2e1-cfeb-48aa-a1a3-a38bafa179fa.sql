
-- Remove sensitive tables from realtime (without IF EXISTS)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.subscriptions;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.granted_access;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.seller_intakes;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- Add unique constraint on webhook_events.stripe_event_id for dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_stripe_event_id
  ON public.webhook_events (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;
