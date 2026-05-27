# Nextcloud 502 Recovery + cloudflared Self-Heal — OpusPlan

_v1.0 — 2026-05-26 — Internal — Bestly Ops_

## TL;DR

On 2026-05-26 ~18:18 PDT, cloud.bestly.tech started returning **502 Bad Gateway** from Cloudflare. The Nextcloud origin was **fully healthy** the entire time — the failure was that **cloudflared was holding stale TCP connections** to the Docker proxy after the `nextcloud-app` container restarted. Fixed by `sudo systemctl restart cloudflared` on `bestly-pi`. Total downtime ~6 minutes.

This plan: (1) the precise RCA, (2) the immediate hardening — a 30-line watcher that probes the upstream and restarts cloudflared on N consecutive failures so the same failure mode auto-heals in <60s, (3) two longer-term structural changes that remove the root cause entirely, (4) operational runbook for next time it happens manually.

---

## 1. The failure chain

```
1. Container nextcloud-app restarts
       (cause: container update / docker compose pull / Watchtower / manual)
       ↓
2. Docker assigns a new container IP on the bridge network (172.18.0.x)
       ↓
3. docker-proxy on host port 8082 reconfigures to point at the new IP
   ┌──────────────────────────────────────────────────────────┐
   │  This part works correctly. The HOST port stays bound.   │
   │  curl http://localhost:8082 from the Pi → 200 OK.        │
   └──────────────────────────────────────────────────────────┘
       ↓
4. cloudflared keeps its connection pool TO localhost:8082
   from BEFORE the restart. Those TCP sockets point at the
   OLD container's docker-proxy instance, which terminated.
       ↓
5. cloudflared sends a request → kernel RSTs the dead socket →
   cloudflared logs: "Unable to reach the origin service ...
   connection reset by peer" and returns 502 to Cloudflare edge.
       ↓
6. Cloudflare edge serves the 502 to every browser hitting
   cloud.bestly.tech.
       ↓
7. NO autohealing happens. cloudflared does not interpret
   "connection reset by peer" as a config-stale signal.
   The pool stays poisoned until cloudflared is restarted.
```

### Evidence from today

- `nextcloud-app` container status: `Up About a minute` at the time of investigation.
- `curl http://localhost:8082/status.php` from the Pi: **200 OK**.
- `sudo docker exec -u www-data nextcloud-app php occ status`: `installed=true maintenance=false version=33.0.3.2`.
- `journalctl -u cloudflared`: 100+ lines of `read tcp [::1]:NNNNN->[::1]:8082: read: connection reset by peer` over ~6 minutes.
- After `sudo systemctl restart cloudflared`: **immediate** HTTP/2 200 from cloud.bestly.tech.
- Mac Nextcloud client was actively syncing WebDAV throughout — those requests go via Tailscale (`100.110.35.55:443` listener owned by `tailscaled`) directly to the Docker bridge, bypassing the host's :8082 path entirely. That's why the desktop client worked while browser traffic 502'd.

### Why cloudflared doesn't auto-recover

cloudflared maintains a long-lived connection pool to each upstream service. Connection failures are retried at the **request** level but the pool itself is not invalidated unless cloudflared receives a connection-level error during the initial dial. Once sockets are bound, cloudflared will keep trying to reuse them across requests. The combination of "host port still listening (so the pool socket dial wasn't refused at TCP)" + "upstream behind it changed" is the classic stale-pool-failure that cloudflared has no automatic remediation for.

This is documented behavior — cloudflared's `originRequest.keepAliveConnections` defaults to 100 and `keepAliveTimeout` defaults to 90s. Even with the timeout, a steady trickle of requests keeps the bad sockets alive.

---

## 2. The fix we ran (manual, 30 seconds)

```bash
ssh pi
sudo systemctl restart cloudflared
sleep 4
curl -sI https://cloud.bestly.tech/status.php   # expect HTTP/2 200
```

After this, the user must **hard-refresh** their browser (Cmd+Shift+R) to bypass the Cloudflare cached 502 response.

---

## 3. The hardening — `cloudflared-origin-watch`

A tiny systemd service on `bestly-pi` that probes the local origin every 30 seconds and restarts cloudflared if the probe fails N consecutive times. This converts a sticky multi-minute outage into a self-healing <60s blip.

### 3.1 The watcher script — `/usr/local/bin/cloudflared-origin-watch.sh`

