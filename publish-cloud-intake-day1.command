#!/bin/bash
# Cloud intake — full Day 1-5 + BlackHole runbook
#
# Days 1-5 collapsed into one publish since they layer on the same files:
#  Day 1 — schema + Stage 1 lead form (/get-started)
#  Day 2 — pre-call brief flow (/brief/:token + cloud-brief edge function)
#  Day 3 — operator dashboard (/admin/cloud + /admin/cloud/:id)
#  Day 4 — Discovery Brief PDF (/admin/cloud/:id/brief-pdf)
#  Day 5 — DocuSign + Stripe (cloud-deal-payment-link edge function +
#                              dialogs in CloudDealDetail)
#
# Backend already deployed: supabase migration applied + edge functions live
# in project rcqfqhguwpmaarseifqg. This commit ships the frontend + repo
# parity for migration source.
set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

git checkout main
git pull origin main --rebase

git add \
  supabase/migrations/20260504210000_cloud_intake_schema.sql \
  supabase/migrations/20260504220000_drop_hoascope_health_seeds.sql \
  supabase/migrations/20260504230000_cloud_deals_intake_token.sql \
  supabase/migrations/20260504240000_cloud_brand_assets_bucket.sql \
  supabase/migrations/20260504250000_shield_url_reports.sql \
  supabase/migrations/20260504260000_cloud_deals_provisioning_data.sql \
  supabase/migrations/20260504270000_cloud_deals_install_data.sql \
  supabase/migrations/20260504280000_cloud_deals_live_data.sql \
  supabase/migrations/20260506000000_cloud_deals_signing_abstraction.sql \
  supabase/functions/submit-cloud-lead/index.ts \
  supabase/functions/cloud-brief/index.ts \
  supabase/functions/cloud-deal-payment-link/index.ts \
  supabase/functions/cloud-intake/index.ts \
  supabase/functions/cloud-brand-upload/index.ts \
  supabase/functions/shield-report-url/index.ts \
  supabase/functions/stripe-webhook/index.ts \
  supabase/functions/cloud-deal-sign/index.ts \
  supabase/functions/cloud-deal-sign-webhook/index.ts \
  supabase/functions/_shared/transactional-email-templates/registry.ts \
  supabase/functions/_shared/transactional-email-templates/cloud-lead-received.tsx \
  supabase/functions/_shared/transactional-email-templates/cloud-brief-submitted.tsx \
  supabase/functions/_shared/transactional-email-templates/cloud-deposit-paid.tsx \
  supabase/functions/_shared/transactional-email-templates/cloud-intake-received.tsx \
  supabase/config.toml \
  src/integrations/supabase/types.ts \
  src/pages/GetStarted.tsx \
  src/pages/Brief.tsx \
  src/pages/Intake.tsx \
  src/pages/ShieldReport.tsx \
  src/pages/InHouseCloud.tsx \
  src/pages/Products.tsx \
  src/pages/Status.tsx \
  src/config/products.ts \
  src/pages/admin/CloudDeals.tsx \
  src/pages/admin/CloudDealDetail.tsx \
  src/pages/admin/CloudDiscoveryBrief.tsx \
  src/pages/admin/AdminShieldReports.tsx \
  src/components/admin/AdminSidebar.tsx \
  src/App.tsx \
  docs/customer-intake-opusplan.md \
  docs/blackhole-minutes-setup.md \
  docs/parentiq-feature-inventory.md \
  docs/schoolpilot-feature-inventory.md \
  docs/hoascope-feature-inventory.md \
  docs/onboarding-audit-2026-05.md \
  docs/libresign-handoff.md \
  docs/contract-templates/SOW.pdf \
  docs/contract-templates/Acceptance.pdf \
  docs/contract-templates/NDA.pdf

echo "Files staged:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/cloud-intake-build.log 2>&1; then
  tail -30 /tmp/cloud-intake-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "feat(intake): customer intake funnel for In-House Cloud

