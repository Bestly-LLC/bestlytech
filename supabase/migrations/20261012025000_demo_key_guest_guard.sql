-- 2026-10-11: applied live via MCP as demo_key_guest_guard_20261011 (this file records it).
-- The demo key check claimed a real Turo guest (Yuta Hanada, res 62243969) as a demo visitor and scheduled her key
-- for removal. Fix: demo_key_guest_match(id, name) (by share_user_id, else by last name on an active trip);
-- demo_key_apply skips guests and links their key, and claims a driver only within 30 min of a demo tap
-- (anyone else = critical "Unknown driver on Blue Steel" signed Leo, never removed); demo_key_release_guests()
-- runs in demo_key_tick before any removal. Demo alerts are signed Leo.
-- Undo: bestly_private_memory key turo/2026-10-11-demo-key-undo holds the previous function bodies.
-- Full SQL as applied: see supabase_migrations.schema_migrations (name demo_key_guest_guard_20261011).
select 1;
