#!/usr/bin/env python3
"""Offline test for the 1.6.2 Fixer block against a mock Home Assistant (HTTP + WebSocket + a packages folder).
Run: python3 scripts/home-hub-agent/tests/test_fixer_1_6_2.py   (no network, no Home Assistant needed)"""
import warnings; warnings.simplefilter("ignore")
import base64, hashlib, json, os, re, shutil, socket, ssl, struct, sys, tempfile, threading, time, unittest, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PATCHES = os.path.join(HERE, "..", "patches")
TMP = tempfile.mkdtemp(prefix="fixer-test-")
HA_DIR = os.path.join(TMP, "ha")
os.makedirs(os.path.join(HA_DIR, "packages"))

NOW = time.time()
def iso(ts): return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(ts))

STATE = {
    "ui": {"1001": {"id": "1001", "alias": "Bathroom motion", "mode": "single",
                    "trigger": [{"platform": "state", "entity_id": "binary_sensor.bathroom_motion", "to": "on"}],
                    "action": [{"service": "light.turn_on", "target": {"entity_id": "light.bathroom_vanity"}, "data": {"brightness_pct": 25}}]}},
    "checks_ok": True, "reloads": [], "posts": [],
}
PKG = """# Jared's bath wake lights
automation:
  - id: bath_wake_ramp
    alias: Bath wake ramp
    trigger:
      - platform: time
        at: "06:00:00"
    action:
      - service: light.turn_on
        target:
          entity_id: light.bathroom_vanity
        data:
          brightness_pct: 100
          transition: 1200
  - id: other_thing
    alias: Other thing
    trigger:
      - platform: state
        entity_id: sensor.x
    action:
      - service: script.bath_scene

script:
  bath_scene:
    alias: Bath scene
    sequence:
      - service: light.turn_on
        target:
          entity_id: light.bathroom_vanity
"""
open(os.path.join(HA_DIR, "packages", "bath_wake.yaml"), "w").write(PKG)

