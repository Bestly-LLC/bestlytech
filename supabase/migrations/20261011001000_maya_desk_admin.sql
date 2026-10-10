-- Maya Desk backend (/admin/maya). Applied live through MCP on 2026-10-10, one function per call.
-- All admin RPCs: SECURITY DEFINER, admin-guarded on line one, executable by authenticated only (the guard stops non-admins).

create or replace function public.admin_maya_tickets(p_view text default 'open')
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v jsonb;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) into v from (
    select s.*, (s.status = 'open' and s.due_at < now()) as overdue,
           (extract(epoch from (s.due_at - now())) / 60)::int as due_in_minutes,
           row_number() over (order by
             case p_view when 'open' then extract(epoch from s.due_at) when 'leads' then -extract(epoch from s.created_at) when 'done' then -extract(epoch from coalesce(s.resolved_at, s.created_at)) else -extract(epoch from s.created_at) end) as ord
    from support_tickets s
    where case p_view
      when 'open' then s.status = 'open' and s.kind <> 'sales_lead'
      when 'leads' then s.status = 'open' and s.kind = 'sales_lead'
      when 'done' then s.status in ('done','spam')
      else true end
    order by ord
    limit case p_view when 'done' then 100 when 'all' then 200 else 500 end
  ) x;
  return v;
end $f$;

create or replace function public.admin_maya_ticket_set(p_code text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare t support_tickets;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('open','done','spam') then raise exception 'status must be open, done or spam'; end if;
  update support_tickets set status = p_status,
         resolved_at = case when p_status = 'open' then null else now() end,
         note = case when nullif(btrim(coalesce(p_note, '')), '') is null then note else concat_ws(E'\n', note, btrim(p_note)) end
   where code = p_code returning * into t;
  if not found then raise exception 'no such ticket'; end if;
  return to_jsonb(t);
end $f$;

create or replace function public.admin_maya_counts()
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select jsonb_build_object(
    'open', count(*) filter (where status = 'open' and kind <> 'sales_lead'),
    'overdue', count(*) filter (where status = 'open' and kind <> 'sales_lead' and due_at < now()),
    'leads', count(*) filter (where status = 'open' and kind = 'sales_lead'),
    'privacy_open', count(*) filter (where status = 'open' and kind = 'privacy'))
    from support_tickets);
end $f$;

revoke all on function public.admin_maya_tickets(text), public.admin_maya_ticket_set(text,text,text), public.admin_maya_counts() from public, anon, authenticated;
grant execute on function public.admin_maya_tickets(text), public.admin_maya_ticket_set(text,text,text), public.admin_maya_counts() to authenticated;

-- Ticket alerts now open the Maya Desk instead of the team page.
CREATE OR REPLACE FUNCTION public.maya_file_ticket(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t support_tickets; v_kind text := coalesce(nullif(p->>'kind',''), 'support'); v_due timestamptz; v_who text; v_tries int := 0;
begin
  if v_kind not in ('support','billing','privacy','callback','sales_lead') then v_kind := 'support'; end if;
  v_due := case v_kind
    when 'privacy' then now() + interval '45 days'
    when 'callback' then now() + interval '4 hours'
    else (case extract(isodow from (now() at time zone 'America/Los_Angeles'))
            when 5 then now() + interval '3 days' when 6 then now() + interval '2 days' else now() + interval '1 day' end)
  end;
  loop
    begin
      insert into support_tickets (kind, product, name, email, phone, issue, privacy_action, conversation_id, due_at)
      values (v_kind, nullif(p->>'product',''), nullif(p->>'name',''), nullif(lower(p->>'email'),''), nullif(p->>'phone',''),
              nullif(p->>'issue',''),
              case when v_kind = 'privacy' and p->>'privacy_action' in ('delete','export','correct','opt_out') then p->>'privacy_action' end,
              nullif(p->>'conversation_id',''), v_due)
      returning * into t;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1; if v_tries > 5 then raise; end if;
    end;
  end loop;

  v_who := coalesce(t.name, t.phone, 'A caller');
  perform scout_notify(
    p_title => 'Maya: ' || case t.kind
       when 'privacy' then v_who || ' asked to ' || coalesce(t.privacy_action, 'change') || ' their data'
       when 'callback' then v_who || ' wants a call back'
       when 'sales_lead' then v_who || ' wants a Bestly Agent demo'
       when 'billing' then v_who || ' has a billing question'
       else v_who || ' needs help' || coalesce(' with ' || t.product, '') end,
    p_body => t.code || ' · ' || coalesce(t.issue, '') || coalesce(' · ' || t.email, '') || coalesce(' · ' || t.phone, '')
              || ' · Due ' || to_char(t.due_at at time zone 'America/Los_Angeles', 'Mon FMDD, FMHH12:MI AM'),
    p_severity => case when t.kind in ('privacy','callback') then 'warning' else 'info' end,
    p_push => true, p_url => '/admin/maya', p_dedupe => 'maya-ticket-' || t.code);
  return jsonb_build_object('ok', true, 'ticket', t.code, 'kind', t.kind,
    'follow_up', case t.kind when 'privacy' then 'within 45 days' when 'callback' then 'today' else 'within one business day' end);
end $function$;

update public.bestly_agents set admin_url = '/admin/maya' where slug = 'maya';
