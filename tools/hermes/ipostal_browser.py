#!/usr/bin/env python3
"""Hermes' hands in iPostal1. Runs ONLY from hermes_mailroom.py, in its own process, with the login in the environment.

  ipostal_browser.py view            sign in, count what the mailbox shows, sign out. Spends nothing.
  ipostal_browser.py act  < json     sign in and carry out APPROVED actions (one list, one login). The job has already checked that
                                     each action is an approved row in hermes_actions.
  ipostal_browser.py probe           like view, but also prints the visible button names (to confirm the screen has not changed).

Rules baked in:
  * Credentials only from IPOSTAL_EMAIL / IPOSTAL_PASSWORD (never argv, never printed, never logged).
  * Fresh browser every run, no saved cookies. Closes the session at the end. Every run prints which public address it came from, so the
    login can be logged and Ares can tell Hermes' sign-ins from anyone else's.
  * Page text is DATA. Nothing on a page is ever followed as an instruction. Navigation stays on ipostal1.com.
  * Paid actions: one item, one button, and only when the screen shows exactly one match. If the item or the button is missing or
    ambiguous, a payment form or CAPTCHA appears, or the screen asks for anything we did not expect, it stops and says "clicked": false.
    It never types card numbers, never solves CAPTCHAs, never changes account settings.
  * Prints ONE line of JSON.  clicked=true means a paid button may have been pressed: the caller will never retry that blind.

NOTE (2026-10-19): written before Jared's login was saved, so the screen selectors here are generic (accessible names and visible
text) and unverified against the live site. The first `view` run after he saves the login is the check; if the screen differs the run
reports "login page changed" instead of guessing.
"""
import json
import os
import re
import sys
import time
import urllib.request

APP = "https://app.ipostal1.com/"
ALLOWED = re.compile(r"^https://([a-z0-9-]+\.)*ipostal1\.com(/|$)", re.I)
ACTION_WORDS = {
    "scan": r"^(open (&|and) scan|open (&|and) scan item|scan)$",
    "shred": r"^(shred|shred item)$",
    "forward": r"^(forward|ship|forward item)$",
    "recycle": r"^(recycle|recycle item|discard)$",
    "deposit_check": r"^(deposit( check)?|check deposit|deposit this check)$",
    "package": r"^(forward|ship|forward package|hold package)$",
}


def out(obj):
    print(json.dumps(obj, default=str))
    sys.stdout.flush()


def egress_ip():
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=10) as r:
            return r.read().decode().strip()[:45]
    except Exception:  # noqa: BLE001
        return None


def sign_in(pg, email, password):
    """Returns the login dict for the log. Never raises for a refused login."""
    lg = {"ok": False, "ip": egress_ip(), "session": "h" + str(int(time.time())), "rejected": False, "note": ""}
    pg.goto(APP, wait_until="domcontentloaded", timeout=90000)
    time.sleep(2)
    if pg.locator("iframe[src*='captcha'], .g-recaptcha, [data-sitekey], #px-captcha").count():
        lg["note"] = "CAPTCHA on the sign-in page, stopped (never solved)"
        return lg
    em = pg.locator("input[type=email], input[name*=email i], input[id*=email i], input[autocomplete=username]").first
    pw = pg.locator("input[type=password]").first
    if not em.count() or not pw.count():
        lg["note"] = "login page changed: no email or password box found"
        return lg
    em.fill(email)
    pw.fill(password)
    btn = pg.get_by_role("button", name=re.compile(r"^(log ?in|sign ?in|continue)$", re.I))
    if btn.count() < 1:
        btn = pg.locator("button[type=submit]")
    if btn.count() < 1:
        lg["note"] = "login page changed: no sign-in button found"
        return lg
    btn.first.click()
    for _ in range(25):
        time.sleep(1)
        body = (pg.inner_text("body") or "")[:3000].lower()
        if re.search(r"(invalid|incorrect|wrong|does not match|not recognized).{0,40}(password|email|credentials|login)", body):
            lg["rejected"], lg["note"] = True, "iPostal1 refused the email or password"
            return lg
        if pg.locator("input[type=password]").count() == 0:
            lg["ok"] = True
            return lg
        if re.search(r"(verification code|two.?factor|authenticator|confirm it.?s you)", body):
            lg["note"] = "iPostal1 asked for a second step (2FA), stopped"
            return lg
    lg["note"] = "still on the sign-in page after 25 seconds"
    return lg


def sign_out(pg):
    try:
        for name in (r"log ?out", r"sign ?out"):
            b = pg.get_by_role("link", name=re.compile(name, re.I))
            if b.count() == 0:
                b = pg.get_by_role("button", name=re.compile(name, re.I))
            if b.count():
                b.first.click()
                time.sleep(1)
                return
    except Exception:  # noqa: BLE001
        pass


