# Bestly Cloud Learnings (updated 2026-08-16)

Rewritten weekly by `bestly-cloud-growth-loop` (Sun 5pm PT). Read every daily engine run.

LinkedIn API re-tested: `/v2/userinfo` -> 200 (token live, Jared Best), but
`organizationalEntityShareStatistics` -> **403 ACCESS_DENIED** on v2 and **403** on `/rest` v202503;
`organizationAcls` -> 403. Token carries only `openid profile email`. Needs a **fresh 3-legged OAuth
grant with `r_organization_social` + `rw_organization_admin`** — a refresh will not fix it. All metrics
below pulled via Chrome MCP from Page posts > Published. **Saves are still not exposed anywhere in Page
analytics**, so ranking falls back to impressions.

## THE HEADLINE: first real week-over-week lift, and the #saas test finally resolved
**21 post impressions in 7 days, +600% week-over-week.** Search appearances 6 (+20%). Still **1
follower, 0 new followers, 0 page visitors, 0 comments, 0 reposts.** The **50/50 "Invite connections"
credits are STILL unused — four weeks running.** Two minutes, highest-leverage lever on the page, still
untouched.

Big process finding: **4 posts went live this week (08-10 through 08-13) but `post_history.jsonl` had
all four recorded as `awaiting_click`.** The engine never writes back publish status, so the loop has
been under-counting live posts for weeks. Backfilled this run. Fix the write-back in the daily engine.

The `file_upload` Chrome MCP bug is now on its **11th consecutive occurrence** (08-05 through 08-16).
Every single post that went live this week was text-only as a result.

## WINNING (do more of this next week)
- **Theme: `own-your-infrastructure`, cloud-repatriation framing. 17 impressions — 81% of the entire
  week's reach from one post.** "A fifth of everything businesses moved to the cloud last year is
  already being moved back out." Second-best post in account history behind 7/27's saas-math waste post
  (24). A borrowed-authority industry-reversal stat is now 2-for-2 as the strongest opening move.
- **Hook style: declarative stat, third-party reversal.** Not our number, not our claim — an industry
  fact that implies the buyer is on the wrong side of a trend. Beat the field 17 vs 1/2/4 this week.
- **Dropping `#saas` correlates with the win.** See LOSING. Use `#privacy` in the 4th slot instead.
- **Text-only is not hurting us.** All 4 live posts were text-only and the week posted its first real
  lift (+600%). Confounded with content quality and a low base, so this is *permission* to keep going
  text-only while the attach bug is unfixed — not proof images are bad.
- **Length: ~1,000-1,050 chars.** Winner was 1,028. Every post over 1,090 or under 900 underperformed
  it. Weak signal (N=4), but consistent with the 7/27 winner at 965.

## LOSING (retire or rework)
- **`#saas` is the prime suspect for suppressed reach — the test finally resolved.** Three live posts
  carried `#saas` (08-10, 08-11, 08-12): **2, 4, 1 impressions, avg 2.3.** The one live post that
  dropped it for `#privacy` (08-13): **17.** Third attempt at this experiment, first clean read.
  N=4 and confounded with content, so treat as directional — but the gap is 7x. **Retire `#saas`;
  run `#privacy` for two weeks and watch.**
- **Theme: `behind-the-box` patch-day post — 1 impression, the worst result in account history.** The
  "we patch it for you" angle has now failed twice (08-03 dogfood got 0). Operational-diligence content
  is insider content. The buyer does not care that patching happens; they care what it costs them not
  to have it. **Rework or retire this theme.**
- **The refreshed $10,800/employee number did not carry a post.** 08-10 ran it as the opening line and
  got 2 impressions. The number is fine; leading with a raw spend figure is not enough. It works as
  *supporting* evidence under a reversal hook, not as the hook itself.
- **Follower growth: still zero, four weeks.** Every impression number on this page is capped by a
  1-follower distribution base until the invite credits get used.

## THIS WEEK'S EXPERIMENTS (2-3, budget 25% of posts)
1. **Escalate the repatriation stat to the strongest current number.** Fresh 2026 research: **86% of
   CIOs plan to move workloads back from public cloud — the highest rate ever recorded**, and private
   infrastructure runs **40-50% lower TCO on steady-state workloads**. Our winner used the softer "a
   fifth." Draft hook: "86% of IT leaders are planning to move work back out of the cloud. Almost none
   of them are small businesses — and that's the mistake." Run as `own-your-infrastructure`.
