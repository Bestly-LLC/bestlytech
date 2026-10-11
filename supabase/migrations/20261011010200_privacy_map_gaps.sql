-- Vera's first daily map check found personal-data columns that are not on the map yet. They go on as "Your call" rows
-- (Jared ticks them on the case panel). maya_billing_actions.email and maya_verifications.email belong to the Maya billing
-- work and are deliberately left for that session to map. Applied to rcqfqhguwpmaarseifqg as privacy_map_gaps.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason) values
  ('seller_intakes', 'amazon_email', 'email', 'review', 'Your call'),
  ('seller_intakes', 'amazon_phone', 'phone', 'review', 'Your call'),
  ('seller_intakes', 'bank_email', 'email', 'review', 'Your call'),
  ('seller_intakes', 'business_email', 'email', 'review', 'Your call'),
  ('seller_intakes', 'business_phone', 'phone', 'review', 'Your call'),
  ('seller_intakes', 'phone_number', 'phone', 'review', 'Your call'),
  ('seller_intakes', 'shopify_email', 'email', 'review', 'Your call'),
  ('seller_intakes', 'shopify_phone', 'phone', 'review', 'Your call'),
  ('seller_intakes', 'tiktok_bank_email', 'email', 'review', 'Your call'),
  ('seller_intakes', 'tiktok_email', 'email', 'review', 'Your call'),
  ('seller_intakes', 'tiktok_phone', 'phone', 'review', 'Your call'),
  ('ava_followups', 'callback_phone', 'phone', 'review', 'Your call'),
  ('approval_staff', 'email', 'email', 'review', 'Your call'),
  ('partner_google', 'email', 'email', 'review', 'Your call')
on conflict do nothing;
