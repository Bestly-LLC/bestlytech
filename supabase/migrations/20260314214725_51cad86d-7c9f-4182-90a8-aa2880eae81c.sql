
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
