"""Offline tests for Job Finder. No network, no Nextcloud, no AI.  Run:  python3 tools/job-finder/test_job_finder.py"""
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


class FakeLib(types.ModuleType):
    def __init__(self):
        super().__init__("lib")
        self.calls = []
        self.gate = {"enabled": True, "max_per_tier": 8}
        self.secrets = {"nextcloud_user": "jared", "nextcloud_app_password": "x", "nextcloud_base_url": "https://cloud.example"}

    def rpc(self, name, **kw):
        self.calls.append((name, kw))
        if name == "job_finder_gate":
            return self.gate
        if name == "pi_secret":
            return self.secrets.get(kw["p_name"], "")
        return None

    def notify(self, *a, **k):
        self.calls.append(("notify", dict(k, args=a)))


FAKE = FakeLib()
sys.modules["lib"] = FAKE
import job_finder as J  # noqa: E402

J.freellm = None


def card(i, title, company="Acme", loc="West Hollywood, CA"):
    return ('<li><div class="base-card" data-entity-urn="urn:li:jobPosting:%s"><a href="https://www.linkedin.com/jobs/view/x-%s?trk=1"></a>'
            '<h3 class="base-search-card__title">%s</h3><h4 class="base-search-card__subtitle"><a>%s</a></h4>'
            '<span class="job-search-card__location">%s</span><time datetime="2026-10-11"></time></div></li>' % (i, i, title, company, loc))


def job(title, loc="West Hollywood, CA", tier="A_skill_match", company="Acme", **kw):
    j = {"id": "1", "title": title, "company": company, "location": loc, "posted": "", "salary": "", "url": "u", "tier": tier, "query": "q", "remote": False}
    j.update(kw)
    return j


class Parse(unittest.TestCase):
    def test_cards(self):
        rows = J.parse_cards(card(111, "Account Manager &amp; Partnerships") + card(222, "Concierge", "Hotel X"), "A_skill_match", "q")
        self.assertEqual([r["id"] for r in rows], ["111", "222"])
        self.assertEqual(rows[0]["title"], "Account Manager & Partnerships")
        self.assertEqual(rows[0]["url"], "https://www.linkedin.com/jobs/view/x-111")
        self.assertEqual(rows[1]["company"], "Hotel X")

    def test_detail(self):
        page = '<div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5"><p>Run guest <b>services</b>.</p></div>'
        self.assertEqual(J.parse_detail(page), ("Run guest services .", False))
        self.assertTrue(J.parse_detail('<figcaption class="closed-job__flavor--closed">No longer accepting applications</figcaption>')[1])
        # an open posting carries the same "closed-job" CSS words in its page template: that alone must not count
        self.assertFalse(J.parse_detail('<style>.closed-job{display:none}</style><div class="show-more-less-html__markup">Open role</div>')[1])


class NoOvernight(unittest.TestCase):
    def test_detects_every_form(self):
        for t in ("Night Auditor", "Hotel night audit position", "overnight front desk", "Graveyard shift", "grave-yard", "Third shift supervisor",
                  "3rd shift", "night shift lead", "Hours: 11pm - 7am", "10 PM to 6 AM"):
            self.assertTrue(J.is_overnight(t), t)

    def test_plain_nights_and_weekends_is_not_overnight(self):
        for t in ("Front Desk Agent, mornings and weekends", "Customer Success Manager, some evenings", "Open 9am - 5pm", "knight of the realm"):
            self.assertFalse(J.is_overnight(t), t)

    def test_title_with_overnight_is_dropped_even_with_a_high_score(self):
        r = J.rank([job("Overnight Front Desk Concierge", tier="C_walkable_retail"), job("Night Audit Account Manager")])
        self.assertEqual(r, [])


class Scoring(unittest.TestCase):
    def test_account_manager_beats_retail_and_junk_is_dropped(self):
        r = J.rank([job("Enterprise Account Manager", id="1"), job("Registered Nurse", id="2"), job("Warehouse Driver", id="3")])
        self.assertEqual([x["title"] for x in r], ["Enterprise Account Manager"])

    def test_forward_deployed_engineer_is_not_punished_for_the_word_engineer(self):
        r = J.rank([job("Forward Deployed Engineer", "Los Angeles, CA"), job("Software Engineer", "Los Angeles, CA")])
        self.assertEqual([x["title"] for x in r], ["Forward Deployed Engineer"])

    def test_remote_search_keeps_only_forward_deployed_style_roles(self):
        r = J.rank([job("Forward Deployed Engineer", "United States", remote=True), job("Account Manager", "United States", remote=True)])
        self.assertEqual([x["title"] for x in r], ["Forward Deployed Engineer"])

    def test_hospitality_and_concierge_are_in(self):
        r = J.rank([job("Concierge", "Beverly Hills, CA", tier="C_walkable_retail"), job("Guest Services Manager", "Los Angeles, CA", tier="B_commute_45min")])
        self.assertEqual(len(r), 2)

    def test_walkable_tier_rejects_far_towns_and_commute_tiers_reject_far_cities(self):
        self.assertEqual(J.rank([job("Concierge", "Santa Monica, CA", tier="C_walkable_retail")]), [])
        self.assertEqual(J.rank([job("Account Manager", "San Diego, CA", tier="B_commute_45min")]), [])


