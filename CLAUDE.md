# CLAUDE.md

Orientation for any Claude / agent picking up work on this repo.

## What this is

Bestly LLC's primary public site (`bestly.tech`) plus the operator admin dashboard at `/admin`. Marketing pages, product pages (Cookie Yeti, In-House Cloud, etc.), and the entire B2B customer-intake funnel for selling private clouds.

**Stack:** Vite + React + TypeScript + Tailwind + shadcn/ui + react-router + Supabase. Hosted on Vercel from `main` (auto-deploys on push). Supabase project ref: `rcqfqhguwpmaarseifqg` (managed via this repo's `supabase/migrations/` and `supabase/functions/`).

**Sister system:** `cloud.bestly.tech` — the Bestly LLC Nextcloud instance, used as the actual project tracker (Deck), forms (Forms), file storage (Files), and eventually e-sign (Libresign) and team password vault (Vaultwarden). Bestly *eats its own dogfood*: the customer signing the SOW is using the exact stack they're buying. See `docs/storage-policy.md`.

## Repo map

```
src/
  pages/
    Index.tsx              # homepage
    InHouseCloud.tsx       # the In-House Cloud product page
    GetStarted.tsx         # cloud-intake Stage 1 — public lead form
    Brief.tsx              # cloud-intake Stage 2 — pre-call brief at /brief/:token
    Intake.tsx             # cloud-intake Stage 5 — technical intake at /intake/:token
                           #   includes CustomerStatusView (post-submit live status)
    ShieldReport.tsx       # public form at /shield/report for URL allowlist requests
    admin/
      AdminDashboard.tsx       # /admin landing
      CloudDeals.tsx           # /admin/cloud — Kanban pipeline of all cloud deals
      CloudDealDetail.tsx      # /admin/cloud/:id — full deal page (huge file)
      CloudDiscoveryBrief.tsx  # printable Discovery Brief PDF generator
      AdminShieldReports.tsx   # operator review queue for shield_url_reports
      ...                      # plus existing Cookie Yeti / Hire / etc admin pages
  components/admin/
    AdminLayout.tsx        # admin shell + sidebar
    AdminSidebar.tsx       # nav with count badges (cloud leads, shield reports, etc.)
  config/products.ts       # marketing config — every product card on /products
  integrations/supabase/
    client.ts              # browser Supabase client
    types.ts               # generated types — regenerate after every migration

supabase/
  migrations/              # one file per migration, applied in numeric order
  functions/               # edge functions — each in its own folder
    submit-cloud-lead/     # Stage 1 lead capture + ntfy push + customer email
    cloud-brief/           # Stage 2 token-bound GET/PATCH/POST
    cloud-deal-payment-link/ # admin-gated Stripe payment link generator
    cloud-intake/          # Stage 5 token-bound GET/PATCH/POST + customer status data
    cloud-brand-upload/    # Stage 5b multipart upload to Supabase Storage
    shield-report-url/     # /shield/report submissions
    stripe-webhook/        # checkout.session.completed → cloud_deals auto-advance + email
    send-transactional-email/ # template registry + queueing (handles cloud + CY both)
    _shared/transactional-email-templates/
                           # React Email templates registered in registry.ts
                           # cloud-* templates added to the existing Cookie Yeti set
    ... (lots of CY-era functions also)

docs/
  customer-intake-opusplan.md       # the master plan for the cloud funnel
  parentiq/schoolpilot/hoascope-feature-inventory.md
  onboarding-audit-2026-05.md       # gap audit of the three product stories
  storage-policy.md                 # canonical: Nextcloud Files for everything new
  blackhole-minutes-setup.md        # runbook for the BlackHole audio loopback
  ...
```

## The cloud-intake funnel (most-recent major system)

Eight-stage pipeline for selling Bestly In-House Cloud deployments. Schema in `supabase/migrations/20260504210000_cloud_intake_schema.sql` and friends.

| Stage | What happens | Where lives | Auto-advance |
|---|---|---|---|
| 1 Lead | Public form `/get-started` → `submit-cloud-lead` edge fn → `cloud_leads` row + `cloud_briefs` shell + lead-received email + ntfy | `GetStarted.tsx`, `submit-cloud-lead/` | manual |
| 2 Brief | Token-bound page `/brief/:token` → `cloud-brief` edge fn (auto-save) → brief-submitted email + ntfy on submit | `Brief.tsx`, `cloud-brief/` | manual |
| 3 Discovery | Operator runs the call. Generates Discovery Brief PDF from `/admin/cloud/:id/brief-pdf` | `CloudDiscoveryBrief.tsx` | manual |
| 4 SOW + Stripe | Operator generates Stripe payment link from deal detail. DocuSign envelope ID pasted (will become Libresign). | dialogs in `CloudDealDetail.tsx`, `cloud-deal-payment-link/` | Stripe webhook auto-advances on `checkout.session.completed` if `metadata.deal_id` is set |
| 5 Tech intake | Operator generates intake link, IT lead fills 5-stage portal at `/intake/:token` | `Intake.tsx`, `cloud-intake/` | manual after submit |
| 6 Provisioning | 8-step checklist on deal detail (`ProvisioningChecklist`). All-checked → "Ship it →" | `CloudDealDetail.tsx` ProvisioningChecklist | manual gate |
| 7 Install | Shipping carrier/tracking, install schedule, acceptance envelope (`InstallTracker`). Acceptance signed → "Mark live →" | `CloudDealDetail.tsx` InstallTracker | manual gate |
| 8 Live | 30-day check-in + quarterly + Y1/Y2/Y3 renewal milestones (`LiveOpsPanel`). Churn risk + health notes. | `CloudDealDetail.tsx` LiveOpsPanel | terminal |

The customer sees a **live status page** at the same `/intake/:token` URL after submit (`CustomerStatusView` component) showing build progress, shipping ETA, install date, and the "you're live" celebration once at Stage 8. Auto-refreshes every 60s.

**Customer-facing emails** (templates in `supabase/functions/_shared/transactional-email-templates/cloud-*.tsx`): cloud-lead-received, cloud-brief-submitted, cloud-deposit-paid, cloud-intake-received. Bestly brand voice (dark `#0a0a0a` header, accent `#c84d2b`).

## The Shield reporter

Two parallel surfaces: public form at `/shield/report` (anyone can submit URLs they think are wrongly blocked) and per-deal token URLs `/shield/request/<token>` for client deployments. Tables: `shield_url_reports` (global, anon insert) and `cloud_shield_requests` (deal-scoped). Operator queue at `/admin/shield-reports`.

## Conventions

- **Auth.** Admin routes guarded by `<AdminRoute>`. Edge functions either `verify_jwt = false` (public submission endpoints with own auth check via tokens) or `verify_jwt = true` (require Supabase JWT — operator actions like generating Stripe links).
- **Token-bound flows.** Public endpoints that read/write deal-specific data require a long random token (48-char hex via `crypto.getRandomValues` or `gen_random_bytes(24)`). Tokens live on the row itself (`cloud_briefs.access_token`, `cloud_deals.intake_token`, `cloud_deals.shield_request_token`). Edge functions look up the row by token; no JWT needed.
- **Schema state via jsonb.** Long-lived per-stage state (intake_data, provisioning_data, install_data, live_data) lives as jsonb columns on `cloud_deals` so the schema can evolve without migrations. Each stage's data is one subdoc; `cloud-intake` edge fn replaces the whole subdoc on every PATCH (idempotent).
- **ntfy push notifications** for every operator-side event: new lead, brief submitted, intake submitted, deposit paid, shield report received. Topic: `bestly-sysalert-7q2k9mx4`. ASCII headers only (em-dashes break ntfy's HTTP header validation — strip them in `asciiHeader()`).
- **Idempotency.** Email sends use idempotency keys (`<event>-<id>` pattern) so Stripe retries don't double-send. The email queue table dedupes by key.
- **TypeScript.** Run `npx tsc --noEmit -p tsconfig.app.json` to type-check. Two pre-existing errors in `WowButton.tsx` to ignore.
- **Supabase types.** Regenerate after every migration: MCP `generate_typescript_types`, write to `src/integrations/supabase/types.ts`.

## Deploy

`./publish-cloud-intake-day1.command` from the repo root — stages every cloud-intake-related file (schema, edge functions, frontend, docs), runs `npm run build` as a sanity check, commits with a structured message, pushes to `main`. Vercel auto-rebuilds.

Edge functions deploy via the Supabase MCP `deploy_edge_function` (or via `supabase functions deploy <name>` from the CLI). Migrations apply via `apply_migration`.

## Open and pending

See the TodoList for current state. Major decisions still open:

- **Nextcloud Passwords app install** — Jared needs to one-click install via `cloud.bestly.tech/settings/apps/security` (requires admin password re-confirmation). The .secrets/ plain-text purge is already done; the file at `.secrets/cloudflare-turn-bestly-talk.txt` is now just a pointer to canonical sources. See `docs/storage-policy.md` Credentials & Secrets section.
- ~~**Cal.com → Nextcloud Appointments**~~ — done 2026-05-06. URL is now `https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY`, hard-coded in `GetStarted.tsx`, `submit-cloud-lead/index.ts` (the email-fire), and `cloud-lead-received.tsx` previewData. Each booking auto-creates a Bestly Cloud Talk room — discovery calls run on the actual product.
- **DocuSign → Libresign** — Phase 1+3+5 done 2026-05-06. Schema has `signing_provider` / `signing_request_id` / `signing_document_url`, with deprecated `docusign_envelope_id` kept for one release cycle for backfill. UI dialogs in CloudDealDetail (SOW) and InstallTracker (Acceptance) now reference Libresign on cloud.bestly.tech. **Phase 2** = Libresign install on cloud.bestly.tech (admin password gate) + cloud-deal-sign edge function for programmatic envelope creation. **Phase 4** = webhook handler for auto-stamp on signing complete. See `docs/customer-intake-opusplan.md`.
- **HOAscope rename consistency** — config + Products.tsx done. Asset filename `hoacure-icon.png` left as-is (never user-visible).
- **ParentIQ public surface** — currently no card on `/products`. Either add Coming Soon, build full page, or stay dark. Decision deferred.

## Where the customer-facing artifacts live (after dogfood migration)

| Artifact | Today | After dogfood migration |
|---|---|---|
| Per-deal contracts | DocuSign envelopes | Libresign on cloud.bestly.tech |
| Per-deal brand uploads | Supabase Storage `cloud-brand-assets` | Nextcloud Files `/Bestly/Clouds/<Company>/Branding/` |
| Discovery call booking | Cal.com | Nextcloud Appointments at cloud.bestly.tech |
| Project tracking | nothing-formal-yet | Nextcloud Deck (Bestly Ops, Cloud Deals, Product Roadmap, BDC Universal boards already created) |
| Internal forms | Google Forms / Typeform / nothing | Nextcloud Forms (Post-discovery retro, Candidate scorecard, Contractor onboarding live) |
| Team password vault | plain-text `.secrets/` | Vaultwarden on cloud.bestly.tech |
| Strategy/sales docs | repo Markdown | Nextcloud Office (Collabora) + repo for engineering only |

## A few rules of the road

- **House copy rule.** A sentence that fits on one line is never split across lines; it moves to the next line whole. In React wrap multi-sentence prose in `<Lines>` (`src/components/Lines.tsx`; inside a flex row put it in a `<span>`). Native/Live Activities: one sentence per line.
- **Save tokens; run it local.** If a job can run on the Pi or the Mac mini on its own (script, cron, free AI via FreeLLM), it runs there, not through Claude (claude.ai scheduled tasks, paid AI). Use Claude only when the work truly needs it (code changes, a logged-in Chrome, real judgment). When building or reviewing any bot, pick the Pi or Mac mini first, free AI before paid, and flag any Claude scheduled task that could move. Jared's standing rule (2026-10-04).

- **Every bot gets a team card the day it goes live.** Anything you build that works on its own (a cron, an edge function on a schedule, a Pi job, a phone line, an agent) must be on `/admin/team` before you finish: run `select public.team_onboard('[{...}]'::jsonb)` with a real title, `reports_to`, a `pulse` that names every cron job it owns (`job` / `also`), its tools (`tool_of`), and the alert prefixes it owns (`owns`). Planned open roles that go live are onboarded the same way (same slug). The Recruiter's Roster Scanner pings Jared hourly about schedules nobody owns, so skipping this shows up as a miss. Lesson from 2026-10-04: both Avas worked for a day with no card. See `supabase/migrations/20261004230000_team_onboard_ava_and_roster_scanner.sql`.
- **Only 4 kinds of news reach Jared (autonomy, 2026-10-06).** Security nobody could fix, money, a real person waiting, something down an hour. `notify_route` holds everything else (silent bell + 7 PM recap) and Needs you (`admin_today_rows`) shows only those kinds; see `docs/autonomy-opusplan.md`. Write alerts so the owner can act on them, sign them with the employee, and send good news as `success` so it lands in the recap. To make something interrupt, it must truly be one of the 4 (`interrupt_class()`), not a wording trick. One narrow exception (2026-10-13): `interrupt_class()` returns `requested_now` for the "Ava: tap to approve/undo" push that `ava_approval_push()` sends for a request made on a verified live Ava call (Jared asked for that tap); no other source or title can use it.
- **Public-key RPCs must be on the allowlist.** Ares's Auto-Fixer locks any SECURITY DEFINER function the nightly audit finds callable by `anon` within an hour (undo in `security_autofix_log`). If devices, the Pi/Mac or public pages call your function with the publishable key, add it to `security_public_rpcs` in the same migration.
- **Every new table read by a signed-in page needs an explicit `GRANT … TO authenticated`.** Postgres' default privileges in `public` no longer give new tables to `authenticated` (hardened on purpose), so an RLS policy alone is not enough: the page gets "permission denied" before the policy runs, while every service-role probe stays green. Write `grant select, insert, update, delete on public.<table> to authenticated;` (only the verbs the page needs) in the same migration as the policy, then confirm with `select has_table_privilege('authenticated','public.<table>','select')`. Lesson from 2026-10-29: Tinker's Automation Maker page (`ha_automations`) was dead for 8 days. Ares now flags the gap nightly (`policy_without_grant:<table>` findings, detection only, `ares_policy_without_grant_check()`), and Tinker heals his own two tables (`tinker_page_check()`); neither grants anything else.
- **Cloudflare Workers are on the FREE plan (100,000 requests a day, shared).** Never add an always-on Worker route (no `[[routes]]` in any `wrangler.toml`, nothing in the dashboard): it burns the cap and took bestly.tech and cloud.bestly.tech down with error 1027 on 2026-10-05. Edge Guard (Mac mini, `docs/edge-guard.md`) owns the splash routes: it attaches them only during an outage, keeps them fail-open, and removes strays.
- **A new Live Activity has to be registered in FOUR places in the Pi's `/opt/bestly/wall/server.py`**, or it silently never appears and logs nothing: (1) `LA_TAGS`, (2) the `wants = {...}` dict, (3) the priority tuple that hands out slots (only 2 cards run at once, 1 during an incident), and (4) its own `la_set("<tag>", wants["<tag>"], ...)` call. Lesson from 2026-10-06: the home-charging card was missing #3, then #4, and took three restarts to find because neither omission errors. `server.py` is root-owned, so patch it with `sudo -n python3 -`, `shutil.copy` a `.bak_<name>_<stamp>` first, `py_compile` before writing, then `sudo -n systemctl restart bestly-wall`.
- **Secrets and rates get a UI, not a hand-written SQL call.** Anything Jared has to supply for a bot to work (a login, a rate, a threshold) belongs on the admin page that owns that bot, writing through an admin-guarded RPC — never "go add a Vault secret". Logins go to Supabase Vault via `home_hub_vault_put` (write-only; a page can read the saved-at time, never the value); numbers go to a settings table through a bounded `*_set` RPC. The Charging card on `/admin/turo/settings` (`src/pages/admin/ChargingCard.tsx`, `home_charge_admin` / `home_charge_admin_set`) is the pattern. Lesson from 2026-10-06.
- **Check whether the bot already exists before you build it.** Grep `tools/`, `pi_jobs`, the Pi's crontab and `bestly_agents` first. On 2026-10-06 a second Plug Puller was built on a systemd timer next to the real one, which had been in crontab every minute since the day before, failing for one reason: nobody had saved its ChargePoint token. Two workers racing to stop one charging session is worse than either alone. The duplicate was torn out; see `20261006080000_plug_puller_single_owner_cleanup.sql`. A job that reports `skip: <thing> not connected yet` is asking for data, not for a rewrite.
- **ChargePoint blocks password logins from servers.** A login from the Pi returns 403 with a Datadome captcha; `python-chargepoint` ships a `DatadomeCaptcha` exception for it. Charge Watch therefore signs in with a `coulomb_sess` session token (`ChargePoint.create(email, coulomb_token=...)`), which Jared pastes into the Charging card on `/admin/turo/settings`. That cookie is HttpOnly, so no script can read it out of his browser and nobody should try: harvesting it is credential extraction and gets refused. When the token expires the worker tells him to paste a new one. Lesson from 2026-10-06.
- **A new wall switch has to be added in FOUR places, or taps silently do nothing.** (1) the row + `WallState` type in `src/pages/admin/Wall.tsx`, (2) the allowlist array in `public.wall_clean_toggles` (new migration), (3) the Pi's `/opt/bestly/wall/server.py`: `DEFAULT_STATE` (which feeds `ALLOWED`) plus the bool check in the patch filter, (4) the code in the Pi's `wall.html` that reads `S.<key>`. Then re-save the value once so the Pi picks it up. Lesson from 2026-10-12: the Cars / Car names switches missed #2 and #3 and needed two fixes.
- **Wall sky layers follow home.** Any new layer drawn on the wall's sky (canvas, SVG, labels) must stamp the home/zoom/bearing it drew with and be added to `SKYLAYERS` in the Pi's `wall.html`; Sky Sync (`tools/wall-sky-sync/`) audits it and flags anything unregistered. Lesson from 2026-10-05: roads and traffic didn't move with home.
- **Any new table holding emails or phones gets rows in `privacy_data_map` in the same migration.** Vera (the Privacy Clerk, `/admin/maya`, `docs/privacy-clerk-opusplan.md`) deletes, blanks or keeps data per person only from that map, and flags unmapped columns daily. Action `delete` removes the row, `blank` nulls the personal columns, `keep` is never touched (give the legal reason), `review` waits for Jared's tick. Lesson from 2026-10-11: her first daily check found 16 unmapped columns.
- **New phone agents start from the agent template (`voice_agents`, `agent-hub`, `AgentDesk`); never fork Ava's or Reese's pages.** Use the + in the sidebar Agents group (`/admin/agents/new`): quick bits, free-AI autofill, `agent-hub create` (idempotent, spends nothing, never buys a number). Tailor with the card on the agent page. See `docs/agents.md`. Jared, 2026-10-10.
- **Tinker fixes what is already in Home Assistant (2026-10-29, `docs/ha-fixer-opusplan.md`).** `/admin/home-hub/automations` has Make, My automations and Fix a problem. Apply and Undo need Jared's own signed-in tap (the service role is refused); every write backs up on the Pi and guards on a fingerprint; Tinker never deletes an automation, only turns it off and says so. It needs Home Hub agent 1.6.2 (`homeassistant.inventory|evidence|item_edit|package_patch|package_restore`); the page tells you when the Pi is older and Tinker queues `agent.update` himself. Edge function `ha-fixer` is deployed as a pinned GitHub-raw shim (same as `ha-automator`): push first, then deploy the shim at that commit.
- **Check the branch before you fix this repo.** `~/Developer/bestlytech` is a long-lived shared checkout that can be months of commits behind `main` with other people's uncommitted work in it. On 2026-10-17 it sat 387 commits behind `origin/main` on an abandoned branch, so a fix written there could not deploy. Run `git status` and compare to `origin/main` first; work from a fresh worktree when the task is "fix the live site". Lesson from 2026-10-17.
- **UI work uses the Apple design skill, then UI UX Pro Max.** Any change to how something looks or moves: load `.claude/skills/apple-design` first, build, then do a second pass with `ui-ux-pro-max`. Jared's standing rule (2026-10-06).
- **Light/dark mode.** Site defaults to **light**. The admin dashboard runs **dark** (`admin-shell` wrapper class on `AdminLayout`). Don't accidentally invert.
- **Brand voice.** Bestly is privacy-first, plain-spoken, anti-big-tech. Read the brochure (`In-House Cloud — Brochure.pdf` in `/uploads/`) for the canonical voice. No emoji on customer-facing surfaces. Internal admin can be more relaxed.
- **No new emojis on existing pages** unless explicitly asked.
- **Migrations are append-only.** Never edit a previously-committed migration; write a new one.
- **A migration in this repo proves nothing about the database.** Applied versions and local files have drifted badly: as of 2026-10-17 `supabase migration list --linked` shows 1,375 versions applied with no local file, 408 local files never applied, and 37 that match. `get_cookie_yeti_public_stats()` was committed twice and never applied to the project, so `/cookie-yeti/transparency` served hardcoded May numbers for five months. After applying anything, confirm it landed (`supabase db query --linked "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='<name>'"`) and record the version in `supabase_migrations.schema_migrations` so the next session sees it. Lesson from 2026-10-17; see `docs/site-depth-check.md`.
- **A 200 from bestly.tech proves nothing.** It is a Vite SPA: a working page, a broken page and a URL that does not exist all return 200 and the same 13 KB of `index.html`. Every monitor on the estate was green while `/status` was 500-ing on most loads and the transparency page had never reached its database. So: after any change to the marketing site, run `node scripts/site-audit/crawl.mjs`. When you add a public RPC a page reads with no sign-in, add it to `supabase/functions/site-depth-check/` (and to `security_public_rpcs`, or Ares's Auto-Fixer revokes it). When a page has a fallback, make it say which call failed instead of rendering plausible numbers. Depth Check owns the automated half; see `docs/site-depth-check.md`. Lesson from 2026-10-17.
- **A page can be dead while every probe says 200 — the edge may be lying, not the site.** Vercel tags every `/assets/*` response (its own 404s included) `immutable, max-age=31536000`, so one 404 during a deploy can be cached for a year. `/neckpilot` was dead for real visitors on 2026-10-17 with `curl` reporting 200 for the same URL. The tell is plain vs cache-busted: fetch the file with no query (`cf-cache-status: hit`) and again with `?__eg=1` (`miss`). A plain 404 that the busted request serves is a cached lie, and redeploying cannot fix it — the filename is content-hashed and identical in every build. Edge Guard checks every asset the homepage loads this way every 5 minutes, purges it when the `bestly-cf-cache` Keychain token exists, and alerts either way. See `docs/edge-guard.md`.
- **A static tag in `index.html` is not a fallback, it is a duplicate.** `<head>` there carries the homepage's `canonical`, `og:*` and `twitter:*` so `/` works with no JS. React Helmet only removes tags it owns, and it only owns tags marked `data-rh="true"` — so every route that rendered `SEOHead` ended up with **two** canonicals, the homepage's first. `/about`, `/neckpilot` and the rest told Google they were duplicates of `/` from launch until 2026-10-17. Any new `<title>`/`canonical`/`og:`/`twitter:` tag added to `index.html` must carry `data-rh="true"`, and a page that sets its own head uses `SEOHead` (never a hand-rolled `document.title`). `node scripts/site-audit/crawl.mjs` now fails a route that ships no canonical or the homepage's.
- **React 18 drops props it does not know, silently, in production.** `<img fetchPriority>` (camelCase) is React 19; React 18 warns `does not recognize the prop` in dev and then writes nothing to the DOM, so the hint never shipped. Use `{...{ fetchpriority: "high" }}` for lowercase HTML attributes. Lesson from 2026-10-17: three images had been carrying a dead prop.
- **One Supabase project.** Old Lovable project `keowunrxpxlbgebujbao` is retired — its functions return 410 stubs. New project is `rcqfqhguwpmaarseifqg`.
- **Always commit + push without asking.** When finishing meaningful work on this repo, run `git add` → `git commit` (logical, scoped commits) → `git pull --rebase origin main` → `git push origin main`. Vercel auto-deploys from main. Don't ask Jared for permission first — just do it. If there's a conflict, rebase and proceed.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
