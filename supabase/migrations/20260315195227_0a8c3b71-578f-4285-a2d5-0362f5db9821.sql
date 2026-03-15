
-- Enable realtime on tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_intakes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.granted_access;

-- Activity feed table
CREATE TABLE public.admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read activity log"
  ON public.admin_activity_log FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'email') = 'jaredbest@icloud.com');

CREATE POLICY "Service role manages activity log"
  ON public.admin_activity_log FOR ALL TO service_role
  USING (true);

-- Trigger: log new submissions
CREATE OR REPLACE FUNCTION public.log_new_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  INSERT INTO admin_activity_log (event_type, description, metadata)
  VALUES ('new_submission',
    'New intake from ' || coalesce(NEW.client_name, NEW.business_legal_name, 'Unknown'),
    jsonb_build_object('intake_id', NEW.id, 'status', NEW.status, 'platform', NEW.platform));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_log_submission
  AFTER INSERT ON seller_intakes
  FOR EACH ROW EXECUTE FUNCTION log_new_submission();

-- Trigger: log granted access
CREATE OR REPLACE FUNCTION public.log_granted_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  INSERT INTO admin_activity_log (event_type, description, metadata)
  VALUES ('access_granted',
    'Access granted to ' || NEW.email,
    jsonb_build_object('grant_id', NEW.id, 'reason', NEW.reason, 'granted_by', NEW.granted_by));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_log_granted_access
  AFTER INSERT ON granted_access
  FOR EACH ROW EXECUTE FUNCTION log_granted_access();
