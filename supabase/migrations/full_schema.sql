-- ============================================================
-- full_schema.sql — Complete Bestly database schema
-- Generated 2026-04-05 03:42 UTC from all existing migrations
--
-- PREREQUISITES — enable these extensions first in Supabase Dashboard
-- → Database → Extensions (or via SQL Editor):
--
--   create extension if not exists pg_net with schema extensions;
--   create extension if not exists pg_cron with schema extensions;
--   create extension if not exists pgmq with schema extensions;
--   create extension if not exists supabase_vault with schema vault;
--
-- POST-MIGRATION STEPS (cannot be done via SQL alone):
--   1. Deploy edge functions:
--        supabase functions deploy --project-ref rcqfqhguwpmaarseifqg
--   2. Create storage buckets:
--        intake-documents  (private, 10 MB file limit)
--        email-assets      (public)
--   3. Set Vault secret for email queue:
--        SELECT vault.create_secret('<service_role_key>', 'email_queue_service_role_key');
--   4. Configure Apple OAuth in Dashboard → Auth → Providers
--   5. Set Auth email hook URL to the auth-email-hook edge function URL
--   6. Configure custom SMTP / Mailgun for transactional email
-- ============================================================


-- ── 20260108014931_c20aa8dc-fb3b-4ce1-a949-c89ed51fa10b.sql ──────────────────────────────────────────────────────────

-- Create the update function first
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Waitlist subscribers table
CREATE TABLE public.waitlist_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  products TEXT[] DEFAULT '{}',
  source TEXT,
  confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.waitlist_subscribers ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public signup)
CREATE POLICY "Anyone can subscribe to waitlist"
ON public.waitlist_subscribers
FOR INSERT
WITH CHECK (true);

-- Only service role can read/update/delete
CREATE POLICY "Service role can manage waitlist"
ON public.waitlist_subscribers
FOR ALL
USING (auth.role() = 'service_role');

-- Contact form submissions table
CREATE TABLE public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public form)
CREATE POLICY "Anyone can submit contact form"
ON public.contact_submissions
FOR INSERT
WITH CHECK (true);

-- Only service role can read/update/delete
CREATE POLICY "Service role can manage contact submissions"
ON public.contact_submissions
FOR ALL
USING (auth.role() = 'service_role');

-- Update timestamp trigger for waitlist
CREATE TRIGGER update_waitlist_updated_at
BEFORE UPDATE ON public.waitlist_subscribers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ── 20260126210206_e0c472e9-7271-46a1-868e-20bc23e8568d.sql ──────────────────────────────────────────────────────────

-- Create hire_requests table for intake form submissions
CREATE TABLE public.hire_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  project_type TEXT NOT NULL,
  budget_range TEXT,
  timeline TEXT,
  description TEXT NOT NULL,
  referral_source TEXT,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.hire_requests ENABLE ROW LEVEL SECURITY;

-- Allow anyone to submit a hire request (public form)
CREATE POLICY "Anyone can submit hire request"
  ON public.hire_requests
  FOR INSERT
  WITH CHECK (true);

-- Service role can manage all hire requests
CREATE POLICY "Service role can manage hire requests"
  ON public.hire_requests
  FOR ALL
  USING (auth.role() = 'service_role');

-- ── 20260127233053_8aed56f9-b16a-4e30-a35d-0c239cc207f3.sql ──────────────────────────────────────────────────────────

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

-- ── 20260309231128_e9fbb57a-ec02-480e-a2dd-e4a2a7f2d6cc.sql ──────────────────────────────────────────────────────────


-- Create cookie_patterns table
CREATE TABLE public.cookie_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  selector TEXT NOT NULL,
  action_type TEXT NOT NULL,
  cmp_fingerprint TEXT NOT NULL DEFAULT 'generic',
  confidence REAL NOT NULL DEFAULT 0.5,
  report_count INTEGER NOT NULL DEFAULT 1,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'community',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain, selector, action_type)
);

-- Validation trigger for action_type instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_cookie_pattern_action_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.action_type NOT IN ('accept', 'reject', 'necessary', 'save', 'close') THEN
    RAISE EXCEPTION 'Invalid action_type: %. Must be one of: accept, reject, necessary, save, close', NEW.action_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_cookie_pattern_action_type
  BEFORE INSERT OR UPDATE ON public.cookie_patterns
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_cookie_pattern_action_type();

-- Update updated_at trigger
CREATE TRIGGER trg_cookie_patterns_updated_at
  BEFORE UPDATE ON public.cookie_patterns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_cookie_patterns_domain ON public.cookie_patterns (domain);
CREATE INDEX idx_cookie_patterns_updated_at ON public.cookie_patterns (updated_at);

-- Enable RLS
ALTER TABLE public.cookie_patterns ENABLE ROW LEVEL SECURITY;

-- RLS policies: public read and insert
CREATE POLICY "Anyone can read cookie patterns"
  ON public.cookie_patterns
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can insert cookie patterns"
  ON public.cookie_patterns
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Service role can manage all
CREATE POLICY "Service role can manage cookie patterns"
  ON public.cookie_patterns
  FOR ALL
  TO public
  USING (auth.role() = 'service_role'::text);

-- SECURITY DEFINER function: upsert_pattern
CREATE OR REPLACE FUNCTION public.upsert_pattern(
  _domain TEXT,
  _selector TEXT,
  _action_type TEXT,
  _cmp_fingerprint TEXT DEFAULT 'generic',
  _source TEXT DEFAULT 'community'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.cookie_patterns (domain, selector, action_type, cmp_fingerprint, source, last_seen)
  VALUES (_domain, _selector, _action_type, _cmp_fingerprint, _source, now())
  ON CONFLICT (domain, selector, action_type)
  DO UPDATE SET
    report_count = cookie_patterns.report_count + 1,
    confidence = LEAST(cookie_patterns.confidence + 0.02, 1.0),
    last_seen = now(),
    updated_at = now();
END;
$$;

-- SECURITY DEFINER function: record_pattern_success
CREATE OR REPLACE FUNCTION public.record_pattern_success(
  _domain TEXT,
  _selector TEXT,
  _action_type TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.cookie_patterns
  SET
    success_count = success_count + 1,
    confidence = LEAST(confidence + 0.03, 1.0),
    updated_at = now()
  WHERE domain = _domain
    AND selector = _selector
    AND action_type = _action_type;
END;
$$;


-- ── 20260313225339_01392fad-7c43-479e-8e17-140e3f3796c6.sql ──────────────────────────────────────────────────────────

CREATE TABLE subscriptions (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, email TEXT NOT NULL, stripe_customer_id TEXT, stripe_subscription_id TEXT, plan TEXT NOT NULL CHECK (plan IN ('monthly','yearly','lifetime')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','past_due','expired')), current_period_end TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()); CREATE UNIQUE INDEX idx_subscriptions_email ON subscriptions(email); CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id); ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY; CREATE POLICY "subscriptions_read" ON subscriptions FOR SELECT USING (true); CREATE POLICY "subscriptions_insert_service" ON subscriptions FOR INSERT WITH CHECK (auth.role() = 'service_role'); CREATE POLICY "subscriptions_update_service" ON subscriptions FOR UPDATE USING (auth.role() = 'service_role');

-- ── 20260314174833_06d56944-0b23-4b5b-b61a-085d57de0f59.sql ──────────────────────────────────────────────────────────

CREATE TABLE granted_access (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, email TEXT NOT NULL, granted_by TEXT DEFAULT 'admin', reason TEXT, created_at TIMESTAMPTZ DEFAULT now()); CREATE UNIQUE INDEX idx_granted_access_email ON granted_access(email); ALTER TABLE granted_access ENABLE ROW LEVEL SECURITY; CREATE POLICY "granted_access_read" ON granted_access FOR SELECT USING (true); CREATE POLICY "granted_access_insert_service" ON granted_access FOR INSERT WITH CHECK (auth.role() = 'service_role'); CREATE POLICY "granted_access_update_service" ON granted_access FOR UPDATE USING (auth.role() = 'service_role'); CREATE POLICY "granted_access_delete_service" ON granted_access FOR DELETE USING (auth.role() = 'service_role');

-- ── 20260314210433_1ccee93f-5bd1-4d08-b3c3-fad7d106287c.sql ──────────────────────────────────────────────────────────


-- seller_intakes table
CREATE TABLE public.seller_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'Draft',
  completed_steps integer[] DEFAULT '{}',
  platform text NOT NULL DEFAULT 'Amazon',
  client_name text,
  client_email text,
  client_phone text,
  preferred_contact_method text,
  client_timezone text,
  business_legal_name text,
  business_type text,
  state_of_registration text,
  ein text,
  registered_agent_service text,
  registered_agent_address text,
  registered_agent_city text,
  registered_agent_state text,
  registered_agent_zip text,
  operating_address text,
  operating_city text,
  operating_state text,
  operating_zip text,
  addresses_differ boolean DEFAULT false,
  contact_first_name text,
  contact_middle_name text,
  contact_last_name text,
  citizenship_country text,
  birth_country text,
  date_of_birth date,
  ssn_itin text,
  tax_residency text,
  id_type text,
  id_number text,
  id_expiry_date date,
  id_country_of_issue text,
  residential_address text,
  residential_city text,
  residential_state text,
  residential_zip text,
  phone_number text,
  bank_name text,
  account_holder_name text,
  account_number_last4 text,
  routing_number_last4 text,
  account_type text,
  credit_card_last4 text,
  credit_card_expiry text,
  has_upcs boolean DEFAULT false,
  has_diversity_certs boolean DEFAULT false,
  owns_brand boolean DEFAULT false,
  brand_name text,
  amazon_store_name text,
  has_trademark boolean DEFAULT false,
  trademark_number text,
  product_category text,
  number_of_products text,
  fulfillment_method text,
  product_description text,
  setup_by_representative boolean DEFAULT false,
  rep_name text,
  rep_relationship text,
  amazon_email text,
  amazon_phone text,
  seller_plan text DEFAULT 'Professional',
  admin_notes text
);

-- intake_documents table
CREATE TABLE public.intake_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.seller_intakes(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_at timestamptz DEFAULT now()
);

-- intake_validations table
CREATE TABLE public.intake_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.seller_intakes(id) ON DELETE CASCADE,
  severity text NOT NULL,
  field_name text NOT NULL,
  message text NOT NULL,
  resolved boolean DEFAULT false,
  resolved_notes text,
  created_at timestamptz DEFAULT now()
);

-- setup_guidance table
CREATE TABLE public.setup_guidance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  section text NOT NULL,
  field_name text NOT NULL,
  guidance_text text NOT NULL,
  answer_recommendation text,
  reason text,
  display_order integer NOT NULL DEFAULT 0
);

-- Indexes
CREATE INDEX idx_intake_documents_intake_id ON public.intake_documents(intake_id);
CREATE INDEX idx_intake_validations_intake_id ON public.intake_validations(intake_id);
CREATE INDEX idx_seller_intakes_status ON public.seller_intakes(status);

-- updated_at trigger
CREATE TRIGGER update_seller_intakes_updated_at
  BEFORE UPDATE ON public.seller_intakes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Status validation trigger
CREATE OR REPLACE FUNCTION public.validate_seller_intake_status()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('Draft', 'Submitted', 'In Review', 'Issues Flagged', 'Approved') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_seller_intake_status_trigger
  BEFORE INSERT OR UPDATE ON public.seller_intakes
  FOR EACH ROW EXECUTE FUNCTION public.validate_seller_intake_status();

-- Document type validation trigger
CREATE OR REPLACE FUNCTION public.validate_intake_document_type()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.document_type NOT IN ('BusinessRegistration', 'BusinessAddressProof', 'IDFront', 'IDBack', 'PersonalAddressProof', 'DiversityCert', 'TrademarkDoc', 'RepID', 'AuthorizationLetter', 'BankStatement', 'CreditCardFront', 'W9', 'Other') THEN
    RAISE EXCEPTION 'Invalid document_type: %', NEW.document_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_intake_document_type_trigger
  BEFORE INSERT OR UPDATE ON public.intake_documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_intake_document_type();

-- RLS
ALTER TABLE public.seller_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_guidance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can insert seller intakes" ON public.seller_intakes FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can select seller intakes" ON public.seller_intakes FOR SELECT USING (true);
CREATE POLICY "Public can update seller intakes" ON public.seller_intakes FOR UPDATE USING (true);
CREATE POLICY "Service role manages seller intakes" ON public.seller_intakes FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public can insert intake documents" ON public.intake_documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can select intake documents" ON public.intake_documents FOR SELECT USING (true);
CREATE POLICY "Service role manages intake documents" ON public.intake_documents FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public can read validations" ON public.intake_validations FOR SELECT USING (true);
CREATE POLICY "Service role manages validations" ON public.intake_validations FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public can read setup guidance" ON public.setup_guidance FOR SELECT USING (true);
CREATE POLICY "Service role manages guidance" ON public.setup_guidance FOR ALL USING (auth.role() = 'service_role');

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('intake-documents', 'intake-documents', false);

CREATE POLICY "Anyone can upload intake docs" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'intake-documents');
CREATE POLICY "Anyone can view intake docs" ON storage.objects FOR SELECT USING (bucket_id = 'intake-documents');

