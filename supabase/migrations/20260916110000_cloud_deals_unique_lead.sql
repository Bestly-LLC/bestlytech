-- One cloud_deals row per lead.
--
-- The deal page read the deal with .eq("lead_id", id).maybeSingle(), which errors when a
-- lead has more than one deal row, and "move to stage" inserted a new row without checking.
-- As of 2026-09-16 one lead (5526230f-6b75-4ad3-94a5-0ed7938c602e) has three rows
-- (stages 3, 1, 1) created within a second of each other: same company/contact, every
-- optional column empty, no events, Shield requests or Shield reports pointing at them.
--
-- This migration:
--   1. For each lead with duplicates, keeps the most advanced row
--      (current_stage desc, updated_at desc, created_at asc).
--   2. Re-points child rows (cloud_deal_events, cloud_shield_requests, shield_url_reports)
--      from the extra rows to the kept row.
--   3. Deletes an extra row ONLY when it holds no business data the kept row lacks.
--      If any extra row does, nothing is deleted for that lead and the unique index is
--      NOT created; a NOTICE names the lead so it can be merged by hand.
--   4. Adds a unique index on cloud_deals(lead_id) when no duplicates remain.
--
-- Safe to re-run: with no duplicates, steps 1-3 do nothing and the index uses IF NOT EXISTS.

DO $$
DECLARE
  dup record;
  extra record;
  kept public.cloud_deals%ROWTYPE;
  blocked boolean;
BEGIN
  FOR dup IN
    SELECT lead_id FROM public.cloud_deals GROUP BY lead_id HAVING count(*) > 1
  LOOP
    SELECT * INTO kept
    FROM public.cloud_deals
    WHERE lead_id = dup.lead_id
    ORDER BY current_stage DESC, updated_at DESC, created_at ASC
    LIMIT 1;

    -- Does any extra row carry data the kept row doesn't have?
    SELECT EXISTS (
      SELECT 1
      FROM public.cloud_deals e
      WHERE e.lead_id = dup.lead_id
        AND e.id <> kept.id
        AND (
             e.company_name          IS DISTINCT FROM kept.company_name
          OR e.primary_contact_name  IS DISTINCT FROM kept.primary_contact_name
          OR e.primary_contact_email IS DISTINCT FROM kept.primary_contact_email
          OR (e.target_user_count         IS NOT NULL AND e.target_user_count         IS DISTINCT FROM kept.target_user_count)
          OR (e.support_tier              IS NOT NULL AND e.support_tier              IS DISTINCT FROM kept.support_tier)
          OR (e.deployment_fee_cents      IS NOT NULL AND e.deployment_fee_cents      IS DISTINCT FROM kept.deployment_fee_cents)
          OR (e.monthly_support_fee_cents IS NOT NULL AND e.monthly_support_fee_cents IS DISTINCT FROM kept.monthly_support_fee_cents)
          OR (e.discovery_call_at         IS NOT NULL AND e.discovery_call_at         IS DISTINCT FROM kept.discovery_call_at)
          OR (e.sow_sent_at               IS NOT NULL AND e.sow_sent_at               IS DISTINCT FROM kept.sow_sent_at)
          OR (e.sow_signed_at             IS NOT NULL AND e.sow_signed_at             IS DISTINCT FROM kept.sow_signed_at)
          OR (e.deposit_paid_at           IS NOT NULL AND e.deposit_paid_at           IS DISTINCT FROM kept.deposit_paid_at)
          OR (e.install_scheduled_at      IS NOT NULL AND e.install_scheduled_at      IS DISTINCT FROM kept.install_scheduled_at)
          OR (e.go_live_at                IS NOT NULL AND e.go_live_at                IS DISTINCT FROM kept.go_live_at)
          OR (e.cal_event_uuid            IS NOT NULL AND e.cal_event_uuid            IS DISTINCT FROM kept.cal_event_uuid)
          OR (e.stripe_customer_id        IS NOT NULL AND e.stripe_customer_id        IS DISTINCT FROM kept.stripe_customer_id)
          OR (e.docusign_envelope_id      IS NOT NULL AND e.docusign_envelope_id      IS DISTINCT FROM kept.docusign_envelope_id)
          OR (e.assigned_to               IS NOT NULL AND e.assigned_to               IS DISTINCT FROM kept.assigned_to)
          OR (e.notes                     IS NOT NULL AND e.notes                     IS DISTINCT FROM kept.notes)
          OR (e.intake_token              IS NOT NULL)  -- a token may already be in a customer's inbox
          OR (e.shield_request_token      IS NOT NULL)
          OR (e.intake_submitted_at       IS NOT NULL AND e.intake_submitted_at       IS DISTINCT FROM kept.intake_submitted_at)
          OR (e.intake_data       <> '{}'::jsonb AND e.intake_data       IS DISTINCT FROM kept.intake_data)
          OR (e.provisioning_data <> '{}'::jsonb AND e.provisioning_data IS DISTINCT FROM kept.provisioning_data)
          OR (e.install_data      <> '{}'::jsonb AND e.install_data      IS DISTINCT FROM kept.install_data)
          OR (e.live_data         <> '{}'::jsonb AND e.live_data         IS DISTINCT FROM kept.live_data)
          OR (e.signing_request_id        IS NOT NULL AND e.signing_request_id        IS DISTINCT FROM kept.signing_request_id)
          OR (e.signing_document_url      IS NOT NULL AND e.signing_document_url      IS DISTINCT FROM kept.signing_document_url)
        )
    ) INTO blocked;

    IF blocked THEN
      RAISE NOTICE 'cloud_deals: lead % has duplicate deal rows with differing data; left untouched, merge by hand', dup.lead_id;
      CONTINUE;
    END IF;

    FOR extra IN
      SELECT id FROM public.cloud_deals WHERE lead_id = dup.lead_id AND id <> kept.id
    LOOP
      UPDATE public.cloud_deal_events     SET deal_id = kept.id WHERE deal_id = extra.id;
      UPDATE public.cloud_shield_requests SET deal_id = kept.id WHERE deal_id = extra.id;
      UPDATE public.shield_url_reports    SET deal_id = kept.id WHERE deal_id = extra.id;
      DELETE FROM public.cloud_deals WHERE id = extra.id;
      RAISE NOTICE 'cloud_deals: removed empty duplicate % for lead % (kept %)', extra.id, dup.lead_id, kept.id;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.cloud_deals GROUP BY lead_id HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS cloud_deals_lead_id_key ON public.cloud_deals (lead_id);
  ELSE
    RAISE NOTICE 'cloud_deals: duplicates remain, unique index on lead_id not created';
  END IF;
END $$;
