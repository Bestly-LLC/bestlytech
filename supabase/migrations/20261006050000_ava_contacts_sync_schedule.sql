-- The contacts sync on a schedule, plus its team card (CLAUDE.md: every bot that works on its own gets one the day it
-- goes live). Weekly is plenty: Jared adds a contact now and then, not hourly, and each run reads 1000 cards from iCloud.
-- Sunday 4:10 AM Pacific = 11:10 UTC, a quiet hour that won't collide with the hourly watchers.

select cron.schedule('ava-contacts-sync', '10 11 * * 0', $$
  select public.invoke_edge_function('ava-assistant', '{"action":"contacts_sync"}'::jsonb, 220000);
$$);

-- A tool of Ava's, not a new employee: tool_of means no welcome email, and the card sits under her.
select public.team_onboard('[{
  "slug": "ava-contacts",
  "name": "Address Book",
  "role": "Contacts Sync",
  "what_it_does": "Keeps Ava''s contact list in step with Jared''s iCloud address book, so she greets people by name instead of reading out a phone number. Reads names, numbers and companies over CardDAV; never his private notes on a contact. Rows Jared wrote by hand are left alone.",
  "tool_of": "ava",
  "runs_on": "cloud",
  "schedule": "Sundays at 4:10 AM",
  "icon": "contact",
  "admin_url": "/admin/ava",
  "sort": 55,
  "pulse": { "src": "cron", "job": "ava-contacts-sync", "gap": 11000 },
  "owns": ["ava-contacts-sync"]
}]'::jsonb);
