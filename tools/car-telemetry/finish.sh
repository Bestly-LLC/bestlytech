#!/bin/bash
# finish.sh - the last step of Blue Steel live location. Run it ONLY after the public entrance is open:
#
#     sudo tailscale funnel --bg --tcp=8443 tcp://127.0.0.1:8444
#
# (public port 8443 -> the receiver on 127.0.0.1:8444; NOT 8443 locally, that is Pi-hole's admin page).
# What it does, in order, stopping at the first thing that is wrong:
#   1. Confirms the Funnel points at 127.0.0.1:8444 (aborts if it points at 8443) and the old /v1 entrance is untouched.
#   2. Confirms the public side presents OUR certificate (issuer "Bestly Telemetry CA"), reached the way the car will reach it.
#   3. Switches streaming on and queues telemetry_push, then telemetry_check (database function, authorized by the ingest token).
#      It refuses if Tesla's grant lacks the vehicle_location scope (FORCE=1 overrides).
#   4. Waits for both jobs and prints what Tesla said.
# Undo: sudo tailscale funnel --tcp=8443 tcp://127.0.0.1:8444 off ; then ask Claude to queue telemetry_delete.
# Secrets: reads the ingest token from /opt/bestly/telemetry/.env (root 0600). Never prints it.
set -uo pipefail
[ "$(id -u)" = 0 ] || exec sudo -E bash "$0" "$@"
D=/opt/bestly/telemetry
HOST=bestly-pi.taile42611.ts.net
SB=https://rcqfqhguwpmaarseifqg.supabase.co
set -a; . "$D/.env"; set +a
die() { echo "STOP: $*" >&2; exit 1; }
say() { printf '%s  %s\n' "$(date '+%I:%M:%S %p')" "$*"; }

say "1/4 checking the Funnel"
FS=$(tailscale funnel status 2>&1) || die "could not read 'tailscale funnel status'"
echo "$FS" | sed 's/^/      /'
echo "$FS" | grep -Eq '(127\.0\.0\.1|localhost):8443' && die "the Funnel points at local port 8443 (Pi-hole's admin page). Turn it off and use 127.0.0.1:8444."
echo "$FS" | grep -Eq '(127\.0\.0\.1|localhost):8444' || die "no Funnel to 127.0.0.1:8444 yet. Run: sudo tailscale funnel --bg --tcp=8443 tcp://127.0.0.1:8444"
echo "$FS" | grep -q '/v1' || die "the existing /v1 entrance is missing from the Funnel status; not continuing"
DP=$(docker ps --format '{{.Names}} {{.Status}}')
echo "$DP" | grep -q 'car-telemetry-fleet-telemetry-1 Up' || die "the receiver container is not running"

say "2/4 checking what the public side presents"
IP=$(dig +short @1.1.1.1 "$HOST" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)
TARGET="${IP:-$HOST}"
[ -n "$IP" ] && say "      public address $IP (via 1.1.1.1), the path the car uses" || say "      no public lookup available; using the tailnet name instead (weaker check)"
CERT=$(echo | timeout 15 openssl s_client -connect "$TARGET:8443" -servername "$HOST" 2>/dev/null | openssl x509 2>/dev/null)
[ -n "$CERT" ] || die "no certificate came back from $TARGET:8443"
ISS=$(echo "$CERT" | openssl x509 -noout -issuer)
echo "      $ISS"
echo "$ISS" | grep -q 'Bestly Telemetry CA' || die "the certificate is not ours. Something else answers on 8443. Turn the Funnel off."
A=$(echo "$CERT" | openssl x509 -noout -fingerprint -sha256)
B=$(openssl x509 -in "$D/pub/server.crt" -noout -fingerprint -sha256)
[ "$A" = "$B" ] || die "the certificate differs from /opt/bestly/telemetry/pub/server.crt"
say "      ours, fingerprint matches"

say "3/4 switching streaming on and queuing the settings push"
FORCE_JSON=false; [ "${FORCE:-0}" = 1 ] && FORCE_JSON=true
R=$(curl -sS --max-time 20 -X POST "$SB/rest/v1/rpc/car_telemetry_start" -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"p_token\":\"$CAR_TELEMETRY_TOKEN\",\"p_force\":$FORCE_JSON}") || die "could not reach the database"
echo "      $R"
OK=$(echo "$R" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("ok"))' 2>/dev/null)
if [ "$OK" != "True" ]; then
  echo "$R" | grep -q scope_missing && die "Tesla's grant does not include vehicle_location, so Tesla will not send location. Re-authorize the Tesla app with that scope (then re-run), or FORCE=1 to try anyway."
  die "the database did not start it (see line above)"
fi
IDS=$(echo "$R" | python3 -c 'import sys,json; j=json.load(sys.stdin); print("%d,%d" % (j["push_job"], j["check_job"]))')

say "4/4 waiting for the worker (up to 4 min)"
S=""; SUM=""
for i in $(seq 1 48); do
  S=$(curl -sS --max-time 20 -X POST "$SB/rest/v1/rpc/car_telemetry_status" -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
    -d "{\"p_token\":\"$CAR_TELEMETRY_TOKEN\",\"p_ids\":[$IDS]}") || { sleep 5; continue; }
  SUM=$(echo "$S" | python3 -c '
import sys, json
j = json.load(sys.stdin)
jobs = j.get("jobs", [])
print(" | ".join("%s %s%s" % (x["action"], x["status"], (" - " + str(x["error"])) if x.get("error") else "") for x in jobs))
print("ALLDONE" if jobs and all(x["status"] in ("done", "failed") for x in jobs) else "WAIT")' 2>/dev/null)
  [ "$(echo "$SUM" | tail -1)" = ALLDONE ] && break
  sleep 5
done
echo "      $(echo "$SUM" | head -1)"
echo "$S" | python3 -c '
import sys, json
j = json.load(sys.stdin)
print("      enabled:", j.get("enabled"), "| settings expire:", j.get("exp_at"), "| last push:", j.get("last_push_at"))
print("      check:", json.dumps(j.get("check")))' 2>/dev/null
echo "$SUM" | head -1 | grep -q failed && die "a job failed; the line above says why. Streaming is switched on in the database; ask Claude to read the failure."
echo "$SUM" | tail -1 | grep -q ALLDONE || die "the worker has not finished yet; check again in a minute"
say "done. The car picks the settings up the next time it is awake and connected; location arrives when it drives."