```bash
#!/bin/bash
#
# cloudflared-origin-watch — probe the local Nextcloud origin and restart
# cloudflared if the probe fails N consecutive times. This prevents stale
# connection pools from sticking after a container restart.
#
# See docs/nextcloud-502-recovery-opusplan.md for context.

set -euo pipefail

PROBE_URL="${PROBE_URL:-http://localhost:8082/status.php}"
PROBE_INTERVAL="${PROBE_INTERVAL:-30}"        # seconds between probes
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-3}"   # consecutive failures before restart
RESTART_COOLDOWN="${RESTART_COOLDOWN:-300}"   # seconds to wait after a restart
NTFY_TOPIC="${NTFY_TOPIC:-bestly-sysalert-7q2k9mx4}"

consecutive_failures=0
last_restart=0

log() {
  echo "$(date -u +%FT%TZ) $*"
}

probe() {
  curl -sf -m 5 -o /dev/null -w '%{http_code}' "$PROBE_URL" 2>/dev/null
}

notify() {
  local msg="$1"
  curl -sfm 5 -d "$msg" -H "X-Title: cloudflared-origin-watch" \
       "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true
}

log "starting cloudflared-origin-watch; probe=$PROBE_URL interval=${PROBE_INTERVAL}s threshold=$FAILURE_THRESHOLD"

while true; do
  code="$(probe || echo 000)"
  now=$(date +%s)

  if [ "$code" = "200" ] || [ "$code" = "302" ] || [ "$code" = "301" ]; then
    if [ "$consecutive_failures" -gt 0 ]; then
      log "origin recovered after $consecutive_failures failures (now $code)"
    fi
    consecutive_failures=0
  else
    consecutive_failures=$((consecutive_failures + 1))
    log "probe failed: code=$code (consecutive=$consecutive_failures)"

    if [ "$consecutive_failures" -ge "$FAILURE_THRESHOLD" ]; then
      if [ $((now - last_restart)) -lt "$RESTART_COOLDOWN" ]; then
        log "cooldown active, not restarting (last restart $((now - last_restart))s ago)"
      else
        log "RESTARTING cloudflared (consecutive=$consecutive_failures threshold=$FAILURE_THRESHOLD)"
        notify "cloudflared-origin-watch: restarting cloudflared after $consecutive_failures consecutive probe failures. URL=$PROBE_URL last_code=$code"
        systemctl restart cloudflared
        last_restart=$now
        consecutive_failures=0
        sleep 10  # give cloudflared time to re-establish tunnel
      fi
    fi
  fi

  sleep "$PROBE_INTERVAL"
done
```

### 3.2 The systemd unit — `/etc/systemd/system/cloudflared-origin-watch.service`

```ini
[Unit]
Description=Watch local Nextcloud origin and restart cloudflared on stale-pool failures
After=cloudflared.service docker.service
Wants=cloudflared.service

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared-origin-watch.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Environment overrides — edit /etc/default/cloudflared-origin-watch to tune.
EnvironmentFile=-/etc/default/cloudflared-origin-watch

[Install]
WantedBy=multi-user.target
```

### 3.3 The optional env file — `/etc/default/cloudflared-origin-watch`

```bash
PROBE_URL=http://localhost:8082/status.php
PROBE_INTERVAL=30
FAILURE_THRESHOLD=3
RESTART_COOLDOWN=300
NTFY_TOPIC=bestly-sysalert-7q2k9mx4
```

### 3.4 Install

```bash
ssh pi
sudo install -m 0755 cloudflared-origin-watch.sh /usr/local/bin/
sudo cp cloudflared-origin-watch.service /etc/systemd/system/
sudo cp cloudflared-origin-watch.default  /etc/default/cloudflared-origin-watch
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-origin-watch
sudo systemctl status cloudflared-origin-watch --no-pager
```

### 3.5 Tuning notes

- **Threshold 3 × interval 30s = 90s detection window.** Tighter than this risks restarting cloudflared during a benign 5-second hiccup. Looser misses real outages.
- **RESTART_COOLDOWN 5 min** prevents a flap loop. If cloudflared restart doesn't fix it, the real issue isn't stale pools and a restart loop would mask the real signal.
- **Probe URL is `localhost:8082/status.php`** — same endpoint cloudflared itself hits. If the watcher can reach it, cloudflared should be able to.
- **Probe accepts 200/301/302** because Nextcloud root sometimes redirects.
- **ntfy notification on every restart** so we don't silently mask a recurring problem. If you see >2 restarts in a day, the underlying cause needs investigation.

---

## 4. Two structural fixes that remove the root cause

The watcher above is a **symptom fix**. The deeper problem — that container restarts invalidate cloudflared's connection pool — has two clean solutions.

### 4.1 Pin the container to a fixed IP on the Docker bridge

Add a static IP to the `nextcloud-app` service in `docker-compose.yml`:

