-- 2026-10-11 Studio: email to studio@ lands as a DRAFT, one tap sends it to the client's board.
-- Part 2 of 3: routing by context. Mail from staff is sorted, idea by idea, into
--   ask  = something to film or make content from  (client_asks, status draft - exactly as before)
--   todo = something the client has to do          (client_todos, status draft - invisible on her board)
--   note = a comment about one existing post       (studio_note_drafts, status draft)
-- This file is the deterministic keyword router (always available, never blocks intake) and trg_mail_to_ask v5.
-- The free-AI pass that can improve the route and write the short title is part 3 (edge fn studio-route-mail).
-- Mail from the client herself is untouched: her ideas are always asks, as before.

-- ---------------------------------------------------------------- client: who is the mail for?
-- Same as before (a client named in the mail, else Centering YOU), plus the client's contact name and the people
-- on her board, so "for Elizabeth" works. Staff scope is honoured: Eli cannot file into a client he cannot see.
create or replace function public.mail_pick_client(p_subject text, p_body text, p_staff uuid)
returns table (client_id uuid, why text)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_txt text := coalesce(p_subject, '') || ' ' || coalesce(p_body, '');
  r record; tok text; cand text; n int; best uuid; bestn int := 0;
begin
  for r in
    select c.id, c.slug, c.name, c.contact_name
      from approval_clients c
     where c.active and not coalesce(c.sandbox, false) and public.staff_may_see_slug(p_staff, c.slug)
  loop
    n := 0;
    if r.name is not null and v_txt ilike '%' || r.name || '%' then n := greatest(n, length(r.name)); end if;
    if v_txt ilike '%' || r.slug || '%' then n := greatest(n, length(r.slug)); end if;
    for cand in
      select x from (
        select r.contact_name x
        union all select p.name from client_people p where p.client_slug = r.slug and p.active
        union all select p.person from client_people p where p.client_slug = r.slug and p.active
      ) q where coalesce(btrim(x), '') <> ''
    loop
      if v_txt ilike '%' || cand || '%' then n := greatest(n, length(cand)); end if;
      tok := split_part(btrim(cand), ' ', 1);
      if length(tok) >= 4 and v_txt ~* ('\m' || regexp_replace(tok, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M') then
        n := greatest(n, length(tok));
      end if;
    end loop;
    if n > bestn then bestn := n; best := r.id; end if;
  end loop;
  if best is not null then
    client_id := best; why := 'named in the mail'; return next; return;
  end if;
  select c.id into client_id from approval_clients c where c.slug = 'centering-you';
  why := 'house default'; return next;
end $$;
revoke all on function public.mail_pick_client(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- what kind of ask is it? (was inline in the trigger)
create or replace function public.mail_ask_kind(p_subject text, p_title text, p_body text) returns text
language sql immutable set search_path to 'public' as $$
  select case
    when substring(p_body from '(https?://[^\s<>"'')]*(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|linkedin\.com)[^\s<>"'')]*)') is not null
         and (coalesce(p_subject,'') || ' ' || coalesce(p_title,'') || ' ' || coalesce(p_body,'')) ~* '(stitch|duet|react|cut-?in|green ?screen)' then 'cutin'
    when substring(p_body from '(https?://[^\s<>"'')]*(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|linkedin\.com)[^\s<>"'')]*)') is not null
         and (coalesce(p_subject,'') || ' ' || coalesce(p_title,'') || ' ' || coalesce(p_body,'')) ~* '\m(comment|reply to)\M' then 'comment'
    else 'talk' end
$$;

-- ---------------------------------------------------------------- the keyword router
-- Returns {route, item_id, item_title, reason, ask_score, todo_score}. It looks at the idea's own words only.
create or replace function public.mail_route_idea(p_title text, p_body text, p_client uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  t text := lower(coalesce(p_title, '') || E'\n' || coalesce(p_body, ''));
  head text := lower(btrim(split_part(btrim(coalesce(nullif(p_body, ''), p_title, '')), E'\n', 1)));
  ask_s int := 0; todo_s int := 0; note_cue boolean; v_item uuid; v_ititle text; verb text; why text[] := '{}'::text[];
begin
  -- to film / make
  if t ~ 'https?://[^ ]*(tiktok|instagram|youtube|youtu\.be|facebook|fb\.watch)' then
    ask_s := ask_s + 3; why := array_append(why, 'has a video link'); end if;
  if t ~ '\m(idea|ideas|reel|reels|video|videos|script|film|filming|record|stitch|duet|react|green ?screen|hook|carousel|topic|topics|example|inspired|trend|trending)\M' then
    ask_s := ask_s + 2; why := array_append(why, 'talks about something to film or make'); end if;
  if t ~ '\m(make|write|do|create|shoot) (a|an|another|some|one) (new )?(post|video|reel|carousel|script)' then
    ask_s := ask_s + 2; end if;

  -- for the client to do
  verb := substring(head from '^[\s\-\*•0-9.)]*(?:please\s+|pls\s+)?(connect|link|send|share|upload|sign|review|answer|reply|confirm|approve|decide|pick|choose|fill|complete|set up|log in|login|grant|forward|email|book|schedule|pay|renew|verify|download|install)\M');
  if verb is not null then todo_s := todo_s + 3; why := array_append(why, 'starts with "' || verb || '"'); end if;
  if t ~ '\m(can you|could you|would you|need you to|i need you|make sure you|don''t forget|remember to|please)\M' then
    todo_s := todo_s + 2; why := array_append(why, 'asks them to do something'); end if;
  if t ~ '\myour (own )?(instagram|tiktok|facebook|youtube|account|accounts|login|password|access|photos?|files?|logo|brand guide|invoice|contract|calendar|bio|handle)\M' then
    todo_s := todo_s + 2; why := array_append(why, 'is about something of theirs'); end if;
  if t ~ '\m(to-?do|todo|to do)\M' then todo_s := todo_s + 3; why := array_append(why, 'says to-do'); end if;
  if t ~ '\mby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|eod|end of (the )?(day|week))\M' then
    todo_s := todo_s + 2; why := array_append(why, 'has a deadline'); end if;

  -- about one existing post?
  select i.id, i.title into v_item, v_ititle
    from approval_items i
   where i.client_id = p_client and length(btrim(coalesce(i.title, ''))) >= 8
     and coalesce(i.internal_status, '') <> 'killed'
     and position(lower(btrim(i.title)) in t) > 0
   order by length(i.title) desc, i.created_at desc limit 1;
  note_cue := t ~ '\m(note|comment|feedback|change|fix|swap|tweak|edit|rewrite|shorter|longer|typo|wording|caption|on the|about the)\M';

  if v_item is not null and (note_cue or (ask_s < 2 and todo_s < 3)) then
    return jsonb_build_object('route', 'note', 'item_id', v_item, 'item_title', v_ititle,
      'reason', 'names the post "' || v_ititle || '"', 'ask_score', ask_s, 'todo_score', todo_s);
  end if;
  if todo_s >= 3 and todo_s > ask_s then
    return jsonb_build_object('route', 'todo', 'reason', array_to_string(why, '; '),
      'ask_score', ask_s, 'todo_score', todo_s);
  end if;
  return jsonb_build_object('route', 'ask',
    'reason', case when array_length(why, 1) is null then 'no to-do or post signal, so an idea to film' else array_to_string(why, '; ') end,
    'ask_score', ask_s, 'todo_score', todo_s);
end $$;
revoke all on function public.mail_route_idea(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- trg_mail_to_ask v5
create or replace function public.trg_mail_to_ask() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_staff uuid; v_client uuid; v_body text; v_url text; v_vid text; v_id uuid; v_title text;
        v_to_studio boolean; v_tagged boolean; v_subj text; v_from_client boolean := false;
        v_cname text; v_spark uuid; r record; v_made int := 0; v_first uuid; v_ids uuid[] := '{}';
        v_from text; v_pinned uuid; v_why text;
        v_route jsonb; v_r text; v_src jsonb; v_item uuid; v_n_ask int := 0; v_n_todo int := 0; v_n_note int := 0;
        v_first_kind text; v_detail text;
begin
  v_subj := coalesce(new.subject, '');
  v_to_studio := array_to_string(new.to_addrs, ',') ilike '%studio@bestly.tech%';
  v_tagged := v_subj ~* '^\s*((fwd?|fw)\s*:\s*)?(idea|ask|studio|script)\s*[:\-–]';
  if not (v_to_studio or v_tagged) then return new; end if;
  if v_subj ~* '^\s*re\s*:\s*in studio\s*:' then return new; end if;
  v_body := coalesce(new.body_text, '');
  v_from := public.mail_addr(new.from_addr);

  -- 1. The sender decides, and a client sender is binding.
  v_pinned := public.mail_sender_client(new.from_addr);
  if v_pinned is not null then
    v_client := v_pinned; v_from_client := true; v_why := 'sender';
    select name into v_cname from approval_clients where id = v_client;
    select id into v_spark from approval_staff where slug = 'spark';
    v_staff := v_spark;
  else
    select id into v_staff from approval_staff
     where active and can_promote
       and (lower(email) = v_from or v_from = any (select lower(x) from unnest(alt_emails) x))
     limit 1;
    if v_staff is null then return new; end if;
  end if;

  if v_subj ~* '^\s*(new listing|just sold|\d+\s+\S)' and (v_subj || v_body) ~* '[A-Z]{2},?\s*\d{5}'
     or v_body ~* '(realtor\.com|zillow\.com|redfin\.com|opendoor\.com|^\s*price:)' then return new; end if;
  if exists (select 1 from client_asks where source->>'mail_id' = new.id::text)
     or exists (select 1 from client_todos where source->>'mail_id' = new.id::text)
     or exists (select 1 from studio_note_drafts where source->>'mail_id' = new.id::text) then return new; end if;

  -- 2. Only mail from US is ever routed by what it says. Hers never is.
  if v_client is null then
    select p.client_id, p.why into v_client, v_why from public.mail_pick_client(v_subj, v_body, v_staff) p;
  end if;

  -- 3. Belt and braces: a client's own mail cannot end up anywhere but theirs.
  if v_pinned is not null and v_client is distinct from v_pinned then
    raise exception 'mail intake tried to route % away from its own client', v_from;
  end if;

  for r in select * from ask_split_ideas(new.subject, v_body) loop
    v_made := v_made + 1;
    v_title := coalesce(nullif(trim(regexp_replace(regexp_replace(r.title, '^\s*((fwd?|fw|re)\s*:\s*)+', '', 'i'),
                        '^\s*(idea|ask|studio|script)\s*[:\-–]\s*', '', 'i')), ''),
                        nullif(trim(regexp_replace(v_subj, '^\s*((fwd?|fw|re)\s*:\s*)+', '', 'i')), ''), 'Idea by email');
    v_url := substring(r.body from '(https?://[^\s<>"'')]+)');
    v_vid := substring(r.body from '(https?://[^\s<>"'')]*(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|linkedin\.com)[^\s<>"'')]*)');

    -- her own ideas are always asks (as before); ours are sorted by what they say.
    -- Intake must never block: if the router or a draft insert fails, the idea becomes an ask, as it always did.
    if v_from_client then v_route := null; v_r := 'ask';
    else
      begin v_route := public.mail_route_idea(v_title, r.body, v_client); v_r := coalesce(v_route->>'route', 'ask');
      exception when others then v_route := jsonb_build_object('route', 'ask', 'reason', 'router unavailable'); v_r := 'ask';
      end;
    end if;

    v_src := jsonb_build_object('via', 'studio@ email', 'mail_id', new.id, 'from', v_from,
                                'from_client', v_from_client, 'subject', new.subject, 'received', new.sent_at,
                                'part', v_made, 'routed_by', v_why,
                                'matched', case when v_to_studio then 'to studio@' else 'subject tag' end);
    if v_route is not null then
      v_src := v_src || jsonb_build_object('route', v_r, 'route_reason', v_route->>'reason', 'route_by', 'keywords',
                                           'route_state', 'rules', 'route_attempts', 0);
    end if;

    v_id := null;
    if v_r = 'todo' then
      begin
        v_detail := nullif(left(trim(r.body), 1500), '');
        if v_detail is not null and lower(btrim(v_detail)) = lower(btrim(v_title)) then v_detail := null; end if;
        insert into client_todos (client_id, title, detail, status, source, created_by, position)
        values (v_client, left(v_title, 140), v_detail, 'draft', v_src - 'from', v_staff,
                coalesce((select max(position) + 1 from client_todos where client_id = v_client), 0))
        returning id into v_id;
        v_n_todo := v_n_todo + 1;
      exception when others then v_id := null; end;
    elsif v_r = 'note' then
      begin
        insert into studio_note_drafts (client_id, item_id, title, note, status, source, created_by)
        values (v_client, (v_route->>'item_id')::uuid, left(v_title, 140), left(trim(r.body), 1500), 'draft',
                (v_src - 'from') || jsonb_build_object('item_title', v_route->>'item_title'), v_staff)
        returning id into v_id;
        v_n_note := v_n_note + 1;
      exception when others then v_id := null; end;
    end if;
    if v_id is null then
      if v_r <> 'ask' and v_route is not null then
        v_src := v_src || jsonb_build_object('route', 'ask', 'route_reason', 'could not file it as ' || v_r || ', so an ask');
      end if;
      v_r := 'ask';
      insert into client_asks (client_id, title, brief, script, status, created_by, kind, reference, source)
      values (v_client, v_title, nullif(left(trim(r.body), 1500), ''), '[]'::jsonb, 'draft', v_staff,
              public.mail_ask_kind(v_subj, v_title, r.body),
              case when coalesce(v_vid, v_url) is not null then jsonb_build_object('url', coalesce(v_vid, v_url)) end,
              v_src || jsonb_build_object('needs_script', true))
      returning id into v_id;
      v_n_ask := v_n_ask + 1;
    end if;
    v_ids := array_append(v_ids, v_id);
    if v_first is null then v_first := v_id; v_first_kind := v_r; end if;
  end loop;
  if v_made = 0 then return new; end if;

  begin
    perform talk_say('review',
      '📥 ' || (case when v_from_client then v_cname else 'New' end) ||
      (case when v_made = 1 then
              (case v_first_kind when 'todo' then ' to-do by email for Drafts: "' when 'note' then ' note by email for Drafts: "'
                                 else ' idea by email for Drafts: "' end) || v_title || '"'
            else ' sent ' || v_made || ' items by email - they are in Drafts' end) ||
      (case when v_n_ask > 0 then ' - Spark will write the script' || case when v_n_ask = 1 then '.' else 's.' end
            else '. One tap sends it to their board.' end),
      'askmail:' || v_first::text, '📥 {n} new items by email in Drafts.', jsonb_build_object('asks', to_jsonb(v_ids)));
  exception when others then null;
  end;

  begin
    insert into notify_outbox (kind, audience, staff_id, to_email, subject, body, link, dedupe, payload)
    values ('ask_received', case when v_from_client then 'client' else 'staff' end, v_staff, new.from_addr,
            case when v_made = 1 then (case when v_from_client then 'Got your idea: ' || v_title else 'In Studio: ' || v_title end)
                 else (case when v_from_client then 'Got your ' || v_made || ' ideas' else 'In Studio: ' || v_made || ' ideas' end) end,
            case when v_from_client then
                 (case when v_made = 1 then 'Got it — "' || v_title || '". We will turn it into something you can film, and it will show up on your board.'
                       else 'Got it — all ' || v_made || ' of them. We will turn them into things you can film, and they will show up on your board.' end)
                 || ' Nothing goes anywhere until you have seen it.'
            else
                 (case when v_made = 1 then 'Got it. "' || v_title || '" is in Studio under Asks › Drafts.'
                       else 'Got it — ' || v_made || ' ideas from that email are in Studio under Asks › Drafts.' end)
                 || ' Spark writes the script next; nothing goes out until one of us sends it.'
            end,
            case when v_from_client then coalesce(public.client_board_link(v_client), 'https://studio.bestly.tech/')
                 else 'https://studio.bestly.tech/' end,
            'askmail-receipt:' || v_first::text, jsonb_build_object('asks', to_jsonb(v_ids)));
  exception when others then null;
  end;
  return new;
end $$;
