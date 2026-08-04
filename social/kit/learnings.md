# Bestly Cloud Learnings (updated 2026-08-02)

Rewritten weekly by `bestly-cloud-growth-loop` (Sun 5pm PT). Read every daily engine run.

LinkedIn API re-tested this run: `/v2/userinfo` -> 200 (token live), but `/rest/organizationAcls` and
`/v2/organizationalEntityShareStatistics` both -> **403 ACCESS_DENIED**. Unchanged since 07-16 — the token
lacks `r_organization_admin` / `w_organization_social`. Metrics below pulled via Chrome MCP from
Page posts + Analytics > Content. **Saves are not exposed anywhere in Page analytics** — ranked by
clicks / engagement rate / impressions instead.

## THE HEADLINE: we finally have signal
Last week every post was 3-4 impressions and 0 of everything. This week:
- **38 impressions in 7 days, +533%.** Search appearances 32, +77.8%. Page visitors 2, +100%.
- **The 7/27 post got 22 impressions and 2 clicks — 9.09% CTR, 9.09% engagement rate.**
  That is the **first non-zero engagement this page has ever recorded.**
- Still **1 follower. 0 new followers. 0 reactions, 0 comments, 0 reposts** all-time.
  Distribution is coming from hashtag/search surfaces, not followers.

## WINNING (do more of this next week)
- **Theme: `saas-math`, specifically the WASTE cut.** "Half your software seats are paid for and empty"
  (53% of licenses unused) = 22 impressions + the only 2 clicks in account history. 5.5x the 4-impression
  baseline. This is the strongest result we have. Run saas-math ~2x/week and keep the waste framing.
- **Hook shape: flat declarative accusation, not a question.** The two best posts open by telling the
  reader something true and uncomfortable about themselves — "Half your software seats are paid for and
  empty" (22) and "You pay someone to do your books. You're still the IT guy." (12). The two question
  hooks — "Who else is on the computer that holds your files?" (4) and "...whether you should be the one
  doing it at 11pm" (3) — did 3-5x worse. Clean split, N=4. **Default to declarative.**
- **Length: shorter wins.** Winner was **965 chars — the shortest post in the whole set.** 1211 -> 12 imp,
  1338 (longest) -> 4 imp. Not monotonic (1084 -> 3), so tentative, but **target 950-1150, not 1300+.**
- **Hashtag `#saas` — flagged, N=1, cheap to test.** Of the 6 live posts, the *only* one carrying `#saas`
  is the only one with clicks and 5.5x impressions. Every other live post used `#productivity` in that
  slot. Could easily be coincidence. See experiment 3.
- **Media type: still no signal.** Winner used `hero.png` static brand card — but 7/15 and 7/17 used the
  same card and got 4 each. Media is not driving this. Keep rotating per MEDIA.md.

## LOSING (retire or rework)
- **Question-opener hooks.** 4 and 3 impressions, zero clicks. Retire as the *opening line*. A question is
  fine as the closing CTA (the winner ends with one).
- **1300+ char posts.** The 1338-char post was the longest and among the worst-performing.
- **The publish gate is still the biggest functional loss — but it is improving.** 3 posts went live this
  week (7/27, 7/31, 8/1) vs 1 last week. Live count went 3 -> 6. Still **never published: 07-26, 07-27,
  07-28, 07-29, 07-31**, plus 08-02 pending. Roughly half the pipeline still evaporates at the click.
- **Follower growth is untouched and it is now the ceiling.** 0 new followers, still 1. The Page has
  **50/50 unused "Invite connections" credits sitting in the admin sidebar.** That is the single
  highest-leverage unused lever on the account and it costs Jared about two minutes.

## THIS WEEK'S EXPERIMENTS (2-3, budget 25% of posts)
1. **Microsoft raised small-business prices roughly twice as much as enterprise prices.** Fresh (July 2026):
   M365 Business Basic **+16.7%** (to $7), Business Standard **+12%** (to $14) — while enterprise
   E3 rose **8.3%** ($36 -> $39) and E5 **5.3%** ($57 -> $60). Also: 41% of SMB owners report software costs
   rose in the last 12 months. Rationale: doubles down on the two things that just won (saas-math theme +
   declarative accusation hook), with a number that is weeks old and genuinely unfair-feeling. Draft hook:
   "Microsoft just raised small business prices twice as hard as enterprise prices." Pair with flat-$199.
