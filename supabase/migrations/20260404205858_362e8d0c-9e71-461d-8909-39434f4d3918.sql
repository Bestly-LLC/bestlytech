
-- Drop the session-token policies that broke the form
DROP POLICY IF EXISTS "Owner can read own draft intake" ON public.seller_intakes;
DROP POLICY IF EXISTS "Owner can update own draft intake" ON public.seller_intakes;

-- Re-create with draft-only access (UUID knowledge = ownership)
CREATE POLICY "Anon can read own draft intake"
  ON public.seller_intakes FOR SELECT TO anon
  USING (status = 'Draft');

CREATE POLICY "Anon can update own draft intake"
  ON public.seller_intakes FOR UPDATE TO anon
  USING (status = 'Draft')
  WITH CHECK (status = 'Draft');
