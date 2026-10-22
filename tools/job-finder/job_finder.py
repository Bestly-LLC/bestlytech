"""Job Finder: daily 7:00 AM search for Jared's kind of job, onto the Nextcloud Deck "Job Search" board (bestly-pi, free).

Installed as /opt/bestly/cron/jobs/job_finder.py; run by /opt/bestly/cron/run.sh job_finder (heartbeat via runjob.py).
Replaces the Claude scheduled task "Job Finder" (trig_01W3dUTL4HFVoCcfRYFAW8GG, left disabled as the fallback).

What it does, same as the Claude task:
  1. Searches LinkedIn's public guest job search (no login) in tiers:
       A  skill match near 90069 (account management, customer success, partnerships, BD, sales, solutions) plus
          forward deployed engineer / solutions engineer / implementation roles (near LA and remote US)
       B  wider LA commute (adjacent lanes, hospitality and guest services management)
       C  walkable West Hollywood retail, hospitality, concierge, front desk
  2. Scores them against Jared's profile, drops what is too far, and drops EVERY overnight / graveyard / night audit / third shift
     role (checked in the title AND in the full job text; if the text cannot be read the role is held back, never posted).
  3. Posts the best new ones to the board's New stack (board 7) with a tier label, skipping anything already on the board in any stack
     or in the archive (the <!-- linkedin-id: N --> marker in the card).
  4. Sweeps the Shortlist: a card whose posting is gone or says it no longer accepts applications is moved to Closed.
  5. Adds one plain sentence per new card from the free AI ("what the role is, any red flags"). It never says anything about Jared.

What it does NOT do (the Claude task could, with a browser): submit applications. This job only finds and files. The Next-step checklist
on each card is for Jared.

Credentials come from Supabase Vault through the Pi's pi_secret (nextcloud_user, nextcloud_app_password, nextcloud_base_url).
Nothing secret is ever written to a file, a log or the job summary.

Flags: --dry (search and score only: no Deck writes, no notification, no heartbeat), --limit N (cap new cards per tier).
"""
import base64
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

import lib  # noqa: E402  (/opt/bestly/cron/lib.py)

try:
    import freellm  # noqa: E402
except Exception:  # noqa: BLE001
    freellm = None

JOB = "job_finder"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
SEARCH = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
DETAIL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/%s"
BOARD = 7
STACK_NEW_FALLBACK = 33
LABEL = {"A_skill_match": 40, "B_commute_45min": 41, "C_walkable_retail": 42}
TIER_NAME = {"A_skill_match": "Tier A — skill match", "B_commute_45min": "Tier B — commute", "C_walkable_retail": "Tier C — walkable"}
GAP = 1.4  # seconds between LinkedIn requests

# ---------------------------------------------------------------------------------------------- what to search
TIERS = {
    "A_skill_match": {
        "distance": 25, "location": "West Hollywood, California, United States",
        "queries": ["Account Manager", "Account Executive", "Client Success Manager", "Customer Success Manager", "Partnerships Manager",
                    "Business Development Manager", "Sales Manager", "Solutions Consultant", "Account Director", "Enterprise Account Manager",
                    "Relationship Manager", "Operations Manager", "Forward Deployed Engineer", "Solutions Engineer",
                    "Implementation Engineer", "Customer Engineer", "Deployment Strategist"],
    },
    "A_remote_fde": {  # same tier A label; remote US, forward-deployed style roles only
        "tier": "A_skill_match", "remote": True, "distance": 25, "location": "United States",
        "queries": ["Forward Deployed Engineer", "Solutions Engineer", "Implementation Engineer"],
    },
    "B_commute_45min": {
        "distance": 40, "location": "Los Angeles, California, United States",
        "queries": ["Account Manager", "Account Executive", "Customer Success Manager", "Partnerships", "Business Development",
                    "Sales Operations", "Project Manager Operations", "Technical Account Manager", "Hospitality Manager",
                    "Guest Services Manager", "Guest Experience Manager", "Concierge", "Forward Deployed Engineer"],
    },
    "C_walkable_retail": {
        "distance": 5, "location": "West Hollywood, California, United States",
        "queries": ["Retail Sales Associate", "Store Manager", "Assistant Store Manager", "Keyholder", "Client Advisor", "Barista",
                    "Front Desk", "Sales Associate", "Host", "Concierge", "Customer Service", "Guest Services"],
    },
}

