# Bestly Cloud Learnings (updated 2026-08-09)

Rewritten weekly by `bestly-cloud-growth-loop` (Sun 5pm PT). Read every daily engine run.

LinkedIn API re-tested this run: `/v2/userinfo` -> 200 (token live, identity = Jared Best), but
`/rest/organizationalEntityShareStatistics` and `/rest/posts` both -> **400 ILLEGAL_ARGUMENT**, and
`/rest/organizationAcls` -> **403 ACCESS_DENIED**. Root cause confirmed in this week's run-notes: the
token carries only `openid profile email` scopes — it never got `r_organization_admin` /
`w_organization_social`. This needs a fresh 3-legged OAuth grant, not a token refresh. Metrics below
pulled via Chrome MCP from Page posts (per-post "Preview results") + Analytics > Content, which expose
Impressions / Clicks / CTR / Engagement rate / Reactions per post. **Saves are still not exposed
anywhere in Page analytics.**

## THE HEADLINE: distribution ceiling is now a 3-week-old unaddressed blocker, and a real publishing bug is compounding it
Account totals (Jul 10 - Aug 8): **52 impressions, 1 reaction, 0 comments, 0 reposts.** Still **1
follower, 0 new followers, all-time.** The **50/50 "Invite connections" credits are still sitting
unused** in the admin sidebar — three weeks running, still the single highest-leverage unused lever,
still costs about two minutes.
New this week: the **08-05 and 08-06 posts both hit a confirmed, reproducing bug** — `file_upload`
(Chrome MCP) fails 5x with `Invalid arguments: paths expected array, received undefined` when the
engine tries to attach the daily image/render. 08-05 published anyway as a **text-only post** (the
image silently never made it in). 08-06, 08-07, and 08-09 stayed stuck at `awaiting_click` rather than
risk another broken attach. This is now the dominant reason the pipeline leaks, ahead of any creative
variable — worth a direct fix outside the content engine (see notes in `post_history.jsonl` 08-06 entry).

## WINNING (do more of this next week)
- **Theme: `saas-math`, the waste framing, still the best result in account history.** 7/27 "Half your
  software seats are paid for and empty" is up to **24 impressions, 2 clicks, 8.33% CTR/engagement
  rate** as more data landed (was 22/9.09% last week). Nothing else has come close. Keep running it
  ~2x/week.
- **Declarative hooks over questions — but with a new wrinkle.** 8/1's declarative accusation ("You pay
  someone to do your books. You're still the IT guy.") pulled **13 impressions**, the second-best post
  in account history, though 0 clicks. But 8/3's declarative dogfood post ("We run our whole company on
  the same computer we sell") got **0 impressions**. Declarative still beats question-openers on
  average, but it is not a guarantee — sample per bucket is still N<5, and the follower-ceiling problem
  below likely swamps the hook-shape signal at this scale.
- **Length claim from last week is now contradicted — downgrade to unconfirmed.** 8/3 was **956
  chars**, squarely in the "950-1150 wins" range called out last week, and it got **0 impressions**.
  Shortest-wins is no longer a clean pattern. Treat char count as a minor lever, not a driver, until
  reach is less noise-dominated.
- **External signal, not yet our own data: text-only posts are the most consistent B2B performer in
  2026 per current LinkedIn-strategy research** — no image, no carousel, strong first line, "sounds like
  a thought, not a headline." We now have an accidental live test of this (08-05, text-only because the
  image attach failed) with data still pending. Worth running on purpose next week regardless of what
  08-05 shows, since it's independently the leading trend-scan finding this week.

## LOSING (retire or rework)
- **Follower growth is still completely untouched.** 0 new followers, 3 weeks straight, 50/50 invite
  credits unused. This is the ceiling on every other number on this page and it is a 2-minute fix.
- **The publish gate leak has a name now.** It's the `file_upload` Chrome MCP bug described above, not
  a vague "Jared hasn't clicked yet" problem. 3 of the last 4 scheduled posts (08-06, 08-07, 08-09)
  never reached a clean one-click state because the composer couldn't attach media. Never published:
  08-02, 08-06, 08-07, 08-09 (08-02 is now over a week stale). Live count this week: 08-03, 08-04, 08-05
  clicked live (nice — 3 for 3 on posts that DID render cleanly).
- **The `#saas` controlled-variable test from last week did not actually run.** It was supposed to go on
  every post for 7 days. It was drafted on 3 of 6 days (08-02, 08-06, 08-09) — and **none of those three
  posts ever went live.** The live posts that did publish this week (08-03, 08-04, 08-05) did not carry
  `#saas`. Second week in a row this experiment stalls on the publish gate rather than resolving either
  way.
- **Microsoft SMB-vs-enterprise price-hike experiment: never drafted.** Theme rotation didn't land on
  `saas-math` again this window (it hit `behind-the-box`, `own-your-infrastructure`, `the-3d-device`,
  `migration-play-by-play`, `ask-a-boring-question`, `compliance-adjacent` instead). Carry forward.

## THIS WEEK'S EXPERIMENTS (2-3, budget 25% of posts)
1. **Text-only format, on purpose.** Current 2026 LinkedIn research is consistent that a strong-first-line
   text post with no image is the most reliable B2B format this year — dwell time and "sounds like a
   real thought" beat polished graphics. We have one accidental data point (08-05) landing this week;
   deliberately schedule one more text-only post next week to get a second read, independent of whether
   the image-attach bug gets fixed.
