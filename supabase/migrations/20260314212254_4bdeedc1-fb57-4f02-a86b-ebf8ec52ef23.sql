
-- Admin RLS policies for all relevant tables
-- Admin is identified by email 'jaredbest@icloud.com' via auth.jwt()

-- seller_intakes: admin full access
CREATE POLICY "Admin full access seller_intakes"
ON public.seller_intakes
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' = 'jaredbest@icloud.com')
WITH CHECK (auth.jwt() ->> 'email' = 'jaredbest@icloud.com');

-- intake_documents: admin full access
CREATE POLICY "Admin full access intake_documents"
ON public.intake_documents
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' = 'jaredbest@icloud.com')
WITH CHECK (auth.jwt() ->> 'email' = 'jaredbest@icloud.com');

-- intake_validations: admin full access (insert/update/delete)
CREATE POLICY "Admin full access intake_validations"
ON public.intake_validations
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' = 'jaredbest@icloud.com')
WITH CHECK (auth.jwt() ->> 'email' = 'jaredbest@icloud.com');

-- setup_guidance: admin full access
CREATE POLICY "Admin full access setup_guidance"
ON public.setup_guidance
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' = 'jaredbest@icloud.com')
WITH CHECK (auth.jwt() ->> 'email' = 'jaredbest@icloud.com');

-- granted_access: admin full access
CREATE POLICY "Admin full access granted_access"
ON public.granted_access
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' = 'jaredbest@icloud.com')
WITH CHECK (auth.jwt() ->> 'email' = 'jaredbest@icloud.com');

-- subscriptions: admin full access
CREATE POLICY "Admin full access subscriptions"
ON public.subscriptions
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' = 'jaredbest@icloud.com')
WITH CHECK (auth.jwt() ->> 'email' = 'jaredbest@icloud.com');

-- contact_submissions: admin read access
CREATE POLICY "Admin full access contact_submissions"
ON public.contact_submissions
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' = 'jaredbest@icloud.com')
WITH CHECK (auth.jwt() ->> 'email' = 'jaredbest@icloud.com');

-- hire_requests: admin read access
CREATE POLICY "Admin full access hire_requests"
ON public.hire_requests
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' = 'jaredbest@icloud.com')
WITH CHECK (auth.jwt() ->> 'email' = 'jaredbest@icloud.com');
