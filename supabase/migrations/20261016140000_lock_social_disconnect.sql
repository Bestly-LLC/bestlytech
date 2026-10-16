-- Lock down the raw social_disconnect(uuid, text, text).
-- It is SECURITY DEFINER and took any client uuid, so anyone with the publishable key could disconnect any
-- client's social account and hold their queued posts. Every real caller goes through a checked wrapper:
--   client board  -> client_social_disconnect (board token)
--   staff Studio  -> studio_social_disconnect (staff token)
--   board "no longer posting here" -> client_social_stop_platform (board token)
-- Those run as the owner, so revoking direct EXECUTE from anon/authenticated breaks nothing.
-- UNDO: grant execute on function public.social_disconnect(uuid, text, text) to anon, authenticated;
revoke execute on function public.social_disconnect(uuid, text, text) from public, anon, authenticated;
grant execute on function public.social_disconnect(uuid, text, text) to service_role;
