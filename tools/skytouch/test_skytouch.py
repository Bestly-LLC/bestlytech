"""Offline tests for the SkyTouch Pi jobs. No network, no Gmail, nothing is ever sent.  Run:  python3 tools/skytouch/test_skytouch.py"""
import os
import sys
import types
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
# Mimic the Pi layout: a package called "jobs" holding the modules, plus a fake "lib" that records every call.
jobs = types.ModuleType("jobs")
jobs.__path__ = [HERE]
sys.modules["jobs"] = jobs
sys.modules["lib"] = types.ModuleType("lib")  # the Pi framework module; each test swaps in a recording fake


class FakeLib:
    def __init__(self, gate, secrets=None):
        self.calls, self._gate, self.secrets = [], gate, secrets or {}

    def rpc(self, name, **kw):
        self.calls.append((name, kw))
        if name == "skytouch_gate":
            return self._gate
        if name == "pi_secret_get":
            return self.secrets.get(kw["p_name"], "")
        if name == "skytouch_intake_claim":
            return True
        return None

    def get(self, *a, **k):
        return []

    def notify(self, *a, **k):
        self.calls.append(("notify", k))

    def names(self):
        return [c[0] for c in self.calls]


from jobs import skytouch_common as C  # noqa: E402
from jobs import skytouch_ical as I  # noqa: E402

GATE_OFF = {"master": False, "job_on": False, "auto_first_reply": False, "morning_text_jared": False, "stale_hours": 24}


class Classify(unittest.TestCase):
    def k(self, *texts, out=False):
        return C.classify(list(texts), out, "Geoff")["kind"]

    def test_plain_inquiry_is_the_only_intake(self):
        self.assertEqual(self.k("Hey are you available for a massage?"), "intake")
        self.assertEqual(self.k("Hi, how much for a massage"), "intake")

    def test_named_service_or_time_waits_for_jared(self):
        self.assertEqual(self.k("Can I book deep tissue tomorrow at 3pm"), "needs_approval")
        self.assertEqual(self.k("therapeutic 90 please"), "needs_approval")
        self.assertEqual(self.k("anything open tonight?"), "needs_approval")

    def test_hard_stops_send_nothing(self):
        self.assertEqual(self.k("do you do happy endings"), "flagged")
        self.assertEqual(self.k("what's the address"), "flagged")
        self.assertEqual(self.k("can you do it for $80"), "flagged")
        self.assertEqual(self.k("what's included in the sensual one"), "flagged")
        self.assertEqual(self.k("Hi I'm looking for a roofer for my property, leak in the roof"), "flagged")
        self.assertEqual(self.k("wrong number sorry"), "flagged")
        self.assertEqual(self.k(""), "flagged")

    def test_already_replied_stays_with_jared(self):
        self.assertEqual(self.k("hey are you available for a massage", out=True), "flagged")

    def test_suggested_reply_uses_fixed_rates(self):
        r = C.classify(["deep tissue 90 tomorrow 3pm"], False, "Geoff")["suggested_reply"]
        self.assertIn("$180 for 90 minutes", r)
        self.assertNotIn("address", r.lower())
        r2 = C.classify(["sensual 60 tonight"], False, "")["suggested_reply"]
        self.assertIn("$250", r2)

    def test_intake_text_never_has_address_or_price(self):
        for bad in ("$", "address", "street"):
            self.assertNotIn(bad, C.INTAKE_TEXT.lower())


class Numbers(unittest.TestCase):
    def test_jared_is_never_a_client(self):
        self.assertTrue(C.is_jared("18165007236"))
        self.assertTrue(C.is_jared("(816) 500-7236"))
        self.assertFalse(C.is_jared("13105550123"))
        addr = "14242349256.18165007236.AbCd@txt.voice.google.com"
        self.assertEqual(C.sender_number(addr), "18165007236")
        self.assertTrue(C.is_jared(C.sender_number(addr)))

    def test_first_name(self):
        self.assertEqual(C.first_name("Geoff Smith (SMS)"), "Geoff")
        self.assertEqual(C.first_name("(310) 555-0123"), "")


