"""The upload watchdog (agent.upload_watch_tick): a failing upload gets a small-chunk retry after 30 minutes, then an alert."""
import json
import os
import time
import unittest

from test_auto import agent


class Inline:
    """threading.Thread stand-in that runs the target at once."""
    def __init__(self, target=None, args=(), daemon=None):
        self.t, self.a = target, args

    def start(self):
        self.t(*self.a)


class FakeNu:
    def __init__(self, path, ok):
        self.path, self.ok, self.calls = path, ok, []

    def _fails(self):
        return json.load(open(self.path))

    def _save_fails(self, d):
        json.dump(d, open(self.path, "w"))

    def upload(self, local, rel, small=False, pw=None, routes=None):
        self.calls.append((rel, small))
        if self.ok:
            d = self._fails()
            d.pop(rel, None)
            self._save_fails(d)
        return self.ok, "fake"


class UploadWatchTests(unittest.TestCase):
    def setUp(self):
        self.f = f"{agent.HOME}/.upload-fails.json"
        self.local = f"{agent.HOME}/x.m4a"
        open(self.local, "w").write("x")
        self.events = []
        self._health, self._thread, self._load, self._pw = agent.health, agent.threading.Thread, agent.load_ncupload, agent.nc_password
        agent.health = lambda key, kind, *a, **k: self.events.append((key, kind))
        agent.threading.Thread = Inline
        agent.nc_password = lambda fresh=False: "x"
        agent.upload_watch_state.update(next=0, running=False, alerted=False)

    def tearDown(self):
        agent.health, agent.threading.Thread, agent.load_ncupload, agent.nc_password = self._health, self._thread, self._load, self._pw
        for p in (self.f, self.local):
            if os.path.exists(p):
                os.remove(p)

    def _fail(self, age):
        json.dump({"a/b.m4a": {"first": agent.time.time() - age, "local": self.local, "err": "boom", "tries": 3}}, open(self.f, "w"))

    def test_young_failure_is_left_alone(self):
        self._fail(600)
        nu = FakeNu(self.f, False)
        agent.load_ncupload = lambda: nu
        agent.upload_watch_tick()
        self.assertEqual(nu.calls, [])
        self.assertEqual(self.events, [])

    def test_stuck_over_30_min_retries_small_then_alerts_once(self):
        self._fail(31 * 60)
        nu = FakeNu(self.f, False)
        agent.load_ncupload = lambda: nu
        agent.upload_watch_tick()
        self.assertEqual(nu.calls, [("a/b.m4a", True)])
        self.assertEqual(self.events, [("upload.stuck", "problem")])
        agent.upload_watch_state["next"] = 0
        agent.upload_watch_tick()                           # the small retry is used up; no second alert
        self.assertEqual(self.events, [("upload.stuck", "problem")])

    def test_small_retry_that_works_raises_nothing(self):
        self._fail(31 * 60)
        nu = FakeNu(self.f, True)
        agent.load_ncupload = lambda: nu
        agent.upload_watch_tick()
        self.assertEqual(nu.calls, [("a/b.m4a", True)])
        self.assertEqual(self.events, [])

    def test_alert_resolves_when_uploads_clear(self):
        self._fail(31 * 60)
        agent.load_ncupload = lambda: FakeNu(self.f, False)
        agent.upload_watch_tick()
        json.dump({}, open(self.f, "w"))
        agent.upload_watch_state["next"] = 0
        agent.upload_watch_tick()
        self.assertEqual(self.events[-1], ("upload.stuck", "resolved"))


if __name__ == "__main__":
    unittest.main()
