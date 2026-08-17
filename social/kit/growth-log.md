# Bestly Cloud Growth Log

One line per week from `bestly-cloud-growth-loop`. Full detail lives in `kit/learnings.md`.

- 2026-08-16: FIRST WEEK-OVER-WEEK LIFT. 21 impressions in 7 days (+600%), search appearances 6 (+20%).
  Four posts went live (08-10 to 08-13) and one carried the week: 08-13's cloud-repatriation post ("a fifth
  of everything moved to the cloud is already being moved back out") took 17 of the 21 impressions -- 2nd
  best in account history behind 7/27's 24. The #saas controlled-variable test finally RESOLVED after three
  attempts, and resolved against it: three #saas posts averaged 2.3 impressions, the one post that swapped
  in #privacy got 17. Retiring #saas. behind-the-box patch-day post hit 1 impression, the worst ever --
  operational-diligence content is insider content, rework or retire. The refreshed $10,800/employee number
  ran and failed as a hook (2 impr); demoted to supporting evidence. Text-only ran 4/4 by force of the
  file_upload bug (now 11 consecutive occurrences) and did not hurt. Two structural findings outrank all
  creative reads: the 50/50 invite credits are STILL unused (4 weeks), and post_history.jsonl had all four
  live posts recorded as awaiting_click -- the engine never writes back publish status, so the loop has been
  under-counting reality. Backfilled. New experiments: escalate to the 86%-of-CIOs repatriation stat,
  #privacy as the replacement controlled variable, and a data-sovereignty angle (57% of IT leaders need
  single-country infrastructure).
- 2026-08-09: 52 impressions Jul10-Aug8, still 1 follower / 0 new followers / 50/50 invite credits
  unused (3 weeks running). 7/27 saas-math waste post still the best result ever (24 impr, 2 clicks,
  8.33%, updated from 22/9.09%); 8/1 declarative accusation post came in 2nd (13 impr, 0 clicks). New
  contradiction: 8/3's 956-char declarative post got 0 impressions, breaking last week's "shorter always
  wins" read. Root-caused the publish-gate leak: a reproducing Chrome MCP `file_upload` bug broke media
  attach on 08-05 (published text-only by accident) and 08-06 (stayed staged); 08-07 and 08-09 likely hit
  the same wall. That's now the single biggest lever, ahead of any creative choice. #saas
  controlled-variable test stalled a 2nd week for the same publish-gate reason. New experiments: text-only
  format on purpose (2026 trend research favors it), refreshed $10,800/employee SaaS-waste number,
  another #saas attempt contingent on the attach bug getting fixed.
- 2026-07-21: First real data pull (N=2 live posts, 4+2 impressions, zero engagement) — LinkedIn API still 403 ACCESS_DENIED, real bottleneck is 2 of 4 staged posts never got clicked live and the page has only 1 follower, not content quality. Queued experiments: unused-license SaaS-waste angle, Nextcloud AIO v13.3.1 dogfood post, contrarian-opinion hook.
- 2026-08-02: FIRST REAL SIGNAL. 38 impressions in 7 days (+533%), search appearances 32 (+77.8%), and the 7/27 saas-math "half your software seats are paid for and empty" post hit 22 impressions + 2 clicks = 9.09% engagement — the first non-zero engagement this page has ever recorded. Live count 3 -> 6 (Jared clicked 7/27, 7/31, 8/1). Two clear creative reads: declarative accusation hooks beat question hooks 22/12 vs 4/3, and the shortest post (965 chars) won while the longest (1338) lost. Correction to last week's log: the unused-license waste experiment was wrongly marked unresolved — it published 7/27 and is now the best post in account history. Still 1 follower, 0 reactions/comments/reposts all-time, 50/50 invite credits unused, and 5 posts stuck at awaiting_click. New experiments: Microsoft's SMB-vs-enterprise price-hike gap (+16.7% vs +5.3%), carousel format (carried forward), #saas as a controlled variable.
- 2026-07-27: Still 3 live posts total (7/25 homelab 3 imp, 7/17 SaaS-math 4 imp, 7/15 own-infra 4 imp), all zero engagement, page still 1 follower. LinkedIn API still 403. All 3 of last week's experiments went unresolved — staged but never clicked live (07-23, 07-25 stalled at awaiting_click). Root cause is unchanged and now unambiguous: the manual-click publish gate is leaking most of the pipeline and 1-follower distribution caps everything. New experiments: carousel format (targets saves), $10,800/employee waste number, story/authentic-voice hook.
