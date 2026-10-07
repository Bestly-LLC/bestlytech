import sys
P = "/opt/bestly/wall/server.py"
s = open(P).read()
old = '''            if SKY_RET.get("gone"):
                SKY_RET.update({"active": False, "gone": False})                 # swiped away on the phone: start a fresh one'''
new = '''            if SKY_RET.get("gone"):
                if now - SKY_RET["started_at"] > 240:                            # swiped away on the phone: start a fresh one
                    SKY_RET.update({"active": False, "gone": False})
                else:
                    SKY_RET["gone"] = False                                      # token still on its way after a start: just wait'''
assert old in s
s = s.replace(old, new, 1)
open(P, "w").write(s)
print("ok")