WALKABLE = ("west hollywood", "beverly hills", "hollywood", "los angeles", "beverly grove", "melrose", "sunset", "century city")
TOO_FAR_C = ("culver city", "santa monica", "burbank", "glendale", "pasadena", "long beach", "torrance", "van nuys", "sherman oaks",
             "el segundo", "inglewood", "downey", "carson", "gardena", "anaheim", "irvine", "north hollywood", "studio city", "encino",
             "woodland hills")
TOO_FAR_AB = ("san diego", "irvine", "anaheim", "riverside", "san bernardino", "ontario, ca", "temecula", "oxnard", "ventura",
              "santa barbara", "bakersfield", "palmdale", "lancaster", "valencia", "santa clarita", "san francisco", "new york",
              "remote - ", "chicago", "austin", "seattle", "denver", "atlanta", "boston", "dallas", "miami", "phoenix")

STRONG = {
    "account manag": 10, "account executive": 9, "customer success": 9, "client success": 9, "partnership": 9, "business development": 8,
    "account director": 8, "enterprise": 6, "relationship manager": 8, "solutions consultant": 7, "sales manager": 7, "renewal": 6,
    "hospitality": 6, "guest services": 6, "guest experience": 6, "concierge": 5, "hotel": 5, "saas": 6, "b2b": 6, "ecommerce": 6,
    "e-commerce": 6, "shopify": 8, "amazon": 7, "marketplace": 6, "automotive": 6, "ev ": 5, "travel": 5, "onboarding": 5,
    "salesforce": 5, "hubspot": 5, "crm": 5, "client advisor": 5, "store manager": 4, "operations manager": 5, "project manager": 4,
    "sales operations": 6, "technical account": 8,
    "forward deployed": 10, "solutions engineer": 8, "customer engineer": 7, "implementation": 6, "deployment": 5,
}
FDE_TERMS = ("forward deployed", "forward-deployed", "solutions engineer", "customer engineer", "implementation engineer",
             "deployment strategist", "implementation")
WEAK = {
    "registered nurse": -40, "nurse": -30, "physician": -40, "attorney": -40, "engineer": -12, "developer": -12, "software": -8, "rn ": -30,
    "insurance agent": -12, "financial advisor": -12, "recruiter": -6, "driver": -20, "warehouse": -20, "technician": -18, "mechanic": -20,
    "security guard": -20, "janitor": -25, "cook": -18, "chef": -18, "dental": -25, "medical assistant": -25, "pharmac": -25,
    "therapist": -30, "intern": -15, "unpaid": -40, "commission only": -25, "1099": -8,
    "overnight": -30, "night audit": -40, "graveyard": -40, "third shift": -30,
    "director of engineering": -20, "vp of engineering": -20,
}

# Shifts Jared will not work. Hard filter: the role is dropped, not just down-scored.
OVERNIGHT = re.compile(
    r"\b(?:overnight|over-night|graveyard|grave[\s-]?yard|night[\s-]?audit\w*|night\s+shift|nights?\s+shift|third[\s-]?shift|3rd[\s-]?shift|"
    r"swing/?\s*graveyard|(?:11|10|9)\s*(?:p\.?m\.?|pm)\s*(?:-|–|—|to|until)\s*(?:5|6|7|8)\s*(?:a\.?m\.?|am))\b", re.I)


def is_overnight(*texts):
    return any(OVERNIGHT.search(t or "") for t in texts)


# ---------------------------------------------------------------------------------------------- http
_last = {}


class Throttled(Exception):
    pass


def http(url, headers=None, data=None, method=None, tries=3, timeout=40, gap=GAP, auth=None, json_body=None):
    host = urllib.parse.urlparse(url).netloc
    err = None
    for attempt in range(tries):
        wait = gap - (time.time() - _last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        h = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}
        h.update(headers or {})
        if auth:
            h["Authorization"] = "Basic " + base64.b64encode(("%s:%s" % auth).encode()).decode()
        body = data
        if json_body is not None:
            body = json.dumps(json_body).encode()
            h["Content-Type"] = "application/json"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h, method=method), timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise Throttled(url)
            if e.code in (400, 401, 403, 404, 409, 410):
                raise
            err = e
        except Exception as e:  # noqa: BLE001
            err = e
        time.sleep(2 ** attempt)
    raise err


