-- Nickel: settlement_mail_search2_t timed out (statement timeout) when it built snippets for every mailbox row before
-- filtering. Filter first with a cheap ILIKE, take the newest p_limit rows, and only then build the snippets.
-- Same signature and output as 20261011001100_settlements_proof_rpcs.sql.
create or replace function public.settlement_mail_search2_t(p_token text, p_terms text[], p_since date default null,
  p_until date default null, p_body boolean default true, p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_terms text[]; v_lim int := least(greatest(coalesce(p_limit, 40), 1), 60);
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  select array_agg(distinct x) into v_terms from (
    select regexp_replace(lower(trim(t)), '[%_\\]', '', 'g') as x from unnest(coalesce(p_terms, '{}')) t) q where length(x) >= 3;
  if v_terms is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'from', x.frm, 'subject', x.subject, 'sent_at', x.sent_at, 'snippet', x.snip)
                     order by x.sent_at desc)
    from (
      select m.id, coalesce(m.from_name, m.from_addr) as frm, m.subject, m.sent_at,
             case when h.bpos is not null then substr(h.body, greatest(h.bpos - 60, 1), 160)
                  else substr(h.head, greatest(coalesce(h.hpos, 1) - 60, 1), 160) end as snip
      from (
        select * from bestly_mail b0
         where (p_since is null or b0.sent_at >= p_since)
           and (p_until is null or b0.sent_at < p_until + 1)
           and exists (select 1 from unnest(v_terms) t
                        where b0.subject ilike '%' || t || '%' or b0.from_name ilike '%' || t || '%' or b0.from_addr ilike '%' || t || '%'
                           or (p_body and b0.body_text ilike '%' || t || '%'))
         order by b0.sent_at desc
         limit v_lim) m
      cross join lateral (
        select lower(coalesce(m.subject, '') || ' | ' || coalesce(m.from_name, '') || ' <' || coalesce(m.from_addr, '') || '>') as headl,
               coalesce(m.subject, '') || ' | ' || coalesce(m.from_name, '') || ' <' || coalesce(m.from_addr, '') || '>' as head,
               case when p_body then regexp_replace(left(coalesce(m.body_text, ''), 20000), '\s+', ' ', 'g') else '' end as body
      ) b
      cross join lateral (
        select b.head as head, b.body as body,
               (select min(position(t in b.headl)) filter (where position(t in b.headl) > 0) from unnest(v_terms) t) as hpos,
               case when p_body then (select min(position(t in lower(b.body))) filter (where position(t in lower(b.body)) > 0) from unnest(v_terms) t) end as bpos
      ) h
    ) x), '[]'::jsonb);
end $$;
