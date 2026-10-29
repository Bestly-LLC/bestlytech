#!/usr/bin/env python3
"""Self-test. No network, no credentials, nothing real is run (a fake run.sh stands in). Run before going live."""
import os
import stat
import sys
import tempfile
import types

here = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()

# a stand-in for the Pi's lib module and for run.sh
calls = []
queue = []
fake_lib = types.ModuleType("lib")


def fake_rpc(name, **kw):
    calls.append((name, kw))
    if name == "pi_run_claim":
        return queue.pop(0) if queue else None
    return True


fake_lib.rpc = fake_rpc
sys.modules["lib"] = fake_lib

run_sh = os.path.join(tmp, "run.sh")
with open(run_sh, "w") as f:
    f.write('#!/bin/sh\ncase "$1" in\n good) echo "ok did the thing"; exit 0;;\n bad) echo "starting"; echo "RuntimeError: HTTP 401 https://api.mercury.com"; exit 1;;\n *) echo "unknown job" >&2; exit 2;;\nesac\n')
os.chmod(run_sh, os.stat(run_sh).st_mode | stat.S_IEXEC)
os.environ["RUN_REQUESTS_RUN_SH"] = run_sh
os.environ["RUN_REQUESTS_OFF"] = os.path.join(tmp, "OFF")
os.environ["RUN_REQUESTS_LOCK"] = os.path.join(tmp, "lock")
sys.path.insert(0, here)
import run_requests as R  # noqa: E402

failures = []


def check(label, ok, detail=""):
    if not ok:
        failures.append("%s %s" % (label, detail))


check("good job", R.run_job("good") == (True, "ok did the thing"))
ok, s = R.run_job("bad")
check("bad job fails", ok is False)
check("bad job summary is the error line, first line classifiable", s.startswith("RuntimeError: HTTP 401"), s)
check("unknown job fails", R.run_job("nope")[0] is False)
check("refuses a path", R.run_job("../etc/passwd")[0] is False)
check("refuses a flag", R.run_job("--help")[0] is False)
check("refuses an empty name", R.run_job("")[0] is False)
check("refuses to run itself", R.run_job("run_requests")[0] is False)
check("last_line of nothing", R.last_line("") == "no output")

# the whole loop
queue.extend([{"id": "r1", "job": "good"}, {"id": "r2", "job": "bad"}])
msg = R.main([])
check("loop reports both", msg.startswith("ok ran 2") and "good ok" in msg and "bad FAILED" in msg, msg)
fin = [(k["p_id"], k["p_ok"]) for n, k in calls if n == "pi_run_finish"]
check("finish called with the right results", fin == [("r1", True), ("r2", False)], str(fin))
calls.clear()
check("nothing waiting", R.main([]) == "ok nothing waiting")
open(os.environ["RUN_REQUESTS_OFF"], "w").close()
queue.append({"id": "r3", "job": "good"})
check("off switch", R.main([]).startswith("off") and queue, "")
os.remove(os.environ["RUN_REQUESTS_OFF"])

if failures:
    print("SELFTEST FAILED")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("selftest ok")