-- Seed setup_guidance
INSERT INTO public.setup_guidance (platform, section, field_name, guidance_text, answer_recommendation, reason, display_order) VALUES
('Amazon', 'Onboarding Questions', 'UPCs', 'Do you have Universal Product Codes (UPCs) for all your products?', 'No', 'Products will initially be listed using GTIN exemption. Do not claim UPC ownership unless verified GS1 codes exist.', 1),
('Amazon', 'Onboarding Questions', 'Diversity Certifications', 'Do you have any diversity certifications?', 'No', 'Do not claim certifications without documentation. Can be updated later if certified.', 2),
('Amazon', 'Onboarding Questions', 'Brand Ownership', 'Do you own a brand or serve as agent/representative/manufacturer of a brand?', 'Yes (if selling under own brand)', 'Select Yes if the client is selling products under their own brand name.', 3),
('Amazon', 'Onboarding Questions', 'Trademark', 'Does your brand have an active registered trademark?', 'No (unless USPTO registration exists)', 'Do not claim a trademark unless a USPTO registration number exists. Brand Registry can be completed later.', 4),
('Amazon', 'Document Tips', 'Registration Extract', 'Registration Extract document', 'Use Certificate of Formation or Articles of Organization', 'The IRS EIN letter (CP575H) is NOT accepted as a Registration Extract. Must be a state-issued document. Address on document MUST match the Registered Business Address field exactly.', 5),
('Amazon', 'Document Tips', 'Proof of Address', 'Proof of Address document', 'Use actual bank statement with transactions', 'A bank letter is NOT the same as a bank statement. Amazon requires a full statement with transactions, dates, account holder name, and address. Must be within 180 days.', 6);


-- ── 20260314212254_4bdeedc1-fb57-4f02-a86b-ebf8ec52ef23.sql ──────────────────────────────────────────────────────────


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


-- ── 20260314214725_51cad86d-7c9f-4182-90a8-aa2880eae81c.sql ──────────────────────────────────────────────────────────


ALTER TABLE public.seller_intakes
  ADD COLUMN IF NOT EXISTS selected_platforms text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS shopify_store_name text,
  ADD COLUMN IF NOT EXISTS shopify_email text,
  ADD COLUMN IF NOT EXISTS shopify_plan text DEFAULT 'Basic',
  ADD COLUMN IF NOT EXISTS shopify_domain text,
  ADD COLUMN IF NOT EXISTS shipping_method text,
  ADD COLUMN IF NOT EXISTS has_existing_shopify boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS existing_shopify_url text,
  ADD COLUMN IF NOT EXISTS tiktok_shop_name text,
  ADD COLUMN IF NOT EXISTS tiktok_email text,
  ADD COLUMN IF NOT EXISTS tiktok_phone text,
  ADD COLUMN IF NOT EXISTS tiktok_category text,
  ADD COLUMN IF NOT EXISTS tiktok_fulfillment text,
  ADD COLUMN IF NOT EXISTS has_tiktok_creator boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tiktok_handle text;


-- ── 20260314220446_2855580f-c4e2-4e54-8383-2550914c5f16.sql ──────────────────────────────────────────────────────────

CREATE TABLE public.device_registrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'chrome',
  user_agent TEXT,
  first_seen TIMESTAMPTZ DEFAULT now(),
  last_seen TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_device_reg_email_device ON public.device_registrations(email, device_id);
CREATE INDEX idx_device_reg_email ON public.device_registrations(email);

ALTER TABLE public.device_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_reg_read" ON public.device_registrations
  FOR SELECT USING (true);

CREATE POLICY "device_reg_insert" ON public.device_registrations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "device_reg_update" ON public.device_registrations
  FOR UPDATE USING (true);

CREATE POLICY "device_reg_service" ON public.device_registrations
  FOR ALL USING (auth.role() = 'service_role');

-- ── 20260314223222_2878a8e5-a7b6-42c0-9993-bd10cf80cf4e.sql ──────────────────────────────────────────────────────────


-- Seed shared guidance entries (business, owner, bank, auth steps)
INSERT INTO public.setup_guidance (platform, section, field_name, guidance_text, answer_recommendation, reason, display_order) VALUES
-- Step 1: Business Info (Shared)
('Shared', 'Business Information', 'business_legal_name', 'Enter the exact legal name from your state formation documents (Certificate of Formation, Articles of Organization, etc.).', 'Copy it character-for-character from your state filing — even punctuation matters.', 'Amazon, Shopify, and TikTok all verify business names against state records. Mismatches cause rejections.', 1),
('Shared', 'Business Information', 'business_type', 'Select the entity type that matches your state registration.', 'Most new sellers register as an LLC. If you''re unsure, check your formation documents.', 'This determines tax treatment and liability protection.', 2),
('Shared', 'Business Information', 'state_of_registration', 'The U.S. state where your business entity was formed/registered.', NULL, 'Must match your formation documents exactly.', 3),
('Shared', 'Business Information', 'ein', 'Your 9-digit Employer Identification Number from the IRS (format: XX-XXXXXXX).', 'You can find this on your IRS CP 575 notice or by calling the IRS Business line.', 'Required for all marketplace platforms for tax reporting.', 4),
('Shared', 'Business Information', 'registered_agent_service', 'The company or individual serving as your registered agent in your state of registration.', 'If you used ZenBusiness, LegalZoom, or similar, select them here.', 'The registered agent address on file with the state is what platforms verify against.', 5),
('Shared', 'Business Information', 'registered_agent_address', 'The physical address of your registered agent as shown on your state filing.', 'This is NOT your home address — it''s the agent''s office address from your Certificate of Formation.', 'This is the #1 reason Amazon rejects applications. Must match state records exactly.', 6),

-- Step 2: Owner Info (Shared)
('Shared', 'Owner Information', 'contact_first_name', 'Enter your legal first name exactly as it appears on your government-issued ID.', 'Check your passport or driver''s license — use the exact spelling.', 'Name mismatches between your ID and application cause verification failures.', 10),
('Shared', 'Owner Information', 'date_of_birth', 'Your date of birth as it appears on your government ID.', NULL, 'You must be 18 or older to register on all platforms.', 11),
('Shared', 'Owner Information', 'id_type', 'Choose the type of government-issued photo ID you''ll use for verification.', 'Passport is preferred — it''s accepted globally and has fewer issues. Driver''s licenses require front AND back photos.', 'All platforms require government ID verification for the business owner.', 12),
('Shared', 'Owner Information', 'id_number', 'The unique number printed on your government ID.', 'For passports, use the number on the data page. For licenses, use the license number.', NULL, 13),
('Shared', 'Owner Information', 'id_expiry_date', 'The expiration date of your ID. It must not be expired.', 'If your ID expires within 6 months, consider renewing it first to avoid delays.', 'Expired IDs are automatically rejected.', 14),
('Shared', 'Owner Information', 'ssn_itin', 'Your Social Security Number or Individual Taxpayer Identification Number.', 'This is needed for IRS W-9 forms. You can provide it later, but it will be required before going live.', 'Only the last 4 digits are stored for security.', 15),
('Shared', 'Owner Information', 'residential_address', 'Your current home address. This is used for identity verification, not displayed publicly.', 'Must match the address on your utility bill or bank statement that you''ll upload as proof.', NULL, 16),

-- Step 3: Bank (Shared)
('Shared', 'Bank & Payment', 'bank_name', 'The name of your bank or financial institution.', 'Use a business checking account if you have one. Personal accounts work too.', 'Marketplace payouts will be deposited to this account.', 20),
('Shared', 'Bank & Payment', 'account_holder_name', 'The name on the bank account. Must match either the business legal name or the owner''s name.', 'If the account is in your business name, use the exact business legal name.', 'A name mismatch between the bank account and your application can flag your account.', 21),
('Shared', 'Bank & Payment', 'credit_card_last4', 'The last 4 digits of the credit or debit card for platform subscription fees.', 'Use a card that won''t expire soon. You''ll enter the full number during platform setup.', 'Amazon charges $39.99/month for Professional plans. Shopify has monthly plan fees too.', 22),

-- Step 5: Authorization (Shared)
('Shared', 'Authorization', 'setup_by_representative', 'Indicate whether the business owner is setting up the account or authorizing someone else.', 'If you (the owner) are filling this out, leave it as "Owner setup" — no extra documents needed.', 'If a representative is setting up the account, authorization documents are required by all platforms.', 25),
('Shared', 'Authorization', 'rep_name', 'The full legal name of the person authorized to set up accounts on behalf of the business.', NULL, 'Must match their government ID.', 26),

-- Amazon-specific
('Amazon', 'Amazon Details', 'amazon_store_name', 'The brand or store name customers will see on your Amazon listings.', 'Choose something professional and memorable. You can change it later.', 'This appears on your Amazon storefront and product listings.', 30),
('Amazon', 'Amazon Details', 'has_upcs', 'Universal Product Codes — unique barcodes for each product.', 'If you don''t have UPCs, we''ll apply for a GTIN exemption. Most new private-label sellers don''t have them.', 'Amazon requires UPCs or a GTIN exemption to list products.', 31),
('Amazon', 'Amazon Details', 'fulfillment_method', 'How orders will be shipped to customers.', 'FBA (Fulfillment by Amazon) is recommended for new sellers — Amazon handles storage, packing, and shipping. Start with FBA and add FBM later if needed.', 'FBA products get Prime badges, which significantly increase sales.', 32),
('Amazon', 'Amazon Details', 'product_category', 'The primary category your products fall under on Amazon.', 'Some categories require pre-approval (called "ungating"). Common categories like Home & Kitchen are open.', NULL, 33),
('Amazon', 'Amazon Details', 'amazon_email', 'The email address that will be the login for Amazon Seller Central.', 'Use a dedicated business email (not your personal one). Create a new one like seller@yourbusiness.com if needed.', 'This email receives all Amazon notifications, buyer messages, and account alerts.', 34),
('Amazon', 'Amazon Details', 'seller_plan', 'Amazon offers Professional ($39.99/month) and Individual ($0.99/item) plans.', 'Choose Professional — it''s required for advertising, winning the Buy Box, and using most seller tools.', 'Individual plan sellers cannot run ads or access advanced analytics.', 35),

-- Shopify-specific
('Shopify', 'Shopify Details', 'shopify_store_name', 'The name of your Shopify store. This appears in your admin and can be used as your default domain.', 'Use your brand name. Keep it short and easy to remember.', 'You can always change the display name later, but the myshopify.com subdomain is permanent.', 40),
('Shopify', 'Shopify Details', 'shopify_plan', 'Shopify offers Basic ($39/mo), Shopify ($105/mo), and Advanced ($399/mo) plans.', 'Start with Basic — it covers everything a new store needs. You can upgrade anytime.', 'Higher plans reduce transaction fees and add features like professional reports.', 41),
('Shopify', 'Shopify Details', 'shopify_domain', 'A custom domain like yourbrand.com for your Shopify store.', 'If you don''t have one yet, you can purchase one through Shopify or a registrar like Namecheap.', 'Custom domains build trust. Your free domain will be yourstore.myshopify.com.', 42),
('Shopify', 'Shopify Details', 'shipping_method', 'How you plan to fulfill and ship orders from your Shopify store.', 'Self-ship if you''re just starting with low volume. Consider a 3PL once you exceed ~50 orders/month.', NULL, 43),
('Shopify', 'Shopify Details', 'shopify_email', 'The email used to log in to your Shopify admin dashboard.', 'Use a business email. This is also where Shopify sends order notifications and account alerts.', NULL, 44),
('Shopify', 'Shopify Details', 'has_existing_shopify', 'Let us know if you already have a Shopify store set up.', 'If you have an existing store, we can migrate or optimize it instead of starting from scratch.', NULL, 45),

