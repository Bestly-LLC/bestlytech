#!/usr/bin/env python3
"""Claim Filer (Mac mini, launchd tech.bestly.settlement-filer, every 30 min). Team card: settlement-filer, tool of Nickel (settlements).

Files the class action claims Jared approved (settlement_claims.status = 'approved'; the 'Yes, file all' tap is his sworn
statement that he is in each class). Fills the claim form from his saved details (settlement_profile), ticks the attestation box,
screenshots the form, submits, reads the confirmation number, reports through settlement_filed_t.

HARD RULES (do not loosen):
  - Only claims handed out by settlement_take_approved_t, one at a time. Nothing else is ever filed.
  - Refuses to run until Jared has confirmed his details (confirmed_at) and street/city/state/zip are filled in.
  - Never enters bank account/routing numbers, card numbers, SSN or any government ID. Payout is PayPal, Venmo or paper check.
  - Never guesses. A claim/notice ID, document upload, login, CAPTCHA/bot wall, or any question that is not in his saved
    details -> needs_you with one plain sentence. Never solves or bypasses a CAPTCHA or bot check, never creates an account.
  - Personal values are put into fields by THIS code from the saved profile. The free AI only sees field labels and the class
    definition, and can only pick "which profile field" or "yes, class member" - never free text.
Free AI only (FreeLLM via the Pi, tunnel to localhost:13001 like the Code Worker). No paid API. Python 3.9 compatible.
"""
import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request

SB = "https://rcqfqhguwpmaarseifqg.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"      # publishable key (same one the Code Worker / Edge Guard use)
HOME = os.path.expanduser("~")
BASE = os.path.join(HOME, "bestly-agents", "settlement-filer")
RECEIPTS = os.path.join(BASE, "receipts")
LOG = os.path.join(HOME, "logs", "settlement-filer.log")
LOCK = os.path.join(BASE, "run.lock")
PY = sys.executable

FREELLM_LAN = "http://192.168.1.211:3001"
AGENT_PORT = 13001
LLM_MODELS = ["gpt-oss-120b", "qwen3-coder-480b", "deepseek-v4-flash", "nemotron-3-super-120b", "gemini-3.8-flash"]

MAX_CLAIMS_PER_RUN = 3
CLAIM_SECONDS = 180            # cooperative deadline per claim
CLAIM_HARD_SECONDS = 215       # watchdog thread kills the run if a claim hangs this long
RUN_HARD_SECONDS = 14 * 60

STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
          "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
          "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
          "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
          "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
          "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
          "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
          "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
          "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}


# ------------------------------------------------------------------------------------------------ plumbing
def log(*a):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line, flush=True)


_TOKEN = [None]


def token():
    if not _TOKEN[0]:
        _TOKEN[0] = subprocess.run(["security", "find-generic-password", "-s", "bestly-db-watchdog", "-w"],
                                   capture_output=True, text=True).stdout.strip()
    return _TOKEN[0]


def http(url, body=None, headers=None, timeout=60):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return json.loads(raw.decode())
            except Exception:
                return raw
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %s from %s: %s" % (e.code, url.split("?")[0], e.read().decode()[:300]))


def rpc(name, args):
    a = dict(args)
    a["p_token"] = token()
    return http("%s/rest/v1/rpc/%s" % (SB, name), a, {"apikey": ANON, "Authorization": "Bearer " + ANON})


def beat(ok, summary):
    try:
        rpc("settlement_filer_beat_t", {"p_ok": bool(ok), "p_summary": (summary or "")[:480]})
    except Exception as e:
        log("heartbeat failed:", e)


def report_needs_you(claim_id, why, url):
    why = (why or "Something stopped me on this one.").strip()[:300]
    rpc("settlement_filed_t", {"p_id": claim_id, "p_ok": False, "p_confirmation": None, "p_payout_method": None,
                               "p_needs_you_url": url, "p_why": why})


# ------------------------------------------------------------------------------------------------ free AI
_KEY = [None]


def freellm_key():
    if os.environ.get("FREELLM_KEY"):
        return os.environ["FREELLM_KEY"]
    if _KEY[0]:
        return _KEY[0]
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "bestly-pi",
                        "cd /opt/bestly/cron && python3 -c 'import lib;print(lib.rpc(\"pi_secret\",p_name=\"Scout-FreeLLM\"))'"],
                       capture_output=True, text=True, timeout=30)
    k = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    if not k:
        raise RuntimeError("could not get the FreeLLM key from the Pi")
    _KEY[0] = k
    return k


def llm_base():
    url = "http://127.0.0.1:%d" % AGENT_PORT
    hdr = {"Authorization": "Bearer " + freellm_key()}
    try:
        http(url + "/v1/models", headers=hdr, timeout=5)
        return url
    except Exception:
        pass
    try:
        subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", "-f", "-N",
                        "-L", "127.0.0.1:%d:127.0.0.1:3001" % AGENT_PORT, "bestly-pi"], capture_output=True, timeout=20)
    except Exception:
        pass
    for _ in range(8):
        try:
            http(url + "/v1/models", headers=hdr, timeout=5)
            return url
        except Exception:
            time.sleep(1)
    return FREELLM_LAN


