"""Wall quote sync - keeps Supabase wall_quotes matching the wall's deck (/opt/bestly/wall/quotes.json).

The admin's loader cards read wall_quotes, so a quote added or removed on the wall shows up in the
admin within 15 minutes. Only talks to Supabase when the file actually changed (hash in STATE).
Mantras are entries whose author is "Mantra": stored as kind 'mantra' with no author.
Entries that leave the file are marked inactive, never deleted.
Installed at /opt/bestly/cron/jobs/quote_sync.py; cron: */15 * * * * /opt/bestly/cron/run.sh quote_sync
"""
import hashlib
import json
import os
import urllib.error
import urllib.request

import lib

QUOTES = "/opt/bestly/wall/quotes.json"
STATE = "/var/tmp/bestly-quote-sync.json"


def _post(path, body, prefer):
    headers = {"apikey": lib.KEY, "Content-Type": "application/json", "Prefer": prefer}
    if lib.KEY.startswith("eyJ"):
        headers["Authorization"] = "Bearer " + lib.KEY
    req = urllib.request.Request(lib.URL + path, data=json.dumps(body).encode(), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST {path.split('?')[0]} -> HTTP {e.code}: {e.read().decode()[:300]}")


def main(argv):
    raw = open(QUOTES, "rb").read()
    digest = hashlib.sha256(raw).hexdigest()
    force = "--force" in argv
    try:
        last = json.load(open(STATE)).get("hash")
    except Exception:  # noqa: BLE001
        last = None
    if last == digest and not force:
        return "ok no change"

    deck = json.loads(raw)
    rows = []
    for q in deck.get("quotes", []):
        text = (q.get("t") or "").strip()
        qid = (q.get("id") or "").strip()
        if not text or not qid:
            continue
        author = (q.get("a") or "").strip()
        mantra = author.lower() == "mantra" or not author
        rows.append({"id": qid, "text": text, "author": None if mantra else author,
                     "kind": "mantra" if mantra else "quote", "active": True})
    if not rows:
        raise RuntimeError("quotes.json has no quotes; refusing to blank the admin deck")

    if "--dry" not in argv:
        _post("/rest/v1/wall_quotes?on_conflict=id", rows, "resolution=merge-duplicates,return=minimal")
        live = lib.get("wall_quotes", "select=id&active=eq.true") or []
        keep = {r["id"] for r in rows}
        gone = [r["id"] for r in live if r["id"] not in keep]
        for gid in gone:
            lib._req("PATCH", f"/rest/v1/wall_quotes?id=eq.{gid}", {"active": False})
        with open(STATE, "w") as f:
            json.dump({"hash": digest}, f)
        return f"synced {len(rows)} quotes, retired {len(gone)}"
    return f"dry: would sync {len(rows)}"