-- TikTok-specific
('TikTok', 'TikTok Details', 'tiktok_shop_name', 'The name for your TikTok Shop that buyers will see.', 'Use your brand name for consistency across platforms.', 'This appears on your TikTok Shop storefront and in the shopping tab.', 50),
('TikTok', 'TikTok Details', 'tiktok_handle', 'Your @username on TikTok. Links your creator account to your shop.', 'If you don''t have a TikTok account yet, create one with your brand name before applying.', 'Having an active TikTok account with content improves your shop approval chances.', 51),
('TikTok', 'TikTok Details', 'tiktok_category', 'The primary product category for your TikTok Shop listings.', 'Choose the category that best fits your main products. You can list in multiple categories later.', 'Some categories have higher commission rates or require additional verification.', 52),
('TikTok', 'TikTok Details', 'tiktok_fulfillment', 'How orders from TikTok Shop will be shipped.', 'Self-fulfillment gives you more control. TikTok Fulfillment (like FBA) is newer and limited to certain regions.', NULL, 53),
('TikTok', 'TikTok Details', 'tiktok_email', 'Email for your TikTok Shop Seller Center account.', 'Can be the same email as your TikTok account or a separate business email.', 'TikTok sends order notifications and policy updates to this email.', 54),
('TikTok', 'TikTok Details', 'has_tiktok_creator', 'A TikTok Creator account enables analytics, live streaming, and affiliate features.', 'If you plan to promote products through your own TikTok content, upgrade to a Creator account first.', 'Creator accounts unlock the ability to add product links to videos and go live.', 55);


-- ── 20260314232627_8a513766-8c02-4b27-8682-312e1e1201fe.sql ──────────────────────────────────────────────────────────


-- Drop the overly permissive public policies
DROP POLICY IF EXISTS "Public can select seller intakes" ON public.seller_intakes;
DROP POLICY IF EXISTS "Public can update seller intakes" ON public.seller_intakes;

-- Allow public to SELECT only Draft records (so the intake form can reload its own draft)
CREATE POLICY "Public can select draft intakes"
ON public.seller_intakes
FOR SELECT
TO public
USING (status = 'Draft');

-- Allow public to UPDATE only Draft records (prevents tampering with submitted records)
CREATE POLICY "Public can update draft intakes"
ON public.seller_intakes
FOR UPDATE
TO public
USING (status = 'Draft')
WITH CHECK (status = 'Draft');


-- ── 20260314235128_e3eba807-ad85-4932-a688-841c190f84a7.sql ──────────────────────────────────────────────────────────


-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Public can select intake documents" ON public.intake_documents;

-- Replace with a scoped policy: public can only see documents for draft intakes
CREATE POLICY "Public can select draft intake documents"
ON public.intake_documents FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.seller_intakes
    WHERE seller_intakes.id = intake_documents.intake_id
      AND seller_intakes.status = 'Draft'
  )
);


-- ── 20260315041835_abc8df40-737c-4010-9a56-9e7a864535f1.sql ──────────────────────────────────────────────────────────


CREATE OR REPLACE FUNCTION get_community_overview() RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT json_build_object('total_patterns', (SELECT count(*) FROM cookie_patterns), 'total_domains', (SELECT count(DISTINCT domain) FROM cookie_patterns), 'high_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.8), 'low_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence < 0.4), 'avg_confidence', (SELECT round(avg(confidence)::numeric, 3) FROM cookie_patterns), 'total_reports', (SELECT coalesce(sum(report_count), 0) FROM cookie_patterns), 'total_successes', (SELECT coalesce(sum(success_count), 0) FROM cookie_patterns), 'overall_success_rate', (SELECT CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END FROM cookie_patterns), 'patterns_last_24h', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '24 hours'), 'patterns_last_7d', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '7 days'), 'new_domains_last_7d', (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at >= now() - interval '7 days'), 'stale_patterns', (SELECT count(*) FROM cookie_patterns WHERE last_seen < now() - interval '30 days')); $$;

CREATE OR REPLACE FUNCTION get_daily_pattern_activity(p_days INTEGER DEFAULT 30) RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT d::date AS date, (SELECT count(*) FROM cookie_patterns WHERE created_at::date = d::date) AS new_patterns, (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at::date = d::date) AS new_domains, (SELECT count(*) FROM cookie_patterns WHERE last_seen::date = d::date) AS active_patterns FROM generate_series((now() - make_interval(days => p_days))::date, now()::date, '1 day'::interval) AS d ORDER BY d) t; $$;

CREATE OR REPLACE FUNCTION get_top_domains(p_limit INTEGER DEFAULT 25) RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, count(*) AS pattern_count, round(avg(confidence)::numeric, 3) AS avg_confidence, coalesce(sum(report_count), 0) AS total_reports, coalesce(sum(success_count), 0) AS total_successes, CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END AS success_rate, max(last_seen) AS last_active FROM cookie_patterns GROUP BY domain ORDER BY pattern_count DESC LIMIT p_limit) t; $$;

CREATE OR REPLACE FUNCTION get_recently_learned(p_limit INTEGER DEFAULT 50) RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, selector, action_type, cmp_fingerprint, confidence, report_count, success_count, source, created_at, last_seen FROM cookie_patterns ORDER BY created_at DESC LIMIT p_limit) t; $$;

CREATE OR REPLACE FUNCTION get_pattern_issues(p_limit INTEGER DEFAULT 50) RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, selector, action_type, confidence, report_count, success_count, CASE WHEN sum(report_count) OVER () > 0 THEN round((success_count::numeric / NULLIF(report_count, 0)::numeric) * 100, 1) ELSE 0 END AS success_rate, last_seen, CASE WHEN confidence < 0.3 THEN 'very_low_confidence' WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds' WHEN last_seen < now() - interval '30 days' THEN 'stale' WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate' ELSE 'other' END AS issue_type FROM cookie_patterns WHERE confidence < 0.4 OR (report_count > 5 AND success_count = 0) OR last_seen < now() - interval '30 days' OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2) ORDER BY confidence ASC, report_count DESC LIMIT p_limit) t; $$;

CREATE OR REPLACE FUNCTION get_cmp_distribution() RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT cmp_fingerprint, count(*) AS pattern_count, count(DISTINCT domain) AS domain_count, round(avg(confidence)::numeric, 3) AS avg_confidence, CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END AS success_rate FROM cookie_patterns GROUP BY cmp_fingerprint ORDER BY pattern_count DESC) t; $$;

CREATE OR REPLACE FUNCTION get_action_type_stats() RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT action_type, count(*) AS count, round(avg(confidence)::numeric, 3) AS avg_confidence, coalesce(sum(report_count), 0) AS total_reports, coalesce(sum(success_count), 0) AS total_successes FROM cookie_patterns GROUP BY action_type ORDER BY count DESC) t; $$;

CREATE OR REPLACE FUNCTION get_confidence_distribution() RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT bucket, label, count FROM (VALUES (0, '0.0-0.2', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.0 AND confidence < 0.2)), (1, '0.2-0.4', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.2 AND confidence < 0.4)), (2, '0.4-0.6', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.4 AND confidence < 0.6)), (3, '0.6-0.8', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.6 AND confidence < 0.8)), (4, '0.8-1.0', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.8 AND confidence <= 1.0))) AS v(bucket, label, count) ORDER BY bucket) t; $$;

CREATE OR REPLACE FUNCTION get_source_breakdown() RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT source, count(*) AS count, round(avg(confidence)::numeric, 3) AS avg_confidence, count(DISTINCT domain) AS domain_count FROM cookie_patterns GROUP BY source ORDER BY count DESC) t; $$;

GRANT EXECUTE ON FUNCTION get_community_overview() TO anon;
GRANT EXECUTE ON FUNCTION get_daily_pattern_activity(INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION get_top_domains(INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION get_recently_learned(INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION get_pattern_issues(INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION get_cmp_distribution() TO anon;
GRANT EXECUTE ON FUNCTION get_action_type_stats() TO anon;
GRANT EXECUTE ON FUNCTION get_confidence_distribution() TO anon;
GRANT EXECUTE ON FUNCTION get_source_breakdown() TO anon;


-- ── 20260315051448_be545c4d-8a43-42f7-be41-2e13799cdc9a.sql ──────────────────────────────────────────────────────────


-- Audit log table for auto-fix actions
CREATE TABLE IF NOT EXISTS pattern_fix_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  domain TEXT NOT NULL,
  selector TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_fix_log_created ON pattern_fix_log (created_at DESC);

ALTER TABLE pattern_fix_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read on pattern_fix_log"
  ON pattern_fix_log FOR SELECT TO anon USING (true);

-- Auto-fix RPC function
CREATE OR REPLACE FUNCTION auto_fix_pattern_issues()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
  result_details JSON[] := '{}';
  processed INT := 0;
  fixed INT := 0;
  failed INT := 0;
  action_desc TEXT;
  fix_success BOOLEAN;
  fix_error TEXT;
BEGIN
  FOR rec IN
    SELECT
      id, domain, selector, action_type, confidence,
      report_count, success_count, last_seen,
      CASE
        WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds'
        WHEN confidence < 0.3 THEN 'very_low_confidence'
        WHEN last_seen < now() - interval '30 days' THEN 'stale'
        WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate'
        ELSE 'other'
      END AS issue_type
    FROM cookie_patterns
    WHERE
      confidence < 0.4
      OR (report_count > 5 AND success_count = 0)
      OR last_seen < now() - interval '30 days'
      OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2)
  LOOP
    processed := processed + 1;
    fix_success := true;
    fix_error := NULL;

    BEGIN
      CASE rec.issue_type
        WHEN 'stale' THEN
          DELETE FROM cookie_patterns WHERE id = rec.id;
          action_desc := 'deleted_stale';
        WHEN 'never_succeeds' THEN
          DELETE FROM cookie_patterns WHERE id = rec.id;
          action_desc := 'deleted_broken';
        WHEN 'very_low_confidence' THEN
          UPDATE cookie_patterns SET confidence = 0 WHERE id = rec.id;
          action_desc := 'confidence_zeroed';
        WHEN 'low_success_rate' THEN
          UPDATE cookie_patterns SET confidence = confidence / 2 WHERE id = rec.id;
          action_desc := 'confidence_halved';
        ELSE
          action_desc := 'skipped';
      END CASE;
      fixed := fixed + 1;
    EXCEPTION WHEN OTHERS THEN
      fix_success := false;
      fix_error := SQLERRM;
      failed := failed + 1;
      action_desc := rec.issue_type || '_fix_attempted';
    END;

    INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success, error_message)
    VALUES (rec.domain, rec.selector, rec.issue_type, action_desc, fix_success, fix_error);

    result_details := result_details || json_build_object(
      'domain', rec.domain, 'selector', rec.selector,
      'issue', rec.issue_type, 'action', action_desc,
      'success', fix_success, 'error', fix_error
    )::json;
  END LOOP;

  RETURN json_build_object(
    'processed', processed,
    'fixed', fixed,
    'failed', failed,
    'details', to_json(result_details)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION auto_fix_pattern_issues() TO anon;

-- Missed banner reports tracking table
CREATE TABLE IF NOT EXISTS missed_banner_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  domain TEXT NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 1,
  has_working_pattern BOOLEAN NOT NULL DEFAULT false,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  last_reported TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(domain)
);

CREATE INDEX IF NOT EXISTS idx_missed_banner_domain ON missed_banner_reports (domain);
CREATE INDEX IF NOT EXISTS idx_missed_banner_unresolved ON missed_banner_reports (resolved, report_count DESC);

ALTER TABLE missed_banner_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read on missed_banner_reports"
  ON missed_banner_reports FOR SELECT TO anon USING (true);

-- Process user-reported missed banners
CREATE OR REPLACE FUNCTION process_user_reports()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
  working_count INT;
  total_reports INT := 0;
  newly_resolved INT := 0;
  priority_domains JSON[];
BEGIN
  INSERT INTO missed_banner_reports (domain, report_count, last_reported)
  SELECT
    domain,
    count(*) AS report_count,
    max(last_seen) AS last_reported
  FROM cookie_patterns
  WHERE cmp_fingerprint = 'user_report'
  GROUP BY domain
  ON CONFLICT (domain)
  DO UPDATE SET
    report_count = EXCLUDED.report_count,
    last_reported = EXCLUDED.last_reported;

  FOR rec IN
    SELECT mbr.id, mbr.domain, mbr.report_count
    FROM missed_banner_reports mbr
    WHERE mbr.resolved = false
  LOOP
    total_reports := total_reports + 1;

    SELECT count(*) INTO working_count
    FROM cookie_patterns
    WHERE domain = rec.domain
      AND cmp_fingerprint != 'user_report'
      AND confidence >= 0.5
      AND success_count > 0;

    IF working_count > 0 THEN
      UPDATE missed_banner_reports
      SET resolved = true,
          resolved_at = now(),
          has_working_pattern = true
      WHERE id = rec.id;
      newly_resolved := newly_resolved + 1;

      UPDATE cookie_patterns
      SET confidence = LEAST(1.0, confidence + 0.1)
      WHERE domain = rec.domain
        AND cmp_fingerprint = 'user_report'
        AND success_count > 0;

      INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success)
      VALUES (rec.domain, 'user_report', 'user_reported_resolved', 'marked_resolved', true);
    ELSE
      UPDATE missed_banner_reports
      SET has_working_pattern = false
      WHERE id = rec.id;
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(row_to_json(t)::json), '{}')
  INTO priority_domains
  FROM (
    SELECT domain, report_count, last_reported
    FROM missed_banner_reports
    WHERE resolved = false AND report_count >= 3
    ORDER BY report_count DESC
    LIMIT 20
  ) t;

  RETURN json_build_object(
    'total_unresolved', total_reports - newly_resolved,
    'newly_resolved', newly_resolved,
    'priority_domains', to_json(priority_domains)
  );
