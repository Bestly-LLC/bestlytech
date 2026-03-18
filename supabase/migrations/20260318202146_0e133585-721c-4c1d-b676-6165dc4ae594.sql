CREATE POLICY "Admin can delete dismissal_reports"
ON public.dismissal_reports
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));