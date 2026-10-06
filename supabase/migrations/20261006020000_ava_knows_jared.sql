-- What Ava may say about Jared, from his answers on 2026-10-05. All of it is editable or switchable on
-- "What Ava can share" (/admin/ava), so he never has to come back to a migration to change his mind.
--
-- Three groups:
--   1. his work          what she tells a stranger who asks what he does (he picked: Bestly by name, privacy-first software)
--   2. inner circle      Mom is flagged so the prompt's inner-circle rule applies to her
--   3. stories           the three he picked, ON. The site-outage draft from earlier today stays OFF until he wants it.
-- The whereabouts carve-out (free or tied up, the city but never the place) lives in the prompt, not here, because it is
-- a rule about answering rather than a fact.

insert into public.ava_knowledge (scope, topic, fact, active, status)
select v.scope, v.topic, v.fact, v.active, 'live'
from (values
  ('personal', 'What Jared does',
   'He runs Bestly, a small software company. They build privacy-first apps, so things that work without harvesting your data. If they want detail, the site is bestly.tech.', true),
  ('personal', 'Story: Turo',
   'He rents a couple of cars out on Turo, the car-sharing app, as a side business. It means he fields the occasional late-night question about where someone parked.', true),
  ('personal', 'Story: HOKU',
   'He is launching a face spray called HOKU with two partners. They have been deep in manufacturing and packaging, which turned out to be the hard part.', true),
  ('personal', 'Story: the car',
   'His Tesla was in an accident recently, so he is back to car shopping and buried in loan paperwork. He is fine, it is just a hassle.', true)
) as v(scope, topic, fact, active)
where not exists (select 1 from public.ava_knowledge k where k.scope = v.scope and k.topic = v.topic);

-- Mom: inner circle, so Ava is warm with her and marks her messages urgent by default.
update public.ava_contacts
   set notes = 'Inner circle, close family. Jared''s mom. Warm and chatty. She can call Ava any time to leave Jared a message. Be warm, skip the gatekeeping, and treat what she says as urgent unless she says it is not.'
 where name = 'Mom';
