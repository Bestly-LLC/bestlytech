-- Leo on the Turo trip pages: voice sessions bound to a trip, Leo's own tickets, and per-agent ticket views.
-- Plan: docs/leo-opusplan.md. Additive only.

-- 1. A voice session on a trip page. The page trades its trip token for a short-lived opaque key; only the key
--    goes to the voice platform (as a dynamic variable), so trip tokens never land in call transcripts or logs.
--    The first tool call binds the key to its conversation; after that the key works for that conversation only.
create table if not exists public.trip_voice_sessions (
  key text primary key,
  agent_slug text not null default 'leo',
  token text not null,
  conversation_id text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '45 minutes'
);
create index if not exists trip_voice_sessions_token_idx on public.trip_voice_sessions (token, created_at desc);
alter table public.trip_voice_sessions enable row level security;
revoke all on public.trip_voice_sessions from anon, authenticated;

-- 2. Leo's tickets: same table as Maya's, tagged source 'agent:leo' so each desk shows only its own.
create or replace function public.leo_file_ticket(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t support_tickets; v_kind text := coalesce(nullif(p->>'kind',''), 'support'); v_due timestamptz; v_who text; v_tries int := 0;
begin
  if v_kind not in ('support','callback') then v_kind := 'support'; end if;
  v_due := case v_kind when 'callback' then now() + interval '2 hours' else now() + interval '12 hours' end;
  loop
    begin
      insert into support_tickets (source, kind, product, name, email, phone, issue, conversation_id, due_at)
      values ('agent:leo', v_kind, 'Turo', nullif(p->>'name',''), nullif(lower(p->>'email'),''), nullif(p->>'phone',''),
              nullif(left(p->>'issue', 1000),''), nullif(p->>'conversation_id',''), v_due)
      returning * into t;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1; if v_tries > 5 then raise; end if;
    end;
  end loop;
  v_who := coalesce(t.name, t.phone, 'A guest');
  -- A guest waiting on Jared is one of the 4 kinds of news that reach him.
  perform scout_notify(
    p_title => 'Leo: ' || v_who || case t.kind when 'callback' then ' wants a call back' else ' needs help with their trip' end,
    p_body => t.code || ' · ' || coalesce(t.issue, '') || coalesce(' · ' || t.phone, '')
              || ' · Due ' || to_char(t.due_at at time zone 'America/Los_Angeles', 'Mon FMDD, FMHH12:MI AM'),
    p_severity => 'warning', p_push => true, p_url => '/admin/agents/leo', p_dedupe => 'leo-ticket-' || t.code);
  return jsonb_build_object('ok', true, 'ticket', t.code, 'kind', t.kind,
    'follow_up', case t.kind when 'callback' then 'within about 2 hours' else 'today' end);
end $$;
revoke all on function public.leo_file_ticket(jsonb) from public, anon, authenticated;

-- 3. Maya's desk keeps showing only Maya's tickets (template agents file with source 'agent:<slug>').
create or replace function public.admin_maya_tickets(p_view text default 'open') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) into v from (
    select s.*, (s.status = 'open' and s.due_at < now()) as overdue,
           (extract(epoch from (s.due_at - now())) / 60)::int as due_in_minutes,
           row_number() over (order by
             case p_view when 'open' then extract(epoch from s.due_at) when 'leads' then -extract(epoch from s.created_at) when 'done' then -extract(epoch from coalesce(s.resolved_at, s.created_at)) else -extract(epoch from s.created_at) end) as ord
    from support_tickets s
    where coalesce(s.source, '') not like 'agent:%'
      and case p_view
      when 'open' then s.status = 'open' and s.kind <> 'sales_lead'
      when 'leads' then s.status = 'open' and s.kind = 'sales_lead'
      when 'done' then s.status in ('done','spam')
      else true end
    order by ord
    limit case p_view when 'done' then 100 when 'all' then 200 else 500 end
  ) x;
  return v;
end $$;

create or replace function public.admin_maya_counts() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select jsonb_build_object(
    'open', count(*) filter (where status = 'open' and kind <> 'sales_lead'),
    'overdue', count(*) filter (where status = 'open' and kind <> 'sales_lead' and due_at < now()),
    'leads', count(*) filter (where status = 'open' and kind = 'sales_lead'),
    'privacy_open', count(*) filter (where status = 'open' and kind = 'privacy'))
    from support_tickets where coalesce(source, '') not like 'agent:%');
end $$;

-- 4. Per-agent ticket views for template agents (Leo today).
create or replace function public.admin_agent_tickets(p_slug text, p_view text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.ord), '[]'::jsonb) into v from (
    select s.*, (s.status = 'open' and s.due_at < now()) as overdue,
           (extract(epoch from (s.due_at - now())) / 60)::int as due_in_minutes,
           row_number() over (order by case p_view when 'open' then extract(epoch from s.due_at)
             else -extract(epoch from coalesce(s.resolved_at, s.created_at)) end) as ord
    from support_tickets s
    where s.source = 'agent:' || p_slug
      and case p_view when 'open' then s.status = 'open' when 'done' then s.status in ('done','spam') else true end
    order by ord
    limit case p_view when 'done' then 100 else 500 end
  ) x;
  return v;
end $$;

create or replace function public.admin_agent_ticket_counts(p_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return (select jsonb_build_object(
    'open', count(*) filter (where status = 'open'),
    'overdue', count(*) filter (where status = 'open' and due_at < now()),
    'leads', 0, 'privacy_open', 0)
    from support_tickets where source = 'agent:' || p_slug);
end $$;

revoke all on function public.admin_maya_tickets(text) from public, anon;
revoke all on function public.admin_maya_counts() from public, anon;
revoke all on function public.admin_agent_tickets(text, text) from public, anon;
revoke all on function public.admin_agent_ticket_counts(text) from public, anon;
grant execute on function public.admin_maya_tickets(text) to authenticated;
grant execute on function public.admin_maya_counts() to authenticated;
grant execute on function public.admin_agent_tickets(text, text) to authenticated;
grant execute on function public.admin_agent_ticket_counts(text) to authenticated;
