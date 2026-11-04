import os, json, time, re, threading, sys, types
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
src = open('/opt/bestly/wall/server.py').read()
a = src.index('# ---------- BRIEF_20261103')
b = src.index('# ---------- W4 round 4: Do Not Disturb')
ROOT = '/tmp/brieftest'; os.makedirs(ROOT, exist_ok=True)
for f in os.listdir(ROOT): os.remove(os.path.join(ROOT, f))
state = {"alarm": None, "briefDismiss": None}
HELI_T = re.compile(r"^(AS50|EC\d\d|H1\d\d|R22|R44|R66)")
PRES = {"where": "home"}
ALARM_ACT = {"last": None}
G = dict(globals())
fake = {"t": datetime(2026, 11, 4, 1, 0, tzinfo=ZoneInfo("America/Los_Angeles"))}
G['_ha_entity'] = lambda e: {"state": "off", "last_changed": "2026-11-04T01:00:00+00:00"}
rp = []
G['rpc'] = lambda fn, args, timeout=10: {"at": "x", "fixed": 3, "needs": 1, "top": "T", "turo": []}
G['_w2_report'] = lambda *a, **k: True
exec(src[a:b], G)
G['_brief_now'] = lambda: fake["t"]
# fake aircraft_enrich
ae = types.ModuleType('aircraft_enrich'); fl = {"f": "west"}
ae.sky_board = lambda: {"airports": {"LAX": {"flow": fl["f"]}}}
sys.modules['aircraft_enrich'] = ae
note = G['_brief_sky_note']
out = [{"hex": "a1", "alt": 1500, "dst": 5, "t": "B738"}, {"hex": "a2", "alt": 3000, "dst": 5, "t": "B738"},
       {"hex": "h1", "alt": 900, "dst": 3, "t": "EC35", "cat": "A7"}, {"hex": "a3", "alt": 800, "dst": 30, "t": "A320"}, {"hex": "a1", "alt": 1400, "dst": 6}]
note(out); note(out)
rec = G['BRIEF_SKY']['nights']['2026-11-03']
assert rec['planes'] == ['a1'] and rec['helis'] == ['h1'], rec
# flow flip needs 3 consecutive reads
for i, f in enumerate(['west', 'west', 'east', 'east', 'east']):
    fl['f'] = f; G['BRIEF_SKY']['chk'] = 0; G['_brief_flow_tick'](fake["t"] + timedelta(minutes=5 * i if False else 0))
assert rec['flips'] and rec['flips'][0]['to'] == 'east', rec
print('sky ok', rec)
G['BRIEF_SKY']['saved'] = 0; G['_brief_save_sky'](True)
print(open(ROOT + '/brief_sky.json').read()[:200])
# morning tick: 6:55 AM, no trigger (motion before 5 AM), then alarm stop
fake["t"] = datetime(2026, 11, 4, 6, 55, tzinfo=ZoneInfo("America/Los_Angeles"))
G['_brief_tick'](); assert G['BRIEF_ST']['start'] is None, G['BRIEF_ST']
fake["t"] = datetime.now(ZoneInfo("America/Los_Angeles")).replace(hour=7, minute=0)
today = fake["t"].strftime("%Y-%m-%d")
G['BRIEF_ST']['day'] = today
state["alarm"] = {"on": True, "stop": int(fake["t"].timestamp() * 1000) - 5000}
G['_brief_tick'](); st = G['BRIEF_ST']
assert st['start'] and st['src'] == 'alarm' and st['data'], st
G['BRIEF_SKY']['nights'][(fake['t']-timedelta(days=1)).strftime('%Y-%m-%d')] = rec
p = G['brief_payload'](); assert p['sky']['planes'] == 1 and p['digest']['fixed'] == 3, p
print('payload', {k: p[k] for k in ('show', 'src', 'dismissed', 'home')})
state["briefDismiss"] = int(fake["t"].timestamp() * 1000); assert G['brief_payload']()['dismissed'] and not G['brief_payload']()['show']
state["briefDismiss"] = int(fake["t"].timestamp() * 1000) - 86400000; assert not G['brief_payload']()['dismissed']
fake["t"] = fake["t"].replace(hour=12, minute=1); assert not G['brief_payload']()['show']
print('ALL OK')
