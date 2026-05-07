-- Stage 8 post-live operations state.
-- Stored as jsonb so the milestone schema can evolve without migrations.
-- Shape:
--   { thirty_day_checkin: { done, at },
--     quarterlies: { last_at },
--     renewals: { y1_done, y2_done, y3_done },
--     churn_risk: 'low' | 'medium' | 'high',
--     health_notes: text }

alter table public.cloud_deals
  add column if not exists live_data jsonb not null default '{}'::jsonb;

comment on column public.cloud_deals.live_data is
  'Stage 8 post-live ops: 30-day check-in, quarterly reports, renewal milestones, churn risk.';
