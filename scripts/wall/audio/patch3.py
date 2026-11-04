import ast, time
p = "/opt/bestly/wall/server.py"
s = open(p).read()
old = '    if b.get("state") == "played":\n        PJA["played"] += 1\n'
new = old + '    elif b.get("state") in ("locked", "error"):   # a sound that never played must not use up the minute\n        PJA["last_normal"] = 0.0\n'
assert s.count(old) == 1
open(p + ".bak_audio_" + time.strftime("%Y%m%d-%H%M") + "c", "w").write(s)
s = s.replace(old, new)
ast.parse(s)
open(p, "w").write(s)
print("ok")
