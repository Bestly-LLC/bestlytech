# Turo Reviews, All-Star Coach + Maintenance Manager — Opus plan

Written 2026-10-06 (Opus). Execute with Sonnet. Repo: Bestly-LLC/bestlytech (commit this file as docs/turo-reviews-maintenance-opusplan.md). Supabase: rcqfqhguwpmaarseifqg.

## TL;DR
- **Two new AI employees** under Turo Reader (Fleet Manager):
  - **Stella — Reputation Manager**: reads Turo reviews daily, replies, keeps All-Star.
  - **Mae — Fleet Maintenance Manager**: tires, wipers, guest maintenance flags, Costco auto-booking.
- **Admin**: two new tabs inside Turo Watch: **Reviews** and **Maintenance**.
- **Cost**: runs on the Pi / Mac mini with free AI. Claude only for building.

## What we found (2026-10-06)
- Turo emails only say "X rated their trip". No stars, no text. **Source of truth = turo.com/us/en/business/reviews** (Jared's Chrome is signed in). Also /business/performance.
- Last 365 days: 4.99 avg, 83% five-star incl. unrated, 69 ratings / 82 trips, 16% unrated.
- Categories: Cleanliness 78%, Maintenance / Accuracy / Communication / Convenience 82%.
- Guest flags: Brakes (1), Maintenance Other (2), Car location (1). 1 host cancel (Jun 10, 2026).
- Old reviewer stopped after Jul 21, 2026. **Unanswered written reviews: GianPaula (Sep 27), Brody (Aug 20)**.
- Only reviews with written text get a "Leave a public response" button.
- No reviews table exists yet. turo_trips has guest, pickup type (airport_code), dates, reservation_id.

## Jared's decisions
| Topic | Decision |
|---|---|
| 5-star replies | **Auto-post.** Shows in the evening recap. |
| Under 5 stars | **Alert first.** Push signed by Stella opens a Turo Watch card: review, trip messages, notes box, Redraft, Approve & post. Nothing posts without his tap. |
| Reply style | **2-3 lines, trip details** (pickup type, trip length, what they praised). Ends "Hope to host you again soon!" No emoji. |
| Access | Turo review emails = trigger; daily read of the ratings page in Chrome; post replies in Chrome. |
| Backlog | Draft GianPaula + Brody, Jared approves both. Brody mentions the FSD lockout from a prior guest; reply must stay gracious, no blame. |
| All-Star coach | Track + warn before slipping; never-host-cancel guard; **draft** a post-trip "please leave a review" message (Jared adds it himself as a Turo scheduled message, no sending by bot). |
| Rating guests | Jared does it. Stella watches the deadline (in the "X just rated their trip" email: "You only have until …"). **1 day before** it drafts a guest review for him. **Skip if a Claims Closer case is open** on that trip. |
| Cleanliness checklist | Not wanted. |
| Tread | **Both**: miles since tires went on + a tread photo at Jared's check-in. |
| Maintenance action | **Recommend only.** Exception: **if the vendor is Costco, Mae auto-books online** in a slot that doesn't touch a trip. |
| Guest maintenance flags | Owned by Mae (default; Jared had no preference). |

## Tire facts (from Jared)
- Car: 2020 Model 3 "Blue Steel", VIN 5YJ3E1EAXLF658422, RWD per Jared.
- 12/11/2024 Costco: 2x Michelin Primacy MXM4 all-season, put on the **rear**.
- 2/11/2026 Costco: 2x Michelin Primacy MXM4. The 12/11/24 pair moved **rear → front**; new pair on rear.
- So **front = 12/11/24 tires (~22 months, front tread getting low)**, rear = 2/11/26 tires.
- To find: odometer on both Costco receipts (Gmail jareds.mac@gmail.com / iCloud forwards / Nextcloud). Use them as the mileage baseline.

---

## Build

### 1. Data (one migration)
- `turo_reviews`: reservation_id, guest_first, vehicle, review_date, stars, category flags (jsonb), text, has_response, response_text, status (`new | auto_posted | needs_jared | approved | posted | skipped | failed`), draft, jared_notes, posted_at, by_agent.
- `turo_host_stats` (daily snapshot): avg, pct_5star, ratings, trips, unrated_pct, category %, flags, host_cancels_365, response rate/time (from /business/performance), all_star (bool + status text).
- `turo_allstar_rules`: current Turo All-Star requirements. **Look them up on Turo's help page during the build — do not guess.** Store with source URL + checked_at.
- `turo_guest_ratings`: reservation_id, deadline, rated (bool), draft, claim_open (bool).
- `fleet_maintenance`: item (front_tires, rear_tires, wipers, cabin_filter, brakes, washer_fluid, …), installed_on, installed_miles, vendor, receipt_ref, last_check, est_remaining (%, mi), due_by, status, notes.
- `fleet_maint_events`: tread photos (32nds of an inch read by AI), TPMS readings (psi), guest flags, recommendations, bookings.
- RLS admin-only. RPCs follow existing patterns (admin_*, service_role for Pi jobs).

### 2. Stella — Reputation Manager (Pi/Mac mini, free AI)
- **Trigger**: Turo "rated their trip" email (Turo Reader already reads Turo mail into turo_inbox) + one daily pass at ~10 AM PT.
- **Read**: Chrome on the Mac mini via the existing mac_job queue, or the Pi Playwright runner at /opt/bestly/turo-watch if it already holds a working Turo session. Prefer the Pi. Never enter a password; if signed out, Stella tells Jared once.
- **Draft**: free AI ladder (FreeLLM → Groq → Cloudflare; Claude backup only). Prompt includes trip facts from turo_trips (LAX vs home pickup, nights, car) + review text. Style = option A.
  - Reference example (approved style): *"Thanks so much, GianPaula! Glad the late-night LAX pickup and your week with the Model 3 went smoothly. Fast replies are a big deal to me, so that means a lot. Hope to host you again soon!"*
- **Post**: 5-star → post in Chrome automatically. Under 5 or any mention of damage/smoke/FSD/claim → `needs_jared`, push + Needs you.
- **All-Star coach** (daily, no AI unless drafting): compare turo_host_stats to turo_allstar_rules; warn **before** a threshold is at risk with the math ("2 more 5-stars keeps you safe"). Never-host-cancel guard: watch Mae's appointments + Jared's calendar against booked trips; flag any clash days ahead.
- **Review-ask**: one-time deliverable — draft two short post-trip Turo scheduled messages (LAX + home pickup) for Jared to paste. Plain, warm, no pressure, no incentive.
- **Guest ratings**: parse deadline from the email; 24 hrs before, draft a guest review if not rated and no open claim (check Claims Closer cases).

### 3. Mae — Fleet Maintenance Manager (Pi, free)
- **Inputs**: Tesla vehicle data already flowing (turo_vehicle_state / tesla-fleet: odometer, TPMS psi, wiper/washer if exposed), turo_trips calendar, tread photos, guest flags from Stella.
- **Tires**: tread estimate = baseline from receipts + miles driven; corrected by tread photos (AI reads penny/gauge, 32nds). Thresholds: warn at 4/32", replace by 3/32" (US). TPMS: flag slow leaks (same tire dropping over days).
- **Wipers / cabin filter / washer fluid**: age + season (rain season in LA) reminders.
- **Guest flags**: every "Brakes"/"Other" flag → check car data, say "real or one-off", add to Maintenance tab.
- **Recommend between trips**: only push when there's a gap long enough to act; say exactly what, where, how long, cost range.
- **Costco auto-book**: if the fix is tires and Costco is the pick, book online in the first slot that clears the next trip by 24+ hrs. Only if Chrome is already signed in to Costco; else send Jared the one booking link. Calendar event + Claims-Closer-style reminder before.
- **Tread photo ask**: one line on the trip check-in flow ("Snap the front tread with a penny") — no extra taps beyond the photo.

### 4. Admin — Turo Watch tabs (Apple HIG skill + UI UX Pro Max)
- **Reviews**: All-Star status chip + the numbers above; at-risk banner when Stella warns; queue cards (under-5 first) with review, trip messages, notes box, Redraft, Approve & post; posted log; guest-rating deadlines.
- **Maintenance**: tire card per axle (age, est tread in 32nds, psi, due date), items list, guest flags, next recommendation, Costco booking status.
- Mobile-first. Rules: 12-hour times, US units, number never splits from its unit, no "…" truncation.

### 5. Team + watchdogs
- Add both to the Team page via `team_onboard` (card, title, pulse, tools, owned alert prefixes `stella`, `mae`, welcome). Reports to turo-reader. Stella tools: Review Reader, Reply Writer, All-Star Coach, Guest Rating Watch. Mae tools: Tire Tracker, Flag Checker, Costco Booker.
- Every job reports via `pi_job_report`; set `pi_jobs.max_gap_min`. Scout watchdog + auto-recovery.
- Notifications signed by Stella / Mae. Interrupt only for: under-5 review, All-Star at risk, maintenance due with a bookable gap, guest-rating draft ready. Everything else → evening recap.

### 6. Order of work
1. Migration + seed tire facts.
2. Stella reader → backfill all 69 reviews; draft GianPaula + Brody → **stop for Jared's approval**.
3. Stella replies/coach/guest-rating watch on the Pi.
4. Mae + Tesla data + Costco booker (dry-run only until Jared sees the first one).
5. Admin tabs. Type-check, build, phone check.
6. Team cards, watchdogs, bestly_memory notes, commit + push to main.

### Never
- Post an under-5 reply, a backlog reply, or any guest review without Jared's tap.
- Enter passwords, offer guests incentives for reviews, or link reviews to claims.
- Book anything that isn't Costco tires. Book over a trip.
