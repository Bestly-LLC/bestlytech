-- Partner Web Push (applied live 2026-09-22 via MCP; recorded here).
-- Each browser subscription belongs to an audience: admin alerts never reach a partner,
-- and a partner only gets his own Scout answers.
alter table public.push_subscriptions add column if not exists audience text not null default 'admin';
alter table public.push_subscriptions add column if not exists user_id uuid;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_audience_check;
alter table public.push_subscriptions add constraint push_subscriptions_audience_check check (audience in ('admin','partner'));
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_key;
create unique index if not exists push_subscriptions_endpoint_audience on public.push_subscriptions (endpoint, audience);
create index if not exists push_subscriptions_partner_user on public.push_subscriptions (user_id) where audience = 'partner';

-- push_web_send(title, body, severity, url, tag, audience default 'admin', user_id) — partner sends need a user_id.
-- partner_chat_push trigger (after update of status on partner_chat): assistant row done/error ->
-- push_web_send('Scout answered', ..., '/partner#scout', 'partner-scout', 'partner', new.user_id).
-- Full definitions: see the live database (pg_get_functiondef).
