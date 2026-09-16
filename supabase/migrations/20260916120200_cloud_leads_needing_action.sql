-- Sidebar "Cloud Deals" badge counted cloud_leads.status = 'new', which nothing ever updates,
-- so it was a count of every lead ever. A lead needs action when it has no deal yet, or its
-- most advanced deal is still at stage 1-2 (lead / brief). Disqualified leads are excluded.
-- security_invoker: RLS on cloud_leads / cloud_deals (admin only) still decides what a caller sees.
create or replace view public.v_cloud_leads_needing_action
with (security_invoker = true) as
select l.id
  from public.cloud_leads l
 where l.status is distinct from 'disqualified'
   and coalesce((select max(d.current_stage) from public.cloud_deals d where d.lead_id = l.id), 0) <= 2;

revoke all on public.v_cloud_leads_needing_action from public, anon;
grant select on public.v_cloud_leads_needing_action to authenticated;
