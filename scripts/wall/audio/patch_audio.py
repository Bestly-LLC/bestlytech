#!/usr/bin/env python3
"""AUDIO_20261103 patcher (runs on Hestia). Backs up every file first, then applies anchored exact-once patches, ast.parse-checks the Python."""
import ast, os, sys, time
ROOT = "/opt/bestly/wall"
STAMP = time.strftime("%Y%m%d-%H%M")
SRC = "/tmp/pja"


def rd(p):
    return open(p).read()


def patch(path, edits):
    s = rd(path)
    bak = path + ".bak_audio_" + STAMP
    if not os.path.exists(bak):
        open(bak, "w").write(s)
    for name, old, new in edits:
        c = s.count(old)
        if c != 1:
            sys.exit("ABORT %s: anchor '%s' found %d times" % (path, name, c))
        s = s.replace(old, new)
    if path.endswith(".py"):
        ast.parse(s)
    open(path + ".new", "w").write(s)
    os.replace(path + ".new", path)
    print("patched", path, "backup", bak)


blk = rd(SRC + "/pja_server_block.py")
js = rd(SRC + "/pja_page.js")

# ---- server.py ----
ASK_PUT = '    card = b.get("answer_card") if isinstance(b.get("answer_card"), dict) else {}\n    ASKC_ROW.update('
ASK_PUT_NEW = ('    card = b.get("answer_card") if isinstance(b.get("answer_card"), dict) else {}\n'
               '    if ASKC_ROW.get("id") != str(b["id"])[:64]:   # AUDIO_20261103: one soft chime per new answer (the Pi gates decide if it plays)\n'
               '        threading.Thread(target=lambda: pja_request("chime", "ask the wall: answer card", "normal"), daemon=True).start()\n'
               '    ASKC_ROW.update(')
GET_OLD = '        if p == "/api/ask":   # ASKCARD_20261103\n            return self.send(200, json.dumps(askc_get()))\n'
GET_NEW = ('        if p == "/api/sound/next":   # AUDIO_20261103\n'
           '            if not lan_ok(self.client_address[0]):\n'
           '                return self.send(403, \'{"error":"lan only"}\')\n'
           '            from urllib.parse import parse_qs\n'
           '            q = parse_qs(urlparse(self.path).query)\n'
           '            try:\n'
           '                aft = int((q.get("after") or ["0"])[0])\n'
           '            except Exception:\n'
           '                aft = 0\n'
           '            return self.send(200, json.dumps(pja_next(re.sub(r"[^a-z0-9]", "", (q.get("cid") or ["x"])[0].lower())[:12] or "x", aft, (q.get("ctx") or [""])[0][:12])), "application/json", {"Cache-Control": "no-store"})\n'
           '        if p == "/api/sound/status":   # AUDIO_20261103\n'
           '            return self.send(200, json.dumps(pja_status()))\n') + GET_OLD
POST_OLD = '        if p == "/api/ask":   # ASKCARD_20261103: the Mac answerer pushes the finished answer here (LAN only)\n'
POST_NEW = ('        if p == "/api/sound":   # AUDIO_20261103: {"sound","reason","priority"} LAN only; all gates enforced here\n'
            '            if not lan_ok(self.client_address[0]):\n'
            '                return self.send(403, \'{"error":"lan only"}\')\n'
            '            b = self.body()\n'
            '            code, out = pja_request(b.get("sound"), b.get("reason"), b.get("priority", "normal"), b.get("test"))\n'
            '            return self.send(code, json.dumps(out))\n'
            '        if p == "/api/sound/ack":   # AUDIO_20261103\n'
            '            if not lan_ok(self.client_address[0]):\n'
            '                return self.send(403, \'{"error":"lan only"}\')\n'
            '            pja_ack(self.body())\n'
            '            return self.send(200, \'{"ok":true}\')\n') + POST_OLD
BLK_ANCHOR = "def wall_src():\n"
THR_OLD = "    threading.Thread(target=traffic_loop, daemon=True).start()"
patch(ROOT + "/server.py", [
    ("askc_put", ASK_PUT, ASK_PUT_NEW),
    ("GET ask", GET_OLD, GET_NEW),
    ("POST ask", POST_OLD, POST_NEW),
    ("block", BLK_ANCHOR, blk + BLK_ANCHOR),
    ("thread", THR_OLD, "    threading.Thread(target=pja_loop, daemon=True).start()   # AUDIO_20261103 audio-path watchdog\n" + THR_OLD),
])

# ---- wall.html ----
A = "  ['pointerdown','touchstart','keydown','click'].forEach(ev=>addEventListener(ev,audioInit,{passive:true}));\n"
patch(ROOT + "/www/wall.html", [("audioInit listener", A, A + js)])

# ---- alerts_batch.py (rare plane -> wall sound; HomePod logic untouched) ----
R_OLD = "            why = speak(voice_line(name, text, mins), c)\n"
R_NEW = R_OLD + (
    "            if not DRY[\"on\"]:                      # AUDIO_20261103: gentle gold-card sound through the projector (the Pi gates decide)\n"
    "                try:\n"
    "                    rq = urllib.request.Request(WALL + \"/api/sound\", data=json.dumps({\"sound\": \"rare\", \"reason\": \"Sky Sync: rare aircraft \" + str(name), \"priority\": \"normal\"}).encode(),\n"
    "                                                headers={\"Content-Type\": \"application/json\"}, method=\"POST\")\n"
    "                    with urllib.request.urlopen(rq, timeout=8) as rr:\n"
    "                        why += \" | wall sound: \" + str(json.loads(rr.read()).get(\"detail\"))\n"
    "                except Exception as ex:\n"
    "                    why += \" | wall sound failed: \" + str(ex)[:60]\n")
patch(ROOT + "/alerts_batch.py", [("rare speak", R_OLD, R_NEW)])
print("ALL OK")
