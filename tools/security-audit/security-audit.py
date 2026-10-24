"""Wrapper so runjob.py can import jobs.security-audit (the pi_jobs name is hyphenated).

Ares 2.0 gate (2026-10-21): the nightly run goes through run_gate().
  1. selftest first. Any failing regression test = the run FAILS loudly (Ares-signed push to Scout) and the audit does not start.
  2. the audit runs; if it raises, Scout is told (Ares-signed), the job waits and retries ONCE, and a second failure escalates.
  3. "the run never started" is caught on the database side by security_audit_missed_watch().
Nothing here prints or stores a secret value.
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import security_audit  # noqa: E402
import security_audit_ares2 as ares2  # noqa: E402

RETRY_DELAY_S = 10 * 60
SELFTEST_TIMEOUT_S = 15 * 60


def _selftest_script():
    for name in ("security_audit_selftest.py", "selftest.py"):
        p = os.path.join(HERE, name)
        if os.path.exists(p):
            return p
    return None


def run_selftest(script=None):
    """Run the regression suite in a child process. -> (passed, {lesson id: ok|FAIL}, last lines of output)."""
    script = script or _selftest_script()
    if not script:
        return False, {}, "selftest script not found next to the audit"
    try:
        proc = subprocess.run([sys.executable, script], capture_output=True, text=True, timeout=SELFTEST_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, {}, "selftest could not run: %s" % type(exc).__name__
    out = (proc.stdout or "") + (proc.stderr or "")
    tests = {}
    for m in re.finditer(r"^LESSON (L\d+) (ok|FAIL)\s*$", out, re.M):
        tests[m.group(1)] = m.group(2)
    passed = proc.returncode == 0 and "selftest passed" in out and all(v == "ok" for v in tests.values())
    return passed, tests, "\n".join(out.strip().splitlines()[-12:])


def _save_selftest_state(path, passed, tests):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"at": datetime.now().isoformat(timespec="seconds"), "passed": bool(passed), "tests": tests}, fh, indent=2, sort_keys=True)
        os.replace(tmp, path)
    except OSError:
        pass


def _default_db():
    url, key = security_audit.env("SUPABASE_URL"), security_audit.env("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        return None
    return security_audit.Db(url, key)


def run_gate(argv=None, audit=None, make_db=None, selftest=None, sleep=time.sleep, retry_delay=RETRY_DELAY_S,
             state_path=ares2.SELFTEST_STATE):
    argv = list(argv or [])
    dry = "--dry" in argv
    audit = audit or security_audit.main
    selftest = selftest or run_selftest
    make_db = make_db or _default_db
    box = {}

    def db():
        if "db" not in box:
            try:
                box["db"] = make_db()
            except Exception:  # noqa: BLE001
                box["db"] = None
        return box["db"]

    def say(key, title, body, severity):
        if not dry and db() is not None:
            ares2.alert(db(), key, title, body, severity, "Open the Security page.")

    def clear(key, title):
        if not dry and db() is not None:
            ares2.resolve(db(), key, title)

    passed, tests, tail = selftest()
    _save_selftest_state(state_path, passed, tests)
    if not passed:
        failing = sorted(k for k, v in tests.items() if v != "ok")
        if not failing:
            failing = [ln.strip()[:100] for ln in tail.splitlines() if "FAIL" in ln][:3] or ["selftest did not finish"]
        say("security.selftest", "Ares: my own regression tests failed, tonight's audit did not run",
            "Failing: %s. Ares does not trust its own checks until these pass; nothing was audited tonight." % ", ".join(failing), "error")
        raise RuntimeError("selftest failed (%s): the audit did not run" % ", ".join(failing))
    clear("security.selftest", "Ares: regression tests pass again")

    try:
        return audit(argv)
    except Exception as exc:  # noqa: BLE001
        if dry:
            raise
        first = str(exc)[:160]
        say("security.run-failed", "Ares: the nightly security run failed, retrying once",
            "The run stopped (%s). Ares will wait %d minutes and try one more time." % (first, retry_delay // 60), "warning")
        sleep(retry_delay)
        retry_argv = argv if "--force" in argv else argv + ["--force"]
        try:
            res = audit(retry_argv)
        except Exception as exc2:  # noqa: BLE001
            say("security.run-failed", "Ares: the nightly security run failed twice",
                "The retry failed too (%s). Tonight's security audit did not complete and needs a person." % str(exc2)[:160], "error")
            raise RuntimeError("audit failed twice: %s" % str(exc2)[:160])
        clear("security.run-failed", "Ares: the security run recovered on retry")
        return "%s (after one retry: %s)" % (res, first)


def main(argv=None):
    return run_gate(argv)


if __name__ == "__main__":
    try:
        print(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001
        print("security-audit failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
