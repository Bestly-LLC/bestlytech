"""Nickel, Settlements Clerk - daily settlement FINDER + MATCHER (bestly-pi, 7:20 AM PT).

Installed as /opt/bestly/cron/jobs/settlement_finder.py (+ jobs/settlement-finder.py wrapper) and run by
/opt/bestly/cron/run.sh settlement-finder, which reports the heartbeat to pi_jobs via runjob.py -> pi_job_report.

  FIND   public listing pages -> settlement_upsert_t
           classaction.org/settlements          (HTML cards)
           topclassactions.com open-settlements (public RSS feed; the HTML page is behind a Cloudflare challenge
                                                 and is never fetched)
  MATCH  settlement_unjudged_t -> AI triage (terms, class period, fact_key) -> known answers (settlement_facts_t)
         -> his email by class-period dates incl. body text (settlement_mail_search2_t), devices on his home network
            (settlement_devices_t), Turo vehicles (settlement_vehicles_t) -> AI judge -> code checks on the cited rows
         -> settlement_judge2_t   (proven | likely | ask | no).  A fact he already answered settles the claim at once.

HARD LIMITS: never files or submits a claim, never fills a form, never solves a CAPTCHA, never emails anyone.
It only reads public listing pages and the evidence RPCs and writes verdicts. Free models only. Evidence rows always come
from real rows (an email's subject and date, a device name, a vehicle), never from AI text.

Auth: the house db-watchdog token (db_watchdog_ok) read from /home/pi/.bestly/db_watchdog_token (mode 600),
sent with the project's publishable key. The token is never printed or logged.

  DETAILS  settlement_needs_details_t -> the official settlement site (robots.txt, 4 s apart; its FAQ / "who is included" page
           when linked; the listing text when the site is blocked or empty) -> AI -> settlement_details_t (who qualifies, class period,
           places, exclusions, payouts, proof, how to check).  Then one plain-English "why you might qualify" line per live claim ->
           settlement_reason_t.  A details failure never fails the run.

  python3 settlement_finder.py [--dry] [--find-only] [--match-only] [--details-only] [--limit N] [--rejudge-asks]
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
MATCH_CAP = 60              # settlements judged per run (rest wait for tomorrow)
MATCH_BUDGET_SEC = 40 * 60  # stop judging after this long
DETAILS_CAP = 40            # settlements whose official site is read per run
DETAILS_BUDGET_SEC = 35 * 60
DETAILS_STALE_DAYS = 14     # (also enforced by settlement_needs_details_t)
MAIL_LIMIT = 15  # legacy (settlement_mail_search_t); the matcher now uses settlement_mail_search2_t

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
    for label, pat in (("check", r"\bby check\b|\bpaper check|\bmailed check|\ba check\b|\bcheck payment"), ("paypal", r"paypal"), ("venmo", r"venmo"), ("zelle", r"zelle"),
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


SIGSTOP = {"class", "action", "settlement", "data", "breach", "lawsuit", "unwanted", "calls", "call", "texts", "text", "tcpa", "the", "inc",
           "llc", "co", "corp", "company", "of", "and", "a", "privacy", "security", "incident"}


def sig(name, deadline):
    """Same settlement listed by two sources: first two distinctive name words + deadline."""
    n = re.sub(r"\$[\d.,]+\s*[mbk]?\b", " ", (name or "").lower().replace("\u2019", "").replace("'", ""))
    toks = [t for t in re.findall(r"[a-z0-9]+", n) if t not in SIGSTOP]
    return " ".join(toks[:2]) + "|" + (deadline or "")


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
        if admin and re.search(r"\bv\.|\bvs\b", admin):
            admin = None  # that line is the case caption, not an administrator
        desc = strip_html(it.findtext("description") or "")
        d = re.match(r"\s*(.{2,60}?)\s+(?:has\s+)?(?:agreed|will pay|to pay|reached)\b", desc)
        slug = link.rstrip("/").rsplit("/", 1)[-1]
        rows.append({
            "source_key": "tca:" + slug, "name": title, "defendant": squash(d.group(1)) if d else None,
            "administrator": squash(admin, 200) if admin else None, "claim_url": claim, "info_url": link,
            "class_definition": elig or None,
            "proof_required": None if not proof_txt else (False if re.match(r"(?i)^(n/?a|none|no)\b", proof_txt) else True),
            "est_payout": squash(" ".join(sec.get("Potential Award", [])), 120) or None, "deadline": dl.isoformat(),
            "payout_methods": payout_methods(" ".join(lines[:lines.index(next(x for x in lines if x in TCA_HEADERS))] if any(x in TCA_HEADERS for x in lines) else lines)),
            "status": "open", "source": "topclassactions.com",
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
    sigs = dict(state.setdefault("sigs", {}))
    uniq = []
    for r in rows:
        sg = sig(r["name"], r["deadline"])
        if sigs.get(sg, r["source_key"]) != r["source_key"]:
            continue  # same settlement already known under another source's key
        sigs[sg] = r["source_key"]
        uniq.append(r)
    rows = uniq
    state["sigs"] = sigs if not dry else state["sigs"]
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
    "consumer living in West Hollywood (Los Angeles), California, USA (not a business, not a minor). Assume nothing else; "
    "in particular do not assume he owns a home. "
    "Reply with ONE JSON object and nothing else.")

TRIAGE_USER = """Settlement: {name}
Defendant: {defendant}
Administrator: {administrator}
Who qualifies: {cls}
Claim deadline: {deadline}
Proof required: {proof}
From the official settlement site (may be incomplete; trust it over the short listing when they differ): {extra}

