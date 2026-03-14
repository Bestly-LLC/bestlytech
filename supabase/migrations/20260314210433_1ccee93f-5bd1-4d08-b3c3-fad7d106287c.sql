
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
