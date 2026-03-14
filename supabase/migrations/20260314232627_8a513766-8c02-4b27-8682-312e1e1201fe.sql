
-- Drop the overly permissive public policies
DROP POLICY IF EXISTS "Public can select seller intakes" ON public.seller_intakes;
DROP POLICY IF EXISTS "Public can update seller intakes" ON public.seller_intakes;

-- Allow public to SELECT only Draft records (so the intake form can reload its own draft)
CREATE POLICY "Public can select draft intakes"
ON public.seller_intakes
FOR SELECT
TO public
USING (status = 'Draft');

-- Allow public to UPDATE only Draft records (prevents tampering with submitted records)
CREATE POLICY "Public can update draft intakes"
ON public.seller_intakes
FOR UPDATE
TO public
USING (status = 'Draft')
WITH CHECK (status = 'Draft');