Facts already known about him (key (answer): question). Reuse a key when it is exactly the same fact:
{facts}

Return JSON with exactly these keys:
"terms": up to 6 short distinctive names (company, brand, product, app or service) that would appear in the SUBJECT, SENDER or BODY of an email from or about that company, e.g. ["Apple","iPhone"]. Real names only, 3+ characters. NEVER generic words like settlement, claim, class, inc, llc, bank, data, privacy, breach, products.
"plausibility": (judge ONLY from the class definition. Never state or assume anything about him that is not given. Not knowing whether he was personally notified, affected or a customer is NOT a reason for none or low: a data breach or product class of a company that serves ordinary consumers is "medium") "none" if the class clearly cannot include him (limited to residents of another state or country, limited to a specific city, neighborhood, property, plant area or store that does not include West Hollywood/Los Angeles, homeowner-only or landlord-only, businesses/employers/franchisees/providers only, minors only, one profession); "low" if it needs a narrow or unusual product most people never owned; "medium" for a common product, service or company many consumers use; "high" for a very broad consumer class (a major app, service, or mainstream product).
"no_reason": one short sentence if plausibility is none or low, else "".
"kind": one of "breach" (data breach / privacy incident notice class), "device" (a physical gadget or appliance), "vehicle", "service" (an app, website, account or subscription), "purchase" (goods or food bought in a store or online), "calls" (unwanted calls or texts), "other".
"period_start" and "period_end": the class period as YYYY-MM-DD when the class definition states one (use the 1st of the month when only a month is given, "" when open-ended or unknown).
"question": ONE short plain yes/no question in second person, max 140 characters, with the key years, like "Did you own a Google Pixel phone between 2016 and 2019?". Required when plausibility is medium or high, else "".
"fact_key": a short lowercase slug (letters, digits, hyphens, max 40 characters) for the ONE underlying fact that decides whether he is in the class, e.g. "owned-iphone", "used-facebook", "flo-app-user", "jeep-3-6l-owner", "chase-card", "ca-resident". Reuse a key from the known facts when it is the same fact. Prefer broad facts that other settlements can share, but NEVER so broad that a "yes" would be untrue for this class: when the class needs a specific period, store, state or model, put it in the key (for example "levoit-purifier-owner") or keep it as its own key. Required when plausibility is medium or high, else "".
"fact_question": the plain yes/no question for exactly that fact, second person, max 140 characters, true for EVERY settlement that would share the key, like "Have you ever owned an iPhone?". Required when fact_key is set, else "".
"""

JUDGE_SYS = (
    "You check whether ONE specific person (an adult consumer in Los Angeles County, California) is covered by a class action "
    "settlement, using ONLY the numbered candidates given (his email search hits with a short snippet, devices seen on his home "
    "network, vehicles on his Turo host account). Be conservative. Never invent facts. Reply with ONE JSON object and nothing else.")

JUDGE_USER = """Settlement: {name}
Defendant: {defendant}
Kind: {kind}
Who qualifies: {cls}
Class period: {period}

Candidates (E = an email of his, D = a device on his home network, V = a vehicle):
{cands}

Return JSON with exactly these keys:
"match": "proven" ONLY when
  (a) kind is breach and one of the E emails is a data-breach / security-incident NOTICE sent by or on behalf of that company to him, or
  (b) an E email is a receipt, order, shipping, subscription, account or statement email from that company for the product/service at issue and its date is inside the class period, or
  (c) a D device or V vehicle clearly IS the product at issue (same brand and model, and inside the model years or dates of the class).
