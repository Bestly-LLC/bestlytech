
-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Public can select intake documents" ON public.intake_documents;

-- Replace with a scoped policy: public can only see documents for draft intakes
CREATE POLICY "Public can select draft intake documents"
ON public.intake_documents FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.seller_intakes
    WHERE seller_intakes.id = intake_documents.intake_id
      AND seller_intakes.status = 'Draft'
  )
);