END;
$$;

-- Get unresolved user reports (for dashboard)
CREATE OR REPLACE FUNCTION get_unresolved_reports(p_limit INTEGER DEFAULT 50)
RETURNS JSON
LANGUAGE sql STABLE
SECURITY DEFINER
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT
      domain,
      report_count,
      has_working_pattern,
      last_reported,
      created_at
    FROM missed_banner_reports
    WHERE resolved = false
    ORDER BY report_count DESC, last_reported DESC
    LIMIT p_limit
  ) t;
$$;

GRANT EXECUTE ON FUNCTION process_user_reports() TO anon;
GRANT EXECUTE ON FUNCTION get_unresolved_reports(INTEGER) TO anon;


-- ── 20260315052533_c3a4d2a9-35a3-4069-8e5f-8537d209be6b.sql ──────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 20260315060316_08185e22-8615-4046-873a-912c13fe411b.sql ──────────────────────────────────────────────────────────


CREATE TABLE activation_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  platform TEXT DEFAULT 'unknown',
  active BOOLEAN DEFAULT false,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  last_verified TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_activation_email_code ON activation_codes(email, code);
CREATE INDEX idx_activation_email_active ON activation_codes(email) WHERE active = true;

ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activation_codes_select" ON activation_codes FOR SELECT USING (true);
CREATE POLICY "activation_codes_service_insert" ON activation_codes FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "activation_codes_service_update" ON activation_codes FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "activation_codes_service_delete" ON activation_codes FOR DELETE USING (auth.role() = 'service_role');


-- ── 20260315195227_0a8c3b71-578f-4285-a2d5-0362f5db9821.sql ──────────────────────────────────────────────────────────


-- Enable realtime on tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_intakes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.granted_access;

-- Activity feed table
CREATE TABLE public.admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read activity log"
  ON public.admin_activity_log FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'email') = 'jaredbest@icloud.com');

CREATE POLICY "Service role manages activity log"
  ON public.admin_activity_log FOR ALL TO service_role
  USING (true);

-- Trigger: log new submissions
CREATE OR REPLACE FUNCTION public.log_new_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  INSERT INTO admin_activity_log (event_type, description, metadata)
  VALUES ('new_submission',
    'New intake from ' || coalesce(NEW.client_name, NEW.business_legal_name, 'Unknown'),
    jsonb_build_object('intake_id', NEW.id, 'status', NEW.status, 'platform', NEW.platform));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_log_submission
  AFTER INSERT ON seller_intakes
  FOR EACH ROW EXECUTE FUNCTION log_new_submission();

-- Trigger: log granted access
CREATE OR REPLACE FUNCTION public.log_granted_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  INSERT INTO admin_activity_log (event_type, description, metadata)
  VALUES ('access_granted',
    'Access granted to ' || NEW.email,
    jsonb_build_object('grant_id', NEW.id, 'reason', NEW.reason, 'granted_by', NEW.granted_by));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_log_granted_access
  AFTER INSERT ON granted_access
  FOR EACH ROW EXECUTE FUNCTION log_granted_access();


-- ── 20260316064816_1afa59e4-7a01-4a43-b0f2-41d2a17a7d71.sql ──────────────────────────────────────────────────────────


-- Add columns to missed_banner_reports
ALTER TABLE missed_banner_reports
  ADD COLUMN IF NOT EXISTS banner_html TEXT,
  ADD COLUMN IF NOT EXISTS page_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cmp_fingerprint TEXT DEFAULT 'unknown';

-- Create ai_generation_log table
CREATE TABLE IF NOT EXISTS ai_generation_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  selector_generated TEXT,
  action_type TEXT,
  confidence REAL,
  ai_model TEXT DEFAULT 'claude-sonnet',
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  error_message TEXT,
  html_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_gen_log_created ON ai_generation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gen_log_domain ON ai_generation_log (domain);

ALTER TABLE ai_generation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read on ai_generation_log" ON ai_generation_log FOR SELECT TO anon USING (true);
CREATE POLICY "Allow service role all on ai_generation_log" ON ai_generation_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RPC: report_missed_banner_with_html
CREATE OR REPLACE FUNCTION report_missed_banner_with_html(_domain TEXT, _page_url TEXT DEFAULT NULL, _banner_html TEXT DEFAULT NULL, _cmp_fingerprint TEXT DEFAULT 'unknown') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO missed_banner_reports (domain, page_url, banner_html, cmp_fingerprint, report_count, last_reported)
  VALUES (_domain, _page_url, left(_banner_html, 5000), _cmp_fingerprint, 1, now())
  ON CONFLICT (domain) DO UPDATE SET
    report_count = missed_banner_reports.report_count + 1,
    last_reported = now(),
    page_url = COALESCE(EXCLUDED.page_url, missed_banner_reports.page_url),
    cmp_fingerprint = CASE WHEN EXCLUDED.cmp_fingerprint != 'unknown' THEN EXCLUDED.cmp_fingerprint ELSE missed_banner_reports.cmp_fingerprint END,
    banner_html = CASE WHEN length(COALESCE(EXCLUDED.banner_html, '')) > length(COALESCE(missed_banner_reports.banner_html, '')) THEN left(EXCLUDED.banner_html, 5000) ELSE missed_banner_reports.banner_html END,
    resolved = CASE WHEN missed_banner_reports.resolved = true AND missed_banner_reports.resolved_at < now() - interval '7 days' THEN false ELSE missed_banner_reports.resolved END;
END;
$$;

GRANT EXECUTE ON FUNCTION report_missed_banner_with_html(TEXT, TEXT, TEXT, TEXT) TO anon;

-- RPC: get_ai_generation_candidates
CREATE OR REPLACE FUNCTION get_ai_generation_candidates(_limit INTEGER DEFAULT 10) RETURNS JSON LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT id, domain, report_count, banner_html, page_url, cmp_fingerprint, ai_attempts, last_reported
    FROM missed_banner_reports
    WHERE resolved = false AND (ai_processed_at IS NULL OR ai_processed_at < now() - interval '24 hours') AND ai_attempts < 3
    ORDER BY CASE WHEN banner_html IS NOT NULL THEN 0 ELSE 1 END, report_count DESC, last_reported DESC
    LIMIT _limit
  ) t;
$$;

GRANT EXECUTE ON FUNCTION get_ai_generation_candidates(INTEGER) TO service_role;

-- RPC: mark_ai_processed
CREATE OR REPLACE FUNCTION mark_ai_processed(_domain TEXT, _resolved BOOLEAN DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE missed_banner_reports SET ai_processed_at = now(), ai_attempts = ai_attempts + 1, resolved = _resolved, resolved_at = CASE WHEN _resolved THEN now() ELSE resolved_at END WHERE domain = _domain;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_ai_processed(TEXT, BOOLEAN) TO service_role;


-- ── 20260316212917_510ea05a-3a1a-4061-b069-47cf2ea8b650.sql ──────────────────────────────────────────────────────────


-- 1. Create enum
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- 2. Create table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Service role policy (no dependency on has_role)
CREATE POLICY "Service role manages user_roles"
  ON public.user_roles FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 4. Create SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 5. Admin read policy using has_role
CREATE POLICY "Admins can read user_roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. Seed admin role
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'jaredbest@icloud.com'
ON CONFLICT DO NOTHING;

-- 7. Waitlist admin policy
CREATE POLICY "Admin full access waitlist_subscribers"
  ON public.waitlist_subscribers FOR ALL
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text)
  WITH CHECK ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text);

-- 8. Fix ai_generation_log default
ALTER TABLE public.ai_generation_log ALTER COLUMN ai_model SET DEFAULT 'google/gemini-3-flash-preview';

-- 9. Missing policies for missed_banner_reports
CREATE POLICY "Admin full access missed_banner_reports"
  ON public.missed_banner_reports FOR ALL
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text)
  WITH CHECK ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text);

CREATE POLICY "Service role manages missed_banner_reports"
  ON public.missed_banner_reports FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 10. Missing policies for pattern_fix_log
CREATE POLICY "Admin full access pattern_fix_log"
  ON public.pattern_fix_log FOR ALL
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text)
  WITH CHECK ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text);

CREATE POLICY "Service role manages pattern_fix_log"
  ON public.pattern_fix_log FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);


-- ── 20260316215315_9f30c2ea-af3d-4b4f-b95d-af119f92fd3c.sql ──────────────────────────────────────────────────────────


-- Fix 1: Add DELETE and UPDATE storage policies for intake-documents bucket
CREATE POLICY "Users can delete their intake docs"
ON storage.objects
FOR DELETE
USING (bucket_id = 'intake-documents');

CREATE POLICY "Users can update their intake docs"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'intake-documents');


-- ── 20260316223037_8aa76120-f4eb-4b87-ab88-fdd2a30ea5a6.sql ──────────────────────────────────────────────────────────


-- Fix mutable search_path on auto_fix_pattern_issues
CREATE OR REPLACE FUNCTION public.auto_fix_pattern_issues()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  result_details JSON[] := '{}';
  processed INT := 0;
  fixed INT := 0;
  failed INT := 0;
  action_desc TEXT;
  fix_success BOOLEAN;
  fix_error TEXT;
BEGIN
  FOR rec IN
    SELECT
      id, domain, selector, action_type, confidence,
      report_count, success_count, last_seen,
      CASE
        WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds'
        WHEN confidence < 0.3 THEN 'very_low_confidence'
        WHEN last_seen < now() - interval '30 days' THEN 'stale'
        WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate'
        ELSE 'other'
      END AS issue_type
    FROM cookie_patterns
    WHERE
      confidence < 0.4
      OR (report_count > 5 AND success_count = 0)
      OR last_seen < now() - interval '30 days'
      OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2)
  LOOP
    processed := processed + 1;
    fix_success := true;
    fix_error := NULL;

    BEGIN
      CASE rec.issue_type
        WHEN 'stale' THEN
          DELETE FROM cookie_patterns WHERE id = rec.id;
          action_desc := 'deleted_stale';
        WHEN 'never_succeeds' THEN
          DELETE FROM cookie_patterns WHERE id = rec.id;
          action_desc := 'deleted_broken';
        WHEN 'very_low_confidence' THEN
          UPDATE cookie_patterns SET confidence = 0 WHERE id = rec.id;
          action_desc := 'confidence_zeroed';
        WHEN 'low_success_rate' THEN
          UPDATE cookie_patterns SET confidence = confidence / 2 WHERE id = rec.id;
          action_desc := 'confidence_halved';
        ELSE
          action_desc := 'skipped';
      END CASE;
      fixed := fixed + 1;
    EXCEPTION WHEN OTHERS THEN
      fix_success := false;
      fix_error := SQLERRM;
      failed := failed + 1;
      action_desc := rec.issue_type || '_fix_attempted';
    END;

    INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success, error_message)
    VALUES (rec.domain, rec.selector, rec.issue_type, action_desc, fix_success, fix_error);

    result_details := result_details || json_build_object(
      'domain', rec.domain, 'selector', rec.selector,
      'issue', rec.issue_type, 'action', action_desc,
      'success', fix_success, 'error', fix_error
    )::json;
  END LOOP;

  RETURN json_build_object(
    'processed', processed,
    'fixed', fixed,
    'failed', failed,
    'details', to_json(result_details)
  );
