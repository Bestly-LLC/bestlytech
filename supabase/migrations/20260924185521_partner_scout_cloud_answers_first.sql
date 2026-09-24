-- The Mac mini's worker.py polls partner_ai_claim() every 2 seconds, so it always beat the cloud to
-- a new question and answered it on qwen3:8b alone. That is still free, but it is not the same free
-- ladder the admin Scout uses, and it dies whenever the Mac sleeps.
--
-- So: the cloud answers Eli's questions through _shared/free-llm.ts (groq -> Cloudflare -> local),
-- and the Mac stops claiming partner questions directly. It has not been cut out -- it is the
-- ladder's third rung, reached through fix_ai_jobs, which its worker still claims. Nothing on the
-- Mac needs changing, and partner_ai_status.cloud_answers turns it all back if this ever misbehaves.

alter table public.partner_ai_status
  add column if not exists cloud_answers boolean not null default true;

comment on column public.partner_ai_status.cloud_answers is
  'true: the partner-ai edge function answers /partner Scout on the free-LLM ladder and the Mac worker only serves the local rung via fix_ai_jobs. false: the Mac worker claims partner questions directly, as it did before 2026-09-24.';

-- The claim itself, with no key check and no heartbeat, so both callers share one implementation.
create or replace function public.partner_ai_claim_core()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare q public.partner_chat; a_id uuid; who text; nm text; is_admin boolean;
begin
  update public.partner_chat set status = 'pending', updated_at = now()
   where role = 'user' and status = 'working' and updated_at < now() - interval '4 minutes';
  update public.partner_chat set status = 'error', content = coalesce(nullif(content, ''), 'Interrupted. Ask again.'), updated_at = now()
   where role = 'assistant' and status = 'working' and updated_at < now() - interval '4 minutes';

  select * into q from public.partner_chat where role = 'user' and status = 'pending'
   order by created_at limit 1 for update skip locked;
  if q.id is null then return null; end if;
  update public.partner_chat set status = 'working', updated_at = now() where id = q.id;
  insert into public.partner_chat (user_id, role, content, status, reply_to, thread_id)
    values (q.user_id, 'assistant', '', 'working', q.id, q.thread_id) returning id into a_id;

  select roster_name, name into who, nm from public.partners where user_id = q.user_id;
  is_admin := public.has_role(q.user_id, 'admin');
  return jsonb_build_object(
    'question_id', q.id, 'reply_id', a_id, 'question', q.content,
    'name', coalesce(nm, case when is_admin then 'Jared' else 'Partner' end),
    'history', coalesce((select jsonb_agg(jsonb_build_object('role', h.role, 'content', h.content) order by h.created_at)
       from (select role, content, created_at from public.partner_chat
              where user_id = q.user_id and thread_id is not distinct from q.thread_id
                and status = 'done' and id <> q.id and content <> ''
              order by created_at desc limit 16) h), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('date', m.started_at, 'title', m.name,
        'people', m.people, 'summary', m.summary) order by m.started_at desc)
       from (select * from public.meeting_recordings
              where (is_admin and who is null) or who = any (people)
              order by started_at desc nulls last limit 8) m), '[]'::jsonb),
    'todos', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'owner', s.action->>'owner',
        'due', s.action->>'due', 'status', s.status))
       from (select * from public.scout_daily s where kind = 'call' and status = 'open'
               and exists (select 1 from public.meeting_recordings m where m.id::text = s.action->>'meeting_id'
                           and ((is_admin and who is null) or who = any (m.people)))
             order by created_at desc limit 25) s), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('date', e.sent_at, 'subject', e.subject, 'text', left(e.body_text, 600),
        'files', (select jsonb_agg(a->>'name') from jsonb_array_elements(e.attachments) a)) order by e.sent_at desc)
       from (select * from public.partner_mail where roster = coalesce(who, roster) order by sent_at desc nulls last limit 8) e), '[]'::jsonb),
    'pipeline', jsonb_build_object(
      'deals', coalesce((select jsonb_agg(jsonb_build_object('company', company_name, 'stage', current_stage))
         from public.cloud_deals where current_stage between 3 and 8), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('company', coalesce(nullif(company_name, ''), 'Unnamed'), 'size', user_count_band))
         from public.cloud_leads where coalesce(status, 'new') not in ('lost', 'won', 'closed', 'spam', 'converted', 'archived')), '[]'::jsonb))
  );
end $$;

-- The Mac worker's entry point: it still heartbeats (the ladder's local rung reads seen_at to know
-- the Mac is up) and still rescues stale rows, but it hands back nothing while the cloud is on.
create or replace function public.partner_ai_claim(p_key text, p_model text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_cloud boolean;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update public.partner_ai_status set seen_at = now(), model = coalesce(p_model, model)
   where id = 1 and (seen_at is null or seen_at < now() - interval '15 seconds' or model is distinct from coalesce(p_model, model));
  select cloud_answers into v_cloud from public.partner_ai_status where id = 1;
  if coalesce(v_cloud, true) then
    update public.partner_chat set status = 'pending', updated_at = now()
     where role = 'user' and status = 'working' and updated_at < now() - interval '4 minutes';
    update public.partner_chat set status = 'error', content = coalesce(nullif(content, ''), 'Interrupted. Ask again.'), updated_at = now()
     where role = 'assistant' and status = 'working' and updated_at < now() - interval '4 minutes';
    return null;
  end if;
  return public.partner_ai_claim_core();
end $$;

-- The cloud answerer. No key, no heartbeat: it is not the Mac and must never look like it.
create or replace function public.partner_ai_claim_cloud()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
begin
  return public.partner_ai_claim_core();
end $$;

revoke all on function public.partner_ai_claim_core() from public, anon, authenticated;
revoke all on function public.partner_ai_claim_cloud() from public, anon, authenticated;
grant execute on function public.partner_ai_claim_core() to service_role;
grant execute on function public.partner_ai_claim_cloud() to service_role;
