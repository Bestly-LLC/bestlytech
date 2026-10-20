#!/usr/bin/env python3
"""Builds public/k.html (the standalone phone page) from kit.css + kit.js + k.template.html."""
import pathlib
here = pathlib.Path(__file__).parent
t = (here / "k.template.html").read_text()
out = t.replace("/*__CSS__*/", (here / "kit.css").read_text()).replace("/*__JS__*/", (here / "kit.js").read_text())
dest = here.parent.parent / "public" / "k.html"
dest.write_text(out)
print("wrote", dest, len(out), "bytes")
