# Bestly Cloud Learnings (rewritten 2026-09-01)

Rewritten weekly by `bestly-cloud-growth-loop`. Read every daily engine run.

---

## READ THIS FIRST — EVIDENCE RULES

The previous version of this file stated conclusions as settled fact that were
drawn from 1–4 posts at single-digit impression counts. At that volume a single
post's variance swamps every signal. Those verdicts were then read back by each
daily run as established truth, so the error compounded.

**Minimum-sample rule, binding on every future run:**

| Claim type | Minimum before it may be written as a conclusion |
|---|---|
| Hashtag effect | 30 posts per variant |
| Hook style | 30 posts per variant |
| Theme retire/promote | 10 posts of that theme |
| Length effect | 30 posts |
| Anything else | 30 posts |

Below those thresholds, record under OBSERVATIONS with the sample size attached.
**Never write "retire", "winner", "proven", or "resolved" below threshold.**
One variable at a time. Note confounds explicitly.

---

## ENGINE STATUS

- **The engine stopped running 2026-08-17. Restarted 2026-09-01 after a 15-day gap.**
  `post_history.jsonl` ends 08-17; both scheduled tasks were absent from the account.
- Treat all pre-08-17 metrics as a separate, closed era. Do not pool them with
  post-restart data without saying so.

## KNOWN BLOCKERS

- **LinkedIn token scope.** Token carries `openid profile email` only.
  `organizationalEntityShareStatistics`, `organizationAcls` → 403.
  Publishing to the Page needs a fresh 3-legged OAuth grant with
  `w_organization_social` + `r_organization_social` + `rw_organization_admin`.
  **A refresh will not fix this.** Until re-granted, the daily run stages
  instead of publishing and alerts the owner.
- **Image attach.** `file_upload` failed 11 consecutive runs (08-05 → 08-16).
  The tool only accepts files under the session's own uploads/outputs paths or
  a connected folder. Staging images inside a repo checkout is rejected.
  Copy the asset to the session outputs path first, then upload from there.
- **Publish write-back was never implemented** — four live posts sat recorded as
  `awaiting_click`. Every run must now write `published|staged|failed` plus the
  post URN back to `post_history.jsonl` before it exits.

## DISTRIBUTION — HIGHEST LEVERAGE, STILL UNDONE

- **Page has ~1 follower and the 50/50 "Invite connections" credits are unused,
  now 6+ weeks running.** Two minutes of owner time.
- At ~21 impressions/week, content quality is not measurable. Reach work
  outranks content work until the page clears a few hundred impressions/week.

---

## OBSERVATIONS (unconfirmed — do not act as if settled)

- `own-your-infrastructure` / cloud-repatriation framing drew 17 of one week's 21
  impressions. **N=1.** Directional only.
- Declarative third-party stat as opening line: best result twice (17, and 24 on
  07-27). **N=2.** Worth continuing to test, not established.
- Posts carrying `#saas` averaged 2.3 impressions (N=3); the one without it got 17
  (N=1). Gap looks large but is **confounded with content and hopelessly
  under-powered.** Continue running both; do not retire the tag on this basis.
- `behind-the-box` / patch-day angle: 1 and 0 impressions. **N=2.** Weak, but two
  posts is not grounds for retirement. Park, revisit at N=10.
- All four live posts that week were text-only — because of the attach bug, not by
  choice. **This is not evidence that images underperform.** No image data exists.
- Length ~1,000–1,050 chars on the two best posts. **N=2. Noise.**

## NOT SUPPORTED BY DATA

- Any claim that a hashtag, theme, or format has been "proven" or "resolved."
- Any comparison of image vs text-only posts.
