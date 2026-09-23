-- The fleet tables shipped with RLS and an admin read policy but no table-level SELECT
-- grant, so the browser got an empty result rather than a denial: the Turo widgets
-- rendered their "nothing yet" state against tables that had rows in them.
--
-- A policy decides WHICH rows a role may see. The grant decides whether the role may
-- look at all. Both are required, and missing the grant fails silently, which is the
-- part that makes it worth a comment.
grant select on public.turo_trips to authenticated;
grant select on public.turo_vehicle_state to authenticated;
