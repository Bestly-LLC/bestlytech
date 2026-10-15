-- Basil (Kitchen Manager), Oct 14 2026: voice updates through Hey Scout + the Kitchen page.
-- Applied live via MCP in pieces; this file is the record.
--  * basil_voice(text): tier 0 in the voice-ask edge function. "used the salmon", "we're low on eggs",
--    "do we have almond flour", "what's for dinner", "add hot sauce to the fridge", "undo". Pure SQL, no AI.
--    handled=false means "not a kitchen phrase" and Scout answers as before. Plain "add milk" is left alone
--    (that is the shopping list).
--  * basil_kitchen*(): admin RPCs for /admin/home-hub/kitchen. Page, voice and undo share pantry_events.

create table if not exists public.pantry_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  source text not null,              -- voice | ui
  action text not null,              -- have | low | out | arriving | add | query | ideas | undo | undone:<action>
  item_id uuid references public.pantry_items(id) on delete set null,
  item_name text,
  before_status text,
  after_status text,
  said text,
  snapshot jsonb
);
create index if not exists pantry_events_at_idx on public.pantry_events (at desc);
alter table public.pantry_events enable row level security;

CREATE OR REPLACE FUNCTION public.pantry_norm(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$function$;

-- Best pantry row for a spoken phrase. p_want biases toward rows the action would change.
CREATE OR REPLACE FUNCTION public.pantry_match(p_q text, p_want text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare q text := pantry_norm(p_q); toks text[]; id_ uuid;
begin
  q := regexp_replace(q, '^(all of the|all the|all of|of the|the|some|my|our|a|an|that|those|these) ', '');
  q := regexp_replace(q, '^(the|my|our) ', '');
  q := regexp_replace(q, ' (please|thanks|thank you|for me|now|today|tonight|already)$', '');
  if length(q) < 2 then return null; end if;
  select array_agg(case when t ~ 'ies$' then regexp_replace(t, 'ies$', '')
                        when t ~ '(ses|xes|ches|shes|oes)$' then regexp_replace(t, 'es$', '')
                        when t ~ '[^s]s$' then regexp_replace(t, 's$', '') else t end)
    into toks from unnest(string_to_array(q, ' ')) t where t not in ('', 'of', 'and', 'the', 'a', 'some');
  if toks is null then return null; end if;
  select i.id into id_ from pantry_items i
   where (select bool_and(pantry_norm(i.name) ~ ('\y' || t)) from unnest(toks) t)
   order by (pantry_norm(i.name) = q) desc,
            case p_want when 'out' then (i.status in ('have', 'low'))::int
                        when 'low' then (i.status = 'have')::int
                        when 'have' then (i.status in ('out', 'low', 'arriving'))::int else 0 end desc,
            i.use_soon desc, length(i.name), i.updated_at desc
   limit 1;
  if id_ is null then
    select i.id into id_ from pantry_items i
     where word_similarity(q, pantry_norm(i.name)) >= 0.7
     order by word_similarity(q, pantry_norm(i.name)) desc, length(i.name) limit 1;
  end if;
  return id_;
end $function$;

-- One status change + its event row. Shared by voice and the Kitchen page.
CREATE OR REPLACE FUNCTION public.pantry_set(p_id uuid, p_status text, p_source text, p_said text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r pantry_items;
begin
  if p_status not in ('have', 'low', 'out', 'arriving') then raise exception 'bad status %', p_status; end if;
  select * into r from pantry_items where id = p_id for update;
  if not found then return null; end if;
  update pantry_items set status = p_status, use_soon = case when p_status = 'out' then false else use_soon end where id = p_id;
  insert into pantry_events (source, action, item_id, item_name, before_status, after_status, said)
  values (p_source, p_status, p_id, r.name, r.status, p_status, p_said);
  return jsonb_build_object('id', p_id, 'name', r.name, 'before', r.status, 'after', p_status, 'location', r.location);
end $function$;

CREATE OR REPLACE FUNCTION public.pantry_guess_location(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when pantry_norm(p_name) ~ '\y(frozen|ice cream|popsicle)' then 'freezer'
    when pantry_norm(p_name) ~ '\y(milk|yogurt|cheese|egg|butter|cream|chicken|beef|pork|turkey|salmon|fish|shrimp|tofu|lettuce|spinach|kale|berr|grape|hummus|salsa|juice|bacon|ham|deli)' then 'fridge'
    when pantry_norm(p_name) ~ '\y(banana|avocado|tomato|onion|garlic|potato|apple|orange|lemon|lime|bread)' then 'counter'
    else 'pantry' end
$function$;

CREATE OR REPLACE FUNCTION public.pantry_say_status(s text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case s when 'have' then 'in stock' when 'low' then 'low' when 'out' then 'used up' when 'arriving' then 'on the way' else coalesce(s, 'unknown') end
$function$;

CREATE OR REPLACE FUNCTION public.basil_voice(p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  t text := pantry_norm(p_text);
  m text[]; want text; rest text; loc text; parts text[]; part text; id_ uuid; r pantry_items; res jsonb;
  names text[] := '{}'; ideas text; ev pantry_events; n int; verb text;
begin
  t := regexp_replace(t, '^(hey basil|ok basil|okay basil|basil) ', '');
  t := regexp_replace(t, '^(please|so|um|uh|okay|ok|oh) ', '');
  t := regexp_replace(t, ' (please|thanks|thank you)$', '');
  if t = '' then return jsonb_build_object('handled', false); end if;

  -- undo the last voice change (within 10 minutes)
  if t ~ '^(undo|undo that|never ?mind|scratch that|cancel that|that s wrong|wrong one)$' then
    select * into ev from pantry_events where source = 'voice' and action in ('have', 'low', 'out', 'add') and at > now() - interval '10 minutes' order by at desc, id desc limit 1;
    if ev.id is null then return jsonb_build_object('handled', false); end if;
    if ev.action = 'add' then
      delete from pantry_items where id = ev.item_id;
    else
      update pantry_items set status = ev.before_status where id = ev.item_id;
    end if;
    -- the undone row stops being undoable
    update pantry_events set action = 'undone:' || action where id = ev.id;
    insert into pantry_events (source, action, item_id, item_name, before_status, after_status, said)
    values ('voice', 'undo', case when ev.action = 'add' then null else ev.item_id end, ev.item_name, ev.after_status, ev.before_status, p_text);
    return jsonb_build_object('handled', true, 'action', 'undo',
      'reply', case when ev.action = 'add' then format('Okay, took %s back off the list.', ev.item_name)
                    else format('Okay, undone. %s is %s.', ev.item_name, pantry_say_status(ev.before_status)) end);
  end if;

  -- dinner ideas
  if (t ~ '\y(dinner|lunch|supper)\y' and t ~ '\y(what|ideas?|make|cook|should|eat|for)\y')
     or t ~ '^what (can|should|could) (i|we) (make|cook|eat)' then
    select string_agg(x.name, ', ') into ideas from pantry_dinner_ideas(3) x;
    insert into pantry_events (source, action, said) values ('voice', 'ideas', p_text);
    return jsonb_build_object('handled', true, 'action', 'ideas', 'reply',
      case when ideas is null then 'Nothing I can fully make right now. Might be time for a Costco run.'
           else 'From what you have: ' || regexp_replace(ideas, ', ([^,]*)$', ', or \1') || '.' end);
  end if;

  -- what needs using up
  if t ~ '(use soon|use up|going bad|expir|go bad)' and t ~ '\y(what|anything|which)\y' then
    select array_agg(name order by use_by nulls last, name) into names from (select name, use_by from pantry_items where use_soon and status in ('have', 'low') order by use_by nulls last limit 4) s;
    insert into pantry_events (source, action, said) values ('voice', 'query', p_text);
    return jsonb_build_object('handled', true, 'action', 'query', 'reply',
      case when names is null then 'Nothing is flagged to use soon.' else 'Use these soon: ' || regexp_replace(array_to_string(names, ', '), ', ([^,]*)$', ' and \1') || '.' end);
  end if;

  -- do we have X
  m := regexp_match(t, '^(?:do|did) (?:i|we) (?:still )?(?:have|got) (?:any )?(.+?)(?: left| at home| in the (?:fridge|freezer|pantry))?$');
  if m is null then m := regexp_match(t, '^(?:is there|are there) (?:any )?(.+?)(?: left| at home| in the (?:fridge|freezer|pantry))?$'); end if;
  if m is not null then
    id_ := pantry_match(m[1]);
    if id_ is null then return jsonb_build_object('handled', false); end if;
    select * into r from pantry_items where id = id_;
    insert into pantry_events (source, action, item_id, item_name, said) values ('voice', 'query', id_, r.name, p_text);
    return jsonb_build_object('handled', true, 'action', 'query', 'reply', case r.status
      when 'have' then format('Yes, %s, in the %s.', r.name, r.location)
      when 'low' then format('A little. %s is running low.', r.name)
      when 'out' then format('No, you''re out of %s.', r.name)
      else format('It''s on the way. %s is coming with the grocery order.', r.name) end);
  end if;

  -- add X to the fridge (explicit place only; plain "add milk" stays the shopping list)
  m := regexp_match(t, '^(?:add|put) (.+?) (?:to|in|into|on) (?:the |my )?(pantry|fridge|refrigerator|freezer|counter|kitchen|inventory)(?: list)?$');
  if m is not null then
    rest := regexp_replace(m[1], '^(some|a|an|the|more) ', '');
    loc := case m[2] when 'refrigerator' then 'fridge' when 'kitchen' then null when 'inventory' then null else m[2] end;
    id_ := pantry_match(rest, 'have');
    if id_ is not null then
      res := pantry_set(id_, 'have', 'voice', p_text);
      if loc is not null then update pantry_items set location = loc where id = id_; end if;
      return jsonb_build_object('handled', true, 'action', 'have', 'reply', format('Got it, %s is back in stock.', res->>'name'));
    end if;
    insert into pantry_items (name, location, status, source, notes)
    values (initcap(rest), coalesce(loc, pantry_guess_location(rest)), 'have', 'voice', 'added by voice ' || to_char(now() at time zone 'America/Los_Angeles', 'Mon DD'))
    returning * into r;
    insert into pantry_events (source, action, item_id, item_name, after_status, said) values ('voice', 'add', r.id, r.name, 'have', p_text);
    return jsonb_build_object('handled', true, 'action', 'add', 'reply', format('Added %s to the %s.', r.name, r.location));
  end if;

  -- intent + item phrase
  m := regexp_match(t, '^(?:i m |im |i am |we re |were |we are )?(?:running |getting )?(?:low on|almost out of|nearly out of|running out of) (.+)$');
  if m is not null then want := 'low'; rest := m[1]; end if;
  if want is null then
    m := regexp_match(t, '^(?:i m |im |i am |we re |were |we are )?(?:all )?out of (.+)$');
    if m is not null then want := 'out'; rest := m[1]; end if;
  end if;
  if want is null then
    m := regexp_match(t, '^(?:i |we )?(?:just )?(?:have |ve )?(?:used up|used|finished off|finished|ate the last of|ate|eaten|ran out of|run out of|threw out|threw away|tossed|polished off) (.+)$');
    if m is not null then want := 'out'; rest := m[1]; end if;
  end if;
  if want is null then
    m := regexp_match(t, '^(?:the )?(.+?) (?:is|are) (?:all )?(?:gone|finished|used up|empty)$');
    if m is not null then want := 'out'; rest := m[1]; end if;
  end if;
  if want is null then
    m := regexp_match(t, '^(?:the )?(.+?) (?:is|are) (?:getting |running )?low$');
    if m is not null then want := 'low'; rest := m[1]; end if;
  end if;
  if want is null then
    m := regexp_match(t, '^(?:i |we )?(?:just )?(?:bought|picked up|restocked|grabbed|got more|got more of) (?:more |some |new )?(.+)$');
    if m is not null then want := 'have'; rest := m[1]; end if;
  end if;
  if want is null then return jsonb_build_object('handled', false); end if;

  -- "ate some of the chips" = low, not out
  if want = 'out' and rest ~ '^(some|a little|a bit|half|part|a few|most)\y' then
    want := 'low';
    rest := regexp_replace(rest, '^(some|a little|a bit|half|part|a few|most)( of)?( the)? ', '');
  end if;

  id_ := pantry_match(rest, want);
  if id_ is not null then
    parts := array[rest];
  else
    parts := regexp_split_to_array(rest, ' and | also ');
    if array_length(parts, 1) < 2 then return jsonb_build_object('handled', false); end if;
  end if;
  foreach part in array parts loop
    id_ := pantry_match(part, want);
    if id_ is not null then
      res := pantry_set(id_, want, 'voice', p_text);
      names := names || (res->>'name');
    end if;
  end loop;
  n := coalesce(array_length(names, 1), 0);
  if n = 0 then return jsonb_build_object('handled', false); end if;
  verb := case when n > 1 or names[1] ~* '[^s]s$' then ' are' else ' is' end;
  return jsonb_build_object('handled', true, 'action', want, 'items', to_jsonb(names), 'reply',
    'Got it. ' || regexp_replace(array_to_string(names, ', '), ', ([^,]*)$', ' and \1') ||
    case want when 'out' then verb || ' marked used up.' when 'low' then ' marked low.' else verb || ' back in stock.' end);
end $function$;

-- Kitchen page (admin only)
CREATE OR REPLACE FUNCTION public.basil_kitchen()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.name) from pantry_items i), '[]'::jsonb),
    'ideas', coalesce((select jsonb_agg(to_jsonb(x)) from pantry_dinner_ideas(3) x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc, e.id desc)
                        from (select id, at, source, action, item_id, item_name, before_status, after_status, said
                              from pantry_events where action not in ('query', 'ideas') order by at desc, id desc limit 15) e), '[]'::jsonb),
    'last_tick', (select max(at) from agent_beats where slug = 'basil'),
    'now', now());
end $function$;

CREATE OR REPLACE FUNCTION public.basil_kitchen_set(p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare res jsonb;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  res := pantry_set(p_id, p_status, 'ui', null);
  if res is null then raise exception 'item not found'; end if;
  return res || jsonb_build_object('event_id', (select max(id) from pantry_events where item_id = p_id and source = 'ui'));
end $function$;

CREATE OR REPLACE FUNCTION public.basil_kitchen_add(p_name text, p_location text DEFAULT NULL::text, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r pantry_items; n text := btrim(coalesce(p_name, ''));
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if length(n) < 2 or length(n) > 80 then raise exception 'name must be 2 to 80 characters'; end if;
  if p_location is not null and p_location not in ('fridge', 'freezer', 'pantry', 'counter') then raise exception 'bad location'; end if;
  insert into pantry_items (name, location, category, status, source)
  values (n, coalesce(p_location, pantry_guess_location(n)), nullif(btrim(coalesce(p_category, '')), ''), 'have', 'ui')
  returning * into r;
  insert into pantry_events (source, action, item_id, item_name, after_status) values ('ui', 'add', r.id, r.name, 'have');
  return to_jsonb(r);
end $function$;

-- use_soon and location only; status goes through basil_kitchen_set
CREATE OR REPLACE FUNCTION public.basil_kitchen_edit(p_id uuid, p_use_soon boolean DEFAULT NULL::boolean, p_location text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r pantry_items;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_location is not null and p_location not in ('fridge', 'freezer', 'pantry', 'counter') then raise exception 'bad location'; end if;
  update pantry_items set use_soon = coalesce(p_use_soon, use_soon), location = coalesce(p_location, location)
   where id = p_id returning * into r;
  if not found then raise exception 'item not found'; end if;
  return to_jsonb(r);
end $function$;

-- Undo one status change (the toast's Undo and the Recent list)
CREATE OR REPLACE FUNCTION public.basil_kitchen_undo(p_event_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare ev pantry_events;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into ev from pantry_events where id = p_event_id for update;
  if not found or ev.action not in ('have', 'low', 'out', 'arriving') or ev.item_id is null then raise exception 'nothing to undo'; end if;
  update pantry_items set status = ev.before_status where id = ev.item_id;
  update pantry_events set action = 'undone:' || action where id = ev.id;
  insert into pantry_events (source, action, item_id, item_name, before_status, after_status)
  values ('ui', 'undo', ev.item_id, ev.item_name, ev.after_status, ev.before_status);
  return jsonb_build_object('name', ev.item_name, 'status', ev.before_status);
end $function$;

revoke all on function public.basil_voice(text) from public, anon, authenticated;
revoke all on function public.pantry_set(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.pantry_match(text, text) from public, anon, authenticated;
revoke all on function public.basil_kitchen() from public, anon;
revoke all on function public.basil_kitchen_set(uuid, text) from public, anon;
revoke all on function public.basil_kitchen_add(text, text, text) from public, anon;
revoke all on function public.basil_kitchen_edit(uuid, boolean, text) from public, anon;
revoke all on function public.basil_kitchen_undo(bigint) from public, anon;
grant execute on function public.basil_kitchen() to authenticated;
grant execute on function public.basil_kitchen_set(uuid, text) to authenticated;
grant execute on function public.basil_kitchen_add(text, text, text) to authenticated;
grant execute on function public.basil_kitchen_edit(uuid, boolean, text) to authenticated;
grant execute on function public.basil_kitchen_undo(bigint) to authenticated;
