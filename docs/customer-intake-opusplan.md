# Bestly In-House Cloud — customer intake plan

The brochure makes specific promises: a line-by-line map of current IT spend vs. deployment cost, transparent pricing, ships pre-configured, 6-8 week deployment. The intake system is what delivers on those promises after someone clicks "Book the Call." Right now that button leads to ~nothing. This is the bottleneck.

## What it actually is

The intake is not a form. It's a funnel with eight stages, each gated by commitment, each with a different audience, urgency, and question set. A 50-person company will have a founder, an IT lead, and an ops person all involved at different stages — they don't all need to answer the same questions, and they shouldn't see them all at once.

## Funnel stages

**Stage 0 — Marketing.** Already shipped. Brochure, bestly.tech, /products page. No work needed unless we want to add a public Discovery Brief preview tool ("see your savings in 30 seconds" calculator that gates with email).

**Stage 1 — Lead.** Public form on bestly.tech replacing the bare Book-the-Call link. Captures: name, email, phone, company, company size band (5/25/50/100/200+), current biggest pain (dropdown: cost, sovereignty, brand, AI privacy, lock-in, other), urgency (renewal in 30/90/180 days, exploring). Books a Cal.com discovery slot inline. Kicks off email sequence + ntfy push to Jared. 5–7 fields. Not 20.