# ---------------------------------------------------------------------------------------------- LinkedIn parsing
CARD = re.compile(r"<li>(.*?)</li>", re.S)


def grab(pat, s):
    m = re.search(pat, s, re.S)
    return html.unescape(re.sub(r"<[^>]+>", "", m.group(1)).strip()) if m else ""


def parse_cards(page, tier, query, remote=False):
    out = []
    for c in CARD.findall(page or ""):
        urn = re.search(r'data-entity-urn="urn:li:jobPosting:(\d+)"', c)
        if not urn:
            continue
        url = re.search(r'href="(https://[a-z.]*linkedin\.com/jobs/view/[^"]+)"', c)
        url = html.unescape(url.group(1)).split("?")[0] if url else "https://www.linkedin.com/jobs/view/" + urn.group(1)
        dt = re.search(r'datetime="([\d-]+)"', c)
        out.append({"id": urn.group(1), "title": grab(r"<h3[^>]*base-search-card__title[^>]*>(.*?)</h3>", c),
                    "company": grab(r"<h4[^>]*base-search-card__subtitle[^>]*>(.*?)</h4>", c),
                    "location": grab(r"<span[^>]*job-search-card__location[^>]*>(.*?)</span>", c),
                    "posted": dt.group(1) if dt else "", "salary": grab(r"job-search-card__salary-info[^>]*>(.*?)</span>", c),
                    "url": url, "tier": tier, "query": query, "remote": remote})
    return out


def parse_detail(page):
    """(text, closed). text is the plain job description."""
    m = re.search(r'<div class="[^"]*show-more-less-html__markup[^"]*">(.*?)</div>', page or "", re.S)
    text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(1)))).strip() if m else ""
    closed = bool(re.search(r"No longer accepting applications|closed-job__flavor--closed", page or "", re.I))
    return text, closed


def search_all(tpr, deadline):
    jobs, seen, errors, throttled = [], set(), 0, False
    ok = 0
    for key, cfg in TIERS.items():
        tier = cfg.get("tier", key)
        for q in cfg["queries"]:
            if throttled or time.time() > deadline:
                break
            params = {"keywords": q, "location": cfg["location"], "distance": cfg["distance"], "f_TPR": tpr, "start": 0}
            if cfg.get("remote"):
                params["f_WT"] = 2
            try:
                page = http(SEARCH + "?" + urllib.parse.urlencode(params), headers={"Accept": "text/html"})
                ok += 1
            except Throttled:
                throttled = True
                break
            except Exception:  # noqa: BLE001
                errors += 1
                continue
            for j in parse_cards(page, tier, q, bool(cfg.get("remote"))):
                if j["id"] in seen or not j["title"]:
                    continue
                seen.add(j["id"])
                jobs.append(j)
    return jobs, ok, errors, throttled


# ---------------------------------------------------------------------------------------------- scoring
def score(j):
    t = (j["title"] + " " + j["company"]).lower()
    loc = j["location"].lower()
    fde = any(k in t for k in FDE_TERMS)
    s, hits = 0, []
    for k, v in STRONG.items():
        if k in t:
            s += v
            hits.append(k.strip())
    for k, v in WEAK.items():
        if k in t and not (fde and k in ("engineer", "developer", "software")):
            s += v
    if "west hollywood" in loc:
        s += 8
    elif "beverly hills" in loc or "hollywood" in loc:
        s += 6
    elif "los angeles" in loc:
        s += 4
    elif "santa monica" in loc or "culver city" in loc or "century city" in loc:
        s += 2
    if j["tier"] == "A_skill_match":
        s += 3
    if j.get("salary"):
        s += 2
    j["score"] = s
    j["match_on"] = sorted(set(hits))[:6]
    j["fde"] = fde
    return j


