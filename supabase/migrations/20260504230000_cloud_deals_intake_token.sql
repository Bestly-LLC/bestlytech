-- Add intake portal token + data store + completion tracking to cloud_deals.
-- Stage 5 of the intake funnel — committed customers fill out the technical
-- intake (network, branding, users, migration sources, policy) at
-- /intake/:intake_token via magic-link auth.

alter table public.cloud_deals
  add column if not exists intake_token text unique,
  add column if not exists intake_data  jsonb not null default '{}'::jsonb,
  add column if not exists intake_submitted_at timestamptz;

create index if not exists idx_cloud_deals_intake_token on public.cloud_deals(intake_token);

comment on column public.cloud_deals.intake_token is 'Random 48-char token for /intake/:token magic-link access. Generated when operator clicks "Generate intake link" on deal detail.';
comment on column public.cloud_deals.intake_data is 'Stage 5 form data, structured as { network: {...}, branding: {...}, users: {...}, migration: {...}, policy: {...} }. Operator and client both write here via cloud-intake edge function.';
comment on column public.cloud_deals.intake_submitted_at is 'Set when client clicks final Submit. Locks intake_data from further edits.';
