#!/usr/bin/env python3
"""Build the branded email templates shown on /admin/templates.

Sources live in tools/email-templates/src/*.html. This script writes, for each one:
  public/email-templates/<slug>.html  full HTML page (preview + "Download HTML")
  public/email-templates/<slug>.eml   draft email; Apple Mail opens it as a new
                                      editable message because of "X-Unsent: 1"
and public/email-templates/templates.json, which the admin page reads.

Every image points at https://www.bestly.tech/email-templates/assets/..., so the
emails load in any inbox once this is deployed. Run: python3 tools/email-templates/build.py
"""
import json, quopri, re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tools/email-templates/src"
OUT = ROOT / "public/email-templates"
ASSETS = "https://www.bestly.tech/email-templates/assets"

TEMPLATES = [
    {"slug": "bestly-support", "name": "Bestly Support", "brand": "Bestly", "kind": "Support reply",
     "use": "Answer a customer question. Ends with ads for Bestly Agent, Cookie Yeti and InventoryProof.",
     "subject": "Re: your question"},
    {"slug": "bestly-letter", "name": "Bestly Letter", "brand": "Bestly", "kind": "Personal note",
     "use": "A personal note from Jared with his signature. Good for thank-yous and follow-ups.",
     "subject": "A note from Jared at Bestly"},
    {"slug": "inventoryproof-support", "name": "InventoryProof Account Check", "brand": "InventoryProof", "kind": "Support reply",
     "use": "Show a customer their account summary, like proof they were never charged. Asks them to update their review.",
     "subject": "About your InventoryProof account"},
    {"slug": "inventoryproof-message", "name": "InventoryProof Message", "brand": "InventoryProof", "kind": "General reply",
     "use": "Any reply from InventoryProof Support. Includes a Trustpilot review button and a log-in link.",
     "subject": "From InventoryProof Support"},
]

# Old hosts -> the copies served from bestly.tech.
SWAPS = {
    "https://cloud.bestly.tech/custom_apps/bestlymail/img/header.gif": f"{ASSETS}/bestly-header.gif",
    "https://cloud.bestly.tech/s/B8tttKttMYcBHF7/download": f"{ASSETS}/jared-headshot.gif",
    "https://cloud.bestly.tech/s/zCPkFMKrDTzFtqg/download": f"{ASSETS}/inventoryproof-icon.png",
    "https://www.bestly.tech/images/cookieyeti-icon.png": f"{ASSETS}/cookieyeti-icon.png",
}

def as_document(html: str, title: str) -> str:
    """Wrap a fragment (a Mail signature body) in a full HTML document."""
    if re.search(r"<html[\s>]", html, re.I):
        return re.sub(r"<title>.*?</title>", f"<title>{title}</title>", html, count=1, flags=re.S)
    head = ""
    m = re.match(r"\s*(<head>.*?</head>)?\s*(<style>.*?</style>)?", html, re.S)
    if m:
        head = (m.group(1) or "") + (m.group(2) or "")
        html = html[m.end():]
    head = re.sub(r"</?head>", "", head)
    body = re.sub(r"</?body[^>]*>", "", html)
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">'
            f"<title>{title}</title>{head}</head><body style=\"margin:0;padding:0\">{body}</body></html>")

def eml(html: str, subject: str) -> bytes:
    body = quopri.encodestring(html.encode("utf-8"))
    headers = ("X-Unsent: 1\r\n"
               f"Subject: {subject}\r\n"
               "MIME-Version: 1.0\r\n"
               "Content-Type: text/html; charset=utf-8\r\n"
               "Content-Transfer-Encoding: quoted-printable\r\n\r\n")
    return headers.encode("ascii") + body.replace(b"\n", b"\r\n")

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for t in TEMPLATES:
        html = (SRC / f"{t['slug']}.html").read_text(encoding="utf-8")
        html = re.sub(r"data:image/gif;base64,[A-Za-z0-9+/=]+", f"{ASSETS}/jared-headshot.gif", html)
        for old, new in SWAPS.items():
            html = html.replace(old, new)
        html = as_document(html, t["name"])
        assert "base64," not in html, f"{t['slug']}: embedded image left"
        (OUT / f"{t['slug']}.html").write_text(html, encoding="utf-8")
        (OUT / f"{t['slug']}.eml").write_bytes(eml(html, t["subject"]))
        manifest.append({**t, "html": f"/email-templates/{t['slug']}.html",
                         "eml": f"/email-templates/{t['slug']}.eml", "updated": date.today().isoformat()})
    (OUT / "templates.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"built {len(manifest)} templates into {OUT.relative_to(ROOT)}")

if __name__ == "__main__":
    main()
