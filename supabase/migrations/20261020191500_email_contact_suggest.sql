-- Email builder: contact type-ahead for the To fields (2026-10-20).
--
-- email_contact_suggest(p_q, p_limit) returns name, email, source, detail, ranked:
--   client  active client_people with an email (detail = the client's name)
--   icloud  mail_contacts: every email in Jared's iCloud contacts, synced daily over CardDAV by spam-desk
--   recent  people he emailed: email_library recipients and bestly_sent_mail.to_addrs
-- One row per email address (the best-ranked source wins). Admins only: the function checks
-- has_role(auth.uid(),'admin') and is not callable by anon, so it never needs security_public_rpcs.
-- Rollback: drop function public.email_contact_suggest(text, integer);

create or replace function public.email_contact_suggest(p_q text, p_limit integer default 8)
returns table (name text, email text, source text, detail text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := lower(btrim(coalesce(p_q, '')));
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if length(q) < 1 then return; end if;

  return query
  with sent as (
    select nullif(trim(both ' "' from m[1]), '') as name, lower(m[2]) as email, max(s.sent_at) as last_at
    from public.bestly_sent_mail s,
         lateral regexp_matches(coalesce(s.to_addrs, ''), '(?:([^,<]*?)\s*<)?([^\s<>,;"]+@[^\s<>,;"]+\.[a-z]{2,})>?', 'gi') as m
    group by 1, 2
  ),
  hits as (
    select cp.name, lower(cp.email) as email, 'client'::text as source,
           coalesce(ac.name, cp.client_slug) as detail, 1 as rank, null::timestamptz as last_at
      from public.client_people cp
      left join public.approval_clients ac on ac.slug = cp.client_slug
     where cp.active and cp.email is not null
    union all
    select mc.name, lower(mc.email), 'icloud', null, 2, null from public.mail_contacts mc
    union all
    select el.recipient_name, lower(el.recipient_email), 'recent', null, 3, max(el.updated_at)
      from public.email_library el where el.recipient_email is not null group by 1, 2
    union all
    select s.name, s.email, 'recent', null, 3, s.last_at from sent s
  ),
  matched as (
    select h.*,
           case when lower(coalesce(h.name, '')) like q || '%' or h.email like q || '%' then 0
                when lower(coalesce(h.name, '')) like '% ' || q || '%' then 1
                else 2 end as fit
      from hits h
     where h.email like '%@%'
       and (lower(coalesce(h.name, '')) like '%' || q || '%' or h.email like '%' || q || '%')
  ),
  best as (
    select distinct on (m.email) m.name, m.email, m.source, m.detail, m.rank, m.fit, m.last_at
      from matched m
     order by m.email, m.rank, (m.name is null), m.last_at desc nulls last
  )
  select b.name, b.email, b.source, b.detail
    from best b
   order by b.fit, b.rank, b.last_at desc nulls last, coalesce(b.name, b.email)
   limit greatest(1, least(coalesce(p_limit, 8), 20));
end $$;

revoke all on function public.email_contact_suggest(text, integer) from public, anon;
grant execute on function public.email_contact_suggest(text, integer) to authenticated;