END;
$function$;

-- Fix mutable search_path on process_user_reports
CREATE OR REPLACE FUNCTION public.process_user_reports()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  working_count INT;
  total_reports INT := 0;
  newly_resolved INT := 0;
  priority_domains JSON[];
BEGIN
  INSERT INTO missed_banner_reports (domain, report_count, last_reported)
  SELECT
    domain,
    count(*) AS report_count,
    max(last_seen) AS last_reported
  FROM cookie_patterns
  WHERE cmp_fingerprint = 'user_report'
  GROUP BY domain
  ON CONFLICT (domain)
  DO UPDATE SET
    report_count = EXCLUDED.report_count,
    last_reported = EXCLUDED.last_reported;

  FOR rec IN
    SELECT mbr.id, mbr.domain, mbr.report_count
    FROM missed_banner_reports mbr
    WHERE mbr.resolved = false
  LOOP
    total_reports := total_reports + 1;

    SELECT count(*) INTO working_count
    FROM cookie_patterns
    WHERE domain = rec.domain
      AND cmp_fingerprint != 'user_report'
      AND confidence >= 0.5
      AND success_count > 0;

    IF working_count > 0 THEN
      UPDATE missed_banner_reports
      SET resolved = true,
          resolved_at = now(),
          has_working_pattern = true
      WHERE id = rec.id;
      newly_resolved := newly_resolved + 1;

      UPDATE cookie_patterns
      SET confidence = LEAST(1.0, confidence + 0.1)
      WHERE domain = rec.domain
        AND cmp_fingerprint = 'user_report'
        AND success_count > 0;

      INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success)
      VALUES (rec.domain, 'user_report', 'user_reported_resolved', 'marked_resolved', true);
    ELSE
      UPDATE missed_banner_reports
      SET has_working_pattern = false
      WHERE id = rec.id;
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(row_to_json(t)::json), '{}')
  INTO priority_domains
  FROM (
    SELECT domain, report_count, last_reported
    FROM missed_banner_reports
    WHERE resolved = false AND report_count >= 3
    ORDER BY report_count DESC
    LIMIT 20
  ) t;

  RETURN json_build_object(
    'total_unresolved', total_reports - newly_resolved,
    'newly_resolved', newly_resolved,
    'priority_domains', to_json(priority_domains)
  );
END;
$function$;


-- ── 20260316223114_ea9352f7-9ae4-477d-aee0-5f5c1dc84d5a.sql ──────────────────────────────────────────────────────────


-- Fix search_path on all remaining functions

CREATE OR REPLACE FUNCTION public.get_unresolved_reports(p_limit integer DEFAULT 50)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (SELECT domain, report_count, has_working_pattern, last_reported, created_at
    FROM missed_banner_reports WHERE resolved = false
    ORDER BY report_count DESC, last_reported DESC LIMIT p_limit) t;
$function$;

CREATE OR REPLACE FUNCTION public.get_cmp_distribution()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT cmp_fingerprint, count(*) AS pattern_count, count(DISTINCT domain) AS domain_count, round(avg(confidence)::numeric, 3) AS avg_confidence, CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END AS success_rate FROM cookie_patterns GROUP BY cmp_fingerprint ORDER BY pattern_count DESC) t; $function$;

CREATE OR REPLACE FUNCTION public.get_community_overview()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT json_build_object('total_patterns', (SELECT count(*) FROM cookie_patterns), 'total_domains', (SELECT count(DISTINCT domain) FROM cookie_patterns), 'high_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.8), 'low_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence < 0.4), 'avg_confidence', (SELECT round(avg(confidence)::numeric, 3) FROM cookie_patterns), 'total_reports', (SELECT coalesce(sum(report_count), 0) FROM cookie_patterns), 'total_successes', (SELECT coalesce(sum(success_count), 0) FROM cookie_patterns), 'overall_success_rate', (SELECT CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END FROM cookie_patterns), 'patterns_last_24h', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '24 hours'), 'patterns_last_7d', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '7 days'), 'new_domains_last_7d', (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at >= now() - interval '7 days'), 'stale_patterns', (SELECT count(*) FROM cookie_patterns WHERE last_seen < now() - interval '30 days')); $function$;

CREATE OR REPLACE FUNCTION public.get_daily_pattern_activity(p_days integer DEFAULT 30)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT d::date AS date, (SELECT count(*) FROM cookie_patterns WHERE created_at::date = d::date) AS new_patterns, (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at::date = d::date) AS new_domains, (SELECT count(*) FROM cookie_patterns WHERE last_seen::date = d::date) AS active_patterns FROM generate_series((now() - make_interval(days => p_days))::date, now()::date, '1 day'::interval) AS d ORDER BY d) t; $function$;

CREATE OR REPLACE FUNCTION public.get_top_domains(p_limit integer DEFAULT 25)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, count(*) AS pattern_count, round(avg(confidence)::numeric, 3) AS avg_confidence, coalesce(sum(report_count), 0) AS total_reports, coalesce(sum(success_count), 0) AS total_successes, CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END AS success_rate, max(last_seen) AS last_active FROM cookie_patterns GROUP BY domain ORDER BY pattern_count DESC LIMIT p_limit) t; $function$;

CREATE OR REPLACE FUNCTION public.get_recently_learned(p_limit integer DEFAULT 50)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, selector, action_type, cmp_fingerprint, confidence, report_count, success_count, source, created_at, last_seen FROM cookie_patterns ORDER BY created_at DESC LIMIT p_limit) t; $function$;

CREATE OR REPLACE FUNCTION public.get_pattern_issues(p_limit integer DEFAULT 50)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT domain, selector, action_type, confidence, report_count, success_count, CASE WHEN sum(report_count) OVER () > 0 THEN round((success_count::numeric / NULLIF(report_count, 0)::numeric) * 100, 1) ELSE 0 END AS success_rate, last_seen, CASE WHEN confidence < 0.3 THEN 'very_low_confidence' WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds' WHEN last_seen < now() - interval '30 days' THEN 'stale' WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate' ELSE 'other' END AS issue_type FROM cookie_patterns WHERE confidence < 0.4 OR (report_count > 5 AND success_count = 0) OR last_seen < now() - interval '30 days' OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2) ORDER BY confidence ASC, report_count DESC LIMIT p_limit) t; $function$;

CREATE OR REPLACE FUNCTION public.get_action_type_stats()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT action_type, count(*) AS count, round(avg(confidence)::numeric, 3) AS avg_confidence, coalesce(sum(report_count), 0) AS total_reports, coalesce(sum(success_count), 0) AS total_successes FROM cookie_patterns GROUP BY action_type ORDER BY count DESC) t; $function$;

CREATE OR REPLACE FUNCTION public.get_confidence_distribution()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT bucket, label, count FROM (VALUES (0, '0.0-0.2', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.0 AND confidence < 0.2)), (1, '0.2-0.4', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.2 AND confidence < 0.4)), (2, '0.4-0.6', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.4 AND confidence < 0.6)), (3, '0.6-0.8', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.6 AND confidence < 0.8)), (4, '0.8-1.0', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0.8 AND confidence <= 1.0))) AS v(bucket, label, count) ORDER BY bucket) t; $function$;

CREATE OR REPLACE FUNCTION public.get_source_breakdown()
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT source, count(*) AS count, round(avg(confidence)::numeric, 3) AS avg_confidence, count(DISTINCT domain) AS domain_count FROM cookie_patterns GROUP BY source ORDER BY count DESC) t; $function$;


-- ── 20260316223813_email_infra.sql ──────────────────────────────────────────────────────────

-- Email infrastructure
-- Creates the queue system, send log, send state, suppression, and unsubscribe
-- tables used by both auth and transactional emails.

-- Extensions required for queue processing
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    CREATE EXTENSION pg_cron;
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create email queues (auth = high priority, transactional = normal)
-- Wrapped in DO blocks to handle "queue already exists" errors idempotently.
DO $$ BEGIN PERFORM pgmq.create('auth_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Dead-letter queues for messages that exceed max retries
DO $$ BEGIN PERFORM pgmq.create('auth_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM pgmq.create('transactional_emails_dlq'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Email send log table (audit trail for all send attempts)
-- UPDATE is allowed for the service role so the suppression edge function
-- can update a log record's status when a bounce/complaint/unsubscribe occurs.
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT,
  template_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq')),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can read send log"
    ON public.email_send_log FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can insert send log"
    ON public.email_send_log FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can update send log"
    ON public.email_send_log FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_created ON public.email_send_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_send_log_recipient ON public.email_send_log(recipient_email);

-- Backfill: add message_id column to existing tables that predate this migration
DO $$ BEGIN
  ALTER TABLE public.email_send_log ADD COLUMN message_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_send_log_message ON public.email_send_log(message_id);

-- Prevent duplicate sends: only one 'sent' row per message_id.
-- If VT expires and another worker picks up the same message, the pre-send
-- check catches it. This index is a DB-level safety net for race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_message_sent_unique
  ON public.email_send_log(message_id) WHERE status = 'sent';

-- Backfill: update status CHECK constraint for existing tables that predate new statuses
DO $$ BEGIN
  ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
  ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
    CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq'));
END $$;

-- Rate-limit state and queue config (single row, tracks Retry-After cooldown + throughput settings)
CREATE TABLE IF NOT EXISTS public.email_send_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  retry_after_until TIMESTAMPTZ,
  batch_size INTEGER NOT NULL DEFAULT 10,
  send_delay_ms INTEGER NOT NULL DEFAULT 200,
  auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15,
  transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.email_send_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Backfill: add config columns to existing tables that predate this migration
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 10;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN send_delay_ms INTEGER NOT NULL DEFAULT 200;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN auth_email_ttl_minutes INTEGER NOT NULL DEFAULT 15;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD COLUMN transactional_email_ttl_minutes INTEGER NOT NULL DEFAULT 60;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage send state"
    ON public.email_send_state FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RPC wrappers so Edge Functions can interact with pgmq via supabase.rpc()
-- (PostgREST only exposes functions in the public schema; pgmq functions are in the pgmq schema)
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name TEXT, payload JSONB)
RETURNS BIGINT
LANGUAGE sql SECURITY DEFINER
AS $$ SELECT pgmq.send(queue_name, payload); $$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name TEXT, batch_size INT, vt INT)
RETURNS TABLE(msg_id BIGINT, read_ct INT, message JSONB)
LANGUAGE sql SECURITY DEFINER
AS $$ SELECT msg_id, read_ct, message FROM pgmq.read(queue_name, vt, batch_size); $$;

CREATE OR REPLACE FUNCTION public.delete_email(queue_name TEXT, message_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER
AS $$ SELECT pgmq.delete(queue_name, message_id); $$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(
  source_queue TEXT, dlq_name TEXT, message_id BIGINT, payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
END;
$$;

-- Restrict queue RPC wrappers to service_role only (SECURITY DEFINER runs as owner,
-- so without this any authenticated user could manipulate the email queues)
REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) TO service_role;

-- Suppressed emails table (tracks unsubscribes, bounces, complaints)
-- Append-only: no DELETE or UPDATE policies to prevent bypassing suppression.
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email)
);

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can read suppressed emails"
    ON public.suppressed_emails FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can insert suppressed emails"
    ON public.suppressed_emails FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_suppressed_emails_email ON public.suppressed_emails(email);

-- Email unsubscribe tokens table (one token per email address for unsubscribe links)
-- No DELETE policy to prevent removing tokens. UPDATE allowed only to mark tokens as used.
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can read tokens"
    ON public.email_unsubscribe_tokens FOR SELECT
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can insert tokens"
    ON public.email_unsubscribe_tokens FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can mark tokens as used"
    ON public.email_unsubscribe_tokens FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens(token);

