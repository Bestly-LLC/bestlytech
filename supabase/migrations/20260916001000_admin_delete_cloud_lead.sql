-- /admin/cloud: delete a lead (and everything hanging off it) in one admin-only call.
-- cloud_deals.lead_id has no ON DELETE action, so a plain delete of a lead that became a deal
-- fails with a FK error. This removes the deal first (its timeline and Shield requests cascade;
-- global Shield reports just lose the link), then the lead (its brief and events cascade).
create or replace function public.admin_delete_cloud_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company text;
  v_deals int := 0;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select company_name into v_company from cloud_leads where id = p_lead_id;
  if v_company is null then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  with d as (delete from cloud_deals where lead_id = p_lead_id returning 1)
  select count(*) into v_deals from d;

  delete from cloud_leads where id = p_lead_id;

  return jsonb_build_object('deleted', true, 'company_name', v_company, 'deals_removed', v_deals);
end $$;

revoke all on function public.admin_delete_cloud_lead(uuid) from public, anon;
grant execute on function public.admin_delete_cloud_lead(uuid) to authenticated;
