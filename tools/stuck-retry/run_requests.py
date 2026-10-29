"""run_requests -- run a Pi job right now because the Command Center asked (Pi cron, every minute). Built 2026-10-28.

Why: the stuck card's "Retry now" on an employee that runs on bestly-pi cannot reach into the Pi. The database writes a row
in pi_run_requests (stuck_run_retry), and this job, which runs every minute, claims it and runs that job through the same
/opt/bestly/cron/run.sh wrapper cron uses, so the run is reported to pi_jobs / pi_job_runs / agent_beats exactly like a
scheduled one. It then tells the database whether it worked (pi_run_finish); the card turns that into "ran fine" or the reason.

Safety:
  * only the job NAME comes from the database, and it must look like a job name (letters, digits, _ and -);
    run.sh refuses a name that is not an installed, enabled job
  * pi_run_claim only hands out jobs that are enabled in pi_jobs, and expires requests older than 10 minutes
  * this job never runs itself
  * one copy at a time (a lock file); at most 3 requests per minute; each job gets 10 minutes
  * no AI, no network except the Supabase service-role calls the other Pi jobs already make
Off switch: touch /opt/bestly/cron/state/run_requests.OFF   (requests then wait, and the card says the runner may be off)
"""
import fcntl
import os
import re
import subprocess
import sys

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402

SELF = "run_requests"
RUN = os.environ.get("RUN_REQUESTS_RUN_SH", "/opt/bestly/cron/run.sh")
OFF = os.environ.get("RUN_REQUESTS_OFF", "/opt/bestly/cron/state/run_requests.OFF")
LOCK = os.environ.get("RUN_REQUESTS_LOCK", "/opt/bestly/cron/state/run_requests.lock")
JOB_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
PER_RUN = 3
TIMEOUT = 600


def last_line(text):
    """The line that says what went wrong is usually the last one. The database classifies the FIRST line of a summary, so send that."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    return (lines[-1] if lines else "no output")[:300]


def run_job(job):
    """-> (ok, one-line summary). Never raises."""
    if not JOB_RE.match(job or ""):
        return False, "refused: %r is not a job name" % (job,)
    if job == SELF:
        return False, "refused: this job does not run itself"
    try:
        p = subprocess.run([RUN, job], capture_output=True, text=True, timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        return False, "timed out after %d minutes" % (TIMEOUT // 60)
    except Exception as e:  # noqa: BLE001
        return False, ("could not start: %s" % e)[:300]
    out = (p.stdout or "") + "\n" + (p.stderr or "")
    if p.returncode == 0:
        return True, last_line(p.stdout) if (p.stdout or "").strip() else "ok"
    return False, last_line(out)


def main(argv):
    if os.path.exists(OFF):
        return "off (the switch file is present); requests wait"
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    fh = open(LOCK, "w")
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return "busy: another copy is still running a request"
    ran = []
    try:
        for _ in range(PER_RUN):
            req = lib.rpc("pi_run_claim")
            if not isinstance(req, dict) or not req.get("id"):
                break
            job = str(req.get("job") or "")
            ok, summary = run_job(job)
            lib.rpc("pi_run_finish", p_id=req["id"], p_ok=ok, p_summary=summary)
            ran.append("%s %s" % (job, "ok" if ok else "FAILED"))
    finally:
        fh.close()
    return "ok ran %d: %s" % (len(ran), ", ".join(ran)) if ran else "ok nothing waiting"


if __name__ == "__main__":
    print(main(sys.argv[1:]))
