"""Vera, Compliance Officer: daily checks. Runs on the Pi at about 6:20 AM PT (bestly-cron). Free: no AI, no Claude.

Reads every active row of compliance_checks with every='daily' (live pages, privacy parity, agent settings, data rules, deadlines),
runs them, and hands the results to compliance_check_report, which keeps the alert state (a newly failing check raises once,
then again at 3, 6 and 9 days, never nightly) and writes the compliance_runs row.
Fails the job (Scout hears about it) if more than half the checks could not run.

Flags: --dry (print results, write nothing), --only <check id prefix>
Off switch: touch /opt/bestly/cron/state/compliance_daily.OFF   (or compliance.OFF to stop both jobs)
"""
import datetime
import json
import sys

import lib
import compliance_common as cc


def main(argv):
    dry = "--dry" in argv
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    off = cc.off_switch("compliance_daily")
    if off:
        return f"skip: {off}"
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    checks = lib.get("compliance_checks", "select=*&active=is.true&every=eq.daily&order=id")
    results = cc.run_checks(checks, dry=dry, only=only)
    ok, bad, err = cc.summarize(results)
    if dry:
        for r in results:
            mark = {True: "PASS", False: "FAIL", None: "ERR "}[r["ok"]]
            print(f"{mark} {r['id']}  {r['detail'][:200]}")
        return f"dry: {len(results)} checks, {ok} pass, {len(bad)} fail, {len(err)} could not run"
    rep = lib.rpc("compliance_check_report", p={"kind": "daily", "started_at": started,
                                                 "results": [{"id": r["id"], "ok": r["ok"], "detail": r["detail"]} for r in results]})
    if results and len(err) * 2 > len(results):
        raise RuntimeError(f"{len(err)} of {len(results)} checks could not run: " + ", ".join(r["id"] for r in err[:6]))
    return "ok: " + (rep.get("summary") if isinstance(rep, dict) else str(rep))


if __name__ == "__main__":
    print(main(sys.argv[1:]))
