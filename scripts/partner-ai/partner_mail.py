#!/usr/bin/env python3
"""Partner mail sync (Mac mini, launchd tech.bestly.partner-mail, every 10 minutes).

Finds the emails Jared SENT to each partner (To or Cc) in his Sent folders and copies them to the
partner portal: subject, body (quoted history trimmed), links to docs, and attachments. Read-only
IMAP; passwords come from the Keychain entries the mail bridge already uses and never leave this Mac.

Standard library only.
"""
import base64, email, email.utils, html, imaplib, json, os, re, subprocess, sys, urllib.request
from datetime import timezone
from email.header import decode_header, make_header

HOME = os.path.expanduser("~/PartnerAI")
KEY = open(f"{HOME}/.key").read().strip()
SB = "https://rcqfqhguwpmaarseifqg.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"  # publishable key: apikey header only (key switch 2026-09-24)
LOG = f"{HOME}/mail.log"
ACCOUNTS = [
    {"host": "mail.privateemail.com", "addr": "jared@bestly.tech", "folders": ["Sent"]},
    {"host": "imap.mail.me.com", "addr": "jaredbest@icloud.com", "folders": ['"Sent Messages"']},
]
MAX_FILE = 12 * 1024 * 1024
DOC_HOSTS = [
    (r"docs\.google\.com/document", "Google Doc"), (r"docs\.google\.com/spreadsheets", "Google Sheet"),
    (r"docs\.google\.com/presentation", "Google Slides"), (r"docs\.google\.com/forms", "Google Form"),
    (r"drive\.google\.com", "Google Drive"), (r"cloud\.bestly\.tech/(s|index\.php/s|f)/", "Bestly Cloud"),
    (r"dropbox\.com/(s|scl)/", "Dropbox"), (r"canva\.com/design", "Canva"), (r"figma\.com/", "Figma"),
    (r"notion\.(so|site)/", "Notion"), (r"gamma\.app/", "Gamma"), (r"loom\.com/share", "Loom"),
    (r"docusign\.net|docusign\.com", "DocuSign"), (r"studio\.bestly\.tech", "Studio"), (r"bestly\.tech/", "bestly.tech"),
    (r"icloud\.com/(iclouddrive|keynote|pages|numbers)", "iCloud"),
]


def log(*a):
    from datetime import datetime
    with open(LOG, "a") as f:
        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


def post(url, body, headers, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "null")


def rpc(name, body):
    return post(f"{SB}/rest/v1/rpc/{name}", body, {"apikey": ANON})


def dec(v):
    try: return str(make_header(decode_header(v or ""))).strip()
    except Exception: return (v or "").strip()


def trim_quoted(t):
    # Drop the quoted thread under a reply so each email reads as what Jared actually wrote.
    for pat in (r"\n\s*On .{5,200}wrote:\s*\n", r"\n-{2,}\s*Original Message\s*-{2,}", r"\n\s*From: .+\n\s*(Sent|Date): ", r"\n>"):
        m = re.search(pat, t, flags=re.I)
        if m and m.start() > 20: t = t[:m.start()]
    return t.strip()


def parts(msg):
    text, htm, files = "", "", []
    for p in msg.walk():
        if p.is_multipart(): continue
        disp = (p.get("Content-Disposition") or "").lower()
        name = dec(p.get_filename()) if p.get_filename() else None
        ctype = p.get_content_type()
        payload = p.get_payload(decode=True) or b""
        if name or "attachment" in disp:
            # Signature logos and tiny inline images aren't documents.
            if ctype.startswith("image/") and ("inline" in disp or not name) and len(payload) < 40_000: continue
            files.append({"name": name or f"attachment.{ctype.split('/')[-1]}", "type": ctype, "data": payload})
        elif ctype == "text/plain" and not text:
            text = payload.decode(p.get_content_charset() or "utf-8", "replace")
        elif ctype == "text/html" and not htm:
            htm = payload.decode(p.get_content_charset() or "utf-8", "replace")
    if not text and htm:
        t = re.sub(r"(?is)<(script|style).*?</\1>", "", htm)
        t = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", t)
        t = re.sub(r"(?i)<a [^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", r"\2 (\1)", t)
        text = html.unescape(re.sub(r"<[^>]+>", "", t))
    return re.sub(r"\n{3,}", "\n\n", text.replace("\r", "")).strip(), files