class Board(unittest.TestCase):
    def test_marker_ids_and_stack_lookup(self):
        stacks = [{"id": 33, "title": "New", "cards": [{"description": "x\n<!-- linkedin-id: 4001 -->"}]},
                  {"id": 34, "title": "Shortlist", "cards": [{"description": "<!-- linkedin-id: 4002 -->"}]},
                  {"id": 38, "title": "Closed", "cards": []}]
        self.assertEqual(J.marker_ids(stacks), {"4001", "4002"})
        self.assertEqual(J.stack_ids(stacks), {"new": 33, "shortlist": 34, "closed": 38})

    def test_card_has_marker_and_checklist(self):
        d = J.card_description(job("Account Manager", id="777", match_on=["account manag"], score=21), "Runs accounts.")
        self.assertIn("<!-- linkedin-id: 777 -->", d)
        self.assertIn("- [ ] Apply", d)
        self.assertIn("Runs accounts.", d)


class Run(unittest.TestCase):
    """Whole run with the network replaced."""

    def setUp(self):
        FAKE.calls.clear()
        self.posted, self.moved = [], []
        self.pages = {}
        J.time.sleep = lambda s: None

        class D:
            def __init__(s, *a): pass
            def stacks(s):
                return [{"id": 33, "title": "New", "cards": [{"description": "<!-- linkedin-id: 900 -->"}]},
                        {"id": 34, "title": "Shortlist", "cards": [{"id": 5, "description": "<!-- linkedin-id: 801 -->"}, {"id": 6, "description": "<!-- linkedin-id: 802 -->"}]},
                        {"id": 38, "title": "Closed", "cards": []}]
            def archived(s): return []
            def add_card(s2, stack, title, desc, label): self.posted.append((stack, title, label, desc))
            def move(s2, cid, a, b): self.moved.append((cid, a, b))
        J.Deck = D

        def fake_http(url, **kw):
            if url.startswith(J.SEARCH):
                if "Account+Manager" in url and "West+Hollywood" in url and "start=0" in url and "f_WT" not in url:
                    return card(901, "Account Manager", "Good Co") + card(902, "Account Executive", "Night Co") + card(900, "Account Manager", "Already On Board") + card(903, "Customer Success Manager", "Unreadable Co")
                return ""
            jid = url.rsplit("/", 1)[-1]
            if jid in ("801",):
                return "<div>fine</div><div class=\"show-more-less-html__markup\">Still hiring</div>"
            if jid == "802":
                return "<span>No longer accepting applications</span>"
            if jid == "901":
                return '<div class="show-more-less-html__markup">Own a book of accounts. Weekdays 9 to 5.</div>'
            if jid == "902":
                return '<div class="show-more-less-html__markup">Manage accounts. This role works the overnight shift.</div>'
            if jid == "903":
                return "<html>nothing readable</html>"
            raise AssertionError(url)
        J.http = fake_http

    def test_posts_good_skips_board_dupes_overnight_and_unreadable_and_closes_dead_shortlist(self):
        out = J.main([])
        self.assertTrue(out.startswith("ok: 1 new card"), out)
        self.assertEqual(len(self.posted), 1)
        stack, title, label, desc = self.posted[0]
        self.assertEqual((stack, label), (33, 40))
        self.assertIn("Good Co", title)
        self.assertIn("dropped overnight 1", out)
        self.assertIn("held back (text unreadable) 1", out)
        self.assertEqual(self.moved, [(6, 34, 38)])  # only the dead Shortlist card, moved to Closed
        n = [c for c in FAKE.calls if c[0] == "notify"]
        self.assertEqual(len(n), 1)
        self.assertFalse(n[0][1]["push"])
        self.assertEqual(n[0][1]["severity"], "success")
        self.assertTrue(n[0][1]["args"][0].startswith("Job Finder:"))

    def test_dry_writes_nothing(self):
        out = J.main(["--dry"])
        self.assertTrue(out.startswith("dry:"))
        self.assertEqual(self.posted, [])
        self.assertEqual(self.moved, [])
        self.assertNotIn("notify", [c[0] for c in FAKE.calls])

    def test_off_and_no_login(self):
        FAKE.gate = {"enabled": False}
        self.assertTrue(J.main([]).startswith("skip"))
        FAKE.gate = {"enabled": True, "max_per_tier": 8}
        keep = FAKE.secrets.pop("nextcloud_app_password")
        try:
            self.assertTrue(J.main([]).startswith("skip: Nextcloud login"))
        finally:
            FAKE.secrets["nextcloud_app_password"] = keep

    def test_search_totally_down_fails_loudly(self):
        def boom(url, **kw):
            raise OSError("down")
        J.http = boom
        with self.assertRaises(RuntimeError):
            J.main([])

    def test_no_secret_in_summary(self):
        self.assertNotIn(FAKE.secrets["nextcloud_app_password"] + "x", J.main([]))


if __name__ == "__main__":
    unittest.main()