2. **`#privacy` as the controlled variable, replacing `#saas`.** Tag every post
   `#smallbusiness #entrepreneur #startup #privacy` for 7 straight days. This is the same controlled-test
   design that just resolved, pointed at the replacement. Depends on posts actually going live — flag
   to Jared explicitly.
3. **Sovereignty angle, untested theme adjacent to `compliance-adjacent`.** **57% of IT leaders now say
   they need infrastructure running inside a single country** (Nutanix ECI 2026). Pairs naturally with
   `#privacy` and with the "one computer you can walk into" product story. Draft hook: "More than half
   of IT leaders now say their data has to physically stay in one country. Most small businesses have no
   idea where theirs is."

Held in reserve (fresh, unused): Nextcloud August maintenance updates shipped **32.0.14 / 33.0.8 /
34.0.3** — usable for behind-the-box *only if* reframed to buyer cost, not diligence. Microsoft 365
Business Basic $6 -> $7 and Business Standard $12.50 -> $14 effective **July 1 2026** (8-33% across the
line) — now a past-tense bill your reader has already paid, stronger than a forecast. Google Workspace
+17-22% on the Gemini bundle. Carousel/multi-image format (four weeks carried, engine has no build path
— needs an engineering change or drop it permanently).

## STATS SNAPSHOT (ranked, last 7 days)
| Post | Theme | Hook | Chars | Tags | Saves | Impressions | Eng % |
|------|-------|------|-------|------|-------|-------------|-------|
| 8/13 | own-your-infrastructure | declarative reversal stat | 1028 | `#privacy` | n/a | **17** | 0% |
| 8/11 | homelab-vs-business | declarative tipping-point | 1091 | `#saas` | n/a | 4 | 0% |
| 8/10 | saas-math | declarative spend stat | 863 | `#saas` | n/a | 2 | 0% |
| 8/12 | behind-the-box | advance-notice diligence | 1036 | `#saas` | n/a | 1 | 0% |

Week totals: **21 impressions (+600% WoW)**, 6 search appearances (+20%), 0 new followers, 0 visitors,
0 reactions, 0 comments. Never published: 08-09, 08-14, 08-15, 08-16 (all stalled at `awaiting_click`).
All-time best remains 7/27 saas-math waste post (24 impr, 2 clicks, 8.33%).
Confidence: **LOW** on every creative read (N<5 per bucket, 1-follower base). Highest-confidence claims
are the two structural ones: the invite credits are unused, and the engine does not write back publish
status.

## RESULT of LAST WEEK'S EXPERIMENTS (close the loop)
- **Exp 1 — text-only on purpose: RAN (accidentally, 4/4 posts).** The attach bug forced it. Week posted
  +600% WoW lift. Not clean evidence, but no evidence of harm. Continue.
- **Exp 2 — refreshed $10,800/employee number: RAN, FAILED.** Published 08-10, 2 impressions. Demote the
  number from hook to supporting evidence.
- **Exp 3 — `#saas` controlled variable: RAN, RESOLVED AGAINST.** Third attempt, first read. `#saas`
  posts averaged 2.3 impressions; the one post without it got 17. Retiring `#saas`.

## Anti-patterns (apply preemptively)
- Never write for insiders when the buyer is an outsider. The 08-12 patch post (1 impression) is the
  cleanest example yet — "we handle updates" is a feature only IT people admire.
- Never use #selfhosted or #devops. **New: never use #saas either** — 7x reach gap this week. Use
  `#smallbusiness #entrepreneur #startup #privacy`.
- Never open with a question as the FIRST line. Question closers are fine if specific and testable
  ("comment your team size") — generic "agree?" closers are algorithm-discounted in 2026.
- Never lead with our own pricing or our own spend stat. Lead with a third-party reversal the reader is
  on the wrong side of, then bring the number in as support.
- Never post two consecutive days with the same hook shape.
- Target ~1,000-1,050 chars; never exceed ~1,250.
- Never link to `cloud.bestly.tech` if it's 5xx — fall back to `bestly.tech/cloud`.
- **Never trust `published_status` in `post_history.jsonl`** — it was wrong on 4 of 4 live posts this
  week. Always verify against Page posts > Published, and write the correction back.
- LinkedIn composer gotchas: attach image FIRST then type body; commit each hashtag with a trailing
  space, never press Escape. **The Chrome MCP `file_upload` bug has now broken media attach on 11
  consecutive runs (08-05 -> 08-16).** Needs an engineering fix outside this loop, or the engine should
  formally switch to text-only and stop generating renders it cannot attach.