**Stage 2 — Pre-call discovery brief.** Sent immediately after Stage 1, before the discovery call. Goal: walk into the call with context, not cold. Asks: which apps in the current stack (multi-select against the brochure's 13), rough annual SaaS spend, compliance frameworks needed (HIPAA / SOC 2 / GDPR / CCPA / none / unsure), where the office is, whether they own a domain, biggest unknown they want answered on the call. 10 fields. 5–8 minutes. Optional but heavily encouraged via copy.

**Stage 3 — Discovery call.** 30 min, Jared runs it. Output is a Custom Discovery Brief PDF — auto-generated from Stage 2 data plus what gets discussed, sent within 24h. This is the artifact the brochure promises. Generating it should be a one-button operation in the operator dashboard, populated from the deal record, signed off by Jared, exported as PDF.

**Stage 4 — Quote & commitment.** The deal becomes real. SOW via DocuSign (template populated from deal data), deposit via Stripe payment link, hardware spec confirmation. This unlocks Stage 5.

**Stage 5 — Technical intake.** Magic-link client portal where the IT lead and brand owner finish the work. Five sub-stages, each independently completable, each saveable mid-flow:

- 5a — Network. Shipping address. ISP. Static IP available? Router make/model. Where the box will live (closet/IDF/rack). Internet bandwidth (test from a speedtest URL on their network). Existing VLANs.
- 5b — Domain & branding. Domain ownership (yes/no, where DNS lives — Cloudflare/GoDaddy/etc.). Subdomain choice (cloud.yourco.com is the brochure default but offer alternatives). Logo upload (SVG + PNG, 1024×1024 mark for app icons). Brand colors (hex picker, with live preview against the actual Bestly Cloud login page mockup). System mail address.
- 5c — Users. CSV upload (template provided). Roles (admin/member). Groups/teams. Out-of-the-box: their HR list dropped in, becomes their org chart on day one.
- 5d — Migration sources. Which providers we're pulling from (Google Workspace / Microsoft 365 / Slack / Asana / 1Password / etc., multi-check). For each: OAuth-grant button, data-volume estimate per user, retention preference, what to skip. Be explicit about what's migrate-able vs. just exportable — chat history especially.
- 5e — Policy. 2FA: required vs. optional. VPN access: who can. DNS filter categories to block (the Pi-hole-style blocklist preferences). Backup destination (off-site Backblaze account they own, or Bestly-managed). Data retention.

**Stage 6 — Provisioning.** Internal-only. Operator dashboard checklist: hardware procured, OS imaged, services configured, branding applied, test deploy passed, certs issued, user accounts created, migration jobs queued. Each step ticks off as it happens. Client sees a status pill: "Provisioning — ETA: Tue Jun 9."

**Stage 7 — Install.** Schedule a date. Hardware ships with a tracking number that shows in the client portal. On install day: on-site or remote-guided. First admin login. Acceptance test signed via DocuSign (this triggers the support clock + final invoice).

**Stage 8 — Live.** 30-day check-in scheduled automatically. Renewals/expansion tracked. Add-ons orderable from the same portal. Quarterly health report generated and emailed.

## Data model (Supabase)

Eight tables, all timestamped:

- `prospect_leads` — Stage 1 capture. Fields: id, contact info, company size band, urgency, source (brochure/referral/event), status (new/contacted/qualified/disqualified), assigned_to.
- `prospect_briefs` — Stage 2 answers, joined to prospect_leads.
- `deals` — One row per opportunity that progressed past Stage 3. Fields: id, lead_id, current_stage (enum 1-8), company_name, primary_contact_id, technical_contact_id, billing_contact_id, target_user_count, support_tier, deployment_fee, monthly_fee, contract_status, install_date, live_date.
- `deal_brand_assets` — Logos (Supabase Storage), colors (jsonb), domain_config, mobile_app_assets.
- `deal_users` — To-be-provisioned users. CSV-imported. Fields: deal_id, name, email, role, group, status (pending/created/migrated).
- `deal_migrations` — One row per source system. Fields: deal_id, source_type (gworkspace/m365/slack/etc.), oauth_token (encrypted), data_volume_gb, status, last_sync_at.
- `deal_payments` — Joined to Stripe customer/subscription/invoice IDs. One-time deployment, recurring support, and any add-ons.
- `deal_contracts` — DocuSign envelope IDs and status, document type (SOW/NDA/acceptance), signed_at, signer.

Plus a `deal_events` audit table that records every stage transition + who triggered it, for the operator timeline view.

## Surfaces

**Public**: bestly.tech/get-started (Stage 1 form). Replaces the existing CTA. Embedded in the homepage hero and on /in-house-cloud.

**Client portal**: bestly.tech/intake/[token]. Magic-link auth via Supabase. No password. Token can be re-issued. Shows a vertical stage indicator with green/in-progress/locked states. Each stage clicked into is its own page with auto-save on every field. One token per stakeholder tied to the same deal — contributions are attributable.

**Operator dashboard**: bestly.tech/admin/deals. Lives inside the existing /admin layout alongside SystemPulse and ActionInbox — same Vite/React/shadcn/Supabase stack, same auth, same component patterns. Two routes:

- `/admin/deals` — pipeline view (default). Kanban by stage with one card per company showing user count, deal value, days-in-stage (red >7d), assigned operator. Toggle to a sortable table view. Persistent "stuck deals" strip at the top with one-click nudge actions. Unread-count badge in the top nav for new leads.
- `/admin/deals/[id]` — per-deal page. Three columns: timeline (event log), active-stage panel (context-sensitive — brief status, SOW status, Stage 5 progress), full deal data (editable inline). Action bar with: Generate Discovery Brief PDF, Send SOW, Advance Stage, Send Stripe Link, Message Client.

ntfy notifications fire the same events that increment the /admin unread badge, so anything not acted on from the phone surfaces visually next session.

## Integrations

- Cal.com — Stage 1 books a discovery slot inline. Webhook fires back into Supabase to confirm.
- Stripe — payment links for deposit and final invoice; subscription for Bestly-managed support.
- DocuSign — SOW + acceptance + NDA. Templates pre-populated from deal data. Status pulled back via webhook.
- ntfy — push to phone on every new lead, every stage advance, every stuck deal.
- Supabase Auth — magic-link, no passwords for clients.
- Resend or Supabase SMTP — transactional email for stage transitions, Discovery Brief delivery, etc.

Eventually: a public-facing API endpoint or webhook so partners/affiliates can submit leads programmatically.

## MVP cut — five-day sprint

Goal: the moment a real prospect clicks Book the Call, the funnel handles them automatically through Stage 3, and there's an operator dashboard to advance them from there.

- Day 1 — Schema + lead form. Supabase tables for `prospect_leads` and `prospect_briefs`. /get-started page with the Stage 1 form. Cal.com embed for slot booking. ntfy push on submit.
- Day 2 — Pre-call brief flow. /brief/[token] page for Stage 2. Auto-emailed link after Stage 1. Auto-save. Submit closes the loop and notifies operator.
- Day 3 — Operator dashboard. /admin/deals — pipeline view, table view, individual deal pages. Manual stage advance. Generate Discovery Brief PDF button (uses existing PDF skill).
- Day 4 — Discovery Brief PDF generator. Template (similar to existing brochure styling) populated from Stage 1 + 2 data + 4 line items filled during the call. Outputs branded PDF, emails it.
- Day 5 — DocuSign + Stripe. SOW DocuSign template + send-from-dashboard. Stripe payment link generation per deal. Stage 4 = "SOW sent" → "deposit paid" → "kickoff" transitions.

After Day 5: real prospects can move from cold to committed entirely through the system, with a single dashboard to manage them.

## Phase 2 — three weeks after MVP

Full client portal. Stage 5a–5e. Logo upload + live brand preview. CSV user import. OAuth migration source connections (this is the hardest piece — Google Workspace OAuth grants for migration, M365 admin consent flows, etc.).

The pricing configurator: public-facing, lets a prospect plug in user count and support tier and see exact pricing. Big competitive lever — most competitors hide pricing.

## Phase 3 — during the first paying deployment

Operator's provisioning checklist. Status visibility for the client (the "ETA: Tue Jun 9" pill). Hardware tracking. Acceptance signature flow. Add-ons portal. Renewal automation.

Don't build Phase 3 speculatively. Build it in tandem with the first deployment, using that deployment as the forcing function — what was tracked manually for client #1 becomes the schema for client #2.

## Decisions to make this week

1. Public pricing or quote-on-request? Brochure says "transparent pricing" but doesn't show it. Recommendation: publish a configurator with bands (deployment fee, monthly support, hardware). Strong differentiator, but commits to honoring those numbers.
2. Magic-link vs. password auth for client portal? Recommendation: magic-link, no exception.
3. Self-managed price floor? Brochure says deployment + 36mo support is $57,500 for 50 users, and Bestly-managed runs from $500/mo additionally. Make this concrete before publishing a configurator. What does $19,167/yr buy in self-managed? What does the $500+/mo tier add?
4. Multi-stakeholder model. One token per deal (any contributor uses it) or one token per person? Recommendation: one token per person tied to the same deal.
5. CRM or no CRM? Recommendation: stay in Supabase for v1. CRM only when there are >20 active deals.
6. NDAs before discovery call? Recommendation: optional in Stage 1 — checkbox "we require an NDA before initial discussion." Triggers DocuSign NDA automatically.
7. Lead disqualification rules. Companies under 5 users: gentle redirect or decline. Companies over 200: hand-off to enterprise process. Encode in the form.

## Risks

The biggest is technical infeasibility surfaced too late. A prospect on carrier-grade NAT with no static IP and no IT person can't run an in-house cloud. If discovered in Stage 5a, time wasted and possibly a deposit already taken. Mitigation: Stage 2 (pre-call) already asks "do you have a static IP?" If unsure, the call begins with a 5-minute network sanity check before pricing.

Second risk: migration scope explosion. "Migrate everything" is unbounded. The intake should force scoping per source (full archive vs. last-90-days vs. specific-folders). This becomes the contract — "we migrate what's checked, you keep your existing source live for 60 days as fallback."

Third risk: brand asset quality. Clients will upload a 200×200 JPG and expect a beautiful mobile app icon. The intake should validate uploads (min resolution, transparent BG required for marks) and offer to commission a brand-asset cleanup as a paid add-on if they don't have proper files.

Fourth risk: support tier mismatch. A 50-person company self-managing will eventually have a 3am incident, lose faith, and churn. Need a way to nudge during the first 90 days toward Bestly-managed if their incident rate is high.
