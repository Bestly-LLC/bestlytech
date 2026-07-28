# Bestly Cloud Learnings (updated 2026-07-27)

Rewritten weekly by `bestly-cloud-growth-loop` (Sun 5pm PT). Read every daily engine run.

LinkedIn API still broken (`403 ACCESS_DENIED` on `GET /v2/organizations/{id}`; `400 ILLEGAL_ARGUMENT` on share-statistics — token lacks Community Management API scope). Re-tested via curl this run, same failure as every run since 07-16. Metrics below pulled via Chrome MCP from the live Page-posts admin view instead.

## REALITY CHECK (read this first — nothing below changes the priority order)
- **The problem is distribution, not content.** The page has **1 follower** (Jared's own account). Every live post gets single-digit impressions and **zero** likes/comments/reposts/saves. No hook or theme tuning fixes a 1-follower page. Growing the audience (invite connections, cross-post from Jared's personal profile, get the page past ~50 followers) matters more than anything in the WINNING/LOSING sections.
- **The manual-click step is still leaking most of the pipeline.** Of the ~9 posts staged 07-18 → 07-26, only the 07-24/25 homelab post ever actually went live. 07-18, 21, 22, 23, 26 are still `awaiting_click` and never published. Every daily run stages a post but stops at the human approval gate, and the gate isn't being cleared. **Flag to Jared: either commit to a daily one-click habit, or approve the LinkedIn Community Management API path (opusplan Phase 2) so posts auto-publish.**
- **N is still tiny and every data point is zero-engagement.** All rankings below are LOW-CONFIDENCE / directional. We have no positive engagement signal to learn from yet — including no saves data (view shows impressions only, and engagement is 0 regardless).

## LIVE RIGHT NOW (Page posts > Published, this run)
Exactly 3 posts are actually live:
| Live date | Content | Media | Age | Impressions | Engagement |
|-----------|---------|-------|-----|-------------|------------|
| 7/25 | Homelab / "you can run your own office server… at 11pm" (IT-salary math) | device shot (side) | 1d | 3 | 0 |
| 7/17 | SaaS math / "software bill up 39%" | hero.png | 1w | 4 | 0 |
| 7/15 | Own-your-infrastructure / "you bought your desks…" | hero.png | 1w | 4 | 0 |

Only the 7/25 post is inside the 7-day window. 07-18/21/22/23/26 never published.

## WINNING (tentative — do more of this next week)
- **Theme: rent-vs-buy / own-your-infrastructure.** The two oldest live posts (07-15 object-analogy, 07-17 SaaS-math) both hit 4 impressions vs. 3 for the newer homelab post — but the 3 vs 4 gap is noise at this N, and the older posts have simply had a week to accrue. No real winner. Keep the rent-vs-buy spine in rotation.
- **Hook: concrete-object analogy** ("You bought your desks. You bought your printer.") — still the owner's most-approved shape and the plainest-spoken. Keep as the safe default.
- **Post hour: still uninterpretable** — publish time is set by whenever the manual click happens, not the intended slot, so hour data is contaminated. No conclusion.
- **Media type: static brand card vs. device shot — no signal.** Both are live; both at ~3-4 impressions. Keep rotating for variety per MEDIA.md, don't over-read.

## LOSING (retire or rework)
- Nothing statistically losing. The **manual Chrome-MCP semi-auto publish path is the biggest functional loss** — it dropped ~5 of the last ~9 posts. This is the single highest-leverage fix and outranks any creative change.
- Do NOT keep pouring effort into hook micro-optimization while at 1 follower — it's polishing a car with no road. Redirect ~1 post/week of effort toward an audience-growth action instead (see experiment 3).

## THIS WEEK'S EXPERIMENTS (2-3, budget 25% of posts)
1. **Carousel format (targets SAVES directly).** Every post to date is single text+image. 2026 algorithm research is unambiguous: saves are now the most-weighted signal, and carousels force 60-90s dwell time → the format most likely to earn saves and extended distribution. Try one 4-5 slide carousel of the SaaS-math story (slide 1 = hook, slides 2-4 = the numbers, slide 5 = Bestly + CTA). Rationale: format is the biggest untested lever and it aims straight at the #1 ranked signal.
2. **Fresh, bigger dollar number reframed as waste.** 2026 benchmark is now **$10,800 per employee per year** on SaaS (up from $9,643 in 2025), and **~25-30% of licenses go unused** (Zylo: avg org wastes $19.8M/yr; only 54% of licenses actually used). Try: "You're paying about $10,800 per employee per year for software — and roughly a third of it, nobody at your company opens." Rationale: bigger + fresher than the $156/mo and 39% framings; dollar-waste angle at this magnitude untested.
3. **Story / authentic-voice hook (sounds like a thought, not a headline).** 2026 hook research favors first-person micro-stories over polished number-shocks. Try opening with a real moment: "A shop owner told me last week she just got a $1,900 renewal quote for software her team barely uses." Rationale: only tested question / object-analogy / number-shock / timeline / fear / unpopular-opinion / diy-crossover / transparency shapes — never a story hook, and it's the shape the algorithm is rewarding now.

## RESULT of LAST WEEK'S EXPERIMENTS (close the loop)
- **Exp 1 — unused-license SaaS-waste angle:** Shipped as the 07-25 "waste-curiosity-gap" post (53% licenses unused / empty-seats framing) — but it stalled at `awaiting_click` and never published. **Unresolved** (blocked by the click bottleneck, not by content).
- **Exp 2 — Nextcloud AIO v13.3.1 dogfood "behind the box":** Not run. The 07-26 behind-the-box post used data-loss stats instead of the deSEC/AIO detail. **Not attempted** — carry forward if a behind-the-box slot opens. (Current Nextcloud line: Hub 26 Spring / 34.0.2, maintenance updates shipped July 2026.)
- **Exp 3 — contrarian/unpopular-opinion hook:** Shipped as the 07-23 compliance-adjacent post — also stalled at `awaiting_click`, never live. **Unresolved.**
- Meta-lesson: **all three experiments are unresolved for the same reason — they were staged but never clicked live.** We cannot measure creative experiments until the publish gate is cleared. This is now the #1 blocker to the whole compounding loop.

## Anti-patterns (apply preemptively)
- Never write for insiders when the buyer is an outsider. "Marketing is for people that don't understand what you do."
- Never use #selfhosted or #devops — those gather devs, not buyers. Use #smallbusiness #startup #entrepreneur.
- Never post two consecutive days with the same hook shape.
- Never link to `cloud.bestly.tech` if it's 5xx — fall back to `bestly.tech/cloud`.
- Never assume a staged post published — verify against the live "Page posts > Published" admin view, not just the `published_status` field in post_history.jsonl (`awaiting_click` silently stalls).
