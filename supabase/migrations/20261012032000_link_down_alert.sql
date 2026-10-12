-- 2026-10-11: a guest who lands on a link-down page is a real person waiting. The page logs 'link_down'
-- (lax_track); a real guest's first one per trip per day pings Jared, signed Leo (Leo is helping them on the page).
do $mig$
declare src text;
begin
  src := pg_get_functiondef('public.lax_track(text,text,jsonb,text,text)'::regprocedure);
  if position('link_down' in src) = 0 then
    src := replace(src, $a$'next_charging') then return;$a$, $b$'next_charging','link_down') then return;$b$);
    src := replace(src, $a$  insert into lax_guest_events (reservation_$a$, $b$  if p_kind = 'link_down' and v_actor = 'guest' then
    perform set_config('autonomy.allow', '1', true);
    perform notify_route('Leo: A guest is stuck on an old trip link',
      'Someone opened the trip link for reservation ' || l.reservation_id || ' and it no longer works (' || coalesce(p_detail->>'reason', 'unknown')
      || '). I''m on the page with them; if they rebooked, their new trip is at bestly.tech/turo-key.',
      'time-sensitive', 'Leo', 'https://bestly.tech/admin/turo/lax-pass', null,
      'link-down-' || l.reservation_id || '-' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD'), null, null, false, now());
  end if;

  insert into lax_guest_events (reservation_$b$);
    if position('''link_down'') then return' in src) = 0 or position('Leo: A guest is stuck' in src) = 0 then
      raise exception 'lax_track anchors not found';
    end if;
    execute src;
  end if;
end $mig$;