2. **$10,800/employee, re-confirmed fresh.** 2026 SaaS spend per employee is now $10,800/year, up from
   $9,643 in 2025 — same trajectory as last week's number, now current. Pair with the winning waste
   framing: 25-30% of that spend is estimated wasted. Draft hook: "The average business now spends
   $10,800 a year per employee on software it barely uses." Run as a second saas-math post this week.
3. **Close the #saas loop properly.** Third attempt at the controlled-variable test — tag every post
   `#saas` for 7 straight days. This only works if the publish-gate bug gets fixed first, or if Jared
   manually attaches media when the tool fails; flag this dependency explicitly so the experiment
   doesn't stall a third time for the same non-creative reason.

Held in reserve (fresh, unused): Microsoft SMB-vs-enterprise price-hike gap (+16.7% Business Basic vs
+5.3% E5); carousel/multi-image format (three weeks carried, never attempted — needs a format the daily
engine doesn't currently build); AWS/Azure/GCP forecasting 5-10% H2 2026 rate increases; Cloudflare SMB
pricing +8.77% YoY vs enterprise +5.59%; Nextcloud maintenance releases (32.0.13/33.0.7/34.0.2) due
2026-08-13 — good behind-the-box hook the day of.

## STATS SNAPSHOT (ranked, all live posts to date)
| Live | Theme | Hook shape | Chars | Impr | Clicks | Eng % |
|------|-------|-----------|-------|------|--------|-------|
| 7/27 | saas-math (waste / empty seats) | declarative stat | 965 | **24** | **2** | **8.33%** |
| 8/1  | homelab-vs-business (delegation) | declarative accusation | 1211 | 13 | 0 | 0% |
| 7/31 | ask-a-boring-question | question | 1338 | 4 | 0 | 0% |
| 7/17 | saas-math (39% / $156) | declarative stat | — | 4 | 0 | 0% |
| 7/15 | own-your-infrastructure (object analogy) | declarative analogy | — | 4 | 0 | 0% |
| 7/25 | homelab-vs-business (diy crossover) | question | 1084 | 3 | 0 | 0% |
| 8/3  | behind-the-box (dogfood) | declarative | 956 | 0 | 0 | — (1 reaction) |
| 8/4  | own-your-infrastructure (account switch-off) | conditional-consequence | 1320 | pending | pending | pending |
| 8/5  | the-3d-device (published text-only, image attach failed) | — | 1281 | pending | pending | pending |

Account totals Jul 10 - Aug 8: **52 impressions, 1 reaction, 0 comments, 0 reposts.** 8/4 and 8/5 are too
new for LinkedIn to have surfaced analytics yet (normal ~2-4 day lag) — check first next week.
Confidence: LOW on everything except "the 7/27 waste post clearly outperformed" — still the only post
carrying real click-through, and the gap over the field is too large to be noise at this scale.

## RESULT of LAST WEEK'S EXPERIMENTS (close the loop)
- **Exp 1 — Microsoft price-hike number:** **not run.** Never drafted; theme rotation didn't select
  saas-math this window. Carried forward again.
- **Exp 2 — carousel format:** **not run, third week carried.** No carousel has ever been built; the
  daily engine doesn't currently have a multi-image/document post path. Needs an engine change, not just
  a content decision, to ever get resolved.
- **Exp 3 — `#saas` controlled variable:** **partially attempted, still unresolved.** Drafted on 3 of 6
  days (08-02, 08-06, 08-09), but all three are stuck at `awaiting_click` — none went live. This is the
  second consecutive week this specific experiment fails to resolve for the same reason: the publish
  gate, not the creative choice, is the blocker. Do not re-attempt a clean read on this until either the
  `file_upload` bug is fixed or Jared is manually clicking posts through consistently.

## Anti-patterns (apply preemptively)
- Never write for insiders when the buyer is an outsider. "Marketing is for people that don't understand
  what you do."
- Never use #selfhosted or #devops — those gather devs, not buyers. Use #smallbusiness #entrepreneur
  #startup (+ #saas, still under test — see above).
- Never open with a question as the FIRST line. A question is fine as the closing CTA, but keep it
  specific and testable ("comment your team size") — 2026 research flags generic "agree or disagree?"
  closers as algorithm-discounted engagement bait.
- Never post two consecutive days with the same hook shape.
- Never exceed ~1250 chars, but don't over-index on "shorter is always better" — 08-03 broke that
  pattern at 956 chars with 0 impressions.
- Never link to `cloud.bestly.tech` if it's 5xx — fall back to `bestly.tech/cloud`. Both healthchecks
  green this run (cloud 200, marketing 308).
- Never assume a staged post published — and never assume it *didn't*. Verify against the live
  "Page posts > Published" view every run.
- LinkedIn composer gotchas: attach the image FIRST then type the body; commit each hashtag with a
  trailing space, never press Escape. **New: the Chrome MCP `file_upload` tool has a reproducing bug
  ("Invalid arguments: paths expected array, received undefined") that has now broken media attachment
  on at least two consecutive daily runs (08-05, 08-06) and is very likely why 08-07/08-09 also never
  reached a clean one-click state.** Flag for an engineering fix outside this loop.
