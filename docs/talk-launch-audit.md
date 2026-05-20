# Bestly Talk — Pre-Launch Audit

**Audited:** 2026-05-20
**Stack:** Nextcloud Spreed 23.0.4, HPB signaling, NATS, coturn, talk-hpb-recording
**Verdict:** **Not launch-ready.** Two P0 issues blocking recording + cross-LAN
calling, three P1 config gaps, and a wider set of P2/P3 improvements before we
can put this in front of a paying customer.

---

## P0 — Broken right now

### P0.1 — Recording container won't run (Pi userland is armhf, image is arm64)

`talk-hpb-recording-1` has been in restart-loop with **511 restarts** and
exit code 159 (hard crash, core dump in
`/var/lib/docker/volumes/.../recording/_data/core.1`).

Pulling the image directly confirms the cause:

```
WARNING: The requested image's platform (linux/arm64) does not match
the detected host platform (linux/arm/v8)
```

The Pi runs a **64-bit kernel with a 32-bit (armhf) userland**. The image
`nextcloud/aio-talk-recording:latest` ships arm64 binaries only — they segfault
the moment they try to load.

**Fix:** complete the 64-bit migration tracked in `docs/pi-64bit-migration-runbook.md`.
Until that's done, native Talk recording is impossible from this container.
Workarounds: (a) external recording bot on a different machine, (b) browser-side
MediaRecorder (no server-side composition), (c) ship with recording disabled and
mark the feature as "Coming soon" in the Bestly Cloud customer guide.

### P0.2 — Recording servers config is empty in Nextcloud

Even if P0.1 is solved, `occ config:app:get spreed recording_servers` returns
empty. Talk has no idea where to send recording start/stop calls. After the
container is healthy:

```bash
docker exec -u www-data nextcloud-app php occ config:app:set --value='{"servers":[{"server":"http://talk-hpb-recording:8080/","verify":false}],"secret":"<MATCHES HPB internalsecret>"}' spreed recording_servers
```

The secret **must match** the `internalsecret` in
`/config/server.conf` inside `talk-hpb-signaling-1` (currently
`1f878e5fba909d7c11281594bf8e043d380f3f12e97a10d4ed16c7125f1dfd2e`).

---

## P1 — Significant gaps

### P1.1 — TURN is now LAN-only (good for same-LAN, broken for off-network)

After today's slow-connect fix:

```
turn_servers = [{"server":"192.168.0.211:3478","protocols":"udp,tcp"}]
```

This makes same-network calls (Jared + Vilmar) connect in <2s, but anyone
joining from outside the LAN gets no TURN relay and falls back to STUN-only —
which works for ~80% of consumer NATs but fails behind symmetric NAT (corporate
networks, some carrier-grade NAT).

**Two paths to "really" fix cross-LAN:**

- **Path A — Router port-forward.** Forward UDP 3478 + TCP 3478 + UDP
  49160-49200 from the WAN router to 192.168.0.211. Then change `turn_servers`
  back to `cloud.bestly.tech:3478` (or add it as a second entry). coturn already
  has `external-ip=75.223.189.112/192.168.0.211` configured correctly.
- **Path B — Cloudflare Realtime TURN.** Register the bestly-talk app in the
  Cloudflare dashboard, generate short-lived ICE credentials from
  `rtc.live.cloudflare.com/v1/turn/keys/<TOKEN_ID>/credentials/...`, plug into
  Talk's turn_servers. No port forwarding needed. (Task #43.)

### P1.2 — TURN relay-port range is too narrow

coturn config: `min-port=49160`, `max-port=49200`. That's only **41 ports**
for relay candidates. A handful of concurrent multi-participant calls will
exhaust the range and new participants will fail to gather TURN candidates.

**Fix:** widen to `49152-65535` (the recommended range), and forward that
whole UDP block from the router if doing Path A above.

### P1.3 — HPB `hashkey` vs Talk `signaling_servers.secret` mismatch

Inside `talk-hpb-signaling-1`:

```
[sessions]
hashkey = 5a49231beca9fdee1116b398b47f5888689113538970c7dea0d2a755eef6550b
```

In Talk's `signaling_servers` config:

```
"secret":"80dbdd816dd993643b187e139ad0ce44bb334234915424a821ece319771cf353"
```

These look like they're different things (one is the session-hash key, the other
is the NC↔HPB backend secret) but it's worth re-reading the
HPB `[backend]` section's `backends`/`<name>.secret` to confirm. If the two
secrets are supposed to match and don't, the HPB will reject room hellos with
"invalid backend signature" errors. The fact that calls do connect means it's
probably right today, but the docs in this repo don't say so — worth documenting.

### P1.4 — `signaling_mode` was empty (FIXED today)

`occ config:app:get spreed signaling_mode` returned blank. Set to `external`
during this audit. Before the fix, some Talk clients may have defaulted to
internal signaling under certain edge cases, ignoring HPB entirely. Worth
verifying in the post-fix UI that the green "external" indicator shows in the
Talk admin panel.

