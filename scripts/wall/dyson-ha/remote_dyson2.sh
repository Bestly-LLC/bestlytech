#!/bin/bash
# runs on Hestia. Arg 1 = timestamp. Updates the Dyson block (honest when not connected), fixes the card text,
# then waits up to 6 min for the Dyson's local port, reloads the HA Dyson entry and turns on continuous monitoring.
set -e
TS="$1"; S=/opt/bestly/wall/server.py; W=/opt/bestly/wall/www/wall.html
sudo -n cp "$S" "$S.bak_dysonha2_$TS"; sudo -n cp "$W" "$W.bak_dysoncard_$TS"
cp "$S" /tmp/srv_new.py; python3 /tmp/patch_dyson_ha.py /tmp/srv_new.py /tmp/ha_block.py; python3 -m py_compile /tmp/srv_new.py
cp "$W" /tmp/wall_new.html; python3 /tmp/patch_card_text.py /tmp/wall_new.html
sudo -n cp /tmp/srv_new.py "$S"; sudo -n cp /tmp/wall_new.html "$W"
sudo -n systemctl restart bestly-wall; sleep 3; echo "wall server: $(systemctl is-active bestly-wall)"
set +e
TOK=$(python3 -c '
for l in open("/home/pi/scripts/.env"):
    k,_,v=l.strip().partition("=")
    if k in ("HA_TOKEN","HASS_TOKEN","HA_LONG_TOKEN") and v: print(v.strip().strip("\"").strip("'"'"'")); break')
H="Authorization: Bearer $TOK"
OPEN=0
for i in $(seq 1 24); do
  if timeout 4 bash -c 'echo > /dev/tcp/192.168.1.169/1883' 2>/dev/null; then OPEN=1; break; fi; sleep 15
done
if [ "$OPEN" = 1 ]; then
  echo "Dyson local port: open after $((i*15)) s"
  EID=$(curl -s -m 10 -H "$H" http://127.0.0.1:8123/api/config/config_entries/entry | python3 -c 'import sys,json; print(next((e["entry_id"] for e in json.load(sys.stdin) if e.get("domain")=="dyson_local"),""))')
  curl -s -o /dev/null -w "HA Dyson reload: HTTP %{http_code}\n" -m 30 -X POST -H "$H" http://127.0.0.1:8123/api/config/config_entries/entry/$EID/reload
  sleep 20
  curl -s -o /dev/null -w "continuous monitoring on: HTTP %{http_code}\n" -m 10 -H "$H" -H "Content-Type: application/json" \
    -d '{"entity_id":"switch.pure_cool_series_tp04_tp07_tp09_tp11_pc1_continuous_monitoring"}' http://127.0.0.1:8123/api/services/switch/turn_on
  sleep 70
else
  echo "Dyson local port: still closed after 6 min (power-cycle not done yet, or it's on the wrong Wi-Fi)"
  sleep 5
fi
curl -s -m 8 http://127.0.0.1:8099/api/w5 > /tmp/w5.json
python3 - <<'PY'
import json
d=json.load(open("/tmp/w5.json")); p=(d.get("dev") or {}).get("purifier") or {}
print("found:",p.get("found"),"| error:",p.get("error"))
print("reading:",json.dumps(p.get("reading")))
PY
grep -c "Not answering on Wi-Fi" /opt/bestly/wall/www/wall.html | sed 's/^/card text present: /'
