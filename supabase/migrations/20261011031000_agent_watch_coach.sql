-- Agent template layer, Phase 2: the line keeper (agent-watch) and the call coach (agent-coach).
-- Plan: docs/agent-template-opusplan.md. Edge functions: supabase/functions/agent-watch, supabase/functions/agent-coach.
--
-- Cron jobs (pg_cron runs in UTC; the weekly job is 6:30 AM Pacific in daylight time and 5:30 AM after the clocks go back):
--   agent-watch         8-59/10 * * * *    Switchboard: webhook, tools, number, sync last 20, spend cap, writes agent_health
--   agent-coach         11-59/15 * * * *   Coach: scores new calls over 20 seconds on free AI
--   agent-coach-weekly  30 13 * * 1        Coach: proposes up to 3 playbook lines per agent from the week's fixes
--
-- Alerts: agent.line.<slug> and agent.spend.<slug>. The existing `agent` prefix belongs to team-watch ("an employee went quiet"),
-- and notification_owner() matches `prefix` or `prefix.%`, so a literal `agent.` prefix would match nothing. Switchboard owns the
-- two longer prefixes instead; longest prefix wins, so team-watch keeps everything else under `agent`.

do $c$ begin
  if not exists (select 1 from cron.job where jobname = 'agent-watch') then
    perform cron.schedule('agent-watch', '8-59/10 * * * *', $q$select public.invoke_edge_function('agent-watch', '{}'::jsonb, 100000)$q$);
  end if;
  if not exists (select 1 from cron.job where jobname = 'agent-coach') then
    perform cron.schedule('agent-coach', '11-59/15 * * * *', $q$select public.invoke_edge_function('agent-coach', '{"op":"review"}'::jsonb, 150000)$q$);
  end if;
  if not exists (select 1 from cron.job where jobname = 'agent-coach-weekly') then
    perform cron.schedule('agent-coach-weekly', '30 13 * * 1', $q$select public.invoke_edge_function('agent-coach', '{"op":"weekly"}'::jsonb, 150000)$q$);
  end if;
end $c$;

select public.team_onboard($j$[
 {"slug":"agent-watch","name":"Switchboard","role":"Agent line keeper","reports_to":"scout","runs_on":"cloud","icon":"activity","sort":64,
  "admin_url":"/admin/maya","schedule":"every 10 min","welcome":false,
  "what_it_does":"Every 10 minutes checks each live template phone agent (Maya now, new ones as they are added): the voice agent still exists, its post-call webhook is attached, every tool is attached, and its phone number points at it. Puts back whatever came off. Syncs the last 20 calls so a missed webhook never loses a call, and warns Jared when an agent is over its daily spend cap.",
  "pulse":{"gap":25,"job":"agent-watch","src":"cron"},
  "owns":["agent.line","agent.spend"]},
 {"slug":"agent-coach","name":"Coach","role":"Call coach for template agents","reports_to":"hr","runs_on":"cloud","icon":"clipboard-check","sort":65,
  "admin_url":"/admin/maya","schedule":"every 15 min, plus Mondays 6:30 AM","welcome":false,
  "what_it_does":"Reads every new call over 20 seconds from the template phone agents on free AI only, scores it 0 to 10, and writes one thing that went well and one thing to fix. Every Monday morning proposes up to 3 short playbook lines per agent from the week's fixes. Nothing reaches an agent's prompt until Jared taps Approve on the agent's page.",
  "pulse":{"gap":40,"job":"agent-coach","also":["agent-coach-weekly"],"src":"cron"}}
]$j$::jsonb);
