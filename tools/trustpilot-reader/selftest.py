#!/usr/bin/env python3
"""Unit tests for trustpilot_parse. Run: python3 selftest.py  (stdlib only, no network)."""
import glob
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import trustpilot_parse as P  # noqa: E402


def load(path):
    with open(path, encoding="utf-8") as fh:
        head, _, body = fh.read().partition("\n---\n")
    meta = {}
    for ln in head.split("\n"):
        k, _, v = ln.partition(":")
        if k in ("FROM", "SUBJECT", "EXPECT"):
            meta[k] = v.strip()
    return meta, body


def expected(expect):
    kv = dict(re.findall(r'(\w+)=("[^"]*"|\S+)', expect))
    return {k: (None if v == "None" else v.strip('"')) for k, v in kv.items()}


class Fixtures(unittest.TestCase):
    def test_every_fixture(self):
        files = sorted(glob.glob(os.path.join(HERE, "fixtures", "*.txt")))
        self.assertGreaterEqual(len(files), 8)
        for f in files:
            meta, body = load(f)
            name = os.path.basename(f)
            exp = meta["EXPECT"]
            if exp == "NotReview":
                with self.assertRaises(P.NotReview, msg=name):
                    P.parse_review(meta["SUBJECT"], meta["FROM"], body)
            elif exp == "Unparseable":
                with self.assertRaises(P.Unparseable, msg=name):
                    P.parse_review(meta["SUBJECT"], meta["FROM"], body)
            else:
                r = P.parse_review(meta["SUBJECT"], meta["FROM"], body)
                e = expected(exp)
                self.assertEqual(str(r["stars"]), e["stars"], name)
                if "title" in e:
                    self.assertEqual(r["title"], e["title"], name)
                if "snippet" in e:
                    self.assertEqual(r["snippet"], e["snippet"], name)
                if "name" in e:
                    self.assertEqual(r["reviewer_first_name"], e["name"], name)


class Details(unittest.TestCase):
    def test_full_snippet_kept_whole(self):
        meta, body = load(os.path.join(HERE, "fixtures", "a_review_labelled_free.txt"))
        r = P.parse_review(meta["SUBJECT"], meta["FROM"], body)
        self.assertTrue(r["snippet"].endswith("same day."))
        self.assertNotIn("...", r["snippet"])
        self.assertNotIn("http", r["snippet"])

    def test_multiline_labelled_review_joined(self):
        meta, body = load(os.path.join(HERE, "fixtures", "b_review_glyphs_labels.txt"))
        r = P.parse_review(meta["SUBJECT"], meta["FROM"], body)
        self.assertIn("support fixed my question fast.", r["snippet"])

    def test_long_snippet_cut_at_sentence_no_ellipsis(self):
        long = " ".join(["This is a sentence about the product."] * 80)
        r = P.parse_review("New 5-star review from Dana", "x@trustpilot.com", "Rated 5 out of 5 stars\nGreat\n" + long)
        self.assertLessEqual(len(r["snippet"]), P.MAX_SNIPPET)
        self.assertTrue(r["snippet"].endswith("."))
        self.assertNotIn("...", r["snippet"])

    def test_never_guesses_stars(self):
        with self.assertRaises(P.Unparseable):
            P.parse_review("You have a new review", "noreply@trustpilot.com", "Someone left a review.\nIt was nice.")

    def test_sender_must_be_trustpilot(self):
        for bad in ("a@trustpilot.com.evil.io", "a@nottrustpilot.com", "", None, "trustpilot.com@evil.io"):
            self.assertFalse(P.is_trustpilot_sender(bad), bad)
        for ok in ("noreply@trustpilot.com", "x@mail.trustpilot.com", "NoReply.Notifications@Trustpilot.com"):
            self.assertTrue(P.is_trustpilot_sender(ok), ok)

    def test_ai_extraction_must_be_verbatim(self):
        body = "Rated 4 out of 5 stars\nSolid\nWorks well and is private."
        ok = P.verify_ai_extraction({"stars": 4, "title": "Solid", "snippet": "Works well and is private.",
                                     "reviewer_first_name": None}, "New review", body)
        self.assertEqual(ok["stars"], 4)
        with self.assertRaises(P.Unparseable):
            P.verify_ai_extraction({"stars": 5, "title": "Invented praise", "snippet": None}, "New review", body)
        with self.assertRaises(P.Unparseable):
            P.verify_ai_extraction({"stars": 9, "title": "Solid"}, "New review", body)
        with self.assertRaises(P.Unparseable):
            P.verify_ai_extraction("nope", "New review", body)

    def test_alert_text_whole_words_signed_maya(self):
        t = P.alert_text({"stars": 5, "title": "Fast, private, worth it", "snippet": "x", "reviewer_first_name": "Dana"})
        self.assertEqual(t, "Maya: new 5-star Trustpilot review from Dana — “Fast, private, worth it”")
        long = P.alert_text({"stars": 4, "title": "word " * 60, "snippet": None, "reviewer_first_name": None})
        self.assertTrue(long.startswith("Maya: new 4-star Trustpilot review from a customer"))
        self.assertNotIn("...", long)
        self.assertNotIn("…", long)


