-- This project does not grant table privileges to `authenticated` by default. Tables with RLS select
-- policies still need an explicit GRANT, or signed-in pages come back empty (Turo Watch had no history).
grant select on public.turo_price_log, public.turo_market_daily, public.turo_watch_targets, public.turo_competitor_prices to authenticated;
grant select on public.partner_chat, public.partner_ai_status, public.partner_mail to authenticated;
grant select on public.turo_runs, public.turo_day_prices, public.turo_comps, public.turo_settings,
  public.partners, public.scout_daily, public.scout_daily_runs, public.scout_lessons,
  public.cy_pattern_quarantine_log, public.home_hub_agent_releases, public.meeting_recorder_state
to authenticated;
