"""Nickel, Settlements Clerk - daily settlement FINDER + MATCHER (bestly-pi, 7:20 AM PT).

Installed as /opt/bestly/cron/jobs/settlement_finder.py (+ jobs/settlement-finder.py wrapper) and run by
/opt/bestly/cron/run.sh settlement-finder, which reports the heartbeat to pi_jobs via runjob.py -> pi_job_report.

  FIND   public listing pages -> settlement_upsert_t
           classaction.org/settlements          (HTML cards)
           topclassactions.com open-settlements (public RSS feed; the HTML page is behind a Cloudflare challenge
                                                 and is never fetched)
  MATCH  settlement_unjudged_t -> his own email search (settlement_mail_search_t, subject/sender only)
         -> free AI ladder (freellm.py) -> settlement_judge_t   (proven | likely | ask | no)

HARD LIMITS: never files or submits a claim, never fills a form, never solves a CAPTCHA, never emails anyone.
It only reads public listing pages and the email-search RPC and writes verdicts. Free models only.

Auth: the house db-watchdog token (db_watchdog_ok) read from /home/pi/.bestly/db_watchdog_token (mode 600),
sent with the project's publishable key. The token is never printed or logged.

  python3 settlement_finder.py [--dry] [--find-only] [--match-only] [--limit N]
"""
import fcntl
import gzip
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from datetime import date, datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402  (service-key helpers + Scout notify)

try:
    import freellm  # noqa: E402  (free AI ladder: FreeLLM -> Gemini -> Groq -> Cloudflare)
except Exception:  # noqa: BLE001
    freellm = None

TZ = ZoneInfo("America/Los_Angeles")
UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 BestlySettlementReader/1.0 (personal use)"
ROBOTS_TOKEN = "BestlySettlementReader"
PUBLISHABLE = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw")  # public by design
TOKEN_FILE = os.environ.get("SETTLEMENT_TOKEN_FILE", "/home/pi/.bestly/db_watchdog_token")
STATE_FILE = "/opt/bestly/cron/state/settlement_finder.json"
RUN_LOCK = "/tmp/bestly-settlement-finder.run.lock"

CA_URL = "https://www.classaction.org/settlements"
TCA_FEED = "https://topclassactions.com/category/lawsuit-settlements/open-lawsuit-settlements/feed/"
SOURCE_GAP_SEC = 4          # polite pause between requests to different pages/hosts
MATCH_CAP = 40              # settlements judged per run (rest wait for tomorrow)
MATCH_BUDGET_SEC = 40 * 60  # stop judging after this long
MAIL_LIMIT = 15

_robots = {}


def log(msg):
    print(f"  {msg}", flush=True)


# ---------------------------------------------------------------- Supabase (token-gated RPCs, publishable key)

def _token():
    with open(os.environ.get("SETTLEMENT_TOKEN_FILE", TOKEN_FILE)) as f:
        t = f.read().strip()
    if not t:
        raise RuntimeError("db-watchdog token file is empty")
    return t


def sb(name, **args):
    """POST /rest/v1/rpc/<name> with p_token added. Retries network errors / 5xx with backoff."""
    body = json.dumps({"p_token": _token(), **args}).encode()
    last = None
    for i, wait in enumerate((0, 3, 10, 30)):
        if wait:
            time.sleep(wait)
        req = urllib.request.Request(lib.URL + "/rest/v1/rpc/" + name, data=body, method="POST", headers={
            "Content-Type": "application/json", "apikey": PUBLISHABLE, "Authorization": "Bearer " + PUBLISHABLE})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            txt = e.read().decode()[:300]
            if e.code < 500 and e.code != 429:
                raise RuntimeError(f"{name} -> HTTP {e.code}: {txt}")  # not retryable (bad token, bad args)
            last = f"{name} -> HTTP {e.code}: {txt}"
        except Exception as e:  # noqa: BLE001
            last = f"{name} -> {e}"
    raise RuntimeError(last)


# ---------------------------------------------------------------- polite HTTP