def keep(j):
    loc = j["location"].lower()
    if is_overnight(j["title"]):
        return False
    if j.get("remote"):
        # remote-US search is only for forward-deployed style roles
        if not j.get("fde"):
            return False
        if any(x in loc for x in ("new york", "san francisco", "seattle", "boston", "austin", "chicago")) and "remote" not in loc and "united states" not in loc:
            return False
    elif j["tier"] == "C_walkable_retail":
        if any(x in loc for x in TOO_FAR_C):
            return False
        if not any(x in loc for x in WALKABLE):
            return False
    else:
        if any(x in loc for x in TOO_FAR_AB):
            return False
    return j["score"] > 0


def rank(jobs):
    return sorted([j for j in (score(j) for j in jobs) if keep(j)], key=lambda x: -x["score"])


# ---------------------------------------------------------------------------------------------- Nextcloud Deck
class Deck:
    def __init__(self, base, user, pw):
        self.api = base.rstrip("/") + "/index.php/apps/deck/api/v1.0"
        self.auth = (user, pw)

    def call(self, method, path, body=None):
        raw = http(self.api + path, method=method, auth=self.auth, json_body=body, gap=0.3,
                   headers={"OCS-APIRequest": "true", "Accept": "application/json"})
        return json.loads(raw) if raw else None

    def stacks(self):
        return self.call("GET", "/boards/%d/stacks" % BOARD) or []

    def archived(self):
        try:
            return self.call("GET", "/boards/%d/stacks/archived" % BOARD) or []
        except Exception:  # noqa: BLE001
            return []

    def add_card(self, stack_id, title, description, label_id):
        card = self.call("POST", "/boards/%d/stacks/%d/cards" % (BOARD, stack_id),
                         {"title": title[:255], "type": "plain", "order": 0, "description": description})
        self.call("PUT", "/boards/%d/stacks/%d/cards/%d/assignLabel" % (BOARD, stack_id, card["id"]), {"labelId": label_id})
        return card

    def move(self, card_id, from_stack, to_stack):
        self.call("PUT", "/boards/%d/stacks/%d/cards/%d/reorder" % (BOARD, to_stack, card_id), {"order": 0, "stackId": to_stack})


def stack_ids(stacks):
    by = {(s.get("title") or "").strip().lower(): s["id"] for s in stacks}
    return {"new": by.get("new", STACK_NEW_FALLBACK), "shortlist": by.get("shortlist"), "closed": by.get("closed")}


def marker_ids(stacks):
    ids = set()
    for st in stacks:
        for c in st.get("cards") or []:
            m = re.search(r"linkedin-id:\s*(\d+)", c.get("description") or "")
            if m:
                ids.add(m.group(1))
    return ids


def card_description(j, note=None):
    bits = ["**%s** — %s" % (j["company"], j["location"]),
            "Posted %s" % (j["posted"] or "—") + (" · %s" % j["salary"] if j.get("salary") else ""),
            "", "[Open the listing](%s)" % j["url"], "",
            "Fit signals: %s  ·  score %s" % (", ".join(j["match_on"]) or "—", j["score"]),
            "Found via: %s (%s)" % (j["query"], TIER_NAME[j["tier"]] + (", remote" if j.get("remote") else ""))]
    if note:
        bits += ["", "About the role (free AI summary, check the posting): " + note]
    bits += ["", "---", "**Next step:** ", "- [ ] Tailor resume", "- [ ] Apply", "", "<!-- linkedin-id: %s -->" % j["id"]]
    return "\n".join(bits)


