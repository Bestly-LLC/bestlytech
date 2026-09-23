-- Security hardening: revoke anon EXECUTE on mail functions
-- and lock search_path on all public functions missing it.

-- 1. Revoke anon access to SECURITY DEFINER mail functions
REVOKE EXECUTE ON FUNCTION public.bestly_mail_complete(uuid, boolean, bigint, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bestly_mail_enqueue_cleanup(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bestly_mail_undo(uuid) FROM anon;

-- 2. Fix search_path on functions missing it (prevents search_path injection)
ALTER FUNCTION public.ask_hook_styles() SET search_path = public;
ALTER FUNCTION public.ask_norm_hook_style() SET search_path = public;
ALTER FUNCTION public.ask_opening_say() SET search_path = public;
ALTER FUNCTION public.ask_sim() SET search_path = public;
ALTER FUNCTION public.ask_words() SET search_path = public;
ALTER FUNCTION public.bestly_credential_registry_no_secrets() SET search_path = public;
ALTER FUNCTION public.bestly_is_bulk() SET search_path = public;
ALTER FUNCTION public.bestly_is_protected() SET search_path = public;
ALTER FUNCTION public.bestly_memory_keep_history() SET search_path = public;
ALTER FUNCTION public.bestly_memory_keep_private_out() SET search_path = public;
ALTER FUNCTION public.bestly_memory_no_secrets() SET search_path = public;
ALTER FUNCTION public.bluesteel_la_today() SET search_path = public;
ALTER FUNCTION public.brand_settings_touch() SET search_path = public;
ALTER FUNCTION public.calendar_dates() SET search_path = public;
ALTER FUNCTION public.client_todos_due_default() SET search_path = public;
ALTER FUNCTION public.current_brand() SET search_path = public;
ALTER FUNCTION public.cy_is_own_domain() SET search_path = public;
ALTER FUNCTION public.cy_selector_cookie_like() SET search_path = public;
ALTER FUNCTION public.hoku_bank_no_product_photo() SET search_path = public;
ALTER FUNCTION public.hoku_check_photo_approved() SET search_path = public;
ALTER FUNCTION public.hoku_clean_caption() SET search_path = public;
ALTER FUNCTION public.hoku_compliance_violation() SET search_path = public;
ALTER FUNCTION public.hoku_content_bank_autoimage() SET search_path = public;
ALTER FUNCTION public.hoku_content_bank_compliance() SET search_path = public;
ALTER FUNCTION public.hoku_content_bank_normalize() SET search_path = public;
ALTER FUNCTION public.hoku_gtin12_valid() SET search_path = public;
ALTER FUNCTION public.hoku_next_slots() SET search_path = public;
ALTER FUNCTION public.hoku_og_url() SET search_path = public;
ALTER FUNCTION public.hoku_soft_claim_violation() SET search_path = public;
ALTER FUNCTION public.meeting_people() SET search_path = public;
ALTER FUNCTION public.meeting_skip_deleted() SET search_path = public;
ALTER FUNCTION public.next_digest_time() SET search_path = public;
ALTER FUNCTION public.security_audit_log_immutable() SET search_path = public;
ALTER FUNCTION public.shop_listing_compliance() SET search_path = public;
ALTER FUNCTION public.shop_order_items_brand() SET search_path = public;
ALTER FUNCTION public.shop_products_stock_ref_check() SET search_path = public;
ALTER FUNCTION public.social_bank_prepare() SET search_path = public;
ALTER FUNCTION public.social_posts_hoku_gate() SET search_path = public;
ALTER FUNCTION public.social_posts_touch() SET search_path = public;
ALTER FUNCTION public.talk_bucket() SET search_path = public;
ALTER FUNCTION public.trg_meeting_people() SET search_path = public;
ALTER FUNCTION public.url_encode() SET search_path = public;