GOOD_HDR = ("Message-ID: <%s>\r\nFrom: Trustpilot <noreply.notifications@trustpilot.com>\r\n"
            "Authentication-Results: mx.example; dkim=pass header.d=trustpilot.com header.s=s1; dmarc=pass (policy=reject) "
            "header.from=trustpilot.com; spf=pass\r\n\r\n")
FORGED_HDR = ("Message-ID: <%s>\r\nFrom: Trustpilot <noreply.notifications@trustpilot.com>\r\n"
              "Authentication-Results: mx.example; dkim=fail header.d=trustpilot.com; dmarc=fail; spf=fail\r\n\r\n")
OTHER_DOMAIN_HDR = ("Message-ID: <%s>\r\nFrom: Trustpilot <noreply.notifications@trustpilot.com>\r\n"
                    "Authentication-Results: mx.example; dkim=pass header.d=evil.example; dmarc=pass\r\n\r\n")


class JobFlow(unittest.TestCase):
    """The whole job with Supabase and IMAP faked: dedupe, sender check, AI verbatim rule, flag-once."""

    def setUp(self):
        import types
        self.calls = []
        self.mail = []
        self.known = []
        fake = types.ModuleType("lib")
        fake.get = self._get
        fake.rpc = self._rpc
        sys.modules["lib"] = fake
        os.environ["TRUSTPILOT_STATE"] = os.path.join(HERE, ".selftest_state.json")
        if os.path.exists(os.environ["TRUSTPILOT_STATE"]):
            os.remove(os.environ["TRUSTPILOT_STATE"])
        import importlib
        import trustpilot_reviews as J
        self.J = importlib.reload(J)
        self.hdrs = {}

        class FakeImap:
            def headers_for(inner, mid, hint=None):
                return self.hdrs.get(mid)

            def close(inner):
                pass
        self.J.Imap = FakeImap
        self.J.ai_extract = lambda subject, body: (self.ai_obj, "fake-ai")
        self.ai_obj = None

    def tearDown(self):
        p = os.environ["TRUSTPILOT_STATE"]
        if os.path.exists(p):
            os.remove(p)

    def _get(self, table, q):
        if table == "bestly_mail_state":
            from datetime import datetime, timezone
            return [{"last_run_at": datetime.now(timezone.utc).isoformat(), "last_error": None}]
        if table == "bestly_mail":
            return self.mail
        if table == "trustpilot_reviews":
            return [{"msg_id": m} for m in self.known]
        raise AssertionError(table)

    def _rpc(self, name, **kw):
        self.calls.append((name, kw))
        return True if name == "trustpilot_ingest_review" else None

    def _row(self, mid, fixture, **over):
        meta, body = load(os.path.join(HERE, "fixtures", fixture))
        row = {"message_id": mid, "folder": "INBOX", "from_addr": meta["FROM"], "subject": meta["SUBJECT"],
               "sent_at": "2026-10-18T20:00:00+00:00", "body_text": body}
        row.update(over)
        self.mail.append(row)

    def test_good_review_filed_once_with_alert(self):
        self._row("<r1@t>", "a_review_labelled_free.txt")
        self.hdrs["<r1@t>"] = GOOD_HDR % "r1@t"
        out = self.J.main([])
        self.assertTrue(out.startswith("1 new review filed"), out)
        name, kw = self.calls[0]
        self.assertEqual(name, "trustpilot_ingest_review")
        self.assertEqual((kw["p_stars"], kw["p_name"], kw["p_msg_id"]), (5, "Dana", "<r1@t>"))
        self.assertTrue(kw["p_alert"].startswith("Maya: new 5-star Trustpilot review from Dana"))
        self.calls.clear()
        self.known.append("<r1@t>")  # second cycle: already filed
        self.assertTrue(self.J.main([]).startswith("ok 0 new reviews"))
        self.assertEqual(self.calls, [])

    def test_non_review_and_welcome_ignored(self):
        self._row("<n1@t>", "g_nonreview_own_review_blocked.txt")
        self._row("<n2@t>", "h_nonreview_welcome.txt")
        self.assertIn("0 new reviews filed, 2 mails seen, 2 not reviews", self.J.main([]))
        self.assertEqual(self.calls, [])

    def test_forged_or_wrong_domain_never_filed_and_flagged_once(self):
        for mid, hdr in (("<f1@t>", FORGED_HDR), ("<f2@t>", OTHER_DOMAIN_HDR)):
            self._row(mid, "a_review_labelled_free.txt")
            self.hdrs[mid] = hdr % mid[1:-1]
        with self.assertRaises(RuntimeError):
            self.J.main([])
        names = [c[0] for c in self.calls]
        self.assertNotIn("trustpilot_ingest_review", names)
        self.assertEqual(names.count("trustpilot_reader_flag"), 2)
        self.calls.clear()
        self.assertIn("2 failed the sender check", self.J.main([]))  # second cycle: quiet, no new flags
        self.assertEqual(self.calls, [])

    def test_unverifiable_message_waits_not_filed(self):
        self._row("<w1@t>", "a_review_labelled_free.txt")
        out = self.J.main([])
        self.assertIn("1 waiting for a sender check", out)
        self.assertEqual(self.calls, [])

    def test_ai_fallback_only_if_verbatim(self):
        self._row("<u1@t>", "e_review_no_star_info.txt")
        self.hdrs["<u1@t>"] = GOOD_HDR % "u1@t"
        self.ai_obj = {"stars": 5, "title": "Totally invented", "snippet": None}
        with self.assertRaises(RuntimeError):
            self.J.main([])
        self.assertNotIn("trustpilot_ingest_review", [c[0] for c in self.calls])

    def test_ai_fallback_accepts_verbatim(self):
        self._row("<u2@t>", "e_review_no_star_info.txt")
        self.hdrs["<u2@t>"] = GOOD_HDR % "u2@t"
        self.mail[-1]["body_text"] = "Priya gave bestly.tech four stars.\nGreat tool\nPrivate and quick.\nReply [https://x]"
        self.mail[-1]["subject"] = "You have a new review"
        self.ai_obj = {"stars": 4, "title": "Great tool", "snippet": "Private and quick.", "reviewer_first_name": "Priya"}
        self.assertTrue(self.J.main([]).startswith("1 new review filed"))

    def test_ai_stars_without_evidence_rejected(self):
        self._row("<u4@t>", "e_review_no_star_info.txt")
        self.hdrs["<u4@t>"] = GOOD_HDR % "u4@t"
        self.ai_obj = {"stars": 5, "title": None, "snippet": "Read it on Trustpilot.", "reviewer_first_name": None}
        with self.assertRaises(RuntimeError):
            self.J.main([])
        self.assertNotIn("trustpilot_ingest_review", [c[0] for c in self.calls])

    def test_no_ai_flag_reads_nothing(self):
        self._row("<u3@t>", "e_review_no_star_info.txt")
        self.hdrs["<u3@t>"] = GOOD_HDR % "u3@t"
        with self.assertRaises(RuntimeError):
            self.J.main(["--no-ai"])

    def test_dry_run_writes_nothing(self):
        self._row("<d1@t>", "d_review_one_star_money_words.txt")
        self.hdrs["<d1@t>"] = GOOD_HDR % "d1@t"
        self.assertTrue(self.J.main(["--dry"]).startswith("1 new review filed"))
        self.assertEqual(self.calls, [])

    def test_check_auth_pure(self):
        ok, _ = self.J.check_auth(GOOD_HDR % "x@t", "<x@t>")
        self.assertTrue(ok)
        self.assertFalse(self.J.check_auth(GOOD_HDR % "x@t", "<y@t>")[0])
        self.assertFalse(self.J.check_auth("Message-ID: <x@t>\r\nFrom: a@trustpilot.com\r\n\r\n", "<x@t>")[0])
        spoof_from = (GOOD_HDR % "x@t").replace("noreply.notifications@trustpilot.com", "x@evil.io")
        self.assertFalse(self.J.check_auth(spoof_from, "<x@t>")[0])


if __name__ == "__main__":
    unittest.main(verbosity=1)
