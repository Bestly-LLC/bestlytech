-- Ava demo calls from the partner portal (Spark, 2026-10-04).
-- Eli types a phone number and Ava calls it, so investors (and Bill, who owns RoofGuard) can hear her live.
-- Demo calls always play one fictional facility, never a real lead, and are capped per day.

alter table public.rg_settings add column if not exists demo_lead_id uuid references public.rg_leads(id) on delete set null;
alter table public.rg_settings add column if not exists demo_daily_cap int not null default 15;

-- The fictional facility. No phone and marked do-not-call, so the dialer can never queue it.
with ins as (
  insert into public.rg_leads (company, state, timezone, risk_tier, contacts, category, pitch, pitch_source,
                               enrich_status, dnc, priority, notes)
  values ('Riverside Medical Center (demo)', 'MO', 'America/Chicago', 'LOW', '[]'::jsonb, 'healthcare',
          'a 24/7 hospital campus where one leak over an operating room or imaging suite shuts down care', 'bespoke',
          'not_found', true, 0, 'Demo facility for partner-portal demo calls. Never dialed by the queue.')
  returning id)
update public.rg_settings set demo_lead_id = (select id from ins) where id and demo_lead_id is null;
