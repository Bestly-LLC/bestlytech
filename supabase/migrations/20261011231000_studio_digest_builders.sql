-- 2026-10-11 Studio notification digests, part 2: the builders.
--   studio_digest_compose_staff(staff)   -> what tonight's digest would say (pure, no writes)
--   studio_digest_compose_client(client) -> what her morning email would say (pure, no writes)
--   studio_digest_run(kind, id, force, dry) -> claim today, compose, queue ONE notify_outbox row, close parked rows
--   studio_digest_preview(kind, id)      -> dry run (nothing sent, nothing closed)
--   studio_digest_tick()                 -> pg_cron every 15 min; sends whoever's local send time has come
--   studio_talk_rollup(dry, force)       -> pg_cron hourly; one team-room post from the parked 'review' lines
--   studio_digest_watch()                -> self-healing watchdog (re-runs once, then raises studio.digest)
-- Owner on the Team page: studio-digest (tool of Spark). Rules: ONE email per client per day and only when
-- something waits on her; ONE digest per producer per day, skipped when nothing happened; 12-hour times.

create or replace function public.studio_try_uuid(t text) returns uuid
language plpgsql immutable set search_path to 'public' as $$
begin return t::uuid; exception when others then return null; end $$;

-- a parked row's client even when client_id is null (a client's emailed idea carries only payload.asks)
create or replace function public.studio_digest_row_client(o notify_outbox) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select coalesce(o.client_id, public.notify_row_client(o),
    (select ak.client_id from public.client_asks ak
      where ak.id = public.studio_try_uuid(o.payload->'asks'->>0)));
$$;

