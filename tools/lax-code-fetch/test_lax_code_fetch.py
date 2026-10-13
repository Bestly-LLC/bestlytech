"""Offline tests for Parker (no network, no database): python3 -m unittest test_lax_code_fetch -v"""
import datetime
import json
import sys
import types
import unittest
from unittest import mock

calls = []
fake_lib = types.ModuleType("lib")
GATE = {"configured": True, "need": True, "why": "missing"}
SAVE = {"saved": True, "guests_see": True}


def _rpc(name, **kw):
    calls.append((name, kw))
    if name == "lax_fetch_gate":
        return dict(GATE)
    if name == "pi_secret_get":
        return {"pi:parkmyshare:email": "me@example.com", "pi:parkmyshare:password": "pw"}[kw["p_name"]]
    if name == "lax_fetch_save":
        return dict(SAVE)
    return {}


fake_lib.rpc = _rpc
sys.modules["lib"] = fake_lib
import lax_code_fetch as P  # noqa: E402

NOW = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: d.isoformat().replace("+00:00", "Z")  # noqa: E731


def api(responses):
    """responses: {(method, path-prefix): (status, json)}; anything else -> 404."""
    def call(method, path, token=None, body=None, timeout=25):
        for (m, p), v in responses.items():
            if m == method and path.startswith(p):
                if isinstance(v, Exception):
                    raise v
                return v
        return 404, None
    return call


GOOD = {
    ("POST", "user/login"): (200, {"accessToken": "t", "user": {"companyId": "c1", "isEmailVerified": True}}),
    ("GET", "parkingfacility/active"): (200, [{"id": "f9", "name": "Downtown", "supportQRCodes": True},
                                             {"id": "f1", "name": "LAX Century Garage", "supportQRCodes": True}]),
    ("GET", "twofactorauthcode"): (200, [
        {"barcode": "OLD111", "status": "expiring", "expirationDate": iso(NOW + datetime.timedelta(hours=5))},
        {"barcode": "NEW222", "status": "active", "expirationDate": iso(NOW + datetime.timedelta(days=30))},
        {"barcode": "DEAD33", "status": "active", "expirationDate": iso(NOW - datetime.timedelta(days=1))},
    ]),
}