def states():
    return [
        {"entity_id": "light.bathroom_vanity", "state": "on", "last_changed": iso(NOW - 600),
         "attributes": {"friendly_name": "Bathroom vanity", "brightness": 255}},
        {"entity_id": "switch.adaptive_lighting_bath", "state": "on", "attributes": {"friendly_name": "Adaptive bath", "lights": ["light.bathroom_vanity"]}},
        {"entity_id": "automation.bathroom_motion", "state": "on", "attributes": {"friendly_name": "Bathroom motion", "id": "1001", "last_triggered": iso(NOW - 3000), "mode": "single", "current": 0}},
        {"entity_id": "automation.bath_wake_ramp", "state": "on", "attributes": {"friendly_name": "Bath wake ramp", "id": "bath_wake_ramp", "last_triggered": iso(NOW - 1500), "mode": "single", "current": 0}},
        {"entity_id": "automation.other_thing", "state": "off", "attributes": {"friendly_name": "Other thing", "id": "other_thing", "last_triggered": None}},
        {"entity_id": "script.bath_scene", "state": "off", "attributes": {"friendly_name": "Bath scene", "last_triggered": iso(NOW - 1400)}},
    ]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/websocket": return self.ws()
        if p == "/api/states": return self._send(200, states())
        m = re.match(r"^/api/config/automation/config/(.+)$", p)
        if m:
            c = STATE["ui"].get(m.group(1)); return self._send(200, c) if c else self._send(404, {"message": "Resource not found"})
        if p.startswith("/api/config/script/config/") or p.startswith("/api/config/scene/config/"): return self._send(404, {"message": "Resource not found"})
        if p.startswith("/api/logbook/"):
            return self._send(200, [
                {"when": iso(NOW - 1500), "name": "Bath wake ramp", "message": "triggered by time", "entity_id": "automation.bath_wake_ramp", "domain": "automation"},
                {"when": iso(NOW - 1499), "name": "Bathroom vanity", "message": "turned on triggered by automation Bath wake ramp", "entity_id": "light.bathroom_vanity", "state": "on",
                 "context_event_type": "automation_triggered", "context_entity_id": "automation.bath_wake_ramp", "context_entity_id_name": "Bath wake ramp"},
                {"when": iso(NOW - 900), "name": "Kitchen", "message": "x", "entity_id": "light.kitchen", "state": "on"}])
        if p.startswith("/api/history/period/"):
            return self._send(200, [[
                {"entity_id": "light.bathroom_vanity", "state": "on", "last_changed": iso(NOW - 1500), "attributes": {"brightness": 64}},
                {"entity_id": "light.bathroom_vanity", "state": "on", "last_changed": iso(NOW - 1000), "attributes": {"brightness": 160}},
                {"entity_id": "light.bathroom_vanity", "state": "on", "last_changed": iso(NOW - 600), "attributes": {"brightness": 255}}]])
        self._send(404, {"message": "no"})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        STATE["posts"].append((p, body))
        m = re.match(r"^/api/config/automation/config/(.+)$", p)
        if m:
            if "bad" in json.dumps(body): return self._send(400, {"message": "Message malformed: bad thing"})
            STATE["ui"][m.group(1)] = body; return self._send(200, {"result": "ok"})
        if p == "/api/template":
            return self._send(200, [["light.bathroom_vanity", "bathroom", "dev1", "Bathroom"]])
        if p == "/api/config/core/check_config":
            return self._send(200, {"result": "valid" if STATE["checks_ok"] else "invalid", "errors": None if STATE["checks_ok"] else "Bad YAML at line 3"})
        m = re.match(r"^/api/services/(\w+)/reload$", p)
        if m: STATE["reloads"].append(m.group(1)); return self._send(200, [])
        self._send(404, {"message": "no"})
    def ws(self):
        key = self.headers["Sec-WebSocket-Key"]
        acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101); self.send_header("Upgrade", "websocket"); self.send_header("Connection", "Upgrade"); self.send_header("Sec-WebSocket-Accept", acc); self.end_headers()
        self.wfile.flush()
        def send(o):
            d = json.dumps(o).encode(); h = bytearray([0x81])
            if len(d) < 126: h.append(len(d))
            elif len(d) < 65536: h.append(126); h += struct.pack(">H", len(d))
            else: h.append(127); h += struct.pack(">Q", len(d))
            self.wfile.write(bytes(h) + d); self.wfile.flush()
        def recv():
            b1, b2 = self.rfile.read(2); ln = b2 & 0x7f
            if ln == 126: ln = struct.unpack(">H", self.rfile.read(2))[0]
            elif ln == 127: ln = struct.unpack(">Q", self.rfile.read(8))[0]
            mask = self.rfile.read(4); data = bytes(b ^ mask[i % 4] for i, b in enumerate(self.rfile.read(ln)))
            return json.loads(data)
        send({"type": "auth_required"}); recv(); send({"type": "auth_ok"})
        try:
            while True:
                m = recv()
                if m["type"] == "trace/list":
                    send({"id": m["id"], "type": "result", "success": True, "result": [
                        {"run_id": "r1", "timestamp": {"start": iso(NOW - 1500), "finish": iso(NOW - 1499)}, "state": "stopped", "trigger": "time", "last_step": "action/0"}]})
                elif m["type"] == "trace/get":
                    big = "x" * 70000   # exercises a multi-frame size (>65535)
                    send({"id": m["id"], "type": "result", "success": True, "result": {"trace": {
                        "trigger/0": [{"changed_variables": {"trigger": {"description": "time pattern", "platform": "time"}, "pad": big}}],
                        "action/0": [{"result": {"params": {"domain": "light", "service": "turn_on", "service_data": {"transition": 1200, "brightness_pct": 100}, "target": {"entity_id": ["light.bathroom_vanity"]}}, "running_script": False}}]}}})
        except Exception:
            pass

def load_agent_ns(port):
    ns = {"re": re, "os": os, "json": json, "time": time, "hashlib": hashlib, "ssl": ssl, "urllib": urllib, "HA_DIR": HA_DIR, "CTX": ssl.create_default_context()}
    src = open(os.path.join(PATCHES, "automator_1_6_1.py")).read()
    m = re.search(r"NEW_BLOCK = r'''(.*?)'''\n\nDISPATCH_ANCHOR", src, re.S)
    exec(compile(m.group(1), "automator_block", "exec"), ns)
    exec(compile(open(os.path.join(PATCHES, "fixer_1_6_2_block.min.py")).read(), "fixer_block", "exec"), ns)
    return ns

