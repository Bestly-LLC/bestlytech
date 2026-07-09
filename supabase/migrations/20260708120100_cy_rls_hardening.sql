-- ============================================================================
-- COOKIE YETI RLS HARDENING (2026-07-08)
--
-- Closes the RLS holes called out in the Product Audit:
--   1. cookie_patterns: anon must NOT be able to INSERT/UPDATE/DELETE poisonable
--      patterns that ship to all users. Raw anon writes are disallowed; community
--      submissions must flow through the validated edge functions
--      (report-dismissal / report-missed-banner), which run as service_role.
--   2. subscriptions / granted_access: must NOT be anon-readable (they expose
--      emails + Stripe IDs). SELECT restricted to service_role / admin only.
--
-- Idempotent + defensive: drops any known-permissive policies before asserting
-- the intended end state, so re-running converges regardless of prior drift.
-- Applied to prod (rcqfqhguwpmaarseifqg) via the Management API; mirrored here.
-- ============================================================================

-- ---------- 1. cookie_patterns: service_role-only writes, public read -------
ALTER TABLE public.cookie_patterns ENABLE ROW LEVEL SECURITY;

-- Drop any historically-permissive anon write policies (names seen across the
-- overlapping CY projects). No-ops if they don't exist.
DROP POLICY IF EXISTS "Anyone can insert cookie patterns"     ON public.cookie_patterns;
DROP POLICY IF EXISTS "Anyone can update cookie patterns"     ON public.cookie_patterns;
DROP POLICY IF EXISTS "Public can insert cookie patterns"     ON public.cookie_patterns;
DROP POLICY IF EXISTS "cookie_patterns_insert_anon"           ON public.cookie_patterns;
DROP POLICY IF EXISTS "cookie_patterns_public_write"          ON public.cookie_patterns;

-- Re-assert the intended policy set.
DROP POLICY IF EXISTS "Anyone can read cookie patterns"       ON public.cookie_patterns;
DROP POLICY IF EXISTS "Service role can manage cookie patterns" ON public.cookie_patterns;

-- Read: patterns are the shipped product surface (extensions/apps + the public
-- transparency dashboard read them). No PII in this table, so public SELECT is
-- intentional and safe.
CREATE POLICY "Anyone can read cookie patterns"
  ON public.cookie_patterns
  FOR SELECT
  USING (true);

-- Write: service_role only. Anon cannot INSERT/UPDATE/DELETE. Community
-- submissions are promoted server-side by the validated edge functions.
CREATE POLICY "Service role can manage cookie patterns"
  ON public.cookie_patterns
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Belt-and-suspenders at the grant level: strip anon/authenticated write privs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cookie_patterns FROM anon, authenticated;

-- ---------- 2. subscriptions: no anon read; service_role / admin only -------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Remove any broad/own-email read paths that could leak emails + Stripe IDs.
DROP POLICY IF EXISTS "Anyone can read subscriptions"   ON public.subscriptions;
DROP POLICY IF EXISTS "Public read subscriptions"       ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_read_own            ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_select_admin        ON public.subscriptions;

-- Admins (authenticated + has_role) already have full access via
-- "Admin full access subscriptions". Add an explicit service_role read for the
-- edge functions; nothing else can SELECT.
CREATE POLICY subscriptions_select_service
  ON public.subscriptions
  FOR SELECT
  USING (auth.role() = 'service_role');

REVOKE SELECT ON public.subscriptions FROM anon;

-- ---------- 3. granted_access: no anon read; service_role / admin only ------
ALTER TABLE public.granted_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read granted_access" ON public.granted_access;
DROP POLICY IF EXISTS "Public read granted_access"     ON public.granted_access;
DROP POLICY IF EXISTS granted_access_read_own          ON public.granted_access;
DROP POLICY IF EXISTS granted_access_select_service    ON public.granted_access;

-- Admin ("Admin full access granted_access") + service_role only.
CREATE POLICY granted_access_select_service
  ON public.granted_access
  FOR SELECT
  USING (auth.role() = 'service_role');

REVOKE SELECT ON public.granted_access FROM anon;