```yaml
services:
  nextcloud-app:
    networks:
      bestly:
        ipv4_address: 172.18.0.10
networks:
  bestly:
    ipam:
      config:
        - subnet: 172.18.0.0/16
```

Then point cloudflared directly at the container's bridge IP, bypassing docker-proxy entirely:

```yaml
# /etc/cloudflared/config.yml (cloudflared on host — IF we move config there;
# currently the tunnel uses the inline --token form with config stored in
# Cloudflare's dashboard. Same change applies in the Zero Trust UI.)
ingress:
  - hostname: cloud.bestly.tech
    service: http://172.18.0.10:80
  - service: http_status:404
```

This eliminates the docker-proxy hop. The container IP doesn't change across restarts because we pinned it. cloudflared's pool stays valid.

**Tradeoff**: cloudflared on the host has to be able to route to the Docker bridge. By default `docker0` and custom bridges are reachable from the host, so this works. Confirm with `ip route` showing the 172.18.0.0/16 network.

### 4.2 Move cloudflared inside the same Docker network

Run cloudflared as a Docker service in the same compose project. Then point it at `nextcloud-app:80` by container name — Docker DNS resolves the name to the current container IP on every dial, so restarts are transparent.

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARED_TUNNEL_TOKEN}
    networks:
      - bestly
    depends_on:
      - nextcloud-app
```

And in the Cloudflare Zero Trust dashboard, set the public hostname's service to `http://nextcloud-app:80`.

**Tradeoff**: cloudflared is no longer managed by systemd. It restarts with the Docker daemon. For Bestly's use this is fine — Docker is already a critical-path service.

**Recommendation**: do **4.1** (static IP, cloudflared on host) because it's a 5-line change with no service relocation. The container-network approach (4.2) is cleaner but more disruptive.

---

## 5. Runbook — "cloud.bestly.tech says 502, what do I do?"

Print this and stick it where you'd see it during an outage.

```
1. From any terminal, ssh pi
2. Run:    curl -sI -m 5 http://localhost:8082/status.php
   - 200 → origin healthy. Skip to step 4.
   - anything else → real Nextcloud problem. Skip to step 6.

3. (We never get here if step 2 was 200.)

4. Run:    sudo systemctl status cloudflared --no-pager | head -10
           sudo journalctl -u cloudflared --no-pager -n 30 | grep -c "Unable to reach"
   - Many "Unable to reach" lines → stale pool. Run step 5.
   - Few/none → some other tunnel-level issue. Check Cloudflare dashboard, page details upstream.

5. Run:    sudo systemctl restart cloudflared
   Wait 5 seconds. Verify externally:
              curl -sI https://cloud.bestly.tech/status.php
   - 200 → fixed. Browser cache may still show 502 — Cmd+Shift+R.

6. (Origin is actually unhealthy.) Check container state:
              sudo docker ps --filter name=nextcloud
              sudo docker logs --tail 50 nextcloud-app
              sudo docker exec -u www-data nextcloud-app php occ status
   - maintenance:true → run: sudo docker exec -u www-data nextcloud-app php occ maintenance:mode --off
   - needsDbUpgrade:true → run: sudo docker exec -u www-data nextcloud-app php occ upgrade
   - container exited → sudo docker compose -f /opt/bestly/docker-compose.yml up -d nextcloud-app
```

The watcher in §3 makes step 5 happen automatically within ~90 seconds for the stale-pool case. Keep the runbook so a human can recognize the same pattern faster than the watcher when present.

---

## 6. Definition of done

- [ ] `/usr/local/bin/cloudflared-origin-watch.sh` installed and executable.
- [ ] `/etc/systemd/system/cloudflared-origin-watch.service` installed, enabled, and `active (running)`.
- [ ] `journalctl -u cloudflared-origin-watch` shows "starting cloudflared-origin-watch" within last hour.
- [ ] One synthetic test executed: stop nextcloud-app container, wait 2 minutes, confirm cloudflared was restarted by the watcher, confirm cloud.bestly.tech back to 200, ntfy alert delivered.
- [ ] Static-IP change (§4.1) decision recorded in `docs/pi-stack-inventory.md` — either applied or explicitly deferred with rationale.
- [ ] Runbook §5 pinned somewhere durable (Nextcloud, README, sticky note on the Pi enclosure — operator's choice).

---

## 7. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-26 | Claude (with Jared) | v1.0 — initial. RCA of 2026-05-26 502 incident. Defined watcher, structural fixes, runbook. |

---

_Adjacent docs: `nextcloud-auto-update-opusplan.md` for how we'd auto-update Nextcloud without ever causing one of these in the first place; `pi-64bit-migration-runbook.md` for the planned userland swap that will simplify the stack._
