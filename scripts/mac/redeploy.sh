#!/bin/bash
# redeploy.sh — the Mac mini's "Redeploy production build" job, done right.
#
# The old job cd'd into ~/Developer/bestlytech/site — a folder that never
# existed — so it died at "no such folder" before doing anything, and its
# node command tripped over a loader. This script finds the repo from its own
# path (run it from anywhere), then:
#
#   1. git pull the site repo
#   2. npm run build (sanity — never push a tree that doesn't build)
#   3. live deploy of bestly.tech: incoming commits are already deploying via
#      the Vercel <-> GitHub integration; with nothing new, an empty commit
#      forces a fresh production build. Waits until /version.json shows it.
#   4. force-redeploy studio.bestly.tech (project bestly-review) through the
#      Vercel API, reusing the Vercel CLI's own session and refreshing it
#      when expired. Waits until the deployment is READY and the custom
#      domain serves the rebuilt files, then asks studio_boot whether the
#      live build answers.
#
# Job settings: run with cwd anywhere, timeout_s >= 600.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO" || exit 1

SITE="https://www.bestly.tech"
STUDIO="https://studio.bestly.tech"
TEAM="team_Kwxz5PIgolwApAnbC131PCDd"
STUDIO_PROJECT="prj_LmNf0QMdiQJZQ6pDXJiC3VYHTJtC"   # "bestly-review" (supabase/functions/studio-build)
STUDIO_NAME="bestly-review"
AUTH="$HOME/Library/Application Support/com.vercel.cli/auth.json"
CLIENT_ID="cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp"    # Vercel CLI's public OAuth client
SUPA="https://rcqfqhguwpmaarseifqg.supabase.co"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k"

ok=0; warn=0; err=0
SKIP_SITE=0; SKIP_STUDIO=0
for a in "$@"; do
  case "$a" in
    --studio-only) SKIP_SITE=1 ;;
    --site-only)   SKIP_STUDIO=1 ;;
    *) printf 'unknown flag: %s (try --site-only or --studio-only)\n' "$a" >&2; exit 2 ;;
  esac
done
log()  { printf '\n== %s\n' "$*"; }
pass() { printf '   OK  %s\n' "$*"; ok=$((ok+1)); }
note() { printf '   ..  %s\n' "$*"; }
fail() { printf '   FAIL %s\n' "$*"; err=$((err+1)); }

epoch_iso() { python3 -c "import sys,datetime;print(int(datetime.datetime.fromisoformat(sys.argv[1].replace('Z','+00:00')).timestamp()))" "$1"; }
http_date_epoch() { python3 -c "import sys;from email.utils import parsedate_to_datetime;print(int(parsedate_to_datetime(sys.argv[1]).timestamp()))" "$1" 2>/dev/null || echo 0; }

# ---------------------------------------------------------------- 1. pull
if [ "$SKIP_SITE" -eq 0 ]; then
log "git pull (site)"
BEFORE=$(git rev-parse HEAD)
if ! git pull --ff-only origin main; then fail "git pull"; exit 1; fi
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" = "$AFTER" ]; then note "already at $AFTER"; else note "${BEFORE:0:7}..${AFTER:0:7}"; fi

# ---------------------------------------------------------------- 2. build
log "build (sanity check before anything goes live)"
if [ ! -d node_modules ]; then npm ci --silent || { fail "npm ci"; exit 1; }; fi
if ! npm run build > /tmp/redeploy-build.log 2>&1; then
  tail -20 /tmp/redeploy-build.log; fail "npm run build (see /tmp/redeploy-build.log)"; exit 1;
fi
tail -2 /tmp/redeploy-build.log | sed 's/^/   /'
pass "build"

# ------------------------------------------------- 3. live deploy: bestly.tech
DEPLOY_SINCE=$(date +%s)
if [ "$BEFORE" = "$AFTER" ]; then
  log "no new commits — forcing a production rebuild"
  if git commit --allow-empty -m "redeploy: force production build $(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null \
     && git push origin main; then
    note "pushed an empty commit to trigger Vercel"
  else
    fail "could not push to origin/main"; exit 1;
  fi
