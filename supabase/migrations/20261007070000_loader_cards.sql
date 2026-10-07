-- Loader cards: something worth reading while an admin page loads (docs/loader-cards-opusplan.md).
-- wall_quotes (the wall's quote deck, synced by the Pi), admin_loader_cards() for the admin shell,
-- partner_loader_quotes() for the partner portal (quotes only, never Jared's data).

create table if not exists public.wall_quotes (
  id text primary key,
  text text not null,
  author text,
  kind text not null default 'quote' check (kind in ('quote','mantra')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.wall_quotes enable row level security;

create policy "Admins read wall quotes" on public.wall_quotes
  for select using (public.has_role(auth.uid(), 'admin'::public.app_role));

insert into public.wall_quotes (id, text, author, kind) values
  ('39453fd176', 'Don''t follow your passion, follow your talent.', 'Scott Galloway', 'quote'),
  ('abc1c714d0', 'Greatness is in the agency of others.', 'Scott Galloway', 'quote'),
  ('6163e1e3d1', 'There''s no such thing as balance, only trade-offs. You can have it all, just not at the same time.', 'Scott Galloway', 'quote'),
  ('e5f055e1f9', 'Expect that a certain amount of failure is out of your control, and recognize you may need to endure it or move on.', 'Scott Galloway', 'quote'),
  ('d6a8fc3bff', 'The brick walls are there for a reason. They let us prove how badly we want something.', 'Randy Pausch', 'quote'),
  ('d94da94767', 'We cannot change the cards we are dealt, just how we play the hand.', 'Randy Pausch', 'quote'),
  ('199b2891f6', 'Experience is what you get when you didn''t get what you wanted.', 'Randy Pausch', 'quote'),
  ('695107df7f', 'It''s kind of fun to do the impossible.', 'Walt Disney', 'quote'),
  ('34640be752', 'The way to get started is to quit talking and begin doing.', 'Walt Disney', 'quote'),
  ('4e52d59a27', 'We keep moving forward, opening new doors, and doing new things, because we''re curious.', 'Walt Disney', 'quote'),
  ('cd93554590', 'All our dreams can come true, if we have the courage to pursue them.', 'Walt Disney', 'quote'),
  ('c3d36d3ba6', 'Mars is there, waiting to be reached.', 'Buzz Aldrin', 'quote'),
  ('023a2d16ec', 'Stay hungry. Stay foolish.', 'Steve Jobs', 'quote'),
  ('7ec6f860fc', 'Design is not just what it looks like and feels like. Design is how it works.', 'Steve Jobs', 'quote'),
  ('c3e92bedac', 'You can''t connect the dots looking forward. You can only connect them looking backwards.', 'Steve Jobs', 'quote'),
  ('e805d211ea', 'Your time is limited, so don''t waste it living someone else''s life.', 'Steve Jobs', 'quote'),
  ('df145e0581', 'Nothing in life is to be feared, it is only to be understood.', 'Marie Curie', 'quote'),
  ('667e2d4969', 'Be less curious about people and more curious about ideas.', 'Marie Curie', 'quote'),
  ('176e378068', 'One never notices what has been done; one can only see what remains to be done.', 'Marie Curie', 'quote'),
  ('55da47f27c', 'Ship it, then polish it.', null, 'mantra'),
  ('161e8323ed', 'One thing at a time. This one.', null, 'mantra'),
  ('7cfce18d3b', 'Done beats perfect.', null, 'mantra'),
  ('4f610f1f74', 'Make it obvious.', null, 'mantra'),
  ('e9fb9ac93b', 'Small steps, every day.', null, 'mantra'),
  ('a94ffe9859', 'Future you says thanks.', null, 'mantra'),
  ('373c01074c', 'Bet on yourself.', null, 'mantra'),
  ('3e19a8abb2', 'Be the calm in the room.', null, 'mantra'),
  ('9ba395fba4', 'Strength does not come from physical capacity. It comes from an indomitable will.', 'Mahatma Gandhi', 'quote'),
  ('1232c42d04', 'The weak can never forgive. Forgiveness is the attribute of the strong.', 'Mahatma Gandhi', 'quote'),
  ('e81022495e', 'A man is but the product of his thoughts. What he thinks, he becomes.', 'Mahatma Gandhi', 'quote'),
  ('dfa1b6b06b', 'It has always been easier to destroy than to create.', 'Mahatma Gandhi', 'quote'),
  ('aafb86d749', 'Truth never damages a cause that is just.', 'Mahatma Gandhi', 'quote'),
  ('b9d96f282b', 'Earth provides enough to satisfy every man''s need but not for every man''s greed.', 'Mahatma Gandhi', 'quote'),
  ('b06a8d8f17', 'Imagination is more important than knowledge.', 'Albert Einstein', 'quote'),
  ('dce16f03af', 'Life is like riding a bicycle. To keep your balance you must keep moving.', 'Albert Einstein', 'quote'),
  ('b0ee0b6ecf', 'The important thing is not to stop questioning.', 'Albert Einstein', 'quote'),
  ('32a241d7e1', 'I have no special talents. I am only passionately curious.', 'Albert Einstein', 'quote'),
  ('78e07c1607', 'Try not to become a man of success, but a man of value.', 'Albert Einstein', 'quote'),
  ('f5739307e2', 'I never think of the future. It comes soon enough.', 'Albert Einstein', 'quote'),
  ('d69bea365e', 'Hatred does not cease by hatred, but only by love.', 'The Buddha, Dhammapada', 'quote'),
  ('6f5e16d325', 'Health is the greatest gift, contentment the greatest wealth.', 'The Buddha, Dhammapada', 'quote'),
  ('c7d9cae830', 'Better than a thousand hollow words is one word that brings peace.', 'The Buddha, Dhammapada', 'quote'),
  ('c93a23f51d', 'Drop by drop is the water pot filled.', 'The Buddha, Dhammapada', 'quote'),
  ('eb8d1e3c88', 'What we think, we become.', 'attributed to the Buddha', 'quote'),
  ('91578fc4c8', 'Peace comes from within. Do not seek it without.', 'attributed to the Buddha', 'quote'),
  ('ea94e44afe', 'True simplicity is derived from so much more than just the absence of clutter and ornamentation.', 'Jony Ive', 'quote'),
  ('645edefb0c', 'I think a beautiful product that doesn''t work very well is ugly.', 'Jony Ive', 'quote'),
  ('b2c6b84430', 'The memory of how we work will endure beyond the products of our work.', 'Jony Ive', 'quote'),
  ('f59acfdf46', 'The delight and joy of curiosity and learning can temper our fear of doing something completely new.', 'Jony Ive', 'quote'),
  ('5d0698d8b3', 'Very often design is the most immediate way of defining what products become in people''s minds.', 'Jony Ive', 'quote'),
  ('793a0bf346', 'The defining qualities are about use: ease and simplicity.', 'Jony Ive', 'quote'),
  ('7f9b24e5a0', 'It takes a lot of money to look this cheap.', 'Dolly Parton', 'quote'),
  ('1a287deb83', 'The way I look was really a country girl''s idea of what glamour was.', 'Dolly Parton', 'quote'),
  ('ad8e27007f', 'Find out who you are and do it on purpose.', 'attributed to Dolly Parton', 'quote'),
  ('6f794401cc', 'Don''t get so busy making a living that you forget to make a life.', 'attributed to Dolly Parton', 'quote'),
  ('2a3f10f885', 'Born a wildlife warrior, die a wildlife warrior.', 'Steve Irwin', 'quote'),
  ('ead18ea343', 'Crikey means gee whiz, wow!', 'Steve Irwin', 'quote'),
  ('969f79c03d', 'We''re all trying to do the same thing. Live well.', 'Martha Stewart', 'quote'),
  ('17d8a1103e', 'You''re only given a little spark of madness and if you lose that, you''re nothin''.', 'Robin Williams', 'quote'),
  ('4fd65a70af', 'In this industry, interest in you comes in waves, it''s so tidal.', 'Heath Ledger', 'quote'),
  ('fe1c1f56a6', 'I do a lot of my best thinking in those kind of in-between moments.', 'Christopher Nolan', 'quote'),
  ('2c85da8c67', 'Clear beats clever.', null, 'mantra'),
  ('cd6a580f21', 'Start before you''re ready.', null, 'mantra'),
  ('10540993d9', 'Make the next step small.', null, 'mantra'),
  ('5b2ef6be1b', 'Finish one thing today.', null, 'mantra'),
  ('ed9a745819', 'Kind, clear, and quick.', null, 'mantra'),
  ('6653c296dd', 'Build what you wish existed.', null, 'mantra'),
  ('12518853e8', 'Ask. The worst answer is no.', null, 'mantra'),
  ('7f89e82997', 'Progress, not perfection.', null, 'mantra'),
  ('b635bbd475', 'Rest is part of the work.', null, 'mantra'),
  ('6f8bd73d60', 'Say it plainly.', null, 'mantra'),
  ('c512bb038a', 'Momentum loves a deadline.', null, 'mantra'),
  ('0246db37b9', 'Protect the morning.', null, 'mantra'),
  ('4b6a319de9', 'Ship small, ship often.', null, 'mantra'),
  ('3889a3bb19', 'Good enough, then better.', null, 'mantra'),
  ('2ff35ac3ee', 'You''ve done hard things before.', null, 'mantra'),
  ('59e47cf65b', 'Breathe. Then decide.', null, 'mantra'),
  ('9514c86635', 'Talk to one customer today.', null, 'mantra'),
  ('82eddd50d9', 'Leave it better than you found it.', null, 'mantra'),
  ('46b0421867', 'Curious beats certain.', null, 'mantra'),
  ('2f533eb69d', 'Make it easy to say yes.', null, 'mantra')
on conflict (id) do update
  set text = excluded.text, author = excluded.author, kind = excluded.kind, updated_at = now();

-- Admin shell deck: useful cards built from Jared's own data (server-side so the client stays dumb),
-- plus the active quotes. Skips any card whose feed is missing or older than 24 hours; never cuts text
-- (text over 140 characters or a second line over 60 characters is dropped, not shortened).
create or replace function public.admin_loader_cards()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_facts jsonb := '[]'::jsonb;
  v_quotes jsonb;
  v_n int;
  v_text text;
  v_sub text;
  v_author text;
  d jsonb;
  u timestamptz;
  e jsonb;
  v_aqi numeric;
  v_uv numeric;
begin
  perform public.admin_require_admin();

  -- 1. The one thing
  begin
    select o.text, o.checked_at into v_sub, u from public.wall_one_thing o order by o.id limit 1;
    if v_sub is not null and u > now() - interval '24 hours' then
      v_text := 'Today''s one thing';
      if length(v_sub) <= 60 then
        v_facts := v_facts || jsonb_build_array(jsonb_build_object('kind','fact','text',v_text,'sub',v_sub));
      end if;
    end if;
  exception when others then null; end;

  -- 2. Needs you
  begin
    select count(*) into v_n from public.admin_today_rows() t where t.rank <= 1;
    if v_n > 0 then
      v_facts := v_facts || jsonb_build_array(jsonb_build_object(
        'kind','fact',
        'text', v_n::text || case when v_n = 1 then ' thing needs you' else ' things need you' end,
        'sub','Scout has the detail'));
    else
      v_facts := v_facts || jsonb_build_array(jsonb_build_object('kind','fact','text','Nothing needs you right now.'));
    end if;
  exception when others then null; end;

  -- 3. Turo
  begin
    select f.data, f.updated_at into d, u from public.wall_feeds f where f.kind = 'turo';
    if d is not null and u > now() - interval '24 hours' and round(coalesce((d->>'today')::numeric,0)) + round(coalesce((d->>'week')::numeric,0)) > 0 then
      v_text := 'Turo: $' || to_char(round(coalesce((d->>'today')::numeric,0)), 'FM999,999,999')
             || ' today, $' || to_char(round(coalesce((d->>'week')::numeric,0)), 'FM999,999,999') || ' this week';
      v_sub := null;
      select x into e from jsonb_array_elements(coalesce(d->'calendar','[]'::jsonb)) x
        where x->>'date' = v_today::text and x->>'status' = 'booked' and x->>'car' is not null
        order by case x->>'part' when 'end' then 1 else 0 end limit 1;
      if e is not null then
        v_sub := case when e->>'part' = 'end' and e->>'guest' is not null
                      then (e->>'car') || ' comes back from ' || (e->>'guest') || ' today'
                      when e->>'guest' is not null
                      then (e->>'car') || ' is out with ' || (e->>'guest')
                      else (e->>'car') || ' is booked today' end;
      end if;
      if length(v_text) <= 140 and (v_sub is null or length(v_sub) <= 60) then
        v_facts := v_facts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind','fact','text',v_text,'sub',v_sub)));
      end if;
    end if;
  exception when others then null; end;

  -- 4. Deliveries (first item; a delivered one older than a day is old news)
  begin
    select f.data, f.updated_at into d, u from public.wall_feeds f where f.kind = 'deliveries';
    if d is not null and u > now() - interval '24 hours' and jsonb_typeof(d) = 'array' and jsonb_array_length(d) > 0 then
      e := d->0;
      if e->>'what' is not null and e->>'status' is not null
         and not (lower(e->>'status') like 'deliver%' and coalesce((e->>'at')::timestamptz, now() - interval '2 days') < now() - interval '24 hours') then
        v_text := (e->>'what') || ' is ' || lower(e->>'status');
        v_sub := nullif(e->>'carrier','');
        if v_sub is not null and position(lower(v_sub) in lower(v_text)) > 0 then v_sub := null; end if;
        if length(v_text) <= 140 and (v_sub is null or length(v_sub) <= 60) then
          v_facts := v_facts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind','fact','text',v_text,'sub',v_sub)));
        end if;
      end if;
    end if;
  exception when others then null; end;

  -- 5. Mail
  begin
    select f.data, f.updated_at into d, u from public.wall_feeds f where f.kind = 'mail';
    if d is not null and u > now() - interval '24 hours' and coalesce((d->>'today')::int,0) > 0 then
      v_n := (d->>'today')::int;
      v_text := v_n::text || case when v_n = 1 then ' piece of mail today' else ' pieces of mail today' end;
      v_sub := nullif(replace(coalesce(d->'items'->>0,''), ' — ', ' '), '');
      if v_sub is null or length(v_sub) <= 60 then
        v_facts := v_facts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind','fact','text',v_text,'sub',v_sub)));
      end if;
    end if;
  exception when others then null; end;

  -- 6. Air (only when it is worth knowing)
  begin
    select f.data, f.updated_at into d, u from public.wall_feeds f where f.kind = 'air';
    if d is not null and u > now() - interval '24 hours' then
      v_aqi := (d->>'aqi')::numeric;
      v_uv := coalesce((d->>'uv')::numeric, 0);
      if v_aqi is not null and (v_aqi >= 51 or v_uv >= 6) then
        v_text := 'Air quality ' || round(v_aqi)::text || coalesce(', ' || nullif(lower(d->>'label'), ''), '');
        v_sub := 'UV ' || round(v_uv)::text;
        v_facts := v_facts || jsonb_build_array(jsonb_build_object('kind','fact','text',v_text,'sub',v_sub));
      end if;
    end if;
  exception when others then null; end;

  -- 7. Scout's paid AI spend
  begin
    select f.data, f.updated_at into d, u from public.wall_feeds f where f.kind = 'claude';
    if d is not null and u > now() - interval '24 hours'
       and coalesce((d->>'pct')::numeric, 0) >= 50
       and coalesce((d->>'resets_at')::timestamptz, now() + interval '1 hour') > now() then
      v_text := 'Scout''s paid AI: $' || to_char((d->>'spent_usd')::numeric, 'FM999,990.00')
             || ' of $' || to_char((d->>'cap_usd')::numeric, 'FM999,990.00') || ' today';
      v_facts := v_facts || jsonb_build_array(jsonb_build_object('kind','fact','text',v_text));
    end if;
  exception when others then null; end;

  -- 8. Today's Leo line (one a day, shown like a quote)
  begin
    select f.data, f.updated_at into d, u from public.wall_feeds f where f.kind = 'leo';
    if d is not null and u > now() - interval '24 hours' and d->>'date' = v_today::text
       and nullif(d->>'line','') is not null and length(d->>'line') <= 140 then
      v_facts := v_facts || jsonb_build_array(jsonb_build_object('kind','quote','text',d->>'line','author','Today''s Leo'));
    end if;
  exception when others then null; end;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',q.id,'text',q.text,'author',q.author,'kind',q.kind)) order by q.id), '[]'::jsonb)
    into v_quotes
    from public.wall_quotes q
   where q.active and length(q.text) <= 140;

  return jsonb_build_object('facts', v_facts, 'quotes', v_quotes, 'built_at', now());
end;
$fn$;

revoke all on function public.admin_loader_cards() from public, anon;
grant execute on function public.admin_loader_cards() to authenticated;

-- Partner portal (Eli's view): quotes only, never any of Jared's data. Any signed-in user.
create or replace function public.partner_loader_quotes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',q.id,'text',q.text,'author',q.author,'kind',q.kind)) order by q.id)
      from public.wall_quotes q
     where q.active and length(q.text) <= 140
  ), '[]'::jsonb);
end;
$fn$;

revoke all on function public.partner_loader_quotes() from public, anon;
grant execute on function public.partner_loader_quotes() to authenticated;
