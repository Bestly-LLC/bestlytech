"""Stella, the reader (10:03 AM and 6:03 PM Pi time = LA).

Reads Turo's Ratings & reviews page and Performance page from the Pi's signed-in Turo browser (read only, never signs in),
copies every review + the All-Star numbers into Supabase, then runs the All-Star coach.
Drafting and posting happen in stella_queue. Nothing here ever posts.

Flags: --dry  read and parse, print what would be saved, write nothing
"""
import datetime
import hashlib
import json
import re
import subprocess

import lib

VENV_PY = "/opt/bestly/turo-watch/.venv/bin/python"
READER = "/opt/bestly/cron/tools/turo_reviews_reader.py"
URL = "https://bestly.tech/admin/turo?tab=reviews"
CATS = ["Maintenance", "Cleanliness", "Accuracy", "Communication", "Convenience"]


def read_turo(args=()):
    p = subprocess.run([VENV_PY, READER, *args], capture_output=True, text=True, timeout=300)
    line = [x for x in p.stdout.splitlines() if x.startswith("{")]
    if not line:
        raise RuntimeError("reader printed no JSON: " + (p.stderr or p.stdout)[-300:])
    return json.loads(line[-1])


def _f(rx, txt, cast=float):
    m = re.search(rx, txt, re.S)
    return cast(m.group(1)) if m else None


def parse_summary(txt):
    s = {
        "pct_5star": _f(r"Overall\s+(\d+)%", txt),
        "unrated_pct": _f(r"Unrated\s+(\d+)%", txt),
        "trips_365": _f(r"Trips\s+(\d+)\s+Ratings", txt, int),
        "ratings": _f(r"Ratings\s+(\d+)\s+Average", txt, int),
        "avg_rating": _f(r"Average\s+([\d.]+)", txt),
    }
    s["cat"] = {c: _f(c + r"\s+(\d+)%", txt, int) for c in CATS if _f(c + r"\s+(\d+)%", txt, int) is not None}
    s["flags"] = {m.group(1).strip(): int(m.group(2)) for m in re.finditer(r"^(?!Reviews)([A-Za-z][A-Za-z ]+?) \((\d+)\)\s*$", txt, re.M)}
    return s


def parse_perf(txt):
    status = _f(r"All-Star Host status\s+(\w+)", txt, str)
    return {
        "all_star": (status or "").lower() == "achieved" if status else None,
        "all_star_status": status,
        "next_assessment": _f(r"Next assessment is ([A-Za-z]+ \d+)", txt, str),
        "window_label": _f(r"(\d+/\d+/\d+ - \d+/\d+/\d+)", txt, str),
        "cancellation_rate": _f(r"Cancellation rate\s+([\d.]+)%", txt),
        "five_star_rate": _f(r"Five-star rate\s+([\d.]+)%", txt),
        "maintenance_rate": _f(r"Maintenance rate\s+([\d.]+)%", txt),
        "cleanliness_rate": _f(r"Cleanliness rate\s+([\d.]+)%", txt),
        "completed_trips": _f(r"Completed trips\s+(\d+)", txt, int),
    }


def to_payload(reviews):
    out = []
    for r in reviews:
        if r["stars"] is None and r["guest"] == "Turo":          # Turo's automatic note, e.g. host cancel
            body = (r["rest"] or [""])[0]
            out.append({"guest_first": "Turo", "vehicle": r["vehicle"], "plate": r["plate"], "review_date": r["date"], "stars": None,
                        "text": "", "kind": "system", "system_event": "host_cancel" if "cancel" in body.lower() else "other",
                        "respond_available": False, "has_response": False})
            continue
        rest = r["rest"]
        out.append({"guest_first": r["guest"], "vehicle": r["vehicle"], "plate": r["plate"], "review_date": r["date"], "stars": r["stars"],
                    "flags": [], "text": rest[0] if rest else "", "kind": "review",
                    "respond_available": bool(r["respond"]), "has_response": len(rest) >= 2,
                    "response_text": rest[1] if len(rest) >= 2 else None})
    return out


def main(argv):
    dry = "--dry" in argv
    data = read_turo()
    if not data.get("signed_in"):
        if not dry:
            rows = lib.get("reputation_settings", "select=seen_signed_out_at&id=eq.true") or [{}]
            last = rows[0].get("seen_signed_out_at")
            if not last or (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(last)).total_seconds() > 86400:
                lib.rpc("rep_notify", p_agent="stella", p_title="Turo is signed out on the Pi",
                        p_body="I cannot read your reviews until someone signs the Pi Turo browser back in. I never enter passwords.",
                        p_kind="recap", p_url=URL, p_dedupe="stella-signedout-" + datetime.date.today().isoformat())
                lib._req("PATCH", "/rest/v1/reputation_settings?id=eq.true", {"seen_signed_out_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
        return "no read: Turo signed out on the Pi"
    reviews = data["reviews"]
    if len(reviews) < 5:
        return f"skip: reader returned only {len(reviews)} reviews ({data.get('error') or 'page glitch'})"
    payload = to_payload(reviews)
    stats = {**parse_summary(data.get("summary_text", "")), **parse_perf(data.get("perf_text", ""))}
    cutoff = (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
    stats["host_cancels_365"] = sum(1 for p in payload if p.get("system_event") == "host_cancel" and (p["review_date"] or "") >= cutoff)
    stats["reviews_read"] = len(reviews)
    if dry:
        return f"ok(dry): {len(payload)} reviews, stats {json.dumps(stats)[:400]}"
    res = lib.rpc("rep_sync_reviews", p=payload)
    note = ""
    if stats.get("five_star_rate") is not None and stats.get("completed_trips"):
        lib.rpc("rep_save_stats", p=stats)
        coach = lib.rpc("allostar_coach") or {}
        if coach.get("at_risk") or coach.get("all_star") is False:
            lib.rpc("rep_notify", p_agent="stella", p_title="All-Star is at risk" if coach.get("all_star") else "All-Star status lost",
                    p_body=coach.get("message") or "Your All-Star status needs attention.", p_kind="allostar_risk", p_url=URL,
                    p_dedupe="allostar-" + datetime.date.today().isoformat() + "-" + hashlib.md5(coach.get("message", "").encode()).hexdigest()[:8])
            note = " coach: AT RISK"
    else:
        note = " (performance numbers not found, stats not saved)"
    return f"ok: {len(payload)} reviews read, {res.get('new', 0)} new, {res.get('updated', 0)} updated{note}"
