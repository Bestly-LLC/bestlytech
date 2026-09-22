-- Revoking says whether it worked, so the portal can show an error instead of doing nothing.
drop function if exists public.partner_connector_revoke(uuid);
create function public.partner_connector_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.partner_connectors set revoked_at = now()
   where id = p_id and user_id = auth.uid() and revoked_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.partner_connector_revoke(uuid) from public, anon;
grant execute on function public.partner_connector_revoke(uuid) to authenticated;
