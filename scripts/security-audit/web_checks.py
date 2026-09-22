#!/usr/bin/env python3
"""Nightly security audit: outside-in checks for websites, DNS/email and the public repo.

Read-only. Prints one JSON list of check results to stdout:
  {"key","result": pass|red|yellow|skip, "layer","asset","check","title","detail","fix","evidence"}
The nightly Claude task feeds each result into public.security_check(...).

Usage: web_checks.py --hosts bestly.tech studio.bestly.tech ... [--mail-domains bestly.tech] [--repo /path/to/clone]
Note: TLS in the Claude sandbox is intercepted by an egress proxy, so certificate
expiry comes from Certificate Transparency (crt.sh), not from the live handshake.
"""
import argparse, datetime as dt, hashlib, json, re, subprocess, sys, uuid
import urllib.parse
import requests

UA = {"User-Agent": "BestlySecurityAudit/1.0 (+https://bestly.tech; owner self-check)"}
T = 15
out = []

def add(key, result, layer, asset, check, title=None, detail=None, fix=None, evidence=None):
    out.append(dict(key=key, result=result, layer=layer, asset=asset, check=check,
                    title=title, detail=detail, fix=fix, evidence=evidence or {}))

def get(url, **kw):
    kw.setdefault("timeout", T); kw.setdefault("headers", UA)
    return requests.get(url, **kw)

def doh(name, rtype):
    r = get("https://cloudflare-dns.com/dns-query", params={"name": name, "type": rtype},
            headers={**UA, "accept": "application/dns-json"})
    r.raise_for_status()
    return [a["data"].strip('"').replace('" "', "") for a in r.json().get("Answer", []) if a.get("type") in (16, 5, 1, 28, 257)]

SENSITIVE = {
    "/.env": lambda b: re.search(r"^[A-Z_]{3,}=", b, re.M) and "<html" not in b.lower(),
    "/.env.local": lambda b: re.search(r"^[A-Z_]{3,}=", b, re.M) and "<html" not in b.lower(),
    "/.git/HEAD": lambda b: b.startswith("ref:"),
    "/.git/config": lambda b: "[core]" in b,
    "/.DS_Store": lambda b: b.startswith("\x00\x00\x00\x01Bud1"),
    "/backup.zip": lambda b: b.startswith("PK"),
    "/.vercel/project.json": lambda b: '"projectId"' in b,
}