"likely" when the candidates strongly suggest he is a customer/user or owner but you cannot confirm the period, model or product. "none" when the candidates are only marketing, newsletters, unrelated mentions or prove nothing. Marketing and newsletters are NEVER proof.
"evidence": list of the candidate labels you relied on, like ["E2","D1"] (empty when match is none).
"transactional": true if the cited E emails are receipts/orders/shipping/account/statement emails, false if marketing/newsletter/other.
"breach_notice": true if a cited E email is a data-breach notice from that company.
"in_class_period": true / false / null (null if the period is unknown or unclear).
"reason": one short sentence.
"""

BREACH_RX = re.compile(r"breach|security incident|data incident|unauthori[sz]ed|compromis|cyber|notice of (?:data|privacy)|your (?:personal )?information", re.I)
MAIL_PROMPT_CAP = 20


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


def ai_json(system, user, deadline, max_tokens=900):
    """Free AI ladder -> parsed JSON dict. One retry on bad JSON. Raises RuntimeError if every model fails."""
    if freellm is None:
        raise RuntimeError("freellm ladder not importable")
    last = None
    for _ in range(2):
        msg, who = freellm.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                                max_tokens=max_tokens, deadline=deadline, json_mode=True)
        try:
            obj = _json_obj(msg.get("content"))
            if isinstance(obj, list) and obj and isinstance(obj[0], dict):
                obj = obj[0]
            if not isinstance(obj, dict):
                raise ValueError("reply was not a JSON object")
            return obj, who
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


def fact_slug(k):
    k = re.sub(r"[^a-z0-9]+", "-", str(k or "").lower()).strip("-")[:40].strip("-")
    return k or None


def iso_date(v):
    v = str(v or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        try:
            return date.fromisoformat(v)
        except ValueError:
            return None
    return None


_MON = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"


def extract_period(text):
    """Fallback when the AI gave no usable dates: pull dates out of the class definition. Returns (start, end) or (None, None)."""
    found = []
    for m in re.finditer(r"\b(" + _MON + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", text or "", re.I):
        d = parse_date(f"{m.group(1)} {m.group(2)}, {m.group(3)}")
        if d:
            found.append(d)
    if not found:
        for m in re.finditer(r"\b(" + _MON + r")\.?,?\s+(\d{4})\b", text or "", re.I):
            d = parse_date(f"{m.group(1)} 1, {m.group(2)}")
            if d:
                found.append(d)
    if len(found) >= 2:
        return min(found), max(found)
    return None, None


def period_of(tri, s):
    a, b = iso_date(tri.get("period_start")), iso_date(tri.get("period_end"))
    cp = (s.get("details") or {}).get("class_period") or {}
    if not a and isinstance(cp, dict):  # read from the official site's FAQ: more reliable than the listing blurb
        a, b = iso_date(cp.get("start")), iso_date(cp.get("end")) or b
    if not a:
        a, b2 = extract_period(s.get("class_definition") or "")
        b = b or b2
    return a, b


def mail_row_date(e):
    try:
        return date.fromisoformat((e.get("sent_at") or "")[:10])
    except ValueError:
        return None


def head_hit(e, terms):
    h = f"{e.get('from') or ''} {e.get('subject') or ''}".lower()
    return any(t.lower() in h for t in terms)


def evidence_email(e):
    return {"kind": "email", "ref": e["id"],
            "summary": squash(f"{e.get('from')}: {e.get('subject')} ({(e.get('sent_at') or '')[:10]})", 240)}


def evidence_device(d):
    brand = f" ({d['brand']})" if d.get("brand") else ""
    return {"kind": "device", "ref": d.get("name"), "summary": squash(f"Seen on your home network: {d.get('name')}{brand}", 240)}


def evidence_vehicle(v):
    return {"kind": "vehicle", "ref": v.get("name"), "summary": squash(f"On your Turo host account: {v.get('name')}", 240)}


GENERIC_WORDS = {"home", "network", "hub", "light", "lights", "mini", "battery", "device", "plugin", "jared", "jareds", "bridge", "series",
                 "bathroom", "balcony", "kitchen", "living", "studio", "desk", "entry", "front", "door", "lock", "smart", "pure", "cool"}


def word_overlap(text, name, brand=None):
    """True when a distinctive word of the device/vehicle name (the brand only when the name has none) appears in the
    settlement text. Guards against the AI citing an unrelated device."""
    t = (text or "").lower()
    words = [w for w in re.findall(r"[a-z0-9]{4,}", str(name or "").lower()) if w not in GENERIC_WORDS]
    if not words and brand:
        words = [w for w in re.findall(r"[a-z0-9]{4,}", str(brand).lower())]
    return any(w in t for w in words)


class Run:
    """Per-run context: known facts, the evidence sources that are fetched once."""

    def __init__(self):
        self.facts = {}
        self.devices = []
        self.vehicles = []

    def load(self):
        try:
            for f in sb("settlement_facts_t") or []:
                self.facts[f["key"]] = {"question": f.get("question"), "answer": f.get("answer")}
        except Exception as e:  # noqa: BLE001
            log(f"facts unavailable ({str(e)[:120]})")
        try:
            self.devices = sb("settlement_devices_t") or []
        except Exception as e:  # noqa: BLE001
            log(f"devices unavailable ({str(e)[:120]})")
        try:
            self.vehicles = sb("settlement_vehicles_t") or []
        except Exception as e:  # noqa: BLE001
            log(f"vehicles unavailable ({str(e)[:120]})")
        log(f"facts known {len(self.facts)} ({sum(1 for f in self.facts.values() if f['answer'] is not None)} answered), "
            f"devices {len(self.devices)}, vehicles {len(self.vehicles)}")

    def facts_block(self):
        if not self.facts:
            return "(none yet)"
        lines = []
        for k, f in sorted(self.facts.items())[:80]:
            a = {True: "yes", False: "no", None: "unanswered"}[f["answer"]]
            lines.append(f"- {k} ({a}): {squash(f.get('question'), 110)}")
        return "\n".join(lines)


def judge_one(s, deadline, run):
    """Returns (match, evidence, question, note, fact_key, fact_question). Raises RuntimeError if the AI is unavailable
    (the settlement stays unjudged). Evidence rows always come from real rows (email, device, vehicle), never from AI text."""
    ctx = {"name": s.get("name"), "defendant": s.get("defendant") or "unknown", "administrator": s.get("administrator") or "unknown",
           "cls": squash(s.get("class_definition") or "not stated", 900), "deadline": s.get("deadline") or "unknown",
           "proof": {True: "yes", False: "no", None: "unknown"}[s.get("proof_required")], "facts": run.facts_block(),
           "extra": details_blurb(s.get("details"))}
    tri, _ = ai_json(TRIAGE_SYS, TRIAGE_USER.format(**ctx), deadline)
    plaus = str(tri.get("plausibility", "")).lower()
    if plaus not in ("none", "low", "medium", "high"):
        raise RuntimeError(f"bad plausibility {plaus!r}")
    reason = squash(tri.get("no_reason") or "", 200)
    if plaus == "none":
        return "no", [], None, reason or "class cannot include him", None, None
    kind = str(tri.get("kind") or "other").lower()
    fkey = fact_slug(tri.get("fact_key")) if plaus in ("medium", "high") else None
    fq = squash(tri.get("fact_question") or "", 160) or None
    question = short_question(tri.get("question"), s)
    known = run.facts.get(fkey) if fkey else None
    if known and known["answer"] is not None:
        # answered once already: no search needed, the RPC applies the answer (yes -> ready, no -> skipped)
        return "ask", [], question, f"fact {fkey} already answered {'yes' if known['answer'] else 'no'}", fkey, fq
    terms = clean_terms(tri.get("terms"), fallback_terms(s))
    p_start, p_end = period_of(tri, s)
    breach = kind == "breach"

    # ---- his email: class-period window first (not for breach notices, which arrive after the breach), then everything
    emails, windowed = [], False
    if terms:
        if p_start and not breach:
            win_end = (p_end or datetime.now(TZ).date()).isoformat()
            emails = sb("settlement_mail_search2_t", p_terms=terms, p_since=p_start.isoformat(), p_until=win_end, p_body=True, p_limit=40) or []
            windowed = bool(emails)
        if not emails:
            emails = sb("settlement_mail_search2_t", p_terms=terms, p_body=True, p_limit=40) or []
    emails.sort(key=lambda e: (not head_hit(e, terms), -(mail_row_date(e) or date.min).toordinal()))
    emails = emails[:MAIL_PROMPT_CAP]
    devices = run.devices if kind in ("device", "purchase", "service", "other") else []
    vehicles = run.vehicles if kind == "vehicle" else []

    cands = []
    for i, e in enumerate(emails, 1):
        cands.append(f"E{i}. {squash(e.get('from'), 60)} | {squash(e.get('subject'), 140)} | {(e.get('sent_at') or '')[:10]} | {squash(e.get('snippet'), 170)}")
    for i, d in enumerate(devices, 1):
        cands.append(f"D{i}. {d.get('name')}" + (f" (brand {d['brand']})" if d.get("brand") else ""))
    for i, v in enumerate(vehicles, 1):
        cands.append(f"V{i}. {v.get('name')} (make {v.get('make')}, model {v.get('model')}, year {v.get('year')})")
    verdict = None
    if cands:
        period = (f"{p_start.isoformat()} to {(p_end.isoformat() if p_end else 'present')}" if p_start else "not stated")
        j, _ = ai_json(JUDGE_SYS, JUDGE_USER.format(name=ctx["name"], defendant=ctx["defendant"], kind=kind, cls=ctx["cls"],
                                                    period=period, cands="\n".join(cands)), deadline)
        m = str(j.get("match", "none")).lower()
        labels = [str(x).upper() for x in (j.get("evidence") or []) if re.fullmatch(r"[EDV]\d{1,2}", str(x).upper())]
        e_used = [emails[int(l[1:]) - 1] for l in labels if l[0] == "E" and 1 <= int(l[1:]) <= len(emails)]
        d_used = [devices[int(l[1:]) - 1] for l in labels if l[0] == "D" and 1 <= int(l[1:]) <= len(devices)]
        v_used = [vehicles[int(l[1:]) - 1] for l in labels if l[0] == "V" and 1 <= int(l[1:]) <= len(vehicles)]
        class_text = f"{s.get('name')} {s.get('defendant')} {s.get('class_definition')}"
        # code-side checks: an AI "proven" is only accepted when the cited real rows pass them
        e_ok = [e for e in e_used if head_hit(e, terms)]
        d_ok = [d for d in d_used if word_overlap(class_text, d.get("name"), d.get("brand"))]
        v_ok = [v for v in v_used if word_overlap(class_text, f"{v.get('make')} {v.get('model')}")]
        in_period = lambda e: bool(p_start) and p_start <= (mail_row_date(e) or date.min) <= (p_end or datetime.now(TZ).date())  # noqa: E731
        trans = j.get("transactional") is True
        proven_email = [e for e in e_ok if (breach and j.get("breach_notice") is True and BREACH_RX.search(f"{e.get('subject')} {e.get('snippet')}"))
                        or (trans and not breach and j.get("in_class_period") is True and in_period(e))]
        reason_txt = squash(j.get("reason") or "", 160)
        if m == "proven" and (proven_email or ((d_ok or v_ok) and j.get("in_class_period") is not False)):
            ev = [evidence_email(e) for e in (proven_email or [])] + [evidence_device(d) for d in d_ok] + [evidence_vehicle(v) for v in v_ok]
            verdict = ("proven", ev, None, reason_txt or "real record inside the class")
        elif m in ("proven", "likely") and (e_ok or d_ok or v_ok) and (trans or j.get("breach_notice") is True or d_ok or v_ok):
            ev = [evidence_email(e) for e in e_ok] + [evidence_device(d) for d in d_ok] + [evidence_vehicle(v) for v in v_ok]
            verdict = ("likely", ev, None, reason_txt or "records suggest it, not confirmed")
    if verdict:
        return verdict + (fkey, fq)
    if plaus in ("medium", "high"):
        return "ask", [], question, "broad class, nothing in his records proves it", fkey, fq
    return "no", [], None, reason or "narrow product, no trace in his records", None, None


def record(s, m, ev, q, fkey, fq, run, dry):
    if fkey and m == "ask":
        run.facts.setdefault(fkey, {"question": fq or q, "answer": None})
    if dry:
        return
    sb("settlement_judge2_t", p_settlement=s["id"], p_match=m, p_evidence=ev, p_question=q, p_fact_key=fkey, p_fact_question=fq)


def match(dry, limit, state, run):
    judged = state.setdefault("judged", {})
    t0 = time.time()
    deadline = t0 + MATCH_BUDGET_SEC
    todo = sb("settlement_unjudged_t", p_limit=limit) or []
    tally = {"proven": 0, "likely": 0, "ask": 0, "no": 0}
    left, ai_down, fails = 0, False, 0
    for n, s in enumerate(todo):
        if time.time() > deadline:
            left += len(todo) - n
            break
        sg = sig(s.get("name"), s.get("deadline"))
        try:
            if judged.get(sg, s["source_key"]) != s["source_key"]:
                m, ev, q, note, fkey, fq = "no", [], None, "duplicate listing of " + judged[sg], None, None
            else:
                m, ev, q, note, fkey, fq = judge_one(s, deadline, run)
        except Exception as e:  # noqa: BLE001  one bad AI reply must never kill the run; it stays unjudged for tomorrow
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
        judged.setdefault(sg, s["source_key"])
        log(f"{m:7} {s.get('name')[:60]} :: {note}" + (f" [{fkey}]" if fkey else ""))
        record(s, m, ev, q, fkey, fq, run, dry)
    return len(todo), tally, left, ai_down


def rejudge_asks(dry, state, run):
    """One-off: give every claim still waiting at 'ask' a fact_key and look for proof again with the deeper search.
    A claim that is now provable moves to ready; one whose fact is already answered is settled by the answer."""
    deadline = time.time() + MATCH_BUDGET_SEC
    todo = sb("settlement_rejudge_list_t", p_limit=100) or []
    tally = {"proven": 0, "likely": 0, "ask": 0, "no": 0}
    left, fails = 0, 0
    for n, s in enumerate(todo):
        if time.time() > deadline:
            left += len(todo) - n
            break
        try:
            m, ev, q, note, fkey, fq = judge_one(s, deadline, run)
        except Exception as e:  # noqa: BLE001
            fails += 1
            left += 1
            log(f"left as ask: {s.get('name')[:60]} ({str(e)[:160]})")
            if fails >= 4 and sum(tally.values()) == 0:
                left += len(todo) - n - 1
                break
            continue
        fails = 0
        tally[m] += 1
        log(f"{m:7} {s.get('name')[:60]} :: {note}" + (f" [{fkey}]" if fkey else ""))
        record(s, m, ev, q, fkey, fq, run, dry)
    return len(todo), tally, left


# ---------------------------------------------------------------- DETAILS: richer eligibility info per settlement

CHALLENGE_RX = re.compile(r"just a moment|cf-chl|checking your browser|attention required|enable javascript and cookies|verify you are human|"
                          r"captcha|access denied|request blocked|are you a robot", re.I)
SKIP_HOSTS = ("topclassactions.com",)  # HTML sits behind a Cloudflare challenge: never fetched (the RSS text is already in the listing)
_last_fetch = [0.0]
_done = set()  # settlement ids handled by the details phase in this run


def polite_get(url):
    """One page, text only. robots.txt obeyed, >= 4 s after the previous details request, a block/challenge is NOT worked
    around. Returns (html, status) where status is ok | blocked | robots | error."""
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if any(host.endswith(h) for h in SKIP_HOSTS) or not re.match(r"https?://", url or ""):
        return None, "skipped"
    wait = SOURCE_GAP_SEC - (time.time() - _last_fetch[0])
    if wait > 0:
        time.sleep(wait)
    _last_fetch[0] = time.time()
    try:
        raw = _http(url, tries=2, timeout=30)
    except urllib.error.HTTPError as e:
        return None, "blocked" if e.code in (401, 403, 451) else "error"
    except RuntimeError as e:
        return None, "robots" if "robots.txt" in str(e) else "error"
    except Exception:  # noqa: BLE001
        return None, "error"
    finally:
        _last_fetch[0] = time.time()
    h = raw[:600000].decode("utf-8", "replace")
    if CHALLENGE_RX.search(h[:6000]) and len(strip_html(h)) < 1500:
        return None, "blocked"
    return h, "ok"


def page_text(h, cap):
    """Readable text of a page: title + distinct lines of 4+ words (menus and footers mostly fall away)."""
    title = re.search(r"(?is)<title[^>]*>(.*?)</title>", h)
    seen, out, n = set(), [], 0
    for ln in strip_html(h).split("\n"):
        ln = squash(ln)
        if len(ln.split()) < 4 or ln.lower() in seen:
            continue
        seen.add(ln.lower())
        out.append(ln)
        n += len(ln)
        if n > cap:
            break
    head = squash(strip_html(title.group(1)), 120) + "\n" if title else ""
    return (head + "\n".join(out))[:cap]


def page_links(h, base):
    return [(urllib.parse.urljoin(base, html.unescape(href).strip()), squash(strip_html(inner), 80))
            for href, inner in re.findall(r'(?is)<a\s[^>]*href="([^"#][^"]*)"[^>]*>(.*?)</a>', h)]


def faq_links(links, base):
    """Same-site pages that answer 'who is included': FAQ first, then eligibility, then important dates."""
    bh = (urllib.parse.urlsplit(base).hostname or "").lower().removeprefix("www.")
    scored = {}
    for u, t in links:
        pu = urllib.parse.urlsplit(u)
        if (pu.hostname or "").lower().removeprefix("www.") != bh or pu.scheme not in ("http", "https"):
            continue
        if re.search(r"\.(pdf|docx?|xlsx?|zip|png|jpe?g)$", pu.path, re.I) or u.rstrip("/") == base.rstrip("/"):
            continue
        key = f"{t} {pu.path}".lower()
        sc = 3 if re.search(r"faq|frequently|questions", key) else 2 if re.search(r"who[- ]?is|eligib|class[- ]?member|am[- ]?i[- ]?(a[- ]?)?(included|eligible)|qualif", key) else \
            1 if re.search(r"important[- ]?dates|deadline|about|summary|settlement[- ]?info|learn[- ]?more", key) else 0
        if sc and scored.get(u.split("?")[0], (0,))[0] < sc:
            scored[u.split("?")[0]] = (sc, u)
    return [v[1] for v in sorted(scored.values(), key=lambda x: -x[0])[:2]]


def claim_form_link(links, fallback):
    for u, t in links:
        if re.search(r"(file|submit|make|start)\s+(a|your)?\s*claim|claim\s*form|online claim", t, re.I) and u.startswith("http"):
            return u
    return fallback


DETAILS_SYS = (
    "You read the public website of ONE class action settlement and explain it to ONE person: an adult consumer living in West "
    "Hollywood, California. Use ONLY facts stated in the text. Never guess; leave a field empty or null when the text does not say. "
    "Write short, plain, everyday English sentences (8th grade, no legal words like 'putative', 'releasor', 'pursuant'). "
    "Reply with ONE JSON object and nothing else.")

DETAILS_USER = """Settlement: {name}
Defendant: {defendant}
Claim deadline: {deadline}
Estimated payout (listing): {payout}
Proof required (listing): {proof}

