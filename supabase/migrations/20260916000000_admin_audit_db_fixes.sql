-- Admin audit, 2026-09-15: database fixes found while checking every admin button end to end.

-- 1) Cookie Yeti "Grant access" has never worked: the sync trigger used ON CONFLICT (email, plan)
--    but subscriptions is only unique on email (42P10 on every insert). Upsert on email, and never
--    touch a real paid Stripe subscription (only comp rows created by a grant).
CREATE OR REPLACE FUNCTION public.sync_granted_access_to_subscriptions()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  INSERT INTO public.subscriptions (email, plan, status, stripe_customer_id)
  VALUES (LOWER(TRIM(NEW.email)), 'lifetime', 'active', 'granted_' || NEW.id::text)
  ON CONFLICT (email) DO UPDATE SET status = 'active', updated_at = now()
    WHERE public.subscriptions.stripe_customer_id LIKE 'granted\_%';
  RETURN NEW;
END;
$f$;

-- 2) Revoking a grant left the comp subscription behind, so the user kept premium.
CREATE OR REPLACE FUNCTION public.revoke_granted_access_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $t$
BEGIN
  DELETE FROM public.subscriptions
   WHERE email = lower(trim(OLD.email)) AND stripe_customer_id LIKE 'granted\_%';
  RETURN OLD;
END;
$t$;
DROP TRIGGER IF EXISTS trg_revoke_granted_access_subscription ON public.granted_access;
CREATE TRIGGER trg_revoke_granted_access_subscription AFTER DELETE ON public.granted_access
  FOR EACH ROW EXECUTE FUNCTION public.revoke_granted_access_subscription();

-- 3) Maintenance jobs were SECURITY DEFINER and runnable by ANY signed-in user. Admins (from the
--    dashboard) and internal callers (pg_cron / service role, no user JWT) still pass.
CREATE OR REPLACE FUNCTION public._cy_admin_or_internal_guard()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $g$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role) THEN RETURN; END IF;
  RAISE EXCEPTION 'not authorized' USING errcode = '42501';
END;
$g$;
REVOKE ALL ON FUNCTION public._cy_admin_or_internal_guard() FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE
  fn text;
  def text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['run_maintenance_cron', 'reset_failed_domains_cron', 'process_user_reports'] LOOP
    def := pg_get_functiondef(('public.' || fn || '()')::regprocedure);
    IF position('_cy_admin_or_internal_guard' IN def) = 0 THEN
      def := regexp_replace(def, E'\\nBEGIN\\n', E'\nBEGIN\n  PERFORM public._cy_admin_or_internal_guard();\n');
      EXECUTE def;
    END IF;
  END LOOP;
END
$patch$;

-- 4) Views never need write grants.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.v_cookieyeti_needs_attention, public.v_cookieyeti_pipeline_health FROM anon, authenticated;

-- 5) Home Hub: Pi-hole controls enqueue real commands for the on-Pi agent. RLS already limits both
--    tables to admins; the table grants were missing, so the dashboard could not read or queue.
GRANT SELECT ON public.home_hub_agent_state TO authenticated;
GRANT SELECT, INSERT ON public.home_hub_commands TO authenticated;

-- 6) Privacy: anyone on the internet could read the household's top DNS domains.
DROP POLICY IF EXISTS allow_read_pihole_stats ON public.home_hub_pihole_stats;
CREATE POLICY home_hub_pihole_stats_admin_read ON public.home_hub_pihole_stats
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.home_hub_pihole_stats FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.home_hub_pihole_stats FROM authenticated;
