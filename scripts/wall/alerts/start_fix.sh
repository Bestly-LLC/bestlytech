cd /opt/bestly/wall
python3 - <<'PY'
import json
p='/opt/bestly/wall/alerts_over.json'
try:
    d=json.load(open(p)); s=json.dumps(d)
    if 'robbery' in s.lower():
        json.dump({} if isinstance(d,dict) else [], open(p,'w')); print('cleared test entry')
    else: print('no test entry')
except Exception as e: print('alerts_over:', e)
PY
sudo systemctl start bestly-wall-alerts
sleep 15
echo "alerts: $(systemctl is-active bestly-wall-alerts)  enabled: $(systemctl is-enabled bestly-wall-alerts)  wall: $(systemctl is-active bestly-wall)"
journalctl -u bestly-wall-alerts --since "-1 min" --no-pager | grep -iE "traceback|error" | head -3 | cut -c1-200
journalctl -u bestly-wall-alerts --since "-1 min" --no-pager | tail -3 | cut -c1-200
curl -s -m 6 -o /dev/null -w "health %{http_code}\n" localhost:8099/api/health
python3 -c "import json,time;d=json.load(open('heartbeat.json'));print('hb_age',round(time.time()-d['at']),'fps',d.get('fps'),'errs',d.get('errs'))"
