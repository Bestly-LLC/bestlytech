# Demo Cloud — Cascade Atelier

**Goal:** Stand up a second Nextcloud instance on the existing Bestly Pi (or
Mac mini), populated with realistic-feeling content for a fictitious creative
studio called **Cascade Atelier**, so prospects can poke around a real Bestly
Cloud deployment without ever seeing operator data.

**Demo URL target:** `demo.bestly.tech` (alternative: `demo.cloud.bestly.tech`)
**Time to ship:** ~5 hours of one-time work, mostly automatable.

---

## The Demo Tenant — Cascade Atelier

| Field | Value |
|---|---|
| Company | Cascade Atelier |
| Type | Creative studio — brand identity, web, packaging |
| Size | 12 people |
| Location | Los Angeles, CA |
| Founded | 2019 |
| Tagline | "Quiet brands that age well" |
| Logo | Wordmark in Newsreader, indigo on cream |
| Brand colors | indigo (#4f46e5), cream (#faf7f2), ink (#0a0a0f) |

### Sample staff (Nextcloud user accounts)

| Username | Display name | Role | Quota |
|---|---|---|---|
| alex | Alex Rivera | Studio Director (admin) | 5 GB |
| jordan | Jordan Park | Senior Designer | 5 GB |
| sam | Sam Whitlock | Project Manager | 5 GB |
| taylor | Taylor Kowalski | Brand Strategist | 5 GB |
| demo | Demo Guest | Read-mostly prospect account | 500 MB |

Default password for all: `cascade-2026` (rotated nightly when the snapshot
restores). Demo prospects sign in as `demo / cascade-2026` and see what a real
team's Nextcloud looks like, with limited write permissions so they can try
features without disrupting other prospects' sessions.

### Sample clients (folder structure under /Cascade)

```
/Cascade/
├── 01_Brand_Identity/
│   ├── Cascade_Logo_Final.svg
│   ├── Cascade_Brand_Book_2026.pdf
│   ├── Color_Palette.png
│   └── Typography_Specimens.pdf
├── 02_Active_Projects/
│   ├── Bayshore_Cafe/
│   │   ├── 00_Brief.pdf
│   │   ├── 01_Discovery_Notes.md
│   │   ├── 02_Moodboards/ (12 images)
│   │   ├── 03_Concepts/ (3 PSDs)
│   │   └── 04_Final_Deliverables/
│   ├── Lumen_Skincare/
│   │   └── (similar structure)
│   └── Driftwood_Hotel/
│       └── (similar structure)
├── 03_Photo_Library/
│   ├── Stock_2026/ (50 royalty-free photos)
│   └── Studio_Shoots/ (work-in-progress shots)
├── 04_Templates/
│   ├── Proposal_Template.pages
│   ├── Invoice_Template.numbers
│   ├── Email_Signature_Block.html
│   └── Project_Kickoff_Checklist.md
└── 05_Internal/
    ├── Team_Handbook.pdf
    ├── Holiday_Calendar_2026.ics
    ├── Vendor_Contacts.csv
    └── Studio_Recipes_Coffee_Bar.md
```

### Other Nextcloud apps pre-populated

| App | Demo content |
|---|---|
| Calendar | 2026 holiday cal · weekly studio sync (Mondays 10am) · client deadlines (Bayshore launch May 15, Lumen pitch May 22) · Alex's PTO |
| Contacts | 18 contacts: 6 clients, 8 vendors (printers, photographers, photographers' agents), 4 freelancers |
| Talk | 3 channels: #general, #bayshore-cafe, #studio-coffee (jokes/photos). ~40 sample messages with timestamps spread across last 14 days |
| Deck | "Q2 Studio Goals" board with 3 lists: Backlog / Doing / Done. ~12 cards. |
| Notes | Studio-wide shared note "Client Pitch Playbook" + per-user private notes |
| Photos | 50 photos in a "Studio Life 2026" album, geotagged in LA |
| Forms | "New Project Intake" form — pre-filled with 3 fake submissions to show the response view |

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │  Cloudflare DNS                 │
                    │  demo.bestly.tech               │
                    │  ↓ (CNAME, proxied)             │
                    │  bestly-tunnel.cfargotunnel.com │
                    └─────────────────────────────────┘
                                    ↓
                    ┌─────────────────────────────────┐
                    │  Cloudflare Tunnel              │
                    │  (existing 'bestly-nextcloud')  │
                    │  Adds hostname route:           │
                    │  demo.bestly.tech →             │
                    │  http://localhost:8081          │
                    └─────────────────────────────────┘
                                    ↓
                    ┌─────────────────────────────────┐
                    │  Raspberry Pi (or Mac mini)     │
                    │  Docker Compose stack           │
                    │                                 │
                    │  ┌──────────────────────────┐  │
                    │  │ nextcloud-demo (port     │  │
                    │  │ 8081 internal)           │  │
                    │  ├──────────────────────────┤  │
                    │  │ mariadb-demo             │  │
                    │  │ (separate from prod DB)  │  │
                    │  ├──────────────────────────┤  │
                    │  │ redis-demo               │  │
                    │  │ (separate cache)         │  │
                    │  ├──────────────────────────┤  │
                    │  │ /srv/nextcloud-demo/     │  │
                    │  │   ├── data/  (FS)        │  │
                    │  │   └── config/            │  │
                    │  └──────────────────────────┘  │
                    └─────────────────────────────────┘
                                    ↓
                    ┌─────────────────────────────────┐
                    │  Golden snapshot (off-tree)     │
                    │  /srv/nextcloud-demo-fixture/   │
                    │  ├── data.tar.gz                │
                    │  ├── db.sql.gz                  │
                    │  └── config.json                │
                    │                                 │
                    │  Restored nightly at 3 AM PT    │
                    │  by reset-demo-cloud.sh         │
                    └─────────────────────────────────┘
```

**Resource cost on the Pi:**
- Idle: ~700 MB RAM, <1% CPU
- Active demo session: ~1.5 GB RAM, ~5% CPU
- Storage: ~500 MB for sample content + 200 MB for golden snapshot

If the prod cloud is on a Pi 4 with 4 GB RAM, this is workable but tight (no
headroom for two prospects browsing simultaneously). Pi 5 8 GB or the Mac mini
is comfortable. Recommend the Mac mini if it's free.

---

## Phased build plan

### P0 — DNS + Tunnel (10 min, you drive)
1. **Cloudflare DNS** (https://dash.cloudflare.com/.../bestly.tech/dns/records)
   - Add CNAME: `demo` → `bestly-tunnel.cfargotunnel.com`
     (use your existing tunnel ID — same as the `cloud` row)
   - Proxy: ON (orange cloud)
2. **Cloudflare Tunnel hostname** (Zero Trust → Networks → Tunnels → bestly-nextcloud → Public Hostname → Add)
   - Subdomain: `demo`
   - Domain: `bestly.tech`
   - Service: `http://localhost:8081`
   - HTTP Settings → No TLS verify (Nextcloud terminates TLS at the tunnel)

### P1 — Container infrastructure (45 min, scriptable)
File: `~/setup-demo-cloud.sh` on the Pi.
1. Install Docker + Compose if not present (`curl -fsSL https://get.docker.com | sh`)
2. Create `/srv/nextcloud-demo/` with subdirs: `data`, `config`, `db`, `redis`, `apps`
3. Write `docker-compose.yml`:
   ```yaml
   services:
     db:
       image: mariadb:11
       container_name: nextcloud-demo-db
       restart: unless-stopped
       environment:
         MARIADB_ROOT_PASSWORD: <random-32-char>
         MARIADB_DATABASE: nextcloud
         MARIADB_USER: nextcloud
         MARIADB_PASSWORD: <random-32-char>
       volumes:
         - /srv/nextcloud-demo/db:/var/lib/mysql
     redis:
       image: redis:7-alpine
       container_name: nextcloud-demo-redis
       restart: unless-stopped
       volumes:
         - /srv/nextcloud-demo/redis:/data
     app:
       image: nextcloud:30-apache
       container_name: nextcloud-demo
       restart: unless-stopped
       depends_on: [db, redis]
       ports: ["127.0.0.1:8081:80"]
       environment:
         MYSQL_HOST: db
         MYSQL_DATABASE: nextcloud
         MYSQL_USER: nextcloud
         MYSQL_PASSWORD: <same-as-above>
         REDIS_HOST: redis
         NEXTCLOUD_TRUSTED_DOMAINS: demo.bestly.tech
         OVERWRITEHOST: demo.bestly.tech
         OVERWRITEPROTOCOL: https
         NEXTCLOUD_ADMIN_USER: admin
         NEXTCLOUD_ADMIN_PASSWORD: <random-stored-in-1Password>
       volumes:
         - /srv/nextcloud-demo/data:/var/www/html/data
         - /srv/nextcloud-demo/config:/var/www/html/config
         - /srv/nextcloud-demo/apps:/var/www/html/custom_apps
   ```
4. `docker compose up -d`
5. Verify `curl -I http://localhost:8081` returns 200 within ~30 sec
6. Verify `curl -I https://demo.bestly.tech` returns 200

### P2 — Initial Nextcloud configuration (30 min)
1. Open `https://demo.bestly.tech`, complete first-run wizard with admin creds
2. Apps to install:
   - **Built-in:** Calendar, Contacts, Talk, Deck, Notes, Forms (already in Nextcloud Hub)
   - **From store:** Photos (gallery), Memories (timeline view)
3. Settings → Theming → Bestly branding:
   - Name: `Cascade Atelier`
   - Slogan: `Quiet brands that age well`
   - Color: `#4f46e5` (indigo)
   - Logo: upload Cascade wordmark (generated, see P3.0)
   - Background: muted indigo gradient
4. Settings → Security → disable signup, disable password reset for prospects
5. Settings → Notifications → disable email (don't want demo to send mail)

### P3 — Seed Cascade Atelier content (1.5 hours)
Mostly scriptable. Create `seed-cascade-content.sh`.

#### P3.0 — Generate brand assets (15 min, can be AI-generated)
- `Cascade_Logo_Final.svg` — Newsreader wordmark, ~2 KB SVG
- `Cascade_Brand_Book_2026.pdf` — 8-page PDF with mission, voice, color, type
- `Color_Palette.png` — square swatches export
- `Typography_Specimens.pdf` — Newsreader + Inter samples

#### P3.1 — Create user accounts (5 min)
```bash
docker exec -u 33 nextcloud-demo php /var/www/html/occ user:add \
  --display-name="Alex Rivera" --group="admin" --password-from-env alex
docker exec -u 33 nextcloud-demo php /var/www/html/occ user:add \
  --display-name="Jordan Park" --group="design" --password-from-env jordan
# ... etc for sam, taylor, demo
```

#### P3.2 — Create folder structure + populate files (30 min)
- Use `occ files_external:create` for the shared `/Cascade` group folder
- Upload sample files via `occ files:scan` after dropping them on disk
- Sources for placeholder content:
  - **Photos:** Unsplash (CC0) — pull 50 with theme "creative studio LA"
  - **Mockups:** Generate with AI image (3 brand concepts × 3 clients = 9 PSDs simulated as PNGs)
  - **PDFs:** Use templates from existing /Users/jared/Developer/bestlytech assets (the Bestly brand book repurposed)
  - **Markdown notes:** Write 5-10 sample project briefs

#### P3.3 — Calendar events + Contacts + Talk channels (15 min)
Scripted via Nextcloud's CalDAV/CardDAV API:
- Generate `cascade-calendar.ics` with 30 events spanning the year
- Generate `cascade-contacts.vcf` with 18 vCards
- Use Talk's REST API to create channels + post messages

#### P3.4 — Deck board (10 min)
Use Deck's REST API to create:
- 1 board: "Q2 Studio Goals"
- 3 stacks: Backlog, Doing, Done
- 12 cards with realistic descriptions, due dates, assignees, labels

#### P3.5 — Disable signup + lock down demo user (10 min)
- `occ user:setting demo files quota 500MB`
- Apply group "demo" with read-mostly permission profile
- Add a banner via Theming → Custom Notice:
  *"Demo environment — data resets nightly at 3 AM Pacific."*

### P4 — Golden snapshot + nightly reset (30 min, scripted)

File: `/usr/local/bin/snapshot-demo-cloud.sh` — run once after P3 to capture golden state:
```bash
#!/bin/bash
set -e
docker compose -f /srv/nextcloud-demo/docker-compose.yml stop app
sleep 5
mkdir -p /srv/nextcloud-demo-fixture
tar -czf /srv/nextcloud-demo-fixture/data.tar.gz -C /srv/nextcloud-demo data
docker compose -f /srv/nextcloud-demo/docker-compose.yml exec -T db \
  mysqldump -u root -p$DB_ROOT_PW nextcloud | gzip > /srv/nextcloud-demo-fixture/db.sql.gz
docker compose -f /srv/nextcloud-demo/docker-compose.yml start app
echo "Snapshot saved to /srv/nextcloud-demo-fixture/"
```

File: `/usr/local/bin/reset-demo-cloud.sh` — runs nightly at 3 AM:
```bash
#!/bin/bash
set -e
echo "[reset-demo-cloud] starting at $(date -u)"
docker compose -f /srv/nextcloud-demo/docker-compose.yml stop app
docker compose -f /srv/nextcloud-demo/docker-compose.yml exec -T db \
  mysql -u root -p$DB_ROOT_PW -e "DROP DATABASE nextcloud; CREATE DATABASE nextcloud;"
gunzip -c /srv/nextcloud-demo-fixture/db.sql.gz | \
  docker compose -f /srv/nextcloud-demo/docker-compose.yml exec -T db mysql -u root -p$DB_ROOT_PW nextcloud
rm -rf /srv/nextcloud-demo/data/*
tar -xzf /srv/nextcloud-demo-fixture/data.tar.gz -C /srv/nextcloud-demo --strip-components=1 data
docker compose -f /srv/nextcloud-demo/docker-compose.yml start app
echo "[reset-demo-cloud] complete at $(date -u)"
```

Cron: `0 10 * * * /usr/local/bin/reset-demo-cloud.sh >> /var/log/demo-reset.log 2>&1`
(10:00 UTC = 3:00 AM PDT / 2:00 AM PST)

### P5 — Per-prospect access mechanism (60 min — pick one)

| Option | Effort | UX | Recommended? |
|---|---|---|---|
| **A. Shared `demo / cascade-2026` login** | 0 (already there) | Anyone with the URL gets in. All prospects see each other's traces until 3 AM reset. | **Yes for v1** — ship this, upgrade later. |
| B. One-time access pass via /admin/demo-passes | ~4 hours frontend + RPC | Operator generates a 7-day scoped account on demand, sends prospect a unique URL | Phase 2 if v1 traffic justifies. |
| C. Apple SSO with Demo role | ~1 day | Prospect signs in with their own Apple ID, gets a sandboxed session | Phase 3 only if prospect-led trials become a real channel. |

For v1, simply add the credentials to the `/cloud` landing page on bestly.tech:
> **Try it now:** demo.bestly.tech — log in with `demo / cascade-2026`

### P6 — Polish + monitoring (30 min)
1. Add `demo.bestly.tech` to the existing `external_health` table so it shows
   on the operator status page and admin dashboard:
   ```sql
   INSERT INTO external_health (service, url, status)
   VALUES ('demo.bestly.tech', 'https://demo.bestly.tech/login', 'unknown');
   ```
2. Add a "Try the Demo" button on the `/cloud` landing page
   (`src/pages/InHouseCloud.tsx`) — links to demo.bestly.tech with the
   credentials shown.
3. Update `docs/agent-runbook.pdf` to add a "Demo cloud" section.
4. Add a MemPalace drawer documenting the architecture for future agents.

### P7 — Optional: Bestly co-branding (30 min)
- Footer of every demo Nextcloud page: "Powered by Bestly Cloud — bestly.tech/cloud"
- A pinned "Welcome" file in `/Cascade/` README explaining this is a demo
- Loading splash with Bestly + Cascade logos side-by-side

---

## Total budget

| Phase | Time | Where |
|---|---|---|
| P0 DNS/Tunnel | 10 min | Cloudflare dashboard (you click) |
| P1 Containers | 45 min | Pi shell (script handles most) |
| P2 NC config | 30 min | demo.bestly.tech web UI |
| P3 Seed content | 1.5 hr | mostly scripted, some manual asset gen |
| P4 Snapshot/reset | 30 min | shell scripts + cron |
| P5 Access (v1) | 0 | uses default password |
| P6 Polish | 30 min | repo edits + DB row |
| P7 Co-branding | 30 min | NC theming + content |
| **Total** | **~4.5 hr** | |

---

## How I want to drive this

I have three execution paths, ranked by friction:

1. **You SSH me into the Pi** (lowest friction, most control)
   - You give me a way to run shell commands on the Pi (a tmux session you've SSH'd into and granted me, or temporary key-based access)
   - I drive every step, you watch the output
   - Total wall time: ~2 hours including my pauses for your approval at key checkpoints

2. **I write a complete `setup-demo-cloud.sh` you run once on the Pi**
   - I produce a self-contained script + the seed-content tarball + the docker-compose.yml
   - You SCP it to the Pi, run it once, monitor output
   - I write a follow-up script for the seeding, plus the snapshot/reset scripts
   - Total wall time: ~30 min of your active attention, ~30 min for the Pi to chug

3. **You drive, I instruct step-by-step**
   - I post each command in chat
   - You paste, run, share output
   - Total wall time: ~3 hours

**My recommendation: Option 2.** I write the scripts, you run them locally, and we iterate if anything breaks. Lowest risk (you can read everything before executing), highest leverage of my time, no SSH key trust needed.

---

## Open questions before I start writing scripts

1. **Pi hardware:** Pi 4 (4 GB or 8 GB?), Pi 5, or Mac mini? Affects the Compose
   resource limits and whether to enable Nextcloud's preview generation.
2. **Subdomain:** `demo.bestly.tech` (preferred — cleaner) or
   `demo.cloud.bestly.tech` (matches existing `cloud` namespace)?
3. **Branding:** Cascade Atelier-only (best demo authenticity) or
   "Cascade Atelier — a Bestly Cloud demo" (clearer it's our product)?
4. **Auto-reset cadence:** nightly at 3 AM (recommended) vs every 6 hours
   (more demo isolation, more downtime) vs only on-demand?
5. **Sample-content licensing:** all CC0/Unsplash/AI-generated, or OK with
   me reusing your existing Bestly brand book PDF as the "Cascade Brand Book"
   placeholder? (Cleaner if we generate fresh — but slower.)

Answer those four and I'll generate the full `setup-demo-cloud.sh` +
`seed-cascade-content.sh` package. Or just say "go with your defaults" and
I'll pick: Pi 5 8GB / `demo.bestly.tech` / Cascade Atelier-only branding /
nightly 3 AM reset / fresh AI-generated content.