class Hours(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(C.parse_hours("2-6pm"), [(14 * 60, 18 * 60)])
        self.assertEqual(C.parse_hours("10-2pm"), [(10 * 60, 14 * 60)])
        self.assertEqual(C.parse_hours("9am to 12pm and 3-7pm"), [(540, 720), (900, 1140)])
        self.assertEqual(C.parse_hours("none"), "none")
        self.assertIsNone(C.parse_hours("hmm"))

    def test_fits(self):
        self.assertTrue(C.fits("2-6pm", "3pm"))
        self.assertFalse(C.fits("2-6pm", "8pm"))
        self.assertFalse(C.fits("none", "3pm"))
        self.assertIsNone(C.fits("2-6pm", "tomorrow"))

    def test_approval_detector(self):
        self.assertTrue(C.looks_like_approval("yes tell Geoff 3pm works"))
        self.assertFalse(C.looks_like_approval("2-6pm"))


class Safety(unittest.TestCase):
    def setUp(self):
        self.sent = []
        C._send = lambda *a, **k: self.sent.append(a)

    def msg(self, addr):
        return {"from_addr": addr, "subject": "SMS from X", "message_id": "<1@x>", "references": ""}

    def test_intake_refuses_jared_and_non_google_voice(self):
        with self.assertRaises(RuntimeError):
            C.send_first_intake("pw", self.msg("14242349256.18165007236.Ab@txt.voice.google.com"), "")
        with self.assertRaises(RuntimeError):
            C.send_first_intake("pw", self.msg("someone@gmail.com"), "")
        self.assertEqual(self.sent, [])

    def test_intake_sends_fixed_text_to_a_client(self):
        C.send_first_intake("pw", self.msg("14242349256.13105550123.Ab@txt.voice.google.com"), "Geoff")
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0][3], C.INTAKE_TEXT.format(name=" Geoff"))

    def test_availability_ask_refuses_a_client(self):
        with self.assertRaises(RuntimeError):
            C.send_availability_ask("pw", self.msg("14242349256.13105550123.Ab@txt.voice.google.com"))
        self.assertEqual(self.sent, [])


class Calendar(unittest.TestCase):
    ICS = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=America/Los_Angeles:20261012T140000\r\n"
           "DTEND;TZID=America/Los_Angeles:20261012T153000\r\nSUMMARY:Geoff 90 deep tissue\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nUID:b\r\nDTSTART;TZID=America/Los_Angeles:20261005T090000\r\nDTEND;TZID=America/Los_Angeles:20261005T100000\r\n"
           "RRULE:FREQ=WEEKLY;BYDAY=MO\r\nEXDATE;TZID=America/Los_Angeles:20261019T090000\r\nSUMMARY:Gym\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nUID:c\r\nDTSTART;VALUE=DATE:20261013\r\nDTEND;VALUE=DATE:20261014\r\nSUMMARY:Day off\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nUID:d\r\nDTSTART:20261012T200000Z\r\nDTEND:20261012T210000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled\r\nEND:VEVENT\r\n"
           "END:VCALENDAR\r\n")

    def test_window(self):
        lo = datetime(2026, 10, 11, tzinfo=I.TZ)
        ev = I.events_between([self.ICS], lo, lo + timedelta(days=14))
        names = [(e["summary"], e["start"].strftime("%m-%d %H:%M")) for e in ev]
        self.assertIn(("Geoff 90 deep tissue", "10-12 14:00"), names)
        self.assertIn(("Gym", "10-12 09:00"), names)
        self.assertNotIn(("Gym", "10-19 09:00"), names)   # EXDATE
        self.assertIn(("Day off", "10-13 00:00"), names)
        self.assertFalse([n for n in names if n[0] == "Cancelled"])


