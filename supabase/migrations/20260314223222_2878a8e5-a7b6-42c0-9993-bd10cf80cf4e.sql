
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
