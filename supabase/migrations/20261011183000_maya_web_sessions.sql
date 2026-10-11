-- Maya on bestly.tech: signed web sessions (Jared, 2026-10-11: "ensure Maya is protected from the agent ID issue").
--
-- Maya's ElevenLabs agent goes private (enable_auth). The website no longer connects with her public agent id; it asks
-- the maya-session edge function, which checks the page's origin and per-visitor / site-wide limits, then mints a
-- short-lived signed URL. This table is that function's ledger: one row per session handed out, plus what the
-- visitor's browser reported when something failed (kind = 'diag').
--
-- No emails or phones here. ip_hash is a peppered SHA-256 of the visitor's IP, kept only to rate-limit; rows older
-- than 3 days are pruned by the function itself on insert, so there is no separate cron to own.

create table if not exists public.maya_web_sessions (
  id          bigserial primary key,
  kind        text not null default 'session' check (kind in ('session', 'refused', 'diag')),
  ip_hash     text not null,
  origin      text,
  page        text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists maya_web_sessions_ip_idx on public.maya_web_sessions (ip_hash, created_at desc);
create index if not exists maya_web_sessions_at_idx on public.maya_web_sessions (created_at desc);

-- Service role only (the edge function). No policies on purpose: anon and authenticated get nothing.
alter table public.maya_web_sessions enable row level security;

comment on table public.maya_web_sessions is
  'maya-session ledger: signed web sessions handed to bestly.tech visitors, refusals, and client diagnostics. No PII; ip_hash is peppered and pruned after 3 days.';

-- Team card: the door is a tool of Maya; Line Check (maya-watch) probes it every 10 minutes and owns maya.site alerts.
select public.team_onboard('[{"slug":"maya-web-door","name":"Web Door","role":"Maya''s signed website sessions","tool_of":"maya","reports_to":"maya","runs_on":"cloud","schedule":"on demand, when a visitor taps Talk to Maya","what_it_does":"Maya''s agent is private, so bestly.tech visitors start a chat through this door. It checks the page is really bestly.tech, holds each visitor to 10 chats an hour and 20 a day and the whole site to 150 a day, then hands back a short-lived signed link. Nobody can use her agent id to run up minutes. Line Check tests it every 10 minutes and switches her privacy back on if it ever drifts.","pulse":{"gap":25,"job":"maya-watch","src":"cron"},"owns":["maya.site"],"icon":"shield"}]'::jsonb);
