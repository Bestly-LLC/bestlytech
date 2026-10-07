-- Reviews tab: the trip's own messages next to the review (admin only).
create or replace function public.rep_trip_messages(p_reservation bigint) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('sent_at', m.sent_at, 'role', m.role, 'author', m.author, 'body', left(m.body, 600)) order by m.sent_at)
                     from (select * from turo_inbox where reservation_id = p_reservation order by sent_at desc limit 40) m), '[]'::jsonb);
end $$;
revoke all on function public.rep_trip_messages(bigint) from anon, public;
grant execute on function public.rep_trip_messages(bigint) to authenticated;
