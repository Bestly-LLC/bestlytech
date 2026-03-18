-- Clean up Shein data for re-processing with new fallback logic
DELETE FROM ai_generation_log WHERE domain = 'us.shein.com';

UPDATE missed_banner_reports 
SET ai_attempts = 0, ai_processed_at = NULL, resolved = false, resolved_at = NULL
WHERE domain = 'us.shein.com';