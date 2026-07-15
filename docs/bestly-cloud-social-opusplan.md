# Bestly Cloud — Social Growth Opusplan

**Master plan for the Bestly Cloud organic social growth engine, cloned from the Cookie Yeti playbook, adapted for B2B, and evolving into a self-improving loop that gets smarter every week.**

Owner: Jared Best
Started: 2026-07-15 (post #1 live on LinkedIn Company Page)
Location: `/Users/jared/Developer/bestlytech/social/`
Playbook of record: mempalace wing `social-growth-playbook` room `playbook`

---

## 1. Why this exists

Bestly Cloud is a B2B private-cloud appliance. Its buyers are small-business owners, agencies, and technical solo operators who are tired of per-seat SaaS bills. Those people don't hang out on TikTok watching cookie-yeti reels. They live on **LinkedIn** (for daily business scroll) and **Reddit** (when they're actively researching a problem — r/selfhosted, r/homelab, r/smallbusiness, r/sysadmin, r/devops).

The goal isn't to trend. The goal is to be the obvious answer when someone types "google workspace alternative for 20 people" or "how do you self-host without a devops team" into their search bar. That means a steady drip of on-brand, plain-language, evidence-backed posts + a helpful presence in the exact threads where the buyer is asking the question.

**Non-goal:** viral growth hacks, "10x your reach" bullshit, or anything that would get the Bestly LLC company page flagged.

---

## 2. Product block (what we're marketing)

