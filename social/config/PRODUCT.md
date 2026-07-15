# Bestly Cloud — Product Block

Bestly Cloud is managed or self-hosted cloud infrastructure by Bestly LLC. It's the "own your infrastructure without running IT" alternative to per-seat SaaS.

## What it is
A Nextcloud-based private cloud that ships as either (a) a fully-managed appliance we run, or (b) a self-hosted box the customer keeps on-prem. Files, calendar, contacts, chat/talk, password vault, notes — the office suite — all in one box, no per-seat pricing, no vendor lock-in.

## Pricing (don't misquote — these are the current numbers)
- **Managed plan** — **$199/mo flat** (monitoring, updates, backups, priority support). No per-seat pricing, ever. **$6,500 startup cost** (hardware + provisioning + white-label branding + install).
- **Self-hosted plan** — **$6,500 one-time**, **$0/mo**, **$149/call** on-demand support. Offer this only as a fallback when the customer specifically rejects managed — never lead with it.

## Where it lives
- Product page: **https://bestly.tech/cloud**
- Live customer instance (dogfood): **https://cloud.bestly.tech** — Nextcloud, Talk, Vaultwarden, n8n
- Marketing site: https://bestly.tech

## Audience
Small businesses (5–50 seats), agencies, healthcare/legal/professional-services teams that care about data control, and technical solo owners who don't want SaaS per-seat bills growing every hire. **NOT a consumer app** — write for a technical buyer or a business owner who's tired of SaaS bills. Never write in a "teen TikTok" voice.

## Voice
Bestly voice = privacy-first, plain-spoken, anti-big-tech. Direct. Not corporate. Not hype-y. Say "we run it, so you don't have to" not "revolutionize your workflow." No emoji on public-facing surfaces (per bestlytech CLAUDE.md convention). Short sentences. One idea per line where it helps.

## Things NOT to claim
- Don't claim "unlimited" anything — plans have real hardware limits.
- Don't say "faster than Google Drive" or make speed claims without benchmarks.
- Don't imply HIPAA/SOC2 certification — we help with compliance posture, we're not audited.
- Don't quote a price other than the two above.
- Don't say "self-host it today" if `cloud.bestly.tech` is down (recurring 530 issue — engine must pre-check).

## Pre-post safety gate (checked by content engine every run)
Before publishing any post that links to or references cloud.bestly.tech, curl it and verify HTTP 200. If it returns 5xx, HOLD the post and log a flag instead. Non-negotiable — never send prospects to a dead demo.

## Owner
- LLC: Bestly LLC (EIN 99-3280347)
- Founder: Jared Best
