"""Parker's fallback: sign in to the Park My Share portal in a headless browser and read the QR codes the page loads.

Installed as /opt/bestly/parkmyshare/browser.py; run by lax_code_fetch.py with the turo-watch venv (has Playwright):
    PMS_EMAIL=... PMS_PASSWORD=... /opt/bestly/turo-watch/.venv/bin/python /opt/bestly/parkmyshare/browser.py
Credentials come only through the environment (never argv, so they never show in a process list).

It does not depend on the API's paths: it listens to every JSON response the portal receives and keeps any list of objects
that look like QR codes (have a barcode and a status). Prints ONE line of JSON:
    {"codes": [...]}  or  {"auth": true, "message": "..."}  or  {"error": "..."}
Read only: it never clicks Generate, Replace or Expire.
"""
import json
import os
import time

PORTAL = "https://app.parkmycarshare.com/"


def looks_like_codes(j):
    return isinstance(j, list) and j and all(isinstance(x, dict) for x in j) and any("barcode" in x and "status" in x for x in j)


def main():
    email, password = os.environ.get("PMS_EMAIL", ""), os.environ.get("PMS_PASSWORD", "")
    if not email or not password:
        print(json.dumps({"auth": True, "message": "no login given"}))
        return
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    found, login_msg = [], {}

    def on_response(r):
        try:
            if "json" not in (r.headers.get("content-type") or ""):
                return
            j = r.json()
        except Exception:  # noqa: BLE001
            return
        if looks_like_codes(j):
            found.extend(j)
        elif isinstance(j, dict) and "user/login" in r.url and r.status >= 400:
            login_msg["m"] = ((j.get("responseStatus") or {}).get("message")) or f"HTTP {r.status}"

    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
        try:
            pg = b.new_page(viewport={"width": 1280, "height": 900})
            pg.on("response", on_response)
            pg.goto(PORTAL + "login", wait_until="networkidle", timeout=90000)
            pg.locator("input[type=email], input[formcontrolname=email], input[name=email]").first.fill(email)
            pg.locator("input[type=password]").first.fill(password)
            btn = pg.locator("button[type=submit]")
            if not btn.count():
                btn = pg.get_by_role("button", name="Log in")
            btn.first.click()
            for _ in range(30):
                time.sleep(1)
                if "/login" not in pg.url or "m" in login_msg:
                    break
            if "m" in login_msg or "/login" in pg.url:
                print(json.dumps({"auth": True, "message": login_msg.get("m", "still on the sign-in page")}))
                return
            pg.goto(PORTAL + "host/qr-management", wait_until="networkidle", timeout=90000)
            for _ in range(20):
                if found:
                    break
                time.sleep(1)
            print(json.dumps({"codes": found, "url": pg.url.split("?")[0]}))
        finally:
            b.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"{type(e).__name__}: {e}"[:400]}))
