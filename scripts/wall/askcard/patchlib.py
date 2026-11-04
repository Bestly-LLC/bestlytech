import sys
def patch(path, pairs):
    s = open(path, encoding="utf-8").read()
    for i, (anchor, repl) in enumerate(pairs):
        n = s.count(anchor)
        if n != 1:
            sys.exit("ABORT: anchor %d found %d times: %r" % (i, n, anchor[:90]))
        s = s.replace(anchor, repl)
    open(path, "w", encoding="utf-8").write(s)
    print("patched", path, len(pairs), "anchors ok")
