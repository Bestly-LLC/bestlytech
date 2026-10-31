#!/usr/bin/env python3
"""freshgate.py - the weekly-fresh-design gate (stdlib only). Fails CLOSED.

  require(spec)            called by render.py before any work: a Centering YOU render must carry this week's fresh
                           corner graphic and name card (spec['design']), or it stops and Scout alerts
  mark_used(spec, code)    records which video carried the designs (studio_design_use)
  alert(...)               monitor_issues / monitor_events pattern; signed by Scout (key prefix scout.*), never anonymous
Credentials come from the environment or the usual env files (service role key, never printed).
"""
import json, os, sys, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import designs

ENV_FILES = [os.environ.get('FRESH_ENV', ''), '/home/pi/scripts/.env', '/home/pi/.config/bestly-cron.env',
             os.path.expanduser('~/.bestly/fresh.env'), os.path.expanduser('~/.bestly/.env')]
def _env():
    e = {}
    for p in ENV_FILES:
        if not p: continue
        try:
            for ln in open(p):
                ln = ln.strip()
                if ln.startswith('export '): ln = ln[7:]
                if not ln or ln.startswith('#') or '=' not in ln: continue
                k, v = ln.split('=', 1); e.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except OSError: pass
    for k in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'):
        if os.environ.get(k): e[k] = os.environ[k]
    return e
ENV = _env()
URL = ENV.get('SUPABASE_URL', '').rstrip('/'); KEY = ENV.get('SUPABASE_SERVICE_ROLE_KEY') or ENV.get('SUPABASE_SECRET_KEY', '')

class GateError(SystemExit):
    pass

def _req(method, path, body=None, timeout=25):
    if not URL or not KEY: raise RuntimeError('Supabase credentials not found (SUPABASE_URL / service key)')
    h = {'apikey': KEY, 'Content-Type': 'application/json'}
    if KEY.startswith('eyJ'): h['Authorization'] = 'Bearer ' + KEY
    r = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as x:
            raw = x.read().decode(); return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{method} {path.split("?")[0]} -> HTTP {e.code}: {e.read().decode()[:300]}')

def rpc(name, **a): return _req('POST', f'/rest/v1/rpc/{name}', a)
def get(table, q): return _req('GET', f'/rest/v1/{table}?{q}')

def alert(key, title, body, problem=True, dry=False, severity='warning', needs=None, healed=False):
    """signed by the responsible employee: keys under scout.* belong to Scout (notification_owners)"""
    if dry:
        _req('POST', '/rest/v1/monitor_events', {'key': key + '.selftest', 'kind': 'problem' if problem else 'resolved', 'severity': severity,
                                                  'title': '[dry run] ' + title, 'body': body, 'pushed': False})
        return {'dry': True}
    return rpc('bestly_raise', p_key=key, p_kind='problem' if problem else 'resolved', p_severity=severity, p_title=title, p_body=body,
               p_area='studio', p_needs_jared=needs, p_healed=healed)

def gate_check(client, week, corner_fp, tag_fp):
    return rpc('studio_design_gate', p_client=client, p_week=week, p_corner_fp=corner_fp, p_tag_fp=tag_fp)

def require(spec, dry_alert=None):
    """returns the design block after verifying it; raises GateError (a SystemExit) with the reason otherwise"""
    d = spec.get('design')
    client = (d or {}).get('client', 'centering-you')
    if dry_alert is None: dry_alert = os.environ.get('FRESH_DRY_ALERT') == '1'   # tests log to monitor_events only, no phone push
    def stop(why):
        msg = f'Weekly {client} render stopped: {why}'
        try: alert('scout.cy-fresh-render', 'Weekly Centering YOU render stopped: design not fresh', why + ' (the render failed closed; nothing was cut)',
                   dry=dry_alert, needs='Open the preview sheet, or run cy_fresh make on the Pi')
        except Exception as e: msg += f' (alert not sent: {e})'
        raise GateError(msg)
    if not d or not d.get('corner') or not d.get('tag'): stop('the spec has no fresh design block (design.corner / design.tag); a weekly render may not fall back to an old design')
    for comp, key in (('corner_graphic', 'corner'), ('name_tag', 'tag')):
        p = d[key]['params']; fp = designs.fingerprint(comp, p)
        if fp != d[key].get('fingerprint'): stop(f'{key} parameters do not match their fingerprint (edited after the gate?)')
    try: g = gate_check(client, d.get('week'), d['corner']['fingerprint'], d['tag']['fingerprint'])
    except Exception as e: stop(f'could not reach the design ledger ({e}); failing closed')
    if not g.get('ok'): stop('; '.join(g.get('problems') or ['gate said no']))
    return d

def mark_used(spec, item_code):
    d = spec['design']
    return rpc('studio_design_use', p_client=d.get('client', 'centering-you'), p_week=d['week'], p_corner_fp=d['corner']['fingerprint'],
               p_tag_fp=d['tag']['fingerprint'], p_item_code=item_code)
