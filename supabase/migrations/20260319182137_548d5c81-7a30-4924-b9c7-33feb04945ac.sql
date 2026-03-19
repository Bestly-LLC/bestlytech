
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
