# Bestly storage policy

**Decision date:** 2026-05-05
**Owner:** Jared

Single rule: **anything new related to Bestly lives in Nextcloud at cloud.bestly.tech**. Google Drive is read-only reference for legacy material — no new writes.

## Why

Bestly sells "your data lives on hardware you own, not someone else's servers." Storing our own operational data on Google Drive is the same brand contradiction as using DocuSign for our own SOWs. It also means every prospect who watches us sign their contract or look up their brand asset in real time is watching us use the exact thing we're selling them.

## Where things go now

| Material | Location | Notes |
|---|---|---|
| Per-deal contracts (SOW, NDA, Acceptance) | `/Bestly/Clouds/<Company>/Contracts/` | Migrated when Sign moves to Libresign. |
| Per-deal brand assets (logos, icons, marks) | `/Bestly/Clouds/<Company>/Branding/` | Currently in Supabase Storage `cloud-brand-assets` bucket — migrate as a follow-up. |
| Per-deal install docs (photos, network diagrams) | `/Bestly/Clouds/<Company>/Install/` | Created on deal advance to Stage 6. |
| Discovery brief PDFs | `/Bestly/Clouds/<Company>/Discovery/` | Generated client-side via window.print() today; future: render server-side and write here. |
| Internal collaboration docs | `/Bestly/Internal/Docs/` | Strategy, plans, retros — Nextcloud Office (Collabora). |
| Contractor / hiring artifacts | `/Bestly/Internal/Hiring/<Candidate>/` | Resumes, take-homes, scorecard exports. |
| Press kit, public assets | `/Bestly/Internal/Press/` | Mirrors what's in the bestlytech repo's `/public/` for consumption outside the build. |
| Personal Jared files | not Bestly's problem | Wherever you keep them; not Bestly storage. |

## Credentials & secrets

| Where | What goes there | Why |
|---|---|---|
| Supabase env vars | All production runtime secrets (Stripe key, NTFY_TOKEN, service role key, OAuth tokens, etc.) | Where edge functions actually read them at runtime. |
| Cloudflare dashboard | Cloudflare-issued tokens (TURN, R2, Workers) | Canonical source — always retrievable, regenerable, and audit-logged there. |
| Nextcloud Passwords (cloud.bestly.tech) | Human-readable backup of credentials, shared team passwords, anything you'd otherwise keep in 1Password | The dogfood replacement for 1Password. **Currently pending install — needs Jared's admin password re-confirmation in the Nextcloud apps catalog.** |
| ~~`/.secrets/` plain text~~ | ~~Reference notes for credentials~~ | **Retired 2026-05-05.** Existing file at `.secrets/cloudflare-turn-bestly-talk.txt` now contains only a pointer to the canonical sources above; no plain-text credentials. |

## Engineering code

Stays in GitHub. The bestlytech repo is the source of truth for code, schema migrations, edge functions, and engineering-specific docs (READMEs, runbooks). Strategy / sales / customer-facing collaborative docs move to Nextcloud Files; engineering docs stay in repo.

## Google Drive: status

Read-only archive for legacy material. **No new writes.** Anything currently used actively from Drive should be migrated to Nextcloud Files within a quarter and the original linked-out / archived. After 6 months, the Drive becomes purely cold storage.

## Migration of in-flight Supabase Storage

The `cloud-brand-assets` bucket on Supabase exists and is wired up. Migration plan:

1. Stand up `/Bestly/Clouds/` folder structure on cloud.bestly.tech.
2. Generate a Nextcloud app password for a service account (e.g. `bestly-bot`).
3. Update `cloud-brand-upload` edge function to upload to Nextcloud via WebDAV instead of Supabase Storage. Persist returned WebDAV path on the deal's branding subdoc.
4. Migrate any existing assets from Supabase Storage to Nextcloud (one-shot script).
5. Update the operator-side branding preview (in IntakeReviewSection) to read from the new path.

This is a follow-up — not blocking the pre-pitch readiness trio. File it under "next pass" of cloud-intake polish.

## What this doesn't change

- **Backups** — Backblaze stays as the off-site target. The brochure already says "your Backblaze or Bestly-managed."
- **Database** — Supabase stays as the operational DB. The cloud_deals row is the source of truth; Nextcloud Files holds the artifacts referenced from rows.
- **CDN** — Cloudflare stays in front of bestly.tech.

## Action items

1. Create the `/Bestly/Clouds/` and `/Bestly/Internal/` folder structure on cloud.bestly.tech (next time you're in Files, or have me drive it).
2. Migrate `docs/customer-intake-opusplan.md`, the three product inventories, and the audit doc to `/Bestly/Internal/Docs/Strategy/` so Eli can co-edit.
3. Plan `cloud-brand-assets` Supabase → Nextcloud migration as a clean follow-up before any real customer brand uploads happen.
4. Add a `Files-driven` badge or note on the relevant operator UIs ("synced from Nextcloud") once the swap is done.
