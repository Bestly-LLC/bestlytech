DROP POLICY "device_reg_update" ON public.device_registrations;
CREATE POLICY "device_reg_update_service" ON public.device_registrations
  FOR UPDATE USING (auth.role() = 'service_role');