2. **Carousel / multi-image format — carried forward, still never attempted.** 2026 algorithm research is
   consistent: dwell time is the dominant signal (61s+ dwell -> ~15.6% engagement vs 1.2% at 0-3s), and
   carousels force 30-60s of swiping with each swipe counted as a micro-engagement. Build the *winning*
   saas-math waste story as a 4-5 slide carousel: slide 1 hook, 2-4 the numbers, 5 Bestly + CTA. Rationale:
   format is still the largest untested lever, and now we know which story to put in it.
3. **`#saas` as a controlled variable.** Put `#saas` on every post for the next 7 days, holding the other
   three tags at `#smallbusiness #entrepreneur #startup`. If impressions stay elevated across mixed themes,
   it is the tag; if only saas-math posts lift, it is the theme. Cheap, zero creative cost, disambiguates
   the single biggest confound in this week's data.

Held in reserve (fresh, unused): AWS/Azure/GCP forecasting 5-10% rate increases in H2 2026; Cloudflare SMB
pricing +8.77% YoY vs enterprise +5.59%; $10,800 SaaS spend per employee per year (up from $9,643 in 2025);
25-30% of licenses unused = ~$45B wasted globally. Nextcloud line for behind-the-box: Hub 26 Spring 34.0.2,
July 2026 maintenance updates, next drop 08-13.

## STATS SNAPSHOT (ranked, live posts, Jul 20 - Aug 3)
| Live | Theme | Hook shape | Chars | Impr | Clicks | Eng % |
|------|-------|-----------|-------|------|--------|-------|
| 7/27 | saas-math (waste / empty seats) | declarative stat | 965 | **22** | **2** | **9.09%** |
| 8/1  | homelab-vs-business (delegation) | declarative accusation | 1211 | 12 | 0 | 0% |
| 7/31 | ask-a-boring-question | question | 1338 | 4 | 0 | 0% |
| 7/25 | homelab-vs-business (diy crossover) | question | 1084 | 3 | 0 | 0% |
| 7/17 | saas-math (39% / $156) | declarative stat | — | 4 | 0 | 0% |
| 7/15 | own-your-infrastructure (object analogy) | declarative analogy | — | 4 | 0 | 0% |

Account totals Jul 3 - Aug 1: **49 impressions, 0 reactions, 0 comments, 0 reposts, 2 clicks.**
Confidence: LOW on everything except "the 7/27 waste post clearly outperformed" — that gap is 5.5x and
carries the only clicks, which is too large to be noise at this scale.

## RESULT of LAST WEEK'S EXPERIMENTS (close the loop)
- **Exp 1 — carousel format:** **not run.** No carousel was ever built. Carried forward as experiment 2.
- **Exp 2 — $10,800/employee waste number:** **not run.** The 08-02 post used renewal-price-increase data
  (79% hit a price increase, 12.2% enterprise software inflation) instead, and is still awaiting click.
  Number carried to reserve.
- **Exp 3 — story / authentic-voice hook:** **staged, never published.** The 07-29 migration post used the
  `first-person-story-nothing-broke` hook. It is one of the five posts still stuck at `awaiting_click`.
  Unresolved.
- **Correction to last week's log — the two-weeks-ago experiment actually WON.** The unused-license
  SaaS-waste angle was recorded 07-27 as "stalled at awaiting_click, unresolved." It was not. Jared clicked
  it and it went live **7/27**, and it is now the best-performing post in account history (22 impressions,
  2 clicks, 9.09% engagement). **Lesson: do not mark an experiment dead on the strength of the
  `published_status` field — posts publish days late. Always reconcile against the live feed.**

## Anti-patterns (apply preemptively)
- Never write for insiders when the buyer is an outsider. "Marketing is for people that don't understand
  what you do."
- Never use #selfhosted or #devops — those gather devs, not buyers. Use #smallbusiness #entrepreneur
  #startup (+ #saas, under test).
- Never open with a question. Open with a flat statement about something the reader is already doing.
- Never post two consecutive days with the same hook shape.
- Never exceed ~1250 chars.
- Never link to `cloud.bestly.tech` if it's 5xx — fall back to `bestly.tech/cloud`.
- Never assume a staged post published — and never assume it *didn't*. Verify against the live
  "Page posts > Published" view every run; `awaiting_click` stalls silently and clears silently.
- LinkedIn composer gotchas: attach the image FIRST then type the body (typing first gets wiped when the
  media editor opens); commit each hashtag with a trailing space, never press Escape (it deletes the token).