Schema + edge functions
 - cloud_leads, cloud_briefs, cloud_deals, cloud_deal_events tables
 - Triggers: auto-brief-shell on lead insert, audit on brief submit, audit
   on stage change. RLS: anon insert leads only, admin all else.
 - Views: v_cloud_pipeline, v_cloud_lead_funnel
 - submit-cloud-lead: validates + inserts lead, ntfy push to operator,
   returns brief_token
 - cloud-brief: token-bound GET/PATCH/POST for /brief/:token (auto-save +
   final submit + ntfy push to operator)
 - cloud-deal-payment-link: admin-gated Stripe customer + product + price +
   payment-link generation per deal

Public pages
 - /get-started (Stage 1) — 8-field lead form, UTM capture, honeypot, success
   state with discovery + brief CTAs
 - /brief/:token (Stage 2) — five question groups (current stack against the
   13 brochure services, annual spend, compliance, network/location,
   open-ended unknowns), 700ms debounced auto-save, save indicator
 - InHouseCloud hero + footer CTAs (×2) repointed from /contact

Operator dashboard
 - /admin/cloud — Kanban pipeline (8 stages) + stat cards + stuck-strip (>7d)
 - /admin/cloud/:id — three-column detail (contact, brief snapshot, timeline)
   with quick actions: copy brief link, email brief link, generate Discovery
   Brief PDF, generate Stripe payment link, record DocuSign envelope
 - /admin/cloud/:id/brief-pdf — printable Discovery Brief mirroring brochure
   styling, pre-populated from brief band + user-count band, operator
   overrides (annual spend, deploy fee, monthly fee, support tier, custom
   notes) + window.print()
 - Sidebar: 'In-House Cloud > Cloud Deals' with new-lead count badge

Docs
 - docs/customer-intake-opusplan.md — full funnel design (Stages 0-8)
 - docs/blackhole-minutes-setup.md — BlackHole loopback runbook for
   Minutes call recording (5-min brew install + Audio MIDI Setup +
   optional one-shot toggle script)
 - docs/parentiq-feature-inventory.md — internal alignment doc, 3.1k words
 - docs/schoolpilot-feature-inventory.md — superintendent-pitched, 4.2k words
 - docs/hoascope-feature-inventory.md — internal alignment doc, 3.2k words
 - docs/onboarding-audit-2026-05.md — gaps + contradictions + action items
   across the three product stories vs. public marketing site

Product naming
 - HOA Cure → HOAscope rename in src/config/products.ts (id + name)
   and src/pages/Products.tsx SEO description. Status.tsx already probed
   hoascope.com so the public infra was already aligned. Asset filename
   src/assets/hoacure-icon.png left as-is (never user-visible).

Phase 2 — client intake portal foundation
 - Schema: cloud_deals.intake_token + intake_data jsonb + intake_submitted_at
 - cloud-intake edge function: token-bound GET / PATCH (per-stage merge) /
   POST submit. Stages allowlist: network|branding|users|migration|policy
 - /intake/:token public page: 5-stage navigation, 700ms auto-save, save
   indicator, locked-after-submit state. ALL FIVE STAGES NOW REAL:
   - 5a Network: shipping address, ISP, static IP, router, bandwidth, IT lead
   - 5b Branding: subdomain, system mail, color pickers, logo + icon
     upload, live login-screen preview that updates with colors/assets
   - 5c Users: CSV upload (BOM-tolerant inline parser), template download,
     inline-editable table with name/email/role/group, validation indicators
     (border-amber on invalid email or duplicate), live stats strip
   - 5d Migration: 13-source catalog (GW/M365/Slack/Teams/Dropbox/Box/
     Asana/Trello/Monday/Linear/1Password/LastPass/DocuSign), per-source
     scope/volume/decommission/notes, top-level cutover policy
   - 5e Policy: 2FA, VPN scope, 7-cat DNS filter, backup destination
     with conditional Backblaze field, retention period
 - Storage bucket cloud-brand-assets (public read, 5MB cap, allowed mime
   types png/jpg/svg/webp), uploads via cloud-brand-upload edge function
   that verifies intake_token before writing to <deal_id>/<asset_type>.<ext>
 - Operator: 'Generate intake link' button on /admin/cloud/:id Quick
   Actions. First click generates a 48-char hex token, persists, copies
   the link to clipboard. Subsequent clicks just re-copy.

