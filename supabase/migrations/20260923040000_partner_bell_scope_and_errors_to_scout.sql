-- Partner bell: Eli sees only Centering YOU. Errors go to Scout, not to people.
--
-- 1. partner_studio_notifications never applied staff_may_hear, so rows written before
--    the notify_outbox_scope trigger existed (Cookie Yeti / InventoryProof engine runs,
--    Bestly Test answers, preview builds) still showed in Eli's portal bell.
--    Now: scope check + only clients in the staff member's notify_clients + no error rows.
-- 2. Error-type Studio notices (drift, mail_gap, engine runs that found nothing / failed,
--    anything system-side saying failed/error/not responding) open a monitor incident via
--    bestly_raise, which feeds the fix ladder (auto -> free AI -> Scout). They no longer
--    land in any staff bell.
-- 3. partner_report_error: the partner portal reports its own failures straight to Scout.
-- 4. notify_errors_sweep: incidents raised this way close after 26h quiet; a clean engine
--    run closes its engine incident immediately.

create or replace function public.notify_is_error(o public.notify_outbox)
returns boolean language sql immutable set search_path = public as $$
  select case
    -- content notices: titles are post copy ("You are not failing"), never scan them
    when o.kind in ('decision','recording','client_ask','client_posts','signoff','todo_handoff','preview') then false
    when o.kind in ('drift','mail_gap') then true
    when o.kind = 'engine' then
      coalesce(o.subject,'') ~* '(nothing_fits|error|fail)'
      or coalesce((o.payload->>'status') ~ '^[0-9]+$' and (o.payload->>'status')::int >= 400, false)
    else coalesce(o.subject,'') ~* '\m(error|errored|failed|failing|broken|not serving|not responding|stuck|crash(ed)?)\M'
  end;
$$;

create or replace function public.notify_error_key(o public.notify_outbox)
returns text language sql immutable set search_path = public as $$
  select 'studio.' || o.kind || coalesce('.' || nullif(o.payload->>'slug',''), '');
$$;

create or replace function public.notify_outbox_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.notify_is_error(new) then
    -- one incident per kind+client, however many staff rows the sender fans out
    begin
      perform public.bestly_raise(public.notify_error_key(new), 'problem', 'warning',
        left(coalesce(new.subject, 'Studio reported a problem'), 200),
        left(coalesce(new.body, ''), 1500), 'studio', null, false);
    exception when others then
      raise warning 'notify_outbox_scope: bestly_raise failed: %', sqlerrm;
    end;
    return null;  -- Scout owns it; nobody's bell gets it
  end if;

  if new.kind = 'engine' and nullif(new.payload->>'slug','') is not null then
    begin
      perform public.bestly_raise(public.notify_error_key(new), 'resolved', 'info',
        'Fixed: ' || left(coalesce(new.subject,''), 180), 'A later run worked.', 'studio');
    exception when others then null;
    end;
  end if;

  if new.staff_id is not null and not public.staff_may_hear(new.staff_id, public.notify_row_client(new)) then
    return null;
  end if;
  return new;
end $$;

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
    'unread', (select count(*) from public.notify_outbox o
                where o.staff_id = sid
                  and public.partner_may_see_notify(sid, o)
                  and o.created_at > coalesce(v_seen, now() - interval '3 days')
                  and o.created_at > now() - interval '14 days'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'subject', o.subject,
        'body', left(o.body, 400), 'link', o.link, 'at', o.created_at,
        'unread', o.created_at > coalesce(v_seen, now() - interval '3 days')) order by o.created_at desc)
      from (select * from public.notify_outbox o0
             where o0.staff_id = sid and o0.created_at > now() - interval '30 days'
               and public.partner_may_see_notify(sid, o0)
             order by o0.created_at desc limit 40) o), '[]'::jsonb));
end $$;

-- Owner sees everything they may hear; everyone else only rows tied to a client in their
-- notify_clients list (Eli: centering-you). General/system rows never reach a partner.
create or replace function public.partner_may_see_notify(p_staff uuid, o public.notify_outbox)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.notify_is_error(o)
     and public.staff_may_hear(p_staff, public.notify_row_client(o))
     and (coalesce(st.is_owner, false)
          or exists (select 1 from public.approval_clients c
                      where c.id = public.notify_row_client(o)
                        and c.slug = any (coalesce(st.notify_clients, st.client_scope, '{}'::text[]))))
  from (select 1) one left join public.approval_staff st on st.id = p_staff;
$$;

-- The portal reports its own failures here. Partners and admins only; one incident per spot.
create or replace function public.partner_report_error(p_where text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_who text;
  v_where text := left(regexp_replace(lower(coalesce(p_where,'unknown')), '[^a-z0-9_.-]+', '-', 'g'), 60);
begin
  select roster_name into v_who from public.partners where user_id = auth.uid() limit 1;
  if v_who is null and not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  perform public.bestly_raise('partner.' || v_where, 'problem', 'warning',
    'Partner portal: ' || replace(v_where, '.', ' › ') || ' failed',
    left(coalesce(p_detail, 'No detail'), 800) || E'\nSeen by: ' || coalesce(v_who, 'admin'),
    'partner', null, false);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.partner_report_error(text, text) from public, anon;
grant execute on function public.partner_report_error(text, text) to authenticated;

create or replace function public.notify_errors_sweep()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select key from public.monitor_issues
            where status = 'open' and (key like 'studio.%' or key like 'partner.%')
              and updated_at < now() - interval '26 hours'
  loop
    perform public.bestly_raise(r.key, 'resolved', 'info', null, 'Quiet for a day — closed.', null);
    n := n + 1;
  end loop;
  return n;
end $$;

select cron.unschedule('notify-errors-sweep') where exists (select 1 from cron.job where jobname = 'notify-errors-sweep');
select cron.schedule('notify-errors-sweep', '41 * * * *', $$select public.notify_errors_sweep()$$);

-- Rows that already leaked into Eli's bell are left in place; partner_may_see_notify hides them.

revoke all on function public.partner_may_see_notify(uuid, public.notify_outbox) from public, anon, authenticated;
revoke all on function public.notify_errors_sweep() from public, anon, authenticated;
