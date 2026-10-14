#!/usr/bin/env python3
"""Self-test. No network, no credentials, nothing written. Run before going live."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mercury_sync as M  # noqa: E402

failures = []


def check(label, ok, detail=""):
    if not ok:
        failures.append("%s %s" % (label, detail))


def unfolded_lines(raw):
    return M.unfold(raw.decode("utf-8")).split("\r\n")


# --- email normalisation / matching ------------------------------------------
for raw, want in (("Jane@Example.COM", "jane@example.com"), ("  mailto:A@b.co ", "a@b.co"),
                  ("", ""), (None, ""), ("not an email", ""), ("a@b", ""),
                  ("x@y.com;evil@z.com", ""), ("x@y.com\nBCC:z@z.com", ""), ('"q"@y.com', "")):
    check("normalize_email(%r)" % (raw,), M.normalize_email(raw) == want,
          "-> %r" % M.normalize_email(raw))

# --- vCard building ----------------------------------------------------------
card = M.build_vcard("Jane Q. Public", "jane@example.com", "11111111-2222-3333-4444-555555555555")
lines = unfolded_lines(card)
check("vcard ends with CRLF", card.endswith(b"\r\n"))
check("vcard frame", lines[0] == "BEGIN:VCARD" and lines[-2] == "END:VCARD")
for want in ("VERSION:3.0", "UID:11111111-2222-3333-4444-555555555555", "FN:Jane Q. Public",
             "N:Public;Jane Q.;;;", "EMAIL;TYPE=WORK:jane@example.com",
             "NOTE:Synced from Mercury Invoicing", "CATEGORIES:Mercury Customer"):
    check("vcard has " + want, want in lines)

org = unfolded_lines(M.build_vcard("Elizabeth A O’Brien & Associates LLC", "e@example.com", "u"))
check("company goes whole into N family slot",
      "N:Elizabeth A O’Brien & Associates LLC;;;;" in org, str(org))
one = unfolded_lines(M.build_vcard("Madonna", "m@example.com", "u"))
check("one-word name", "N:Madonna;;;;" in one and "FN:Madonna" in one)
blank = unfolded_lines(M.build_vcard("", "who@example.com", "u"))
check("empty name falls back to email", "FN:who@example.com" in blank)

# injection: newlines in a name must not create new properties
evil = M.build_vcard("Bob\r\nEMAIL:attacker@evil.com\r\nEND:VCARD\r\nBEGIN:VCARD", "bob@example.com", "u")
check("name cannot inject lines", sum(1 for l in unfolded_lines(evil) if l.startswith("EMAIL")) == 1,
      str(unfolded_lines(evil)))
check("name cannot add a second card",
      sum(1 for l in unfolded_lines(evil) if l == "BEGIN:VCARD") == 1
      and sum(1 for l in unfolded_lines(evil) if l == "END:VCARD") == 1)
esc = unfolded_lines(M.build_vcard("Smith, John; Jr\\", "s@example.com", "u"))
check("escaping", "FN:Smith\\, John\\; Jr\\\\" in esc, str(esc))

# folding is lossless, within 75 octets, and never splits a multibyte char
long_name = "Zoë " + "é" * 120 + " Corp"
long_card = M.build_vcard(long_name, "z@example.com", "u")
check("folded lines <= 75 octets", all(len(l.encode("utf-8")) <= 75 for l in long_card.decode("utf-8").split("\r\n")))
check("fold round-trips", ("FN:" + M.vcard_escape(M.clean_text(long_name))) in unfolded_lines(long_card))

# --- parsing an existing address book ----------------------------------------
MULTISTATUS = b"""<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
 <d:response><d:href>/a.vcf</d:href><d:propstat><d:prop><card:address-data>BEGIN:VCARD
VERSION:3.0
FN:Old One
EMAIL;TYPE=HOME:Old.One@Example.com
EMAIL;TYPE=WORK:second@
 example.com
END:VCARD
</card:address-data></d:prop></d:propstat></d:response>
 <d:response><d:href>/b.vcf</d:href><d:propstat><d:prop><card:address-data>BEGIN:VCARD
VERSION:4.0
FN:Grouped
item1.EMAIL;type=INTERNET:mailto:grouped@example.com
END:VCARD
</card:address-data></d:prop></d:propstat></d:response>
 <d:response><d:href>/c.vcf</d:href><d:propstat><d:prop><card:address-data>BEGIN:VCARD
