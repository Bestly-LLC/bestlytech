"""Local end-to-end test of the filer against a FAKE claim site on 127.0.0.1. Nothing real is contacted or filed, and
Supabase is never called. Run:  venv/bin/python filer.py --selftest"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

STATES_HTML = "".join('<option value="%s">%s</option>' % (a, a) for a in ["", "AZ", "CA", "NY", "TX"])

FORM = """<html><head><title>Fake Settlement Claim</title></head><body><h1>Fake Co. Settlement - Claim Form</h1>
<form method="post" action="/done"><p>Fields marked * are required.</p>
%(extra)s
<label for="fn">First Name *</label><input id="fn" name="fn" required><br>
<label for="ln">Last Name *</label><input id="ln" name="ln" required><br>
<label for="em">Email Address *</label><input id="em" name="em" type="email" required><br>
<label for="ph">Phone</label><input id="ph" name="ph" type="tel"><br>
<label for="a1">Street Address *</label><input id="a1" name="a1" required><br>
<label for="a2">Apt / Suite</label><input id="a2" name="a2"><br>
<label for="ci">City *</label><input id="ci" name="ci" required><br>
<label for="st">State *</label><select id="st" name="st" required>%(states)s</select><br>
<label for="zp">ZIP Code *</label><input id="zp" name="zp" required><br>
<fieldset><legend>Did you purchase a Fake Co. gadget between 2019 and 2024? *</legend>
<label><input type="radio" name="bought" value="y" required> Yes</label> <label><input type="radio" name="bought" value="n"> No</label></fieldset>
<fieldset><legend>How would you like to be paid? *</legend>
<label><input type="radio" name="pay" value="ach" required> Direct deposit (ACH)</label>
<label><input type="radio" name="pay" value="pp"> PayPal</label>
<label><input type="radio" name="pay" value="vm"> Venmo</label>
<label><input type="radio" name="pay" value="ck"> Paper check mailed to my address</label></fieldset>
<label for="ppe">PayPal email (if paying by PayPal)</label><input id="ppe" name="ppe"><br>
<label><input type="checkbox" name="news"> Send me the newsletter and special offers</label><br>
<label><input type="checkbox" name="att" required> I declare under penalty of perjury that the information provided is true and correct.</label><br>
%(captcha)s
<button type="submit">Submit Claim</button></form></body></html>"""


def page(kind):
    extra, captcha = "", ""
    if kind == "id":
        extra = '<label for="cid">Class Member ID *</label><input id="cid" name="cid" required><br>'
    if kind == "captcha":
        captcha = '<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px;border:1px solid #888"></div>'
    if kind == "upload":
        extra = '<label for="pf">Proof of purchase (upload) *</label><input id="pf" name="pf" type="file" required><br>'
    if kind == "date":
        extra = '<label for="dp">Date of purchase *</label><input id="dp" name="dp" required><br>'
    return FORM % {"extra": extra, "captcha": captcha, "states": STATES_HTML}


class H(BaseHTTPRequestHandler):
    last = ""
    def log_message(self, *a):
        pass

    def _send(self, body, code=200):
        b = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        path = self.path.split("?")[0].strip("/")
        if path == "landing":
            return self._send('<html><body><h1>Fake Co. Settlement</h1><p>Read the notice.</p><a href="/pdf/claim.pdf">Download paper claim form</a> '
                              '<a href="/ok">File a Claim Online</a></body></html>')
        if path in ("ok", "id", "captcha", "upload", "date"):
            return self._send(page(path))
        self._send("not found", 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode()
        H.last = body
        self._send("<html><body><h1>Thank you for submitting your claim.</h1><p>Your claim has been submitted. "
                   "Your Confirmation Number: FAKE-482913</p></body></html>")


def main(f):
    srv = HTTPServer(("127.0.0.1", 0), H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % port
    notes = []
    if os.environ.get("FILER_STUB_LLM"):   # offline iteration only; the real test on the Mac uses the free AI
        def stub(unknown, settlement):
            return {(u["options"][0]["nf"] if u["kind"] == "radio" else u["nf"]):
                    ({"source": "class_member_yes"} if "purchase" in (u.get("label") or "").lower() else {"source": "none", "why": "not in saved details"})
                    for u in unknown}
        f.llm_answers = stub
    sync_playwright = f.import_playwright(notes)
    prof = dict(f.DEMO_PROFILE)
    prof_nopp = dict(prof, paypal_email=None)
    results = []

    def run(label, path, profile, expect, expect_payout=None):
        outdir = os.path.join(f.RECEIPTS, "selftest-" + label)
        claim = {"id": "selftest", "settlement": {"name": "Fake Co. Settlement", "claim_url": base + path, "defendant": "Fake Co.",
                                                    "class_definition": "Anyone who purchased a Fake Co. gadget between 2019 and 2024."}}
        try:
            r = f.process_claim(browser, claim, profile, outdir, dry=False, submit_ok=base.startswith("http://127.0.0.1:"))
            got = r["result"]
            detail = "confirmation=%s payout=%s fields=%d" % (r.get("confirmation"), r.get("payout"), len(r["journal"]))
            ok = got == expect and (expect_payout is None or r.get("payout") == expect_payout)
        except f.Handoff as h:
            got, detail = "needs_you", str(h)
            ok = expect == "needs_you"
        results.append(ok)
        print("%s  %-26s expected=%-9s got=%-9s %s" % ("PASS" if ok else "FAIL", label, expect, got, detail), flush=True)

    with sync_playwright() as p:
        browser = f.ensure_browser(p, notes)
        run("clean-form-paypal", "ok", prof, "filed", "paypal")
        sent = H.last
        print("   server received:", sent)
        run("no-paypal-email->check", "ok", prof_nopp, "filed", "check")
        run("link-follow-landing", "landing", prof, "filed", "paypal")
        run("needs-class-member-id", "id", prof, "needs_you")
        run("captcha-widget", "captcha", prof, "needs_you")
        run("document-upload", "upload", prof, "needs_you")
        run("unknown-required-date", "date", prof, "needs_you")
        browser.close()
    srv.shutdown()
    print("%d/%d passed" % (sum(results), len(results)))
    return 0 if all(results) else 1
