# Bestly Talk — Launch Opusplan

**Author:** Claude (after the 2026-05-20 audit)
**Companion docs:** `docs/talk-launch-audit.md` (findings),
`docs/pi-64bit-migration-runbook.md` (Phase 1 dependency)
**Audience:** Jared + anyone helping push Talk over the launch line.
**Status:** Draft v1. Adjust dates and ownership before kicking off.

---

## 0. North star

Bestly Talk should be the **single most boring, reliable conversation tool a
customer has ever installed.** Two people on the same LAN connect in under a
second. Two people across the country connect in under three. Recordings save
themselves into the room's folder. When something breaks, ntfy buzzes the
operator before the customer notices.

**Definition of "launch-ready":**

1. A non-technical customer can run a full lifecycle (create room → invite →
   call → screen-share → record → close) without operator help.
2. Cross-LAN connect time p95 < 3 seconds, drop rate < 1%, audio MOS ≥ 4.0
   across 10 calls measured during load test.
3. Every component (HPB, coturn, recording, NATS, NC-app, redis, nginx) has an
   Uptime Kuma monitor with ntfy escalation.
4. Recording saves to Files automatically, branded as Bestly, with retention
   policy documented in CUSTOMER_GUIDE.
5. Pi has 50%+ resource headroom under simulated 5-concurrent-call load.

Anything short of all five = not launch.

---

## 1. Success metrics

| Metric                            | Today              | Launch target  |
|-----------------------------------|--------------------|----------------|
| Same-LAN connect time (p95)       | 2s (just fixed)    | < 1s           |
| Cross-LAN connect time (p95)      | 30s+ / fails       | < 3s           |
| Drop rate / 100 calls             | unknown            | < 1            |
| Recording success rate            | 0% (container dead)| ≥ 99%          |
| Time-to-detect a component crash  | hours-to-days      | < 60 seconds   |
| Time-to-notify operator           | never              | < 2 minutes    |
| Concurrent calls Pi can sustain   | unknown            | ≥ 5            |
| Customer-onboarding clicks needed | unknown            | ≤ 3            |
| Branded UI consistency            | 0% (says NC Talk)  | 100%           |

Every Phase ends by re-measuring the metrics it claimed to move.

---

## 2. Phase map

```
Phase 0 — Stop the bleeding (this week)
  └─ Phase 1 — Recording works                    (depends on Pi 64-bit)
       └─ Phase 2 — Cross-LAN reliable            (independent, can parallel 1)
            └─ Phase 3 — Branded UX + customer polish
                 └─ Phase 4 — Reliability + observability
                      └─ Phase 5 — Differentiation
                           └─ Phase 6 — Launch gates + GA
```

Phases 1 and 2 can run in parallel. Everything after 2 must be sequential.

---

## Phase 0 — Stop the bleeding *(this week, ≤ 6 hours)*

**Goal:** prevent the things we already know are broken from getting worse,
and add the alerting we'd need to know about future regressions.

**Tasks**

- **0.1** ✅ DONE today — TURN repointed to LAN IP (192.168.0.211:3478) so
  same-LAN calls connect fast. (Audit P1.1 partial fix.)
- **0.2** ✅ DONE today — `signaling_mode` set to `external`. (Audit P1.4.)
- **0.3** ✅ DONE 2026-05-21 — Apache `ServerName cloud.bestly.tech` appended
  to /etc/apache2/apache2.conf inside nextcloud-app + `apachectl -k graceful`.
  FQDN warning silenced.
  ```bash
  docker exec nextcloud-app bash -c 'echo "ServerName cloud.bestly.tech" >> /etc/apache2/apache2.conf'
  docker exec nextcloud-app apachectl -k graceful
  ```
  (Audit P2.7.)
