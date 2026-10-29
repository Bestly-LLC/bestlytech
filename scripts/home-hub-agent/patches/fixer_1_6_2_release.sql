do $$
declare
  v_src text; v_new text; v_def text := E'def do_homeassistant(cfg, action, payload):\n';
  v_disp text := E'    if action in AUTOMATOR_ACTIONS:\n        return do_ha_automator(ha, action, payload)\n';
  v_block text := $blk$# Automation Fixer (agent 1.6.2): see docs/ha-fixer-opusplan.md
import datetime as _fxdt
import socket as _fxsock
import struct as _fxstruct
import base64 as _fxb64
import urllib.parse as _fxparse
FIXER_ACTIONS = {'inventory', 'evidence', 'item_edit', 'package_patch', 'package_restore'}
FX_ID_RE = re.compile('^[A-Za-z0-9_\\-]{1,80}$')
FX_PKG_RE = re.compile('^[A-Za-z0-9][A-Za-z0-9_\\-/]{1,95}$')
FX_BAK_RE = re.compile('^[A-Za-z0-9][A-Za-z0-9_\\-]{0,95}\\.\\d{8}-\\d{6}(?:-\\d+)?\\.bak$')
FX_ENT_RE = re.compile('^[a-z_]+\\.[a-z0-9_]+$')
FX_DOMAINS = ('automation', 'script', 'scene')
FX_RELOAD = {'automation', 'script', 'scene', 'template', 'input_boolean', 'input_number', 'input_select', 'input_text', 'input_datetime', 'input_button', 'timer', 'counter', 'schedule', 'group'}
FX_BACKUP_DIR = os.path.join(HA_DIR, 'bestly_backups')
FX_MAX_FILE = 200000
FX_MAX_RESULT = 420000