TEXT FROM THE SETTLEMENT SITE AND LISTING:
{text}

Return JSON with exactly these keys:
"who_qualifies": 1 to 4 short plain sentences in second person saying who can claim, like "You qualify if you bought a Levoit Core 300 air purifier in the US between 2019 and 2024." Max 170 characters each.
"class_start" and "class_end": the class period as YYYY-MM-DD ("" if not stated or open-ended; use the 1st of the month when only a month is given).
"locations": where the class applies, as short names like ["California"] or ["Nationwide"] or ["Illinois"]. [] when not stated.
"excluded": 0 to 4 short plain sentences about who is left out (employees, people who opted out, businesses, judges...). [] when not stated.
"payout_no_proof": what a person gets WITHOUT documents, like "Up to $50" or "$15 per person". "" if not stated.
"payout_with_proof": what a person can get WITH documents, like "Up to $5,000 for documented losses". "" if not stated.
"proof_examples": 0 to 5 short items naming what counts as proof, like "Receipt", "Bank statement showing the charge", "Order confirmation email". [] when not stated.
"how_to_check": ONE plain sentence on how a person can tell if they are in the class, like "Look for a notice email from Acme sent in 2023, or check if you bought the product." Max 200 characters.
"""

REASON_SYS = (
    "You are Nickel, a careful assistant who explains to ONE person (Jared, an adult consumer living in West Hollywood, California) "
    "why he might qualify for a class action settlement. Plain, short, friendly English. No legal words. Never claim evidence that "
    "is not listed under EVIDENCE: if EVIDENCE is empty, say that nothing in his records points either way yet (his synced email "
    "only goes back to April 2026, so an empty search is NOT a sign he is out). Reply with ONE JSON object and nothing else.")

REASON_USER = """Settlement: {name}
Defendant: {defendant}
Claim deadline: {deadline}
Where Nickel stands: {stand}
What the official site says: {extra}