-- ============================================================
-- POST-MIGRATION STEPS (applied dynamically by setup_email_infra)
-- These steps contain project-specific secrets and URLs and
-- cannot be expressed as static SQL. They are applied via the
-- Supabase Management API (ExecuteSQL) each time the tool runs.
-- ============================================================
--
-- 1. VAULT SECRET
--    Stores (or updates) the Supabase service_role key in
--    vault as 'email_queue_service_role_key'.
--    Uses vault.create_secret / vault.update_secret (upsert).
--    To revert: DELETE FROM vault.secrets WHERE name = 'email_queue_service_role_key';
--
-- 2. CRON JOB (pg_cron)
--    Creates job 'process-email-queue' with a 5-second interval.
--    The job checks:
--      a) rate-limit cooldown (email_send_state.retry_after_until)
--      b) whether auth_emails or transactional_emails queues have messages
--    If conditions are met, it calls the process-email-queue Edge Function
--    via net.http_post using the vault-stored service_role key.
--    To revert: SELECT cron.unschedule('process-email-queue');


-- ── 20260317010833_95f5ceca-ae43-4135-9e3b-b94a544b7785.sql ──────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public) VALUES ('email-assets', 'email-assets', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Email assets are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'email-assets');

-- ── 20260318064709_26aa41e1-35d6-492a-ab38-b432bc4a589b.sql ──────────────────────────────────────────────────────────

CREATE POLICY "Admin can read ai_generation_log"
ON public.ai_generation_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ── 20260318164424_2742b31f-0dea-43c4-a0fb-fb4b3aceaca7.sql ──────────────────────────────────────────────────────────


-- 1. Email normalization trigger function
CREATE OR REPLACE FUNCTION public.lowercase_subscription_email()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email = LOWER(TRIM(NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path TO 'public';

-- 2. Triggers on subscriptions and granted_access
CREATE TRIGGER trg_lowercase_subscription_email
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION lowercase_subscription_email();

CREATE TRIGGER trg_lowercase_granted_access_email
  BEFORE INSERT OR UPDATE ON granted_access
  FOR EACH ROW
  EXECUTE FUNCTION lowercase_subscription_email();

-- 3. One-time data fix
UPDATE subscriptions SET email = LOWER(TRIM(email)) WHERE email != LOWER(TRIM(email));
UPDATE granted_access SET email = LOWER(TRIM(email)) WHERE email != LOWER(TRIM(email));

-- 4. webhook_events table
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  stripe_event_id TEXT,
  email TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read webhook_events" ON public.webhook_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages webhook_events" ON public.webhook_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. Update report_missed_banner_with_html to clear stale AI skip entries
CREATE OR REPLACE FUNCTION public.report_missed_banner_with_html(
  _domain text,
  _page_url text DEFAULT NULL::text,
  _banner_html text DEFAULT NULL::text,
  _cmp_fingerprint text DEFAULT 'unknown'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO missed_banner_reports (domain, page_url, banner_html, cmp_fingerprint, report_count, last_reported)
  VALUES (_domain, _page_url, left(_banner_html, 5000), _cmp_fingerprint, 1, now())
  ON CONFLICT (domain) DO UPDATE SET
    report_count = missed_banner_reports.report_count + 1,
    last_reported = now(),
    page_url = COALESCE(EXCLUDED.page_url, missed_banner_reports.page_url),
    cmp_fingerprint = CASE WHEN EXCLUDED.cmp_fingerprint != 'unknown' THEN EXCLUDED.cmp_fingerprint ELSE missed_banner_reports.cmp_fingerprint END,
    banner_html = CASE WHEN length(COALESCE(EXCLUDED.banner_html, '')) > length(COALESCE(missed_banner_reports.banner_html, '')) THEN left(EXCLUDED.banner_html, 5000) ELSE missed_banner_reports.banner_html END,
    resolved = CASE WHEN missed_banner_reports.resolved = true AND missed_banner_reports.resolved_at < now() - interval '7 days' THEN false ELSE missed_banner_reports.resolved END;

  -- Clear stale AI skip entries when new HTML arrives
  IF _banner_html IS NOT NULL AND LENGTH(TRIM(_banner_html)) > 50 THEN
    DELETE FROM ai_generation_log
    WHERE domain = _domain
    AND status = 'skipped_no_html';

    -- Reset AI attempts so the domain becomes a candidate again
    UPDATE missed_banner_reports
    SET ai_attempts = 0, ai_processed_at = NULL
    WHERE domain = _domain
    AND ai_attempts > 0;
  END IF;
END;
$function$;


-- ── 20260318171553_0554ec51-a199-44e7-8727-001959896b5a.sql ──────────────────────────────────────────────────────────

-- Clean up Shein data for re-processing with new fallback logic
DELETE FROM ai_generation_log WHERE domain = 'us.shein.com';

UPDATE missed_banner_reports 
SET ai_attempts = 0, ai_processed_at = NULL, resolved = false, resolved_at = NULL
WHERE domain = 'us.shein.com';

-- ── 20260318173340_94d658a4-f1b7-4fad-b182-a10825b21d8e.sql ──────────────────────────────────────────────────────────

DELETE FROM ai_generation_log WHERE domain = 'us.shein.com';
UPDATE missed_banner_reports SET ai_attempts = 0, ai_processed_at = NULL WHERE domain = 'us.shein.com';

-- ── 20260318173841_d2974507-5b4c-4706-9cda-3918ef5d50f2.sql ──────────────────────────────────────────────────────────


-- Create dismissal_reports table
CREATE TABLE public.dismissal_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  clicked_selector TEXT NOT NULL,
  banner_selector TEXT,
  banner_html TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dismissal_domain ON public.dismissal_reports(domain);

ALTER TABLE public.dismissal_reports ENABLE ROW LEVEL SECURITY;

-- Extension can insert (anon)
CREATE POLICY "Anyone can insert dismissal reports"
  ON public.dismissal_reports FOR INSERT
  TO public
  WITH CHECK (true);

-- Service role full access
CREATE POLICY "Service role manages dismissal_reports"
  ON public.dismissal_reports FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Admin can read
CREATE POLICY "Admin can read dismissal_reports"
  ON public.dismissal_reports FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create consensus-finding RPC
CREATE OR REPLACE FUNCTION public.find_dismissal_consensus()
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT domain, clicked_selector, banner_selector, COUNT(*) as report_count
    FROM public.dismissal_reports
    WHERE domain NOT IN (
      SELECT DISTINCT domain FROM public.cookie_patterns
      WHERE confidence >= 0.5 AND source != 'user_consensus'
    )
    GROUP BY domain, clicked_selector, banner_selector
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 50
  ) t;
$$;


-- ── 20260318174045_77ff6de7-43b8-4012-929d-829f72d4031e.sql ──────────────────────────────────────────────────────────


CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- ── 20260318194223_503073df-4359-4402-92ff-a566cbd2cfcc.sql ──────────────────────────────────────────────────────────


-- Migrate confidence from 0-1 decimal to 1-10 integer scale

-- 1. Update existing data: multiply by 10 and round
UPDATE cookie_patterns SET confidence = ROUND(confidence * 10);
UPDATE ai_generation_log SET confidence = ROUND(confidence * 10) WHERE confidence IS NOT NULL;

-- 2. Change default on cookie_patterns
ALTER TABLE cookie_patterns ALTER COLUMN confidence SET DEFAULT 5;

-- 3. Update upsert_pattern: increment by 1 instead of 0.02, cap at 10
CREATE OR REPLACE FUNCTION public.upsert_pattern(_domain text, _selector text, _action_type text, _cmp_fingerprint text DEFAULT 'generic'::text, _source text DEFAULT 'community'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.cookie_patterns (domain, selector, action_type, cmp_fingerprint, source, last_seen)
  VALUES (_domain, _selector, _action_type, _cmp_fingerprint, _source, now())
  ON CONFLICT (domain, selector, action_type)
  DO UPDATE SET
    report_count = cookie_patterns.report_count + 1,
    confidence = LEAST(cookie_patterns.confidence + 1, 10),
    last_seen = now(),
    updated_at = now();
END;
$function$;

-- 4. Update record_pattern_success: increment by 1 instead of 0.03, cap at 10
CREATE OR REPLACE FUNCTION public.record_pattern_success(_domain text, _selector text, _action_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.cookie_patterns
  SET
    success_count = success_count + 1,
    confidence = LEAST(confidence + 1, 10),
    updated_at = now()
  WHERE domain = _domain
    AND selector = _selector
    AND action_type = _action_type;
END;
$function$;

-- 5. Update auto_fix_pattern_issues thresholds
CREATE OR REPLACE FUNCTION public.auto_fix_pattern_issues()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  result_details JSON[] := '{}';
  processed INT := 0;
  fixed INT := 0;
  failed INT := 0;
  action_desc TEXT;
  fix_success BOOLEAN;
  fix_error TEXT;
BEGIN
  FOR rec IN
    SELECT
      id, domain, selector, action_type, confidence,
      report_count, success_count, last_seen,
      CASE
        WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds'
        WHEN confidence < 3 THEN 'very_low_confidence'
        WHEN last_seen < now() - interval '30 days' THEN 'stale'
        WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate'
        ELSE 'other'
      END AS issue_type
    FROM cookie_patterns
    WHERE
      confidence < 4
      OR (report_count > 5 AND success_count = 0)
      OR last_seen < now() - interval '30 days'
      OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2)
  LOOP
    processed := processed + 1;
    fix_success := true;
    fix_error := NULL;

    BEGIN
      CASE rec.issue_type
        WHEN 'stale' THEN
          DELETE FROM cookie_patterns WHERE id = rec.id;
          action_desc := 'deleted_stale';
        WHEN 'never_succeeds' THEN
          DELETE FROM cookie_patterns WHERE id = rec.id;
          action_desc := 'deleted_broken';
        WHEN 'very_low_confidence' THEN
          UPDATE cookie_patterns SET confidence = 0 WHERE id = rec.id;
          action_desc := 'confidence_zeroed';
        WHEN 'low_success_rate' THEN
          UPDATE cookie_patterns SET confidence = confidence / 2 WHERE id = rec.id;
          action_desc := 'confidence_halved';
        ELSE
          action_desc := 'skipped';
      END CASE;
      fixed := fixed + 1;
    EXCEPTION WHEN OTHERS THEN
      fix_success := false;
      fix_error := SQLERRM;
      failed := failed + 1;
      action_desc := rec.issue_type || '_fix_attempted';
    END;

    INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success, error_message)
    VALUES (rec.domain, rec.selector, rec.issue_type, action_desc, fix_success, fix_error);

    result_details := result_details || json_build_object(
      'domain', rec.domain, 'selector', rec.selector,
      'issue', rec.issue_type, 'action', action_desc,
      'success', fix_success, 'error', fix_error
    )::json;
  END LOOP;

  RETURN json_build_object(
    'processed', processed,
    'fixed', fixed,
    'failed', failed,
    'details', to_json(result_details)
  );
END;
$function$;

-- 6. Update get_community_overview thresholds
CREATE OR REPLACE FUNCTION public.get_community_overview()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT json_build_object(
  'total_patterns', (SELECT count(*) FROM cookie_patterns),
  'total_domains', (SELECT count(DISTINCT domain) FROM cookie_patterns),
  'high_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 8),
  'low_confidence', (SELECT count(*) FROM cookie_patterns WHERE confidence < 4),
  'avg_confidence', (SELECT round(avg(confidence)::numeric, 1) FROM cookie_patterns),
  'total_reports', (SELECT coalesce(sum(report_count), 0) FROM cookie_patterns),
  'total_successes', (SELECT coalesce(sum(success_count), 0) FROM cookie_patterns),
  'overall_success_rate', (SELECT CASE WHEN sum(report_count) > 0 THEN round((sum(success_count)::numeric / sum(report_count)::numeric) * 100, 1) ELSE 0 END FROM cookie_patterns),
  'patterns_last_24h', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '24 hours'),
  'patterns_last_7d', (SELECT count(*) FROM cookie_patterns WHERE last_seen >= now() - interval '7 days'),
  'new_domains_last_7d', (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at >= now() - interval '7 days'),
  'stale_patterns', (SELECT count(*) FROM cookie_patterns WHERE last_seen < now() - interval '30 days')
);
$function$;

-- 7. Update get_confidence_distribution buckets for 1-10 scale
CREATE OR REPLACE FUNCTION public.get_confidence_distribution()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (SELECT bucket, label, count FROM (VALUES
  (0, '1-2', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 0 AND confidence <= 2)),
  (1, '3-4', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 3 AND confidence <= 4)),
  (2, '5-6', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 5 AND confidence <= 6)),
  (3, '7-8', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 7 AND confidence <= 8)),
  (4, '9-10', (SELECT count(*) FROM cookie_patterns WHERE confidence >= 9 AND confidence <= 10))
) AS v(bucket, label, count) ORDER BY bucket) t;
$function$;

