#!/usr/bin/env python3
"""Replay the classifier over real inbox senders. No mailbox, no moves."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inbox_cleaner_rules as R  # noqa: E402

rows = json.load(open(sys.argv[1], encoding="utf-8"))
kill, keep, ask = [], [], []

for row in rows:
    addr = (row["from_addr"] or "").lower()
    subjects = [row.get("s1") or "", row.get("s2") or ""]
    n = row["n"]
    real = R.unmask_relay(addr)
    protected = all(
        R.is_protected_message(addr, "", s) for s in subjects if s
    )
    any_protected = any(R.is_protected_message(addr, "", s) for s in subjects if s)
    if R.is_known_marketing(addr) or R.is_job_alert(addr):
        kill.append((n, addr, real, "known"))
        continue
    if any_protected:
        keep.append((n, addr, real, "protected" + ("" if protected else " (partial)")))
        continue
    score = R.marketing_score(subjects, True, n)  # assume List-Unsubscribe present
    if score >= R.AUTO_KILL_SCORE:
        kill.append((n, addr, real, "score %.2f" % score))
    elif score < R.IGNORE_BELOW_SCORE:
        keep.append((n, addr, real, "score %.2f" % score))
    else:
        ask.append((n, addr, real, "score %.2f -> free AI" % score))

def show(title, rows_):
    total = sum(r[0] for r in rows_)
    print("\n%s -- %d senders, %d messages" % (title, len(rows_), total))
    for n, addr, real, why in sorted(rows_, reverse=True):
        shown = real if real != addr else addr
        print("  %4d  %-46s %s" % (n, shown[:46], why))

show("WOULD TRASH", kill)
show("ASK FREE AI", ask)
show("LEAVE ALONE", keep)
