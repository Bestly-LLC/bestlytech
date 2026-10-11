"""Offline tests for RoofGuard Outreach. No network, no database, no AI.  Run:  python3 tools/roofguard-outreach/test_roofguard_outreach.py"""
import os
import re
import sys
import types
import unittest
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


class FakeLib(types.ModuleType):
    def __init__(self):
        super().__init__("lib")
        self.calls, self.state, self.mails = [], {}, []

    def rpc(self, name, **kw):
        self.calls.append((name, kw))
        if name == "rg_outreach_state":
            return self.state
        if name == "rg_outreach_mail_scan":
            return self.mails
        if name == "rg_outreach_event_add":
            return True
        if name == "rg_outreach_draft_add":
            return "draft-id"
        return None

    def notify(self, *a, **k):
        self.calls.append(("notify", dict(k, args=a)))

    def names(self):
        return [c[0] for c in self.calls]


FAKE = FakeLib()
sys.modules["lib"] = FAKE
import roofguard_outreach as R  # noqa: E402

R.freellm = None


def row(**kw):
    base = {"id": "L1", "company": "Acme Janitorial", "name_key": "acmejanitorial", "domain": "acmejan.com", "email": "pat@acmejan.com", "contact_name": "Pat Lee",
            "contact_title": "Owner", "city": "Springfield", "state": "MO", "track": "A", "fit_note": "Commercial cleaning for office buildings.", "status": "active",
            "loop_no": 1, "touches": 1, "next_due": "2026-10-10", "thread_subject": "worth knowing about your clients' roofs"}
    return base | kw


class Templates(unittest.TestCase):
    def all_bodies(self):
        out = []
        for tr in ("A", "B"):
            out.append(R.first_touch(tr, "Pat Lee", 'I noticed you clean schools across Springfield.'))
            out.append(R.first_touch(tr, "", 'I noticed you clean schools across Springfield.', loop=2))
            out.append(R.first_touch(tr, "", "", loop=3))
        out.append(R.follow_up("touch2", "worth knowing", "Pat"))
        out.append(R.follow_up("touch3", "worth knowing", ""))
        out.append(R.intro_email(row(), "Pat", True))
        out.append(R.summary_email(row(), "Pat", "x"))
        return out

    def test_no_replacement_anywhere(self):
        for s, b in self.all_bodies():
            self.assertNotRegex(s + b, r"(?i)replacement")

    def test_every_email_has_footer_and_passes_the_guard(self):
        for s, b in self.all_bodies():
            self.assertIn("733 N Kings Rd #205, Los Angeles, CA 90069", b)
            self.assertIn('Reply "STOP"', b)
            self.assertEqual(R.violations(s, b), [], s)

    def test_no_forbidden_claims(self):
        for s, b in self.all_bodies():
            self.assertNotRegex(b, r"(?i)\b(deadline|expires|act now|guarantee)\b")
            self.assertNotRegex(b, r"(?i)partner packet|attached")

    def test_greeting(self):
        self.assertEqual(R.greeting("Pat Lee"), "Hi Pat,")
        self.assertEqual(R.greeting(""), "Hello,")
        self.assertEqual(R.greeting("Dr. Sam Okafor"), "Hi Sam,")
        self.assertEqual(R.greeting("12345"), "Hello,")

    def test_loop2_opening_line_is_the_specified_one(self):
        _, b = R.first_touch("A", "Pat Lee", "", loop=2)
        self.assertIn("Circling back — I wrote you a couple months ago about your clients' roofs.", b)

    def test_intro_goes_to_eli_context(self):
        s, b = R.intro_email(row(), "Pat", True)
        self.assertIn("Eli Cooper", b)
        self.assertIn("Springfield, MO", b)
        self.assertIn("Pat runs Acme Janitorial", b)

    def test_summary_mentions_program_not_insurance(self):
        _, b = R.summary_email(row(), "Pat", "x")
        self.assertIn("2% residual", b)
        self.assertIn("not insurance", b)


