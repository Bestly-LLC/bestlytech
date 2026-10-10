-- Maya support desk. DOCUMENTS state that was applied live through MCP on 2026-10-10. Do not re-apply.
-- (Every statement is idempotent anyway, so a re-run on a fresh database is safe.)

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('M-' || lpad((floor(random() * 9000) + 1000)::integer::text, 4, '0')),
  created_at timestamptz not null default now(),
  source text not null default 'maya-phone',
  kind text not null check (kind in ('support','billing','privacy','callback','sales_lead')),
  product text,
  name text,
  email text,
  phone text,
  issue text,
  privacy_action text check (privacy_action in ('delete','export','correct','opt_out')),
  conversation_id text,
  status text not null default 'open' check (status in ('open','done','spam')),
  due_at timestamptz not null,
  resolved_at timestamptz,
  note text
);

create index if not exists support_tickets_open_idx on public.support_tickets (status, due_at);

alter table public.support_tickets enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'support_tickets' and policyname = 'support_tickets_admin') then
    create policy support_tickets_admin on public.support_tickets for all using (team_is_admin()) with check (team_is_admin());
  end if;
end $$;

-- ava_line_health.source allows 'maya' (already live: CHECK (source = any (array['ava','roofguard','maya']))).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ava_line_health_source_check' and conrelid = 'public.ava_line_health'::regclass) then
    alter table public.ava_line_health add constraint ava_line_health_source_check check (source = any (array['ava'::text, 'roofguard'::text, 'maya'::text]));
  end if;
end $$;

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
    p_push => true, p_url => '/admin/team', p_dedupe => 'maya-ticket-' || t.code);
  return jsonb_build_object('ok', true, 'ticket', t.code, 'kind', t.kind,
    'follow_up', case t.kind when 'privacy' then 'within 45 days' when 'callback' then 'today' else 'within one business day' end);
end $function$;

revoke all on function public.maya_file_ticket(jsonb) from public, anon, authenticated;

-- Alert prefixes Maya owns.
insert into public.notification_owners (prefix, agent_slug, note)
select 'maya', 'maya', 'onboarding protocol'
where not exists (select 1 from public.notification_owners where prefix = 'maya');
insert into public.notification_owners (prefix, agent_slug, note)
select 'maya-ticket', 'maya', 'Maya support desk'
where not exists (select 1 from public.notification_owners where prefix = 'maya-ticket');

-- maya-watch every 10 minutes.
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'maya-watch') then
    perform cron.schedule('maya-watch', '6-59/10 * * * *', $c$select public.invoke_edge_function('maya-watch', '{}'::jsonb, 60000)$c$);
  end if;
end $$;
