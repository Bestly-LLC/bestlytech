-- Maya Phase 3 "Hands": team cards. Maya keeps every existing field and gains her billing tool; the line check now
-- also watches the billing tools and endpoint. "welcome" is false so nobody gets a second welcome email.
select public.team_onboard($j$[
 {"slug":"maya","name":"Maya","role":"Sales & Support Rep","dept":"sales","reports_to":"jared","runs_on":"cloud","icon":"phone-call","sort":63,
  "admin_url":"/admin/maya","schedule":"answers (213) 641-0074 any time; inbound only","welcome":false,
  "what_it_does":"Answers (213) 641-0074 for every Bestly product. Support comes first: she walks callers through fixes from each product's knowledge base and never pitches while a problem is open. Anything she can't fix becomes a ticket with a code she reads to the caller (like M-4821): support and billing due in 1 business day, call-backs in 4 hours, privacy requests in 45 days per CCPA. Every ticket pushes to Jared signed by Maya. Also sells the Bestly Agent and files demo requests as leads. On inbound calls she can verify a caller by an emailed code, read their billing, email a card-update link, cancel or pause a subscription, and refund up to the cap you set (default $25, one per customer per 30 days, $100 a day); anything over a limit becomes a billing ticket.",
  "pulse":{"ok":"ok","col":"checked_at","gap":30,"src":"at","sum":"case when ok then 'Line OK' else 'Line problem' end","also":["maya-watch"],"alert":true,"table":"ava_line_health","where":"source = 'maya'"},
  "owns":["maya","maya-ticket","maya-billing"]},
 {"slug":"maya-line-check","name":"Line Check","role":"Phone line check","tool_of":"maya","dept":"sales","runs_on":"cloud","icon":"activity","sort":50,"schedule":"every 10 min","welcome":false,
  "what_it_does":"Every 10 minutes checks Maya's agent, number, Telnyx route, ticket desk and billing tools. Puts the route back, reassigns the number or re-attaches her ticket and billing tools on its own if any breaks. Probes her billing endpoint and its Stripe, email and ElevenLabs health. Flags tickets past their promised follow-up time and privacy requests within 10 days of the 45-day legal deadline.",
  "pulse":{"gap":25,"job":"maya-watch","src":"cron"}},
 {"slug":"maya-billing","name":"Billing Hands","role":"Maya's account and billing tools","tool_of":"maya","dept":"sales","runs_on":"cloud","icon":"credit-card","sort":51,"schedule":"on demand, during inbound calls","welcome":false,
  "what_it_does":"Lets Maya help a verified caller with their account on the phone: emailed six-digit code check, billing and recent charges, card-update link, cancel or pause, and small refunds. Every limit is enforced on the server, not in her prompt: $25 per refund, one per customer per 30 days, $100 a day across everyone, and a kill switch. Anything over a limit becomes a billing ticket. Every action is logged with the email masked.",
  "pulse":{"gap":25,"job":"maya-watch","src":"cron"},
  "owns":["maya-billing"]}
]$j$::jsonb);
