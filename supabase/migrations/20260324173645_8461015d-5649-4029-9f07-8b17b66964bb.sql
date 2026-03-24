CREATE POLICY "Users can delete own passkey_credentials"
ON public.passkey_credentials
FOR DELETE
TO authenticated
USING (user_id = auth.uid());