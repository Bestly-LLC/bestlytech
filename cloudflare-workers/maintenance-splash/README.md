# bestly-cloud-maintenance-splash

A Cloudflare Worker that wraps `cloud.bestly.tech` and replaces infrastructure 5xx errors (502/503/504) with a Bestly-branded "back in a moment" splash page that auto-refreshes when origin recovers.

## What it does

| Origin returns | Worker serves |
|---|---|
| 2xx | pass through unchanged |
| 3xx | pass through unchanged |
| 4xx (incl. real 401/403/404) | pass through unchanged |
| **502 / 503 / 504** (from cloudflared) | **branded splash + auto-poll** |
| 500 (real PHP application errors) | pass through — we don't mask bugs |

For non-browser clients (Nextcloud desktop, WebDAV, mobile apps), the Worker passes the original status code through with a small JSON body, so sync clients back off with their normal retry logic instead of trying to parse HTML.

## Why we need this

See `docs/nextcloud-502-recovery-opusplan.md`. Short version: when the `nextcloud-app` container restarts on the Pi, cloudflared briefly holds stale TCP connections and serves 502s for ~60-90s (until the watcher restarts it, or someone runs `systemctl restart cloudflared`). During that window, every browser hitting `cloud.bestly.tech` sees Cloudflare's raw "Bad Gateway" page, which is alarming and unbranded. This Worker turns that into a friendly "back in a moment" page that reloads itself when the origin comes back.

## Deploy

You need to be in the `cloudflare-workers/maintenance-splash/` directory with `wrangler` logged in to the right Cloudflare account.

```bash
cd cloudflare-workers/maintenance-splash
wrangler whoami     # confirm: J5j96xpt58@privaterelay.appleid.com's Account
wrangler deploy
```

The first deploy will register the route `cloud.bestly.tech/*`. From then on, every request to the zone goes through the Worker first.

## Verify

```bash
# 1. Normal request — should pass through and return Nextcloud login redirect
curl -sI https://cloud.bestly.tech/

# 2. Simulate a 5xx by stopping origin briefly (on the Pi)
ssh pi 'sudo systemctl stop cloudflared'
sleep 3
curl -s https://cloud.bestly.tech/ | head -20      # expect splash HTML
ssh pi 'sudo systemctl start cloudflared'
sleep 5
curl -sI https://cloud.bestly.tech/                # back to pass-through
```

The splash page itself can be previewed by Cmd+Shift+R'ing `https://cloud.bestly.tech/` during any actual outage.

## Customization

Edit `wrangler.toml`'s `[vars]` block:

```toml
[vars]
BRAND_NAME = "Bestly Cloud"
SUPPORT_LINK = "https://bestly.tech/contact"
```

Or override on deploy without editing:

```bash
wrangler deploy --var BRAND_NAME:"Cloud" --var SUPPORT_LINK:"mailto:ops@bestly.tech"
```

To change the look (colors, copy, animation), edit `src/index.js` — the splash HTML is inlined as a template literal in the `renderSplash()` function. Re-deploy with `wrangler deploy`. No build step.

## Cost

Workers free tier: 100,000 requests/day. Bestly's traffic is well below that. This Worker costs $0/month at current scale.

## Rollback

```bash
wrangler deployments list
wrangler rollback <deployment-id>
```

Or remove the Worker entirely:

```bash
wrangler delete bestly-cloud-maintenance-splash
```

Removing the Worker reverts to vanilla Cloudflare → cloudflared behavior (raw 502 page on origin failures).

## See also

- `docs/nextcloud-502-recovery-opusplan.md` — the RCA + cloudflared-origin-watch daemon that should be deployed alongside this Worker (the Worker masks the symptom; the watcher fixes the cause).
- `docs/nextcloud-auto-update-opusplan.md` — the auto-update orchestrator that, once live, will mean container restarts happen at a known time so the splash page becomes "we're updating, back in 2 minutes" with confidence.