def check_host(host):
    asset = host
    # 1. reachability + https
    try:
        r = get(f"https://{host}/", allow_redirects=True)
    except Exception as e:
        add(f"web:{host}:reachable", "red", "Websites", asset, "reachable", f"{host} is not reachable over HTTPS", str(e)[:300]); return
    final = r.url
    if r.status_code >= 500:
        add(f"web:{host}:reachable", "red", "Websites", asset, "reachable", f"{host} returns HTTP {r.status_code}", final)
    else:
        add(f"web:{host}:reachable", "pass", "Websites", asset, "reachable")
    body = r.text or ""
    h = {k.lower(): v for k, v in r.headers.items()}

    try:
        rh = get(f"http://{host}/", allow_redirects=False)
        if rh.status_code in (301, 302, 307, 308) and rh.headers.get("location", "").startswith("https://"):
            add(f"web:{host}:https_redirect", "pass", "Websites", asset, "https_redirect")
        else:
            add(f"web:{host}:https_redirect", "red", "Websites", asset, "https_redirect",
                f"{host} serves plain HTTP", f"http:// returned {rh.status_code} without redirecting to https",
                "Turn on 'Always use HTTPS' (Cloudflare) or the Vercel HTTPS redirect.")
    except Exception as e:
        add(f"web:{host}:https_redirect", "skip", "Websites", asset, "https_redirect", detail=str(e)[:200])

    if "strict-transport-security" in h:
        add(f"web:{host}:hsts", "pass", "Websites", asset, "hsts")
    else:
        add(f"web:{host}:hsts", "yellow", "Websites", asset, "hsts", f"{host}: no HSTS header",
            "Browsers aren't told to always use HTTPS for this site.",
            "Add header `Strict-Transport-Security: max-age=63072000; includeSubDomains` in vercel.json headers.")

    missing = []
    csp = h.get("content-security-policy", "")
    if not csp: missing.append("Content-Security-Policy")
    if "x-frame-options" not in h and "frame-ancestors" not in csp: missing.append("X-Frame-Options (or CSP frame-ancestors)")
    if h.get("x-content-type-options", "").lower() != "nosniff": missing.append("X-Content-Type-Options: nosniff")
    if "referrer-policy" not in h: missing.append("Referrer-Policy")
    if missing:
        add(f"web:{host}:headers", "yellow", "Websites", asset, "security_headers",
            f"{host}: {len(missing)} security {'header' if len(missing)==1 else 'headers'} missing",
            "Missing: " + ", ".join(missing),
            'Add a "headers" block to vercel.json: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, plus a Content-Security-Policy.',
            {"missing": missing})
    else:
        add(f"web:{host}:headers", "pass", "Websites", asset, "security_headers")

    # 2. exposed files (SPA fallbacks return index.html 200 for everything, so match content)
    try:
        base = urllib.parse.urlsplit(final)._replace(path="", query="", fragment="").geturl()
        hits = []
        for path, looks_real in SENSITIVE.items():
            try:
                x = get(base + path, allow_redirects=False)
                if x.status_code == 200 and looks_real(x.content[:4096].decode("latin-1")):
                    hits.append(path)
            except Exception:
                pass
        if hits:
            add(f"web:{host}:exposed_files", "red", "Websites", asset, "exposed_files",
                f"{host} serves private files: {', '.join(hits)}", "These paths return real file contents to anyone.",
                "Remove them from the deploy output and rotate anything they contain.", {"paths": hits})
        else:
            add(f"web:{host}:exposed_files", "pass", "Websites", asset, "exposed_files")
        # source maps
        scripts = re.findall(r'<script[^>]+src="([^"]+\.js)"', body)[:5]
        maps = []
        for s in scripts:
            u = urllib.parse.urljoin(final, s) + ".map"
            try:
                m = get(u)
                if m.status_code == 200 and '"mappings"' in m.text[:5000]: maps.append(u)
            except Exception:
                pass
        if maps:
            add(f"web:{host}:sourcemaps", "yellow", "Websites", asset, "sourcemaps",
                f"{host} publishes source maps", "Anyone can read the original source, including admin code paths.",
                "Set `build.sourcemap: false` in vite.config (or delete *.map in the build output).", {"maps": maps})
        else:
            add(f"web:{host}:sourcemaps", "pass", "Websites", asset, "sourcemaps")
    except Exception as e:
        add(f"web:{host}:exposed_files", "skip", "Websites", asset, "exposed_files", detail=str(e)[:200])

    # 3. content fingerprint for defacement comparison (compared by the nightly task, not here)
    text = re.sub(r"\s+", " ", re.sub(r"<script.*?</script>|<[^>]+>", " ", body, flags=re.S)).strip()
    out.append(dict(key=f"fingerprint:{host}", result="info", layer="Websites", asset=asset, check="fingerprint",
                    evidence={"final_url": final, "status": r.status_code, "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
                              "title": (re.search(r"<title>(.*?)</title>", body, re.S) or [None, ""])[1][:120]}))

def check_cert(domain):
    try:
        import time
        for attempt in range(4):
            r = get("https://crt.sh/", params={"q": domain, "output": "json", "exclude": "expired"}, timeout=40)
            if r.status_code < 500: break
            time.sleep(5 * (attempt + 1))
        r.raise_for_status()
        certs = [c for c in r.json() if domain in (c.get("name_value") or "").split("\n")]
        if not certs:
            add(f"tls:{domain}:expiry", "skip", "Websites", domain, "tls_expiry", detail="no unexpired certificate found in CT logs"); return
        latest = max(dt.datetime.fromisoformat(c["not_after"]) for c in certs)
        days = (latest - dt.datetime.utcnow()).days
        if days < 7:
            add(f"tls:{domain}:expiry", "red", "Websites", domain, "tls_expiry", f"{domain}: certificate expires in {days} days", fix="Check the Vercel/Cloudflare certificate auto-renewal.", evidence={"not_after": latest.isoformat()})
        elif days < 14:
            add(f"tls:{domain}:expiry", "yellow", "Websites", domain, "tls_expiry", f"{domain}: certificate expires in {days} days", evidence={"not_after": latest.isoformat()})
        else:
            add(f"tls:{domain}:expiry", "pass", "Websites", domain, "tls_expiry", evidence={"not_after": latest.isoformat(), "days": days})
    except Exception as e:
        add(f"tls:{domain}:expiry", "skip", "Websites", domain, "tls_expiry", detail=f"crt.sh: {str(e)[:150]}")

