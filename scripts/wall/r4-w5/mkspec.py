#!/usr/bin/env python3
"""Build the W5 r4 edit spec from the source pieces in this folder -> w5spec.json"""
import json, os
D = os.path.dirname(os.path.abspath(__file__))
rd = lambda n: open(os.path.join(D, n), encoding="utf-8").read()
css, block, skit, srv, wd = rd("w5.css"), rd("block.js"), rd("skit.js"), rd("server_w5.py"), rd("wd_w5.py")
E = []
W = "www/wall.html"
E.append({"file": W, "mark": "W5 round 4 (Claude 2026-09-28): live signatures, Motivate me, fresh-air takeover, UFO skit ----------",
          "old": "</style>", "new": css + "</style>"})
E.append({"file": W, "mark": "function renderSigs(){ if(W5S&&W5S.on)",
          "old": "function renderSigs(){\n    const box=$('#wingSigs');",
          "new": "function renderSigs(){ if(W5S&&W5S.on){ try{ return w5Render(); }catch(e){ w5Fail(e); } }\n    const box=$('#wingSigs');"})
E.append({"file": W, "mark": "function playHero(){ if(W5S&&W5S.on)",
          "old": "function playHero(){\n    if(heroBusy||!heroQ.length) return;",
          "new": "function playHero(){ if(W5S&&W5S.on){ try{ return w5Hero(); }catch(e){ w5Fail(e); heroBusy=false; } }\n    if(heroBusy||!heroQ.length) return;"})
E.append({"file": W, "mark": "function renderEmos(all){ if(W5S&&W5S.on)",
          "old": "function renderEmos(all){ const box=$('#wingEmo');",
          "new": "function renderEmos(all){ if(W5S&&W5S.on){ try{ return w5Emos(all); }catch(e){ w5Fail(e); } } const box=$('#wingEmo');"})
E.append({"file": W, "mark": "async function skitStartV1(){",
          "old": "async function skitStart(){ tourStop(); TOUR.err=null;",
          "new": "async function skitStartV1(){ tourStop(); TOUR.err=null;"})
E.append({"file": W, "mark": "var W5S={on:true",
          "old": "})();\n</script>\n</body>",
          "new": block + skit + "})();\n</script>\n</body>"})
S = "server.py"
E.append({"file": S, "mark": "W5 round 4 (Claude 2026-09-28): indoor air -> Dyson purifier",
          "old": "class H(BaseHTTPRequestHandler):\n", "new": srv.lstrip("\n") + "\n\nclass H(BaseHTTPRequestHandler):\n"})
E.append({"file": S, "mark": 'if p == "/api/w5":',
          "old": '        if p == "/api/signs":\n',
          "new": '        if p == "/api/w5":   # W5 r4: fresh-air takeover + DND for the page\n            return self.send(200, json.dumps(w5_api()))\n        if p == "/api/signs":\n'})
E.append({"file": S, "mark": 'if p == "/api/w5beat":',
          "old": '        if p == "/api/heartbeat":\n',
          "new": '        if p == "/api/w5beat":   # W5 r4: sign wall / shows health from the page\n            if not wall_ok(self.client_address[0]):\n                return self.send(403, \'{"error":"projector only"}\')\n            w5_beat(self.body())\n            return self.send(200, \'{"ok":true}\')\n'
                 '        if p == "/api/w5test":   # W5 r4: localhost test hook\n            if self.client_address[0] not in ("127.0.0.1", "::1"):\n                return self.send(403, \'{"error":"local only"}\')\n            return self.send(200, json.dumps(w5_test(self.body())))\n        if p == "/api/heartbeat":\n'})
E.append({"file": S, "mark": 'hb["w5"] = w5_health()',
          "old": '            hb["focus"] = focus_health()\n',
          "new": '            hb["focus"] = focus_health()\n            hb["w5"] = w5_health()\n'})
E.append({"file": S, "mark": "target=w5_loop",
          "old": "    threading.Thread(target=focus_loop, daemon=True).start()\n",
          "new": "    threading.Thread(target=focus_loop, daemon=True).start()\n    threading.Thread(target=w5_loop, daemon=True).start()   # W5 r4: indoor air -> Dyson + fresh-air takeover\n"})
G = "watchdog.py"
E.append({"file": G, "mark": "def w5_watch(mem, hb):",
          "old": "\ndef push_status():\n", "new": "\n" + wd + "\n\ndef push_status():\n"})
E.append({"file": G, "mark": "w5_watch(mem, hb)",
          "old": '        sky_watch(mem, hb)\n    except Exception as e:\n        log(f"sky watch error: {e}")\n',
          "new": '        sky_watch(mem, hb)\n    except Exception as e:\n        log(f"sky watch error: {e}")\n    try:\n        w5_watch(mem, hb)   # W5 r4: sign wall + Dyson purifier\n    except Exception as e:\n        log(f"w5 watch error: {e}")\n'})
json.dump(E, open(os.path.join(D, "w5spec.json"), "w"))
print(len(E), "edits")
