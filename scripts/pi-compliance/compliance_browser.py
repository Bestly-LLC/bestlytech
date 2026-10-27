"""Render pages for Vera's compliance checks (SPAs prove nothing on a raw 200). Runs in the turo-watch venv.

  compliance_browser.py '<json list>'  ->  prints a JSON list, one entry per request:
    request  {"url": "...", "click": "Talk to Maya" (optional), "hosts": true (optional)}
    result   {"url", "status", "text", "hosts": [...], "cookies": n, "local_storage": n, "error"}
Every page gets a fresh private browser context (no cookies, no storage), so "sets 0 cookies" means what it says.
Uses the Pi Chrome on CDP 9334 (same as Radar's platform_browser.py); if that is down it launches a headless Chromium
itself, which is the self-heal for "the Pi Chrome was closed".
"""
import json
import os
import sys
import time
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

CHROMES = ["/usr/bin/chromium", "/usr/lib/chromium/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]


def open_browser(p):
    try:
        return p.chromium.connect_over_cdp("http://127.0.0.1:9334"), "cdp"
    except Exception:  # noqa: BLE001
        exe = next((c for c in CHROMES if os.path.exists(c)), None)
        kw = {"headless": True, "args": ["--no-sandbox", "--disable-gpu"]}
        if exe:
            kw["executable_path"] = exe
        return p.chromium.launch(**kw), "headless"


def settle_eval(pg, js, default):
    """A page that redirects client-side destroys the execution context mid-read; wait for it to settle and read again."""
    for _ in range(4):
        try:
            return pg.evaluate(js)
        except Exception:  # noqa: BLE001
            time.sleep(2.5)
            try:
                pg.wait_for_load_state("domcontentloaded", timeout=10000)
            except Exception:  # noqa: BLE001
                pass
    return default


def one(browser, req):
    out = {"url": req["url"], "status": None, "text": "", "hosts": [], "cookies": 0, "local_storage": 0, "error": None}
    ctx = browser.new_context(ignore_https_errors=False, viewport={"width": 1280, "height": 900})
    hosts = set()
    try:
        pg = ctx.new_page()
        pg.on("request", lambda r: hosts.add(urlparse(r.url).hostname or ""))
        resp = pg.goto(req["url"], timeout=60000, wait_until="domcontentloaded")
        out["status"] = resp.status if resp else None
        try:
            pg.wait_for_load_state("networkidle", timeout=15000)
        except Exception:  # noqa: BLE001
            pass
        time.sleep(2.5)
        # a slow Pi can hand back a half-drawn single-page app: wait until the text is a real page's worth and stops growing
        last = -1
        for _ in range(7):
            n = settle_eval(pg, "document.body ? document.body.innerText.length : 0", 0)
            if n >= 600 and n == last:
                break
            last = n
            time.sleep(2)
        if req.get("click"):
            try:
                pg.get_by_text(req["click"], exact=False).first.click(timeout=8000)
                time.sleep(2.5)
            except Exception as e:  # noqa: BLE001
                out["error"] = f"could not click '{req['click']}': {str(e)[:120]}"
        out["text"] = settle_eval(pg, "document.body ? document.body.innerText : ''", "")
        out["local_storage"] = settle_eval(pg, "Object.keys(window.localStorage).length", 0)
        out["cookies"] = len(ctx.cookies())
        out["hosts"] = sorted(h for h in hosts if h)
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    finally:
        try:
            ctx.close()
        except Exception:  # noqa: BLE001
            pass
    return out


def main():
    reqs = json.loads(sys.argv[1])
    res = []
    with sync_playwright() as p:
        browser, how = open_browser(p)
        try:
            for r in reqs:
                res.append(one(browser, r))
        finally:
            if how == "headless":
                browser.close()
    print(json.dumps({"how": how, "pages": res}))


if __name__ == "__main__":
    main()
