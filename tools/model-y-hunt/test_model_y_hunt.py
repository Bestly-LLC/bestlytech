"""Offline tests for the Model Y Hunter. No network, no database, no AI.  Run:  python3 tools/model-y-hunt/test_model_y_hunt.py"""
import json
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


class FakeLib(types.ModuleType):
    def __init__(self):
        super().__init__("lib")
        self.calls, self.seen, self.settings = [], [], {"enabled": True, "max_price": 30000, "radius_mi": 100}

    def rpc(self, name, **kw):
        self.calls.append((name, kw))
        if name == "model_y_settings_get":
            return self.settings
        if name == "model_y_seen_list":
            return self.seen
        if name == "model_y_seen_save":
            return {"new": True}
        return None

    def notify(self, *a, **k):
        self.calls.append(("notify", dict(k, args=a)))

    def names(self):
        return [c[0] for c in self.calls]


FAKE = FakeLib()
sys.modules["lib"] = FAKE
import model_y_hunt as M  # noqa: E402

M.freellm = None  # rules only: the tests never call an AI
CFG = {"enabled": True, "max_price": 30000, "radius_mi": 100}


def L(**kw):
    base = {"year": 2024, "price": 27500, "miles": 41000, "city": "Pasadena", "state": "CA", "lat": None, "lon": None, "title": "2024 Tesla Model Y Long Range",
            "text": "Clean title. Full Self-Driving purchased, transferable? No. Paid $12,000 for FSD.", "software": "", "hardware": "", "vin": "7SAYGDEE1RF000001"}
    base.update(kw)
    return base


class Parsers(unittest.TestCase):
    def test_fme_detail_fixture(self):
        h = open(os.path.join(HERE, "fixtures", "fme_detail.html")).read() + "</div>"
        p = M.fme_parse(h)
        self.assertEqual((p["year"], p["price"], p["miles"], p["vin"]), (2023, 33000, 29500, "7SAYGDEE1PF712235"))
        self.assertEqual(p["software"], "Base Autopilot (AP)")
        self.assertIn("All Glass Roof", p["features"])
        self.assertIn("new tires", p["desc"])
        self.assertFalse(p["sold"])

    def test_craigslist_rows_decode(self):
        d = json.load(open(os.path.join(HERE, "fixtures", "cl_search.json")))["data"]
        rows = M.cl_items(d)
        self.assertGreaterEqual(len(rows), 3)
        r = rows[0]
        self.assertEqual(r["id"], str(d["decode"]["minPostingId"] + d["items"][0][0]))
        self.assertTrue(r["url"].startswith("https://losangeles.craigslist.org/"))
        self.assertTrue(r["url"].endswith("/%s.html" % r["id"]))
        self.assertEqual(r["price"], 29183)
        self.assertEqual(r["miles"], 71767)
        self.assertAlmostEqual(r["lat"], 34.0808, 3)

    def test_craigslist_detail(self):
        h = ('<span id="titletextonly">2024 Tesla Model Y</span><span class="valu year">2024</span>'
             '<div class="attr auto_vin"><span class="labl">VIN:</span> <span class="valu">7SAYGDEE1RF000001</span></div>'
             '<div class="attr auto_miles"><span class="labl">odometer:</span> <span class="valu">41,200</span></div>'
             '<section id="postingbody"><div class="print-qrcode-container">QR Code Link to This Post</div> FSD included, HW4.</section>')
        d = M.cl_detail_parse(h)
        self.assertEqual((d["vin"], d["miles"], d["year"]), ("7SAYGDEE1RF000001", 41200, 2024))
        self.assertIn("FSD included", d["text"])
        self.assertNotIn("QR Code", d["text"])


class FsdWords(unittest.TestCase):
    def s(self, t):
        return M.fsd_from_text(t)[0]

    def test_rejects_everything_that_is_not_a_purchase(self):
        for t in ("FSD subscription active", "comes with a free FSD trial", "FSD capable hardware", "FSD ready, buy it from Tesla",
                  "no FSD", "does not have FSD", "FSD is not included", 
                  "FSD for $99/mo"):
            self.assertEqual(self.s(t), "rejected", t)

    def test_claims(self):
        self.assertEqual(M.fsd_from_text("FSD purchased")[:2], ("claimed", True))
        self.assertEqual(M.fsd_from_text("Full Self-Driving paid in full")[:2], ("claimed", True))
        self.assertEqual(M.fsd_from_text("Has FSD, great car")[:2], ("claimed", False))
        self.assertEqual(self.s("Nice car, low miles"), "none")
        self.assertEqual(self.s("Enhanced Autopilot only"), "none")  # no FSD word at all: the grader then says "no FSD claim"
        self.assertEqual(self.s("HW4 hardware, FSD purchased"), "claimed")  # the word hardware alone is not a negative

    def test_hw4_text(self):
        self.assertTrue(M.hw4_from_text("It has HW4 and the new cameras"))
        self.assertTrue(M.hw4_from_text("AI4 computer"))
        self.assertFalse(M.hw4_from_text("HW3 car"))
        self.assertFalse(M.hw4_from_text("nothing about it"))


