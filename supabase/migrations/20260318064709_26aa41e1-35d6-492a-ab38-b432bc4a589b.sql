CREATE POLICY "Admin can read ai_generation_log"
ON public.ai_generation_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));