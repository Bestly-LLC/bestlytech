-- A partner's sign-in link carries a claim code, not a one-time auth token: the token is minted
-- when he taps it (partner-admin op claim). Making a second link used to silently kill the first.
alter table public.partners
  add column if not exists claim_hash text,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists claim_used_at timestamptz;
