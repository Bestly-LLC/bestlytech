
-- Passkey credentials table
CREATE TABLE public.passkey_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_type text,
  transports text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used timestamptz
);

ALTER TABLE public.passkey_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages passkey_credentials"
  ON public.passkey_credentials FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can read own passkey_credentials"
  ON public.passkey_credentials FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- WebAuthn challenges table (short-lived)
CREATE TABLE public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge text NOT NULL,
  type text NOT NULL, -- 'registration' or 'authentication'
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages webauthn_challenges"
  ON public.webauthn_challenges FOR ALL TO service_role
  USING (true) WITH CHECK (true);
