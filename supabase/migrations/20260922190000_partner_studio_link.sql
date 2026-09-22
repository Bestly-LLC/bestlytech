-- Link a partner to his Studio staff account explicitly (partners.staff_id), so the Studio bell
-- in /partner works before he has ever signed in there, and the admin's "view as" sees his bell.
alter table public.partners add column if not exists staff_id uuid references public.approval_staff(id);
update public.partners p set staff_id = s.id
  from public.approval_staff s
 where p.staff_id is null and s.active and (s.slug = p.roster_name or lower(s.email) = lower(p.email));

create or replace function public.partner_staff_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(p.staff_id, (select s.id from public.approval_staff s
                                where s.active and (s.slug = p.roster_name or lower(s.email) = lower(p.email)) limit 1))
    from public.partners p where p.user_id = auth.uid() limit 1;
$$;
revoke all on function public.partner_staff_id() from public, anon;

-- p_roster: the admin viewing a partner's screen (/partner?as=eli). Ignored for everyone else.
drop function if exists public.partner_studio_notifications();
create or replace function public.partner_studio_notifications(p_roster text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sid uuid; v_seen timestamptz;
begin
  if p_roster is not null and public.has_role(auth.uid(), 'admin') then
    select coalesce(p.staff_id, (select s.id from approval_staff s where s.active and s.slug = p.roster_name limit 1))
      into sid from partners p where p.roster_name = lower(p_roster);
  else
    sid := public.partner_staff_id();
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
revoke all on function public.partner_studio_notifications(text) from public, anon;
grant execute on function public.partner_studio_notifications(text) to authenticated;
