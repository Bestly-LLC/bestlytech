#!/usr/bin/env python3
"""wall.html Devices card: say what is actually wrong instead of "Sign in once in Homebridge". Re-runnable."""
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8", newline="").read()
old = "s:'Sign in once in Homebridge'"
new = "s:(p&&p.found?'Not answering on Wi-Fi':'Not connected yet')"
if old in s:
    s = s.replace(old, new, 1)
assert new in s, "Devices card text not found"
open(p, "w", encoding="utf-8", newline="").write(s); print("card text ok")
