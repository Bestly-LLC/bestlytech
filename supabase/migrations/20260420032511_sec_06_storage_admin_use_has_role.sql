-- SEC-06: Replace hardcoded admin email with has_role(auth.uid(), 'admin')
-- on the storage policy for intake-documents. Consistent with every other
-- admin policy in the schema.
--
-- This migration was applied directly to production on 2026-04-20 via the
-- Supabase Management API. This file is the source-of-truth copy so future
-- `supabase db push` runs stay in sync.

-- Drop the old hardcoded-email policy if it exists under either name.
DROP POLICY IF EXISTS "Admin full access intake documents storage" ON storage.objects;
DROP POLICY IF EXISTS "Admin full access intake-documents storage" ON storage.objects;
DROP POLICY IF EXISTS "Admins can manage intake documents" ON storage.objects;

CREATE POLICY "Admins can manage intake documents storage"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'intake-documents' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'intake-documents' AND public.has_role(auth.uid(), 'admin'));

-- Same fix on the public.intake_documents table (migration 20260314212254
-- had a hardcoded email admin policy).
DROP POLICY IF EXISTS "Admin full access intake_documents" ON public.intake_documents;
CREATE POLICY "Admin full access intake_documents"
ON public.intake_documents
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- And on public.intake_validations.
DROP POLICY IF EXISTS "Admin full access intake_validations" ON public.intake_validations;
CREATE POLICY "Admin full access intake_validations"
ON public.intake_validations
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