def _fx_sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def _fx_chash(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest()[:16]

def _fx_ts(s):
    try:
        return _fxdt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None

def _fx_iso(d):
    return d.astimezone(_fxdt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')

def _fx_q(s):
    return _fxparse.quote(s, safe='')

def _fx_count(text, token):
    return text.lower().count(token)

def _fx_deny_new(old_text, new_text):
    """New text may not ADD a forbidden thing (shell commands, secrets, restarts). What is already there stays as it is."""
    for d in AUTO_DENY:
        if _fx_count(new_text, d) > _fx_count(old_text, d):
            raise RuntimeError(f"Refused: '{d}' is not allowed in a fix.")

def _fx_backup(kind, name, text):
    os.makedirs(os.path.join(FX_BACKUP_DIR, kind), exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    base = re.sub('[^A-Za-z0-9_\\-]', '_', name)[:90]
    n = 0
    while True:
        fn = f"{base}.{stamp}{('-' + str(n) if n else '')}.bak"
        path = os.path.join(FX_BACKUP_DIR, kind, fn)
        if not os.path.exists(path):
            break
        n += 1
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)
    return fn

def _fx_blank(s):
    t = s.strip()
    return not t or t.startswith('#')

def _fx_indent(s):
    return len(s) - len(s.lstrip(' '))

def _fx_value(s):
    v = s.split(':', 1)[1].strip() if ':' in s else ''
    v = re.sub('\\s+#.*$', '', v).strip()
    if len(v) >= 2 and v[0] == v[-1] and (v[0] in '\'"'):
        v = v[1:-1]
    return v

def _fx_key_in_block(lines, ind, key):
    for t, ln in enumerate(lines):
        if t == 0:
            rest = ln[ind:]
            if not rest.startswith('-'):
                continue
            rest = rest[1:].lstrip(' ')
        else:
            if _fx_indent(ln) != ind + 2:
                continue
            rest = ln.strip()
        if rest.startswith(key + ':'):
            return _fx_value(rest)
    return None

def _fx_layout(text):
    lines = text.split('\n')
    n = len(lines)
    tops = []
    for i, s in enumerate(lines):
        if _fx_blank(s) or s[0] in ' \t-':
            continue
        m = re.match('^([A-Za-z_][A-Za-z0-9_]*)(?: [A-Za-z0-9_ ]+)?\\s*:', s)
        if m:
            tops.append((m.group(1), i))
    sections = []
    for k, (key, st) in enumerate(tops):
        en = tops[k + 1][1] if k + 1 < len(tops) else n
        while en - 1 > st and _fx_blank(lines[en - 1]):
            en -= 1
        sections.append({'key': key, 'start': st, 'end': en})
    items = []
    for sec in sections:
        st, en = (sec['start'], sec['end'])
        if sec['key'] == 'automation':
            ind, starts = (None, [])
            for i in range(st + 1, en):
                s = lines[i]
                if _fx_blank(s):
                    continue
                m = re.match('^(\\s*)-(\\s|$)', s)
                if m and (ind is None or len(m.group(1)) == ind):
                    ind = len(m.group(1))
                    starts.append(i)
            for j, a in enumerate(starts):
                b = starts[j + 1] if j + 1 < len(starts) else en
                while b - 1 > a and _fx_blank(lines[b - 1]):
                    b -= 1
                blk = lines[a:b]
                items.append({'section': 'automation', 'start': a, 'end': b, 'id': _fx_key_in_block(blk, ind, 'id'), 'alias': _fx_key_in_block(blk, ind, 'alias')})
        elif sec['key'] == 'script':
            ind, starts = (None, [])
            for i in range(st + 1, en):
                s = lines[i]
                if _fx_blank(s):
                    continue
                if ind is None:
                    ind = _fx_indent(s)
                m = re.match('^(\\s*)([A-Za-z0-9_]+)\\s*:', s)
                if m and len(m.group(1)) == ind:
                    starts.append((i, m.group(2)))
            for j, (a, nm) in enumerate(starts):
                b = starts[j + 1][0] if j + 1 < len(starts) else en
                while b - 1 > a and _fx_blank(lines[b - 1]):
                    b -= 1
                items.append({'section': 'script', 'start': a, 'end': b, 'id': nm, 'alias': nm})
    return {'lines': lines, 'sections': sections, 'items': items}

def _fx_files():
    """{name: {text, sha, size, mtime, layout}} for every package file (top level and sub-folders)."""
    out = {}
    base = os.path.realpath(AUTO_PKG_DIR)
    if not os.path.isdir(base):
        return out
    for root, _dirs, files in os.walk(base):
        for fn in sorted(files):
            if not fn.endswith(('.yaml', '.yml')):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, base)
            name = re.sub('\\.(yaml|yml)$', '', rel).replace(os.sep, '/')
            try:
                st = os.stat(full)
                if st.st_size > FX_MAX_FILE:
                    out[name] = {'text': None, 'sha': None, 'size': st.st_size, 'mtime': st.st_mtime, 'layout': None, 'path': full}
                    continue
                text = open(full, encoding='utf-8').read()
            except (OSError, UnicodeDecodeError):
                continue
            out[name] = {'text': text, 'sha': _fx_sha(text), 'size': st.st_size, 'mtime': st.st_mtime, 'layout': _fx_layout(text), 'path': full}
    return out

def _fx_pkg_path(name):
    if not FX_PKG_RE.match(name or '') or '..' in name:
        raise RuntimeError('That is not a package name Tinker will touch.')
    base = os.path.realpath(AUTO_PKG_DIR)
    for ext in ('.yaml', '.yml'):
        full = os.path.realpath(os.path.join(base, name + ext))
        if full.startswith(base + os.sep) and os.path.isfile(full):
            return full
    raise RuntimeError('That package file does not exist.')

def _fx_block(f, item):
    return '\n'.join(f['layout']['lines'][item['start']:item['end']])

def _fx_trim_cfg(cfg, cap):
    keep = {k: cfg[k] for k in ('alias', 'mode', 'trigger', 'triggers', 'condition', 'conditions', 'action', 'actions', 'sequence', 'variables') if k in cfg}
    s = json.dumps(keep, ensure_ascii=False)
    if len(s) <= cap:
        return keep
    return {'truncated': True, 'text': s[:cap]}

def _fx_find_item(files, domain, obj_id, alias):
    """Which package file defines this automation / script?"""
    for name, f in files.items():
        if not f.get('layout'):
            continue
        for it in f['layout']['items']:
            if it['section'] != domain:
                continue
            if obj_id and it['id'] == obj_id:
                return (name, it)
            if domain == 'automation' and alias and it['alias'] and (it['alias'].strip().lower() == alias.strip().lower()):
                return (name, it)
    return (None, None)

def _fx_config_get(ha, domain, cid):
    if not cid or not FX_ID_RE.match(str(cid)):
        return None
    st, body = _ha_req(ha, f'/api/config/{domain}/config/{cid}')
    return body if st == 200 and isinstance(body, dict) and ('message' not in body) else None

def _fx_list_states(ha):
    st, states = _ha_req(ha, '/api/states', timeout=40)
    return states if isinstance(states, list) else []

def _fx_fit(out, limit=FX_MAX_RESULT):
    """Drop the heaviest, least useful parts until the result fits what the server accepts."""

    def size():
        return len(json.dumps(out, ensure_ascii=False))
    for key in ('package_files', 'traces', 'history', 'logbook'):
        if size() <= limit:
            break
        if isinstance(out.get(key), dict) and out[key]:
            out.setdefault('notes', []).append(f'Left out {key} to keep the answer small.')
            out[key] = {}
        elif isinstance(out.get(key), list) and out[key]:
            out.setdefault('notes', []).append(f'Left out {key} to keep the answer small.')
            out[key] = out[key][:max(0, len(out[key]) // 4)]
    return out

def _fx_inventory(ha, p):
    states = _fx_list_states(ha)
    files = _fx_files()
    cap = 1800
    autos, scripts = ([], [])
    for s in states:
        eid = s.get('entity_id', '')
        a = s.get('attributes') or {}
        dom = eid.split('.')[0]
        if dom not in ('automation', 'script'):
            continue
        name = str(a.get('friendly_name') or eid)
        obj = eid.split('.', 1)[1]
        cid = a.get('id') if dom == 'automation' else obj
        row = {'entity_id': eid, 'name': name[:90], 'state': s.get('state'), 'last_triggered': a.get('last_triggered'), 'id': str(cid) if cid else None, 'mode': a.get('mode'), 'running': a.get('current'), 'where': 'unknown', 'file': None}
        cfg = _fx_config_get(ha, dom, row['id']) if row['id'] else None
        if cfg is not None:
            row['where'] = 'ui'
            row['_cfg'] = cfg
        else:
            fname, it = _fx_find_item(files, dom, row['id'] if dom == 'script' else row['id'], name)
            if fname:
                row['where'] = 'package'
                row['file'] = fname
                row['_block'] = _fx_block(files[fname], it)
        (autos if dom == 'automation' else scripts).append(row)
    pk = [{'name': n, 'size': f['size'], 'sha': (f['sha'] or '')[:16], 'mtime': int(f['mtime']), 'keys': [x['key'] for x in (f['layout'] or {'sections': []})['sections']]} for n, f in sorted(files.items())]
    out = {'automations': [], 'scripts': [], 'packages': pk, 'taken_at': _fx_iso(_fxdt.datetime.now(_fxdt.timezone.utc))}
    while True:
        for key, rows in (('automations', autos), ('scripts', scripts)):
            built = []
            for r in rows:
                b = {k: v for k, v in r.items() if k not in ('_cfg', '_block')}
                if '_cfg' in r:
                    b['cfg'] = _fx_trim_cfg(r['_cfg'], cap)
                if '_block' in r:
                    b['block'] = r['_block'][:cap]
                built.append(b)
            out[key] = built
        if len(json.dumps(out, ensure_ascii=False)) <= FX_MAX_RESULT or cap < 300:
            break
        cap //= 2
    out['message'] = f'{len(autos)} automations, {len(scripts)} scripts, {len(pk)} package files.'
    return out

class _FxWS:

    def __init__(self, ha, timeout=20):
        u = _fxparse.urlparse(ha['base'])
        host = u.hostname
        port = u.port or (443 if u.scheme == 'https' else 80)
        sock = _fxsock.create_connection((host, port), timeout=timeout)
        if u.scheme == 'https':
            sock = CTX.wrap_socket(sock, server_hostname=host)
        self.s = sock
        self.buf = b''
        key = _fxb64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f'GET /api/websocket HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        while b'\r\n\r\n' not in self.buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise RuntimeError('WebSocket closed during handshake')
            self.buf += chunk
        head, self.buf = self.buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0] + b' ':
            raise RuntimeError('WebSocket handshake refused')
        self.n = 0
        first = self.recv()
        if first.get('type') != 'auth_required':
            raise RuntimeError('Unexpected WebSocket greeting')
        self.send({'type': 'auth', 'access_token': ha['token']})
        if self.recv().get('type') != 'auth_ok':
            raise RuntimeError('WebSocket login refused')

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise EOFError('WebSocket closed')
            self.buf += chunk
        out, self.buf = (self.buf[:n], self.buf[n:])
        return out

    def send(self, obj, op=1):
        data = json.dumps(obj).encode() if not isinstance(obj, bytes) else obj
        hdr = bytearray([128 | op])
        ln = len(data)
        if ln < 126:
            hdr.append(128 | ln)
        elif ln < 65536:
            hdr.append(128 | 126)
            hdr += _fxstruct.pack('>H', ln)
        else:
            hdr.append(128 | 127)
            hdr += _fxstruct.pack('>Q', ln)
        mask = os.urandom(4)
        hdr += mask
        self.s.sendall(bytes(hdr) + bytes((b ^ mask[i % 4] for i, b in enumerate(data))))

    def recv(self):
        msg = b''
        while True:
            b1, b2 = self._read(2)
            fin, op, ln = (b1 & 128, b1 & 15, b2 & 127)
            if ln == 126:
                ln = _fxstruct.unpack('>H', self._read(2))[0]
            elif ln == 127:
                ln = _fxstruct.unpack('>Q', self._read(8))[0]
            payload = self._read(ln)
            if op == 8:
                raise EOFError('WebSocket closed')
            if op == 9:
                self.send(payload, op=10)
                continue
            if op in (0, 1):
                msg += payload
                if fin:
                    return json.loads(msg.decode('utf-8', 'replace'))

    def call(self, payload):
        self.n += 1
        mid = self.n
        self.send(dict(payload, id=mid))
        while True:
            m = self.recv()
            if m.get('id') == mid and m.get('type') == 'result':
                if not m.get('success'):
                    raise RuntimeError(str((m.get('error') or {}).get('message') or 'Home Assistant said no'))
                return m.get('result')

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass

def _fx_short(v, n=220):
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n - 1] + '~'

def _fx_trace_summary(detail):
    """What a run did, in a few lines: why it started, which conditions held, which services it called with what data."""
    steps = []
    tr = (detail or {}).get('trace') or {}
    for path in sorted(tr.keys(), key=lambda k: (k.split('/')[0] != 'trigger', k)):
        for ent in tr[path][:1]:
            line = {'path': path}
            if ent.get('result') is not None:
                res = ent['result']
                if isinstance(res, dict) and ('params' in res or 'result' in res):
                    pr = res.get('params') or {}
                    line['do'] = _fx_short({k: pr.get(k) for k in ('domain', 'service', 'service_data', 'target') if pr.get(k)}, 400)
                    if 'result' in res:
                        line['result'] = _fx_short(res.get('result'), 80)
                else:
                    line['result'] = _fx_short(res, 160)
            cv = ent.get('changed_variables') or {}
            trg = cv.get('trigger') or {}
            if path.startswith('trigger/') and trg:
                line['why'] = _fx_short(trg.get('description') or trg.get('platform') or trg, 200)
            if ent.get('error'):
                line['error'] = _fx_short(ent['error'], 160)
            steps.append(line)
    return steps[:24]

def _fx_traces(ha, items, start, end):
    """items: [(domain, item_id, entity_id)]. Best effort; never raises."""
    out, note = ([], None)
    try:
        ws = _FxWS(ha)
    except Exception as exc:
        return ([], f'Run traces were not available ({type(exc).__name__}).')
    try:
        for dom, iid, eid in items[:10]:
            try:
                runs = ws.call({'type': 'trace/list', 'domain': dom, 'item_id': iid}) or []
            except Exception as exc:
                note = f'Some run traces were not available ({_fx_short(str(exc), 80)}).'
                continue
            keep = []
            for r in runs:
                t0 = _fx_ts((r.get('timestamp') or {}).get('start'))
                if t0 and start - _fxdt.timedelta(minutes=10) <= t0 <= end + _fxdt.timedelta(minutes=10):
                    keep.append(r)
            keep.sort(key=lambda r: (r.get('timestamp') or {}).get('start') or '')
            for r in keep[-3:]:
                row = {'entity_id': eid, 'item_id': iid, 'run_id': r.get('run_id'), 'started': (r.get('timestamp') or {}).get('start'), 'finished': (r.get('timestamp') or {}).get('finish'), 'state': r.get('state'), 'why': _fx_short(r.get('trigger') or '', 200), 'error': r.get('error'), 'last_step': r.get('last_step')}
                try:
                    row['steps'] = _fx_trace_summary(ws.call({'type': 'trace/get', 'domain': dom, 'item_id': iid, 'run_id': r.get('run_id')}))
                except Exception as exc:
                    row['steps_error'] = _fx_short(str(exc), 100)
                out.append(row)
    finally:
        ws.close()
    return (out, note)

def _fx_pct(v):
    try:
        return int(round(float(v) / 255.0 * 100))
    except Exception:
        return None

def _fx_series(rows):
    """[time, state, brightness %, kelvin, position/percentage], dropping repeats."""
    out, last = ([], None)
    for r in rows:
        a = r.get('attributes') or {}
        pt = [r.get('last_changed') or r.get('last_updated'), r.get('state'), _fx_pct(a.get('brightness')) if a.get('brightness') is not None else None, a.get('color_temp_kelvin'), a.get('current_position', a.get('percentage'))]
        sig = pt[1:]
        if sig == last:
            continue
        last = sig
        out.append(pt)
    return out[:160]

def _fx_ref_re(token):
    return re.compile('(?<![A-Za-z0-9_.])' + re.escape(token) + '(?![A-Za-z0-9_.])')

def _fx_evidence(ha, p):
    ents = [e for e in p.get('entity_ids') or [] if isinstance(e, str) and FX_ENT_RE.match(e)][:12]
    start, end = (_fx_ts(p.get('start')), _fx_ts(p.get('end')))
    if not start or not end or end <= start:
        raise RuntimeError('evidence needs a start and an end time.')
    now = _fxdt.datetime.now(_fxdt.timezone.utc)
    if end > now + _fxdt.timedelta(minutes=5):
        end = now
    if end - start > _fxdt.timedelta(hours=48):
        start = end - _fxdt.timedelta(hours=48)
    focus = p.get('focus') if isinstance(p.get('focus'), str) and FX_ENT_RE.match(p.get('focus')) else None
    out = {'window': {'start': _fx_iso(start), 'end': _fx_iso(end)}, 'entities': {}, 'notes': []}
    states = _fx_list_states(ha)
    by_id = {s.get('entity_id'): s for s in states}
    for e in ents:
        s = by_id.get(e)
        if s:
            a = s.get('attributes') or {}
            out['entities'][e] = {'name': a.get('friendly_name'), 'state': s.get('state'), 'brightness_pct': _fx_pct(a.get('brightness')) if a.get('brightness') is not None else None, 'last_changed': s.get('last_changed')}
        else:
            out['entities'][e] = {'missing': True}
    tokens = set(ents)
    if ents:
        tpl = '{% set r = namespace(o=[]) %}{% for e in ' + json.dumps(ents) + ' %}{% set r.o = r.o + [[e, area_id(e), device_id(e), area_name(e)]] %}{% endfor %}{{ r.o | tojson }}'
        _, rows = _ha_req(ha, '/api/template', 'POST', {'template': tpl}, timeout=40)
        for row in rows if isinstance(rows, list) else []:
            if isinstance(row, list) and len(row) == 4:
                if row[1]:
                    tokens.add(row[1])
                if row[2]:
                    tokens.add(row[2])
                if row[0] in out['entities']:
                    out['entities'][row[0]]['area'] = row[3]
    related = {}
    for s in states:
        eid = s.get('entity_id', '')
        if eid in tokens or eid.split('.')[0] in ('automation', 'script', 'scene', 'sensor', 'binary_sensor', 'person', 'device_tracker', 'sun', 'weather'):
            continue
        blob = json.dumps(s.get('attributes') or {}, ensure_ascii=False)
        hit = [e for e in ents if e in blob]
        if hit:
            a = s.get('attributes') or {}
            related[eid] = {'name': a.get('friendly_name'), 'state': s.get('state'), 'lists': hit[:6], 'attrs': {k: a[k] for k in list(a.keys())[:14] if k not in ('entity_id', 'friendly_name') and len(json.dumps(a[k], default=str)) < 120}}
        if len(related) >= 20:
            break
    out['related'] = related
    tokens |= set(related.keys())
    rows = []
    try:
        st, lb = _ha_req(ha, f'/api/logbook/{_fx_q(_fx_iso(start))}?end_time={_fx_q(_fx_iso(end))}', timeout=60)
        if st == 200 and isinstance(lb, list):
            for r in lb:
                eid = r.get('entity_id') or ''
                dom = eid.split('.')[0]
                if eid in tokens or dom in ('automation', 'script', 'scene'):
                    rows.append({k: r.get(k) for k in ('when', 'name', 'message', 'entity_id', 'state', 'context_event_type', 'context_domain', 'context_service', 'context_entity_id', 'context_entity_id_name', 'context_name', 'context_user_id', 'source') if r.get(k) not in (None, '')})
            rows = rows[-300:]
        else:
            out['notes'].append('The logbook could not be read.')
    except Exception as exc:
        out['notes'].append(f'The logbook could not be read ({type(exc).__name__}).')
    out['logbook'] = rows
    hist = {}
    if ents:
        try:
            st, hs = _ha_req(ha, f"/api/history/period/{_fx_q(_fx_iso(start))}?filter_entity_id={_fx_q(','.join(ents))}&end_time={_fx_q(_fx_iso(end))}&significant_changes_only=0", timeout=60)
            if st == 200 and isinstance(hs, list):
                for ser in hs:
                    if ser and isinstance(ser[0], dict):
                        hist[ser[0].get('entity_id')] = _fx_series(ser)
        except Exception as exc:
            out['notes'].append(f'The history could not be read ({type(exc).__name__}).')
    out['history'] = hist
    files = _fx_files()
    refs = []
    pats = {t: _fx_ref_re(t) for t in tokens}

    def consider(kind, ent_id, name, where, file, cid, text, cfg, st_row):
        hits = [t for t, rx in pats.items() if rx.search(text)]
        if not hits:
            return None
        row = {'kind': kind, 'entity_id': ent_id, 'name': name, 'where': where, 'file': file, 'id': cid, 'hits': hits[:10], 'state': (st_row or {}).get('state'), 'last_triggered': ((st_row or {}).get('attributes') or {}).get('last_triggered')}
        if cfg is not None:
            row['cfg'] = cfg
            row['hash'] = _fx_chash(cfg)
        else:
            row['block'] = text
        refs.append(row)
        return row
    seen_ids = set()
    for s in states:
        eid = s.get('entity_id', '')
        dom = eid.split('.')[0]
        if dom not in FX_DOMAINS:
            continue
        a = s.get('attributes') or {}
        name = str(a.get('friendly_name') or eid)
        cid = a.get('id') if dom in ('automation', 'scene') else eid.split('.', 1)[1]
        cid = str(cid) if cid else None
        cfg = _fx_config_get(ha, dom, cid) if cid else None
        if cfg is not None:
            consider(dom, eid, name, 'ui', None, cid, json.dumps(cfg, ensure_ascii=False), cfg, s)
            seen_ids.add((dom, cid))
        else:
            fname, it = _fx_find_item(files, dom, cid, name) if dom in ('automation', 'script') else (None, None)
            if fname:
                consider(dom, eid, name, 'package', fname, cid, _fx_block(files[fname], it), None, s)
                seen_ids.add((dom, cid))
        if len(refs) > 60:
            break
    fired = []
    for s in states:
        eid = s.get('entity_id', '')
        a = s.get('attributes') or {}
        if not eid.startswith(('automation.', 'script.')):
            continue
        lt = _fx_ts(a.get('last_triggered'))
        if lt and start - _fxdt.timedelta(minutes=3) <= lt <= end + _fxdt.timedelta(minutes=3):
            fired.append({'entity_id': eid, 'name': a.get('friendly_name'), 'last_triggered': a.get('last_triggered'), 'state': s.get('state')})
    out['fired_in_window'] = fired[:40]
    fired_ids = {f['entity_id'] for f in fired}
    for r in refs:
        r['fired'] = r['entity_id'] in fired_ids
    called = set()
    for r in refs:
        txt = json.dumps(r.get('cfg'), ensure_ascii=False) if r.get('cfg') is not None else r.get('block') or ''
        for m in re.finditer('(?<![A-Za-z0-9_.])script\\.([a-z0-9_]+)', txt):
            called.add('script.' + m.group(1))
    have = {r['entity_id'] for r in refs}
    for sc in sorted(called - have)[:6]:
        s = by_id.get(sc)
        if not s:
            continue
        a = s.get('attributes') or {}
        obj = sc.split('.', 1)[1]
        cfg = _fx_config_get(ha, 'script', obj)
        name = str(a.get('friendly_name') or sc)
        row = None
        if cfg is not None:
            row = {'kind': 'script', 'entity_id': sc, 'name': name, 'where': 'ui', 'id': obj, 'hits': [], 'cfg': cfg, 'hash': _fx_chash(cfg), 'state': s.get('state'), 'last_triggered': a.get('last_triggered'), 'via': 'called by a matching automation', 'fired': sc in fired_ids}
        else:
            fname, it = _fx_find_item(files, 'script', obj, name)
            if fname:
                row = {'kind': 'script', 'entity_id': sc, 'name': name, 'where': 'package', 'file': fname, 'id': obj, 'hits': [], 'block': _fx_block(files[fname], it), 'state': s.get('state'), 'last_triggered': a.get('last_triggered'), 'via': 'called by a matching automation', 'fired': sc in fired_ids}
        if row:
            refs.append(row)
    refs.sort(key=lambda r: (not r.get('fired'), -len(r.get('hits') or []), r.get('name') or ''))
    refs = refs[:14]
    for r in refs:
        if 'cfg' in r and len(json.dumps(r['cfg'], ensure_ascii=False)) > 7000:
            r['cfg_text'] = json.dumps(r['cfg'], ensure_ascii=False)[:7000]
            r.pop('cfg')
        if 'block' in r:
            r['block'] = r['block'][:7000]
    out['referrers'] = refs
    pf = {}
    for r in refs:
        fn = r.get('file')
        if fn and fn not in pf and files.get(fn) and (files[fn].get('text') is not None) and (len(pf) < 4):
            pf[fn] = {'sha256': files[fn]['sha'], 'text': files[fn]['text'], 'size': files[fn]['size']}
    out['package_files'] = pf
    t_items = []
    for r in refs:
        if r.get('fired') and r['kind'] in ('automation', 'script') and r.get('id'):
            t_items.append((r['kind'], r['id'], r['entity_id']))
    if focus and focus.startswith('automation.') and (focus in by_id):
        fid = (by_id[focus].get('attributes') or {}).get('id')
        if fid and ('automation', str(fid), focus) not in t_items:
            t_items.insert(0, ('automation', str(fid), focus))
    if t_items:
        tr, note = _fx_traces(ha, t_items, start, end)
        out['traces'] = tr
        if note:
            out['notes'].append(note)
    else:
        out['traces'] = []
    out['message'] = f'{len(rows)} logbook rows, {len(refs)} automations / scripts mention these devices, {len(fired)} ran in the window.'
    return _fx_fit(out)

def _fx_item_edit(ha, p):
    dom = str(p.get('domain') or '')
    if dom not in FX_DOMAINS:
        raise RuntimeError('item_edit works on automations, scripts and scenes.')
    cid = str(p.get('id') or '')
    if not FX_ID_RE.match(cid):
        raise RuntimeError('That id is not valid.')
    prev = _fx_config_get(ha, dom, cid)
    if prev is None:
        raise RuntimeError("Home Assistant's editor does not hold that one (it may live in a file), so Tinker did not touch it.")
    eh = p.get('expect_hash')
    if eh and _fx_chash(prev) != str(eh) and (not p.get('force')):
        raise RuntimeError('It was changed in Home Assistant after Tinker looked at it, so nothing was changed.')
    cfg = p.get('config')
    if not isinstance(cfg, dict) or not cfg:
        raise RuntimeError('item_edit needs config (the new version as an object).')
    _fx_deny_new(json.dumps(prev, ensure_ascii=False), json.dumps(cfg, ensure_ascii=False))
    if dom in ('automation', 'scene'):
        cfg = dict(cfg, id=cid)
    bak = _fx_backup('config', f'{dom}_{cid}', json.dumps(prev, indent=2, ensure_ascii=False))
    st, body = _ha_req(ha, f'/api/config/{dom}/config/{cid}', 'POST', cfg, timeout=60)
    if st >= 400:
        raise RuntimeError('Home Assistant said no: ' + str(body.get('message') if isinstance(body, dict) else body)[:500])
    now_cfg = _fx_config_get(ha, dom, cid) or cfg
    res = {'domain': dom, 'id': cid, 'prev_config': prev, 'prev_hash': _fx_chash(prev), 'new_hash': _fx_chash(now_cfg), 'backup': bak}
    if dom == 'automation':
        ent, state = _auto_entity(ha, cid)
        res.update(entity_id=ent, state=state)
    res['message'] = f'Updated {dom} {cid}. The old version is saved as {bak}.'
    return res

def _fx_apply_edits(text, edits):
    work = text
    touched = []
    for i, e in enumerate(edits):
        old, new = (e.get('old'), e.get('new'))
        if not isinstance(old, str) or not isinstance(new, str) or (not old.strip()):
            raise RuntimeError(f'Edit {i + 1} needs old and new text.')
        if len(old) > 8000 or len(new) > 8000:
            raise RuntimeError(f'Edit {i + 1} is too big.')
        n = work.count(old)
        if n != 1:
            raise RuntimeError(f"Edit {i + 1}: the text to replace {('was not found' if n == 0 else 'appears ' + str(n) + ' times')}, so nothing was changed.")
        _fx_deny_new(old, new)
        pos = work.index(old)
        l0 = work.count('\n', 0, pos)
        l1 = l0 + old.count('\n')
        lay = _fx_layout(work)
        keys = [s['key'] for s in lay['sections'] if s['start'] <= l1 and l0 < s['end']]
        touched.extend(keys or ['?'])
        work = work[:pos] + new + work[pos + len(old):]
    return (work, touched)

def _fx_reload(ha, keys):
    done = []
    for dom in sorted(keys):
        st, body = _ha_req(ha, f'/api/services/{dom}/reload', 'POST', {}, timeout=60)
        if st >= 400:
            if st in (400, 404) and 'not found' in str(body).lower():
                continue
            raise RuntimeError(f'{dom}.reload failed: {_fx_short(body, 200)}')
        done.append(f'{dom}.reload')
    return done

def _fx_after_write(ha, full, name, new_text, old_text, keys_for_reload):
    """check_config; bad -> put the old text back. Then reload only what changed. Returns (reloaded, restart_needed)."""
    ok, errs = _check_config(ha)
    if not ok:
        with open(full, 'w', encoding='utf-8') as fh:
            fh.write(old_text)
        raise RuntimeError(f"Home Assistant's config check failed, so the old file is back and nothing changed: {str(errs)[:600]}")
    reloadable = sorted((k for k in set(keys_for_reload) if k in FX_RELOAD))
    needs = sorted((k for k in set(keys_for_reload) if k not in FX_RELOAD and k != '?'))
    if not keys_for_reload or '?' in keys_for_reload:
        lay = _fx_layout(new_text)
        reloadable = sorted({s['key'] for s in lay['sections'] if s['key'] in FX_RELOAD})
    try:
        done = _fx_reload(ha, reloadable)
    except Exception as exc:
        with open(full, 'w', encoding='utf-8') as fh:
            fh.write(old_text)
        try:
            _fx_reload(ha, reloadable)
        except Exception:
            pass
        raise RuntimeError(f'The reload failed, so the old file is back: {exc}')
    return (done, needs)

def _fx_package_patch(ha, p):
    full = _fx_pkg_path(str(p.get('name') or ''))
    name = str(p.get('name'))
    old_text = open(full, encoding='utf-8').read()
    if len(old_text) > FX_MAX_FILE:
        raise RuntimeError('That file is too big for Tinker to edit.')
    want = str(p.get('expect_sha256') or '')
    if not re.fullmatch('[0-9a-f]{64}', want):
        raise RuntimeError('package_patch needs expect_sha256 (the fingerprint of the file Tinker read).')
    if _fx_sha(old_text) != want:
        raise RuntimeError('The file changed after Tinker looked at it, so nothing was changed. Ask Tinker to look again.')
    edits = p.get('edits')
    if not isinstance(edits, list) or not 1 <= len(edits) <= 12:
        raise RuntimeError('package_patch needs 1 to 12 edits.')
    new_text, touched = _fx_apply_edits(old_text, edits)
    if new_text == old_text:
        raise RuntimeError('Those edits change nothing.')
    if len(new_text) > FX_MAX_FILE:
        raise RuntimeError('The result would be too big.')
    bak = _fx_backup('packages', name.replace('/', '__'), old_text)
    tmp = full + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(new_text)
    os.replace(tmp, full)
    reloaded, needs = _fx_after_write(ha, full, name, new_text, old_text, touched)
    res = {'name': name, 'backup': bak, 'prev_sha256': want, 'new_sha256': _fx_sha(new_text), 'touched': sorted(set(touched)), 'reloaded': reloaded, 'restart_needed': needs, 'check': 'valid', 'reload_keys': sorted(set(touched))}
    res['message'] = f'Fixed {name}. The old file is saved as {bak}.' + (f" {', '.join(needs)} only takes effect after Home Assistant restarts (Tinker never restarts it)." if needs else '')
    return res

def _fx_package_restore(ha, p):
    full = _fx_pkg_path(str(p.get('name') or ''))
    name = str(p.get('name'))
    bak = str(p.get('backup') or '')
    if not FX_BAK_RE.match(bak):
        raise RuntimeError("That is not one of Tinker's backups.")
    bpath = os.path.join(FX_BACKUP_DIR, 'packages', bak)
    if not os.path.isfile(bpath):
        raise RuntimeError('The backup file is gone from the Pi, so Tinker cannot put it back.')
    cur = open(full, encoding='utf-8').read()
    want = str(p.get('expect_sha256') or '')
    if want and _fx_sha(cur) != want and (not p.get('force')):
        raise RuntimeError('The file was changed again after the fix, so Tinker did not put the old one back over it.')
    prev = open(bpath, encoding='utf-8').read()
    keys = p.get('reload_keys') if isinstance(p.get('reload_keys'), list) else []
    keys = [k for k in keys if isinstance(k, str) and re.fullmatch('[a-z_]+|\\?', k)]
    _fx_backup('packages', name.replace('/', '__') + '_before_restore', cur)
    tmp = full + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(prev)
    os.replace(tmp, full)
    reloaded, needs = _fx_after_write(ha, full, name, prev, cur, keys)
    return {'name': name, 'restored_from': bak, 'new_sha256': _fx_sha(prev), 'reloaded': reloaded, 'restart_needed': needs, 'message': f'Put {name} back the way it was.'}

def do_ha_fixer(ha, action, payload):
    if action == 'inventory':
        return _fx_inventory(ha, payload)
    if action == 'evidence':
        return _fx_evidence(ha, payload)
    if action == 'item_edit':
        return _fx_item_edit(ha, payload)
    if action == 'package_patch':
        return _fx_package_patch(ha, payload)
    if action == 'package_restore':
        return _fx_package_restore(ha, payload)
    raise RuntimeError(f'Unknown fixer action: {action}')


$blk$;
begin
  select source into v_src from public.home_hub_agent_releases where version = '1.6.1';
  if v_src is null then raise exception 'release 1.6.1 not found'; end if;
  if (length(v_src) - length(replace(v_src, v_def, ''))) / length(v_def) <> 1 then raise exception 'def anchor count is not 1'; end if;
  if (length(v_src) - length(replace(v_src, v_disp, ''))) / length(v_disp) <> 1 then raise exception 'dispatch anchor count is not 1'; end if;
  if (length(v_src) - length(replace(v_src, 'VERSION = "1.6.1"', ''))) / length('VERSION = "1.6.1"') <> 1 then raise exception 'version anchor count is not 1'; end if;
  v_new := replace(v_src, v_def, v_block || v_def);
  v_new := replace(v_new, v_disp, v_disp || E'    if action in FIXER_ACTIONS:\n        return do_ha_fixer(ha, action, payload)\n');
  v_new := replace(v_new, 'VERSION = "1.6.1"', 'VERSION = "1.6.2"');
  insert into public.home_hub_agent_releases (version, sha256, source, notes)
  values ('1.6.2', encode(sha256(convert_to(v_new, 'UTF8')), 'hex'), v_new,
          'Automation Fixer (Tinker): homeassistant.inventory, evidence (logbook, history, run traces, who mentions a device), item_edit, package_patch, package_restore. Every write backs up first and checks a fingerprint. Built over 1.6.1.');
end $$;
select version, sha256, length(source) len, md5(substring(source from position('# Automation Fixer (agent 1.6.2)' in source) for 35673)) block_md5 from public.home_hub_agent_releases where version = '1.6.2';
