-- Dyson Connector (Pi cron job `dyson_connect`, every 10 min): connects the Studio Dyson to Home Assistant by itself once the fan is
-- back on Wi-Fi, using the local login Homebridge already holds. Reports to Scout under the ha.dyson prefix.
-- Applied by hand on 2026-10-05; kept here so the card can be rebuilt. Needs an admin session (team_onboard checks team_is_admin()).
select public.team_onboard('[{
  "slug":"ha-dyson-connect","name":"Dyson Connector","role":"Connects the Studio Dyson to Home Assistant",
  "what_it_does":"Every 10 minutes checks whether the Studio Dyson purifier answers on Wi-Fi and, the moment it does, adds it to Home Assistant using the local login Homebridge already holds. Tells Scout when it connects, and once a day if the fan stays offline over an hour or refuses to connect.",
  "reports_to":"home-hub","runs_on":"pi","schedule":"every 10 min","icon":"fan",
  "pulse":{"src":"pi_job","key":"dyson_connect","gap":30},"owns":["ha.dyson"]}]'::jsonb);
