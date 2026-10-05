-- RoofGuard Ava learns the program from LBMC's own site (lbmcglobal.com, read 2026-10-05), Jared's ask.
-- Rows land in ava_knowledge (scope roofguard), the list on "What Ava can share": the inbound line already reads it,
-- and outbound + demo calls now get it as {{rg_facts}}. Each one can be edited or turned off from that panel.
-- Filtered for her hard rules: no dollar figures (the site lists a per-square-foot rate; she still never says a number),
-- "renewal" not "replacement", never framed as insurance, no clients named, no other sales contacts or office line
-- (calls should come back through Ava and Eli).

insert into public.ava_knowledge (scope, topic, fact, active, status)
select v.scope, v.topic, v.fact, true, 'live'
from (values
  ('roofguard', 'The company',
   'Legacy Building Maintenance Company, LBMC, started in 2017. It''s a service-disabled veteran-owned small business based in Waynesville, Missouri, and works in all fifty states.'),
  ('roofguard', 'Experience',
   'The team has more than sixteen years of roof maintenance experience. Bill Rostad, the CEO, is a former Army combat engineer who has managed over 84 roofing companies across 27 states.'),
  ('roofguard', 'Leadership',
   'Bill Rostad is CEO. Eli Cooper is COO and runs the RoofGuard program day to day.'),
  ('roofguard', 'Who it''s for',
   'Commercial and industrial owners: a single building, a multi-site portfolio, or a large campus like manufacturing or distribution. There''s also a plan for homes and small multi-family.'),
  ('roofguard', 'What''s included',
   'Scheduled inspections once or twice a year, service calls, and scheduled renewal work, with one roofing partner across every facility. Every inspection comes with photos and a written report, and there''s a dashboard for the whole portfolio.'),
  ('roofguard', 'Roof renewal',
   'About a tenth of the roof surface is renewed every year, so over the ten-year program the whole roof gets renewed. That stretches the roof''s life and pushes off or avoids a big capital roof project.'),
  ('roofguard', 'Response time',
   'Priority response around the clock. After they report a problem, LBMC inspects within twenty-four hours and starts repairs, and finishes within thirty days, weather permitting.'),
  ('roofguard', 'Getting started',
   'First a professional inspection documents each roof''s condition. Anything that''s off gets brought up to a serviceable standard, by LBMC or their own roofer with a re-inspection, and then the program starts. That upfront work is separate from the monthly program.'),
  ('roofguard', 'The agreement',
   'It''s a ten-year maintenance agreement that renews automatically unless either side gives ninety days'' written notice. Billing can be yearly, twice a year, quarterly or monthly. Eli walks through the terms on the call.'),
  ('roofguard', 'Storms',
   'For roofs in good standing, the program handles renewing the roof after natural disasters like tornadoes, hurricanes and floods. It doesn''t cover what''s inside the building or lost business. It''s still a maintenance agreement, not insurance; Eli covers the details.'),
  ('roofguard', 'Accounting',
   'Most businesses book it as an operating expense on a service contract, not a capital expense. Their accountant confirms how it applies to them.'),
  ('roofguard', 'Crews',
   'Everyone who works on site passes a background check, a driving record check where they drive, and a drug screen. LBMC carries full contractor coverage and names the customer as an additional insured.'),
  ('roofguard', 'Website',
   'The website is lbmcglobal.com. For anything specific, the next step is still the call with Eli.')
) as v(scope, topic, fact)
where not exists (select 1 from public.ava_knowledge k where k.scope = v.scope and k.topic = v.topic);
