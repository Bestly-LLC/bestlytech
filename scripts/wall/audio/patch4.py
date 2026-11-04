import ast, time
p = "/opt/bestly/wall/server.py"
s = open(p).read()
old = 'PJA = {"seq": 0, "ev": None,'
new = 'PJA = {"seq": int(time.time()), "ev": None,'    # monotonic across restarts: a page that remembers an old seq still gets new sounds
assert s.count(old) == 1
open(p + ".bak_audio_" + time.strftime("%Y%m%d-%H%M") + "d", "w").write(s)
s = s.replace(old, new)
ast.parse(s)
open(p, "w").write(s)
print("ok")
