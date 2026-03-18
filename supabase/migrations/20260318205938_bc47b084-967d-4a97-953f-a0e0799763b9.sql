DELETE FROM cookie_patterns WHERE domain = 'skatepro.com' AND selector = 'button#accept';
UPDATE missed_banner_reports SET resolved = false, resolved_at = NULL, ai_processed_at = NULL, ai_attempts = 0 WHERE domain = 'skatepro.com';
DELETE FROM ai_generation_log WHERE domain = 'skatepro.com';