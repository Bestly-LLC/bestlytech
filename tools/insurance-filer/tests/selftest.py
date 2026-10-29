#!/usr/bin/env python3
"""Self-test for the Insurance Filer. Runs entirely on this Mac: a stand-in claim portal (tests/fixtures/standin.html) and two saved
copies of Progressive's real first screens. Nothing touches Supabase, Progressive or any mailbox.

  python3 filer.py --selftest            (or)   python3 tests/selftest.py
Needs Playwright + Chromium (the venv install.sh builds). Python 3.9 compatible.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.dirname(HERE)
sys.path.insert(0, TOOL)
import rules  # noqa: E402
import walker  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
STANDIN = "file://" + os.path.join(FIX, "standin.html")

# Cody's case, as the packet builder produces it (phone numbers masked in this committed copy)
VALUES = {
    "reporter.name": "Jared Best", "reporter.phone": "(816) 500-7236", "reporter.email": "jared@bestly.tech",
    "policy.number": "870703450", "policy.holder": "Essence Bonner Harris", "driver.name": "Essence Bonner Harris", "driver.phone": "414 555 0100",
    "vehicle.year": "2020", "vehicle.make": "Tesla", "vehicle.model": "Model 3", "vehicle.plate": "8ZOG117", "vehicle.plate_state": "CA",
    "vehicle.vin": "5YJ3E1EAXLF658422", "vehicle.drivable": "Yes",
    "loss.date": "10/26/2026", "loss.address": "750 B St", "loss.city": "San Diego", "loss.state": "CA", "loss.zip": "92101", "loss.type": "Collision",
    "loss.description": "The car rubbed against a barrier", "loss.damage": "Passenger door scratches", "loss.injuries": "No", "loss.police": "No",
    "loss.airbags": "No", "loss.other_party": "No",
    "turo.claim_no": "1108308", "turo.disclosure": "Turo opened claim 1108308 (reservation 62622707) for this same loss.",
}
WHY = {"loss.time": "Turo only records the date. Left blank.", "vehicle.color": "Turo does not store the color. Left blank."}

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "  -> " + str(detail)[:300]))
    if not cond:
        FAILS.append(name)


def rules_tests():
    print("rules")
    check("yes/no", rules.yes_no("No") == "No" and rules.yes_no("yes, both") == "Yes" and rules.yes_no("Not sure") is None and rules.yes_no("None known") is None)
    check("phone", rules.phone_fmt("414 364 4998") == "(414) 364-4998" and rules.phone_fmt("1-816-500-7236") == "(816) 500-7236")
    check("filing for yourself -> Myself", rules.choose("Are you filing on behalf of yourself, or someone else?", ["Myself", "Someone else"], VALUES)[0] == "Myself")
    check("best way to reach -> Email", rules.choose("What is the best way for us to get in touch with you?", ["Text", "Email", "Phone call"], VALUES)[0] == "Email")
    check("safe means nobody hurt", rules.choose("Is everyone currently safe?", ["Yes", "No"], VALUES)[0] == "Yes")
    check("safe is unknown when injuries unknown", rules.choose("Is everyone currently safe?", ["Yes", "No"], {})[0] is None)
    check("injured question", rules.choose("Was anyone injured?", ["Yes", "No"], VALUES)[0] == "No")
    check("police", rules.choose("Was a police report filed?", ["Yes", "No"], VALUES)[0] == "No")
    check("reporter is not the policyholder", rules.choose("Are you the policyholder?", ["Yes", "No"], VALUES)[0] == "No")
    check("unknown question gets no answer", rules.choose("What is your pet's name?", ["Rex", "Fido"], VALUES)[0] is None)
    check("loss type", rules.choose("What type of loss was it?", ["Theft", "Collision", "Fire"], VALUES)[0] == "Collision")
    check("role option", rules.choose("What is your relationship to this claim?", ["Policyholder", "Passenger", "Owner of the damaged vehicle"], VALUES)[0] == "Owner of the damaged vehicle")
    check("name label", rules.key_for_text("Your full name") == "reporter.name")
    check("company name is not the reporter", rules.key_for_text("Repair shop name") != "reporter.name")
    check("phone label", rules.key_for_text("Phone number") == "reporter.phone")
    check("loss address by context", rules.key_for_text("Street address", "Where did it happen?") == "loss.address")
    check("mailing address is the reporter's", rules.key_for_text("Street address", "What is your mailing address?") == "reporter.address")
    check("email address is email", rules.key_for_text("Email address") == "reporter.email")
    check("description carries the Turo disclosure", "Turo opened claim 1108308" in rules.text_value("loss.description", VALUES))
    check("extra carries driver + disclosure", "Essence Bonner Harris" in rules.text_value("@extra", VALUES) and "1108308" in rules.text_value("@extra", VALUES))
    check("unknown value is None", rules.text_value("loss.time", VALUES) is None and rules.text_value("vehicle.color", VALUES) is None)
    check("button kinds", [rules.classify_button(x) for x in ("I Agree and Continue", "Continue", "Submit claim", "Navigate Back", "Learn more")] == ["consent", "advance", "final", "skip", "other"])
    check("claim number from a confirmation", rules.claim_no_from("Thank you. Your claim number is 26-7654321. Turo claim 1108308 is separate.", "1108308") == "26-7654321")
    check("Turo's number is never ours", rules.claim_no_from("Turo claim number 1108308", "1108308") is None)
    check("states", rules.state_forms("CA") == ["CA", "California"] and rules.pick_option(["Arizona", "California"], rules.state_forms("CA")) == "California")


def new_page(p):
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1100, "height": 1500})
    return b, ctx.new_page()


def walk(p, scenario, mode, **kw):
    b, page = new_page(p)
    try:
        page.goto(STANDIN + "?s=" + scenario)
        shots = tempfile.mkdtemp(prefix="ins_shots_")
        w = walker.Walker(page, kw.pop("values", VALUES), mode=mode, shots_dir=shots, unknown_why=WHY, seconds=90, **kw)
        res = w.run()
        res["_consents"] = page.evaluate("window.__consents")
        res["_submits"] = page.evaluate("window.__submits")
        res["_files"] = page.evaluate("window.__files")
        res["_vals"] = page.evaluate("window.__vals")
        res["_shots_ok"] = all(os.path.exists(os.path.join(shots, s)) for s in res.get("shots", []))
        return res
    finally:
        b.close()


def real_screens(p):
    print("saved copies of Progressive's real first two screens")
    b, page = new_page(p)
    try:
        page.goto("file://" + os.path.join(FIX, "progressive_screen0.html"))
        s = page.evaluate(walker.SNAP_JS)
        check("screen 0 step key + question", s["step_key"] == "everyoneOkay" and s["title"] == "Is everyone currently safe?", (s["step_key"], s["title"]))
        check("screen 0 choices", [c["label"] for c in s["choices"]] == ["Yes", "No"], s["choices"])
        check("screen 0 answer is Yes for a no-injury report", rules.choose(s["title"], [c["label"] for c in s["choices"]], VALUES)[0] == "Yes")
        page.goto("file://" + os.path.join(FIX, "progressive_screen1.html"))
        s = page.evaluate(walker.SNAP_JS)
        labels = [f["label"] for f in s["fields"]]
        check("screen 1 fields", labels == ["Your full name", "Phone number"], labels)
        check("screen 1 consent button", [rules.classify_button(x["label"]) for x in s["buttons"]].count("consent") == 1, s["buttons"])
        check("screen 1 consent text captured", "arbitration" in (s["consent_text"] or "") and "automated texts" in (s["consent_text"] or ""), s["consent_text"])
        check("screen 1 maps to name + phone", [rules.key_for_text(l, s["title"]) for l in labels] == ["reporter.name", "reporter.phone"])
    finally:
        b.close()


def scenarios(p):
    print("dry rehearsal (cannot consent, cannot submit)")
    r = walk(p, "ok", "dry")
    check("stops at the consent screen", r["reached"] == "consent" and r["_consents"] == 0 and r["_submits"] == 0, (r["reached"], r["_consents"]))
    check("clicked Yes for safe, typed name and phone", [f["value"] for f in r["filled"]][:3] == ["Yes", "Jared Best", "(816) 500-7236"], r["filled"])
    check("consent text recorded for Jared to see", any("automated texts" in c for c in r["consent"]), r["consent"])

    print("fill pass, consent allowed")
    r = walk(p, "ok", "fill", consent_before_tap=True, fetch_photos=_photos)
    check("reaches the review screen and does NOT submit", r["reached"] == "review" and r["_submits"] == 0, (r["reached"], r["blocked_reason"], r["_submits"]))
    check("consent clicked exactly once and recorded", r["consent_clicked"] and r["_consents"] == 1 and len(r["consent"]) == 1)
    v = r["_vals"]
    check("typed the loss facts", v.get("Street address") == "750 B St" and v.get("City") == "San Diego" and v.get("State") == "California" and v.get("ZIP code") == "92101", v)
    check("typed the vehicle", v.get("VIN") == "5YJ3E1EAXLF658422" and v.get("License plate number") == "8ZOG117" and v.get("Year") == "2020", v)
    check("date went in as a date", v.get("Date of loss") == "2026-10-26", v.get("Date of loss"))
    check("story includes the Turo disclosure", "Turo opened claim 1108308" in v.get("Please describe what happened", ""), v)
    check("extra includes the driver", "Essence Bonner Harris" in v.get("Anything else you would like to add?", ""), v)
    check("yes/no screens answered from the report", v.get("Was anyone injured?") == "No" and v.get("Was a police report filed?") == "No", v)
    blanks = [b["label"] for b in r["left_blank"]]
    check("time and color left blank, not invented", "Time of loss" in blanks and "Color" in blanks and not v.get("Time of loss") and not v.get("Color"), (blanks, v))
    check("blank reasons come from the packet", [b["why"] for b in r["left_blank"] if b["label"] == "Color"] == [WHY["vehicle.color"]])
    check("photos uploaded", r["photos_uploaded"] == 2 and r["_files"] == ["damage-photo-1.jpg", "damage-photo-2.jpg"], (r["photos_uploaded"], r["_files"]))
    check("screenshots written", len(r["shots"]) >= 8 and r["_shots_ok"], r["shots"])

    print("fill pass, consent NOT allowed before the tap")
    r = walk(p, "ok", "fill", consent_before_tap=False)
    check("stops at consent, clicks nothing", r["reached"] == "consent" and r["_consents"] == 0 and not r["consent_clicked"])

    print("submit after the tap")
    r = walk(p, "ok", "submit", packet_hash="h1", approved_hash="h1", turo_claim_no="1108308")
    check("sends once and reads the claim number", r["reached"] == "submitted" and r["_submits"] == 1 and r["claim_no"] == "26-7654321", (r["reached"], r["_submits"], r["claim_no"]))
    check("never mistakes Turo's number for ours", r["claim_no"] != "1108308")
    r = walk(p, "ok", "submit", packet_hash="NEW", approved_hash="h1")
    check("refuses when the facts changed after the tap", r["_submits"] == 0 and r["stop"] == "stale" and r["not_sent"] is True, (r["stop"], r["_submits"]))
    check("fill mode can never submit even at the final button", walk(p, "ok", "fill")["_submits"] == 0)

    print("things it must stop for")
    r = walk(p, "captcha", "fill")
    check("CAPTCHA: blocked, says so, nothing submitted", r["stop"] == "blocked" and "CAPTCHA" in r["blocked_reason"] and r["_submits"] == 0, r["blocked_reason"])
    r = walk(p, "unknown", "fill")
    check("unknown question: blocked with the question in the reason", r["stop"] == "blocked" and "pet" in r["blocked_reason"].lower(), r["blocked_reason"])
    r = walk(p, "stuck", "fill")
    check("a form that will not go on: blocked, not a loop", r["stop"] == "blocked" and "Claimant ID" in (r["blocked_reason"] + json.dumps(r["left_blank"])), r["blocked_reason"])
    check("it listed what it could not answer", any("Claimant ID" in b["label"] for b in r["left_blank"]), r["left_blank"])
    r = walk(p, "ok", "fill", values=dict((k, v) for k, v in VALUES.items() if k != "loss.injuries"))
    check("no injury answer: it does not guess 'safe'", r["stop"] == "blocked" and "safe" in r["blocked_reason"].lower(), r["blocked_reason"])


def _photos():
    d = tempfile.mkdtemp(prefix="ins_ph_")
    out = []
    for i in (1, 2):
        pth = os.path.join(d, "damage-photo-%d.jpg" % i)
        open(pth, "wb").write(b"\xff\xd8\xff\xe0" + b"0" * 64 + b"\xff\xd9")
        out.append(pth)
    return out


def mail_scripts():
    print("mail scripts")
    for s in ("send-bestly-multi", "verify-sent", "fetch-attachments"):
        r = subprocess.run(["osacompile", "-o", os.path.join(tempfile.mkdtemp(), s + ".scpt"), os.path.join(TOOL, s + ".applescript")], capture_output=True, text=True)
        check(s + ".applescript compiles", r.returncode == 0, r.stderr)
    src = open(os.path.join(TOOL, "send-bestly-multi.applescript")).read()
    check("sends only as jared@bestly.tech with the Bestly signature", "Jared Best <jared@bestly.tech>" in src and 'signature "Bestly"' in src and "gmail" not in src.lower())


def main():
    rules_tests()
    mail_scripts()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        real_screens(p)
        scenarios(p)
    print("\n%s" % ("ALL PASSED" if not FAILS else "FAILED: " + "; ".join(FAILS)))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
