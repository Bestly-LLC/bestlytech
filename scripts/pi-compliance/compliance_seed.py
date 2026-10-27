#!/usr/bin/env python3
"""Load Vera's first findings, checks, deadlines, law sources and context from seed.json. Safe to re-run: existing rows are kept
(resolution=ignore-duplicates), so nothing Vera or Jared changed later is overwritten and nothing is deleted.
Usage on the Pi: cd /opt/bestly/cron && python3 compliance_seed.py /path/to/seed.json
"""
import json
import sys

import lib

HDR = {"Prefer": "resolution=ignore-duplicates,return=minimal"}


def put(table, rows, conflict):
    n = 0
    groups = {}
    for r in rows:  # PostgREST bulk insert needs identical keys in every object, so batch rows by their key set
        groups.setdefault(tuple(sorted(r)), []).append(r)
    for grp in groups.values():
        for i in range(0, len(grp), 40):
            lib._req("POST", f"/rest/v1/{table}?on_conflict={conflict}", grp[i:i + 40], timeout=60, headers=HDR)
            n += len(grp[i:i + 40])
    print(f"{table}: sent {n}")


def main(path):
    s = json.load(open(path))
    put("compliance_findings", s["findings"], "key")
    put("compliance_checks", s["checks"], "id")
    put("compliance_deadlines", s["deadlines"], "key")
    put("law_watch_sources", [dict(x, active=True) for x in s["law_sources"]], "id")
    put("compliance_context", [{"id": 1, "body": s["context"]}], "id")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "seed.json")
