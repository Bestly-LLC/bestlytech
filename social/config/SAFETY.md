# Bestly Cloud — Safety Rules (non-negotiable, carried verbatim from the Cookie Yeti playbook)

## THE #1 RULE
**NEVER auto-post COMMENTS on other people's posts.** LinkedIn, Reddit, and every other platform detect + ban automated commenting. A flagged BRAND account is usually permanently unrecoverable (lose handle, followers, verified status, linked domain).

- Posting **OWN content** via official API = **fine, automate it.**
- Commenting on **OTHERS' posts** = **must be human.** Draft only, human clicks post.

When the owner asks to "fully post them," HOLD THE LINE and offer the near-automatic alternative: load each drafted comment to clipboard one at a time + open the target post so the owner taps paste→post, advancing on "next."

## Human comment cadence
5–15 comments/day maximum, spaced out, not bursty. Bursty posting is the #1 spam signal.

## Comment-drafting rules (apply to every reply)
1. **Lead with genuine help or a relatable line — never a pitch.**
2. **Plain language, never jargon** (e.g. "the box runs Nextcloud + Talk in a single unit" not "unified collaborative platform").
3. **Mention Bestly Cloud ONLY when it actually answers the post.** ~1 in 3 replies should be **pure help with NO mention** (builds goodwill, dodges spam flags).
4. **Every reply UNIQUELY worded.** Never reuse phrasing — platforms flag duplicates in seconds.
5. **Disclose founder status when promoting** — "I built a private-cloud appliance for exactly this…" — honest, not sneaky.
6. **Reddit specifically:** no hashtags, no hard sell, link only if asked or in a follow-up; lead with help; strict subs (`r/privacy`, `r/sysadmin`) get **no-mention** replies only.
7. **Don't promise what isn't live.** If cloud.bestly.tech is 5xx, do NOT tell people to "check it out at cloud.bestly.tech" — use the marketing page bestly.tech/cloud instead, or ask them to DM.

## Pre-post gate (checked every content-engine run)
Before publishing OWN content:
1. `curl -sS -o /dev/null -w "%{http_code}" https://cloud.bestly.tech/status.php` — must be 200.
2. `curl -sS -o /dev/null -w "%{http_code}" https://bestly.tech/cloud` — must be 200 or 3xx.
3. If either fails, HOLD the post, stage it, log a flag in `kit/staging/<date>/run-report.md`, and notify the owner. Do not publish.

## Deletion / correction
If a post goes out and cloud.bestly.tech drops within an hour, PULL the post via API and re-stage. Never leave a live pitch pointing at a dead demo.

## Token handling
- Never print tokens in logs, messages, or artifacts.
- All secrets live in `social/secrets/.env` — git-ignored via project `.gitignore`.
- If a token is missing at run time, the engine STAGES the post to `kit/staging/<date>/` and does NOT publish. It logs which token(s) are missing.

## Cadence guardrails
- LinkedIn own posts: **1/day max**, weekday-biased.
- Reddit own posts: **1–2/week per subreddit max.**
- Reddit comments (human-posted from drafts): **5–15/day**, mixed helpful/pitch, spaced.

## When in doubt
Draft it. Don't publish it. Show it to Jared.
