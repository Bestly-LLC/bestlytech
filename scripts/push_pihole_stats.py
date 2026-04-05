#!/usr/bin/env python3
"""
push_pihole_stats.py — Raspberry Pi cron script
================================================
Fetches live stats from the local Pi-hole API and pushes a snapshot to
Supabase so the Bestly admin dashboard can display real data.

SETUP ON THE PI
---------------
1. Copy this file to /home/pi/scripts/push_pihole_stats.py
2. Create /home/pi/scripts/.env with:

       SUPABASE_URL=https://keowunrxpxlbgebujbao.supabase.co
       SUPABASE_SERVICE_KEY=<your-service-role-key-from-supabase-dashboard>
       PIHOLE_URL=http://localhost          # or http://192.168.0.211
       # Optional — only needed if Pi-hole has a web password set:
       # PIHOLE_TOKEN=<your-pi-hole-api-token-from-settings-api>

3. Make executable:
       chmod +x /home/pi/scripts/push_pihole_stats.py

4. Add to crontab (runs every 60 seconds):
       crontab -e
   Add these two lines (cron minimum is 1 min, so we schedule twice):
       * * * * * /usr/bin/python3 /home/pi/scripts/push_pihole_stats.py
       * * * * * sleep 30 && /usr/bin/python3 /home/pi/scripts/push_pihole_stats.py

   This gives a push every ~30 seconds. For every-60s just use one line.

5. Check logs:
       grep push_pihole /var/log/syslog
   Or redirect stdout/stderr in crontab:
       * * * * * /usr/bin/python3 /home/pi/scripts/push_pihole_stats.py >> /home/pi/scripts/pihole_push.log 2>&1

Pi-hole API endpoints used
--------------------------
  ?summaryRaw       — total queries, blocked, percent, blocklist size, status
  ?topItems=25      — top_queries (permitted) and top_ads (blocked)
  ?overTimeData10mins — 10-minute interval buckets for the last 24h chart

The Supabase auto-pruning trigger deletes rows older than 25 hours so the
table stays small regardless of how often this script runs.
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path


# ── Config ────────────────────────────────────────────────────────────────────

def load_env(path: str) -> None:
    """Load KEY=VALUE lines from a .env file into os.environ (no dependencies)."""
    try:
        for line in Path(path).read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass  # .env is optional — env vars may already be set


load_env(str(Path(__file__).parent / ".env"))

PIHOLE_URL        = os.environ.get("PIHOLE_URL", "http://localhost").rstrip("/")
PIHOLE_TOKEN      = os.environ.get("PIHOLE_TOKEN", "")          # optional auth token
SUPABASE_URL      = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY      = os.environ.get("SUPABASE_SERVICE_KEY", "")
TABLE             = "home_hub_pihole_stats"
TOP_N             = 25      # domains to fetch for top lists
OVERTIME_HOURS    = 24      # hours of history for the chart


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pihole_url(params: str) -> str:
    base = f"{PIHOLE_URL}/admin/api.php?{params}"
    if PIHOLE_TOKEN:
        base += f"&auth={PIHOLE_TOKEN}"
    return base


def fetch_json(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError as exc:
        print(f"  [WARN] fetch failed for {url}: {exc}", file=sys.stderr)
        return None
    except (json.JSONDecodeError, Exception) as exc:
        print(f"  [WARN] parse error for {url}: {exc}", file=sys.stderr)
        return None


def build_queries_over_time(over_data: dict | None) -> list[dict]:
    """
    Aggregate Pi-hole's 10-minute interval data into hourly buckets.
    Returns up to OVERTIME_HOURS entries: [{hour, allowed, blocked}, ...]
    """
    if not over_data:
        return []

    domains_ot: dict = over_data.get("domains_over_time") or {}
    ads_ot: dict     = over_data.get("ads_over_time") or {}

    hourly: dict[int, dict] = {}
    for ts_str, queries in domains_ot.items():
        try:
            ts = int(ts_str)
        except ValueError:
            continue
        hour_ts = ts - (ts % 3600)
        blocked = int(ads_ot.get(ts_str, 0))
        allowed = max(0, int(queries) - blocked)
        if hour_ts not in hourly:
            hourly[hour_ts] = {"allowed": 0, "blocked": 0}
        hourly[hour_ts]["allowed"] += allowed
        hourly[hour_ts]["blocked"] += blocked

    result = []
    for hour_ts in sorted(hourly)[-OVERTIME_HOURS:]:
        dt = datetime.fromtimestamp(hour_ts, tz=timezone.utc)
        # Use 12-hour local-ish label, e.g. "2 PM"
        label = dt.strftime("%-I %p")
        result.append({
            "hour":    label,
            "allowed": hourly[hour_ts]["allowed"],
            "blocked": hourly[hour_ts]["blocked"],
        })
    return result


def build_top_lists(top_data: dict | None) -> tuple[list[dict], list[dict]]:
    """Returns (top_blocked, top_permitted) as [{domain, count}] lists."""
    if not top_data:
        return [], []

    top_blocked = [
        {"domain": domain, "count": int(count)}
        for domain, count in (top_data.get("top_ads") or {}).items()
    ]
    top_permitted = [
        {"domain": domain, "count": int(count)}
        for domain, count in (top_data.get("top_queries") or {}).items()
    ]
    return top_blocked, top_permitted


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.", file=sys.stderr)
        sys.exit(1)

    print(f"[{datetime.now().isoformat(timespec='seconds')}] Fetching Pi-hole stats…")

    summary  = fetch_json(_pihole_url("summaryRaw"))
    top_data = fetch_json(_pihole_url(f"topItems={TOP_N}"))
    over_data = fetch_json(_pihole_url("overTimeData10mins"))

    if not summary:
        print("ERROR: Could not reach Pi-hole summaryRaw endpoint.", file=sys.stderr)
        sys.exit(1)

    # Pi-hole v5 summaryRaw field names
    status        = str(summary.get("status", "unknown"))
    total_queries = int(summary.get("dns_queries_today", 0))
    blocked       = int(summary.get("ads_blocked_today", 0))
    pct_blocked   = float(summary.get("ads_percentage_today", 0.0))
    blocklist_sz  = int(summary.get("domains_being_blocked", 0))

    top_blocked, top_permitted = build_top_lists(top_data)
    queries_over_time = build_queries_over_time(over_data)

    payload = {
        "captured_at":          datetime.now(timezone.utc).isoformat(),
        "status":               status,
        "total_queries":        total_queries,
        "queries_blocked":      blocked,
        "percent_blocked":      round(pct_blocked, 3),
        "domains_on_blocklist": blocklist_sz,
        "queries_over_time":    queries_over_time,
        "top_blocked":          top_blocked,
        "top_permitted":        top_permitted,
    }

    print(
        f"  status={status}  total={total_queries:,}  blocked={blocked:,}"
        f"  ({pct_blocked:.1f}%)  blocklist={blocklist_sz:,}"
    )

    # POST to Supabase REST API
    url  = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type":  "application/json",
            "apikey":        SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer":        "return=minimal",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"  Pushed OK (HTTP {resp.status})")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"  ERROR Supabase HTTP {exc.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as exc:
        print(f"  ERROR reaching Supabase: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
