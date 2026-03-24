DROP POLICY "activation_codes_select" ON public.activation_codes;

CREATE POLICY "activation_codes_service_select" ON public.activation_codes
  FOR SELECT
  USING (auth.role() = 'service_role'::text);