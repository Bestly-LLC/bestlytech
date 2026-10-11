-- Maya's card-update links use a Stripe Customer Portal configuration.
-- maya-billing (action setup_portal) creates one if the account has no default and saves its id here;
-- maya-pay passes it when opening a portal session.
alter table public.maya_billing_settings add column if not exists portal_configuration_id text;
