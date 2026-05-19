# CLAUDE.md

Orientation for any Claude / agent picking up work on this repo.

## What this is

Bestly LLC's primary public site (`bestly.tech`) plus the operator admin dashboard at `/admin`. Marketing pages, product pages (Cookie Yeti, In-House Cloud, etc.), and the entire B2B customer-intake funnel for selling private clouds.

**Stack:** Vite + React + TypeScript + Tailwind + shadcn/ui + react-router + Supabase. Hosted on Vercel from `main` (auto-deploys on push). Supabase project ref: `rcqfqhguwpmaarseifqg` (managed via this repo's `supabase/migrations/` and `supabase/functions/`).

**Sister system:** `cloud.bestly.tech` — the Bestly LLC Nextcloud instance, used as the actual project tracker (Deck), forms (Forms), file storage (Files), and eventually e-sign (Libresign) and team password vault (Vaultwarden). Bestly *eats its own dogfood*: the customer signing the SOW is using the exact stack they're buying. See `docs/storage-policy.md`.

## Repo map

```
src/
  pages/
    Index.tsx              # homepage
    InHouseCloud.tsx       # the In-House Cloud product page
    GetStarted.tsx         # cloud-intake Stage 1 — public lead form
    Brief.tsx              # cloud-intake Stage 2 — pre-call brief at /brief/:token
    Intake.tsx             # cloud-intake Stage 5 — technical intake at /intake/:token
                           #   includes CustomerStatusView (post-submit live status)
    ShieldReport.tsx       # public form at /shield/report for URL allowlist requests
    admin/
      AdminDashboard.tsx       # /admin landing
      CloudDeals.tsx           # /admin/cloud — Kanban pipeline of all cloud deals
      CloudDealDetail.tsx      # /admin/cloud/:id — full deal page (huge file)
      CloudDiscoveryBrief.tsx  # printable Discovery Brief PDF generator
      AdminShieldReports.tsx   # operator review queue for shield_url_reports
      ...                      # plus existing Cookie Yeti / Hire / etc admin pages
  components/admin/
    AdminLayout.tsx        # admin shell + sidebar
    AdminSidebar.tsx       # nav with count badges (cloud leads, shield reports, etc.)
  config/products.ts       # marketing config — every product card on /products
  integrations/supabase/
    client.ts              # browser Supabase client
    types.ts               # generated types — regenerate after every migration

supabase/
  migrations/              # one file per migration, applied in numeric order
  functions/               # edge functions — each in its own folder
    submit-cloud-lead/     # Stage 1 lead capture + ntfy push + customer email
    cloud-brief/           # Stage 2 token-bound GET/PATCH/POST
    cloud-deal-payment-link/ # admin-gated Stripe payment link generator
    cloud-intake/          # Stage 5 token-bound GET/PATCH/POST + customer status data
    cloud-brand-upload/    # Stage 5b multipart upload to Supabase Storage
    shield-report-url/     # /shield/report submissions
    stripe-webhook/        # checkout.session.completed → cloud_deals auto-advance + email
    send-transactional-email/ # template registry + queueing (handles cloud + CY both)
    _shared/transactional-email-templates/
                           # React Email templates registered in registry.ts
                           # cloud-* templates added to the existing Cookie Yeti set
    ... (lots of CY-era functions also)

docs/
  customer-intake-opusplan.md       # the master plan for the cloud funnel
  parentiq/schoolpilot/hoascope-feature-inventory.md
  onboarding-audit-2026-05.md       # gap audit of the three product stories
  storage-policy.md                 # canonical: Nextcloud Files for everything new
  blackhole-minutes-setup.md        # runbook for the BlackHole audio loopback
  ...
```

## The cloud-intake funnel (most-recent major system)

Eight-stage pipeline for selling Bestly In-House Cloud deployments. Schema in `supabase/migrations/20260504210000_cloud_intake_schema.sql` and friends.

| Stage | What happens | Where lives | Auto-advance |
|---|---|---|---|
| 1 Lead | Public form `/get-started` → `submit-cloud-lead` edge fn → `cloud_leads` row + `cloud_briefs` shell + lead-received email + ntfy | `GetStarted.tsx`, `submit-cloud-lead/` | manual |
| 2 Brief | Token-bound page `/brief/:token` → `cloud-brief` edge fn (auto-save) → brief-submitted email + ntfy on submit | `Brief.tsx`, `cloud-brief/` | manual |
| 3 Discovery | Operator runs the call. Generates Discovery Brief PDF from `/admin/cloud/:id/brief-pdf` | `CloudDiscoveryBrief.tsx` | manual |
| 4 SOW + Stripe | Operator generates Stripe payment link from deal detail. DocuSign envelope ID pasted (will become Libresign). | dialogs in `CloudDealDetail.tsx`, `cloud-deal-payment-link/` | Stripe webhook auto-advances on `checkout.session.completed` if `metadata.deal_id` is set |
| 5 Tech intake | Operator generates intake link, IT lead fills 5-stage portal at `/intake/:token` | `Intake.tsx`, `cloud-intake/` | manual after submit |
| 6 Provisioning | 8-step checklist on deal detail (`ProvisioningChecklist`). All-checked → "Ship it →" | `CloudDealDetail.tsx` ProvisioningChecklist | manual gate |
| 7 Install | Shipping carrier/tracking, install schedule, acceptance envelope (`InstallTracker`). Acceptance signed → "Mark live →" | `CloudDealDetail.tsx` InstallTracker | manual gate |
| 8 Live | 30-day check-in + quarterly + Y1/Y2/Y3 renewal milestones (`LiveOpsPanel`). Churn risk + health notes. | `CloudDealDetail.tsx` LiveOpsPanel | terminal |

The customer sees a **live status page** at the same `/intake/:token` URL after submit (`CustomerStatusView` component) showing build progress, shipping ETA, install date, and the "you're live" celebration once at Stage 8. Auto-refreshes every 60s.

**Customer-facing emails** (templates in `supabase/functions/_shared/transactional-email-templates/cloud-*.tsx`): cloud-lead-received, cloud-brief-submitted, cloud-deposit-paid, cloud-intake-received. Bestly brand voice (dark `#0a0a0a` header, accent `#c84d2b`).

## The Shield reporter

Two parallel surfaces: public form at `/shield/report` (anyone can submit URLs they think are wrongly blocked) and per-deal token URLs `/shield/request/<token>` for client deployments. Tables: `shield_url_reports` (global, anon insert) and `cloud_shield_requests` (deal-scoped). Operator queue at `/admin/shield-reports`.

## Conventions

- **Auth.** Admin routes guarded by `<AdminRoute>`. Edge functions either `verify_jwt = false` (public submission endpoints with own auth check via tokens) or `verify_jwt = true` (require Supabase JWT — operator actions like generating Stripe links).
- **Token-bound flows.** Public endpoints that read/write deal-specific data require a long random token (48-char hex via `crypto.getRandomValues` or `gen_random_bytes(24)`). Tokens live on the row itself (`cloud_briefs.access_token`, `cloud_deals.intake_token`, `cloud_deals.shield_request_token`). Edge functions look up the row by token; no JWT needed.
- **Schema state via jsonb.** Long-lived per-stage state (intake_data, provisioning_data, install_data, live_data) lives as jsonb columns on `cloud_deals` so the schema can evolve without migrations. Each stage's data is one subdoc; `cloud-intake` edge fn replaces the whole subdoc on every PATCH (idempotent).
- **ntfy push notifications** for every operator-side event: new lead, brief submitted, intake submitted, deposit paid, shield report received. Topic: `bestly-sysalert-7q2k9mx4`. ASCII headers only (em-dashes break ntfy's HTTP header validation — strip them in `asciiHeader()`).
- **Idempotency.** Email sends use idempotency keys (`<event>-<id>` pattern) so Stripe retries don't double-send. The email queue table dedupes by key.
- **TypeScript.** Run `npx tsc --noEmit -p tsconfig.app.json` to type-check. Two pre-existing errors in `WowButton.tsx` to ignore.
- **Supabase types.** Regenerate after every migration: MCP `generate_typescript_types`, write to `src/integrations/supabase/types.ts`.

## Deploy

`./publish-cloud-intake-day1.command` from the repo root — stages every cloud-intake-related file (schema, edge functions, frontend, docs), runs `npm run build` as a sanity check, commits with a structured message, pushes to `main`. Vercel auto-rebuilds.

Edge functions deploy via the Supabase MCP `deploy_edge_function` (or via `supabase functions deploy <name>` from the CLI). Migrations apply via `apply_migration`.

## Open and pending

See the TodoList for current state. Major decisions still open:

- **Nextcloud Passwords app install** — Jared needs to one-click install via `cloud.bestly.tech/settings/apps/security` (requires admin password re-confirmation). The .secrets/ plain-text purge is already done; the file at `.secrets/cloudflare-turn-bestly-talk.txt` is now just a pointer to canonical sources. See `docs/storage-policy.md` Credentials & Secrets section.
- ~~**Cal.com → Nextcloud Appointments**~~ — done 2026-05-06. URL is now `https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY`, hard-coded in `GetStarted.tsx`, `submit-cloud-lead/index.ts` (the email-fire), and `cloud-lead-received.tsx` previewData. Each booking auto-creates a Bestly Cloud Talk room — discovery calls run on the actual product.
- **DocuSign → Libresign** — Phase 1+3+5 done 2026-05-06. Schema has `signing_provider` / `signing_request_id` / `signing_document_url`, with deprecated `docusign_envelope_id` kept for one release cycle for backfill. UI dialogs in CloudDealDetail (SOW) and InstallTracker (Acceptance) now reference Libresign on cloud.bestly.tech. **Phase 2** = Libresign install on cloud.bestly.tech (admin password gate) + cloud-deal-sign edge function for programmatic envelope creation. **Phase 4** = webhook handler for auto-stamp on signing complete. See `docs/customer-intake-opusplan.md`.
- **HOAscope rename consistency** — config + Products.tsx done. Asset filename `hoacure-icon.png` left as-is (never user-visible).
- **ParentIQ public surface** — currently no card on `/products`. Either add Coming Soon, build full page, or stay dark. Decision deferred.

## Where the customer-facing artifacts live (after dogfood migration)

| Artifact | Today | After dogfood migration |
|---|---|---|
| Per-deal contracts | DocuSign envelopes | Libresign on cloud.bestly.tech |
| Per-deal brand uploads | Supabase Storage `cloud-brand-assets` | Nextcloud Files `/Bestly/Clouds/<Company>/Branding/` |
| Discovery call booking | Cal.com | Nextcloud Appointments at cloud.bestly.tech |
| Project tracking | nothing-formal-yet | Nextcloud Deck (Bestly Ops, Cloud Deals, Product Roadmap, BDC Universal boards already created) |
| Internal forms | Google Forms / Typeform / nothing | Nextcloud Forms (Post-discovery retro, Candidate scorecard, Contractor onboarding live) |
| Team password vault | plain-text `.secrets/` | Vaultwarden on cloud.bestly.tech |
| Strategy/sales docs | repo Markdown | Nextcloud Office (Collabora) + repo for engineering only |

## A few rules of the road

- **Light/dark mode.** Site defaults to **light**. The admin dashboard runs **dark** (`admin-shell` wrapper class on `AdminLayout`). Don't accidentally invert.
- **Brand voice.** Bestly is privacy-first, plain-spoken, anti-big-tech. Read the brochure (`In-House Cloud — Brochure.pdf` in `/uploads/`) for the canonical voice. No emoji on customer-facing surfaces. Internal admin can be more relaxed.
- **No new emojis on existing pages** unless explicitly asked.
- **Migrations are append-only.** Never edit a previously-committed migration; write a new one.
- **One Supabase project.** Old Lovable project `keowunrxpxlbgebujbao` is retired — its functions return 410 stubs. New project is `rcqfqhguwpmaarseifqg`.
- **Always commit + push without asking.** When finishing meaningful work on this repo, run `git add` → `git commit` (logical, scoped commits) → `git pull --rebase origin main` → `git push origin main`. Vercel auto-deploys from main. Don't ask Jared for permission first — just do it. If there's a conflict, rebase and proceed.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