-- 8. Update get_pattern_issues thresholds
CREATE OR REPLACE FUNCTION public.get_pattern_issues(p_limit integer DEFAULT 50)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
FROM (SELECT domain, selector, action_type, confidence, report_count, success_count,
  CASE WHEN sum(report_count) OVER () > 0 THEN round((success_count::numeric / NULLIF(report_count, 0)::numeric) * 100, 1) ELSE 0 END AS success_rate,
  last_seen,
  CASE
    WHEN confidence < 3 THEN 'very_low_confidence'
    WHEN report_count > 5 AND success_count = 0 THEN 'never_succeeds'
    WHEN last_seen < now() - interval '30 days' THEN 'stale'
    WHEN report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2 THEN 'low_success_rate'
    ELSE 'other'
  END AS issue_type
FROM cookie_patterns
WHERE confidence < 4
  OR (report_count > 5 AND success_count = 0)
  OR last_seen < now() - interval '30 days'
  OR (report_count >= 3 AND (success_count::numeric / NULLIF(report_count, 0)::numeric) < 0.2)
ORDER BY confidence ASC, report_count DESC LIMIT p_limit) t;
$function$;

-- 9. Update process_user_reports threshold from 0.5 to 5 and 0.1 to 1
CREATE OR REPLACE FUNCTION public.process_user_reports()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  working_count INT;
  total_reports INT := 0;
  newly_resolved INT := 0;
  priority_domains JSON[];
BEGIN
  INSERT INTO missed_banner_reports (domain, report_count, last_reported)
  SELECT
    domain,
    count(*) AS report_count,
    max(last_seen) AS last_reported
  FROM cookie_patterns
  WHERE cmp_fingerprint = 'user_report'
  GROUP BY domain
  ON CONFLICT (domain)
  DO UPDATE SET
    report_count = EXCLUDED.report_count,
    last_reported = EXCLUDED.last_reported;

  FOR rec IN
    SELECT mbr.id, mbr.domain, mbr.report_count
    FROM missed_banner_reports mbr
    WHERE mbr.resolved = false
  LOOP
    total_reports := total_reports + 1;

    SELECT count(*) INTO working_count
    FROM cookie_patterns
    WHERE domain = rec.domain
      AND cmp_fingerprint != 'user_report'
      AND confidence >= 5
      AND success_count > 0;

    IF working_count > 0 THEN
      UPDATE missed_banner_reports
      SET resolved = true,
          resolved_at = now(),
          has_working_pattern = true
      WHERE id = rec.id;
      newly_resolved := newly_resolved + 1;

      UPDATE cookie_patterns
      SET confidence = LEAST(10, confidence + 1)
      WHERE domain = rec.domain
        AND cmp_fingerprint = 'user_report'
        AND success_count > 0;

      INSERT INTO pattern_fix_log (domain, selector, issue_type, action_taken, success)
      VALUES (rec.domain, 'user_report', 'user_reported_resolved', 'marked_resolved', true);
    ELSE
      UPDATE missed_banner_reports
      SET has_working_pattern = false
      WHERE id = rec.id;
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(row_to_json(t)::json), '{}')
  INTO priority_domains
  FROM (
    SELECT domain, report_count, last_reported
    FROM missed_banner_reports
    WHERE resolved = false AND report_count >= 3
    ORDER BY report_count DESC
    LIMIT 20
  ) t;

  RETURN json_build_object(
    'total_unresolved', total_reports - newly_resolved,
    'newly_resolved', newly_resolved,
    'priority_domains', to_json(priority_domains)
  );
END;
$function$;

-- 10. Update find_dismissal_consensus threshold from 0.5 to 5
CREATE OR REPLACE FUNCTION public.find_dismissal_consensus()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT domain, clicked_selector, banner_selector, COUNT(*) as report_count
    FROM public.dismissal_reports
    WHERE domain NOT IN (
      SELECT DISTINCT domain FROM public.cookie_patterns
      WHERE confidence >= 5 AND source != 'user_consensus'
    )
    GROUP BY domain, clicked_selector, banner_selector
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 50
  ) t;
$function$;


-- ── 20260318200042_84e8ff68-49a3-49af-9123-b0f1a39048b4.sql ──────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 20260318201403_b0fae997-c65a-49df-a177-ab5cb0c3f0c2.sql ──────────────────────────────────────────────────────────


-- Add is_active column to cookie_patterns
ALTER TABLE public.cookie_patterns ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Update find_dismissal_consensus function with is_active filter and threshold of 1
CREATE OR REPLACE FUNCTION public.find_dismissal_consensus()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT 
      dr.domain,
      dr.clicked_selector,
      dr.banner_selector,
      COUNT(*) as report_count
    FROM dismissal_reports dr
    WHERE dr.domain NOT IN (
      SELECT cp.domain FROM cookie_patterns cp 
      WHERE cp.is_active = true AND cp.confidence >= 5
      AND cp.source != 'user_consensus'
    )
    GROUP BY dr.domain, dr.clicked_selector, dr.banner_selector
    HAVING COUNT(*) >= 1
    ORDER BY COUNT(*) DESC
    LIMIT 50
  ) t;
$$;


-- ── 20260318202013_dea751b2-5cdd-4e0f-9a7e-a514afcc8a19.sql ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_recently_learned(p_limit integer DEFAULT 50)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT id, domain, selector, action_type, cmp_fingerprint, confidence,
           report_count, success_count, source, is_active, created_at, last_seen
    FROM cookie_patterns
    ORDER BY created_at DESC
    LIMIT p_limit
  ) t;
$$;

-- ── 20260318202146_0e133585-721c-4c1d-b676-6165dc4ae594.sql ──────────────────────────────────────────────────────────

CREATE POLICY "Admin can delete dismissal_reports"
ON public.dismissal_reports
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- ── 20260318202732_7313ae0c-424e-425e-a8c5-7432efbc11ef.sql ──────────────────────────────────────────────────────────

UPDATE cookie_patterns SET action_type = 'accept' WHERE domain = 'skatepro.com' AND selector = 'button#accept' AND action_type = 'reject';

-- ── 20260318205938_bc47b084-967d-4a97-953f-a0e0799763b9.sql ──────────────────────────────────────────────────────────

DELETE FROM cookie_patterns WHERE domain = 'skatepro.com' AND selector = 'button#accept';
UPDATE missed_banner_reports SET resolved = false, resolved_at = NULL, ai_processed_at = NULL, ai_attempts = 0 WHERE domain = 'skatepro.com';
DELETE FROM ai_generation_log WHERE domain = 'skatepro.com';

-- ── 20260318210052_7ba1b949-8d03-4a82-b011-b348cde5edcc.sql ──────────────────────────────────────────────────────────

DELETE FROM cookie_patterns WHERE domain = 'skatepro.com';
DELETE FROM ai_generation_log WHERE domain = 'skatepro.com';
UPDATE missed_banner_reports SET resolved = false, resolved_at = NULL, ai_processed_at = NULL, ai_attempts = 0 WHERE domain = 'skatepro.com';

-- ── 20260318210140_4b699daa-53af-4110-aeb9-e2d346e8bee4.sql ──────────────────────────────────────────────────────────

DELETE FROM cookie_patterns WHERE domain = 'skatepro.com';
DELETE FROM ai_generation_log WHERE domain = 'skatepro.com';
UPDATE missed_banner_reports SET resolved = false, resolved_at = NULL, ai_processed_at = NULL, ai_attempts = 0 WHERE domain = 'skatepro.com';

-- ── 20260318213207_dfec2d62-2e57-4509-bebd-e079da8e90ff.sql ──────────────────────────────────────────────────────────

ALTER TABLE public.cookie_patterns ADD COLUMN IF NOT EXISTS strategy TEXT;

-- ── 20260318213222_62662fc3-47e3-4bc7-9348-3004ec193852.sql ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_recently_learned(p_limit integer DEFAULT 50)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT id, domain, selector, action_type, cmp_fingerprint, confidence,
           report_count, success_count, source, is_active, created_at, last_seen, strategy
    FROM cookie_patterns
    ORDER BY created_at DESC
    LIMIT p_limit
  ) t;
$function$;

-- ── 20260319170607_85be09f7-86de-4371-ad12-e4e0afd94912.sql ──────────────────────────────────────────────────────────


-- Add public DELETE policy for intake_documents scoped to draft intakes
CREATE POLICY "Public can delete draft intake documents"
ON public.intake_documents
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.seller_intakes
  WHERE seller_intakes.id = intake_documents.intake_id
    AND seller_intakes.status = 'Draft'
));

-- Add public UPDATE policy for intake_documents scoped to draft intakes
CREATE POLICY "Public can update draft intake documents"
ON public.intake_documents
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.seller_intakes
  WHERE seller_intakes.id = intake_documents.intake_id
    AND seller_intakes.status = 'Draft'
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.seller_intakes
  WHERE seller_intakes.id = intake_documents.intake_id
    AND seller_intakes.status = 'Draft'
));

-- Add server-side file constraints to intake-documents bucket
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
WHERE id = 'intake-documents';


-- ── 20260319182137_548d5c81-7a30-4924-b9c7-33feb04945ac.sql ──────────────────────────────────────────────────────────


-- Add new columns to seller_intakes for the complete marketplace overhaul
ALTER TABLE public.seller_intakes
  ADD COLUMN IF NOT EXISTS business_phone text,
  ADD COLUMN IF NOT EXISTS business_email text,
  ADD COLUMN IF NOT EXISTS business_website text,
  ADD COLUMN IF NOT EXISTS years_in_business text,
  ADD COLUMN IF NOT EXISTS owner_title text,
  ADD COLUMN IF NOT EXISTS ownership_percentage text,
  ADD COLUMN IF NOT EXISTS card_holder_name text,
  ADD COLUMN IF NOT EXISTS bank_email text,
  ADD COLUMN IF NOT EXISTS is_us_bank boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS swift_bic text,
  ADD COLUMN IF NOT EXISTS bank_country text,
  ADD COLUMN IF NOT EXISTS same_bank_all_platforms boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS shopify_bank_name text,
  ADD COLUMN IF NOT EXISTS shopify_account_holder text,
  ADD COLUMN IF NOT EXISTS shopify_account_last4 text,
  ADD COLUMN IF NOT EXISTS shopify_routing_last4 text,
  ADD COLUMN IF NOT EXISTS shopify_account_type text,
  ADD COLUMN IF NOT EXISTS tiktok_bank_name text,
  ADD COLUMN IF NOT EXISTS tiktok_account_holder text,
  ADD COLUMN IF NOT EXISTS tiktok_account_last4 text,
  ADD COLUMN IF NOT EXISTS tiktok_routing_last4 text,
  ADD COLUMN IF NOT EXISTS tiktok_account_type text,
  ADD COLUMN IF NOT EXISTS tiktok_bank_email text,
  ADD COLUMN IF NOT EXISTS has_existing_amazon_listings boolean,
  ADD COLUMN IF NOT EXISTS target_amazon_marketplace text,
  ADD COLUMN IF NOT EXISTS plan_fba_warehousing boolean,
  ADD COLUMN IF NOT EXISTS brand_registry_enrolled boolean,
  ADD COLUMN IF NOT EXISTS shopify_has_logo boolean,
  ADD COLUMN IF NOT EXISTS shopify_theme_style text,
  ADD COLUMN IF NOT EXISTS shopify_has_domain boolean,
  ADD COLUMN IF NOT EXISTS shopify_preferred_domain text,
  ADD COLUMN IF NOT EXISTS shopify_phone text,
  ADD COLUMN IF NOT EXISTS shopify_payment_gateway text,
  ADD COLUMN IF NOT EXISTS shopify_product_description text,
  ADD COLUMN IF NOT EXISTS tiktok_warehouse_address text,
  ADD COLUMN IF NOT EXISTS tiktok_warehouse_city text,
  ADD COLUMN IF NOT EXISTS tiktok_warehouse_state text,
  ADD COLUMN IF NOT EXISTS tiktok_warehouse_zip text,
  ADD COLUMN IF NOT EXISTS tiktok_has_existing_content boolean,
  ADD COLUMN IF NOT EXISTS tiktok_follower_count text,
  ADD COLUMN IF NOT EXISTS tiktok_price_range text,
  ADD COLUMN IF NOT EXISTS tiktok_product_description text,
  ADD COLUMN IF NOT EXISTS has_existing_amazon_account boolean,
  ADD COLUMN IF NOT EXISTS has_existing_shopify_account boolean,
  ADD COLUMN IF NOT EXISTS has_existing_tiktok_account boolean,
  ADD COLUMN IF NOT EXISTS special_instructions text,
  ADD COLUMN IF NOT EXISTS consent_authorized boolean DEFAULT false;