EVIDENCE (real records only):
{evidence}

Current question for him: {question}
{fact_line}
Return JSON with exactly these keys:
"reasoning": 1 to 3 short plain sentences (max 420 characters in total): why he might qualify, what in his records points either way (only what is listed under EVIDENCE), and what would prove it (a receipt, an email, an account). Say "you", not "he".
"question": ONLY when the current question is not "(none)": the same yes/no question rewritten in second person with the specific dates / places / product from the official site, max 140 characters, ends with "?". It must ask about the SAME underlying fact. Otherwise "".
"fact_question": ONLY when a fact key is given: a generic yes/no question for exactly that fact, max 140 characters, ends with "?", no dates that only fit this one settlement. Otherwise "".
"""


def _strs(v, n, width):
    out = []
    for x in (v if isinstance(v, list) else []):
        x = squash(str(x), width)
        if len(x) >= 3 and x.lower() not in [o.lower() for o in out]:
            out.append(x)
    return out[:n]


def _money(v):
    v = squash(str(v or ""), 160)
    return v if v and v.lower() not in ("none", "n/a", "null", "not stated", "unknown") else None


def clean_details(d, official, claim_form):
    """AI object -> the contract shape. URLs come from code (the fetched page's own links), never from AI text."""
    a, b = iso_date(d.get("class_start")), iso_date(d.get("class_end"))
    if a and b and b < a:
        a, b = b, a
    return {
        "who_qualifies": _strs(d.get("who_qualifies"), 4, 190),
        "class_period": {"start": a.isoformat() if a else None, "end": b.isoformat() if b else None},
        "locations": _strs(d.get("locations"), 6, 60),
        "excluded": _strs(d.get("excluded"), 4, 190),
        "payout_no_proof": _money(d.get("payout_no_proof")),
        "payout_with_proof": _money(d.get("payout_with_proof")),
        "proof_examples": _strs(d.get("proof_examples"), 5, 90),
        "how_to_check": squash(d.get("how_to_check") or "", 220) or None,
        "official_site": official, "claim_form": claim_form,
        "fetched_at": datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def details_blurb(d):
    """Compact text of a settlement's details for the triage / reasoning prompts ('not read yet' when there are none)."""
    if not isinstance(d, dict) or not d:
        return "not read yet"
    cp = d.get("class_period") or {}
    bits = []
    if d.get("who_qualifies"):
        bits.append("who qualifies: " + " ".join(d["who_qualifies"])[:500])
    if cp.get("start") or cp.get("end"):
        bits.append(f"class period {cp.get('start') or '?'} to {cp.get('end') or '?'}")
    if d.get("locations"):
        bits.append("places: " + ", ".join(d["locations"]))
    if d.get("excluded"):
        bits.append("left out: " + " ".join(d["excluded"])[:300])
    if d.get("how_to_check"):
        bits.append("how to check: " + d["how_to_check"])
    return "; ".join(bits)[:1200] or "not read yet"


def gather_text(s):
    """Fetch the official site (+ its FAQ pages) politely. Returns (text, official_site, claim_form, basis)."""
    listing = squash(" | ".join(x for x in (
        "Who is eligible (listing): " + (s.get("class_definition") or ""),
        "Proof (listing): " + ((s.get("raw") or {}).get("proof_text") or ""),
        "Payout (listing): " + (s.get("est_payout") or "")) if x.split(": ", 1)[1].strip()), 1500)
    base = s.get("claim_url") or s.get("info_url")
    pages, links, official, status = [], [], None, "skipped"
    first = None
    for u in (s.get("claim_url"), s.get("info_url")):
        if not u:
            continue
        h, status = polite_get(u)
        if h:
            first = (u, h)
            break
    if first:
        u, h = first
        official = u
        links = page_links(h, u)
        pages.append(page_text(h, 3500))
        for fu in faq_links(links, u):
            fh, fst = polite_get(fu)
            if fh:
                pages.append(page_text(fh, 4500))
                links += page_links(fh, fu)
    body = "\n\n".join(p for p in pages if p)
    basis = "site" if len(body) > 400 else "listing"
    text = (("OFFICIAL SITE:\n" + body + "\n\n") if body else "") + "LISTING:\n" + listing
    return text[:9000], (official or (base if base and not any(h in base for h in SKIP_HOSTS) else None)), \
        claim_form_link(links, s.get("claim_url")), basis, status


def extract_details(s, deadline):
    text, official, form, basis, status = gather_text(s)
    if not text.split("LISTING:", 1)[-1].strip() and basis == "listing":
        raise RuntimeError("no text to read")
    d, _ = ai_json(DETAILS_SYS, DETAILS_USER.format(
        name=s.get("name"), defendant=s.get("defendant") or "unknown", deadline=s.get("deadline") or "unknown",
        payout=s.get("est_payout") or "not stated", proof={True: "yes", False: "no", None: "unknown"}[s.get("proof_required")], text=text),
        deadline, max_tokens=1100)
    det = clean_details(d, official, form)
    det["basis"] = basis  # extra, harmless: 'site' = read from the settlement's own pages, 'listing' = only the listing text
    if not (det["who_qualifies"] or det["how_to_check"] or det["payout_no_proof"] or det["payout_with_proof"]):
        raise RuntimeError(f"AI returned nothing usable (basis {basis}, site {status})")
    return det, basis, status


EVIDENCE_CLAIM_RX = re.compile(r"\bwe (found|saw)\b|\bI found\b|\bfound (an?|your) (email|receipt|order)\b|"
                               r"\byour (emails?|records|inbox|receipts?|account) (show|shows|showed|confirm|confirms|prove|proves|include|includes|contain)\b|"
                               r"\bin your (inbox|mailbox)\b", re.I)


def reason_one(row, deadline):
    """1-3 plain sentences (+ sharper questions). Evidence only from the claim's real rows."""
    ev = row.get("claim_evidence") or []
    ev_lines = "\n".join(f"- {e.get('kind')}: {squash(e.get('summary'), 200)}" for e in ev if isinstance(e, dict)) or "(none)"
    match, status = row.get("claim_match"), row.get("claim_status")
    stand = {"proven": "his own records appear to prove he is in the class", "likely": "his records suggest he is in the class but it is not confirmed",
             "ask": "nothing in his records settles it; he is being asked a yes/no question"}.get(match, str(match))
    if row.get("claim_answer") is True:
        stand += "; he already answered YES to the question"
    elif row.get("claim_answer") is False:
        stand += "; he already answered NO to the question"
    cq = row.get("claim_question") if (status == "found" and row.get("claim_answer") is None) else None
    fk = row.get("claim_fact_key")
    j, _ = ai_json(REASON_SYS, REASON_USER.format(
        name=row.get("name"), defendant=row.get("defendant") or "unknown", deadline=row.get("deadline") or "unknown", stand=stand,
        extra=details_blurb(row.get("details")), evidence=ev_lines, question=cq or "(none)",
        fact_line=(f'Fact key (the underlying fact, do not change what it means): {fk}\n' if fk and cq else "")), deadline, max_tokens=600)
    txt = squash(j.get("reasoning") or "", 700)
    if len(txt) < 20:
        raise RuntimeError("empty reasoning")
    if not ev and EVIDENCE_CLAIM_RX.search(txt):
        # the AI claimed a record that does not exist: fall back to the plain, true statement
        txt = "Nothing in your records points either way yet. " + ("Check the official site to see if you qualify." if not cq else "Your answer to the question below settles it.")
    q = squash(j.get("question") or "", 180) if cq else None
    if q and not (q.endswith("?") and 12 <= len(q) <= 180 and re.search(r"\byou(r)?\b", q, re.I)):
        q = None
    fq = squash(j.get("fact_question") or "", 180) if (fk and cq) else None
    if fq and not (fq.endswith("?") and 12 <= len(fq) <= 180 and re.search(r"\byou(r)?\b", fq, re.I)):
        fq = None
    return txt, q, fq


def details_phase(dry, cap, budget_sec, only_reasoning=False, log_examples=None):
    """Read the official sites for settlements missing fresh details and write a reason for each live claim.
    Returns a stats dict. Raises nothing for a single bad settlement; RuntimeError only when the RPC itself is unreachable."""
    st = {"todo": 0, "details": 0, "site": 0, "listing": 0, "reasons": 0, "failed": 0, "ai_down": False}
    deadline = time.time() + budget_sec
    rows = sb("settlement_needs_details_t", p_limit=cap) or []
    st["todo"] = len(rows)
    fails = 0
    for r in rows:
        if r["id"] in _done:
            continue
        if time.time() > deadline:
            break
        _done.add(r["id"])
        try:
            if r.get("need_details") and not only_reasoning:
                det, basis, status = extract_details(r, deadline)
                r["details"] = det
                if not dry:
                    sb("settlement_details_t", p_settlement=r["id"], p_details=det)
                st["details"] += 1
                st[basis] += 1
                log(f"details {basis:7} {r['name'][:56]} :: {(det['who_qualifies'] or ['-'])[0][:90]}")
            if (r.get("claim_id") and r.get("claim_match") != "no" and r.get("claim_status") not in ("skipped", "expired")
                    and (r.get("claim_reasoning") is None or r.get("need_details"))):
                if r.get("details"):
                    txt, q, fq = reason_one(r, deadline)
                    if not dry:
                        sb("settlement_reason_t", p_claim=r["claim_id"], p_reasoning=txt, p_question=q, p_fact_question=fq)
                    st["reasons"] += 1
                    if log_examples is not None:
                        log_examples.append({"name": r["name"], "details": r.get("details"), "reasoning": txt, "question": q})
            fails = 0
        except Exception as e:  # noqa: BLE001  one bad site / reply never stops the phase
            st["failed"] += 1
            fails += 1
            log(f"details failed: {r.get('name', '')[:56]} ({str(e)[:140]})")
            if fails >= 4 and st["details"] + st["reasons"] == 0:
                st["ai_down"] = True
                break
    return st


def details_summary(st):
    out = f"details {st['details']}/{st['todo']} ({st['site']} from site, {st['listing']} from listing text), {st['reasons']} reasons"
    return out + (f", {st['failed']} failed" if st["failed"] else "") + (" [free AI unavailable]" if st["ai_down"] else "")


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
    if "--rejudge-asks" in argv:
        run = Run()
        run.load()
        n, tally, left = rejudge_asks(dry, state, run)
        parts.append(f"re-judged {n - left} asks: {tally['proven']} proven, {tally['likely']} likely, {tally['ask']} still ask, {tally['no']} no")
        if left:
            parts.append(f"{left} left as ask")
        return ", ".join(parts) + (" [dry run, nothing written]" if dry else "")
    if "--details-only" in argv:
        # manual / catch-up pass: details + reasons only (no find, no judging). --limit N = how many settlements to read.
        ex = []
        st = details_phase(dry, limit if "--limit" in argv else DETAILS_CAP, DETAILS_BUDGET_SEC, log_examples=ex)
        if "--examples" in argv:
            print("EXAMPLES " + json.dumps(ex[:3], ensure_ascii=False, indent=1), flush=True)
        if st["ai_down"]:
            raise RuntimeError("free AI unavailable, no details written. " + details_summary(st))
        return details_summary(st) + (" [dry run, nothing written]" if dry else "")
    if "--match-only" not in argv:
        rows, notes, new = find(dry, today, state)
        found = len(rows)
        if not dry:
            save_state(state)
        parts.append(f"found {found} open, {new} new")
    if "--find-only" not in argv:
        try:  # DETAILS first, so the matcher below can use class period / places from the official site. Never fails the run.
            st = details_phase(dry, DETAILS_CAP, DETAILS_BUDGET_SEC)
            parts.append(details_summary(st))
        except Exception as e:  # noqa: BLE001
            notes.append(f"details phase skipped: {str(e)[:140]}")
        try:
            run = Run()
            run.load()
            n, tally, left, ai_down = match(dry, limit, state, run)
            if not dry:
                save_state(state)
            parts.append(f"judged {n - left}: {tally['proven']} proven, {tally['likely']} likely, {tally['ask']} ask, {tally['no']} no")
            if left:
                parts.append(f"{left} left unjudged for tomorrow")
        except RuntimeError as e:
            raise RuntimeError(f"matcher failed: {e} (finder part: {', '.join(parts)})")
    if "--find-only" not in argv:
        try:  # reasons for the claims judged just now (their details are already saved)
            st2 = details_phase(dry, 30, 12 * 60, only_reasoning=True)
            if st2["reasons"] or st2["failed"]:
                parts.append(f"{st2['reasons']} more reasons" + (f" ({st2['failed']} failed)" if st2["failed"] else ""))
        except Exception as e:  # noqa: BLE001
            notes.append(f"reasons pass skipped: {str(e)[:140]}")
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
