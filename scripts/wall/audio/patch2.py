import ast, os, sys, time
p = "/opt/bestly/wall/server.py"
s = open(p).read()
old = '        if p.startswith("/fonts/"):\n            return self.static(p.lstrip("/"))\n'
new = old + '        if p.startswith("/sounds/") and p.endswith(".wav"):   # AUDIO_20261103\n            return self.static(p.lstrip("/"))\n'
assert s.count(old) == 1
bak = p + ".bak_audio_" + time.strftime("%Y%m%d-%H%M") + "b"
open(bak, "w").write(s)
s = s.replace(old, new)
ast.parse(s)
open(p, "w").write(s)
print("ok", bak)
