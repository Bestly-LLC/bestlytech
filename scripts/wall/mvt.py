"""Tiny Mapbox Vector Tile decoder (no dependencies) for TomTom vector flow tiles. Bestly wall, 2026-10-05.

Deployed copy: /opt/bestly/wall/mvt.py on the Pi (server.py traffic_loop -> _tr_flow imports it).
"""
import math, struct


def _varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7F) << s; s += 7
        if c < 0x80:
            return r, i


def _fields(b):
    i, n = 0, len(b)
    while i < n:
        k, i = _varint(b, i); f, w = k >> 3, k & 7
        if w == 0: v, i = _varint(b, i)
        elif w == 2:
            l, i = _varint(b, i); v = b[i:i + l]; i += l
        elif w == 5: v = b[i:i + 4]; i += 4
        elif w == 1: v = b[i:i + 8]; i += 8
        else: raise ValueError("wire type %d" % w)
        yield f, w, v


def _packed(b):
    i, out = 0, []
    while i < len(b):
        v, i = _varint(b, i); out.append(v)
    return out


def _zz(n):
    return (n >> 1) ^ -(n & 1)


def _value(b):
    for f, w, v in _fields(b):
        if f == 1: return v.decode("utf-8", "replace")
        if f == 2: return struct.unpack("<f", v)[0]
        if f == 3: return struct.unpack("<d", v)[0]
        if f in (4, 5): return v
        if f == 6: return _zz(v)
        if f == 7: return bool(v)
    return None


def _lines(g):
    i, x, y, lines, cur = 0, 0, 0, [], None
    while i < len(g):
        c = g[i]; i += 1; cid, cnt = c & 7, c >> 3
        if cid == 7:
            if cur: cur.append(cur[0])
            continue
        for _ in range(cnt):
            x += _zz(g[i]); y += _zz(g[i + 1]); i += 2
            if cid == 1: cur = [(x, y)]; lines.append(cur)
            else: cur.append((x, y))
    return lines


def decode(b):
    """{layer: (extent, [(type, props, [line, ...]), ...])}"""
    layers = {}
    for f, w, v in _fields(b):
        if f != 3: continue
        name, keys, vals, feats, ext = "", [], [], [], 4096
        for f2, w2, v2 in _fields(v):
            if f2 == 1: name = v2.decode()
            elif f2 == 3: keys.append(v2.decode())
            elif f2 == 4: vals.append(_value(v2))
            elif f2 == 5: ext = v2
            elif f2 == 2: feats.append(v2)
        out = []
        for fb in feats:
            tags, typ, geom = [], 0, []
            for f3, w3, v3 in _fields(fb):
                if f3 == 2: tags += _packed(v3) if w3 == 2 else [v3]
                elif f3 == 3: typ = v3
                elif f3 == 4: geom += _packed(v3) if w3 == 2 else [v3]
            props = {keys[tags[j]]: vals[tags[j + 1]] for j in range(0, len(tags) - 1, 2)}
            out.append((typ, props, _lines(geom)))
        layers[name] = (ext, out)
    return layers


def to_latlon(z, tx, ty, ext, line):
    n = 2 ** z; out = []
    for x, y in line:
        px, py = (tx + x / ext) / n, (ty + y / ext) / n
        out.append((math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py)))), px * 360.0 - 180.0))
    return out