- **0.4** Add Uptime Kuma monitors for the Talk stack:
  - HTTPS `cloud.bestly.tech/standalone-signaling/api/v1/welcome` → expects 200
  - TCP `192.168.0.211:3478` (coturn)
  - Docker container health: `talk-hpb-signaling-1`, `talk-hpb-nats-1`,
    `talk-hpb-recording-1` (will alert until Phase 1 fixes recording —
    *that's the point*)
  - HTTPS `cloud.bestly.tech/status.php` → expects `installed:true,maintenance:false`
  Wire all to the existing ntfy topic.
- **0.5** ✅ DONE 2026-05-21 — Set `restart: "no"` on the `recording`
  service in `/mnt/ssd/apps/talk-hpb/compose.yaml` (line 29, with a comment
  pointing at docs/talk-launch-opusplan.md Phase 1). Container is now
  Exited, no longer restart-looping. The neighbouring `nats` and
  `signaling` services kept their `unless-stopped` restart policy. Backup
  of original compose is at `compose.yaml.bak-20260521-161157`.

**Phase 0 status: 0.3 + 0.5 DONE. 0.4 (Uptime Kuma monitors) still pending —
needs human in UK UI to wire ntfy topic.** Set up these 5 monitors:
  - HTTPS `cloud.bestly.tech/standalone-signaling/api/v1/welcome` → 200
  - TCP `192.168.0.211:3478` (coturn)
  - Docker container health: `talk-hpb-signaling-1`, `talk-hpb-nats-1`,
    `talk-hpb-recording-1` (the last will alert until Phase 1 lands —
    intentional)
  - HTTPS `cloud.bestly.tech/status.php` → `installed:true,maintenance:false`

**Acceptance**
- Uptime Kuma shows 5 new monitors, 4 green, 1 (recording) intentionally red
  with the note "Phase 1 blocker — see talk-launch-opusplan.md".
- Apache log no longer prints the FQDN warning on graceful reload.
- A test ntfy ping fires when I stop coturn for 30 seconds.

**Risk**: low. All changes are reversible.

---

## Phase 1 — Recording works *(2-4 days)*

**Goal:** A recording starts when the operator clicks "Record", saves to
`/Talk/<RoomName>/recordings/<timestamp>.webm` in Files, fires an ntfy
notification on completion, never silently fails.

**Dependency:** Pi userland on arm64. See `docs/pi-64bit-migration-runbook.md`.
The runbook exists; the migration hasn't been executed. Without this,
nextcloud/aio-talk-recording can't run.

**Tasks**

- **1.1** Execute the 64-bit migration runbook end-to-end. Includes:
  backup, swap-in arm64 rootfs, verify all current containers still come up,
  retire armhf-only patches/workarounds. Allocate a full afternoon — the
  reboot is the scary step.
- **1.2** Pull and start `nextcloud/aio-talk-recording:latest` — should now
  run without segfaulting.
- **1.3** Write `/conf/recording.conf` for the container. Reference the HPB
  `[clients].internalsecret` so the bot can auth to HPB. Bind a Files-storage
  path (or use NC's WebDAV) as the recording output destination.
- **1.4** Set the Talk `recording_servers` app-config:
  ```bash
  occ config:app:set --value='{"servers":[{"server":"http://talk-hpb-recording:8080/","verify":false}],"secret":"<internalsecret>"}' spreed recording_servers
  ```
- **1.5** Smoke-test: create a fake room, click Record, hang up, look for
  the file. Validate ntfy fires on completion.
- **1.6** Auto-link the saved file into the room's chat as a system message
  ("Recording saved → /Talk/Vilmar-Test/recordings/20260520-1430.webm").
  Most likely a Talk app event listener — verify behavior is built-in vs.
  needs us to wire it.
- **1.7** Document customer-facing retention policy: "recordings live in
  your Files for 90 days unless you star them" — add to CUSTOMER_GUIDE.md.

**Acceptance**
- `docker ps` shows talk-hpb-recording-1 with Status `Up`, not Restarting.
- Smoke test produces a playable .webm file in the room folder.
- ntfy notification arrives within 30s of call end.
- Trying to record a call as a guest user is rejected (only logged-in users).

**Risk**:
- **Medium-high.** The 64-bit migration is the scariest step in this whole
  plan because if it goes wrong the entire Pi is offline. Mitigate by taking
  a full `dd` image of the SSD beforehand (estimated 45 min for the 916GB
  partition) and rehearsing the rollback step.
- Recording image might need additional volume mounts for output. Iterate.

**Rollback**: keep the old armhf rootfs snapshot. If 64-bit migration breaks
something we can't fix in 30 min, restore + reboot.

---

## Phase 2 — Cross-LAN reliable *(2-3 days, parallelizable with Phase 1)*

**Status 2026-05-21: backend done.** Router port-forwards were already in
place (TURN-3478 → 192.168.0.211:3478 Both; TURN-Relay → 49160-49200 UDP).
Actual root cause of cross-LAN failures was **coturn's `external-ip` was
stale** (75.223.189.112 — Verizon had rotated the WAN). Updated to
97.134.114.154 and added a self-healing hourly cron at
`/usr/local/sbin/coturn-wan-watch.sh` (script source in this repo at
`scripts/coturn-wan-watch.sh`). Also added `cloud.bestly.tech:3478` to
`spreed.turn_servers` alongside the existing LAN entry so remote callers
can actually resolve it.

**Remaining for Phase 2:** real-world testing from cellular + difficult
wifi (tasks 2.5, 2.6).

**Goal:** Anyone joining a Bestly Talk call from any network, behind any
NAT, gets media flowing in under 3 seconds.

**Tasks**

- **2.1** Pick a TURN strategy:
  - **(a) Router port-forward** — UDP/TCP 3478 + UDP 49152-65535 from WAN
    router → 192.168.0.211. Free. Requires Jared to log into the home router.
    Risk: exposes Pi UDP services to the open internet (mitigated by coturn's
    auth-secret).
  - **(b) Cloudflare Realtime TURN** — registered app, short-lived ICE
    credentials, no port-forward needed. Costs money at scale. Requires
    finishing the Cloudflare TURN registration that's already partway done
    (task #43).
  - **Recommendation:** do BOTH. Path (a) for everyday traffic on Jared's
    home Pi, path (b) as a fallback configured in `turn_servers[1]` so if
    the Pi goes down or the home network has issues, Talk still works.
- **2.2** Widen coturn relay-port range from 49160-49200 → 49152-65535. Edit
  `/etc/turnserver.conf`, restart coturn.
- **2.3** Update `turn_servers` config with both servers (LAN + public).
  WebRTC clients race candidates; the fastest wins per call.
- **2.4** Document the HPB `hashkey` vs. `signaling_servers.secret` semantics
  in the runbook so future operators don't accidentally re-roll one without
  the other.
- **2.5** Test from a phone on cellular (not on the home wifi) — record p95
  connect time over 5 calls. Should be < 3 seconds.
- **2.6** Test from a known-difficult network (e.g. corporate VPN, hotel
  wifi) — confirm STUN + TURN fallback works.

**Acceptance**
- 5 calls from a cellular phone, all connect in ≤ 3s, all stay connected
  through a 5-minute call.
- 5 calls from a coffee-shop wifi, same.
- Drop a TURN server (stop coturn) → calls still connect via the fallback.

**Risk**:
- Router admin password / port-forwarding UI may be unfamiliar. Time-box at
  30 min before falling back to (b)-only.
- Exposing UDP services on the WAN raises the attack surface marginally;
  coturn's `use-auth-secret` + per-session credentials mitigate.

---

## Phase 3 — Branded UX + customer polish *(3-5 days)*

**Goal:** A Bestly Cloud customer who never heard of Nextcloud sees a
coherent "Bestly Talk" experience.

**Tasks**

- **3.1** Theme the Spreed UI like we did with assistant_multi: replace
  "Nextcloud Talk" strings with "Bestly Talk" in the chat header,
  email templates, notification text, system messages. Fork `spreed` into
  `spreed_multi` (mirroring `assistant_multi` / `integration_multi_ai`),
  install over the bundled app via `install-on-cloud.sh`.
- **3.2** Auto-add `call_summary_bot` to every new room via an event listener.
  Currently the bot is installed but only attaches if the operator runs
  `occ talk:bot:install <token>` per room. Customers will never do that.
- **3.3** Seed a "Welcome to Bestly Talk" room on first launch of each new
  Bestly Cloud deployment. Pre-populated with onboarding text and a link to
  the customer guide.
- **3.4** Customize the email-invite template (when you invite someone to a
  room, the email goes through `spreed.email_*` templates) to match the
  Bestly cloud-* templates already in `_shared/transactional-email-templates/`.
- **3.5** Add Talk to the Bestly In-House Cloud brochure as a named feature.
- **3.6** Replace the default Talk app icon in the top nav with a Bestly
  glyph (the swallow mark).

**Acceptance**
- Open a new room, send a message, hang up. Email invite, notification,
  in-room banner all say Bestly. No "Nextcloud" appears in any
  customer-facing surface.
- Send `call_summary_bot` a `/help` in a new room → it responds (proves
  auto-attach).
- Fresh Bestly Cloud deploy has "Welcome to Bestly Talk" room pre-created.

**Risk**: low — this is a content & theming pass. The `spreed_multi` fork
pattern is now well-established from assistant_multi.

---

## Phase 4 — Reliability + observability *(3-5 days)*

**Goal:** when things break we know first; when customers ask "is Talk
working" we have an answer that isn't "let me ssh in".

**Tasks**

- **4.1** Wire HPB's Prometheus `/metrics` endpoint to a Grafana dashboard
  (or to Uptime Kuma's response-time monitor if Grafana is overkill).
- **4.2** Add per-call quality logging: connect time, drop reason, audio
  packet loss %, jitter, MOS estimate. Source: WebRTC `getStats()` from the
  client posted to a new NC endpoint we add.
- **4.3** Daily ntfy summary of Talk health: rooms count, calls in last 24h,
  avg connect time, drop rate, recording success rate.
- **4.4** Load test: write a selenium harness that spins up N headless
  Chromium instances, each joining the same room. Measure when HPB starts
  refusing connections, when audio degrades, when Pi CPU saturates. Goal:
  5 concurrent calls sustained for 30 minutes with < 70% CPU.
- **4.5** Capacity planning doc: "this Pi can carry X concurrent calls. At
  Y customers each doing Z calls/day, you need to scale to a 2nd Pi at..."
- **4.6** Runbook: "Talk is down — how to triage in 60 seconds." Pin in
  Nextcloud Files and link from the audit doc.
- **4.7** Auto-snapshot of HPB + spreed config to Files every Sunday so a
  bad config push can be rolled back.

**Acceptance**
- Dashboard exists, shows live metrics, has at least 7 days of data.
- 5-concurrent-call load test passes the 30-min sustained threshold.
- An induced HPB crash → ntfy in < 60s → runbook recovery in < 5 min.

**Risk**: load test will reveal real bottlenecks we haven't seen yet. Budget
2 extra days for fixing whatever it surfaces.

---

## Phase 5 — Differentiation *(2-4 weeks, optional for v1 launch)*

These are not blockers — they're what makes Bestly Talk feel premium next
to a generic NC install. Pull forward selectively based on customer asks.

- **5.1** Background blur / virtual backgrounds. Wasm-based. Spreed has
  hooks; needs a model + UX work.
- **5.2** Live transcription via integration_openai's Whisper provider —
  every call gets a real-time scrolling transcript that saves to Files
  alongside the recording. Big selling point.
- **5.3** Phone bridge (SIP dial-in). Talk supports SIP; needs a SIP trunk
  provider (Twilio / Bandwidth) and a phone-number-per-customer. Likely a
  paid add-on tier.
- **5.4** Federation: enable `federation-v2` so two different Bestly Cloud
  deployments can call each other natively. Differentiator vs. Zoom for
  customers running multi-region.
- **5.5** Custom Bestly bot framework — write 2-3 starter bots (meeting
  scheduler, action-item extractor, smart summary) and ship them as the
  Bestly Cloud default bot pack.
- **5.6** Per-room recording policy UI: customer can set
  "always record / never record / on-demand" per conversation, with consent
  banner shown to participants when recording is on.

---

## Phase 6 — Launch gates + GA *(1 week)*

**Pre-GA gates** — every one must be green before we sell Talk to a paying
customer.

| Gate | Source | Owner | Status |
|---|---|---|---|
| All P0/P1 from audit closed | talk-launch-audit.md | Jared | open |
| 5-concurrent-call load test passes | Phase 4.4 | Jared | open |
| Recording success ≥ 99% over 10 trials | Phase 1.5 | Jared | open |
| Cross-LAN p95 ≤ 3s over 10 trials | Phase 2.5 | Jared | open |
| Branded UI — no "Nextcloud" leaks | Phase 3 | Jared | open |
| Monitoring covers all components | Phase 0.4 + 4.1 | Jared | open |
| Customer runbook published | Phase 4.6 + 3.5 | Jared | open |
| Disaster recovery test passed | new | Jared | open |
| Pricing & terms drafted | docs/ | Jared | open |
| Legal: recording-consent disclosure | new | Jared | open |

**Disaster recovery test** = pull the Pi's power cord mid-call. Restore
service from cold-start in < 10 min. Document the exact steps.

**Launch artifact set**:
- Talk landing page at `bestly.tech/talk` (new) — what it is, what it
  replaces, how it's different from Zoom/Teams.
- Updated In-House Cloud brochure with Talk as a named feature.
- Pricing page row: "Bestly Talk included" with feature checkmarks.
- Customer onboarding email mentions Talk as one of the included apps.

---

## Open questions

1. **Recording storage location** — in NC Files (per-room folder) or in a
   dedicated S3-backed mount we resell? Files is simpler, S3 is more
   scalable. Default to Files for v1.
2. **Recording retention** — 30, 60, 90 days? Customer-configurable? My
   draft uses 90 days uniform; revisit before Phase 1.7.
3. **Call recording consent UX** — banner that shows when recording starts,
   or modal that requires click-through? EU privacy law (and California's
   CIPA) lean toward affirmative consent → modal. Default to modal.
4. **Federation** — useful pre-launch (Phase 5.4) or post-launch? Probably
   post-launch unless an early customer demands it.
5. **Per-customer Bestly Cloud has its own Talk** vs. **shared multi-tenant
   Talk hosted by Bestly** — current model is per-customer. Multi-tenant
   would change Phase 2's TURN strategy (regional TURN servers). Default
   per-customer for v1, keep multi-tenant as a v2 option.
6. **Mobile apps** — NC Talk has iOS and Android apps. Do we rebrand them
   too, or tell customers "use the web app on mobile"? Rebrand requires
   forking the apps and submitting to App Store / Play Store under Bestly
   developer accounts — significant ongoing cost. v1: web-only, v2: native.
7. **Recording archive search** — once we have transcripts (Phase 5.2), do
   we index them for search? Probably yes, post-launch.

---

## Resource & time estimate

| Phase | Effort | Calendar |
|---|---|---|
| 0 — Stop the bleeding | 6 h | done by tomorrow |
| 1 — Recording works | 2-4 d | week 1 (depends on Pi 64-bit) |
| 2 — Cross-LAN reliable | 2-3 d | week 1 (parallel) |
| 3 — Branded UX | 3-5 d | week 2 |
| 4 — Reliability + obs | 3-5 d | week 3 |
| 5 — Differentiation | 2-4 wk | post-launch |
| 6 — Launch gates + GA | 1 wk | week 4 |

**Minimum viable launch: 4 weeks of focused work.** Realistically 6 weeks
with everything else competing for Jared's time.

**External costs (estimated):**
- Cloudflare Realtime TURN: free tier likely covers v1 (test); ~$30/mo at
  modest scale.
- Backup arm64 SD/SSD for migration safety: $50 one-time.
- SIP trunk for Phase 5.3 (deferred): $0.01/min + DID rental.
- App Store + Play Store developer accounts for native apps (deferred):
  $99/yr (Apple) + $25 once (Google).

---

## Rollback strategy per phase

- **Phase 0:** every change is `occ config:app:set` or systemd. Single command
  rollback.
- **Phase 1:** pre-migration dd image of the SSD. Boot rescue, write back,
  reboot. Single hour rollback.
- **Phase 2:** keep the previous `turn_servers` JSON in a git-tracked file
  (`scripts/talk-config-snapshots/`). Restore + restart spreed.
- **Phase 3:** assistant_multi-style install-on-cloud script supports
  uninstall (`occ app:disable spreed_multi`). Bundled Nextcloud spreed
  takes over.
- **Phase 4:** monitoring + load-test work doesn't touch prod config.
- **Phase 5:** every feature is independently feature-flagged via
  `occ config:app:set spreed bestly_<feature> --value=on|off`.

---

## What I'd do tomorrow morning

1. Run Phase 0 in one sitting (90 min): Apache ServerName, Uptime Kuma
   monitors, stop the recording restart loop. Commit + push.
2. Schedule Phase 1's Pi 64-bit migration for a quiet Sunday morning. Take
   the dd backup the night before.
3. Start Phase 2 in parallel — Cloudflare TURN registration is the fastest
   path; do it from the Mac while waiting for Phase 1 backup to finish.
4. Don't touch Phases 3-5 until 1 and 2 are green for 72 hours straight.

That gets us to a real launch in 4 weeks if nothing else competes. 6 weeks
if it does.
