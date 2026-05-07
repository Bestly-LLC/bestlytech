-- Stage 7 install state.
-- Stored as jsonb so the schema can evolve without migrations.
-- Shape: { shipping: { carrier, tracking_number, ship_date, eta },
--         install: { scheduled_at, mode, notes },
--         acceptance: { envelope_id, signed_at } }

alter table public.cloud_deals
  add column if not exists install_data jsonb not null default '{}'::jsonb;

comment on column public.cloud_deals.install_data is
  'Stage 7 install state: shipping/install/acceptance subdocs.';