-- ------------------------------------------------------------------ staff
create or replace function public.studio_digest_compose_staff(p_staff uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  s public.approval_staff; st public.studio_digest_settings; r record;
  n_ready int := 0; n_appr int := 0; n_chg int := 0; n_rec int := 0; n_note int := 0; n_idea int := 0; n_hand int := 0; n_oth int := 0;
  need text[] := '{}'; hap text[] := '{}'; ids uuid[] := '{}';
  v_title text; v_stage text; v_tot int; v_need int; v_counts jsonb := '[]'; v_sections jsonb := '[]';
  v_subject text; v_cl text; v_line text;
  c_cap constant int := 6;
begin
  select * into st from public.studio_digest_settings where id;
  select * into s from public.approval_staff where id = p_staff and active;
  if s.id is null or nullif(s.email, '') is null then
    return jsonb_build_object('send', false, 'why', 'no address', 'ids', '[]'::jsonb);
  end if;

  for r in
    select o.id, o.kind, o.subject, o.body, o.payload, c.name as cname, coalesce(c.sandbox, false) as sand
      from public.notify_outbox o
      left join public.approval_clients c on c.id = public.notify_row_client(o)
     where o.audience = 'staff' and o.staff_id = p_staff and o.sent_at is null
       and o.hold_until = 'infinity'::timestamptz and o.kind not in ('staff_digest', 'client_digest')
     order by o.created_at
  loop
    ids := ids || r.id;
    if r.sand then continue; end if;
    v_cl := coalesce(r.cname, r.payload->>'client', 'Studio');
    if r.kind = 'signoff_ready' then
      n_ready := n_ready + 1;
      select i.title, i.stage into v_title, v_stage from public.approval_items i
       where i.id = public.studio_try_uuid(r.payload->>'item');
      if v_stage = 'internal' then
        need := need || (v_cl || ': "' || coalesce(v_title, 'a post') || '" is signed off, not sent yet');
      else
        hap := hap || (v_cl || ': "' || coalesce(v_title, 'a post') || '" was signed off');
      end if;
    elsif r.kind = 'decision' then
      v_line := v_cl || ' - ' || regexp_replace(coalesce(r.body, ''), '^[^[:alnum:]"]+', '');
      if r.payload->>'decision' = 'changes' then n_chg := n_chg + 1; need := need || v_line;
      else n_appr := n_appr + 1; hap := hap || v_line; end if;
    elsif r.kind = 'recording' then
      n_rec := n_rec + 1;
      hap := hap || regexp_replace(coalesce(r.subject, 'A recording came in'), '^[^[:alnum:]"]+', '');
    elsif r.kind = 'member_note' then
      n_note := n_note + 1;
      hap := hap || regexp_replace(coalesce(r.subject, 'A note came in'), '^[^[:alnum:]"]+', '');
    elsif r.kind in ('ask_received', 'client_brief') then
      n_idea := n_idea + 1;
      hap := hap || regexp_replace(coalesce(r.subject, 'An idea came in'), '^[^[:alnum:]"]+', '');
    elsif r.kind = 'todo_handoff' then
      n_hand := n_hand + 1;
      need := need || regexp_replace(coalesce(r.subject, 'A job was handed back'), '^[^[:alnum:]"]+', '');
    else
      n_oth := n_oth + 1;
      hap := hap || regexp_replace(coalesce(r.subject, 'An update'), '^[^[:alnum:]"]+', '');
    end if;
  end loop;

  v_tot := n_ready + n_appr + n_chg + n_rec + n_note + n_idea + n_hand + n_oth;
  if v_tot = 0 then
    return jsonb_build_object('send', false, 'why', 'nothing happened', 'ids', to_jsonb(ids));
  end if;
  v_need := coalesce(array_length(need, 1), 0);

  if n_ready > 0 then v_counts := v_counts || jsonb_build_object('n', n_ready, 'tone', 'accent',
      'label', case when n_ready = 1 then 'post signed off, ready to send' else 'posts signed off, ready to send' end); end if;
  if n_chg > 0 then v_counts := v_counts || jsonb_build_object('n', n_chg, 'tone', 'warn',
      'label', case when n_chg = 1 then 'change asked for by a client' else 'changes asked for by clients' end); end if;
  if n_appr > 0 then v_counts := v_counts || jsonb_build_object('n', n_appr, 'tone', 'client',
      'label', case when n_appr = 1 then 'post approved by a client' else 'posts approved by clients' end); end if;
  if n_rec > 0 then v_counts := v_counts || jsonb_build_object('n', n_rec, 'tone', 'client',
      'label', case when n_rec = 1 then 'recording came in' else 'recordings came in' end); end if;
  if n_hand > 0 then v_counts := v_counts || jsonb_build_object('n', n_hand, 'tone', 'warn',
      'label', case when n_hand = 1 then 'job handed back to us' else 'jobs handed back to us' end); end if;
  if n_idea > 0 then v_counts := v_counts || jsonb_build_object('n', n_idea, 'tone', 'mute',
      'label', case when n_idea = 1 then 'idea came in' else 'ideas came in' end); end if;
  if n_note > 0 then v_counts := v_counts || jsonb_build_object('n', n_note, 'tone', 'mute',
      'label', case when n_note = 1 then 'note from a client''s team' else 'notes from a client''s team' end); end if;
  if n_oth > 0 then v_counts := v_counts || jsonb_build_object('n', n_oth, 'tone', 'mute',
      'label', case when n_oth = 1 then 'other update' else 'other updates' end); end if;

  if v_need > 0 then
    v_sections := v_sections || jsonb_build_object('title', 'Needs you',
      'lines', to_jsonb(need[1:c_cap]
        || case when v_need > c_cap then array[(v_need - c_cap) || ' more in Studio'] else '{}'::text[] end));
  end if;
  if coalesce(array_length(hap, 1), 0) > 0 then
    v_sections := v_sections || jsonb_build_object('title', 'What happened',
      'lines', to_jsonb(hap[1:c_cap]
        || case when array_length(hap, 1) > c_cap then array[(array_length(hap, 1) - c_cap) || ' more in Studio'] else '{}'::text[] end));
  end if;

  v_subject := 'Studio today: ' || case
    when v_need > 0 then v_need || case when v_need = 1 then ' needs' else ' need' end || ' you, ' || v_tot || ' in all'
    else v_tot || case when v_tot = 1 then ' update' else ' updates' end || ', nothing needs you' end;

  return jsonb_build_object('send', true, 'ids', to_jsonb(ids), 'to', s.email, 'who', s.name,
    'subject', v_subject,
    'body', 'Your day in Studio, ' || to_char(now() at time zone st.staff_tz, 'FMDay, FMMonth FMDD') || '.',
    'link', 'https://studio.bestly.tech/',
    'total', v_tot, 'needs', v_need,
    'payload', jsonb_build_object('digest', true, 'staff', p_staff, 'counts', v_counts, 'sections', v_sections));
end $$;

-- ------------------------------------------------------------------ client
create or replace function public.studio_digest_compose_client(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  c public.approval_clients; r record; v_link text;
  n_posts int := 0; ask_titles text[] := '{}'; ask_ids uuid[] := '{}'; todo_titles text[] := '{}';
  n_asks int; n_todos int; v_wait int; ids uuid[] := '{}'; keep_ids uuid[] := '{}';
  n_receipt int := 0; v_receipt text; has_new boolean := false; tasks jsonb := '[]'; v_intro text; v_subject text; v_line text;
begin
  select * into c from public.approval_clients where id = p_client and active;
  if c.id is null or coalesce(c.sandbox, false) or not coalesce(c.notify_email, false) or nullif(c.contact_email, '') is null then
    -- opted out, a sandbox, or no address: nothing is ever emailed; close whatever was parked
    return jsonb_build_object('send', false, 'why', 'no email for this client', 'ids',
      coalesce((select to_jsonb(array_agg(o.id)) from public.notify_outbox o
                 where o.audience = 'client' and o.sent_at is null and o.hold_until = 'infinity'::timestamptz
                   and public.studio_digest_row_client(o) = p_client), '[]'::jsonb));
  end if;
  v_link := coalesce(public.client_board_link(c.id), 'https://studio.bestly.tech/' || c.slug);

  select count(*) into n_posts from public.approval_items where client_id = c.id and stage = 'client' and status = 'pending';
  select coalesce(array_agg(coalesce(nullif(trim(a.title), ''), 'A recording') order by a.created_at), '{}'), coalesce(array_agg(a.id), '{}')
    into ask_titles, ask_ids from public.client_asks a where a.client_id = c.id and a.status = 'open';
  select coalesce(array_agg(t.title order by t.position, t.created_at), '{}')
    into todo_titles from public.client_todos t where t.client_id = c.id and t.status = 'open';
  n_asks := coalesce(array_length(ask_titles, 1), 0);
  n_todos := coalesce(array_length(todo_titles, 1), 0);
  v_wait := n_posts + n_asks + n_todos;

  for r in
    select o.id, o.kind, o.body, o.payload, o.created_at
      from public.notify_outbox o
     where o.audience = 'client' and o.sent_at is null and o.hold_until = 'infinity'::timestamptz
       and o.kind not in ('staff_digest', 'client_digest') and public.studio_digest_row_client(o) = c.id
     order by o.created_at
  loop
    ids := ids || r.id;
    if r.kind = 'ask_received' then
      if r.created_at > now() - interval '3 days' then
        n_receipt := n_receipt + 1; v_receipt := r.body; keep_ids := keep_ids || r.id;
      end if;
    elsif r.kind = 'client_posts' and n_posts > 0 then has_new := true;
    elsif r.kind = 'client_ask' and (public.studio_try_uuid(r.payload->>'ask') = any(ask_ids)) then has_new := true;
    end if;
  end loop;
  if n_receipt > 0 then has_new := true; end if;

  if v_wait = 0 then
    return jsonb_build_object('send', false, 'why', 'nothing is waiting on her', 'ids', to_jsonb(ids),
      'keep_ids', to_jsonb(keep_ids), 'waiting', 0);
  end if;

  if n_posts > 0 then
    tasks := tasks || jsonb_build_object(
      'title', case when n_posts = 1 then '1 post is waiting for you' else n_posts || ' posts are waiting for you' end,
      'line', 'Say yes, or ask for a change. It takes about a minute.',
      'href', v_link, 'label', case when n_posts = 1 then 'Look at my post' else 'Look at my posts' end);
  end if;
  if n_asks > 0 then
    v_line := (select string_agg(chr(8220) || t || chr(8221), ', ') from unnest(ask_titles[1:3]) t)
              || case when n_asks > 3 then ', and ' || (n_asks - 3) || ' more' else '' end;
    tasks := tasks || jsonb_build_object(
      'title', case when n_asks = 1 then '1 recording is waiting for you' else n_asks || ' recordings are waiting for you' end,
      'line', v_line, 'href', v_link, 'label', 'Record it now');
  end if;
  if n_todos > 0 then
    v_line := (select string_agg(chr(8220) || t || chr(8221), ', ') from unnest(todo_titles[1:3]) t)
              || case when n_todos > 3 then ', and ' || (n_todos - 3) || ' more' else '' end;
    tasks := tasks || jsonb_build_object(
      'title', case when n_todos = 1 then '1 thing on your list' else n_todos || ' things on your list' end,
      'line', v_line, 'href', v_link, 'label', 'See my list');
  end if;

  v_intro := case
    when n_receipt = 1 then coalesce(nullif(trim(v_receipt), ''), 'We got your idea.') || ' Here is what is waiting for you.'
    when n_receipt > 1 then 'We got your ideas. We will turn them into things you can film, and they will show up on your board. Here is what is waiting for you.'
    else 'Here is what is waiting for you.' end;
  v_subject := case when v_wait = 1 then 'One thing is waiting for you' else v_wait || ' things are waiting for you' end;

  return jsonb_build_object('send', true, 'ids', to_jsonb(ids), 'keep_ids', '[]'::jsonb, 'to', c.contact_email,
    'who', c.name, 'subject', v_subject, 'body', v_intro, 'link', v_link, 'waiting', v_wait, 'has_new', has_new,
    'payload', jsonb_build_object('digest', true, 'client', c.id, 'tasks', tasks,
      'note', 'You get one short email a day, and only when something is waiting on you. Reply to this email if you would rather not get it.'));
end $$;

-- ------------------------------------------------------------------ run one digest
create or replace function public.studio_digest_run(p_kind text, p_id uuid, p_force boolean default false, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  st public.studio_digest_settings; v_tz text; v_day date; comp jsonb; lg public.studio_digest_log; v_out uuid;
  v_last timestamptz; v_ids uuid[]; v_keep uuid[]; v_staff boolean := (p_kind = 'staff'); v_why text;
begin
  if p_kind not in ('staff', 'client') then raise exception 'kind must be staff or client'; end if;
  select * into st from public.studio_digest_settings where id;
  if not st.enabled and not p_dry then return jsonb_build_object('ok', true, 'skipped', 'digests are switched off'); end if;

  if v_staff then v_tz := st.staff_tz;
  else select coalesce(tz, st.client_default_tz) into v_tz from public.approval_clients where id = p_id; end if;
  v_tz := coalesce(v_tz, st.client_default_tz);
  v_day := (now() at time zone v_tz)::date;

  comp := case when v_staff then public.studio_digest_compose_staff(p_id) else public.studio_digest_compose_client(p_id) end;

  -- a client who is still waiting but has no news hears from us only every client_repeat_days
  if not v_staff and (comp->>'send')::boolean and not coalesce((comp->>'has_new')::boolean, false) then
    select max(coalesce(sent_at, created_at)) into v_last from public.studio_digest_log
     where kind = 'client' and subject_id = p_id and status in ('sent', 'baseline');
    if v_last is not null and v_last > now() - (st.client_repeat_days * interval '1 day' - interval '4 hours') then
      comp := comp || jsonb_build_object('send', false, 'why', 'nothing new; reminded recently');
    end if;
  end if;

  if p_dry then
    return comp || jsonb_build_object('dry', true, 'day', v_day, 'tz', v_tz, 'would_send', (comp->>'send')::boolean);
  end if;

  select * into lg from public.studio_digest_log where kind = p_kind and subject_id = p_id and day = v_day;
  if found and lg.status in ('sent', 'skipped', 'baseline') then
    return jsonb_build_object('ok', true, 'already', lg.status, 'day', v_day);
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(comp->'ids', '[]'::jsonb)) x;
  select coalesce(array_agg(x::uuid), '{}') into v_keep from jsonb_array_elements_text(coalesce(comp->'keep_ids', '[]'::jsonb)) x;

  begin
    if not (comp->>'send')::boolean then
      v_why := coalesce(comp->>'why', 'nothing to say');
      update public.notify_outbox set sent_at = now(), error = 'digest: ' || v_why
       where id = any(v_ids) and not (id = any(v_keep)) and sent_at is null;
      insert into public.studio_digest_log (kind, subject_id, day, status, detail, held)
      values (p_kind, p_id, v_day, 'skipped', v_why, coalesce(array_length(v_ids, 1), 0))
      on conflict (kind, subject_id, day) do update set status = 'skipped', detail = excluded.detail, held = excluded.held;
      return jsonb_build_object('ok', true, 'sent', false, 'why', v_why, 'day', v_day);
    end if;

    insert into public.notify_outbox (kind, audience, staff_id, client_id, to_email, subject, body, link, dedupe, payload)
    values (case when v_staff then 'staff_digest' else 'client_digest' end,
            case when v_staff then 'staff' else 'client' end,
            null, case when v_staff then null else p_id end,
            comp->>'to', comp->>'subject', comp->>'body', comp->>'link',
            (case when v_staff then 'sdigest:' else 'cdigest:' end) || p_id::text || ':' || v_day::text,
            comp->'payload')
    returning id into v_out;

    update public.notify_outbox set sent_at = now(), error = 'in the daily digest ' || v_out::text
     where id = any(v_ids) and sent_at is null;
    insert into public.studio_digest_log (kind, subject_id, day, status, detail, held, outbox_id, sent_at)
    values (p_kind, p_id, v_day, 'sent', comp->>'subject', coalesce(array_length(v_ids, 1), 0), v_out, now())
    on conflict (kind, subject_id, day) do update
      set status = 'sent', detail = excluded.detail, held = excluded.held, outbox_id = excluded.outbox_id, sent_at = now();
    return jsonb_build_object('ok', true, 'sent', true, 'outbox', v_out, 'subject', comp->>'subject', 'day', v_day);
  exception when others then
    insert into public.studio_digest_log (kind, subject_id, day, status, detail, retries)
    values (p_kind, p_id, v_day, 'error', left(sqlerrm, 300), 1)
    on conflict (kind, subject_id, day) do update
      set status = 'error', detail = excluded.detail, retries = public.studio_digest_log.retries + 1;
    return jsonb_build_object('ok', false, 'error', left(sqlerrm, 300));
  end;
end $$;

create or replace function public.studio_digest_preview(p_kind text, p_id uuid) returns jsonb
language sql security definer set search_path to 'public' as $$
  select public.studio_digest_run(p_kind, p_id, false, true);
$$;

-- ------------------------------------------------------------------ the tick
create or replace function public.studio_digest_tick() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  st public.studio_digest_settings; r record; v_loc timestamp; v_tz text; v_day date; v_ran int := 0; v_res jsonb;
begin
  select * into st from public.studio_digest_settings where id;
  if not st.enabled then return jsonb_build_object('ok', true, 'off', true); end if;

  -- producers, around 6:45 PM Pacific
  v_loc := now() at time zone st.staff_tz;
  if v_loc::time >= st.staff_time and v_loc::time < st.staff_time + interval '4 hours' then
    for r in select s.id from public.approval_staff s
              where s.active and nullif(s.email, '') is not null and not coalesce(s.is_system, false)
                and not exists (select 1 from public.studio_digest_log l
                                 where l.kind = 'staff' and l.subject_id = s.id and l.day = v_loc::date
                                   and l.status in ('sent', 'skipped', 'baseline'))
    loop
      v_res := public.studio_digest_run('staff', r.id); v_ran := v_ran + 1;
    end loop;
  end if;

  -- clients, around 8:45 AM in their own day
  for r in select c.id, coalesce(c.tz, st.client_default_tz) as tz from public.approval_clients c
            where c.active and c.kind = 'client' and not coalesce(c.sandbox, false)
              and coalesce(c.notify_email, false) and nullif(c.contact_email, '') is not null
  loop
    v_loc := now() at time zone r.tz;
    continue when not (v_loc::time >= st.client_time and v_loc::time < st.client_time + make_interval(hours => st.client_window_hours));
    continue when exists (select 1 from public.studio_digest_log l
                           where l.kind = 'client' and l.subject_id = r.id and l.day = v_loc::date
                             and l.status in ('sent', 'skipped', 'baseline'));
    v_res := public.studio_digest_run('client', r.id); v_ran := v_ran + 1;
  end loop;
  return jsonb_build_object('ok', true, 'ran', v_ran);
end $$;

-- ------------------------------------------------------------------ Talk roll-up
-- the parked team-room lines, classified (by the emoji each trigger leads with) and tied to a client
create or replace function public.studio_talk_rollup_rows()
returns table(id uuid, line text, created_at timestamptz, cls text, client text)
language sql stable security definer set search_path to 'public' as $f$
  select t.id, t.line, t.created_at,
         case when t.line like '🚨%' then 'alert' when t.line like '↻%' then 'recut' when t.line like '🆕%' then 'new'
              when t.line like '✅%' then 'signed' when t.line like '📤%' then 'sent' when t.line like '☑️%' then 'ticked'
              when t.line like '💡%' then 'idea' when t.line like '📥%' then 'idea' when t.line like '💬%' then 'comment'
              else 'other' end,
         coalesce(
           (select c.name from public.approval_items i join public.approval_clients c on c.id = i.client_id
             where i.id = public.studio_try_uuid(t.payload->>'item')),
           (select c.name from public.client_asks a join public.approval_clients c on c.id = a.client_id
             where a.id = public.studio_try_uuid(t.payload->>'ask')),
           (select c.name from public.client_todos td join public.approval_clients c on c.id = td.client_id
             where td.id = public.studio_try_uuid(t.payload->>'todo')),
           (select c.name from public.client_asks a join public.approval_clients c on c.id = a.client_id
             where a.id = public.studio_try_uuid(t.payload->'asks'->>0)),
           'Studio')
    from public.talk_outbox t
   where t.sent_at is null and t.kind = 'review' and t.audience = 'team'
     and coalesce(t.payload, '{}'::jsonb) ? 'rollup' and not (coalesce(t.payload, '{}'::jsonb) ? 'rollup_post');
$f$;

create or replace function public.studio_talk_rollup(p_dry boolean default false, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  st public.studio_digest_settings; v_h int; v_n int; v_since text; v_line text; v_perclient text; v_look text; v_ids uuid[];
begin
  select * into st from public.studio_digest_settings where id;
  v_h := extract(hour from now() at time zone st.staff_tz);
  if not p_dry and not p_force and (v_h < st.talk_from_hour or v_h >= st.talk_to_hour) then
    return jsonb_build_object('ok', true, 'skipped', 'quiet hours');
  end if;

  select count(*), array_agg(id), to_char(min(created_at) at time zone st.staff_tz, 'FMHH12:MI AM')
    into v_n, v_ids, v_since from public.studio_talk_rollup_rows();
  if v_n = 0 then return jsonb_build_object('ok', true, 'rows', 0); end if;

  -- counts per client, in a fixed order
  select string_agg('- ' || x.client || ': ' || x.what, E'\n' order by x.client) into v_perclient from (
    select client, string_agg(n || ' ' || label, ', ' order by ord) as what from (
      select client, cls, count(*) n,
             case cls when 'recut' then 're-cut' when 'new' then 'new in Drafts' when 'signed' then 'signed off'
                      when 'sent' then 'sent to the board' when 'ticked' then 'ticked off'
                      when 'idea' then case when count(*) = 1 then 'idea in' else 'ideas in' end
                      when 'comment' then case when count(*) = 1 then 'comment' else 'comments' end
                      when 'alert' then case when count(*) = 1 then 'alert' else 'alerts' end else 'other' end as label,
             case cls when 'alert' then 0 when 'signed' then 1 when 'sent' then 2 when 'idea' then 3 when 'comment' then 4
                      when 'ticked' then 5 when 'new' then 6 when 'recut' then 7 else 8 end as ord
        from public.studio_talk_rollup_rows() group by client, cls) g
     group by client) x;

  -- the few lines worth reading: one alert (with how many), then client activity, newest first
  select string_agg('- ' || z.l, E'\n' order by z.pri, z.created_at desc) into v_look from (
    select * from (
      select 0 as pri, max(created_at) as created_at,
             split_part((array_agg(line order by created_at desc))[1], E'\n', 1)
               || case when count(*) > 1 then ' (x' || count(*) || ')' else '' end as l
        from public.studio_talk_rollup_rows() where cls = 'alert' having count(*) > 0
      union all
      (select 1, created_at,
             case when length(split_part(line, E'\n', 1)) > 110
                  then regexp_replace(split_part(line, E'\n', 1), ':\s*["“].*$', '')
                  else split_part(line, E'\n', 1) end
        from public.studio_talk_rollup_rows() where cls in ('idea', 'comment', 'ticked') order by created_at desc limit 3)
    ) q order by pri, created_at desc limit 4) z;

  v_line := '**Studio, since ' || v_since || '** - ' || v_n || case when v_n = 1 then ' update' else ' updates' end
            || E'\n' || v_perclient
            || case when v_look is not null then E'\nWorth a look:\n' || v_look else '' end;

  if p_dry then return jsonb_build_object('ok', true, 'dry', true, 'rows', v_n, 'line', v_line); end if;

  insert into public.talk_outbox (kind, dedupe, line, many, payload, audience)
  values ('review', null, v_line, null, jsonb_build_object('rollup_post', true, 'rows', v_n), 'team');
  update public.talk_outbox set sent_at = now(), error = 'rolled up' where id = any(v_ids) and sent_at is null;
  return jsonb_build_object('ok', true, 'rows', v_n, 'posted', true);
end $$;

-- ------------------------------------------------------------------ self-healing watchdog
create or replace function public.studio_digest_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  st public.studio_digest_settings; r record; v_loc timestamp; v_probs text[] := '{}'; v_res jsonb; v_healed int := 0; v_old int; v_unsent int;
begin
  select * into st from public.studio_digest_settings where id;
  if not st.enabled then
    perform public.bestly_raise('studio.digest', 'resolved', 'info', null);
    return jsonb_build_object('ok', true, 'off', true);
  end if;

  -- 1. a producer's digest that should have gone an hour ago and has not: re-run once
  v_loc := now() at time zone st.staff_tz;
  if v_loc::time >= st.staff_time + interval '1 hour' and v_loc::time < st.staff_time + interval '5 hours' then
    for r in select s.id, s.name from public.approval_staff s
              where s.active and nullif(s.email, '') is not null and not coalesce(s.is_system, false)
                and not exists (select 1 from public.studio_digest_log l
                                 where l.kind = 'staff' and l.subject_id = s.id and l.day = v_loc::date
                                   and l.status in ('sent', 'skipped', 'baseline'))
    loop
      v_res := public.studio_digest_run('staff', r.id, true);
      if coalesce((v_res->>'ok')::boolean, false) then v_healed := v_healed + 1;
      else v_probs := v_probs || ('The daily digest for ' || r.name || ' did not go out and a re-run failed: ' || coalesce(v_res->>'error', '?')); end if;
    end loop;
  end if;

  -- 2. a client's morning email, same rule, an hour after it was due
  for r in select c.id, c.name, coalesce(c.tz, st.client_default_tz) as tz from public.approval_clients c
            where c.active and c.kind = 'client' and not coalesce(c.sandbox, false)
              and coalesce(c.notify_email, false) and nullif(c.contact_email, '') is not null
  loop
    v_loc := now() at time zone r.tz;
    continue when not (v_loc::time >= st.client_time + interval '1 hour'
                       and v_loc::time < st.client_time + make_interval(hours => st.client_window_hours));
    continue when exists (select 1 from public.studio_digest_log l
                           where l.kind = 'client' and l.subject_id = r.id and l.day = v_loc::date
                             and l.status in ('sent', 'skipped', 'baseline'));
    v_res := public.studio_digest_run('client', r.id, true);
    if coalesce((v_res->>'ok')::boolean, false) then v_healed := v_healed + 1;
    else v_probs := v_probs || ('The daily email for ' || r.name || ' did not go out and a re-run failed: ' || coalesce(v_res->>'error', '?')); end if;
  end loop;

  -- 3. a digest that was queued but never delivered (the drain or Resend)
  select count(*) into v_unsent from public.notify_outbox
   where kind in ('staff_digest', 'client_digest') and sent_at is null and created_at < now() - interval '30 minutes';
  if v_unsent > 0 then
    update public.notify_outbox set attempts = 0
     where kind in ('staff_digest', 'client_digest') and sent_at is null and created_at < now() - interval '30 minutes' and attempts >= 5;
    v_probs := v_probs || (v_unsent || ' digest email(s) are queued but not delivered after 30 minutes. Check studio-notify and Resend: '
      || coalesce((select error from public.notify_outbox where kind in ('staff_digest', 'client_digest') and sent_at is null
                    order by created_at limit 1), 'no error recorded'));
  end if;

  -- 4. parked per-item rows that never got folded into anything (older than 4 days)
  select count(*) into v_old from public.notify_outbox
   where sent_at is null and hold_until = 'infinity'::timestamptz and created_at < now() - interval '4 days';
  if v_old > 0 then
    v_probs := v_probs || (v_old || ' parked notification(s) are over 4 days old and were not folded into a digest.');
  end if;

  -- 5. Talk roll-up: parked lines over 3 hours old inside posting hours -> post now, once
  if exists (select 1 from public.talk_outbox t where t.sent_at is null and t.payload ? 'rollup' and t.created_at < now() - interval '3 hours') then
    v_res := public.studio_talk_rollup(false, false);
    if exists (select 1 from public.talk_outbox t where t.sent_at is null and t.payload ? 'rollup' and t.created_at < now() - interval '5 hours'
                  and extract(hour from now() at time zone st.staff_tz) between st.talk_from_hour + 1 and st.talk_to_hour - 1) then
      v_probs := v_probs || 'The hourly Talk roll-up has lines waiting over 5 hours and re-posting did not clear them.';
    end if;
  end if;

  if array_length(v_probs, 1) > 0 then
    perform public.bestly_raise('studio.digest', 'problem', 'warning', 'Studio digests need a look',
      array_to_string(v_probs, E'\n'), 'studio', null, false);
  else
    perform public.bestly_raise('studio.digest', 'resolved', 'info', 'Studio digests are healthy', null, 'studio');
  end if;
  return jsonb_build_object('ok', true, 'healed', v_healed, 'problems', to_jsonb(v_probs));
end $$;

revoke all on function public.studio_try_uuid(text) from public, anon, authenticated;
revoke all on function public.studio_digest_row_client(notify_outbox) from public, anon, authenticated;
revoke all on function public.studio_digest_compose_staff(uuid) from public, anon, authenticated;
revoke all on function public.studio_digest_compose_client(uuid) from public, anon, authenticated;
revoke all on function public.studio_digest_run(text, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.studio_digest_preview(text, uuid) from public, anon, authenticated;
revoke all on function public.studio_digest_tick() from public, anon, authenticated;
revoke all on function public.studio_talk_rollup(boolean, boolean) from public, anon, authenticated;
revoke all on function public.studio_talk_rollup_rows() from public, anon, authenticated;
revoke all on function public.studio_digest_watch() from public, anon, authenticated;
grant execute on function public.studio_digest_run(text, uuid, boolean, boolean) to service_role;
grant execute on function public.studio_digest_preview(text, uuid) to service_role;
grant execute on function public.studio_digest_tick() to service_role;
grant execute on function public.studio_talk_rollup(boolean, boolean) to service_role;
grant execute on function public.studio_digest_watch() to service_role;

-- NOTE: applied to production in three pieces (compose / run+tick / rollup+watch) plus a small label tweak to
-- studio_talk_rollup, because apply_migration can cancel long statements; this file is the whole, final text.