- **Managed plan:** $199/mo flat + $6,500 startup. Never per-seat. Ever.
- **Self-hosted plan:** $6,500 one-time + $149/call support. Fallback, not lead.
- **Marketing URL:** [bestly.tech/cloud](https://bestly.tech/cloud) (always healthy)
- **Live demo:** [cloud.bestly.tech](https://cloud.bestly.tech) (recurring 530 issue — never link to it in a post if it's 5xx)
- **Voice:** privacy-first, plain-spoken, anti-big-tech. No emoji. No hype. No jargon (no "self-hosted", "appliance", "vendor lock-in" — say "computer", "in your office", "you own it").
- **Owner rule from 2026-07-14:** "Write it for the dumbest person in the clearest way. Marketing is for people that don't understand what you do." Every post passes the dumb-clarity test.

---

## 3. Architecture (two pillars + growth loop + video kit)

```
┌─────────────────────────────────────────────────────────────┐
│  PILLAR 1 — CONTENT ENGINE                                  │
│  bestly-cloud-daily-post  •  cron 0 8 * * *                 │
│  → Research (WebSearch trends)                              │
│  → Compose (Bestly voice, 8-theme rotation, anti-copy)      │
│  → Publish (API if creds, else Chrome MCP semi-auto)        │
│  → Log to post_history.jsonl                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  PILLAR 2 — COMMENT SCOUT                                   │
│  bestly-cloud-comment-scout  •  cron 15 12 * * *            │
│  → Scan target subs for high-intent threads                 │
│  → Draft 5-10 UNIQUE value-first replies                    │
│  → Output dated markdown file (human posts them)            │
│  → NEVER auto-posts. Non-negotiable.                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  GROWTH LOOP (v3)                                           │
│  bestly-cloud-growth-loop  •  cron 0 17 * * 0  (Sun 5pm)    │
│  → Measure: pull LinkedIn post insights (via API)           │
│  → Learn: which themes/hooks/times got saves + reach        │
│  → Trend-scan: WebSearch what's hot this week               │
│  → Update: kit/learnings.md (biases daily engine)           │
│  → Report: digest to owner                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  VIDEO KIT (v4)                                             │
│  scripts/render-3d-clips.js  •  manual, quarterly rebuild   │
│  → Headless Chromium + Playwright captures CloudScrollHero  │
│  → 12 MP4 clips at 1200x1200, 8-15s each                    │
│  → Daily engine rotates through them                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Phase plan

### Phase 1 — LIVE NOW (2026-07-15)
✅ Scaffold at `social/` (config, kit, staging, secrets, comment-scout)
✅ Two scheduled tasks created + wired for stage-only mode when creds missing
✅ Chrome MCP semi-auto publish path proven (Draft B "Rent vs Buy" is live on LinkedIn)
✅ Hero image reused from existing `public/og-image.png` (perfect thematic match)
✅ Drafts A + C queued for Thu Jul 16 + Fri Jul 17
✅ post_history.jsonl started

**Result:** One post/day auto-composed and pre-loaded. Owner clicks Post from the ntfy notification. ~5 seconds/day of owner time.

### Phase 2 — LINKEDIN API (this week, unlocks true auto)
1. Owner creates LinkedIn Developer App (form at linkedin.com/developers/apps).
2. Owner requests **Community Management API** product access. Approval: 1-3 business days.
3. Owner runs the OAuth 2.0 flow and drops the long-lived token + org URN into `social/secrets/.env`.
4. Daily task auto-publishes without any human click. Ntfy just confirms.
5. Set up `linkedin-token-refresh` scheduled task (LinkedIn tokens expire ~60 days).

**Time cost:** ~20 min to fill in the app form. Then 1-3 day wait. Then 10 min for OAuth + `.env` fill.

### Phase 3 — REDDIT PRESENCE (starts today, matures in 2 weeks)
1. Owner creates `u/bestly_cloud` on Reddit (5 min). Verify email.
2. First 2 weeks: comment scout drafts get posted by owner in the target subs — 5-15 helpful, no-mention replies per day to build karma. **Never link to bestly.tech in this window.**
3. After ~50-100 karma: comment scout drafts can start including Bestly mentions (~1 in 3 replies, per Cookie Yeti rules).
4. After ~2 weeks: enable Tuesday/Friday "own post" drafts in r/selfhosted or r/homelab (still human-posted).

**Time cost:** 15-20 min/day for karma-building comments, then 15 min/day ongoing.

### Phase 4 — GROWTH LOOP (v3, once we have ~2 weeks of data)
1. Weekly scheduled task `bestly-cloud-growth-loop` runs Sun 5pm.
2. Pulls LinkedIn post insights via API for the last 7 days.
3. Ranks themes/hooks/times by reach + saves (saves > likes for LinkedIn algo).
4. Writes `kit/learnings.md` — daily engine reads it and biases 75% winners / 25% experiment.
5. Every week the content compounds — themes that don't perform get retired, winners get repeated with fresh angles.

**Owner cost:** zero (fully automated, read the Sun digest for fun).

### Phase 5 — VIDEO KIT (v4, whenever we want)
1. `social/scripts/render-3d-clips.js` uses Playwright + headless Chromium to record the CloudScrollHero at 12 scroll positions.
2. Output: 12 MP4s at 1200x1200, 8-15s each, h264, ~1MB each.
3. Daily engine picks a fresh clip per post when the theme is device-heavy.
4. Rebuild quarterly or when the marketing hero design changes.

**Owner cost:** one afternoon to build the script + first render batch. Then quarterly refreshes.

---

## 5. The 8 themes (rotating, no repeats within 7 days)

1. **SaaS math** — real cost breakdown ($156/user/mo, +39% since 2023, Google/MS hikes)
2. **Own your infrastructure** — rent vs buy, exit-ability, portability
3. **Behind the box** — dogfood posts, uptime, "this runs on cloud.bestly.tech"
4. **Compliance-adjacent** — HIPAA/GDPR/state-privacy posture (never claim certification)
5. **Migration play-by-play** — walkthrough of moving off a specific SaaS
6. **Homelab vs business** — where hobbyists cross over to buying
7. **The 3D device** — visual/product post with the CloudScrollHero animation
8. **Ask a boring question** — technical Q&A hook (backups, DR, single-tenant vs multi)

---

## 6. Success metrics (checked in Phase 4 weekly digest)

- **Reach** (impressions) per post — target: 10x follower count by month 3
- **Saves** per post — target: 5+ per post by month 3 (LinkedIn's 2026 algo weights this heaviest)
- **Comments** per post — target: 3+ per post by month 3
- **Bestly LLC page followers** — start: 1 (2026-07-15). Target: 100 by end of month 1, 500 by end of month 3
- **Website traffic from LinkedIn referrers** — measured in Vercel Analytics on bestly.tech/cloud
- **Actual inbound demo requests attributed to LinkedIn or Reddit** — the north-star metric

---

## 7. Non-negotiable safety rules (verbatim from `social/config/SAFETY.md`)

1. **Never auto-post comments on ANY platform.** LinkedIn, Reddit, everywhere. Automated commenting = brand-page death.
2. **Pre-post health gate** — never publish a promo that links to `cloud.bestly.tech` when it's 5xx.
3. **Human cadence** — 5-15 Reddit comments/day max, spaced out.
4. **Never fabricate a Reddit URL** — if crawler blocked, use search-page URLs.
5. **Never reuse a hook from the last 30 days** — check `hook_history.jsonl` every run.
6. **Never quote pricing other than the two in PRODUCT.md.**
7. **Never click the final Post button in Chrome MCP without owner's per-session approval** (semi-auto path only).

---

## 8. Owner checklist (in order, with time estimates)

### Right now (< 10 min)
- [ ] Verify Draft B is live on LinkedIn Bestly LLC page — confirm 1 impression at least
- [ ] Bookmark the LinkedIn Bestly LLC company page for daily post-clicks

### This week (~30 min total)
- [ ] Create LinkedIn Developer App at linkedin.com/developers/apps (see `social/config/CREDENTIALS.md`)
- [ ] Request Community Management API product access
- [ ] Create `u/bestly_cloud` on Reddit — check availability first
- [ ] Copy `social/secrets/.env.template` → `.env` (leave LinkedIn vars empty until token arrives, fill Reddit creds now)

### Every day for 2 weeks (~15 min/day)
- [ ] Get ntfy alert at 8am, tap Post on the pre-loaded LinkedIn composer (5 sec)
- [ ] Get ntfy alert at 12:15pm, open today's `comment-scout/YYYY-MM-DD.md`, post 5-8 helpful Reddit replies (as `u/bestly_cloud`) spaced across the afternoon
- [ ] Zero Bestly mentions in Reddit comments this window — pure help only, to build karma

### Once LinkedIn Community Management API approval hits (1-3 days)
- [ ] Run OAuth flow (see `CREDENTIALS.md`), paste token into `.env`
- [ ] The daily task auto-publishes from that day on — no more clicks

### After 2 weeks of Reddit karma-building
- [ ] Enable Bestly mentions in Comment Scout drafts (~1 in 3 replies)
- [ ] Enable Tue/Fri "own post" drafts in r/selfhosted or r/homelab

### Ongoing
- [ ] Check the Sun 5pm growth-loop digest — read for interest, no action needed unless something's off
- [ ] Once/quarter: rebuild `kit/videos/` via `scripts/render-3d-clips.js` after marketing hero updates

---

## 9. Emergency runbook

- **Post went live with a live-link to cloud.bestly.tech and cloud is down**: pull the post via LinkedIn admin, re-stage without the live link.
- **LinkedIn token expired**: `linkedin-token-refresh` task should notify a week before. If missed, re-run OAuth flow (5 min).
- **Reddit account gets flagged/shadowbanned**: STOP posting immediately, investigate why (usually: too many links, too fast, or too many Bestly mentions). Message mods of the sub for reinstatement. If unrecoverable, create new account and rebuild karma — do NOT rush.
- **cloud.bestly.tech goes 5xx during business hours**: engine auto-holds new promo posts. Fix the Pi (see mempalace `bestly-llc/infrastructure`). Post a "Behind the box" theme post noting the outage transparently once resolved (turns it into content).

---

## 10. Files & code index

- `social/config/PRODUCT.md` — pricing, voice, don't-claim list
- `social/config/TARGETING.md` — 8 themes, subs, hashtags, format
- `social/config/SAFETY.md` — non-negotiables
- `social/config/CREDENTIALS.md` — LinkedIn + Reddit setup walkthroughs
- `social/config/content-engine.md` — daily engine run order
- `social/config/comment-scout.md` — draft-only reply flow
- `social/kit/thumbnails/hero.png` — the "Stop renting your business from big tech" OG image (v1 hero)
- `social/kit/thumbnails/device-shots/` — 3 device renders for post variety
- `social/kit/staging/YYYY-MM-DD/` — pre-queued or auto-generated daily posts
- `social/kit/staging/_posted/` — archive of what actually went out
- `social/kit/post_history.jsonl` — one JSON line per attempt (feeds growth loop)
- `social/kit/theme_history.jsonl` — theme picks (prevents repetition)
- `social/kit/hook_history.jsonl` — first-line history (prevents copy-paste flag)
- `social/kit/learnings.md` — written weekly by growth loop, read daily by engine
- `social/comment-scout/YYYY-MM-DD.md` — daily reply drafts
- `social/comment-scout/_posted.jsonl` — owner-marked log of what got posted
- `social/secrets/.env` — tokens (git-ignored)
- `social/scripts/render-3d-clips.js` — v4 video kit builder (TODO)
- Scheduled tasks:
  - `bestly-cloud-daily-post` (cron 0 8 * * *) — Content Engine
  - `bestly-cloud-comment-scout` (cron 15 12 * * *) — Comment Scout
  - `bestly-cloud-growth-loop` (cron 0 17 * * 0) — v3 self-improvement, Sun 5pm
  - `linkedin-token-refresh` (TODO, Phase 2) — bi-monthly token renew

---

*Ship every day. Learn every week. Buy your own software.*
