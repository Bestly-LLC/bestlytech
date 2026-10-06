"""Studio watchdog - replaces the hourly Claude task "Studio watchdog".

Every 5 min, live probes (faster than the old hourly log read):
  front end  : studio.bestly.tech/ and /centering-you must be HTTP 200
  database   : a REST round trip (pi_jobs read) must answer, under 3 s = healthy
  storage    : a public object in the review bucket must be HTTP 200
Verdict OK / DEGRADED / DOWN. It only speaks on a CHANGE of verdict, and only after 2 bad runs in a row
(one blip is not an outage). When the database is the thing that's down, Scout (which lives in the
database) can't deliver, so the alert also goes straight to ntfy from the Pi.
It never redeploys, pauses, restores, or edits anything - it reports which layer broke and what to do.
Also checks status.supabase.com when something is wrong, because during a platform incident a restart
can make things worse.
"""
import json
import os
import time
import urllib.error
import urllib.request

import lib

STATE = "/var/tmp/bestly-studio-watch.json"
UA = {"User-Agent": "bestly-pi-watchdog/1.0"}


def _get(url, headers=None, timeout=20):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={**UA, **(headers or {})})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read(2048)
            return r.status, time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, time.time() - t0
    except Exception as e:  # noqa: BLE001
        return f"ERR {type(e).__name__}", time.time() - t0


def _ntfy(title, body):
    topic = os.environ.get("NTFY_TOPIC", "")
    if not topic:
        return
    url = topic if topic.startswith("http") else "https://ntfy.sh/" + topic
    try:
        req = urllib.request.Request(url, data=body.encode(), method="POST",
                                     headers={**UA, "Title": title, "Priority": "4", "Tags": "warning"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception:  # noqa: BLE001
        pass


def _supabase_incident():
    try:
        req = urllib.request.Request("https://status.supabase.com/api/v2/summary.json", headers=UA)
        with urllib.request.urlopen(req, timeout=15) as r:
            j = json.load(r)
        live = [i["name"] for i in j.get("incidents", []) if i.get("status") != "resolved"]
        return "; ".join(live)[:200]
    except Exception:  # noqa: BLE001
        return ""


def _probe():
    fe = [_get("https://studio.bestly.tech/"), _get("https://studio.bestly.tech/centering-you")]
    hdr = {"apikey": lib.KEY}
    if lib.KEY.startswith("eyJ"):
        hdr["Authorization"] = "Bearer " + lib.KEY
    db = _get(lib.URL + "/rest/v1/pi_jobs?select=job&limit=1", hdr)
    st = _get(lib.URL + "/storage/v1/object/public/review/tools/build2.dd5caadcf9.js")
    fe_ok = all(s == 200 for s, _ in fe)
    db_ok = db[0] == 200
    st_ok = st[0] == 200
    problems = []
    if not db_ok:
        problems.append(f"DATABASE API is down ({db[0]}). Known failure: do NOT redeploy - the front end is fine. "
                        "Next step: Supabase dashboard > project Bestly > restart, if it stays down 10+ min.")
    if not fe_ok:
        problems.append(f"STUDIO FRONT END is down ({', '.join(str(s) for s, _ in fe)}). The deployment is broken: "
                        "roll back to the last good deploy in Vercel (Studio project).")
    if not st_ok:
        problems.append(f"STORAGE is down ({st[0]}). Nothing to fix on our side - Supabase storage issue.")
    verdict = "DOWN" if problems else "OK"
    if verdict == "OK" and db[1] > 3.0:
        verdict = "DEGRADED"
        problems.append(f"Database is slow ({db[1]:.1f} s for a tiny read, normal is well under 1 s).")
    detail = f"db {db[1] * 1000:.0f} ms, front end {max(t for _, t in fe) * 1000:.0f} ms"
    return verdict, problems, detail


def _content_tools(argv):
    """Hourly (2026-10-06): the content playbook every writer reads, and the research credits Spark spends.
    Self-heals the Pi cache (playbook.rules refreshes it); alerts only when a person must act."""
    if time.localtime().tm_min >= 5 or "--dry" in argv:
        return ""
    import playbook
    notes = []
    try:
        text = lib.rpc("studio_content_playbook", p_role="writing") or ""
    except Exception as e:  # noqa: BLE001  DB down is the probe above; writers fall back to the cache
        return f" playbook: db unreachable ({type(e).__name__}), writers use the cached copy"
    if not text.strip():
        lib.notify("Content playbook is empty",
                   "studio_content_playbook returned nothing, so the daily writers and Montage are writing without the "
                   "scroll-stopping-creative rules. Fix: re-activate the rows in studio_content_skills (active = true).",
                   "warning", False, "/admin", "studio:playbook-empty")
        notes.append("playbook EMPTY")
    else:
        try:
            os.remove(os.path.join(playbook.STATE, "playbook-writing.txt"))
        except OSError:
            pass
        notes.append(f"playbook {len(playbook.rules())} chars")
    try:
        key = lib.rpc("pi_secret_get", p_name="pi:sgai_api_key")
        req = urllib.request.Request("https://v2-api.scrapegraphai.com/api/credits", headers={**UA, "SGAI-APIKEY": key})
        with urllib.request.urlopen(req, timeout=20) as r:
            left = int(json.load(r).get("remaining", 0))
        notes.append(f"research credits {left}")
        if left < 50:
            lib.notify(f"Research credits low: {left} left",
                       "Spark web_research (ScrapeGraph, free one-time allowance) is nearly out. At 25 it stops by itself. "
                       "Top up at dashboard.scrapegraphai.com or leave it: content still gets written without research.",
                       "info", False, "/admin", "studio:research-credits-low")
    except Exception as e:  # noqa: BLE001
        notes.append(f"research check failed ({type(e).__name__})")
    return " " + ", ".join(notes)


def main(argv):
    verdict, problems, detail = _probe()
    try:
        with open(STATE) as f:
            st = json.load(f)
    except Exception:  # noqa: BLE001
        st = {"reported": "OK", "bad_runs": 0, "since": None}
    st["bad_runs"] = st["bad_runs"] + 1 if verdict != "OK" else 0
    now = time.strftime("%I:%M %p").lstrip("0")
    msg = None
    if verdict != "OK" and st["bad_runs"] >= 2 and st["reported"] != verdict:
        st["since"] = st["since"] or now
        inc = _supabase_incident()
        body = " ".join(problems) + f" Failing since about {st['since']}." + (
            f" Supabase has an open incident: {inc} - wait it out, a restart can make it worse." if inc else "")
        msg = (f"Studio {verdict}", body)
        st["reported"] = verdict
    elif verdict == "OK" and st["reported"] != "OK":
        msg = ("Studio is back", f"Studio recovered at {now} (was {st['reported']} since {st['since']}). {detail}.")
        st["reported"], st["since"] = "OK", None
    elif verdict != "OK" and not st.get("since"):
        st["since"] = now
    with open(STATE, "w") as f:
        json.dump(st, f)
    if msg and "--dry" not in argv:
        _ntfy(*msg)
        try:
            lib.notify(msg[0], msg[1], "warning" if verdict != "OK" else "info", True, "/admin", None)
        except Exception:  # noqa: BLE001  DB down: ntfy already carried it
            pass
    try:
        extra = _content_tools(argv)
    except Exception as e:  # noqa: BLE001  never let this break the outage watch
        extra = f" content check failed ({type(e).__name__})"
    if verdict == "OK":
        return f"ok: Studio OK, {detail}{extra}"
    return f"{verdict}: {' '.join(problems)[:300]} ({detail}, bad runs {st['bad_runs']}){extra}"