class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), H); cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.ns = load_agent_ns(cls.port); cls.ha = {"base": f"http://127.0.0.1:{cls.port}", "token": "t"}
        cls.f = staticmethod(cls.ns["do_ha_fixer"])
    def setUp(self):
        STATE["reloads"].clear(); STATE["checks_ok"] = True
        open(os.path.join(HA_DIR, "packages", "bath_wake.yaml"), "w").write(PKG)
    def test_layout(self):
        lay = self.ns["_fx_layout"](PKG)
        items = [(i["section"], i["id"], i["alias"]) for i in lay["items"]]
        self.assertIn(("automation", "bath_wake_ramp", "Bath wake ramp"), items)
        self.assertIn(("automation", "other_thing", "Other thing"), items)
        self.assertIn(("script", "bath_scene", "bath_scene"), items)
        self.assertEqual([s["key"] for s in lay["sections"]], ["automation", "script"])
    def test_inventory(self):
        r = self.f(self.ha, "inventory", {})
        by = {a["entity_id"]: a for a in r["automations"]}
        self.assertEqual(by["automation.bathroom_motion"]["where"], "ui"); self.assertIn("cfg", by["automation.bathroom_motion"])
        self.assertEqual(by["automation.bath_wake_ramp"]["where"], "package"); self.assertEqual(by["automation.bath_wake_ramp"]["file"], "bath_wake")
        self.assertIn("transition: 1200", by["automation.bath_wake_ramp"]["block"])
        self.assertEqual(r["scripts"][0]["where"], "package")
        self.assertEqual(r["packages"][0]["name"], "bath_wake")
    def test_evidence(self):
        r = self.f(self.ha, "evidence", {"entity_ids": ["light.bathroom_vanity"], "start": iso(NOW - 3600), "end": iso(NOW)})
        names = {x["entity_id"] for x in r["referrers"]}
        self.assertIn("automation.bathroom_motion", names); self.assertIn("automation.bath_wake_ramp", names); self.assertIn("script.bath_scene", names)
        self.assertNotIn("automation.other_thing", names)   # only calls script.bath_scene -> would be found via script hop? it is not "fired"; hop adds the script only
        self.assertIn("switch.adaptive_lighting_bath", r["related"])
        self.assertEqual(r["history"]["light.bathroom_vanity"][-1][2], 100)
        self.assertTrue(any(x.get("context_entity_id") == "automation.bath_wake_ramp" for x in r["logbook"]))
        self.assertIn("bath_wake", r["package_files"])
        tr = next(t for t in r["traces"] if t["entity_id"] == "automation.bath_wake_ramp")
        self.assertTrue(any("transition" in (s.get("do") or "") for s in tr["steps"]), tr)
        self.assertTrue(any(s.get("why") == "time pattern" for s in tr["steps"]))
        self.assertLess(len(json.dumps(r)), 420000)
    def test_item_edit_and_guard(self):
        cur = STATE["ui"]["1001"]; h = self.ns["_fx_chash"](cur)
        new = json.loads(json.dumps(cur)); new["action"][0]["data"]["brightness_pct"] = 40
        r = self.f(self.ha, "item_edit", {"domain": "automation", "id": "1001", "config": new, "expect_hash": h})
        self.assertEqual(STATE["ui"]["1001"]["action"][0]["data"]["brightness_pct"], 40)
        self.assertEqual(r["prev_config"]["action"][0]["data"]["brightness_pct"], 25)
        self.assertTrue(os.path.isfile(os.path.join(HA_DIR, "bestly_backups", "config", r["backup"])))
        with self.assertRaises(RuntimeError): self.f(self.ha, "item_edit", {"domain": "automation", "id": "1001", "config": new, "expect_hash": h})  # stale hash
        undo = self.f(self.ha, "item_edit", {"domain": "automation", "id": "1001", "config": r["prev_config"], "expect_hash": r["new_hash"]})
        self.assertEqual(STATE["ui"]["1001"]["action"][0]["data"]["brightness_pct"], 25)
        with self.assertRaises(RuntimeError): self.f(self.ha, "item_edit", {"domain": "automation", "id": "nope", "config": new})
        bad = json.loads(json.dumps(new)); bad["action"].append({"service": "shell_command.x"})
        with self.assertRaises(RuntimeError): self.f(self.ha, "item_edit", {"domain": "automation", "id": "1001", "config": bad})
    def test_package_patch_restore(self):
        sha = hashlib.sha256(PKG.encode()).hexdigest()
        edits = [{"old": "          brightness_pct: 100\n          transition: 1200\n", "new": "          brightness_pct: 30\n"}]
        r = self.f(self.ha, "package_patch", {"name": "bath_wake", "edits": edits, "expect_sha256": sha})
        txt = open(os.path.join(HA_DIR, "packages", "bath_wake.yaml")).read()
        self.assertIn("brightness_pct: 30", txt); self.assertNotIn("transition", txt); self.assertIn("# Jared's bath wake lights", txt)
        self.assertEqual(r["touched"], ["automation"]); self.assertEqual(r["reloaded"], ["automation.reload"]); self.assertEqual(r["restart_needed"], [])
        self.assertEqual(STATE["reloads"], ["automation"])
        with self.assertRaises(RuntimeError): self.f(self.ha, "package_patch", {"name": "bath_wake", "edits": edits, "expect_sha256": sha})  # file changed since
        back = self.f(self.ha, "package_restore", {"name": "bath_wake", "backup": r["backup"], "expect_sha256": r["new_sha256"], "reload_keys": r["reload_keys"]})
        self.assertEqual(open(os.path.join(HA_DIR, "packages", "bath_wake.yaml")).read(), PKG)
        # a restore over a file somebody else changed is refused
        open(os.path.join(HA_DIR, "packages", "bath_wake.yaml"), "a").write("# x\n")
        with self.assertRaises(RuntimeError): self.f(self.ha, "package_restore", {"name": "bath_wake", "backup": r["backup"], "expect_sha256": r["new_sha256"]})
    def test_package_patch_safety(self):
        sha = hashlib.sha256(PKG.encode()).hexdigest()
        for bad in ({"old": "nothing like this", "new": "x"}, {"old": "entity_id", "new": "x"}):   # not found / appears many times
            with self.assertRaises(RuntimeError): self.f(self.ha, "package_patch", {"name": "bath_wake", "edits": [bad], "expect_sha256": sha})
        with self.assertRaises(RuntimeError): self.f(self.ha, "package_patch", {"name": "bath_wake", "edits": [{"old": "brightness_pct: 100", "new": "brightness_pct: 100\n          x: shell_command.rm"}], "expect_sha256": sha})
        with self.assertRaises(RuntimeError): self.f(self.ha, "package_patch", {"name": "../etc/passwd", "edits": [{"old": "a", "new": "b"}], "expect_sha256": sha})
        # config check fails -> file restored byte for byte
        STATE["checks_ok"] = False
        with self.assertRaises(RuntimeError) as cm: self.f(self.ha, "package_patch", {"name": "bath_wake", "edits": [{"old": "brightness_pct: 100", "new": "brightness_pct: 50"}], "expect_sha256": sha})
        self.assertIn("config check failed", str(cm.exception))
        self.assertEqual(open(os.path.join(HA_DIR, "packages", "bath_wake.yaml")).read(), PKG)
    def test_restart_needed_for_non_reloadable(self):
        extra = PKG + "\nadaptive_lighting:\n  lights:\n    - light.bathroom_vanity\n"
        open(os.path.join(HA_DIR, "packages", "bath_wake.yaml"), "w").write(extra)
        sha = hashlib.sha256(extra.encode()).hexdigest()
        r = self.f(self.ha, "package_patch", {"name": "bath_wake", "edits": [{"old": "    - light.bathroom_vanity\n", "new": "    - light.other\n"}], "expect_sha256": sha})
        self.assertEqual(r["restart_needed"], ["adaptive_lighting"]); self.assertEqual(r["reloaded"], [])

if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