class Distance(unittest.TestCase):
    def test_straight_line(self):
        self.assertLess(abs(M.haversine_mi(M.HOME, M.CITIES["irvine"]) - 40), 6)
        self.assertGreater(M.haversine_mi(M.HOME, M.CITIES["san diego"]), 100)
        self.assertGreater(M.haversine_mi(M.HOME, M.CITIES["las vegas"]), 200)

    def test_unknown_city_without_network_is_none(self):
        self.assertIsNone(M.city_point("Nowhereville", "CA", allow_net=False))
        self.assertEqual(M.city_point("Pasadena", "California"), M.CITIES["pasadena"])


class Grading(unittest.TestCase):
    def g(self, **kw):
        v, why, extra = M.grade(L(**kw), CFG)
        return v, why, extra

    def test_good_listing_is_confirmed(self):
        v, why, e = self.g()
        self.assertEqual(v, "match", why)
        self.assertEqual(e["fsd_grade"], "CONFIRMED")
        self.assertIn("2024", e["hw4_evidence"])
        self.assertLess(e["distance_mi"], 30)

    def test_claim_without_purchase_words_is_likely(self):
        v, why, e = self.g(text="Tesla with FSD, super clean.")
        self.assertEqual((v, e["fsd_grade"]), ("match", "LIKELY"))

    def test_hard_rejects(self):
        self.assertEqual(self.g(price=30001)[0], "rejected")
        self.assertEqual(self.g(year=2022)[0], "rejected")
        self.assertEqual(self.g(year=2023)[0], "rejected")  # 2023 with no HW4 words
        self.assertEqual(self.g(city="San Diego")[0], "rejected")
        self.assertEqual(self.g(text="Subscription FSD on this one")[0], "rejected")
        self.assertEqual(self.g(text="Nice clean Model Y")[0], "rejected")
        self.assertEqual(self.g(price=None)[0], "rejected")
        self.assertEqual(self.g(city="Nowhereville", state=None)[0], "rejected")

    def test_2023_needs_hw4_in_the_listing(self):
        v, why, e = self.g(year=2023, text="FSD purchased. HW4 / AI4 computer.")
        self.assertEqual(v, "match", why)
        self.assertIn("HW4", e["hw4_evidence"])
        self.assertEqual(self.g(year=2023, text="FSD purchased. HW3.")[0], "rejected")

    def test_fme_fields_decide(self):
        ok = self.g(software="Full Self-Driving (FSD)", hardware="N/A", text="")
        self.assertEqual(ok[0], "match", ok[1])
        self.assertEqual(self.g(software="Base Autopilot (AP)", text="")[0], "rejected")
        self.assertEqual(self.g(software="Enhanced Autopilot (EAP)", text="")[0], "rejected")
        self.assertEqual(self.g(software="FSD Subscription", text="")[0], "rejected")
        self.assertEqual(self.g(software="Full Self-Driving (FSD)", hardware="HW 3.0")[0], "rejected")

    def test_ai_can_only_make_it_stricter(self):
        class AI:
            @staticmethod
            def chat(messages, **kw):
                u = messages[-1]["content"]
                return {"content": json.dumps({"fsd_status": "trial", "fsd_quote": "Paid $12,000 for FSD", "hw4": "unclear", "hw4_quote": ""})}, "fake"
        M.freellm = AI
        try:
            v, why, e = self.g()
            self.assertEqual(v, "rejected")
            self.assertIn("AI read", why)

            class Liar(AI):
                @staticmethod
                def chat(messages, **kw):
                    return {"content": json.dumps({"fsd_status": "trial", "fsd_quote": "this quote is not in the listing", "hw4": "no", "hw4_quote": "not in the listing"})}, "fake"
            M.freellm = Liar
            self.assertEqual(self.g()[0], "match")  # an unverifiable quote changes nothing
        finally:
            M.freellm = None


class AiPromotion(unittest.TestCase):
    def ai(self, quote):
        class AI:
            @staticmethod
            def chat(messages, **kw):
                return {"content": json.dumps({"fsd_status": "purchased", "fsd_quote": quote, "hw4": "yes", "hw4_quote": ""})}, "fake"
        return AI

    def test_bare_feature_mention_stays_likely(self):
        M.freellm = self.ai("Full Self Driving (FSD)")
        try:
            v, why, e = M.grade(L(text="Features: Full Self Driving (FSD), glass roof"), CFG)
            self.assertEqual((v, e["fsd_grade"]), ("match", "LIKELY"))
        finally:
            M.freellm = None

    def test_purchase_wording_in_the_quote_promotes(self):
        M.freellm = self.ai("FSD was purchased at delivery")
        try:
            v, why, e = M.grade(L(text="FSD was purchased at delivery, clean car"), CFG)
            self.assertEqual((v, e["fsd_grade"]), ("match", "CONFIRMED"))
        finally:
            M.freellm = None