Audit content corrections
 - SchoolPilot card on /products: dropped 'Grade tracking & GPA'
   (inventory disclaims this). New bullets: 'Unified school view',
   'Reads your existing SIS', 'FERPA-aligned', 'Parent + student modes'.
   Description rewritten to match inventory positioning.
 - Status.tsx: removed hoascope.com + app.hoascope.com from probe list
   (sites don't exist yet). Added comment to gate future additions on
   row-exists in external_health.

Libresign Phase 2 + 4 (NEW)
 - cloud-deal-sign edge function: admin-gated POST that creates a Libresign
   signing request from a stored PDF template, stamps the deal with
   signing_request_id + signing_provider, fires ntfy push with the signing
   URL. Falls back gracefully (503) if LIBRESIGN_* env vars aren't set —
   operator UI surfaces the legacy paste-flow then.
 - cloud-deal-sign-webhook edge function: Libresign callback. Handles
   signed / declined / viewed events. Looks up deal by signing_request_id,
   stamps sow_signed_at OR install_data.acceptance.signed_at as appropriate,
   inserts deal_event, fires ntfy + customer email. Shared-secret auth via
   X-Bestly-Sign-Secret header (LIBRESIGN_WEBHOOK_SECRET env var).
 - Operator UI in CloudDealDetail SOW dialog: "One-click via Libresign API"
   row with three buttons (Send SOW / NDA / Acceptance) on top of the paste
   fallback. Auto-send hits cloud-deal-sign and refreshes the deal+events.

DocuSign → Libresign abstraction (Phase 1+3+5) (NEW)
 - Schema: cloud_deals.signing_provider (libresign|docusign default
   libresign), signing_request_id, signing_document_url. Backfilled
   any existing docusign_envelope_id into signing_request_id with
   provider='docusign' for legacy rows.
 - UI swap: SOW dialog in /admin/cloud/:id and Acceptance section in
   InstallTracker now reference Libresign on cloud.bestly.tech.
   Operator pastes the Libresign request ID after sending from the
   Libresign UI; same paste-flow as before but provider-tagged.
 - Phase 2 (real API integration with cloud-deal-sign edge function)
   and Phase 4 (webhook for auto-stamp) deferred — both require
   Libresign to be installed on cloud.bestly.tech first.

Cal.com → Nextcloud Appointments (NEW)
 - Created appointment schedule on cloud.bestly.tech for the Discovery
   Call. 30-min duration, 15-min increments, Mon-Fri 9-5, public, Talk
   room auto-created per booking, 2-month horizon.
 - Booking URL: https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY
 - Replaced cal.com/jared-best/discovery in GetStarted.tsx,
   submit-cloud-lead/index.ts (cal_url in email-fire), and
   cloud-lead-received.tsx previewData.
 - submit-cloud-lead v4 redeployed.

Customer-facing email automation (NEW)
 - 4 React Email templates in supabase/functions/_shared/transactional-
   email-templates/: cloud-lead-received, cloud-brief-submitted,
   cloud-deposit-paid, cloud-intake-received. Bestly brand voice
   (confident, plain-spoken), dark header + accent CTA button matching
   marketing site palette.
 - Registered in registry.ts alongside the existing Cookie Yeti templates.
 - Email-fire wired into 4 edge functions:
   * submit-cloud-lead → lead-received (after lead insert) with brief +
     Cal.com discovery links
   * cloud-brief POST → brief-submitted thank-you
   * cloud-intake POST → intake-received "build is starting" notice
   * stripe-webhook cloud-deal branch → deposit-paid receipt with intake
     link + amount
 - Idempotency keys per-event; suppression-list + unsubscribe-token
   handling inherited from existing send-transactional-email plumbing.
 - Deployed: send-transactional-email v8, submit-cloud-lead v3,
   cloud-brief v3, cloud-intake v3, stripe-webhook v9.

Stage 8 post-live ops (NEW)
 - Schema: cloud_deals.live_data jsonb column (30-day check-in, quarterlies,
   renewals, churn_risk, health_notes).
 - LiveOpsPanel section on /admin/cloud/:id, only renders at stage 8.
   Header badge: "Live since {date}". Five milestone rows computed off
   go_live_at: 30-day check-in, next quarterly (recurs every 90d from
   last sent), Y1/Y2/Y3 renewals. Color-coded state: overdue=red,
   within-7d=amber, done=emerald, neutral otherwise. Checkbox per row
   with strikethrough when done; quarterly toggle re-stamps last_at since
   it recurs. Churn-risk pill toggle (low/medium/high). Health notes
   textarea for incidents/expansion/renegotiation tracking.
 - Closes the funnel — every stage 1-8 now has real operator workflow.

Stage 7 install workflow (NEW)
 - Schema: cloud_deals.install_data jsonb column (shipping/install/acceptance subdocs).
 - InstallTracker section on /admin/cloud/:id, only renders when stage >= 6.
   Three sub-sections with three top-line status badges:
   * Shipping: carrier dropdown (UPS/FedEx/USPS/hand-deliver), tracking
     number with one-click track-link for the major carriers, ship date,
     ETA.
   * Install: datetime-local schedule, mode (remote/on-site/self-install),
     notes textarea.
   * Acceptance: DocuSign envelope ID input that auto-stamps signed_at on
     first non-empty value.
 - Acceptance signed → emerald 'Mark live →' banner that advances to
   Stage 8 + stamps go_live_at.

Stage 6 provisioning checklist (NEW)
 - Schema: cloud_deals.provisioning_data jsonb column.
 - 8-step hardcoded checklist on /admin/cloud/:id (only renders when
   stage >= 5): hardware-procured, os-imaged, services-configured,
   branding-applied, users-created, migration-queued, test-deploy-passed,
   certs-issued. Each step has check/uncheck + completed_at age timestamp +
   optional notes. Counter badge + animated progress bar (turns emerald
   at 100%). All-checked banner exposes 'Ship it →' button that
   auto-advances the deal to Stage 7: Install.

Stripe webhook auto-advance (NEW)
 - stripe-webhook v8 extends checkout.session.completed to short-circuit
   when session.metadata.deal_id is set (B2B cloud deal payment links).
   Stamps deposit_paid_at, auto-advances current_stage to 5 (Tech intake)
   if currently <=4, captures stripe_customer_id, writes deal_event
   'deposit_paid', fires ntfy push with amount + click-through to deal.
   Bails before the existing Cookie Yeti subscription path runs.

Shield URL allowlist reporter (NEW)
 - Schema: shield_url_reports table with generated reported_domain column
   (regex extracts domain from full URL), status enum (new|reviewing|
   allowed|denied|duplicate), optional deal_id link via intake_token.
 - shield-report-url edge function: anon POST with honeypot, URL
   validation (rejects javascript:/data:/file:/mailto:/ schemes), per-IP
   rate limit (10/hour), email validation, intake_token → deal_id
   resolution + auto-fill org name. Fires ntfy push on each new report.
 - /shield/report public page: URL input (auto-filled from ?url= query),
   reason textarea, optional email + org, success state with 'report
   another' loop. Honeypot field for bots.
 - /admin/shield-reports operator queue: 5 stat cards (new/reviewing/
   allowed/denied/total), filter dropdown + search, per-report cards
   with allow/deny/mark-reviewing buttons, copy-domain + open-url
   shortcuts. Sidebar entry under Home Hub group with new-report
   count badge.
"

git push origin main

echo "✓ Cloud intake (Days 1-5) published. Vercel will rebuild."
