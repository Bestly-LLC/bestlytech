-- Ava can tell a short story about Jared on outbound calls to his saved contacts.
-- Stories are ordinary ava_knowledge rows whose topic starts "Story:" (personal scope). Only live + active rows are told, and
-- never to strangers or voicemail (ava-assistant passes them only when the number is a saved contact). Add, edit or turn them
-- off on "What Ava can share". The first one is a true draft from this week, OFF until Jared turns it on.

insert into public.ava_knowledge (scope, topic, fact, active, status)
select 'personal', 'Story: my own bots took my site down',
  'This week Jared''s own automations sent so many requests that his websites hit a free-plan limit and showed a "rate limited" error page for a while. He had to move things around so his bots stop taking down his own site. He found it pretty funny afterwards.',
  false, 'live'
where not exists (select 1 from public.ava_knowledge k where k.scope = 'personal' and k.topic = 'Story: my own bots took my site down');