def _robots_ok(url):
    host = urllib.parse.urlsplit(url)
    base = f"{host.scheme}://{host.netloc}"
    if base not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            txt = _http(base + "/robots.txt", check_robots=False, tries=2).decode("utf-8", "replace")
            rp.parse(txt.splitlines())
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                rp.parse([])  # no robots.txt = everything allowed
            else:
                raise RuntimeError(f"robots.txt unreachable for {host.netloc} (HTTP {e.code}); skipping source")
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(f"robots.txt unreachable for {host.netloc} ({e}); skipping source")
        _robots[base] = rp
        time.sleep(1.5)
    if not _robots[base].can_fetch(ROBOTS_TOKEN, url):
        raise RuntimeError(f"robots.txt disallows {url}")


def _http(url, check_robots=True, tries=3, timeout=45):
    """GET with gzip, retries with backoff on network errors / 429 / 5xx. A 403/challenge is NOT worked around."""
    if check_robots:
        _robots_ok(url)
    last = None
    for i in range(tries):
        if i:
            time.sleep((2, 8, 20)[min(i - 1, 2)])
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                                                   "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return data
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except Exception as e:  # noqa: BLE001
            last = e
    raise last


# ---------------------------------------------------------------- date / text helpers

MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def parse_date(s):
    s = (s or "").strip()
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", s)
    try:
        if m:
            y = int(m.group(3))
            y += 2000 if y < 100 else 0
            return date(y, int(m.group(1)), int(m.group(2)))
        m = re.search(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", s)
        if m and m.group(1)[:3].lower() in MONTHS:
            return date(int(m.group(3)), MONTHS[m.group(1)[:3].lower()], int(m.group(2)))
    except ValueError:
        pass
    return None


def strip_html(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", "", h)
    h = re.sub(r"(?i)<(br|/p|/li|/h\d|/div|/tr|/td)[^>]*>", "\n", h)
    h = re.sub(r"<[^>]+>", "", h)
    return html.unescape(h).replace("\xa0", " ")


def squash(s, n=None):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s[:n] if n else s


def payout_methods(text):
    t = (text or "").lower()
    out = []
    for label, pat in (("check", r"\bcheck\b|\bchecks\b"), ("paypal", r"paypal"), ("venmo", r"venmo"), ("zelle", r"zelle"),
                       ("direct deposit", r"direct deposit|\bach\b"), ("digital payment", r"digital payment|e-?payment|virtual (?:card|prepaid)"),
                       ("gift card", r"gift card"), ("store credit", r"store credit|voucher")):
        if re.search(pat, t):
            out.append(label)
    return out


def host_key(u):
    try:
        p = urllib.parse.urlsplit(u or "")
    except ValueError:
        return None
    host = (p.hostname or "").lower().removeprefix("www.")
    path = p.path.strip("/").lower()
    if not host:
        return None
    return host if path in ("", "home", "index.html", "index.php") else f"{host}/{path}"


# ---------------------------------------------------------------- FIND: classaction.org (HTML cards)

def parse_classaction(raw, today):
    h = raw.decode("utf-8", "replace")
    rows, skipped = [], {"closed": 0, "undated": 0, "past": 0}
    for chunk in h.split("settlemennt-card-orn")[1:]:
        slug = re.search(r'data-slug="([^"]+)"', chunk)
        name = re.search(r'data-name="([^"]+)"', chunk)
        title = re.search(r'<a [^>]*class="js-settlement-link[^>]*>(.*?)</a>', chunk, re.S)
        href = re.search(r'<a href="(https?://[^"]+)"[^>]*js-settlement-link', chunk)
        if not (slug and (title or name)):
            continue

        def val(label):
            m = re.search(label + r"[^<]*(?:<br\s*/?>)?[^<]*</span>\s*<span class=\"db[^>]*>(.*?)</span>", chunk, re.S | re.I)
            return squash(strip_html(m.group(1))) if m else ""

        badge = " ".join(squash(strip_html(b)) for b in re.findall(r'br-pill">(.*?)</span>', chunk, re.S))
        if re.search(r"\bclosed\b", badge, re.I):
            skipped["closed"] += 1
            continue
        dl = parse_date(val("Deadline"))
        if not dl:
            skipped["undated"] += 1
            continue
        if dl < today:
            skipped["past"] += 1
            continue
        proof = val("Proof")
        cls = re.search(r'<p class="f6 lh-copy mv0[^>]*>(.*?)</p>', chunk, re.S)
        cls_text = squash(strip_html(cls.group(1)), 800) if cls else ""
        nm = squash(strip_html(title.group(1) if title else name.group(1)))
        rows.append({
            "source_key": "ca:" + slug.group(1), "name": nm, "defendant": None, "administrator": None,
            "claim_url": href.group(1) if href else None, "info_url": None,
            "class_definition": cls_text or None,
            "proof_required": True if proof.lower().startswith("yes") else (False if proof.lower().startswith("no") else None),
            "est_payout": squash(val("Payout"), 120) or None, "deadline": dl.isoformat(),
            "payout_methods": payout_methods(cls_text), "status": "open", "source": "classaction.org",
            "raw": {"badge": badge, "listing": CA_URL},
        })
    return rows, skipped


# ---------------------------------------------------------------- FIND: Top Class Actions (public RSS feed)

TCA_HEADERS = ["Who’s Eligible", "Who's Eligible", "Potential Award", "Proof of Purchase", "Claim Form", "Claim Form Deadline",
               "Case Name", "Final Hearing", "Settlement Website", "Claims Administrator", "Class Counsel", "Defense Counsel"]


def parse_tca(raw, today):
    root = ET.fromstring(raw)
    ns = {"c": "http://purl.org/rss/1.0/modules/content/"}
    rows, skipped = [], {"undated": 0, "past": 0}
    for it in root.iter("item"):
        title = squash(it.findtext("title") or "")
        link = (it.findtext("link") or "").strip()
        body_html = it.findtext("c:encoded", namespaces=ns) or ""
        if not (title and link and body_html):
            continue
        body_html = re.sub(r"(?s)<a class=\"a2a.*?</a>", "", body_html)
        lines = [squash(x) for x in strip_html(body_html).split("\n")]
        lines = [x for x in lines if x]
        # sections: header line -> following lines until the next header
        sec, cur, started = {}, None, False
        for ln in lines:
            if ln in TCA_HEADERS:
                cur = "Who's Eligible" if ln.startswith("Who") else ln
                sec.setdefault(cur, [])
                started = True
            elif cur and started:
                if ln.startswith("NOTE: If you do not qualify") or ln.startswith("Remember: you are submitting"):
                    cur = None
                    continue
                sec[cur].append(ln)
        dl = parse_date(" ".join(sec.get("Claim Form Deadline", [])))
        if not dl:
            skipped["undated"] += 1
            continue
        if dl < today:
            skipped["past"] += 1
            continue
        claim = None
        for href, inner in re.findall(r'(?is)<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', body_html):
            if re.search(r"(file|submit|make)\s+(a|your)\s+claim|claim form", strip_html(inner), re.I) and "topclassactions.com" not in href:
                claim = html.unescape(href)
                break
        site = " ".join(sec.get("Settlement Website", []))
        if not claim and site:
            claim = site if site.startswith("http") else "https://" + site.split()[0]
        elig = squash(" ".join(sec.get("Who's Eligible", [])), 800)
        proof_txt = squash(" ".join(sec.get("Proof of Purchase", [])), 300)
        admin = (sec.get("Claims Administrator") or [None])[0]
        desc = strip_html(it.findtext("description") or "")
        d = re.match(r"\s*(.{2,60}?)\s+(?:has\s+)?(?:agreed|will pay|to pay|reached)\b", desc)
        slug = link.rstrip("/").rsplit("/", 1)[-1]
        rows.append({
            "source_key": "tca:" + slug, "name": title, "defendant": squash(d.group(1)) if d else None,
            "administrator": squash(admin, 200) if admin else None, "claim_url": claim, "info_url": link,
            "class_definition": elig or None,
            "proof_required": None if not proof_txt else (False if re.match(r"(?i)^(n/?a|none|no)\b", proof_txt) else True),
            "est_payout": squash(" ".join(sec.get("Potential Award", [])), 120) or None, "deadline": dl.isoformat(),
            "payout_methods": payout_methods(strip_html(body_html)), "status": "open", "source": "topclassactions.com",
            "raw": {"proof_text": proof_txt, "pub": it.findtext("pubDate"), "feed": TCA_FEED},
        })
    return rows, skipped


SOURCES = [
    ("classaction.org", CA_URL, parse_classaction),
    ("topclassactions.com", TCA_FEED, parse_tca),
]


def load_state():
    try:
        with open(STATE_FILE) as f:
            s = json.load(f)
        s.setdefault("keys", {})
        s.setdefault("fail", {})
        return s
    except Exception:  # noqa: BLE001
        return {"keys": {}, "fail": {}}


def save_state(s):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f)
    os.replace(tmp, STATE_FILE)


def find(dry, today, state):
    """Fetch every source (one failing never kills the run). Returns (rows, notes, n_new)."""
    all_rows, notes, errors = [], [], 0
    for i, (name, url, parser) in enumerate(SOURCES):
        if i:
            time.sleep(SOURCE_GAP_SEC)
        try:
            raw = _http(url)
            rows, skipped = parser(raw, today)
            if not rows:
                raise RuntimeError(f"parsed 0 open settlements ({sum(skipped.values())} skipped) - page layout may have changed")
            log(f"{name}: {len(rows)} open, skipped {skipped}")
            all_rows += rows
            state["fail"][name] = 0
        except Exception as e:  # noqa: BLE001
            errors += 1
            state["fail"][name] = state["fail"].get(name, 0) + 1
            msg = f"{name} failed: {str(e)[:140]}"
            notes.append(msg)
            log(msg)
            if state["fail"][name] == 3 and not dry:
                try:
                    lib.notify("Nickel: a settlement source has been failing for 3 days",
                               f"{name}: {str(e)[:300]}. Nickel's finder keeps running on the other source.",
                               severity="warning", push=False, url="/admin/settlements", dedupe=f"settle.finder.{name}")
                except Exception:  # noqa: BLE001
                    pass
    if errors == len(SOURCES):
        raise RuntimeError("every settlement source failed: " + " | ".join(notes))

    # one row per settlement: classaction.org first, drop Top Class Actions rows that point at the same site
    seen, rows = {}, []
    for r in all_rows:
        hk = host_key(r.get("claim_url"))
        if hk and hk in seen:
            continue
        if hk:
            seen[hk] = True
        rows.append(r)
    new = [r for r in rows if r["source_key"] not in state["keys"]]
    if not dry:
        for k in range(0, len(rows), 40):
            sb("settlement_upsert_t", p_rows=rows[k:k + 40])
        # close ones we knew about whose deadline has passed
        stale = [{"source_key": k, "name": v.get("name") or k, "status": "closed", "source": v.get("source")}
                 for k, v in state["keys"].items() if v.get("deadline") and v["deadline"] < today.isoformat() and not v.get("closed")]
        for k in range(0, len(stale), 40):
            sb("settlement_upsert_t", p_rows=stale[k:k + 40])
        for s in stale:
            state["keys"][s["source_key"]]["closed"] = True
        for r in rows:
            state["keys"][r["source_key"]] = {"deadline": r["deadline"], "name": r["name"], "source": r["source"]}
    return rows, notes, len(new)


# ---------------------------------------------------------------- MATCH

TRIAGE_SYS = (
    "You triage class action settlements for ONE specific person. All that is known about him: an adult individual "
    "consumer living in Los Angeles County, California, USA (not a business, not a minor). Assume nothing else. "
    "Reply with ONE JSON object and nothing else.")

TRIAGE_USER = """Settlement: {name}
Defendant: {defendant}
Administrator: {administrator}
Who qualifies: {cls}
Claim deadline: {deadline}
Proof required: {proof}

Return JSON with exactly these keys:
"terms": up to 6 short distinctive names (company, brand, product, app or service) that would appear in the SUBJECT or SENDER of an email from or about that company, e.g. ["Apple","iPhone"]. Real names only, 3+ characters. NEVER generic words like settlement, claim, class, inc, llc, bank, data, privacy, breach, products.
"plausibility": "none" if the class clearly cannot include him (limited to residents of another state or country, businesses/employers/franchisees/providers only, minors only, one profession, one local store elsewhere); "low" if it needs a narrow or unusual product most people never owned; "medium" for a common product, service or company many consumers use; "high" for a very broad consumer class (a major app, service, or mainstream product).
"no_reason": one short sentence if plausibility is none or low, else "".
"question": ONE short plain yes/no question in second person, max 140 characters, with the key years, like "Did you own a Google Pixel phone between 2016 and 2019?". Required when plausibility is medium or high, else "".
"""

JUDGE_SYS = (
    "You check whether ONE specific person (an adult consumer in Los Angeles County, California) is covered by a class action "
    "settlement, using ONLY the email headers given (sender, subject, date). You see no email bodies. Be conservative. "
    "Never invent facts. Reply with ONE JSON object and nothing else.")

JUDGE_USER = """Settlement: {name}
Defendant: {defendant}
Who qualifies: {cls}

His emails that matched the search terms (numbered):
{emails}

Return JSON with exactly these keys:
"match": "proven" ONLY if one or more of these emails clearly shows he bought, ordered, subscribed to, or used the product/service/account at issue (a receipt, order or shipping confirmation, subscription or account notice, statement) AND the email date falls inside the class period; "likely" if the emails strongly suggest he is a customer/user but you cannot confirm the period or the exact product; "none" if the emails are only marketing/newsletters/unrelated or prove nothing. Marketing and newsletters are NEVER proof.
"email_idx": list of the email numbers you relied on (empty when match is none).
"transactional": true if the cited emails are receipts/orders/shipping/account/statement emails, false if marketing/newsletter/other.
"in_class_period": true / false / null (null if the class period is unknown or unclear).
"reason": one short sentence.
"""


def _json_obj(text):
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?|```$", "", t, flags=re.M).strip()
    try:
        return json.loads(t)
    except ValueError:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            return json.loads(m.group(0))
        raise


def ai_json(system, user, deadline):
    """Free AI ladder -> parsed JSON dict. One retry on bad JSON. Raises RuntimeError if every model fails."""
    if freellm is None:
        raise RuntimeError("freellm ladder not importable")
    last = None
    for _ in range(2):
        msg, who = freellm.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                                max_tokens=700, deadline=deadline, json_mode=True)
        try:
            return _json_obj(msg.get("content")), who
        except ValueError as e:
            last = e
    raise RuntimeError(f"AI returned unparseable JSON: {last}")


STOP = {"settlement", "claim", "claims", "class", "action", "inc", "llc", "corp", "company", "data", "privacy", "breach",
        "bank", "products", "product", "the", "and", "usa", "group", "services", "service", "litigation", "consumer"}


def clean_terms(terms, fallback):
    out = []
    for t in (terms if isinstance(terms, list) else []) + fallback:
        t = squash(str(t))
        if len(t) < 3 or t.lower() in STOP or t.lower() in [o.lower() for o in out]:
            continue
        out.append(t[:40])
    return out[:6]


def fallback_terms(s):
    base = (s.get("defendant") or "") + " " + re.sub(r"(?i)\b(class action|settlement|data breach|lawsuit)\b|\$[\d.,]+[MBK]?", " ", s.get("name") or "")
    words = [w for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9&'.-]{2,}", base)]
    return words[:3]


def short_question(q, s):
    q = squash(q if isinstance(q, str) else "")
    if 12 <= len(q) <= 180 and q.endswith("?"):
        return q
    who = s.get("defendant") or re.sub(r"(?i)\s*class action settlement.*$", "", s.get("name") or "this company")
    return f"Have you ever bought from or used {squash(who, 60)}?"


def evidence_from(emails, idxs):
    ev = []
    for i in idxs:
        e = emails[i - 1]
        ev.append({"kind": "email", "ref": e["id"],
                   "summary": squash(f"{e.get('from')}: {e.get('subject')} ({(e.get('sent_at') or '')[:10]})", 240)})
    return ev


def judge_one(s, deadline):
    """Returns (match, evidence, question, note). Raises RuntimeError if the AI is unavailable (stay unjudged)."""
    ctx = {"name": s.get("name"), "defendant": s.get("defendant") or "unknown", "administrator": s.get("administrator") or "unknown",
           "cls": squash(s.get("class_definition") or "not stated", 900), "deadline": s.get("deadline") or "unknown",
           "proof": {True: "yes", False: "no", None: "unknown"}[s.get("proof_required")]}
    tri, _ = ai_json(TRIAGE_SYS, TRIAGE_USER.format(**ctx), deadline)
    plaus = str(tri.get("plausibility", "")).lower()
    if plaus not in ("none", "low", "medium", "high"):
        raise RuntimeError(f"bad plausibility {plaus!r}")
    reason = squash(tri.get("no_reason") or "", 200)
    if plaus == "none":
        return "no", [], None, reason or "class cannot include him"
    terms = clean_terms(tri.get("terms"), fallback_terms(s))
    emails = []
    if terms:
        emails = sb("settlement_mail_search_t", p_terms=terms, p_limit=MAIL_LIMIT) or []
    if emails:
        lines = "\n".join(f"{i}. {e.get('from')} | {squash(e.get('subject'), 160)} | {(e.get('sent_at') or '')[:10]}"
                          for i, e in enumerate(emails, 1))
        j, _ = ai_json(JUDGE_SYS, JUDGE_USER.format(name=ctx["name"], defendant=ctx["defendant"], cls=ctx["cls"], emails=lines), deadline)
        idxs = [i for i in (j.get("email_idx") or []) if isinstance(i, int) and 1 <= i <= len(emails)]
        m = str(j.get("match", "none")).lower()
        trans, period = j.get("transactional") is True, j.get("in_class_period")
        if m == "proven" and idxs and trans and period is True:
            return "proven", evidence_from(emails, idxs), None, squash(j.get("reason") or "", 160)
        if m in ("proven", "likely") and idxs and trans:
            return "likely", evidence_from(emails, idxs), None, squash(j.get("reason") or "", 160)
        if m in ("proven", "likely") and idxs:
            # cited emails are not transactional: not enough to call it likely; ask instead
            return "ask", [], short_question(tri.get("question"), s), "emails were not receipts/accounts"
    if plaus in ("medium", "high"):
        return "ask", [], short_question(tri.get("question"), s), "broad class, nothing in email proves it"
    return "no", [], None, reason or "narrow product, no email evidence"


def match(dry, limit):
    t0 = time.time()
    deadline = t0 + MATCH_BUDGET_SEC
    todo = sb("settlement_unjudged_t", p_limit=limit) or []
    tally = {"proven": 0, "likely": 0, "ask": 0, "no": 0}
    left, ai_down, fails = 0, False, 0
    for n, s in enumerate(todo):
        if time.time() > deadline:
            left += len(todo) - n
            break
        try:
            m, ev, q, note = judge_one(s, deadline)
        except RuntimeError as e:
            fails += 1
            left += 1
            log(f"left unjudged: {s.get('name')[:60]} ({str(e)[:160]})")
            if fails >= 3 and sum(tally.values()) == 0:
                left += len(todo) - n - 1
                ai_down = True
                break
            continue
        fails = 0
        tally[m] += 1
        log(f"{m:7} {s.get('name')[:60]} :: {note}")
        if not dry:
            sb("settlement_judge_t", p_settlement=s["id"], p_match=m, p_evidence=ev, p_question=q)
    return len(todo), tally, left, ai_down


# ---------------------------------------------------------------- entry point (runjob.py calls main(argv) -> summary)

def main(argv):
    dry = "--dry" in argv
    limit = MATCH_CAP
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])
    lockf = open(RUN_LOCK, "w")
    try:
        fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return "skip: another settlement-finder run is in progress"

    today = datetime.now(TZ).date()
    state = load_state()
    parts, notes, ai_down, tally = [], [], False, None
    found = new = 0
    if "--match-only" not in argv:
        rows, notes, new = find(dry, today, state)
        found = len(rows)
        if not dry:
            save_state(state)
        parts.append(f"found {found} open, {new} new")
    if "--find-only" not in argv:
        try:
            n, tally, left, ai_down = match(dry, limit)
            parts.append(f"judged {n - left}: {tally['proven']} proven, {tally['likely']} likely, {tally['ask']} ask, {tally['no']} no")
            if left:
                parts.append(f"{left} left unjudged for tomorrow")
        except RuntimeError as e:
            raise RuntimeError(f"matcher failed: {e} (finder part: {', '.join(parts)})")
    summary = ", ".join(parts) + ("; " + "; ".join(notes) if notes else "")
    if ai_down:
        # every free model failed and nothing was judged: surface it as a failed run so the Team page / Scout see it
        raise RuntimeError("free AI unavailable, nothing judged; will retry tomorrow. " + summary)
    return summary + (" [dry run, nothing written]" if dry else "")


if __name__ == "__main__":
    t = time.time()
    try:
        out = main(sys.argv[1:])
        print(f"OK {int((time.time() - t) * 1000)}ms :: {out}")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL :: {type(e).__name__}: {e}")
        sys.exit(1)