class Calm(unittest.TestCase):
    def test_money_words_and_dollar_signs_are_defused(self):
        out = M.calm('FSD paid $7,500, deposit required, payment plan')
        self.assertNotIn("$", out)
        for w in ("deposit", "payment"):
            self.assertNotIn(w, out.lower())


class Run(unittest.TestCase):
    def setUp(self):
        FAKE.calls.clear()
        FAKE.seen = []
        self._fme, self._cl = M.fme_run, M.cl_run

    def tearDown(self):
        M.fme_run, M.cl_run = self._fme, self._cl

    def match(self, news="new", price=27500, old=None, key="fme:1"):
        e = {"distance_mi": 12, "hw4_evidence": "2024 model year (2024 and newer are HW4)", "fsd_grade": "CONFIRMED", "fsd_evidence": 'Listing says "FSD purchased"'}
        return dict(L(), key=key, source="findmyelectric", url="https://x/1", trim="Long Range", price=price, extra=e, news=news, old_price=old)

    def run_with(self, fme, cl):
        M.fme_run, M.cl_run = fme, cl
        return M.main([])

    def test_new_match_goes_to_the_recap_not_a_push(self):
        out = self.run_with(lambda *a: ({"urls": 5}, [self.match()]), lambda *a: ({"rows": 2}, []))
        self.assertTrue(out.startswith("ok: 1 new match"), out)
        n = [c for c in FAKE.calls if c[0] == "notify"]
        self.assertEqual(len(n), 1)
        self.assertFalse(n[0][1]["push"])
        self.assertEqual(n[0][1]["severity"], "success")
        self.assertTrue(n[0][1]["args"][0].startswith("Model Y Hunter:"))
        self.assertIn("modely.", n[0][1]["dedupe"])

    def test_nothing_new_sends_nothing(self):
        out = self.run_with(lambda *a: ({"urls": 5}, []), lambda *a: ({"rows": 2}, []))
        self.assertIn("no new matches", out)
        self.assertNotIn("notify", FAKE.names())

    def test_price_drop_is_news(self):
        out = self.run_with(lambda *a: ({}, [self.match("drop", 26000, 27500)]), lambda *a: ({}, []))
        self.assertIn("1 price drop", out)
        body = [c for c in FAKE.calls if c[0] == "notify"][0][1]["args"][1]
        self.assertIn("PRICE DROP from USD 27,500", body)
        self.assertNotIn("$", body)  # a dollar sign + digits makes the alert router treat it as money news

    def test_one_source_down_is_partial_both_down_fails(self):
        def boom(*a):
            raise RuntimeError("sitemap unreadable")
        out = self.run_with(boom, lambda *a: ({"rows": 2}, []))
        self.assertTrue(out.startswith("partial:"), out)
        with self.assertRaises(RuntimeError):
            self.run_with(boom, boom)

    def test_switch_off_skips(self):
        FAKE.settings = dict(CFG, enabled=False)
        try:
            self.assertTrue(self.run_with(lambda *a: ({}, []), lambda *a: ({}, [])).startswith("skip"))
        finally:
            FAKE.settings = dict(CFG)

    def test_blocked_sources_are_named_every_run(self):
        out = self.run_with(lambda *a: ({}, []), lambda *a: ({}, []))
        for name in ("Tesla inventory", "CarGurus", "Autotrader"):
            self.assertIn(name, out)

    def test_record_logs_every_listing_and_twin_vin_is_not_news_twice(self):
        stats = {"match": 0}
        seen = {"cl:9": {"vin": "7SAYGDEE1RF000001", "alerted": True, "verdict": "match", "price": 27500}}
        got = []
        l = dict(L(), key="fme:2", source="findmyelectric", url="u", trim="")
        M.record(l, "match", None, {"distance_mi": 5, "fsd_grade": "LIKELY"}, seen, got, stats, False)
        self.assertEqual(got, [])
        self.assertEqual(FAKE.names().count("model_y_seen_save"), 1)  # still logged
        got2 = []
        l2 = dict(L(vin="OTHERVIN0000000001"), key="fme:3", source="findmyelectric", url="u", trim="")
        M.record(l2, "match", None, {"distance_mi": 5, "fsd_grade": "LIKELY"}, seen, got2, stats, False)
        self.assertEqual(len(got2), 1)
        self.assertEqual(got2[0]["news"], "new")


if __name__ == "__main__":
    unittest.main()