class JobRuns(unittest.TestCase):
    """The jobs against a fake database and a fake Gmail: what is written and what is sent."""

    def setUp(self):
        self.sent = []
        C._send = lambda *a, **k: self.sent.append(a)

    def run_job(self, name, lib, argv=()):
        mod = __import__("jobs." + name, fromlist=["main"])
        mod.lib = lib
        return mod.main(list(argv))

    def test_paused_only_beats(self):
        for name, slug in (("skytouch_triage", "skytouch-triage"), ("skytouch_morning", "skytouch-morning")):
            lib = FakeLib(GATE_OFF)
            out = self.run_job(name, lib)
            self.assertTrue(out.startswith("skip: paused"), out)
            self.assertEqual(lib.names(), ["skytouch_gate", "agent_beat"])
            self.assertIn("paused", lib.calls[1][1]["p_summary"])
            self.assertEqual(lib.calls[1][1]["p_slug"], slug)
        self.assertEqual(self.sent, [])

    def test_on_but_gmail_not_connected(self):
        lib = FakeLib(dict(GATE_OFF, master=True, job_on=True))
        out = self.run_job("skytouch_triage", lib)
        self.assertEqual(out[:34], "skip: Gmail not connected yet (sav")
        self.assertNotIn("skytouch_card_save", lib.names())
        self.assertEqual(self.sent, [])

    def _fake_gmail(self, threads):
        """threads: {thrid: [msg dicts]}; installs a fake C.Gmail."""
        outer = self

        class G:
            labelled = []

            def __init__(s, pw, readonly=True):
                s.readonly = readonly

            def search(s, raw):
                if "newer_than:3d" in raw:
                    return []
                return [m["uid"] for ms in threads.values() for m in ms][:1] and [ms[0]["uid"] for ms in threads.values()]

            def thread_uids(s, thrid):
                return [m["uid"] for m in threads[thrid]]

            def fetch(s, uid):
                for ms in threads.values():
                    for m in ms:
                        if m["uid"] == uid:
                            return m

            def label(s, uids, label):
                G.labelled.append((tuple(uids), label))

            def close(s):
                pass
        C.Gmail = G
        return G

    def mk(self, uid, thrid, number, text, hours_ago=1.0, labels=""):
        return {"uid": uid, "thrid": thrid, "labels": labels, "from_addr": "14242349256.{}.Tok@txt.voice.google.com".format(number),
                "from_name": "Geoff Smith (SMS)", "subject": "SMS from Geoff", "date": datetime.now(C.TZ) - timedelta(hours=hours_ago),
                "message_id": "<" + uid + "@x>", "references": "", "text": text}

    def threads(self):
        return {
            "t1": [self.mk("1", "t1", "13105550001", "Hey are you available for a massage?")],
            "t2": [self.mk("2", "t2", "13105550002", "Can I book deep tissue 90 tomorrow at 3pm")],
            "t3": [self.mk("3", "t3", "13105550003", "what is the address")],
            "t4": [self.mk("4", "t4", "13105550004", "hi, any availability?", hours_ago=40)],
        }

    def test_auto_reply_off_sends_nothing(self):
        G = self._fake_gmail(self.threads())
        lib = FakeLib(dict(GATE_OFF, master=True, job_on=True), {"pi:skytouch:gmail_app_password": "abcdabcdabcdabcd"})
        out = self.run_job("skytouch_triage", lib)
        self.assertEqual(self.sent, [], "nothing may be sent while auto_first_reply is off")
        self.assertNotIn("skytouch_intake_claim", lib.names())
        kinds = sorted(c[1]["p"]["kind"] for c in lib.calls if c[0] == "skytouch_card_save")
        self.assertEqual(kinds, ["flagged", "intake_draft", "needs_approval", "stale"])
        self.assertEqual({lbl for _, lbl in G.labelled}, {C.LABEL_FLAGGED, C.LABEL_HANDLED} - {C.LABEL_HANDLED})  # only Flagged; no Handled without a send
        self.assertIn("1 intake drafted", out)
        self.assertEqual(lib.names()[-1], "agent_beat")

    def test_auto_reply_on_sends_exactly_one_hello(self):
        self._fake_gmail(self.threads())
        lib = FakeLib(dict(GATE_OFF, master=True, job_on=True, auto_first_reply=True), {"pi:skytouch:gmail_app_password": "abcdabcdabcdabcd"})
        out = self.run_job("skytouch_triage", lib)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0][1], "14242349256.13105550001.Tok@txt.voice.google.com")
        self.assertIn("1 intake sent", out)

    def test_morning_gap_card_and_no_text_when_off(self):
        t = {"g1": [self.mk("7", "g1", "13105550007", "Deep tissue 90 tomorrow 2pm, see you then")]}
        self._fake_gmail(t)
        from jobs import skytouch_ical as ICAL
        ICAL.fetch = lambda url, timeout=30: Calendar.ICS.replace("20261012", datetime.now(C.TZ).strftime("%Y%m%d")).replace("Geoff", "Someone Else")
        lib = FakeLib(dict(GATE_OFF, master=True, job_on=True),
                      {"pi:skytouch:gmail_app_password": "abcdabcdabcdabcd", "pi:skytouch:calendar_urls": "https://calendar.google.com/x/basic.ics"})
        out = self.run_job("skytouch_morning", lib)
        self.assertEqual(self.sent, [], "morning text is off, so nothing may be sent")
        gaps = [c[1]["p"] for c in lib.calls if c[0] == "skytouch_card_save"]
        self.assertEqual([g["kind"] for g in gaps], ["calendar_gap"])
        self.assertIn("1 booking gaps", out)
        brief = [c[1]["p"]["brief"] for c in lib.calls if c[0] == "skytouch_state_save"][0]
        self.assertEqual(brief["calendar"], "ok")
        self.assertEqual(len(brief["days"]), 7)

    def test_dry_run_writes_nothing(self):
        G = self._fake_gmail(self.threads())
        lib = FakeLib(dict(GATE_OFF, master=True, job_on=True, auto_first_reply=True), {"pi:skytouch:gmail_app_password": "abcdabcdabcdabcd"})
        out = self.run_job("skytouch_triage", lib, ["--dry"])
        self.assertEqual(self.sent, [])
        self.assertEqual(G.labelled, [])
        self.assertTrue(out.startswith("ok (dry run"))
        self.assertEqual(lib.names(), ["skytouch_gate", "pi_secret_get"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
