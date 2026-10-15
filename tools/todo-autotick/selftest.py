#!/usr/bin/env python3
"""Self-test. No network, no credentials, nothing written. Run before going live."""
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import todo_autotick as T  # noqa: E402

failures = []


def check(label, ok, detail=""):
    if not ok:
        failures.append("%s %s" % (label, detail))


def page(status, signers):
    def inp(name, val):
        return '<input type="hidden" id="initial-state-libresign-%s" value="%s">' % (
            name, base64.b64encode(json.dumps(val).encode()).decode())
    return inp("status", status) + inp("signers", signers)


# --- LibreSign parsing (shapes taken from the live page) ---------------------
unsigned = [{"signRequestId": 5, "signed": None, "status": 1, "statusText": "Ready to sign"}]
signed = [{"signRequestId": 5, "signed": "2026-10-16T01:00:00+00:00", "status": 2}]
check("partially signed, signer pending", T.parse_libresign(page(2, unsigned))[0] is False)
check("status 3 = signed", T.parse_libresign(page(3, unsigned))[0] is True)
check("all signers signed", T.parse_libresign(page(2, signed))[0] is True)
check("one of two signed", T.parse_libresign(page(2, signed + unsigned))[0] is False)
check("no signers, status 2", T.parse_libresign(page(2, []))[0] is False)
check("garbage page = unknown", T.parse_libresign("<html>login</html>")[0] is None)

# --- Mercury parsing ----------------------------------------------------------
check("invoice status", T.parse_invoice_status(b'{"id":"x","status":"Paid"}') == "Paid")
check("wrapped invoice", T.parse_invoice_status(b'{"invoice":{"status":"Unpaid"}}') == "Unpaid")
check("bad json", T.parse_invoice_status(b"nope") == "")

# --- core ---------------------------------------------------------------------
todos = [
    {"todo_id": "a", "kind": "invoice", "mercury_invoice_id": "i-paid"},
    {"todo_id": "b", "kind": "invoice", "mercury_invoice_id": "i-open"},
    {"todo_id": "c", "kind": "contract", "libresign_uuid": "u-signed"},
    {"todo_id": "d", "kind": "contract", "libresign_uuid": "u-open"},
    {"todo_id": "e", "kind": "invoice", "mercury_invoice_id": "i-unknown"},
]
inv = {"i-paid": "Paid", "i-open": "Unpaid", "i-unknown": ""}
con = {"u-signed": (True, {"file_status": 3}), "u-open": (False, {})}
calls = []
res = T.process(todos, lambda i: inv[i], lambda u: con[u],
                lambda tid, ev: calls.append((tid, ev)) or {"ok": True, "changed": True}, dry=False)
check("ticks a and c only", [c[0] for c in calls] == ["a", "c"], str(calls))
check("counts", (res["ticked"], res["waiting"], res["unknown"]) == (2, 2, 1), str(res))
check("evidence invoice", calls[0][1] == {"kind": "invoice", "mercury_invoice_id": "i-paid", "status": "Paid"})
check("evidence contract", calls[1][1]["signed"] is True and calls[1][1]["libresign_uuid"] == "u-signed")

calls.clear()
T.process(todos, lambda i: inv[i], lambda u: con[u], lambda *a: calls.append(a), dry=True)
check("dry never calls done", calls == [])


def refuse(i):
    raise T.Skip("Mercury token is not allowed from this IP")


calls.clear()
res = T.process(todos, refuse, lambda u: con[u], lambda tid, ev: calls.append(tid) or {"ok": True, "changed": True}, dry=False)
check("mercury refused: invoices stay open, contract still ticks", calls == ["c"], str(calls))
check("mercury refused: one skip note", len(set(res["skips"])) == 1)

check("only GET in worker", all(w not in open(T.__file__).read() for w in ('method="POST"', 'method="PUT"', 'method="DELETE"', 'method="PATCH"')))

if failures:
    print("SELFTEST FAILED:\n  " + "\n  ".join(failures))
    sys.exit(1)
print("selftest ok")