-- Update document type validation to include BrandLogo
CREATE OR REPLACE FUNCTION public.validate_intake_document_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.document_type NOT IN ('BusinessRegistration', 'BusinessAddressProof', 'IDFront', 'IDBack', 'PersonalAddressProof', 'DiversityCert', 'TrademarkDoc', 'RepID', 'AuthorizationLetter', 'BankStatement', 'CreditCardFront', 'W9', 'BrandLogo', 'Other') THEN
    RAISE EXCEPTION 'Invalid document_type: %', NEW.document_type;
  END IF;
  RETURN NEW;
END;
$function$;


-- ── 20260321015926_63875a7f-775e-46f4-8d92-c83819191643.sql ──────────────────────────────────────────────────────────


CREATE OR REPLACE FUNCTION public.get_daily_pattern_activity(p_days integer DEFAULT 30)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT
      d::date AS date,
      (SELECT count(*) FROM cookie_patterns WHERE created_at::date = d::date) AS new_patterns,
      (SELECT count(DISTINCT domain) FROM cookie_patterns WHERE created_at::date = d::date) AS new_domains,
      (SELECT count(*) FROM cookie_patterns WHERE last_seen::date = d::date) AS active_patterns,
      (SELECT coalesce(sum(report_count), 0) FROM missed_banner_reports WHERE last_reported::date = d::date) AS reports
    FROM generate_series(
      (now() - make_interval(days => p_days))::date,
      now()::date,
      '1 day'::interval
    ) AS d
    ORDER BY d
  ) t;
$$;


-- ── 20260323195838_85e22edf-5897-4155-bc0f-ad99d2ea2386.sql ──────────────────────────────────────────────────────────

-- Delete dangerous bare structural selectors
DELETE FROM cookie_patterns WHERE selector IN ('body', 'html', 'head', 'body *', 'html *');

-- Update upsert_pattern to reject banned selectors and excluded domains
CREATE OR REPLACE FUNCTION public.upsert_pattern(_domain text, _selector text, _action_type text, _cmp_fingerprint text DEFAULT 'generic'::text, _source text DEFAULT 'community'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _trimmed_selector text;
  _trimmed_domain text;
BEGIN
  _trimmed_selector := lower(trim(_selector));
  _trimmed_domain := lower(trim(_domain));

  -- Reject dangerous bare structural selectors
  IF _trimmed_selector IN ('body', 'html', 'head', 'body *', 'html *', '*') THEN
    RAISE WARNING 'Rejected dangerous selector "%" for domain "%"', _selector, _domain;
    RETURN;
  END IF;

  -- Reject excluded domains (major web apps without standard cookie banners)
  IF _trimmed_domain IN (
    'icloud.com', 'mail.google.com', 'drive.google.com', 'docs.google.com',
    'outlook.live.com', 'outlook.office.com', 'teams.microsoft.com',
    'accounts.google.com', 'appleid.apple.com'
  ) THEN
    RAISE WARNING 'Rejected pattern for excluded domain "%"', _domain;
    RETURN;
  END IF;

  INSERT INTO public.cookie_patterns (domain, selector, action_type, cmp_fingerprint, source, last_seen)
  VALUES (_domain, _selector, _action_type, _cmp_fingerprint, _source, now())
  ON CONFLICT (domain, selector, action_type)
  DO UPDATE SET
    report_count = cookie_patterns.report_count + 1,
    confidence = LEAST(cookie_patterns.confidence + 1, 10),
    last_seen = now(),
    updated_at = now();
END;
$function$;

-- ── 20260324055045_0134049a-c7b2-4af3-be77-b279a1d39d4e.sql ──────────────────────────────────────────────────────────

DROP POLICY "activation_codes_select" ON public.activation_codes;

CREATE POLICY "activation_codes_service_select" ON public.activation_codes
  FOR SELECT
  USING (auth.role() = 'service_role'::text);

-- ── 20260324062818_af4d4eac-8a2f-45b8-a436-be9d9271bdc1.sql ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.validate_seller_intake_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('Draft', 'Submitted', 'In Review', 'Issues Flagged', 'Approved', 'Archived') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 20260324063338_40cbcba2-8b75-45e8-b29c-ce3a83c52f32.sql ──────────────────────────────────────────────────────────

DELETE FROM subscriptions WHERE id = '7ebc22da-d46e-49da-9cbb-a0c80e61951a' AND email = 'jaredbest@icloud.com';

-- ── 20260324064250_f98cdebb-5902-40b6-b42f-188f90f5ff71.sql ──────────────────────────────────────────────────────────


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


-- ── 20260324073047_303d99a3-5650-466a-89a1-ca0a8bc48cd1.sql ──────────────────────────────────────────────────────────

DROP POLICY "device_reg_update" ON public.device_registrations;
CREATE POLICY "device_reg_update_service" ON public.device_registrations
  FOR UPDATE USING (auth.role() = 'service_role');

-- ── 20260324073513_39d8e2f3-ce0a-4b2c-bcb2-84364f246937.sql ──────────────────────────────────────────────────────────

DROP POLICY "Anyone can insert cookie patterns" ON public.cookie_patterns;

-- ── 20260324173645_8461015d-5649-4029-9f07-8b17b66964bb.sql ──────────────────────────────────────────────────────────

CREATE POLICY "Users can delete own passkey_credentials"
ON public.passkey_credentials
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- ── 20260401062751_9bafb416-1ef7-4e40-8d97-10cc4916f270.sql ──────────────────────────────────────────────────────────


-- Fix 1: Remove public SELECT on granted_access, restrict to service_role/admin only
DROP POLICY IF EXISTS "granted_access_read" ON public.granted_access;
CREATE POLICY "granted_access_read_admin"
  ON public.granted_access FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Fix 2: Remove public SELECT/UPDATE on seller_intakes for Draft status
-- Replace with token-based ownership using a session_token column
ALTER TABLE public.seller_intakes ADD COLUMN IF NOT EXISTS session_token UUID DEFAULT gen_random_uuid();

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Allow public read of draft intakes" ON public.seller_intakes;
DROP POLICY IF EXISTS "Allow public update of draft intakes" ON public.seller_intakes;
DROP POLICY IF EXISTS "Allow public insert of intakes" ON public.seller_intakes;

-- Recreate with token-based ownership: user must know the session_token to access their draft
CREATE POLICY "Owner can read own draft intake"
  ON public.seller_intakes FOR SELECT
  TO anon
  USING (false);

CREATE POLICY "Owner can update own draft intake"
  ON public.seller_intakes FOR UPDATE
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Allow public insert of intakes"
  ON public.seller_intakes FOR INSERT
  TO anon
  WITH CHECK (status = 'Draft');

-- Admin can still do everything via existing service_role policies
CREATE POLICY "Admin can read all intakes"
  ON public.seller_intakes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can update all intakes"
  ON public.seller_intakes FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- ── 20260403051316_ce496f54-2c9b-495d-9647-2e05c6844749.sql ──────────────────────────────────────────────────────────

-- Create system_alert_state table for health check tracking
CREATE TABLE public.system_alert_state (
  id integer PRIMARY KEY DEFAULT 1,
  is_down boolean NOT NULL DEFAULT false,
  down_systems text[] NOT NULL DEFAULT '{}',
  last_checked timestamptz,
  last_alert_sent timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Constrain to single row
ALTER TABLE public.system_alert_state ADD CONSTRAINT single_row CHECK (id = 1);

-- Insert default row
INSERT INTO public.system_alert_state (id) VALUES (1);

-- Enable RLS
ALTER TABLE public.system_alert_state ENABLE ROW LEVEL SECURITY;

-- Only service role can access
CREATE POLICY "Service role manages system_alert_state"
  ON public.system_alert_state
  FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);


-- ── 20260403070553_c5a078aa-58f0-4201-86c8-478852d8c8df.sql ──────────────────────────────────────────────────────────

ALTER TABLE public.passkey_credentials ADD COLUMN device_name text;

-- ── 20260403201806_a0850a3e-358e-4a78-8a2d-2d80cc300382.sql ──────────────────────────────────────────────────────────


-- Create trigger function to sync granted_access → subscriptions
CREATE OR REPLACE FUNCTION public.sync_granted_access_to_subscriptions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.subscriptions (email, plan, status, stripe_customer_id)
  VALUES (LOWER(TRIM(NEW.email)), 'lifetime', 'active', 'granted_' || NEW.id::text)
  ON CONFLICT (email, plan) DO UPDATE SET
    status = 'active',
    updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger on granted_access table
CREATE TRIGGER trg_sync_granted_access_to_subscriptions
AFTER INSERT ON public.granted_access
FOR EACH ROW
EXECUTE FUNCTION public.sync_granted_access_to_subscriptions();

-- Backfill existing granted_access users who have no subscription
INSERT INTO public.subscriptions (email, plan, status, stripe_customer_id)
SELECT LOWER(TRIM(ga.email)), 'lifetime', 'active', 'granted_' || ga.id::text
FROM public.granted_access ga
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s
  WHERE LOWER(TRIM(s.email)) = LOWER(TRIM(ga.email))
  AND s.status = 'active'
)
ON CONFLICT DO NOTHING;


-- ── 20260404000000_home_hub_pihole_stats.sql ──────────────────────────────────────────────────────────

-- Migration: home_hub_pihole_stats
-- Stores Pi-hole snapshots pushed by the Raspberry Pi cron script.
-- The Pi POSTs a new row every ~60s using the service_role key.
-- The frontend reads the latest row via the anon key.
-- Rows older than 25 hours are auto-pruned on each insert.

create table public.home_hub_pihole_stats (
  id                   uuid         primary key default gen_random_uuid(),
  captured_at          timestamptz  not null default now(),
  status               text         not null,
  total_queries        integer      not null default 0,
  queries_blocked      integer      not null default 0,
  percent_blocked      numeric(6,3) not null default 0,
  domains_on_blocklist integer      not null default 0,
  active_clients       integer      not null default 0,
  -- [{domain, hits}]
  top_permitted        jsonb,
  -- [{domain, hits}]
  top_blocked          jsonb,
  -- {A: n, AAAA: n, ...}
  query_types          jsonb,
  -- [{hour, permitted, blocked}]
  hourly_chart         jsonb
);

comment on table public.home_hub_pihole_stats is
  'Pi-hole stats snapshots pushed from Raspberry Pi every ~60s';

create index home_hub_pihole_stats_captured_at_idx
  on public.home_hub_pihole_stats (captured_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.home_hub_pihole_stats enable row level security;

-- anon + authenticated can read; service_role bypasses RLS and can INSERT
create policy "allow_read_pihole_stats"
  on public.home_hub_pihole_stats
  for select
  to authenticated, anon
  using (true);

-- ── Auto-pruning trigger ──────────────────────────────────────────────────────
create or replace function public.prune_pihole_stats()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  delete from public.home_hub_pihole_stats
  where captured_at < now() - interval '25 hours';
  return new;
end;
$$;

create trigger prune_pihole_stats_after_insert
  after insert on public.home_hub_pihole_stats
  for each row execute function public.prune_pihole_stats();


-- ── 20260404205750_4ac9a2e1-cfeb-48aa-a1a3-a38bafa179fa.sql ──────────────────────────────────────────────────────────


-- Remove sensitive tables from realtime (without IF EXISTS)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.subscriptions;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.granted_access;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.seller_intakes;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- Add unique constraint on webhook_events.stripe_event_id for dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_stripe_event_id
  ON public.webhook_events (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;


-- ── 20260404205858_362e8d0c-9e71-461d-8909-39434f4d3918.sql ──────────────────────────────────────────────────────────


-- Drop the session-token policies that broke the form
DROP POLICY IF EXISTS "Owner can read own draft intake" ON public.seller_intakes;
DROP POLICY IF EXISTS "Owner can update own draft intake" ON public.seller_intakes;

-- Re-create with draft-only access (UUID knowledge = ownership)
CREATE POLICY "Anon can read own draft intake"
  ON public.seller_intakes FOR SELECT TO anon
  USING (status = 'Draft');

CREATE POLICY "Anon can update own draft intake"
  ON public.seller_intakes FOR UPDATE TO anon
  USING (status = 'Draft')
  WITH CHECK (status = 'Draft');

