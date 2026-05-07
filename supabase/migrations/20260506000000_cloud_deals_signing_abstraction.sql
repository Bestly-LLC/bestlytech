-- Provider-agnostic signing columns. Replaces the DocuSign-specific
-- docusign_envelope_id with a generic signing_request_id + provider tag.
-- Backfills existing rows as 'docusign' so any in-flight envelopes continue
-- to be tracked under their old provider.

alter table public.cloud_deals
  add column if not exists signing_provider text not null default 'libresign'
    check (signing_provider in ('libresign', 'docusign')),
  add column if not exists signing_request_id text,
  add column if not exists signing_document_url text;

-- Backfill: any existing docusign_envelope_id becomes the signing_request_id
-- with provider 'docusign' so legacy deals stay tracked.
update public.cloud_deals
set
  signing_provider = 'docusign',
  signing_request_id = docusign_envelope_id
where docusign_envelope_id is not null
  and signing_request_id is null;

create index if not exists idx_cloud_deals_signing_request
  on public.cloud_deals(signing_request_id)
  where signing_request_id is not null;

comment on column public.cloud_deals.signing_provider is
  'Which e-sign provider holds the envelope. Default libresign (cloud.bestly.tech). Legacy DocuSign rows kept until migration window closes.';
comment on column public.cloud_deals.signing_request_id is
  'Generic envelope/request ID. Use signing_provider to interpret it (Libresign request UUID vs DocuSign envelope GUID).';
comment on column public.cloud_deals.signing_document_url is
  'Public URL to the final signed PDF, once available. For Libresign, points to /Bestly/Clouds/<Company>/Contracts/...';
comment on column public.cloud_deals.docusign_envelope_id is
  'DEPRECATED — use signing_request_id + signing_provider. Kept for one release cycle; drop in a follow-up migration.';
