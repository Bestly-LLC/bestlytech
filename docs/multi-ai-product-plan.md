# Bestly Multi-AI — Product Plan

**Last updated:** 2026-05-19
**Status:** Active scope. Implementing now.

## Why this matters

Multi-AI is the differentiator on Bestly In-House Cloud. The pitch to clients:
> "Use our local AI for everyday tasks — your prompts never leave the box. Use
> a hosted AI when you need the heavy hitter. We never let your IP, secrets,
> or PII slip into a hosted prompt by accident."

Every deployment Bestly ships should get this configuration out-of-the-box.
What we build here in `cloud.bestly.tech` (Bestly's own Nextcloud) is the
reference image we clone for new customers.

## Decisions locked

1. **Model list curation:** Admin-only. Each deployment ships with a curated
   shortlist of 4-8 models. End users see only those. No 357-item dropdown.
2. **Auto-routing strategy:** Privacy-first. Client-side scan for PII /
   secrets / code → forces local. Otherwise routes by complexity heuristic
   (short prompt → local, long/complex → hosted).
3. **Manual-hosted privacy guard:** Warn + redact. When user picks a hosted
   model and the client-side scanner detects sensitive content, we (a) show a
   one-time confirmation, (b) redact obvious secrets (API keys, JWTs, SSNs,
   credit-card-shaped numbers) before sending.

## Scope of work

### Phase 1 — Quick wins (today)
- **P1.1** Fix text cutoff in the model picker dropdown (CSS overflow).
- **P1.2** Shrink the picker to the admin-curated shortlist. Hide the
  357-model OpenRouter catalog by default. Admin curates via the existing
  `MultiAiProvidersPanel.vue`.
- **P1.3** Add an "Auto" option at the top of the picker (placeholder routing
  for now — defaults to local until P3 lands).
- **P1.4** Polish admin panel: per-provider "Active models" multi-select
  populated from the provider's `/models` endpoint, with a "use these in
  user picker" toggle.

### Phase 2 — BYOK plumbing (today / tomorrow)
- **P2.1** Verify Personal Settings → "Multi-AI keys" panel actually renders
  on cloud.bestly.tech (built in earlier session as `MultiAiUserKeys.vue`).
- **P2.2** Make sure per-user keys actually override the admin key — already
  in `SettingsOverride::apiKey()` but needs an end-to-end test.
- **P2.3** Admin toggle: "Allow user-supplied keys" (per provider).

### Phase 3 — Auto routing + privacy guard (next sprint)
- **P3.1** Client-side scanner (JS) that detects, before submit:
  - API keys (regex: `sk-*`, `xoxb-*`, `ghp_*`, `AKIA*`, `eyJ*` JWTs, generic
    20+ char hex tokens)
  - SSN-shaped (`\d{3}-\d{2}-\d{4}`)
  - Credit-card-shaped (Luhn validation)
  - Email + phone (configurable per deployment — some clients want this
    locked, others don't)
  - Code blocks (triple-backtick or 5+ lines of code-shaped text)
- **P3.2** Auto-mode router:
  - If scanner detects PII/secret/code → route to local
  - Else if prompt < 500 chars → route to local
  - Else → route to hosted
  - Both local and hosted are picked from the admin shortlist; admin marks
    one model as "Auto-local default" and one as "Auto-hosted default"
- **P3.3** Confirmation modal for manual hosted send:
  - Lists what the scanner detected
  - "Send anyway" / "Send to local instead" / "Edit message"
  - Redact button strips detected tokens with `[redacted]` placeholders
- **P3.4** Audit log: every Auto decision + every redaction logged to
  `oc_bestly_ai_usage` (extend the existing telemetry table). Admin sees
  which prompts went where.

### Phase 4 — Ship it as the reference image
- **P4.1** Package the curated shortlist into a "Bestly Cloud default
  config" seed script that runs as part of new deployment bootstrap.
- **P4.2** Document the privacy posture in `docs/CUSTOMER_GUIDE.md` —
  explain Auto routing + redaction + audit log in plain English.
- **P4.3** Add this to the Bestly In-House Cloud brochure as a named
  feature ("Privacy-Aware AI Routing").

## Default curated shortlist (Bestly Cloud reference)

When a new client gets a Bestly In-House Cloud, this is what their users see
out of the box:

**Local (your hardware, free):**
- `llama3.2:3b` — Everyday Chat (Local)
- `qwen3:4b` — Reasoning (Local)

**Hosted (OpenRouter, billed):**
- `anthropic/claude-sonnet-4.5` — Best General (Hosted)
- `anthropic/claude-haiku-4.5` — Fast Hosted
- `openai/gpt-4o` — GPT-4o (Hosted)
- `google/gemini-2.0-flash` — Gemini Flash (Hosted)

Admin can swap any of these per deployment.

## Privacy posture (marketing-grade copy)

> Bestly In-House Cloud runs AI in three modes. **Local** keeps your prompt
> on your hardware — it never touches the internet. **Hosted** sends to a
> chosen third-party model (Anthropic, OpenAI, Google) over an encrypted
> connection — fast and powerful, but the prompt leaves your premises.
> **Auto** is the smart default: we scan every prompt before it leaves the
> browser. If we see anything that looks like a secret, a customer record,
> source code, or anything sensitive, we route to Local automatically. You
> can always override per-message.

## Open questions parked
- Should we offer a "Private Hosted" tier — a Bestly-operated OpenRouter
  proxy that strips logs server-side, sold as a midpoint between local and
  raw hosted? (Decision deferred to after Phase 3.)
- Should the audit log be exportable as a customer-facing privacy report?
  (Probably yes, but post-Phase 4.)
