-- 2026-10-05: Eli's Ava "Demo call" shows what the call just cost him to run.
-- Same cost math as rg_costs() / the spend cap: voice minutes + phone minutes + AI model.
-- Partners may only look up demo-lead calls; admins may look up any call.
create or replace function public.rg_demo_call_cost(p_call_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c rg_calls; s rg_settings; v_total numeric; v_voice numeric; v_phone numeric;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'partner')) then
    raise exception 'Not allowed';
  end if;
  select * into s from rg_settings where id;
  select * into c from rg_calls where id = p_call_id;
  if c.id is null then return jsonb_build_object('ok', false); end if;
  if not public.has_role(auth.uid(), 'admin') and c.lead_id is distinct from s.demo_lead_id then
    return jsonb_build_object('ok', false);
  end if;
  v_voice := coalesce(c.duration_sec, 0) / 60.0 * s.cost_voice_per_min;
  v_phone := ceil(coalesce(c.duration_sec, 0) / 60.0) * s.cost_phone_per_min;
  v_total := rg_call_cost(c, s);
  return jsonb_build_object('ok', true, 'total', round(v_total, 2), 'voice', round(v_voice, 2), 'phone', round(v_phone, 2),
    'ai', round(greatest(v_total - v_voice - v_phone, 0), 2), 'seconds', coalesce(c.duration_sec, 0));
end $$;
revoke execute on function public.rg_demo_call_cost(uuid) from public, anon;
grant execute on function public.rg_demo_call_cost(uuid) to authenticated;
