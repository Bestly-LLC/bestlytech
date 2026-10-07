-- Track S (studio-promo), 2026-10-06. Record of a live fix already applied via execute_sql.
-- The bestly-studio "price claim" rule matched "per post", which blocked useful posting tips such as "one idea per post".
-- A real price already trips the rule through "$5", "dollars", "per month", "pricing" and the rest. Idempotent.
update public.claim_rules
   set pattern = replace(pattern, 'per post|', '')
 where client_slug = 'bestly-studio' and label = 'price claim' and pattern like '%per post|%';