class Guard(unittest.TestCase):
    def test_replacement_blocked(self):
        s, b = R.first_touch("A", "Pat", "I noticed you do roofing.")
        self.assertTrue(R.violations(s, b.replace("roof renewal", "roof replacement")))

    def test_missing_footer_blocked(self):
        self.assertTrue(R.violations("hi", "Hello there"))

    def test_fake_partner_and_deadline_blocked(self):
        s, b = R.first_touch("A", "Pat", "I noticed X.")
        self.assertTrue(R.violations(s, b + "\nOur existing partners love it."))
        self.assertTrue(R.violations(s, b + "\nThis offer expires Friday."))
        self.assertTrue(R.violations(s, b + "\nYou could earn $5,000 a month."))
        self.assertTrue(R.violations(s, b + "\nIt's insurance for your roof."))

    def test_queue_refuses_bad_draft_and_dry_writes_nothing(self):
        FAKE.calls.clear()
        with self.assertRaises(ValueError):
            R.queue(False, "L1", "first", "pat@acmejan.com", "hi", "no footer here")
        self.assertEqual(FAKE.calls, [])
        s, b = R.first_touch("A", "Pat", "I noticed X.")
        self.assertEqual(R.queue(True, "L1", "first", "pat@acmejan.com", s, b), "dry")
        self.assertEqual(FAKE.calls, [])


class Replies(unittest.TestCase):
    def test_footer_and_quote_do_not_trigger_optout(self):
        txt = "Sounds interesting, tell me more.\n\nOn Mon, Oct 5, 2026 Jared wrote:\n> Reply \"STOP\" and I'll remove you\n" + R.FOOTER
        self.assertEqual(R.classify("reply", "Re: x", txt)[0], "interested")

    def test_stop_is_optout(self):
        self.assertEqual(R.classify("reply", "Re: x", "STOP\n\n> original")[0], "opt_out")
        self.assertEqual(R.classify("reply", "Re: x", "Please remove me from your list.")[0], "opt_out")
        self.assertEqual(R.classify("reply", "Re: x", "Not interested, thanks.")[0], "opt_out")

    def test_bounce(self):
        self.assertEqual(R.classify("bounce", "Undeliverable", "x")[0], "bounce")

    def test_autoreply_ignored(self):
        self.assertEqual(R.classify("reply", "Automatic reply: Out of office", "I am out of the office until Monday.")[0], "auto")

    def test_send_me_something_is_summary(self):
        kind, send_me = R.classify("reply", "Re: x", "Sure, send me something.")
        self.assertEqual((kind, send_me), ("interested", True))

    def test_unclear_goes_to_review(self):
        self.assertEqual(R.classify("reply", "Re: x", "Who gave you my number?")[0], "review")

    def test_scrub_removes_addresses_and_numbers(self):
        s = R.scrub("Call me on 417-555-0123 or mail pat@acmejan.com")
        self.assertNotIn("417", s)
        self.assertNotIn("@", s)


class Research(unittest.TestCase):
    def test_emails_only_from_own_domain_never_guessed(self):
        raw = 'Contact <a href="mailto:pat@acmejan.com">pat@acmejan.com</a> or noreply@acmejan.com or someone@gmail.com or x@wix.com'
        self.assertEqual(R.emails_on_page(raw, "acmejan.com"), ["pat@acmejan.com"])
        self.assertEqual(R.emails_on_page("no address here", "acmejan.com"), [])

    def test_phones(self):
        self.assertEqual(R.phones_on_page("Call (417) 555-0123 today or 417.555.0199"), ["(417) 555-0123", "(417) 555-0199"])

    def test_pick_email_prefers_named_person(self):
        self.assertEqual(R.pick_email(["info@a.com", "pat@a.com"], "Pat Lee"), "pat@a.com")
        self.assertEqual(R.pick_email(["info@a.com", "jim@a.com"], ""), "jim@a.com")
        self.assertIsNone(R.pick_email([], "Pat"))

    def test_nationals_and_directories_skipped(self):
        self.assertTrue(R.skippable_url("https://www.yelp.com/biz/x"))
        self.assertTrue(R.skippable_url("https://www.abm.com/"))
        self.assertFalse(R.skippable_url("https://www.acmejan.com/"))
        self.assertTrue(R.is_national("We are a franchise of ServiceMaster Clean"))
        self.assertFalse(R.is_national("Family owned cleaning company in Springfield"))

    def test_hook_must_be_anchored_in_the_page(self):
        page = "We clean schools and clinics across Springfield since 1998."
        self.assertTrue(R.hook_ok("I noticed you clean schools across Springfield.", "clean schools and clinics across Springfield", page))
        self.assertFalse(R.hook_ok("I noticed you clean casinos in Reno.", "clean casinos in Reno", page))
        self.assertFalse(R.hook_ok("I saw you replaced the roof.", "We clean schools and clinics", page))

    def test_metros_rotate_and_stay_in_region(self):
        for d in range(0, 40):
            for m in R.metros_for(date.fromordinal(date(2026, 10, 1).toordinal() + d)):
                self.assertIn(m.split(", ")[1], R.CORE_STATES | R.EXPAND_STATES)


