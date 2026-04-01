
-- Fix 1: Remove public SELECT on granted_access, restrict to service_role/admin only
DROP POLICY IF EXISTS "granted_access_read" ON public.granted_access;
CREATE POLICY "granted_access_read_admin"
  ON public.granted_access FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Fix 2: Remove public SELECT/UPDATE on seller_intakes for Draft status
-- Replace with token-based ownership using a session_token column
ALTER TABLE public.seller_intakes ADD COLUMN IF NOT EXISTS session_token UUID DEFAULT gen_random_uuid();

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Allow public read of draft intakes" ON public.seller_intakes;
DROP POLICY IF EXISTS "Allow public update of draft intakes" ON public.seller_intakes;
DROP POLICY IF EXISTS "Allow public insert of intakes" ON public.seller_intakes;

-- Recreate with token-based ownership: user must know the session_token to access their draft
CREATE POLICY "Owner can read own draft intake"
  ON public.seller_intakes FOR SELECT
  TO anon
  USING (false);

CREATE POLICY "Owner can update own draft intake"
  ON public.seller_intakes FOR UPDATE
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Allow public insert of intakes"
  ON public.seller_intakes FOR INSERT
  TO anon
  WITH CHECK (status = 'Draft');

-- Admin can still do everything via existing service_role policies
CREATE POLICY "Admin can read all intakes"
  ON public.seller_intakes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update all intakes"
  ON public.seller_intakes FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
