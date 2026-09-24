-- Where a partner last was (city level, ~1 km), so the portal shows their own weather, and Jared's
-- "view as" shows the partner's weather instead of Jared's. Written only by the partner themselves.
alter table public.partners add column if not exists wx_lat numeric, add column if not exists wx_lon numeric,
  add column if not exists wx_label text, add column if not exists wx_at timestamptz, add column if not exists wx_precise boolean;

create or replace function public.partner_set_place(p_lat numeric, p_lon numeric, p_label text, p_precise boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_lat is null or p_lon is null or abs(p_lat) > 90 or abs(p_lon) > 180 then return; end if;
  update partners set wx_lat = round(p_lat, 2), wx_lon = round(p_lon, 2), wx_label = left(coalesce(nullif(trim(p_label), ''), 'Your area'), 60),
         wx_at = now(), wx_precise = coalesce(p_precise, true)
   where user_id = auth.uid();
end $$;
revoke all on function public.partner_set_place(numeric, numeric, text, boolean) from public, anon;
grant execute on function public.partner_set_place(numeric, numeric, text, boolean) to authenticated;
