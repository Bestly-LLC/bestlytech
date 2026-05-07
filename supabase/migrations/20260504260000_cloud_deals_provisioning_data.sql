-- Stage 6 provisioning checklist state, operator-internal.
-- Stored as jsonb so the canonical step list lives in client code and can
-- evolve without migrations. Shape:
--   { <step_key>: { done: bool, completed_at: ts, completed_by: str, notes: str } }

alter table public.cloud_deals
  add column if not exists provisioning_data jsonb not null default '{}'::jsonb;

comment on column public.cloud_deals.provisioning_data is
  'Operator-internal Stage 6 checklist state. Shape: { <step_key>: { done, completed_at, completed_by, notes } }';
