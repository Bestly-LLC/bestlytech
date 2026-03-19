
-- Add public DELETE policy for intake_documents scoped to draft intakes
CREATE POLICY "Public can delete draft intake documents"
ON public.intake_documents
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.seller_intakes
  WHERE seller_intakes.id = intake_documents.intake_id
    AND seller_intakes.status = 'Draft'
));

-- Add public UPDATE policy for intake_documents scoped to draft intakes
CREATE POLICY "Public can update draft intake documents"
ON public.intake_documents
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.seller_intakes
  WHERE seller_intakes.id = intake_documents.intake_id
    AND seller_intakes.status = 'Draft'
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.seller_intakes
  WHERE seller_intakes.id = intake_documents.intake_id
    AND seller_intakes.status = 'Draft'
));

-- Add server-side file constraints to intake-documents bucket
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
WHERE id = 'intake-documents';