class Parker(unittest.TestCase):
    def setUp(self):
        calls.clear()
        GATE.update(configured=True, need=True, why="missing")
        SAVE.clear(); SAVE.update(saved=True, guests_see=True)

    def names(self):
        return [c[0] for c in calls]

    def reported(self):
        return [c[1] for c in calls if c[0] == "lax_fetch_report"]

    def test_parse_when(self):
        self.assertEqual(P.parse_when("/Date(1700000000000-0000)/").year, 2023)
        self.assertEqual(P.parse_when("2026-11-01T07:00:00Z").month, 11)
        self.assertIsNone(P.parse_when(""))

    def test_choose_only_active_and_not_expired(self):
        pick = P.choose(GOOD[("GET", "twofactorauthcode")][1])
        self.assertEqual(pick["code"], "NEW222")
        self.assertIsNone(P.choose([{"barcode": "X", "status": "expiring", "expirationDate": iso(NOW + datetime.timedelta(days=2))}]))
        self.assertIsNone(P.choose([{"barcode": "X", "status": "active", "expirationDate": iso(NOW + datetime.timedelta(minutes=20))}]))

    def test_happy_path_saves_and_reports_ok(self):
        with mock.patch.object(P, "call", api(GOOD)):
            out = P.main([])
        self.assertTrue(out.startswith("ok: saved"), out)
        save = [c[1] for c in calls if c[0] == "lax_fetch_save"][0]
        self.assertEqual(save["p_payload"], "NEW222")
        self.assertIn("LAX", save["p_facility"])                  # the LAX garage is preferred
        self.assertTrue(self.reported()[-1]["p_ok"])
        self.assertNotIn("NEW222", out)                            # never logs the code

    def test_gate_says_nothing_due_no_network(self):
        GATE.update(need=False, why="nothing due")
        with mock.patch.object(P, "call", side_effect=AssertionError("network!")):
            self.assertTrue(P.main([]).startswith("ok: nothing due"))

    def test_not_configured(self):
        GATE.clear(); GATE.update(configured=False)
        self.assertTrue(P.main([]).startswith("skip: Park My Share login not saved"))
        GATE.update(configured=True, need=True, why="missing")

    def test_bad_login_reports_auth_and_stops(self):
        r = dict(GOOD); r[("POST", "user/login")] = (401, {"responseStatus": {"message": "Invalid email or password"}})
        with mock.patch.object(P, "call", api(r)), mock.patch.object(P, "browser_codes", side_effect=AssertionError("no browser on auth")):
            out = P.main([])
        self.assertIn("rejected", out)
        self.assertEqual(self.reported()[-1]["p_kind"], "auth")
        self.assertNotIn("lax_fetch_save", self.names())

    def test_transient_retries_then_browser(self):
        r = dict(GOOD); r[("POST", "user/login")] = P.Transient("timeout")
        with mock.patch.object(P, "call", api(r)), mock.patch.object(P.time, "sleep"), \
             mock.patch.object(P, "browser_codes", return_value=[{"barcode": "BRW999", "status": "active",
                                                                  "expirationDate": iso(NOW + datetime.timedelta(days=20))}]):
            out = P.main([])
        self.assertIn("via browser", out)
        self.assertEqual([c[1] for c in calls if c[0] == "lax_fetch_save"][0]["p_payload"], "BRW999")

    def test_api_shape_change_falls_back_to_browser(self):
        r = dict(GOOD); r[("GET", "twofactorauthcode")] = (200, {"weird": True})
        with mock.patch.object(P, "call", api(r)), \
             mock.patch.object(P, "browser_codes", return_value=[{"barcode": "BRW1", "status": "active"}]):
            self.assertIn("via browser", P.main([]))

    def test_both_paths_down_reports_down_without_crashing(self):
        r = dict(GOOD); r[("POST", "user/login")] = P.Shape("odd")
        with mock.patch.object(P, "call", api(r)), mock.patch.object(P, "browser_codes", side_effect=RuntimeError("chromium gone")):
            out = P.main([])
        self.assertTrue(out.startswith("skip:"), out)
        self.assertEqual(self.reported()[-1]["p_kind"], "down")

    def test_only_expiring_code_is_not_saved(self):
        r = dict(GOOD); r[("GET", "twofactorauthcode")] = (200, [{"barcode": "OLD", "status": "expiring",
                                                                  "expirationDate": iso(NOW + datetime.timedelta(hours=8))}])
        with mock.patch.object(P, "call", api(r)):
            out = P.main([])
        self.assertIn("no active code", out)
        self.assertNotIn("lax_fetch_save", self.names())
        self.assertEqual(self.reported()[-1]["p_kind"], "nocode")

    def test_guests_not_seeing_it_is_retried_then_reported(self):
        SAVE.update(guests_see=False)
        with mock.patch.object(P, "call", api(GOOD)), mock.patch.object(P.time, "sleep"):
            out = P.main([])
        self.assertEqual(self.names().count("lax_fetch_save"), 2)
        self.assertEqual(self.reported()[-1]["p_kind"], "verify")
        self.assertTrue(out.startswith("skip:"))

    def test_same_code_is_ok_not_saved_again(self):
        SAVE.clear(); SAVE.update(saved=False, same=True, guests_see=True)
        with mock.patch.object(P, "call", api(GOOD)):
            self.assertTrue(P.main([]).startswith("ok: same"))

    def test_dry_run_writes_nothing(self):
        with mock.patch.object(P, "call", api(GOOD)):
            out = P.main(["--dry"])
        self.assertIn("dry run", out)
        self.assertNotIn("lax_fetch_save", self.names())
        self.assertNotIn("lax_fetch_report", self.names())


if __name__ == "__main__":
    unittest.main()
