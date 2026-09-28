-- Fix (2026-09-28): lax_ask_suggest crashed with `record "t" is not assigned yet` for any guest with no
-- reservation behind their link: the demo pages (demo-home / demo-lax) and the public pass slug when no trip is
-- current. `t` was an untyped `record` that was only filled inside `if w.res is not null`, and PL/pgSQL can't read
-- a field off a record that was never assigned, so the very next `if t.starts_at is not null` threw and the Ask
-- sheet got no suggestion chips.
-- Fix: make `t` a turo_trips row variable. A row variable always has its structure, so its fields just start
-- NULL — and the "no trip" branches the function already has (`elsif t.starts_at is null ...`) now run as
-- intended. Nothing else changes. This function previously lived only in the database; this migration puts it
-- under version control.

CREATE OR REPLACE FUNCTION public.lax_ask_suggest(p_token text, p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  w record; t turo_trips; car jsonb;
  h numeric; e numeric; hr int; lastq text := ''; asked text[];
  out text[] := '{}'; pool text[] := '{}'; s text;
  home_pool boolean := false; hot boolean := false; cold boolean := false; low boolean := false;
begin
  select * into w from lax_ask_who(p_token, p_slug);
  if w.link is null then return '[]'::jsonb; end if;

  hr := extract(hour from now() at time zone 'America/Los_Angeles');
  if w.res is not null then
    select * into t from turo_trips where reservation_id = w.res;
    home_pool := w.personal and lax_trip_kind(t.airport_code) = 'home';
  end if;
  if t.starts_at is not null then
    h := extract(epoch from t.starts_at - now()) / 3600;
    e := extract(epoch from t.ends_at - now()) / 3600;
  end if;

  car := coalesce(lax_car_public(), '{}'::jsonb);
  if car ? 'observed_at' and (car->>'observed_at')::timestamptz > now() - interval '3 hours' then
    hot  := coalesce((car->>'inside_f')::int, 0) >= 77;
    cold := coalesce((car->>'inside_f')::int, 99) <= 60;
    low  := coalesce((car->>'battery')::int, 100) < 30;
  end if;

  -- What they already asked (don't repeat) and the last question (for follow-ups).
  select coalesce(array_agg(lower(content)), '{}') into asked from lax_ask_msgs
   where link = w.link and role = 'user'
     and created_at > now() - case when w.personal then interval '3 days' else interval '1 hour' end;
  select lower(content) into lastq from lax_ask_msgs
   where link = w.link and role = 'user'
     and created_at > now() - case when w.personal then interval '3 days' else interval '1 hour' end
   order by id desc limit 1;
  lastq := coalesce(lastq, '');

  -- 1) Follow-ups to the last question.
  if lastq ~ 'shuttle|land|terminal|airport' then
    pool := pool || array['Which level is the car on?', 'How do I get into the garage?', 'How long does pickup take?'];
  elsif lastq ~ 'garage|qr|scan|level|lobby|door' then
    pool := pool || array['How do I unlock and start the Tesla?', 'The QR code won''t scan', 'Which level is the car on?'];
  elsif lastq ~ 'unlock|start|key|drive|tesla' then
    pool := pool || array['What do the A/C buttons do?', 'How do I charge?', 'Does it have CarPlay?'];
  elsif lastq ~ 'charg|battery|range|supercharg' then
    pool := pool || array['Where''s the nearest Supercharger?', 'How much does charging cost?', 'How much range does it have?'];
  elsif lastq ~ 'return|drop|flight' then
    pool := pool || array['How early should I return before my flight?', 'What photos should I take?', 'What if I''m going to be late returning?'];
  elsif lastq ~ 'extend|change|cancel|shorten|early' then
    pool := pool || array['Can I return the car early?', 'What if I''m going to be late returning?', 'How do I return the car?'];
  elsif lastq ~ 'a/c|ac |heat|cool|climate|hot|cold|warm' then
    pool := pool || array['How do I unlock and start the Tesla?', 'Which level is the car on?'];
  elsif lastq ~ 'toll|ticket|clean|smok|pet' then
    pool := pool || array['Where can I get the car washed for free?', 'Do I have to wash or clean the car?', 'How do tolls and tickets work?'];
  end if;

  -- 2) Where they are in the trip, and the time of day.
  if home_pool and h > 24 then
    pool := pool || array['How do I get the key?', 'I don''t have a Tesla account.', 'Where is the car?', 'Can someone else drive?'];
  elsif home_pool and h > 2 then
    pool := pool || array['How do I get the key?', 'Where is the car?', 'Can I take a rideshare there?', 'Does it have Full Self-Driving?'];
  elsif home_pool and h > -1.5 then
    pool := pool || array['Which car is mine?', 'My phone key isn''t working.'];
    if hot then pool := pool || array['Can I cool the car before I get there?']; end if;
    if cold then pool := pool || array['Can I warm the car up before I get there?']; end if;
    pool := pool || array['How do I shift into Drive?'];
  elsif home_pool and e between 0 and 24 then
    pool := pool || array['Where do I return the car?', 'Street sweeping?'];
    if low then pool := pool || array['Do I need to charge before I return it?']; end if;
    pool := pool || array['What if I''m going to be late returning?', 'What photos should I take at return?'];
  elsif t.starts_at is null then
    pool := pool || array['Where do I catch the shuttle after I land?', 'How do I get into the garage?', 'How do I unlock and start the Tesla?', 'How do I return the car?'];
  elsif h > 24 then
    pool := pool || array['How does pickup work?', 'Add the pass to my phone', 'How long does pickup take?', 'Can someone else drive?', 'Can I bring my pet?'];
  elsif h > 3 then
    if hr >= 22 or hr < 5 or extract(hour from t.starts_at at time zone 'America/Los_Angeles') not between 5 and 21 then
      pool := pool || array['Are shuttles running late at night?'];
    end if;
    pool := pool || array['Where do I catch the shuttle after I land?', 'Add the pass to my phone', 'How long does pickup take?', 'How do I unlock and start the Tesla?'];
  elsif h > -1.5 then
    pool := pool || array['I just landed. Where do I go?', 'Which level is the car on?', 'The QR code won''t scan'];
    if hot then pool := pool || array['Can I cool the car before I get there?']; end if;
    if cold then pool := pool || array['Can I warm the car up before I get there?']; end if;
    pool := pool || array['How do I unlock and start the Tesla?'];
  elsif e > 24 then
    if low then pool := pool || array['Where''s the nearest Supercharger?']; end if;
    if hr >= 18 or hr < 5 then pool := pool || array['Where can I charge tonight?']; end if;
    pool := pool || array['How do I charge?', 'I need to extend my trip', 'How do tolls and tickets work?', 'What do I do if something goes wrong?'];
  elsif e > 0 then
    pool := pool || array['How do I return the car?', 'How early should I return before my flight?'];
    if low then pool := pool || array['Do I need to charge before I return it?']; end if;
    pool := pool || array['What if I''m going to be late returning?', 'What photos should I take at return?', 'I need to extend my trip'];
  else
    pool := pool || array['I left something in the car', 'How do I pay an invoice from my host?', 'How do tolls and tickets work?'];
  end if;

  -- 3) Supercharging costs: first chip during the trip, and after it (receipt).
  if t.starts_at is not null and now() >= t.starts_at then
    if now() < t.ends_at then
      pool := array['What''s my Supercharging cost so far?', 'Where can I get the car washed for free?'] || pool || array['Where''s the closest Supercharger?', 'Can I get a charging receipt?'];
    else
      pool := array['What did I spend on Supercharging?', 'Can I get a charging receipt?'] || pool;
    end if;
  end if;
  -- 4) Around pickup: the phone key's "Set Up" step.
  if t.starts_at is not null and h between -1.5 and 2.5 then
    pool := array['The Tesla app says "Set Up". What do I do?'] || pool;
  end if;

  -- Dedupe, skip anything already asked, keep 4.
  foreach s in array pool loop
    exit when array_length(out, 1) >= 3;
    continue when s ~* 'early';
    continue when s = any(out);
    continue when lower(rtrim(s, '?.')) = any(select rtrim(a, '?.') from unnest(asked) a);
    out := out || s;
  end loop;
  out := out || 'Can I pick up or return the car early?'::text; -- pinned: always offered
  return to_jsonb(out);
end $function$;
