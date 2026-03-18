DELETE FROM ai_generation_log WHERE domain = 'us.shein.com';
UPDATE missed_banner_reports SET ai_attempts = 0, ai_processed_at = NULL WHERE domain = 'us.shein.com';