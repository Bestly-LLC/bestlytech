-- Fix: /admin/cloud showed "permission denied for view v_cloud_lead_funnel" (and the Auto-Fix
-- monitor hit the same wall on its two views). These views are security_invoker, so RLS on the
-- base tables (admin-only via has_role) still decides what a caller sees; they only lacked the
-- SELECT grant. Verified 2026-09-15: admin sees 2 funnel rows, a non-admin authenticated user sees 0.
grant select on public.v_cloud_lead_funnel to authenticated;
grant select on public.v_cloud_pipeline to authenticated;
grant select on public.v_cloud_shield_pending to authenticated;
grant select on public.v_cookieyeti_needs_attention to authenticated;
grant select on public.v_cookieyeti_pipeline_health to authenticated;