VERSION:3.0
FN:No Email
NOTE:EMAIL:fake@example.com is only a note
END:VCARD
</card:address-data></d:prop></d:propstat></d:response>
</d:multistatus>"""
emails, cards = M.parse_existing(MULTISTATUS)
check("parse card count", cards == 3, str(cards))
check("parse emails", emails == {"old.one@example.com", "second@example.com", "grouped@example.com"},
      str(sorted(emails)))
check("NOTE text is not an email", "fake@example.com" not in emails)

# --- the sync core -----------------------------------------------------------
CUSTOMERS = [
    {"id": "1", "name": "Old One", "email": "OLD.one@example.com"},      # already there (case differs)
    {"id": "2", "name": "New Person", "email": "new@example.com"},       # create
    {"id": "3", "name": "Dup Person", "email": "NEW@example.com"},       # same email as #2
    {"id": "4", "name": "No Mail", "email": ""},                          # nothing to match on
    {"id": "5", "name": "Second New", "email": "second.new@example.com"},  # create
    {"id": "6", "name": "Third New", "email": "third.new@example.com"},    # create (over cap of 2)
    {"id": "7", "name": "Race", "email": "race@example.com"},              # server says 412
]


def run(max_create, dry, status_for=lambda uid, n: 201):
    calls = []

    def put(vcard, uid):
        calls.append((vcard, uid))
        return status_for(uid, len(calls))

    n = iter(range(1, 1000))
    res = M.sync_contacts(CUSTOMERS, {"old.one@example.com"}, put, max_create, dry,
                          new_uid=lambda: "uid-%d" % next(n))
    return res, calls


M.PAUSE_SECONDS = 0
M.log = lambda *a, **k: None  # keep the output clean
res, calls = run(200, False, lambda uid, k: 412 if k == 4 else 201)
check("created count", res["created"] == 3, str(res))
check("existing skipped", res["exists"] == 2, str(res))     # Old One + the 412
check("dup in mercury", res["dup_in_mercury"] == 1, str(res))
check("no email", res["no_email"] == 1, str(res))
check("only missing customers were PUT", len(calls) == 4, str(len(calls)))
check("existing contact never PUT",
      not any(b"old.one@example.com" in v.lower() for v, _ in calls))
check("created ids tracked", res["created_ids"] == ["2", "5", "6"], str(res["created_ids"]))

res, calls = run(2, False)
check("cap honoured", res["created"] == 2 and res["over_cap"] == 2 and len(calls) == 2, str(res))
res, calls = run(0, False)
check("cap of zero creates nothing", res["created"] == 0 and not calls, str(res))
res, calls = run(200, True)
check("dry run PUTs nothing", not calls and res["created"] == 4, str(res))

res, calls = run(200, False, lambda uid, k: 500 if k == 1 else 201)
check("one failure is counted and the run continues", res["failed"] == 1 and res["created"] == 3, str(res))
MANY = list(CUSTOMERS)
CUSTOMERS[:] = [{"id": str(n), "name": "P%d" % n, "email": "p%d@example.com" % n} for n in range(8)]
try:
    run(200, False, lambda uid, k: 403)
    check("repeated failures stop the run", False, "no exception")
except RuntimeError:
    pass
CUSTOMERS[:] = MANY

# the duplicate check really sits between vCard build and PUT: a email learned from a
# 412 is never PUT again even if Mercury lists it twice under different cases
CUSTOMERS[:] = [{"id": "a", "name": "A", "email": "x@example.com"},
                {"id": "b", "name": "B", "email": "X@example.com"}]
res, calls = run(200, False, lambda uid, k: 412)
check("a 412 is remembered", len(calls) == 1 and res["exists"] == 1 and res["dup_in_mercury"] == 1, str(res))

# --- Mercury error classification -------------------------------------------
ip = json.dumps({"errors": {"errorCode": "ipNotWhitelisted", "ip": "1.2.3.4"}}).encode()
check("ip not whitelisted", "not allowed from this IP" in M.classify_mercury_error(401, ip))
check("403 -> scope", "lacks invoicing scope" in M.classify_mercury_error(403, b"{}"))
check("404", "no /ar/customers endpoint" in M.classify_mercury_error(404, b""))
check("500 is not a skip", M.classify_mercury_error(500, b"") == "")
check("error text never echoes the body", "secret-body" not in M.classify_mercury_error(401, b"secret-body"))

# --- summary line ------------------------------------------------------------
line = M.summarize({"customers": 9, "created": 2, "exists": 6, "no_email": 1, "dup_in_mercury": 0,
                    "failed": 0, "over_cap": 0}, True)
check("summary", line == "DRY would create 2, 6 already in Nextcloud, 1 no usable email (of 9 Mercury customers)", line)

if failures:
    print("SELF-TEST FAILED (%d):" % len(failures))
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("self-test passed: vCard, injection, folding, parsing, matching, cap, dry, 412, errors")
