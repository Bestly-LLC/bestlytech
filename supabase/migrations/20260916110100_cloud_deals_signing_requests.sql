-- Track e-sign requests per document kind instead of one overwritten slot.
--
-- Before: every send overwrote cloud_deals.signing_request_id, and the Libresign webhook
-- guessed the document type from the deal stage (a signed NDA was recorded as the SOW).
-- After:  cloud_deals.signing_requests = {"sow": "<uuid>", "nda": "<uuid>", "acceptance": "<uuid>"}
--         and nda_signed_at records a signed NDA. SOW keeps sow_signed_at; acceptance keeps
--         install_data.acceptance.signed_at. signing_request_id stays as "most recent send"
--         for backward compatibility.
--
-- Backfill (modifies existing rows, adds keys only, never overwrites):
--   * signing_request_id -> the kind named by a matching sow_sent / nda_sent / acceptance_sent
--     event, otherwise "sow" (what the webhook assumed before this change).
--   * install_data.acceptance.envelope_id -> "acceptance".
-- Safe to re-run.

ALTER TABLE public.cloud_deals
  ADD COLUMN IF NOT EXISTS signing_requests jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS nda_signed_at timestamptz;

COMMENT ON COLUMN public.cloud_deals.signing_requests IS
  'Libresign request UUIDs by document kind: {"sow","nda","acceptance"}. Written by cloud-deal-sign and the admin "Record signing request" dialog; matched by cloud-deal-sign-webhook.';

-- Legacy single slot -> kind from the send event when we can tell, else "sow".
UPDATE public.cloud_deals d
SET signing_requests = d.signing_requests || jsonb_build_object(k.kind, d.signing_request_id)
FROM (
  SELECT d2.id,
         COALESCE(
           (
             SELECT CASE e.event_type
                      WHEN 'nda_sent' THEN 'nda'
                      WHEN 'acceptance_sent' THEN 'acceptance'
                      ELSE 'sow'
                    END
             FROM public.cloud_deal_events e
             WHERE e.deal_id = d2.id
               AND e.event_type IN ('sow_sent', 'nda_sent', 'acceptance_sent')
               AND e.event_payload->>'signing_request_id' = d2.signing_request_id
             ORDER BY e.created_at DESC
             LIMIT 1
           ),
           'sow'
         ) AS kind
  FROM public.cloud_deals d2
  WHERE d2.signing_request_id IS NOT NULL
) k
WHERE k.id = d.id
  AND NOT (d.signing_requests ? k.kind)  -- never overwrite an id already recorded for that kind
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(d.signing_requests) kv WHERE kv.value = d.signing_request_id
  );

-- Acceptance request ID typed into the Install panel.
UPDATE public.cloud_deals d
SET signing_requests = d.signing_requests || jsonb_build_object('acceptance', d.install_data->'acceptance'->>'envelope_id')
WHERE COALESCE(d.install_data->'acceptance'->>'envelope_id', '') <> ''
  AND NOT (d.signing_requests ? 'acceptance');
