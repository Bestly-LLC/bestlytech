import sys, time, shutil, subprocess
P = '/opt/bestly/wall/server.py'
s = open(P).read()
blk = open('/tmp/server_block.py').read()
assert 'BRIEF_20261103' not in s
for nm in ('brief_loop', 'brief_payload', '_brief_tick', 'BRIEF_ST', 'BRIEF_FILE', 'BRIEF_SKY'):
    assert nm not in s, nm
bak = P + '.bak_brief_' + time.strftime('%H%M%S')
shutil.copy2(P, bak)
print('backup', bak)

def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:70])
    s = s.replace(old, new)

# A default state key
rep('DEFAULT_STATE.update({"skyBuses": True})',
    'DEFAULT_STATE.update({"briefDismiss": None})   # BRIEF_20261103: ms timestamp = morning brief dismissed from the admin app (hidden until the next morning)\nDEFAULT_STATE.update({"skyBuses": True})')
# B sanitizer
rep('            if k == "calNums" and not isinstance(v, bool):   # TAGBULB_20261103\n',
    '            if k == "briefDismiss" and not (v is None or (isinstance(v, (int, float)) and not isinstance(v, bool))):   # BRIEF_20261103\n                continue\n'
    '            if k == "calNums" and not isinstance(v, bool):   # TAGBULB_20261103\n')
# C air loop hook
rep('            out.sort(key=lambda x: x.get("dst") or 99)\n            try:                                                   # FLIGHTV2_P2: label ladder',
    '            out.sort(key=lambda x: x.get("dst") or 99)\n            try:\n                _brief_sky_note(out)                               # BRIEF_20261103: overnight low-plane / helicopter log\n            except Exception:\n                pass\n            try:                                                   # FLIGHTV2_P2: label ladder')
# D block before the DND section
rep('# ---------- W4 round 4: Do Not Disturb + the live sky for bestly.tech/admin/sky ----------', blk + '# ---------- W4 round 4: Do Not Disturb + the live sky for bestly.tech/admin/sky ----------')
# E endpoint
rep('        if p == "/api/data":\n            d = dict(data_cache)',
    '        if p == "/api/brief":                                         # BRIEF_20261103\n            try:\n                return self.send(200, json.dumps(brief_payload()))\n            except Exception as _e:\n                return self.send(200, json.dumps({"show": False, "err": str(_e)[:100]}))\n        if p == "/api/data":\n            d = dict(data_cache)')
# F thread
rep('    threading.Thread(target=air_loop, daemon=True).start()\n',
    '    threading.Thread(target=air_loop, daemon=True).start()\n    threading.Thread(target=brief_loop, daemon=True).start()   # BRIEF_20261103\n')
try:
    compile(s, P, 'exec'); rc = 0
except Exception as e:
    print('COMPILE ERR', e); rc = 1
print('compile rc', rc)
if not rc: open(P, 'w').write(s)
if rc:
    shutil.copy2(bak, P); print('RESTORED'); sys.exit(1)