def llm_json(system, user):
    """Ask the free ladder for one JSON object. Raises if every model fails."""
    base = llm_base()
    hdr = {"Authorization": "Bearer " + freellm_key()}
    try:
        have = set(m.get("id") for m in http(base + "/v1/models", headers=hdr, timeout=15).get("data", []))
    except Exception:
        have = set()
    models = [m for m in LLM_MODELS if m in have] or LLM_MODELS
    last = None
    for m in models:
        try:
            j = http(base + "/v1/chat/completions", {"model": m, "temperature": 0, "max_tokens": 1800,
                     "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}, hdr, timeout=60)
            txt = j["choices"][0]["message"]["content"]
            a, b = txt.find("{"), txt.rfind("}")
            if a < 0 or b <= a:
                raise ValueError("no JSON in reply")
            return json.loads(txt[a:b + 1])
        except Exception as e:
            last = e
            log("llm", m, "failed:", str(e)[:160])
    raise RuntimeError("all free models failed: %s" % last)


# ------------------------------------------------------------------------------------------------ profile
def build_values(profile):
    """The only personal values that may ever be typed into a form."""
    name = (profile.get("full_name") or "").strip()
    parts = name.split()
    first = " ".join(parts[:-1]) if len(parts) > 1 else name
    last = parts[-1] if len(parts) > 1 else ""
    d = re.sub(r"\D", "", profile.get("phone") or "")
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    national = "%s-%s-%s" % (d[:3], d[3:6], d[6:]) if len(d) == 10 else (profile.get("phone") or "")
    st = (profile.get("state") or "").strip()
    abbr = st.upper() if len(st) == 2 and st.upper() in STATES else ""
    if not abbr:
        for k, v in STATES.items():
            if v.lower() == st.lower():
                abbr = k
    return {"full_name": name, "first": first, "last": last, "email": (profile.get("email") or "").strip(),
            "phone": national, "phone_digits": d, "street": (profile.get("street") or "").strip(),
            "unit": (profile.get("unit") or "").strip(), "city": (profile.get("city") or "").strip(),
            "state": abbr, "state_name": STATES.get(abbr, st), "zip": (profile.get("zip") or "").strip(),
            "country": "United States", "paypal_email": (profile.get("paypal_email") or "").strip(),
            "venmo_handle": (profile.get("venmo_handle") or "").strip()}


def profile_gate(profile):
    """Returns '' when the filer may run, else the plain reason."""
    if not profile or not profile.get("confirmed_at"):
        return "waiting for Jared to confirm claim details"
    for k in ("full_name", "email", "street", "city", "state", "zip"):
        if not (profile.get(k) or "").strip():
            return "waiting for Jared to confirm claim details (missing %s)" % k
    if not build_values(profile)["state"]:
        return "waiting for Jared to confirm claim details (state not recognized)"
    return ""


def intended_payout(profile):
    pref = (profile.get("payout_pref") or "check").lower()
    if pref == "paypal" and (profile.get("paypal_email") or "").strip():
        return "paypal"
    if pref == "venmo" and (profile.get("venmo_handle") or "").strip():
        return "venmo"
    return "check"


# ------------------------------------------------------------------------------------------------ page helpers (JS)
EXTRACT_JS = r"""
() => {
  window.__nfc = window.__nfc || 0;
  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const vis = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0; };
  const labelEl = el => { let l = null; if (el.id) { try { l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); } catch (e) {} } return l || el.closest('label'); };
  const labelOf = el => { let t = ''; const l = labelEl(el); if (l) t += ' ' + l.innerText;
    const al = el.getAttribute('aria-label'); if (al) t += ' ' + al;
    const lb = el.getAttribute('aria-labelledby'); if (lb) lb.split(/\s+/).forEach(id => { const n = document.getElementById(id); if (n) t += ' ' + n.innerText; });
    return clean(t); };
  const SEL = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]),select,textarea';
  const nF = c => c.querySelectorAll(SEL).length;
  const ctxOf = el => { let base = 1; const t = (el.getAttribute('type') || '').toLowerCase();
    if (t === 'radio' && el.name) base = document.querySelectorAll('input[type=radio][name="' + el.name + '"]').length;
    let c = el.parentElement; while (c && c.parentElement && c.parentElement !== document.body && nF(c.parentElement) <= base) c = c.parentElement;
    return c ? clean(c.innerText).slice(0, 300) : ''; };
  const out = []; const radios = {};
  document.querySelectorAll(SEL).forEach(el => {
    const tag = el.tagName.toLowerCase();
    const t = (el.getAttribute('type') || (tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'text')).toLowerCase();
    if (el.disabled) return;
    const lab = labelEl(el);
    const visible = (t === 'radio' || t === 'checkbox') ? (vis(el) || vis(lab)) : vis(el);
    if (!visible) return;
    if (!el.hasAttribute('data-nf')) el.setAttribute('data-nf', ++window.__nfc);
    const nf = +el.getAttribute('data-nf');
    const label = labelOf(el);
    const search = t === 'search' || /search/i.test((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')) || !!el.closest('[role=search]');
    const base = { nf, type: t, name: el.name || '', id: el.id || '', label, placeholder: el.placeholder || '',
      autocomplete: el.getAttribute('autocomplete') || '', required: !!el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(label),
      maxlength: el.maxLength > 0 ? el.maxLength : 0, ctx: ctxOf(el), search, value: '' };
    if (t === 'radio') {
      const key = el.name || ('r' + nf);
      if (!radios[key]) { const fs = el.closest('fieldset'); const lg = fs ? fs.querySelector('legend') : null;
        radios[key] = Object.assign({}, base, { kind: 'radio', label: lg ? clean(lg.innerText) : '', options: [], required: false }); out.push(radios[key]); }
      const g = radios[key]; g.options.push({ nf, label: label || el.value, value: el.value, checked: el.checked });
      g.required = g.required || !!el.required || el.getAttribute('aria-required') === 'true' || /\*/.test(g.ctx.slice(0, 120));
      if (el.checked) g.value = el.value; return; }
    if (t === 'select') { base.kind = 'select'; base.options = Array.from(el.options).map(o => ({ value: o.value, label: clean(o.text), disabled: o.disabled })); base.value = el.value; }
    else if (t === 'checkbox') { base.kind = 'checkbox'; base.checked = el.checked; base.value = el.checked ? 'on' : ''; }
    else if (t === 'file') { base.kind = 'file'; }
    else if (t === 'password') { base.kind = 'password'; }
    else if (t === 'textarea') { base.kind = 'textarea'; base.value = el.value; }
    else { base.kind = 'text'; base.value = el.value; }
    out.push(base);
  });
  return out;
}
"""

BUTTONS_JS = r"""
() => {
  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0; };
  window.__nfb = window.__nfb || 0;
  const out = [];
  document.querySelectorAll('button, input[type=submit], input[type=button], a.btn, a[role=button], [role=button]').forEach(el => {
    if (!vis(el) || el.disabled) return;
    const text = clean(el.tagName === 'INPUT' ? el.value : (el.innerText || el.getAttribute('aria-label') || ''));
    if (!text) return;
    if (!el.hasAttribute('data-nfb')) el.setAttribute('data-nfb', ++window.__nfb);
    out.push({ id: +el.getAttribute('data-nfb'), text, type: (el.getAttribute('type') || '').toLowerCase() });
  });
  return out;
}
"""

INVALID_JS = r"""
() => {
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0; };
  const out = [];
  document.querySelectorAll('input,select,textarea').forEach(el => {
    if (el.type === 'hidden' || el.disabled || !el.willValidate || el.checkValidity()) return;
    const lab = (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
    const t = ((lab && lab.innerText) || el.getAttribute('aria-label') || el.placeholder || el.name || 'a field').replace(/\s+/g, ' ').trim();
    out.push(t.slice(0, 60));
  });
  return out;
}
"""

CHALLENGE_JS = r"""
() => {
  const out = [];
  document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[title*="captcha" i], .g-recaptcha, .h-captcha, .cf-turnstile').forEach(el => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || r.width < 100 || r.height < 40) return;
    if ((el.getAttribute('data-size') || '') === 'invisible') return;
    if (el.closest('.grecaptcha-badge')) return;
    out.push((el.className || el.tagName) + '');
  });
  return out;
}
"""

WALL_RE = re.compile(r"just a moment|checking your browser|verify(ing)? you are (a )?human|attention required|are you a robot|i'?m not a robot|"
                     r"unusual traffic|press (&|and) hold|access denied|request blocked|pardon our interruption|security check required|"
                     r"enable javascript and cookies to continue", re.I)
CLOSED_RE = re.compile(r"claim (filing )?(period|deadline) (has |is )?(ended|passed|expired|closed)|no longer (accepting|taking) claims|"
                       r"deadline (to|for) (submit|submitting|file|filing) (a )?claims? (has|have) passed|claims? (period|window) (is )?closed", re.I)
SUCCESS_RE = re.compile(r"thank you for (submitting|filing)|thanks for (submitting|filing)|your claim (has been |was |is )?(successfully )?(submitted|received|filed|accepted)|"
                        r"claim (has been |was )?(successfully )?(submitted|received|filed)|successfully (submitted|filed)|we have received your claim|"
                        r"submission (is )?(complete|successful|received)|confirmation (number|code|#)", re.I)
CONF_RES = [re.compile(p, re.I) for p in (
    r"(?:confirmation|claim|reference|submission|tracking|receipt)\s*(?:id|number|no\.?|code|#)\s*(?:is|:|-)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,24})",
    r"(?:your|the)\s+(?:confirmation|claim)\s+(?:id|number|code)\s+(?:is|was)\s+([A-Z0-9][A-Z0-9-]{4,24})")]
LINK_RE = re.compile(r"(file|submit|make|start|begin)\s+(a\s+|your\s+|my\s+)?(online\s+)?claim|claim\s+form|submit\s+claim|file\s+claim|claim\s+online|"
                     r"click here to (file|submit)", re.I)
LINK_BAD = re.compile(r"paper|pdf|download|print|mail(ed)?-in|by mail|opt.?out|exclude", re.I)


class Handoff(Exception):
    """Stop and give the form to Jared. Message = one plain sentence."""


class Blocked(object):
    def __init__(self, f, why):
        self.f, self.why = f, why


def settle(page, ms=1200):
    try:
        page.wait_for_load_state("domcontentloaded", timeout=15000)
    except Exception:
        pass
    try:
        page.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass
    page.wait_for_timeout(ms)


def body_text(page):
    try:
        return page.evaluate("() => document.body ? document.body.innerText : ''") or ""
    except Exception:
        return ""


def check_wall(page, what="the claim site"):
    """CAPTCHA / bot wall / closed -> hand off. We never solve or bypass any of it."""
    text = body_text(page)
    title = ""
    try:
        title = page.title() or ""
    except Exception:
        pass
    if WALL_RE.search(title + "\n" + text[:6000]):
        raise Handoff("%s put up a bot check or CAPTCHA, which I do not bypass." % (what[0].upper() + what[1:]))
    for fr in page.frames:
        try:
            if fr.evaluate(CHALLENGE_JS):
                raise Handoff("The form has a CAPTCHA, which I do not solve.")
        except Handoff:
            raise
        except Exception:
            pass
    if CLOSED_RE.search(text[:6000]):
        raise Handoff("That site says the claim period is over.")


def best_frame_fields(page):
    best, best_fields, score = page.main_frame, [], -1
    for fr in page.frames:
        try:
            fields = fr.evaluate(EXTRACT_JS)
        except Exception:
            continue
        n = len([f for f in fields if not f.get("search")])
        if n > score:
            best, best_fields, score = fr, fields, n
    return best, [f for f in best_fields if not f.get("search")]


# ------------------------------------------------------------------------------------------------ field mapping
SENSITIVE_RE = re.compile(r"\bssn\b|social\s*security|tax\s*id|\bitin\b|\bein\b|driver'?s?\s*licen|passport|routing|account\s*(number|no\b|#)|"
                          r"\biban\b|\bswift\b|card\s*(number|no\b|#)|credit\s*card|debit\s*card|\bcvv\b|\bcvc\b|expir(y|ation)\s*date|bank\s*(name|account)|"
                          r"government\s*id|national\s*id|date of birth|\bdob\b|birth\s*date|birthday", re.I)
IDCODE_RE = re.compile(r"(class\s*member|member|notice|claim(ant)?|settlement|unique|control|confirmation|access|verification|security|registration|"
                       r"participant|batch|reference|case|account)\s*(id|identifier|number|no\.?|code|#)|\bpin\b|unique\s*(id|identifier)|"
                       r"\bbarcode\b|postcard|passcode|\bunique code\b", re.I)
EXCLUDE_NAME_RE = re.compile(r"user\s*name|login|file\s*name|company|business|organi[sz]ation|\borg\b|employer|product|retailer|store|brand|model|\bpet\b|child|"
                             r"spouse|maiden|attorney|lawyer|referr|sponsor|school|doctor|physician|insurer|insurance|payee|cardholder|account|"
                             r"nick\s*name|dealer|vehicle|device|serial", re.I)
ATTEST_RE = re.compile(r"certif|attest|penalty of perjury|\bswear\b|\bdeclare\b|true and (correct|accurate)|best of my knowledge|"
                       r"information (provided )?(is|are) (true|correct|accurate)", re.I)
TERMS_RE = re.compile(r"(agree|accept|acknowledge|read|understand|consent).{0,60}(terms|conditions|privacy|release|policy|notice|settlement agreement)|"
                      r"terms (and|&) conditions", re.I)
MARKETING_RE = re.compile(r"newsletter|marketing|promotion|subscribe|special offers|sms|text message|receive (updates|emails|offers)|keep me (posted|updated)|"
                          r"opt.?in", re.I)


def norm(*parts):
    s = " ".join(p for p in parts if p)
    s = re.sub(r"[_\-\[\]\.]+", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def text_of(f):
    return norm(f.get("label"), f.get("placeholder"), f.get("autocomplete"), f.get("name"), f.get("id"))


def pick_option(options, wants):
    """options: [{value,label}] ; wants: ordered strings. Equality first, then 'starts with', then 'contains'."""
    wl = [w.lower() for w in wants if w]
    for mode in ("eq", "start", "in"):
        for w in wl:
            for o in options:
                lab, val = (o.get("label") or "").strip().lower(), (o.get("value") or "").strip().lower()
                if (mode == "eq" and w in (lab, val)) or (mode == "start" and lab.startswith(w + " ")) or (mode == "in" and len(w) > 3 and w in lab):
                    return o
    return None


def option_kind(txt):
    t = (txt or "").lower()
    if "paypal" in t:
        return "paypal"
    if "venmo" in t:
        return "venmo"
    if re.search(r"e-?check|electronic|\bach\b|direct deposit|zelle|bank|wire|prepaid|virtual|digital|gift card|cash\s*app|apple pay|crypto|debit", t):
        return "other"
    if re.search(r"\bcheck\b|cheque|paper|by mail|mailed", t):
        return "check"
    return None


def payout_group(f):
    if f["kind"] not in ("radio", "select"):
        return None
    kinds = [option_kind(o.get("label") or o.get("value")) for o in f.get("options", [])]
    if len(f.get("options", [])) >= 2 and any(kinds):
        return kinds
    return None


def map_field(f, V, intended, st):
    """Deterministic first pass. Returns (op, payload, source) with op in text|select|radio|check|skip|block|unknown."""
    kind, s = f["kind"], text_of(f)
    opt = "optional" in (f.get("label", "") + " " + f.get("ctx", "")).lower() and not re.search(r"\*", f.get("label", ""))
    req = f.get("required")

    if kind == "password":
        return ("block", "This site wants you to log in or create an account.", None)
    if kind == "file":
        return ("skip", None, None) if opt else ("block", "The form needs a document uploaded.", None)
    if SENSITIVE_RE.search(s + " " + norm(f.get("ctx", ""))[:80] if kind != "radio" else s):
        return ("block", "The form asks for bank, card or ID details, which I never enter.", None)

    pg = payout_group(f)
    if pg:
        order = [intended] + (["check"] if intended != "check" else [])
        for want in order:
            for o, k in zip(f["options"], pg):
                if k == want and not o.get("disabled"):
                    st["payout"] = want
                    return (kind, o, "payout." + want)
        names = [o.get("label") for o in f["options"] if (o.get("label") or "").strip()][:4]
        return ("block", "This form only pays by %s, not PayPal, Venmo or a paper check." % ", ".join(names), None)

    if kind == "checkbox":
        both = norm(f.get("label"), f.get("ctx"))
        if MARKETING_RE.search(both):
            return ("skip", None, None)
        if ATTEST_RE.search(both):
            return ("check", None, "attest")
        if TERMS_RE.search(both):
            return ("check", None, "terms")
        return ("unknown", None, None) if req else ("skip", None, None)
    if kind == "radio":
        return ("unknown", None, None) if req else ("skip", None, None)

    if IDCODE_RE.search(s) and not re.search(r"\b(e-?mail|zip|postal|area|country|phone|street|address|city)\b", s):
        return ("skip", None, None) if opt else ("block", "The form needs the Claim ID or code from your notice.", None)

    ac = (f.get("autocomplete") or "").lower()
    mapping = None  # (value key, kind of match)
    if ac in ("given-name",):
        mapping = "first"
    elif ac in ("family-name",):
        mapping = "last"
    elif ac == "name":
        mapping = "full_name"
    elif ac == "email":
        mapping = "email"
    elif ac in ("tel", "tel-national"):
        mapping = "phone"
    elif ac in ("address-line1", "street-address"):
        mapping = "street"
    elif ac == "address-line2":
        mapping = "unit"
    elif ac == "address-level2":
        mapping = "city"
    elif ac == "address-level1":
        mapping = "state"
    elif ac == "postal-code":
        mapping = "zip"
    elif ac.startswith("country"):
        mapping = "country"
    if not mapping:
        if re.search(r"paypal", s):
            mapping = "paypal_email" if st.get("intended") == "paypal" else "__skip"
        elif re.search(r"venmo", s):
            mapping = "venmo_handle" if st.get("intended") == "venmo" else "__skip"
        elif re.search(r"e-?mail", s):
            mapping = "email"
        elif f["type"] == "tel" or re.search(r"phone|mobile|telephone|\btel\b|\bcell\b", s):
            mapping = "phone"
        elif re.search(r"first\s*name|given\s*name|fname|forename", s):
            mapping = "first"
        elif re.search(r"last\s*name|sur\s*name|family\s*name|lname", s):
            mapping = "last"
        elif re.search(r"middle|\bsuffix\b|\bprefix\b|\btitle\b|salutation", s):
            mapping = "__skip"
        elif re.search(r"address\s*(line)?\s*(2|two)\b|address2|addr2|\bapt\b|apartment|\bsuite\b|\bunit\b", s):
            mapping = "unit"
        elif re.search(r"zip|postal|post\s*code", s):
            mapping = "zip"
        elif re.search(r"\bcity\b|\btown\b", s):
            mapping = "city"
        elif re.search(r"\bstate\b|province|\bregion\b", s) and not re.search(r"purchas|incorporat|country|united", s):
            mapping = "state"
        elif re.search(r"country", s):
            mapping = "country"
        elif re.search(r"street|address\s*(line)?\s*1?\b|address1|addr1|mailing address", s):
            mapping = "street"
        elif re.search(r"name\b", s) and not EXCLUDE_NAME_RE.search(s):
            mapping = "full_name"
    if mapping == "__skip":
        return ("skip", None, None)
    if mapping:
        if mapping == "unit" and not V["unit"]:
            return ("skip", None, None)
        if kind == "select":
            wants = {"state": [V["state"], V["state_name"]], "country": ["United States", "United States of America", "USA", "US"]}.get(mapping)
            o = pick_option(f.get("options", []), wants or [V.get(mapping)])
            return ("select", o, "profile." + mapping) if o else ("unknown", None, None)
        val = V.get(mapping, "")
        if mapping == "phone" and f.get("maxlength") and f["maxlength"] <= 10:
            val = V["phone_digits"]
        if mapping in ("paypal_email", "venmo_handle") and not val:
            return ("skip", None, None)
        return ("text", val, "profile." + mapping) if val else ("unknown", None, None)
    if kind == "select" and not req:
        return ("skip", None, None)
    return ("unknown", None, None) if req else ("skip", None, None)


LLM_SYSTEM = (
    "You help fill ONE class action settlement claim form for one person. You never invent facts and never write free text. "
    "For each unknown field choose exactly one answer:\n"
    "- {\"id\":N,\"source\":\"profile.<key>\"} where key is one of full_name, first, last, email, phone, street, unit, city, state, zip, country "
    "(only when the field clearly asks for exactly that).\n"
    "- {\"id\":N,\"source\":\"class_member_yes\"} ONLY for a yes/no question or single checkbox that asks whether the person is/was a member of the "
    "settlement class or bought/owned/used the product or service described in the class definition (pick the affirmative answer).\n"
    "- {\"id\":N,\"source\":\"attest\"} ONLY for a checkbox where the person confirms the claim is true/correct under penalty of perjury.\n"
    "- {\"id\":N,\"source\":\"terms\"} ONLY for a required checkbox agreeing to the terms/privacy/release.\n"
    "- {\"id\":N,\"source\":\"none\",\"why\":\"<one plain sentence>\"} for anything else: purchase dates, amounts, quantities, model or product details, "
    "proof, IDs, codes, documents, anything not in the person's saved details. Never guess.\n"
    "Reply with one JSON object: {\"answers\":[...]} and nothing else.")


def llm_answers(unknown, settlement):
    payload = {"settlement": {"name": settlement.get("name"), "defendant": settlement.get("defendant"),
                              "class_definition": (settlement.get("class_definition") or "")[:900]},
               "fields": [{"id": u["nf"] if u["kind"] != "radio" else u["options"][0]["nf"], "kind": u["kind"], "label": u.get("label"),
                           "context": (u.get("ctx") or "")[:220], "options": [o.get("label") for o in u.get("options", [])][:12]} for u in unknown]}
    j = llm_json(LLM_SYSTEM, json.dumps(payload))
    return {int(a["id"]): a for a in j.get("answers", []) if isinstance(a, dict) and "id" in a}


MEMBER_OK_RE = re.compile(r"purchas|bought|\bbuy|\bown|\buse[d]?\b|member|class|resident|customer|subscriber|account holder|received|enrolled|affected|"
                          r"lived|stayed|visited|shopped|ordered|paid", re.I)
MEMBER_BAD_RE = re.compile(r"employee|employ(ed|er)|attorney|lawyer|counsel|relative|family member|judge|opt.?out|exclude|exclusion|bankrupt|"
                           r"represented by|filed (a )?(lawsuit|claim)|other (claim|settlement)|previously", re.I)


def member_question_ok(f):
    t = norm(f.get("label"), f.get("ctx"))
    return bool(MEMBER_OK_RE.search(t)) and not MEMBER_BAD_RE.search(t)


def yes_option(options):
    for o in options:
        if re.fullmatch(r"\s*(yes|y|true|i am|i was|i do|i did|agree)\s*\.?", (o.get("label") or o.get("value") or ""), re.I):
            return o
    for o in options:
        if re.match(r"\s*yes\b", (o.get("label") or o.get("value") or ""), re.I):
            return o
    return None


def plan_page(fields, V, intended, st, settlement, done):
    """-> (actions, blocked, skipped). actions: dicts with f, op, payload, src."""
    actions, blocked, skipped, unknown = [], [], [], []
    for f in fields:
        key = f["options"][0]["nf"] if f["kind"] == "radio" else f["nf"]
        if key in done:
            continue
        # already answered by the site / us
        if f["kind"] in ("radio",) and f.get("value"):
            continue
        if f["kind"] == "checkbox" and f.get("checked"):
            continue
        op, payload, src = map_field(f, V, intended, st)
        if op == "block":
            blocked.append(Blocked(f, payload))
        elif op == "skip":
            skipped.append(f)
        elif op == "unknown":
            unknown.append(f)
        else:
            actions.append({"f": f, "key": key, "op": op, "payload": payload, "src": src})
    if unknown:
        answers = {}
        try:
            answers = llm_answers(unknown, settlement)
        except Exception as e:
            log("free AI could not map fields:", str(e)[:200])
        for f in unknown:
            key = f["options"][0]["nf"] if f["kind"] == "radio" else f["nf"]
            a = answers.get(key) or {}
            src = a.get("source") or "none"
            lab = (f.get("label") or f.get("ctx") or f.get("name") or "a question")[:70]
            why = "The form asks \"%s\", which isn't in your saved details." % lab
            if src.startswith("profile.") and src[8:] in V and V[src[8:]]:
                k = src[8:]
                if f["kind"] == "select":
                    o = pick_option(f.get("options", []), [V["state"], V["state_name"]] if k == "state" else [V[k]])
                    (actions.append({"f": f, "key": key, "op": "select", "payload": o, "src": src}) if o else blocked.append(Blocked(f, why)))
                elif f["kind"] in ("text", "textarea"):
                    actions.append({"f": f, "key": key, "op": "text", "payload": V[k], "src": src})
                else:
                    blocked.append(Blocked(f, why))
            elif src == "class_member_yes" and f["kind"] in ("radio", "checkbox", "select") and member_question_ok(f):
                if f["kind"] == "radio":
                    o = yes_option(f["options"])
                    (actions.append({"f": f, "key": key, "op": "radio", "payload": o, "src": src}) if o else blocked.append(Blocked(f, why)))
                elif f["kind"] == "checkbox":
                    actions.append({"f": f, "key": key, "op": "check", "payload": None, "src": src})
                else:
                    o = yes_option(f["options"])
                    (actions.append({"f": f, "key": key, "op": "select", "payload": o, "src": src}) if o else blocked.append(Blocked(f, why)))
            elif src == "attest" and f["kind"] == "checkbox" and ATTEST_RE.search(norm(f.get("label"), f.get("ctx"))):
                actions.append({"f": f, "key": key, "op": "check", "payload": None, "src": "attest"})
            elif src == "terms" and f["kind"] == "checkbox" and TERMS_RE.search(norm(f.get("label"), f.get("ctx"))):
                actions.append({"f": f, "key": key, "op": "check", "payload": None, "src": "terms"})
            else:
                blocked.append(Blocked(f, (a.get("why") if src == "none" and a.get("why") and len(a["why"]) < 160 else why)))
    return actions, blocked, skipped


# ------------------------------------------------------------------------------------------------ browser actions
def apply_action(fr, a):
    f, op, payload = a["f"], a["op"], a["payload"]
    if op == "text":
        loc = fr.locator('[data-nf="%d"]' % f["nf"]).first
        loc.fill(payload, timeout=8000)
        try:
            loc.blur()
        except Exception:
            pass
    elif op == "select":
        loc = fr.locator('[data-nf="%d"]' % f["nf"]).first
        if payload.get("value"):
            loc.select_option(value=payload["value"], timeout=8000)
        else:
            loc.select_option(label=payload["label"], timeout=8000)
    elif op in ("radio", "check"):
        nf = payload["nf"] if op == "radio" else f["nf"]
        loc = fr.locator('[data-nf="%d"]' % nf).first
        try:
            loc.check(timeout=3000)
        except Exception:
            try:
                loc.check(force=True, timeout=3000)
            except Exception:
                loc.evaluate("e => { const l = (e.id && document.querySelector('label[for=\"' + e.id + '\"]')) || e.closest('label'); (l || e).click(); }")
        if not loc.is_checked():
            raise RuntimeError("could not tick %s" % (f.get("label") or "a box")[:40])


def find_button(fr):
    """-> (kind 'final'|'next'|None, button dict)."""
    try:
        btns = fr.evaluate(BUTTONS_JS)
    except Exception:
        return None, None
    bad = re.compile(r"back|previous|cancel|reset|clear|print|save for later|save draft|log ?out|sign ?in|log ?in|register|create account|search|menu|close|help|chat", re.I)
    final = [b for b in btns if re.search(r"submit|file (my |your |the )?claim|^finish|^complete|^send|certify|^confirm", b["text"], re.I) and not bad.search(b["text"])]
    nxt = [b for b in btns if re.search(r"^next|^continue|save (and|&) continue|proceed|^review|go to|^step|^start", b["text"], re.I) and not bad.search(b["text"])]
    if final:
        return "final", final[0]
    if nxt:
        return "next", nxt[0]
    typed = [b for b in btns if b["type"] == "submit" and not bad.search(b["text"])]
    return ("final", typed[0]) if typed else (None, None)


def follow_claim_link(page):
    cands = page.evaluate(r"""() => Array.from(document.querySelectorAll('a[href], button')).filter(e => { const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0; }).map(e => ({ t: (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        h: e.tagName === 'A' ? e.href : '', i: Array.from(document.querySelectorAll('a[href], button')).indexOf(e) }))""")
    for c in cands:
        if c["t"] and LINK_RE.search(c["t"]) and not LINK_BAD.search(c["t"] + " " + (c["h"] or "")) and not (c["h"] or "").startswith("mailto:"):
            log("following link:", c["t"][:60])
            try:
                if c["h"]:
                    page.goto(c["h"], wait_until="domcontentloaded", timeout=45000)
                else:
                    page.locator("a[href], button").nth(c["i"]).click(timeout=8000)
                settle(page)
                return True
            except Exception as e:
                log("link failed:", str(e)[:120])
    return False


def extract_confirmation(text):
    for rx in CONF_RES:
        for m in rx.finditer(text):
            c = m.group(1).strip("-")
            if re.search(r"\d", c) and not re.fullmatch(r"(?i)number|confirmation", c):
                return c.upper()
    return None


# ------------------------------------------------------------------------------------------------ one claim
def fill_page(fr, page, fields, V, intended, st, settlement, done, journal, dry):
    """Plans and fills until no new fields appear (max 4 passes). Returns list of Blocked."""
    all_blocked = []
    for _ in range(4):
        actions, blocked, skipped = plan_page(fields, V, intended, st, settlement, done)
        for b in blocked:
            if b.f["nf"] not in [x.f["nf"] for x in all_blocked]:
                all_blocked.append(b)
                done.add(b.f["options"][0]["nf"] if b.f["kind"] == "radio" else b.f["nf"])
        for f in skipped:
            done.add(f["options"][0]["nf"] if f["kind"] == "radio" else f["nf"])
        if not actions:
            break
        for a in actions:
            apply_action(fr, a)
            done.add(a["key"])
            journal.append({"field": (a["f"].get("label") or a["f"].get("placeholder") or a["f"].get("name") or a["f"]["kind"])[:60],
                            "source": a["src"], "op": a["op"]})
        page.wait_for_timeout(500)
        fields = fr.evaluate(EXTRACT_JS)
        fields = [f for f in fields if not f.get("search")]
    return all_blocked


def process_claim(browser, claim, profile, outdir, dry=False, submit_ok=False, deadline=None):
    """-> dict(result 'filed'|'needs_you'|'dry', confirmation, payout, why, url, journal)"""
    settlement = claim.get("settlement") or {}
    url = settlement.get("claim_url") or claim.get("url")
    name = settlement.get("name") or "this settlement"
    deadline = deadline or (time.time() + CLAIM_SECONDS)
    os.makedirs(outdir, exist_ok=True)
    if not url:
        raise Handoff("There is no claim link on file for this settlement.")
    V = build_values(profile)
    intended = intended_payout(profile)
    st = {"intended": intended, "payout": None}
    journal, shots = [], []
    ctx = browser.new_context(viewport={"width": 1280, "height": 1600}, locale="en-US", timezone_id="America/Los_Angeles")
    page = ctx.new_page()
    page.set_default_timeout(15000)
    page.on("dialog", lambda d: d.accept())

    def tick():
        if time.time() > deadline:
            raise Handoff("This claim took longer than 3 minutes, so I stopped.")

    def shot(label):
        p = os.path.join(outdir, "%02d-%s.png" % (len(shots) + 1, label))
        page.screenshot(path=p, full_page=True)
        shots.append(p)
        return p

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        settle(page)
        hops, final_clicks, last_url = 0, 0, None
        for step in range(9):
            tick()
            check_wall(page, "the claim site")
            fr, fields = best_frame_fields(page)
            if len(fields) < 3 and hops < 2 and not journal:
                hit = [f for f in fields if map_field(f, V, intended, dict(st))[0] == "block"]
                if not hit and follow_claim_link(page):
                    hops += 1
                    continue
            if not fields:
                kind, btn = find_button(fr)
                if not btn:
                    raise Handoff("I couldn't find the online claim form on that page.")
            done = set()
            blocked = fill_page(fr, page, fields, V, intended, st, settlement, done, journal, dry)
            if blocked and not dry:
                raise Handoff(blocked[0].why)
            kind, btn = find_button(fr)
            if not journal and not btn:
                raise Handoff("I couldn't find the online claim form on that page.")
            if not btn:
                raise Handoff("I couldn't find the Submit button on the form.")
            if not dry:
                bad = fr.evaluate(INVALID_JS)
                if bad:
                    raise Handoff("The form still needs: %s." % ", ".join(bad[:3]))
            tick()
            shot("before-submit" if kind == "final" else "page-%d" % (step + 1))
            if dry:
                return {"result": "dry", "journal": journal, "blocked": [(b.f.get("label") or b.f.get("name"), b.why) for b in blocked],
                        "button": btn["text"], "kind": kind, "payout": st["payout"], "shots": shots, "url": url}
            if kind == "final":
                if not submit_ok:
                    raise Handoff("Submitting is switched off for this run.")
                final_clicks += 1
            before = page.url
            fr.locator('[data-nfb="%d"]' % btn["id"]).first.click(timeout=8000)
            settle(page, 2000)
            for _ in range(10):
                if SUCCESS_RE.search(body_text(page)[:8000]):
                    break
                page.wait_for_timeout(1000)
            tick()
            text = body_text(page)
            if kind == "final" and SUCCESS_RE.search(text[:8000]):
                shot("confirmation")
                conf = extract_confirmation(text)
                return {"result": "filed", "confirmation": conf, "payout": st["payout"] or "check", "journal": journal, "shots": shots, "url": url}
            # a CAPTCHA that shows up after the click, or a rejected form
            check_wall(page, "the claim site")
            if kind == "final" and final_clicks >= 2:
                shot("unclear")
                raise Handoff("I clicked Submit twice but could not confirm it went through. Check your email for a receipt.")
            if kind == "final":
                err = page.evaluate(r"""() => Array.from(document.querySelectorAll('[role=alert], .error, .errors, .invalid-feedback, .has-error, [class*=error]'))
                    .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(t => t && t.length < 200).slice(0, 2).join(' | ')""")
                if err and page.url == before:
                    shot("rejected")
                    raise Handoff("The site did not accept the form: %s" % err[:160])
        shot("unclear")
        raise Handoff("I could not tell whether the claim went through. Check your email for a receipt.")
    except Exception:
        try:
            shot("stopped")
        except Exception:
            pass
        raise
    finally:
        try:
            ctx.close()
        except Exception:
            pass


# ------------------------------------------------------------------------------------------------ browser bootstrap
def launch(p):
    return p.chromium.launch(headless=True)


def ensure_browser(p, notes):
    """Launch Chromium; if it is missing, reinstall once."""
    try:
        return launch(p)
    except Exception as e:
        log("chromium launch failed, reinstalling once:", str(e)[:200])
        subprocess.run([PY, "-m", "playwright", "install", "chromium"], capture_output=True, text=True, timeout=600)
        notes.append("reinstalled Chromium")
        return launch(p)


def import_playwright(notes):
    try:
        from playwright.sync_api import sync_playwright
        return sync_playwright
    except Exception:
        log("playwright missing, reinstalling once")
        subprocess.run([PY, "-m", "pip", "install", "-q", "playwright"], capture_output=True, text=True, timeout=600)
        notes.append("reinstalled Playwright")
        from playwright.sync_api import sync_playwright
        return sync_playwright


# ------------------------------------------------------------------------------------------------ runs
class Hard(object):
    """Watchdog thread: if a claim hangs past the hard limit, mark it needs_you, flag the beat, kill Chromium and exit."""
    def __init__(self, claim_id, url, seconds):
        self.claim_id, self.url = claim_id, url
        self.t = threading.Timer(seconds, self.fire)
        self.t.daemon = True

    def start(self):
        self.t.start()
        return self

    def cancel(self):
        self.t.cancel()

    def fire(self):
        log("HARD TIMEOUT on claim", self.claim_id)
        try:
            report_needs_you(self.claim_id, "This site hung for over 3 minutes, so I stopped.", self.url)
        except Exception as e:
            log("could not report timeout:", e)
        beat(False, "a claim hung and was stopped")
        subprocess.run(["pkill", "-f", "chrome-headless-shell"], capture_output=True)
        os._exit(3)


def real_run():
    os.makedirs(BASE, exist_ok=True)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("another run is still going; skipping this one")
        return 0
    run_guard = threading.Timer(RUN_HARD_SECONDS, lambda: (beat(False, "run hung past 14 minutes"), os._exit(4)))
    run_guard.daemon = True
    run_guard.start()
    notes, filed, needs, current = [], 0, 0, [None]
    try:
        profile = rpc("settlement_profile_t", {}) or {}
        gate = profile_gate(profile)
        if gate:
            log(gate)
            beat(True, "waiting for claim details")
            return 0
        subprocess.run(["pkill", "-f", "chrome-headless-shell"], capture_output=True)   # leftovers of a killed run
        sync_playwright = import_playwright(notes)
        with sync_playwright() as p:
            browser = ensure_browser(p, notes)     # also proves Chromium works every run; reinstalls it once if missing
            for _ in range(MAX_CLAIMS_PER_RUN):
                got = rpc("settlement_take_approved_t", {"p_limit": 1}) or []
                if not got:
                    break
                claim = got[0]
                s = claim.get("settlement") or {}
                current[0] = claim["id"]
                url = s.get("claim_url")
                log("claim", claim["id"], s.get("name"), url)
                hard = Hard(claim["id"], url, CLAIM_HARD_SECONDS).start()
                outdir = os.path.join(RECEIPTS, claim["id"])
                try:
                    r = process_claim(browser, claim, profile, outdir, dry=False, submit_ok=True)
                    with open(os.path.join(outdir, "receipt.json"), "w") as fh:
                        json.dump({"claim": claim["id"], "settlement": s.get("name"), "url": url, "result": r["result"],
                                   "confirmation": r.get("confirmation"), "payout": r.get("payout"), "filled": r["journal"],
                                   "screens": [os.path.basename(x) for x in r["shots"]], "at": time.strftime("%Y-%m-%d %H:%M:%S")}, fh, indent=1)
                    rpc("settlement_filed_t", {"p_id": claim["id"], "p_ok": True, "p_confirmation": r.get("confirmation"),
                                               "p_payout_method": r.get("payout"), "p_needs_you_url": None, "p_why": None})
                    filed += 1
                    log("FILED", claim["id"], r.get("confirmation"), r.get("payout"))
                except Handoff as h:
                    needs += 1
                    log("needs you:", claim["id"], str(h))
                    report_needs_you(claim["id"], str(h), url)
                except Exception as e:
                    needs += 1
                    log("error on claim", claim["id"], traceback.format_exc()[-600:])
                    report_needs_you(claim["id"], "Something went wrong on my side filing this one. Open the link and file it by hand.", url)
                finally:
                    hard.cancel()
                    current[0] = None
            browser.close()
        summary = ("filed %d, needs you %d" % (filed, needs)) if (filed or needs) else "no approved claims"
        if notes:
            summary += " (" + ", ".join(notes) + ")"
        beat(True, summary)
        log("run done:", summary)
        return 0
    except Exception as e:
        log("RUN CRASHED:", traceback.format_exc()[-800:])
        if current[0]:
            try:
                report_needs_you(current[0], "Something went wrong on my side filing this one. Open the link and file it by hand.", None)
            except Exception:
                pass
        beat(False, "crashed: %s" % str(e)[:200])
        return 1
    finally:
        run_guard.cancel()
        lock.close()


DEMO_PROFILE = {"full_name": "Test Person", "email": "test.person@example.com", "phone": "+1 555-010-0199", "street": "100 Test Street",
                "unit": "Apt 4", "city": "Testville", "state": "CA", "zip": "90001", "payout_pref": "paypal",
                "paypal_email": "test.paypal@example.com", "venmo_handle": None, "confirmed_at": "demo"}


def dry_run(url, use_real_profile=False):
    """Fill + screenshot a page, NEVER submit, never touch Supabase."""
    notes = []
    profile = DEMO_PROFILE
    if use_real_profile:
        profile = rpc("settlement_profile_t", {})
    sync_playwright = import_playwright(notes)
    outdir = os.path.join(RECEIPTS, "dry-" + time.strftime("%Y%m%d-%H%M%S"))
    with sync_playwright() as p:
        browser = ensure_browser(p, notes)
        try:
            r = process_claim(browser, {"id": "dry", "settlement": {"name": "dry run", "claim_url": url, "class_definition": ""}}, profile,
                              outdir, dry=True)
        except Handoff as h:
            r = {"result": "handoff", "why": str(h), "journal": [], "shots": []}
        except Exception as e:
            r = {"result": "error", "why": str(e)[:300], "journal": [], "shots": []}
        finally:
            browser.close()
    print(json.dumps({"result": r["result"], "would_press": r.get("button"), "payout": r.get("payout"), "filled": r.get("journal"),
                      "would_hand_to_jared": r.get("blocked"), "why": r.get("why"), "screenshots": r.get("shots"), "notes": notes}, indent=1))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Claim Filer")
    ap.add_argument("--dry", metavar="URL", help="fill the form at URL with a demo profile and screenshot it; never submits, never writes to Supabase")
    ap.add_argument("--real-profile", action="store_true", help="with --dry: use Jared's saved profile instead of the demo one")
    ap.add_argument("--selftest", action="store_true", help="run the local fake-claim-site tests (127.0.0.1 only)")
    a = ap.parse_args()
    if a.selftest:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests"))
        import selftest
        sys.exit(selftest.main(sys.modules[__name__]))
    if a.dry:
        sys.exit(dry_run(a.dry, a.real_profile))
    sys.exit(real_run())
