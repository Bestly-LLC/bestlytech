-- Create device_tokens table for iOS push notifications
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraints (one token per user, unique device tokens)
ALTER TABLE public.device_tokens 
  ADD CONSTRAINT device_tokens_user_id_key UNIQUE (user_id);
ALTER TABLE public.device_tokens 
  ADD CONSTRAINT device_tokens_device_token_key UNIQUE (device_token);

-- Enable RLS (locked down - edge function uses service role)
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read their own token
CREATE POLICY "Users can read own device token"
  ON public.device_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- Service role handles all writes (bypasses RLS)
CREATE POLICY "Service role can manage all tokens"
  ON public.device_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger for updated_at using existing function
CREATE TRIGGER update_device_tokens_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id 
  ON public.device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device_token 
  ON public.device_tokens(device_token);