# ---------------------------------------------------------------------------------------------- free AI note
def ai_note(text, deadline):
    if freellm is None or not text:
        return None
    try:
        msg, _ = freellm.chat(
            [{"role": "system", "content": "You summarize one job posting in one plain sentence (max 35 words): what the person actually does "
                                           "and any red flag (shift times, commission only, heavy travel, unpaid, contract). Use only the posting text. "
                                           "Say nothing about any applicant. No emoji."},
             {"role": "user", "content": text[:2500]}], max_tokens=120, deadline=deadline)
        out = re.sub(r"\s+", " ", (msg.get("content") or "")).strip()
        return out[:300] if out else None
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------------------------- run
def main(argv):
    dry = "--dry" in argv
    cfg = lib.rpc("job_finder_gate") or {"enabled": True, "max_per_tier": 8}
    if not cfg.get("enabled", True):
        return "skip: Job Finder is switched off"
    per_tier = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else int(cfg.get("max_per_tier") or 8)
    deadline = time.time() + 1500

    user = (lib.rpc("pi_secret", p_name="nextcloud_user") or "").strip()
    pw = (lib.rpc("pi_secret", p_name="nextcloud_app_password") or "").strip()
    base = (lib.rpc("pi_secret", p_name="nextcloud_base_url") or "").strip() or "https://cloud.bestly.tech"
    if not user or not pw:
        return "skip: Nextcloud login not saved in Vault yet (nextcloud_user / nextcloud_app_password)"
    deck = Deck(base, user, pw)

    stacks = deck.stacks()  # raises if the login is wrong: the run fails loudly
    sid = stack_ids(stacks)
    on_board = marker_ids(stacks) | marker_ids(deck.archived())

    jobs, ok_q, bad_q, throttled = search_all("r172800", deadline)
    if not ok_q:
        raise RuntimeError("LinkedIn search unreachable (%s)" % ("rate limited" if throttled else "%d failed requests" % bad_q))
    ranked = rank(jobs)

    posted, held, overnight_dropped, per = [], 0, 0, {}
    for j in ranked:
        if j["id"] in on_board:
            continue
        if per.get(j["tier"], 0) >= per_tier:
            continue
        # full-text check: never post an overnight role, never post one whose text could not be read
        try:
            text, closed = parse_detail(http(DETAIL % j["id"], headers={"Accept": "text/html"}))
        except Throttled:
            held += 1
            throttled = True
            continue
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                continue
            held += 1
            continue
        except Exception:  # noqa: BLE001
            held += 1
            continue
        if closed or not text:
            if not text and not closed:
                held += 1
            continue
        if is_overnight(text):
            overnight_dropped += 1
            continue
        note = ai_note(text, deadline) if len(posted) < 14 else None
        if not dry:
            deck.add_card(sid["new"], "%s — %s" % (j["title"], j["company"]), card_description(j, note), LABEL[j["tier"]])
        on_board.add(j["id"])
        per[j["tier"]] = per.get(j["tier"], 0) + 1
        posted.append(j)

    closed_n = checked = 0
    if sid.get("shortlist") and sid.get("closed"):
        for st in stacks:
            if st["id"] != sid["shortlist"]:
                continue
            for c in st.get("cards") or []:
                m = re.search(r"linkedin-id:\s*(\d+)", c.get("description") or "")
                if not m or time.time() > deadline:
                    continue
                checked += 1
                gone = False
                try:
                    _t, gone = parse_detail(http(DETAIL % m.group(1), headers={"Accept": "text/html"}))
                except urllib.error.HTTPError as e:
                    gone = e.code in (404, 410)
                except Exception:  # noqa: BLE001
                    gone = False
                if gone:
                    closed_n += 1
                    if not dry:
                        deck.move(c["id"], sid["shortlist"], sid["closed"])

    if posted and not dry:
        body = ["%d new on the Job Search board: %s." % (len(posted), ", ".join("%s %d" % (k[0], v) for k, v in sorted(per.items())))]
        if closed_n:
            body.append("%d Shortlist role%s closed and moved to Closed." % (closed_n, "" if closed_n == 1 else "s"))
        lib.notify("Job Finder: %d new role%s on your board" % (len(posted), "" if len(posted) == 1 else "s"), "\n".join(body),
                   severity="success", push=False, url=base.rstrip("/") + "/apps/deck/#/board/%d" % BOARD,
                   dedupe="jobs.%s" % date.today().isoformat())
    msg = "%d new card%s (%s) | searched %d queries, %d failed%s | %d ranked | dropped overnight %d | held back (text unreadable) %d | shortlist checked %d, closed %d" % (
        len(posted), "" if len(posted) == 1 else "s", ", ".join("%s %d" % (k[0], v) for k, v in sorted(per.items())) or "none",
        ok_q, bad_q, " (LinkedIn rate limited us, rest tomorrow)" if throttled else "", len(ranked), overnight_dropped, held, checked, closed_n)
    return ("dry: " if dry else "ok: ") + msg


if __name__ == "__main__":
    print(main(sys.argv[1:]))
