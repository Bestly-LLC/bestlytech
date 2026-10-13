-- Unique-content system, part 4: legacy look rows, series, segments and upcoming topics (rename any of it in the tables)
-- legacy rows: every video already made counts as a look the new ones must differ from (layout 'legacy', hook 'unknown')
insert into public.studio_look_ledger (job_id, brand_slug, item_id, item_code, fingerprint, opening, hook, state, superseded, created_at, filed_at)
select j.id, j.client_slug, j.item_id, i.code,
       jsonb_build_object('layout', 'legacy', 'hook', 'unknown', 'accent', coalesce(j.script->>'theme', 'x'),
                          'track', (select u.track_id::text from studio_music_uses u where u.job_id = j.id limit 1),
                          'end', case when jsonb_array_length(coalesce(j.script#>'{end,chips}', '[]'::jsonb)) > 0 then 'chips' else 'plain' end,
                          'icon', case when (j.script#>'{scenes,0,icon}') is not null then 'orbit' else 'none' end),
       left(coalesce(j.script#>>'{scenes,0,line}', '') || ' ' || coalesce(j.script#>>'{scenes,0,say}', ''), 400),
       'unknown', 'filed',
       exists (select 1 from studio_video_jobs j2 where j2.item_id = j.item_id and j2.status = 'done' and j2.created_at > j.created_at),
       j.created_at, j.finished_at
  from studio_video_jobs j left join approval_items i on i.id = j.item_id
 where j.status = 'done' and j.script is not null
on conflict (job_id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- seeds: one numbered series per house brand (8 episodes), 2-3 named segments each, and the upcoming-topics queue (rename any of it here)
insert into public.studio_series (brand_slug, name, label, total) values
  ('bestly-cloud', 'Bestly Cloud tips', 'Tip', 8), ('bestly-studio', 'Bestly Studio post tips', 'Tip', 8),
  ('bestly-agent', 'Maya Minute', 'Episode', 8), ('inventoryproof', 'InventoryProof home tips', 'Tip', 8),
  ('cookie-yeti', 'Cookie Yeti banner school', 'Lesson', 8), ('hoku', 'HOKU mist moments', 'Moment', 8)
on conflict (brand_slug) do nothing;

insert into public.studio_segments (brand_slug, key, kicker, blurb, hooks, sort) values
  ('bestly-cloud', 'quick-fix', 'Quick fix', 'one small, concrete thing a small business owner can do today about files, logins, passwords or backups', '{problem,question,story}', 1),
  ('bestly-cloud', 'myth-or-fact', 'Myth or fact', 'a common belief about business files, passwords or owning your data, and the plain truth', '{myth}', 2),
  ('bestly-cloud', 'box-talk', 'Box talk', 'a plain answer to a question owners ask about keeping everything in one box they own', '{question,stat}', 3),
  ('bestly-studio', 'post-tip', 'Post tip', 'one useful tip for making a social media post', '{problem,question,stat}', 1),
  ('bestly-studio', 'myth-or-fact', 'Myth or fact', 'a common belief about posting on social media, and the plain truth', '{myth}', 2),
  ('bestly-studio', 'quick-fix', 'Quick fix', 'fix one posting habit with one small change', '{problem,story}', 3),
  ('bestly-agent', 'missed-call', 'Missed call', 'what happens when a busy owner cannot pick up the phone', '{story,problem}', 1),
  ('bestly-agent', 'maya-at-work', 'Maya at work', 'one thing Maya, the AI receptionist, does for a business', '{stat,question}', 2),
  ('bestly-agent', 'plain-answer', 'Plain answer', 'a plain answer to a question owners ask about an AI receptionist', '{question,myth}', 3),
  ('inventoryproof', 'five-minute-fix', 'Five minute fix', 'one small step toward a home inventory that takes a few minutes', '{problem,stat,story}', 1),
  ('inventoryproof', 'myth-or-fact', 'Myth or fact', 'a common belief about keeping track of what you own, and the plain truth', '{myth}', 2),
  ('inventoryproof', 'good-to-know', 'Good to know', 'one practical fact about being able to show what you own', '{question,stat}', 3),
  ('cookie-yeti', 'banner-decoder', 'Banner decoder', 'what one part of a cookie banner really does', '{question,problem,stat}', 1),
  ('cookie-yeti', 'myth-or-fact', 'Myth or fact', 'a common belief about cookie banners, and the plain truth', '{myth}', 2),
  ('cookie-yeti', 'quick-fix', 'Quick fix', 'one small thing a person can do about cookie banners', '{problem,story}', 3),
  ('hoku', 'mist-moment', 'Mist moment', 'an ordinary moment when someone would reach for a face mist; nothing about skin results', '{story,problem}', 1),
  ('hoku', 'can-facts', 'Can facts', 'one plain fact about the sealed can and how it sprays', '{stat,question}', 2),
  ('hoku', 'myth-or-fact', 'Myth or fact', 'a belief about how a mist can is made or how it sprays; packaging only, nothing about skin', '{myth}', 3)
on conflict (brand_slug, key) do nothing;

insert into public.studio_series_topics (brand_slug, ep, topic, brief) values
  ('bestly-cloud', 2, 'Files scattered across personal accounts', 'One idea: work files that sit in personal accounts and drives, and what it costs a small business when someone leaves or loses a login.'),
  ('bestly-cloud', 3, 'Per-person software fees', 'One idea: per-person software fees that nobody adds up, and why a flat setup is easier to plan around.'),
  ('bestly-cloud', 4, 'Passwords shared in a group chat', 'One idea: passwords passed around in group chats and sticky notes, and one safer place to keep them.'),
  ('bestly-cloud', 5, 'A backup nobody tested', 'One idea: a backup nobody has ever tried to restore, and the simple question to ask about yours.'),
  ('bestly-cloud', 6, 'Who holds the keys', 'One idea: who actually holds the keys to the business domain, email admin and bank logins.'),
  ('bestly-cloud', 7, 'Can you take your data with you', 'One idea: data you cannot export is not really yours, and what open formats change.'),
  ('bestly-cloud', 8, 'One box instead of many services', 'One idea: too many separate services for one small team, and what one box in the office can hold.'),
  ('bestly-studio', 2, 'The photos already on your phone', 'One idea: the photos already on your phone are enough to start a post.'),
  ('bestly-studio', 3, 'One idea per post', 'One idea: one idea per post works better than five.'),
  ('bestly-studio', 4, 'Post what changed this week', 'One idea: post what changed this week, such as new hours, new stock or a finished job.'),
  ('bestly-studio', 5, 'A caption is one thing, said plainly', 'One idea: a caption is one thing said plainly, not a speech.'),
  ('bestly-studio', 6, 'A short video needs one idea', 'One idea: a short video needs one idea, not a script.'),
  ('bestly-studio', 7, 'Check a post from your phone', 'One idea: checking a post on your phone between jobs beats writing one at night.'),
  ('bestly-studio', 8, 'Same colors and fonts every time', 'One idea: people recognize the same colors and fonts every time.'),
  ('bestly-agent', 1, 'A missed call', 'One idea: a missed call can send a customer elsewhere, and what an AI receptionist does about it.'),
  ('bestly-agent', 2, 'Maya books the appointment', 'One idea: Maya books the appointment on the business calendar while the owner is busy.'),
  ('bestly-agent', 3, 'The apps Maya connects to', 'One idea: Maya connects to the apps a business already uses, such as its calendar and customer list.'),
  ('bestly-agent', 4, 'Calls, texts and website chat', 'One idea: Maya handles calls, texts and website chat in one place.'),
  ('bestly-agent', 5, 'Many languages, one receptionist', 'One idea: Maya works in more than ninety languages, so more customers get an answer.'),
  ('bestly-agent', 6, 'You can see every call', 'One idea: the owner can see every call Maya takes.'),
  ('bestly-agent', 7, 'What a month costs', 'One idea: plans start at forty-nine dollars a month, no setup fee, thirty days to get your money back.'),
  ('bestly-agent', 8, 'Hear Maya before you decide', 'One idea: you can hear a demo of Maya at bestly.tech/agent before you decide.'),
  ('inventoryproof', 2, 'Serial numbers in one place', 'One idea: write down serial numbers once, in one place, before you need them.'),
  ('inventoryproof', 3, 'Receipts you can find later', 'One idea: keep receipts where you can find them later.'),
  ('inventoryproof', 4, 'Start with one room', 'One idea: start a home inventory with one room, not the whole house.'),
  ('inventoryproof', 5, 'A list made in calm weather', 'One idea: the list you make in calm weather is the one you will be glad you have.'),
  ('inventoryproof', 6, 'Warranties people forget', 'One idea: warranties are easy to forget until something breaks.'),
  ('inventoryproof', 7, 'A list for renters', 'One idea: renters own things worth listing too.'),
  ('inventoryproof', 8, 'Your valuables, photographed', 'One idea: a photo of each valuable is a record you can show later.'),
  ('cookie-yeti', 2, 'Pre-ticked boxes', 'One idea: pre-ticked boxes on a cookie banner, and what unticking them means.'),
  ('cookie-yeti', 3, 'Why reject is hard to find', 'One idea: why the reject button is often harder to find than accept.'),
  ('cookie-yeti', 4, 'Consent fatigue', 'One idea: banners on every visit make people click accept without reading.'),
  ('cookie-yeti', 5, 'The second screen', 'One idea: the second screen behind a cookie banner.'),
  ('cookie-yeti', 6, 'What reject removes', 'One idea: what pressing reject actually removes.'),
  ('cookie-yeti', 7, 'Why banners exist', 'One idea: why cookie banners exist at all.'),
  ('cookie-yeti', 8, 'When Cookie Yeti steps back', 'One idea: when Cookie Yeti does not recognize a banner it leaves it alone and tells you.'),
  ('hoku', 2, 'Why the can is sealed', 'One idea: the liquid sits in a sealed bag inside the can, so air never gets back in.'),
  ('hoku', 3, 'It sprays at any angle', 'One idea: it sprays at any angle, upside down included, as a fine mist.'),
  ('hoku', 4, 'Three ingredients', 'One idea: water, salt and an electric current run through them, nothing added after.'),
  ('hoku', 5, 'What we leave out', 'One idea: no fragrance, no alcohol, no oils.'),
  ('hoku', 6, 'Mist it, let it dry', 'One idea: mist it on, do not rub it in, let it dry on its own.'),
  ('hoku', 7, 'One product, not a routine', 'One idea: one product, not a routine, and it does not replace a cleanser.'),
  ('hoku', 8, 'Why it is taking time', 'One idea: why the can is taking time, said plainly.')
on conflict (brand_slug, ep) do nothing;