class MainFlow(unittest.TestCase):
    def setUp(self):
        FAKE.calls.clear()
        FAKE.mails = []
        FAKE.state = {"settings": {"enabled": True, "daily_first_touch_cap": 10, "pending_cap": 40}, "today": "2026-10-12", "first_today": 0,
                      "pending_ledger_ids": [], "ledger": [row()]}

    def drafts(self):
        return [c[1]["p"] for c in FAKE.calls if c[0] == "rg_outreach_draft_add"]

    def test_disabled_does_nothing(self):
        FAKE.state["settings"]["enabled"] = False
        self.assertIn("skip", R.main(["--no-research"]))
        self.assertEqual(self.drafts(), [])

    def test_due_touch2_is_drafted_never_sent(self):
        out = R.main(["--no-research"])
        d = self.drafts()
        self.assertEqual([x["kind"] for x in d], ["touch2"])
        self.assertEqual(d[0]["to_email"], "pat@acmejan.com")
        self.assertTrue(d[0]["subject"].startswith("re: "))
        self.assertIn("nothing sent", out)
        self.assertFalse(any("send" in n and "draft" not in n for n in FAKE.names()))

    def test_touch3_after_touch2_and_nothing_if_not_due(self):
        FAKE.state["ledger"] = [row(touches=2)]
        R.main(["--no-research"])
        self.assertEqual([x["kind"] for x in self.drafts()], ["touch3"])
        FAKE.calls.clear()
        FAKE.state["ledger"] = [row(next_due="2026-10-20")]
        R.main(["--no-research"])
        self.assertEqual(self.drafts(), [])

    def test_resting_goes_to_loop2(self):
        FAKE.state["ledger"] = [row(status="resting", touches=3, loop_no=1)]
        R.main(["--no-research"])
        d = self.drafts()
        self.assertEqual([x["kind"] for x in d], ["loop2"])
        self.assertIn("Circling back", d[0]["body"])

    def test_phone_only_optout_and_noemail_never_drafted(self):
        FAKE.state["ledger"] = [row(status="phone_only"), row(id="L2", status="opted_out"), row(id="L3", email=None), row(id="L4", status="bounced")]
        R.main(["--no-research"])
        self.assertEqual(self.drafts(), [])

    def test_waiting_draft_blocks_another(self):
        FAKE.state["pending_ledger_ids"] = ["L1"]
        R.main(["--no-research"])
        self.assertEqual(self.drafts(), [])

    def test_optout_reply_suppresses_and_stops_followup(self):
        FAKE.mails = [{"mail_id": "m1", "ledger_id": "L1", "hint": "reply", "from_addr": "pat@acmejan.com", "subject": "Re: x", "text": "STOP"}]
        R.main(["--no-research"])
        st = [c for c in FAKE.calls if c[0] == "rg_outreach_ledger_status"]
        self.assertEqual(st[0][1]["p_status"], "opted_out")

    def test_interested_reply_drafts_intro_with_eli_cc_and_pushes(self):
        FAKE.state["ledger"] = [row(next_due=None)]
        FAKE.mails = [{"mail_id": "m2", "ledger_id": "L1", "hint": "reply", "from_addr": "pat@acmejan.com", "subject": "Re: x", "text": "Interested, tell me more."}]
        R.main(["--no-research"])
        d = self.drafts()
        self.assertIn(d[0]["kind"], ("intro", "summary_reply"))
        n = [c for c in FAKE.calls if c[0] == "notify"]
        self.assertTrue(n and n[0][1]["push"] is True and "wrote back" in n[0][1]["args"][0])

    def test_dry_writes_nothing(self):
        FAKE.mails = [{"mail_id": "m3", "ledger_id": "L1", "hint": "reply", "from_addr": "pat@acmejan.com", "subject": "Re: x", "text": "STOP"}]
        R.main(["--dry", "--no-research"])
        self.assertEqual([n for n in FAKE.names() if n not in ("rg_outreach_state", "rg_outreach_mail_scan")], [])

    def test_quiet_summary_has_no_interrupt_words(self):
        R.main(["--no-research"])
        n = [c for c in FAKE.calls if c[0] == "notify"][0][1]
        blob = (n["args"][0] + " " + n["args"][1]).lower()
        self.assertFalse(re.search(r"\$\d|payment|deposit|invoice|refund|charged|payout|wrote back|replied to you|ready for your ok|waiting on you|new lead|wants to meet", blob))
        self.assertFalse(n["push"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
