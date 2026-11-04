sudo -n systemctl stop bestly-wall-alerts
cd /opt/bestly/wall
python3 - <<'EOF'
import json,time,urllib.request
d=json.load(urllib.request.urlopen("http://127.0.0.1:8099/api/aircraft/live"))["aircraft"]
hs=[r for r in d if r.get("helicopter") and set(r.get("notable") or [])&{"police","news","fire","medical"} and (r.get("live") or {}).get("lat") is not None]
print([(r["hex"],r["label"],r["live"]["dist_mi"]) for r in hs])
out={}
for r in hs[:3]:
    out[r["hex"]]={"line":"reported robbery · %.1f mi"%r["live"]["dist_mi"],"d":r["live"]["dist_mi"],"at":time.time()+3000}
json.dump(out,open("alerts_over.json","w"))
print(out)
EOF