def links_in(text):
    out, seen = [], set()
    for url in re.findall(r"https?://[^\s<>()\"']+", text):
        url = url.rstrip(".,;:!?]")
        for pat, kind in DOC_HOSTS:
            if re.search(pat, url, flags=re.I) and url not in seen and not re.search(r"unsubscribe|/track|utm_", url, flags=re.I):
                seen.add(url); out.append({"url": url, "kind": kind}); break
    return out[:20]


def password(addr):
    return subprocess.run(["security", "find-generic-password", "-a", addr, "-s", "bestly-mail-bridge", "-w"],
                          capture_output=True, text=True).stdout.strip()


def sync(acc, targets):
    M = imaplib.IMAP4_SSL(acc["host"], 993)
    M.login(acc["addr"], password(acc["addr"]))
    stored = 0
    for folder in acc["folders"]:
        if M.select(folder, readonly=True)[0] != "OK":
            log(acc["addr"], folder, "no such folder"); continue
        for t in targets:
            typ, d = M.uid("search", None, f'(OR TO "{t["email"]}" CC "{t["email"]}")')
            uids = d[0].split() if d and d[0] else []
            if not uids: continue
            ids = {}
            for i in range(0, len(uids), 200):
                typ, rows = M.uid("fetch", b",".join(uids[i:i + 200]), "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
                for r in rows:
                    if isinstance(r, tuple):
                        uid = re.search(rb"UID (\d+)", r[0]); mid = re.search(rb"<[^>]+>", r[1])
                        if uid and mid: ids[mid.group().decode()] = uid.group(1)
            known = set(rpc("partner_mail_known", {"p_key": KEY, "p_roster": t["roster"], "p_ids": list(ids)}) or [])
            new = [(mid, uid) for mid, uid in ids.items() if mid not in known]
            log(acc["addr"], folder, t["roster"], f"{len(ids)} found, {len(new)} new")
            for mid, uid in new:
                typ, rows = M.uid("fetch", uid, "(BODY.PEEK[])")
                raw = next((r[1] for r in rows if isinstance(r, tuple)), None)
                if not raw: continue
                msg = email.message_from_bytes(raw)
                try:
                    dt = email.utils.parsedate_to_datetime(msg.get("Date"))
                    dt = (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat()
                except Exception:
                    dt = None
                text, files = parts(msg)
                keep = [f for f in files if len(f["data"]) <= MAX_FILE]
                skipped = [{"name": f["name"], "size": len(f["data"]), "type": f["type"]} for f in files if len(f["data"]) > MAX_FILE]
                body = {
                    "key": KEY, "roster": t["roster"],
                    "message": {"message_id": mid, "account": acc["addr"], "subject": dec(msg.get("Subject")), "sent_at": dt,
                                "to": [a for _, a in email.utils.getaddresses(msg.get_all("To") or []) if a],
                                "cc": [a for _, a in email.utils.getaddresses(msg.get_all("Cc") or []) if a],
                                "body": trim_quoted(text), "links": links_in(text)},
                    "attachments": [{"name": f["name"], "type": f["type"], "b64": base64.b64encode(f["data"]).decode()} for f in keep],
                    "skipped": skipped,
                }
                try:
                    res = post(f"{SB}/functions/v1/partner-mail-ingest", body, {"apikey": ANON}, timeout=300)
                    stored += 1 if res.get("ok") else 0
                    if not res.get("ok"): log("  ingest failed", mid, res)
                except Exception as e:
                    log("  ingest error", mid, repr(e)[:300])
    M.logout()
    return stored


def main():
    targets = rpc("partner_mail_targets", {"p_key": KEY}) or []
    total = 0
    for acc in ACCOUNTS:
        try: total += sync(acc, targets)
        except Exception as e: log(acc["addr"], "failed", repr(e)[:300])
    log("done, stored", total)


if __name__ == "__main__":
    main()