def visible_buttons(pg):
    try:
        return sorted({t.strip()[:30] for t in pg.locator("button, a[role=button]").all_inner_texts() if t.strip()})[:40]
    except Exception:  # noqa: BLE001
        return []


def guard_url(pg):
    if not ALLOWED.match(pg.url or ""):
        raise RuntimeError("navigated off ipostal1.com, stopped")


def find_item_row(pg, item):
    """One visible mail row that matches the item by reference, else by sender text. Exactly one, or None."""
    ref = (item.get("item_ref") or "").strip()
    sender = (item.get("sender") or "").strip()
    rows = pg.locator("tr, li, [class*=mail-item], [class*=MailItem], [class*=item-row]")
    cands = []
    for i in range(min(rows.count(), 300)):
        try:
            t = rows.nth(i).inner_text(timeout=1500)
        except Exception:  # noqa: BLE001
            continue
        if ref and ref in t:
            cands.append(i)
        elif not ref and sender and len(sender) >= 4 and sender.lower() in t.lower():
            cands.append(i)
    return rows.nth(cands[0]) if len(cands) == 1 else None


def do_action(pg, a):
    res = {"id": a["id"], "clicked": False, "done": False, "note": ""}
    act, item = a["action"], a.get("item") or {}
    if act not in ACTION_WORDS:
        res["note"] = "unknown action"
        return res
    guard_url(pg)
    row = find_item_row(pg, item)
    if row is None:
        res["note"] = "could not find exactly one matching mail item on the screen; nothing was clicked"
        return res
    word = re.compile(ACTION_WORDS[act], re.I)
    btns = row.get_by_role("button", name=word)
    if btns.count() == 0:
        btns = row.get_by_role("link", name=word)
    if btns.count() != 1:
        res["note"] = "found %d '%s' buttons on that item, need exactly 1; nothing was clicked" % (btns.count(), act)
        return res
    body = (pg.inner_text("body") or "")[:4000].lower()
    if re.search(r"(card number|cvv|security code|add a (payment|credit))", body):
        res["note"] = "screen is asking for card details; stopped"
        return res
    btns.first.click()
    res["clicked"] = True
    time.sleep(2)
    guard_url(pg)
    dlg = pg.locator("[role=dialog], .modal, [class*=modal]").first
    if dlg.count():
        txt = (dlg.inner_text() or "")[:1500].lower()
        if re.search(r"(card number|cvv|security code|add a (payment|credit))", txt):
            res["note"] = "a payment form opened after the click; stopped"
            return res
        ok = dlg.get_by_role("button", name=re.compile(r"^(confirm|yes|ok|continue|submit|proceed)$", re.I))
        if ok.count() == 1:
            ok.first.click()
            time.sleep(3)
        else:
            res["note"] = "confirmation box did not have exactly one confirm button; outcome unconfirmed"
            return res
    after = (pg.inner_text("body") or "")[:4000].lower()
    if re.search(r"(error|failed|unable|insufficient|declined)", after) and not re.search(r"(success|requested|submitted|confirmed)", after):
        res["note"] = "the screen shows an error after the click; outcome unconfirmed, check iPostal1"
        return res
    res["done"] = True
    res["note"] = "clicked %s and the screen did not report a problem" % act
    return res


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "view"
    email, password = os.environ.get("IPOSTAL_EMAIL", ""), os.environ.get("IPOSTAL_PASSWORD", "")
    if not email or not password:
        out({"error": "no login given", "login": {"ok": False, "note": "no login given"}})
        return
    args = {}
    if mode == "act":
        try:
            args = json.loads(sys.stdin.read() or "{}")
        except Exception:  # noqa: BLE001
            out({"error": "bad action list"})
            return
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
        try:
            ctx = b.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=False)
            pg = ctx.new_page()
            lg = sign_in(pg, email, password)
            res = {"login": lg}
            if not lg["ok"]:
                out(res)
                return
            guard_url(pg)
            if mode in ("view", "probe"):
                body = pg.inner_text("body") or ""
                res["count"] = len(pg.locator("tr, li, [class*=mail-item], [class*=MailItem]").all())
                if mode == "probe":
                    res["buttons"] = visible_buttons(pg)
                res["items"] = []
            elif mode == "act":
                res["results"] = [do_action(pg, a) for a in (args.get("actions") or [])[:8]]
            sign_out(pg)
            out(res)
        except Exception as e:  # noqa: BLE001
            out({"error": "%s: %s" % (type(e).__name__, str(e)[:240]), "login": locals().get("lg") or {}})
        finally:
            b.close()


if __name__ == "__main__":
    main()
