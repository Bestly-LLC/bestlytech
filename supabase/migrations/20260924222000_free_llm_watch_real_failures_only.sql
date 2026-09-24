-- 2026-09-24 (applied live as free_llm_watch_real_failures_only): only real provider failures count toward the
-- free-AI pause, pauses are 15 min, and the last working free provider is never paused. Full function body is in
-- the live database (public.free_llm_watch); this file records the change. See admin-chat v28.4.
select 1;
