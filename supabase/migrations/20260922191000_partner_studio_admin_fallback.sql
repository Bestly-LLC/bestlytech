-- The admin on /partner (no partner row, no ?as=) sees his own Studio bell (the owner's staff
-- account) instead of "not linked".
create or replace function public.partner_studio_notifications(p_roster text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sid uuid; v_seen timestamptz; adm boolean := public.has_role(auth.uid(), 'admin');
begin
  if p_roster is not null and adm then
    select coalesce(p.staff_id, (select s.id from approval_staff s where s.active and s.slug = p.roster_name limit 1))
      into sid from partners p where p.roster_name = lower(p_roster);
  else
    sid := public.partner_staff_id();
    if sid is null and adm then
      select id into sid from approval_staff where is_owner and active order by created_at limit 1;
    end if;
  end if;
  if sid is null then return jsonb_build_object('ok', false, 'unread', 0, 'items', '[]'::jsonb); end if;
  select seen_at into v_seen from public.staff_notify where staff_id = sid;
  return jsonb_build_object('ok', true, 'seen_at', v_seen,
    'unread', (select count(*) from public.notify_outbox o where o.staff_id = sid
                 and o.created_at > coalesce(v_seen, now() - interval '3 days') and o.created_at > now() - interval '14 days'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'subject', o.subject, 'body', left(o.body, 400),
        'link', o.link, 'at', o.created_at, 'unread', o.created_at > coalesce(v_seen, now() - interval '3 days')) order by o.created_at desc)
      from (select * from public.notify_outbox where staff_id = sid and created_at > now() - interval '30 days'
             order by created_at desc limit 40) o), '[]'::jsonb));
end $$;

create or replace function public.partner_studio_seen()
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := public.partner_staff_id();
begin
  if sid is null and public.has_role(auth.uid(), 'admin') then
    select id into sid from approval_staff where is_owner and active order by created_at limit 1;
  end if;
  if sid is null then return; end if;
  insert into public.staff_notify (staff_id, seen_at) values (sid, now())
  on conflict (staff_id) do update set seen_at = now(), updated_at = now();
end $$;