else
  log "pulled new commits — Vercel is already building main"
fi

log "waiting for $SITE/version.json to show a fresh build"
COMMIT_EPOCH=$(python3 -c "import subprocess,datetime;s=subprocess.check_output(['git','log','-1','--format=%cI'],cwd='$REPO').decode().strip();print(int(datetime.datetime.fromisoformat(s).timestamp()))")
SINCE=$(( COMMIT_EPOCH < DEPLOY_SINCE ? COMMIT_EPOCH : DEPLOY_SINCE )); SINCE=$((SINCE - 120))
deadline=$(( $(date +%s) + 240 ))
live_build=0
while :; do
  body=$(curl -fsS --max-time 15 "$SITE/version.json?cb=$(date +%s)" 2>/dev/null || true)
  live_build=$(printf '%s' "$body" | python3 -c "
import sys,json,datetime
try:
    v=json.load(sys.stdin).get('build','')
    print(int(datetime.datetime.fromisoformat(v.replace('Z','+00:00')).timestamp()))
except Exception:
    print(0)" 2>/dev/null || echo 0)
  [ "$live_build" -ge "$SINCE" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 10
done
if [ "$live_build" -ge "$SINCE" ]; then
  pass "site live: build $(python3 -c "import datetime,sys;print(datetime.datetime.fromtimestamp(int(sys.argv[1]),datetime.timezone.utc).isoformat())" "$live_build")"
else
  fail "site did not redeploy within 4 min (live stamp $live_build, wanted >= $SINCE)"
fi
fi # SKIP_SITE

# --------------------------------------------------- 4. redeploy: studio
if [ "$SKIP_STUDIO" -eq 0 ]; then
log "studio redeploy (project $STUDIO_NAME)"
STUDIO_MOD_BEFORE=$(curl -sI --max-time 15 "$STUDIO/" | tr -d '\r' | sed -n 's/^[Ll]ast-[Mm]odified: //p')

TOKEN=$(python3 - "$AUTH" "$CLIENT_ID" <<'PYEOF'
import json, os, sys, time, urllib.request, urllib.parse, urllib.error
path, client_id = sys.argv[1], sys.argv[2]
try:
    auth = json.load(open(path))
except Exception as e:
    print(f"no auth file: {e}", file=sys.stderr); sys.exit(1)
if auth.get("expiresAt", 0) <= time.time() + 60 and auth.get("refreshToken"):
    try:
        meta = json.load(urllib.request.urlopen("https://vercel.com/.well-known/openid-configuration", timeout=20))
        req = urllib.request.Request(meta["token_endpoint"], method="POST",
            data=urllib.parse.urlencode({"client_id": client_id, "grant_type": "refresh_token",
                                         "refresh_token": auth["refreshToken"]}).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        r = json.load(urllib.request.urlopen(req, timeout=20))
        auth["token"] = r["access_token"]
        if r.get("refresh_token"): auth["refreshToken"] = r["refresh_token"]
        auth["expiresAt"] = int(time.time()) + int(r.get("expires_in", 3600))
        tmp = path + ".tmp"
        with open(tmp, "w") as f: json.dump(auth, f, indent=2)
        os.chmod(tmp, 0o600); os.replace(tmp, path)
        print("refreshed expired session", file=sys.stderr)
    except urllib.error.HTTPError as e:
        print(f"refresh failed: HTTP {e.code} {e.read().decode()[:160]}", file=sys.stderr); sys.exit(2)
    except Exception as e:
        print(f"refresh failed: {e}", file=sys.stderr); sys.exit(2)
print(auth.get("token", ""))
PYEOF
)
T_RC=$?
if [ $T_RC -ne 0 ] || [ -z "$TOKEN" ]; then
  cat >&2 <<'EOM'
   FAIL the Vercel session is dead (expired token and refresh token).
        Fix once, then this job just works:
          npx vercel login        # open the link it prints, approve
        The CLI keeps its session in
          ~/Library/Application Support/com.vercel.cli/auth.json
        and redeploy.sh refreshes it automatically from then on.
EOM
  exit 1
fi

api() { curl -fsS --max-time 25 -H "Authorization: Bearer $TOKEN" "$@"; }

# newest READY production deployment of the studio project
DEPLOY_JSON=$(api "https://api.vercel.com/v6/deployments?projectId=$STUDIO_PROJECT&target=production&state=READY&limit=5&teamId=$TEAM") \
  || { fail "listing studio deployments"; exit 1; }
SRC_ID=$(printf '%s' "$DEPLOY_JSON" | python3 -c "
import json,sys
ds=json.load(sys.stdin).get('deployments',[])
print(ds[0]['uid'] if ds else '')")
[ -n "$SRC_ID" ] || { fail "no READY production studio deployment found"; exit 1; }
note "redeploying from $SRC_ID"

NEW_JSON=$(api -X POST "https://api.vercel.com/v13/deployments?forceNew=1&teamId=$TEAM" \
  -H "Content-Type: application/json" \
  -d "{\"deploymentId\":\"$SRC_ID\",\"meta\":{\"action\":\"redeploy\"},\"name\":\"$STUDIO_NAME\",\"target\":\"production\"}") \
  || { fail "triggering studio redeploy"; exit 1; }
NEW_ID=$(printf '%s' "$NEW_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
[ -n "$NEW_ID" ] || { fail "redeploy call returned no id: $(printf '%s' "$NEW_JSON" | head -c 200)"; exit 1; }
note "new deployment $NEW_ID"

deadline=$(( $(date +%s) + 240 ))
state=""
while :; do
  state=$(api "https://api.vercel.com/v13/deployments/$NEW_ID?teamId=$TEAM" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('readyState') or d.get('status') or '')" 2>/dev/null || echo "")
  case "$state" in READY|ERROR|CANCELED) break;; esac
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 8
done
if [ "$state" = "READY" ]; then pass "studio deployment READY"
else fail "studio deployment state=$state (wanted READY)"; fi

# the custom domain must now serve the rebuilt files (build.sh re-curls them,
# so last-modified moves even though the bytes are identical)
log "waiting for $STUDIO to serve the new build"
if [ -n "$STUDIO_MOD_BEFORE" ]; then
  BEFORE_EPOCH=$(http_date_epoch "$STUDIO_MOD_BEFORE"); note "was: $STUDIO_MOD_BEFORE"
else
  BEFORE_EPOCH=0
fi
deadline=$(( $(date +%s) + 120 ))
mod_epoch=0
while :; do
  MOD=$(curl -sI --max-time 15 "$STUDIO/?v=$(date +%s)" | tr -d '\r' | sed -n 's/^[Ll]ast-[Mm]odified: //p')
  mod_epoch=$(http_date_epoch "${MOD:-}")
  [ "$mod_epoch" -gt "$BEFORE_EPOCH" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 8
done
if [ "$mod_epoch" -gt "$BEFORE_EPOCH" ]; then
  pass "studio serves the rebuilt files (last-modified $(python3 -c "import datetime,sys;print(datetime.datetime.fromtimestamp(int(sys.argv[1]),datetime.timezone.utc).isoformat())" "$mod_epoch"))"
else
  fail "studio.bestly.tech last-modified did not move (still ${MOD:-unknown})"
fi

# and the live build itself answers through the same door every page load uses
BOOT=$(curl -fsS --max-time 20 -X POST "$SUPA/rest/v1/rpc/studio_boot" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -d '{"p_file":"index.html","p_preview":null}' 2>/dev/null || true)
if printf '%s' "$BOOT" | grep -q '"ok": *true'; then pass "studio_boot: live build answers"
else warn=$((warn+1)); note "studio_boot response: ${BOOT:0:200}"; fi
fi # SKIP_STUDIO

# ------------------------------------------------------------------ summary
log "summary: $ok ok, $warn warnings, $err failed"
[ "$err" -eq 0 ]