---

## P2 — Improvements before declaring launch-ready

- **P2.1 No call-quality metrics.** We have no record of connect-time, drop
  rate, audio MOS, or packet loss. For a paid product we need a dashboard.
  HPB exposes `/metrics` (Prometheus) — wire it into Uptime Kuma or Grafana.
- **P2.2 No call recording auto-upload.** When (after P0.1 is fixed) a recording
  finishes, Talk doesn't auto-link it to a Files folder per room. Customers
  will expect "the recording lives in `/Talk/<Room>/recordings/`".
- **P2.3 Branded Talk UI.** Just like assistant_multi rebrands "Nextcloud
  Assistant", Talk's UI still says "Nextcloud Talk" in the header, mail
  templates, and notifications. Theming pass needed for Bestly Cloud
  customers.
- **P2.4 `call_summary_bot` v3.4.0 is installed but unattached.** Bot exists
  but isn't auto-added to new rooms — so no automatic chat summaries.
  Either (a) auto-attach to all new rooms via an event listener, or (b)
  document the manual `occ talk:bot:install` step.
- **P2.5 No "first launch" room template.** When a new Bestly Cloud customer
  spins up Talk, they get an empty conversation list. Should auto-seed a
  "Welcome to Bestly Talk" room with onboarding text.
- **P2.6 No retention policy.** `retention-event:28`, `retention-instant-meetings:1`,
  `retention-phone:7` — fine defaults, but documented nowhere customer-facing.
- **P2.7 Apache `ServerName` warning** logged every time apache reloads:
  *"Could not reliably determine the server's fully qualified domain name,
  using 172.18.0.6"*. Cosmetic but noisy; set `ServerName cloud.bestly.tech`
  in the apache conf.
- **P2.8 Bots platform exists but unused.** Nextcloud Talk Bot Framework v1
  is in the feature list. We could ship a Bestly assistant bot that's
  pre-installed in every room — instant value-add for customers.
- **P2.9 No SIP / phone bridging.** `sip-enabled: false`. For a launch product
  in 2026, dial-in from a phone number is table-stakes for many customer
  use cases. Could be a paid add-on tier.
- **P2.10 No Talk federation.** `federation-v1` and `federation-v2` are in the
  feature list but `federation.enabled: false`. Same-org cross-instance calling
  is a differentiator vs. Zoom — worth turning on once we have >1 Bestly Cloud
  deployment.
- **P2.11 No load test.** We've never simulated 5+ concurrent calls on the Pi.
  Need a load test (selenium + headless browser running fake participants) to
  validate the HPB + coturn + NC stack can carry real customer load.
- **P2.12 No ntfy/Slack alert** when a Talk component crashes. The recording
  container has been crashing 511 times and nobody noticed until this audit.
  Add Uptime Kuma monitors for: HPB signaling :8088, coturn :3478, recording :8080.

---

## P3 — Nice-to-haves

- **Background blur / virtual backgrounds** — `blur-virtual-background:false`.
  Customers expect this. Requires WASM ML pipeline; non-trivial.
- **Live transcription** — `live-transcription:false`. Could plug into
  integration_openai's Whisper provider.
- **Meeting scheduling polish** — `schedule-meeting` feature is on, but the
  UX of creating a meeting room with calendar invite isn't polished.
- **Emoji reactions** — already enabled with a 12-emoji set. Good.
- **Polls & breakout rooms** — both enabled. Good.

---

## Bright spots

- coturn: active, listening 0.0.0.0:3478 UDP+TCP, valid `static-auth-secret`,
  realm `cloud.bestly.tech`.
- HPB signaling: up 8h, NATS up 8h.
- Pi resource headroom: 12GiB RAM available, 28% disk, load 0.87 — plenty of
  room to grow.
- TLS cert valid through 2026-07-07 (Let's Encrypt E8).
- 7 rooms exist, 0 calls in the last 7 days — a clean slate before launch.
- `signaling_mode=external` is now set correctly after this audit.
- Today's TURN swap from cloud.bestly.tech → 192.168.0.211 will make same-LAN
  Bestly internal calls instant.

---

## Fix order if I had a week

1. Land the Pi 64-bit migration (P0.1) — unblocks recording.
2. Set `recording_servers` config (P0.2) — wires up recording.
3. Router port-forward UDP 3478 + 49160-49200 (P1.1 Path A) OR Cloudflare TURN
   (P1.1 Path B) — fixes cross-LAN.
4. Widen coturn relay ports to 49152-65535 (P1.2).
5. Wire Uptime Kuma monitors for HPB + coturn + recording (P2.12) so we know
   when something breaks BEFORE the customer call.
6. Auto-attach `call_summary_bot` (P2.4).
7. Brand the Talk UI (P2.3).
8. Load test 5 concurrent calls (P2.11).
9. Document customer-facing retention + recording policy (P2.6).
