"""Shared runner for scripts moved off the Mac mini (Wave A, 2026-10-03). Installed at /opt/bestly/cron/jobs/macmoved.py.

Runs a script with /opt/bestly/bin first on PATH, so its macOS `security` Keychain calls are answered from
Supabase Vault (pi:<service>:<account>) instead. Non-zero exit = failed run (pi_job_report -> Scout).
"""
import os
import subprocess

ENV = {**os.environ, "PATH": "/opt/bestly/bin:/usr/local/bin:/usr/bin:/bin", "HOME": "/home/pi"}
# Known noise from before the move (the Mac logged it 13,884 times): the mail-queue endpoint is gone.
NOISE = ("queue unavailable (400",)


def run(cmd, cwd, timeout=540, dry=False):
    if dry:
        return f"ok (dry) would run: {' '.join(cmd)}"
    p = subprocess.run(cmd, cwd=cwd, env=ENV, capture_output=True, text=True, timeout=timeout)
    lines = [l.strip() for l in (p.stdout + "\n" + p.stderr).splitlines() if l.strip() and not any(n in l for n in NOISE)]
    tail = " | ".join(lines[-4:])[:600]
    if p.returncode != 0:
        raise RuntimeError(f"exit {p.returncode}: {tail}")
    new = [l for l in lines if " new" in l and "nothing new" not in l]
    return f"ok {len(new)} folder(s) with new mail" if new else f"ok nothing new ({tail[:160]})"