def check_mail(domain, sends_mail):
    try:
        txt = doh(domain, "TXT")
        spf = [t for t in txt if t.lower().startswith("v=spf1")]
        dm = [t for t in doh(f"_dmarc.{domain}", "TXT") if t.lower().startswith("v=dmarc1")]
    except Exception as e:
        add(f"dns:{domain}:email_auth", "skip", "DNS / email", domain, "email_auth", detail=str(e)[:200]); return
    problems, sev = [], "yellow"
    if not spf:
        problems.append("no SPF record"); sev = "red" if sends_mail else sev
    if not dm:
        problems.append("no DMARC record"); sev = "red" if sends_mail else sev
    elif re.search(r"\bp=none\b", dm[0], re.I):
        problems.append("DMARC is p=none (monitor only)")
    if problems:
        fix = ("Add TXT `_dmarc." + domain + "` = `v=DMARC1; p=quarantine; rua=mailto:jared@bestly.tech`" if sends_mail
               else "This domain doesn't send mail: publish `v=spf1 -all` and `_dmarc` = `v=DMARC1; p=reject` so nobody can spoof it.")
        add(f"dns:{domain}:email_auth", sev, "DNS / email", domain, "email_auth",
            f"{domain}: {', '.join(problems)}", "Someone could send email that appears to come from this domain.", fix,
            {"spf": spf, "dmarc": dm})
    else:
        add(f"dns:{domain}:email_auth", "pass", "DNS / email", domain, "email_auth", evidence={"spf": spf, "dmarc": dm})

def check_expiry(domain):
    try:
        r = get(f"https://rdap.org/domain/{domain}", timeout=25)
        if r.status_code == 404:
            # Some registries (e.g. .io) publish no RDAP. Not a blind spot worth a nightly yellow.
            out.append(dict(key=f"dns:{domain}:expiry", result="info", layer="DNS / email", asset=domain, check="domain_expiry",
                            evidence={"note": "registry has no RDAP; check expiry at the registrar"})); return
        if r.status_code != 200:
            add(f"dns:{domain}:expiry", "skip", "DNS / email", domain, "domain_expiry", detail=f"RDAP HTTP {r.status_code}"); return
        j = r.json()
        exp = next((e["eventDate"] for e in j.get("events", []) if e.get("eventAction") == "expiration"), None)
        status = j.get("status", [])
        if not exp:
            add(f"dns:{domain}:expiry", "skip", "DNS / email", domain, "domain_expiry", detail="no expiration in RDAP"); return
        days = (dt.datetime.fromisoformat(exp.replace("Z", "+00:00")) - dt.datetime.now(dt.timezone.utc)).days
        locked = any("transfer prohibited" in s for s in status)
        if days < 30:
            add(f"dns:{domain}:expiry", "red", "DNS / email", domain, "domain_expiry", f"{domain} expires in {days} days", fix="Renew the domain and turn on auto-renew at the registrar.", evidence={"expires": exp})
        elif days < 60 or not locked:
            add(f"dns:{domain}:expiry", "yellow", "DNS / email", domain, "domain_expiry",
                f"{domain}: " + (f"expires in {days} days" if days < 60 else "registrar transfer lock is off"),
                fix="Turn on registrar lock and auto-renew.", evidence={"expires": exp, "status": status})
        else:
            add(f"dns:{domain}:expiry", "pass", "DNS / email", domain, "domain_expiry", evidence={"expires": exp, "days": days})
    except Exception as e:
        add(f"dns:{domain}:expiry", "skip", "DNS / email", domain, "domain_expiry", detail=str(e)[:200])

SECRET_PATTERNS = [
    ("Supabase service_role key", r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}", "service_role"),
    ("Stripe live secret key", r"sk_live_[0-9A-Za-z]{16,}", None),
    ("GitHub token", r"(ghp_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})", None),
    ("AWS access key", r"AKIA[0-9A-Z]{16}", None),
    ("Private key", r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----\s*\n[A-Za-z0-9+/=]{40,}", None),
    ("Slack token", r"xox[baprs]-[0-9A-Za-z-]{20,}", None),
    ("Resend API key", r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}", None),
    ("Hardcoded function key", r"(?:const|let)\s+(?:OWN_KEY|PROXY_KEY|WORKER_KEY|BUILD_KEY|SECRET|API_KEY)\s*=\s*\"[A-Za-z0-9_\-]{24,}\"", None),
]

def jwt_role(tok):
    import base64
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get("role")
    except Exception:
        return None

def check_repo(path, name):
    asset = f"github:{name}"
    try:
        files = subprocess.run(["git", "-C", path, "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
    except Exception as e:
        add(f"code:{name}:secrets", "skip", "Code", asset, "secret_scan", detail=str(e)[:200]); return
    found = {}
    for f in files:
        if not f or f.startswith(("node_modules/", "dist/")) or re.search(r"\.(png|jpe?g|webp|gif|ico|pdf|mp4|woff2?|lockb|zip)$", f): continue
        try:
            txt = open(f"{path}/{f}", encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        for label, pat, want_role in SECRET_PATTERNS:
            for m in re.finditer(pat, txt):
                if want_role and jwt_role(m.group(0)) != want_role: continue
                found.setdefault(label, set()).add(f)
    for label, pat, _ in SECRET_PATTERNS:
        k = f"code:{name}:secret:{re.sub(r'[^a-z]+','_',label.lower()).strip('_')}"
        if label in found:
            sev = "red" if label != "Hardcoded function key" else "yellow"
            add(k, sev, "Code", asset, "secret_scan", f"{label} committed to the public repo",
                "Found in: " + ", ".join(sorted(found[label])[:10]) + ". The repo is public, so treat it as leaked.",
                "Rotate the credential first, then remove the file from the repo (history keeps old copies, so rotation is what actually fixes it).",
                {"files": sorted(found[label])[:20]})
        else:
            add(k, "pass", "Code", asset, "secret_scan")
    # dependency audit
    try:
        a = subprocess.run(["npm", "audit", "--json", "--package-lock-only", "--omit=dev"], cwd=path, capture_output=True, text=True, timeout=180)
        v = json.loads(a.stdout or "{}").get("metadata", {}).get("vulnerabilities", {})
        crit, high = v.get("critical", 0), v.get("high", 0)
        if crit:
            add(f"code:{name}:npm_audit", "red", "Code", asset, "npm_audit", f"{crit} critical dependency {'vulnerability' if crit==1 else 'vulnerabilities'} in {name}", f"high: {high}", "Run `npm audit fix` and redeploy.", v)
        elif high:
            add(f"code:{name}:npm_audit", "yellow", "Code", asset, "npm_audit", f"{high} high-severity dependency {'vulnerability' if high==1 else 'vulnerabilities'} in {name}", None, "Run `npm audit fix` and redeploy.", v)
        else:
            add(f"code:{name}:npm_audit", "pass", "Code", asset, "npm_audit", evidence=v)
    except Exception as e:
        add(f"code:{name}:npm_audit", "skip", "Code", asset, "npm_audit", detail=str(e)[:200])

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--hosts", nargs="*", default=[])
    ap.add_argument("--apex", nargs="*", default=[], help="registrable domains for DNS / expiry / cert checks")
    ap.add_argument("--mail-domains", nargs="*", default=["bestly.tech"])
    ap.add_argument("--repo", nargs="*", default=[], help="path=name pairs of cloned repos")
    a = ap.parse_args()
    for h in a.hosts: check_host(h)
    for d in a.apex:
        check_cert(d); check_mail(d, d in a.mail_domains); check_expiry(d)
    for r in a.repo:
        p, n = r.split("=", 1); check_repo(p, n)
    json.dump(out, sys.stdout, indent=1)
