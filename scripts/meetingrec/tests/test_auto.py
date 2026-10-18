"""Tests for the auto-record parts of agent.py (Lane M, 2026-10-18). Standard library only; run with the Mac's python3 (3.9):

    cd scripts/meetingrec && python3 -m unittest discover -s tests -v

Talk, the Start Recording app, stop.sh, Supabase and Nextcloud are all faked; the clock is faked too, so a 4-hour cap takes no time.
"""
import json
import os
import sys
import tempfile
import threading
import types
import unittest

TMP = tempfile.mkdtemp(prefix="meetingrec-test-")
os.environ["HOME"] = TMP
os.makedirs(f"{TMP}/MeetingRec/recordings", exist_ok=True)
with open(f"{TMP}/MeetingRec/.agent-key", "w") as _f:
    _f.write("test-key")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import agent  # noqa: E402

H = agent.HOME
REC = agent.REC
REAL_ROOMS = {k: dict(v) for k, v in agent.AUTO_ROOMS.items()}      # the allowlist as shipped, before the tests replace it
ROOM, TEST_ROOM, BDC = "fyqvdsa4", "yqne2jpr", "sm33w3fu"


class Clock:
    def __init__(self):
        self.now = 1_800_000_000.0

    def time(self):
        return self.now

    def sleep(self, s):
        self.now += s

    def strftime(self, *a):
        import time as real
        return real.strftime(*a)

    def advance(self, s):
        self.now += s


class SyncThread:
    """threading.Thread that runs its target right away, so a test can see what a thread did."""
    def __init__(self, target=None, args=(), daemon=None, **kw):
        self.target, self.args = target, args

    def start(self):
        self.target(*self.args)


class World:
    """Everything outside agent.py: the Talk server, the Mac's recorder, Supabase, Nextcloud."""
    def __init__(self):
        self.clock = Clock()
        self.rooms = {ROOM: {"type": 3, "name": "Centering YOU", "call": False, "people": []},
                      TEST_ROOM: {"type": 2, "name": "Bestly call test", "call": False, "people": []},
                      BDC: {"type": 3, "name": "Eli & Jared - BDC Universal", "call": False, "people": []}}
        self.talk_down = False
        self.recording = False
        self.start_fails = 0          # how many `open` calls do nothing before one works
        self.opens = 0
        self.stops = 0
        self.health = []
        self.calls = []               # edge-function calls from the agent
        self.rows = {}                # name -> {"client_slug", "room"}
        self.deleted = set()
        self.ask_fails = False
        self.dav_calls = []
        self.shared = []
        self.dav_code = {}
        self.transcript_text = "[00:00] JARED: hello\n" * 30

    # ---- Talk
    def talk(self, method, path, data=None, timeout=15):
        if self.talk_down:
            raise OSError("talk is down")
        if method == "GET" and (path == "/room" or path.startswith("/room?")):
            return [{"token": t, "type": r["type"], "displayName": r["name"], "name": r["name"], "hasCall": r["call"],
                     "participantFlags": 0} for t, r in self.rooms.items()]
        if method == "GET" and path.startswith("/room/") and path.endswith("/participants"):
            tok = path.split("/")[2]
            return [{"actorType": t, "actorId": a, "displayName": a.title(), "inCall": 7 if inc else 0,
                     "lastPing": self.clock.now - age, "sessionIds": ["s%d" % i for i in range(n)],
                     "attendeeId": i} for i, (a, t, inc, age, n) in enumerate(self.rooms[tok]["people"])]
        raise AssertionError("unexpected Talk call %s %s" % (method, path))

    def put(self, tok, people):
        """people: list of ids or (id, type, in_call, ping_age_seconds, sessions)."""
        out = []
        for p in people:
            out.append(p if isinstance(p, tuple) else (p, "users", True, 0, 1))
        self.rooms[tok]["people"] = out
        self.rooms[tok]["call"] = any(p[2] for p in out)

    # ---- the Mac
    def recording_pid(self):
        return "999" if self.recording else None

    def run(self, cmd, **kw):
        if cmd[0] == "open":                              # Start Recording.app opened: start.sh runs
            self.opens += 1
            if self.opens > self.start_fails:
                name = open(f"{H}/.pending-name").read().strip()
                roster = open(f"{H}/.pending-roster").read().strip()
                open(f"{H}/.current", "w").write(name)
                open(f"{H}/.roster", "w").write(roster)
                open(f"{H}/.started", "w").write(str(int(self.clock.now)))
                os.remove(f"{H}/.pending-name")
                os.remove(f"{H}/.pending-roster")
                self.recording = True
                for s in ("system", "mic"):
                    open(f"{REC}/{name}-{s}.m4a", "w").write("x")
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    def popen(self, cmd, **kw):
        """stop.sh: stops the recorder, writes the transcript."""
        name = open(f"{H}/.current").read().strip()
        self.stops += 1
        self.recording = False
        open(f"{REC}/{name}-transcript.txt", "w").write(self.transcript_text)
        return types.SimpleNamespace(stdout=iter(["== stopping the recording ==\n", "== transcribing ==\n"]), wait=lambda timeout=None: 0)

    # ---- Supabase
    def call(self, body, timeout=20):
        self.calls.append(body)
        op = body.get("op")
        if op == "ingest":
            self.rows[body["name"]] = {"client_slug": {TEST_ROOM: "bestly-test", ROOM: "centering-you"}.get(body.get("room")),
                                       "room": body.get("room")}
            return {"ok": True}
        if op == "meeting_exists":
            if self.ask_fails:
                raise OSError("offline")
            n = body["name"]
            return {"ok": True, "exists": n in self.rows, "deleted": n in self.deleted,
                    "row": ({"id": "x", **self.rows[n]} if n in self.rows else None)}
        if op == "health":
            self.health.append((body["key"], body["kind"], body.get("title"), body.get("severity")))
            return {"ok": True}
        return {"ok": True}

    # ---- Nextcloud
    def dav(self, method, rel, headers=None, timeout=180, body_path=None):
        self.dav_calls.append((method, rel, (headers or {}).get("Destination"), body_path))
        return self.dav_code.get(method, {"MKCOL": 201, "COPY": 201, "PUT": 201}[method])

    def kinds(self, key):
        return [k for (kk, k, _t, _s) in self.health if kk == key]


W = None


def setup_world():
    global W
    W = World()
    for d in (H, REC):
        for f in os.listdir(d):
            p = os.path.join(d, f)
            if os.path.isfile(p):
                os.remove(p)
    for sub in ("recordings", ".meta"):
        p = os.path.join(H, sub)
        if os.path.isdir(p):
            for f in os.listdir(p):
                fp = os.path.join(p, f)
                if os.path.isfile(fp):
                    os.remove(fp)
    open(f"{H}/.agent-key", "w").write("test-key")
    agent.auto.clear()
    agent.auto.update({"next": 0, "fails": 0, "hold": {}, "false_since": {}, "blocked": set(), "rooms": {}, "last_human": None,
                       "stopping": False, "last_error": None, "alert_open": False, "talk_alert": False, "long_alert": False,
                       "retry_at": 0, "verify_next": 0})
    agent.busy.update(stage=None, name=None)
    agent.nt.update(proc=None, name=None, room=None, title=None, next_try=0, status="off", fails=0, t0=0)
    agent.heal["selftest"] = None
    agent.heal["test_room"] = None
    agent.AUTO_ROOMS.clear()
    agent.AUTO_ROOMS.update({ROOM: {"rule": "jared+1", "label": "Centering YOU"},
                             TEST_ROOM: {"rule": "any2", "label": "Bestly call test", "until": "2999-01-01T00:00:00-07:00"},
                             BDC: {"rule": "jared+1", "label": "Eli & Jared - BDC Universal"}})
    agent.time = W.clock
    agent.threading = types.SimpleNamespace(Thread=SyncThread, Lock=threading.Lock)
    agent.talk = W.talk
    agent.recording_pid = W.recording_pid
    agent.stop_running_elsewhere = lambda: False
    agent.subprocess = types.SimpleNamespace(run=W.run, Popen=W.popen, PIPE=-1, STDOUT=-2, DEVNULL=-3)
    agent.find_start_app = lambda: "/Applications/Start Recording.app"
    agent.call = W.call
    agent.dav = W.dav
    agent.shared_paths = lambda folder: list(W.shared)
    agent.notify = lambda *a, **k: None
    agent.nc_password = lambda fresh=False: "pw"
    agent.os.environ.setdefault("TZ", "America/Los_Angeles")


def run_for(seconds, step=1):
    for _ in range(int(seconds / step)):
        W.clock.advance(step)
        agent.auto_tick()


class RuleTests(unittest.TestCase):
    def setUp(self):
        setup_world()

    def test_jared_plus_one(self):
        W.put(ROOM, ["jared", "elizabeth"])
        people = agent.room_people(ROOM)
        self.assertTrue(agent.rule_holds("jared+1", people))
        W.put(ROOM, ["elizabeth", "eli"])
        self.assertFalse(agent.rule_holds("jared+1", agent.room_people(ROOM)))
        W.put(ROOM, ["jared"])
        self.assertFalse(agent.rule_holds("jared+1", agent.room_people(ROOM)))

    def test_the_bots_never_count(self):
        W.put(ROOM, ["jared", "scout-notetaker"])
        self.assertFalse(agent.rule_holds("jared+1", agent.room_people(ROOM)))
        W.put(TEST_ROOM, ["scout-notetaker", "cowork-bot"])
        self.assertEqual(agent.room_people(TEST_ROOM), [])

    def test_in_call_not_just_in_room(self):
        W.put(ROOM, [("jared", "users", True, 0, 1), ("elizabeth", "users", False, 0, 1)])
        self.assertFalse(agent.rule_holds("jared+1", agent.room_people(ROOM)))

    def test_a_stale_session_does_not_count(self):
        W.put(ROOM, [("jared", "users", True, 0, 1), ("elizabeth", "users", True, 600, 1)])
        self.assertFalse(agent.rule_holds("jared+1", agent.room_people(ROOM)))

    def test_guests_count_as_the_other_person(self):
        W.put(ROOM, [("jared", "users", True, 0, 1), ("abc", "guests", True, 0, 1)])
        self.assertTrue(agent.rule_holds("jared+1", agent.room_people(ROOM)))
        W.put(ROOM, [("jared", "users", True, 0, 1), ("a1b2c3", "emails", True, 0, 1)])
        self.assertTrue(agent.rule_holds("jared+1", agent.room_people(ROOM)))

    def test_any_two_humans(self):
        W.put(TEST_ROOM, ["calltest"])
        self.assertFalse(agent.rule_holds("any2", agent.room_people(TEST_ROOM)))
        W.put(TEST_ROOM, [("calltest", "users", True, 0, 2)])         # two sessions of one test user
        self.assertTrue(agent.rule_holds("any2", agent.room_people(TEST_ROOM)))
        W.put(TEST_ROOM, ["jared", "calltest"])
        self.assertTrue(agent.rule_holds("any2", agent.room_people(TEST_ROOM)))

    def test_roster(self):
        W.put(ROOM, [("jared", "users", True, 0, 1), ("elizabeth", "users", True, 0, 1), ("Eli B.", "guests", True, 0, 1),
                     ("0123456789abcdef0123456789abcdef", "emails", True, 0, 1)])
        self.assertEqual(agent.roster_from(agent.room_people(ROOM)), ["elizabeth", "eli-b"])

    def test_switches(self):
        self.assertEqual(sorted(agent.auto_rooms_on()), sorted([ROOM, TEST_ROOM, BDC]))
        open(f"{H}/.auto-off-{TEST_ROOM}", "w").close()
        self.assertEqual(sorted(agent.auto_rooms_on()), sorted([ROOM, BDC]))
        open(f"{H}/.auto-off-{BDC}", "w").close()
        self.assertEqual(sorted(agent.auto_rooms_on()), [ROOM])
        open(f"{H}/.auto-off", "w").close()
        self.assertEqual(agent.auto_rooms_on(), {})
        os.remove(f"{H}/.auto-off")
        os.remove(f"{H}/.auto-off-{TEST_ROOM}")
        os.remove(f"{H}/.auto-off-{BDC}")
        agent.AUTO_ROOMS[TEST_ROOM]["until"] = "2000-01-01T00:00:00-07:00"
        self.assertEqual(sorted(agent.auto_rooms_on()), sorted([ROOM, BDC]))

    def test_the_allowlist_as_shipped(self):
        self.assertEqual(sorted(REAL_ROOMS), sorted([ROOM, TEST_ROOM, BDC]), "only these three rooms are ever recorded by themselves")
        self.assertEqual(REAL_ROOMS[ROOM]["rule"], "jared+1")
        self.assertEqual((REAL_ROOMS[BDC]["rule"], REAL_ROOMS[BDC]["label"]), ("jared+1", "Eli & Jared - BDC Universal"))
        self.assertEqual(REAL_ROOMS[TEST_ROOM]["rule"], "any2")
        self.assertIn("2026-10-20", REAL_ROOMS[TEST_ROOM]["until"], "the rehearsal room switches itself off after Monday")
        self.assertNotIn("until", REAL_ROOMS[ROOM])
        self.assertNotIn("until", REAL_ROOMS[BDC])

    def test_jared_is_recognised_wherever_he_joins_from(self):
        yes = [("users", "jared", "Jared"), ("guests", "abc123", "Jared"), ("emails", "abc123", "Jared Best"),
               ("guests", "abc123", "Jared (Studio)"), ("guests", "abc123", "jared [iPhone]"), ("users", "jared", "")]
        no = [("users", "eli", "Eli Cooper"), ("guests", "abc", "Jaredson"), ("guests", "abc", "Jared Smith"),
              ("users", "elizabeth", "Elizabeth O'Brien"), ("guests", "abc", "")]
        for typ, ident, name in yes:
            self.assertTrue(agent.is_jared({"type": typ, "id": ident, "name": name}), (typ, ident, name))
        for typ, ident, name in no:
            self.assertFalse(agent.is_jared({"type": typ, "id": ident, "name": name}), (typ, ident, name))
        # Jared on a guest seat with Elizabeth: the rule holds; Jared on two seats alone: it does not
        W.put(ROOM, [("Jared", "guests", True, 0, 1), ("elizabeth", "users", True, 0, 1)])
        self.assertTrue(agent.rule_holds("jared+1", agent.room_people(ROOM)))
        W.put(ROOM, [("Jared", "guests", True, 0, 1), ("jared", "users", True, 0, 1)])
        self.assertFalse(agent.rule_holds("jared+1", agent.room_people(ROOM)), "two seats of Jared are still one person")


class AutoTickTests(unittest.TestCase):
    def setUp(self):
        setup_world()

    def test_starts_once_after_twenty_seconds_with_the_room_and_roster(self):
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(15)
        self.assertEqual(W.opens, 0, "20 seconds have not passed yet")
        run_for(20)
        self.assertEqual(W.opens, 1)
        self.assertTrue(W.recording)
        cur = json.load(open(agent.AUTO_FILE))
        self.assertEqual(cur["room"], ROOM)
        name = cur["name"]
        meta = agent.read_meta(name)
        self.assertEqual((meta["room"], meta["auto"], meta["title"]), (ROOM, True, "Centering YOU"))
        self.assertEqual(open(f"{H}/.roster").read().strip(), "elizabeth")
        run_for(120)
        self.assertEqual(W.opens, 1, "never starts twice")

    def test_the_eli_and_jared_room_records_and_has_no_client(self):
        W.put(BDC, ["jared", "eli"])
        run_for(15)
        self.assertEqual(W.opens, 0)
        run_for(25)
        self.assertEqual(W.opens, 1)
        cur = json.load(open(agent.AUTO_FILE))
        name = cur["name"]
        self.assertEqual(cur["room"], BDC)
        self.assertEqual(agent.read_meta(name)["title"], "Eli & Jared - BDC Universal")
        self.assertEqual(open(f"{H}/.roster").read().strip(), "eli")
        summary = agent.auto_summary()["rooms"][BDC]
        self.assertEqual((summary["people"], summary["jared"], summary["ok"]), (2, True, True))
        self.assertEqual(sorted(summary["names"]), ["Eli", "Jared"])
        W.put(BDC, [])
        run_for(100)
        self.assertEqual(W.stops, 1)
        ing = [c for c in W.calls if c.get("op") == "ingest"]
        self.assertEqual((ing[0]["name"], ing[0]["room"]), (name, BDC))
        self.assertIsNone(W.rows[name]["client_slug"], "no client lives in this room")
        self.assertEqual(W.dav_calls, [], "nothing is filed in a client folder")
        self.assertTrue(agent.read_meta(name).get("verified"))
        self.assertEqual(W.kinds("nofile"), [])

    def test_eli_alone_or_eli_and_a_guest_without_jared_is_not_recorded(self):
        W.put(BDC, ["eli"])
        run_for(60)
        W.put(BDC, ["eli", ("someone", "guests", True, 0, 1)])
        run_for(60)
        self.assertEqual(W.opens, 0)

    def test_a_blip_does_not_start_a_recording(self):
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(10)
        W.put(ROOM, ["jared"])
        run_for(10)
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(15)
        self.assertEqual(W.opens, 0)

    def test_stops_after_ninety_seconds_with_nobody_in_the_call(self):
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(40)
        name = json.load(open(agent.AUTO_FILE))["name"]
        W.put(ROOM, ["elizabeth"])                          # Jared leaves; Elizabeth is still a human in the call
        run_for(300)
        self.assertEqual(W.stops, 0)
        W.put(ROOM, [])
        run_for(80)
        self.assertEqual(W.stops, 0, "only 80 seconds yet")
        run_for(20)
        self.assertEqual(W.stops, 1)
        self.assertFalse(os.path.exists(agent.AUTO_FILE))
        ing = [c for c in W.calls if c.get("op") == "ingest"]
        self.assertEqual(len(ing), 1)
        self.assertEqual((ing[0]["name"], ing[0]["room"]), (name, ROOM))
        self.assertEqual(W.rows[name]["client_slug"], "centering-you")

    def test_the_bot_alone_in_the_call_does_not_keep_it_recording(self):
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(40)
        W.put(ROOM, ["scout-notetaker"])
        run_for(100)
        self.assertEqual(W.stops, 1)

    def test_four_hour_cap(self):
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(40)
        run_for(4 * 3600 - 100, step=10)
        self.assertEqual(W.stops, 0)
        run_for(200, step=10)
        self.assertEqual(W.stops, 1)

    def test_no_second_recording_until_the_rule_has_been_false_a_while(self):
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(40)
        W.put(ROOM, [])
        run_for(100)
        self.assertEqual((W.opens, W.stops), (1, 1))
        W.put(ROOM, ["jared", "elizabeth"])                  # they come straight back
        run_for(60)
        self.assertEqual(W.opens, 2, "a new call after the last one is over records")

    def test_a_manual_recording_wins_and_is_not_stopped(self):
        W.recording = True
        open(f"{H}/.current", "w").write("meeting-20261020-0855")
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(120)
        self.assertEqual(W.opens, 0)
        W.put(ROOM, [])
        run_for(300)
        self.assertEqual(W.stops, 0)

    def test_a_manual_recording_ending_mid_call_is_not_restarted(self):
        W.recording = True
        open(f"{H}/.current", "w").write("meeting-20261020-0855")
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(60)
        W.recording = False                                   # Jared pressed Stop & Transcribe
        run_for(120)
        self.assertEqual(W.opens, 0)

    def test_excluded_rooms(self):
        agent.AUTO_ROOMS["selft"] = {"rule": "any2", "label": "x"}
        agent.AUTO_ROOMS["onetoone"] = {"rule": "any2", "label": "x"}
        W.rooms["selft"] = {"type": 3, "name": "Scout self-test", "call": True,
                            "people": [("a", "users", True, 0, 1), ("b", "users", True, 0, 1)]}
        W.rooms["onetoone"] = {"type": 1, "name": "Eli", "call": True,
                               "people": [("a", "users", True, 0, 1), ("b", "users", True, 0, 1)]}
        run_for(60)
        self.assertEqual(W.opens, 0)
        agent.AUTO_ROOMS.pop("selft")
        agent.heal["test_room"] = "heal123"
        agent.AUTO_ROOMS["heal123"] = {"rule": "any2", "label": "x"}
        W.rooms["heal123"] = {"type": 3, "name": "whatever", "call": True,
                              "people": [("a", "users", True, 0, 1), ("b", "users", True, 0, 1)]}
        run_for(60)
        self.assertEqual(W.opens, 0)

    def test_not_while_the_last_call_is_still_being_saved(self):
        agent.busy["stage"] = "transcribing"
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(60)
        self.assertEqual(W.opens, 0)
        agent.busy["stage"] = None
        run_for(10)
        self.assertEqual(W.opens, 1)

    def test_start_failure_is_retried_and_reported_after_two_minutes(self):
        W.start_fails = 999
        W.put(ROOM, ["jared", "elizabeth"])
        t0 = W.clock.now
        for _ in range(400):
            run_for(1)
            if W.kinds("autostart"):
                break
        self.assertEqual(W.kinds("autostart"), ["problem"])
        self.assertGreaterEqual(W.clock.now - t0, 120, "not before two minutes")
        self.assertLess(W.clock.now - t0, 200)
        self.assertGreaterEqual(W.opens, 4, "it kept trying: two attempts each time")
        W.start_fails = 0
        run_for(60)
        self.assertTrue(W.recording)
        self.assertEqual(W.kinds("autostart"), ["problem", "resolved"])

    def test_talk_down_is_reported_after_five_minutes_and_clears(self):
        W.talk_down = True
        run_for(400, step=2)
        self.assertEqual(W.kinds("talkread"), ["problem"])
        W.talk_down = False
        run_for(120, step=2)
        self.assertEqual(W.kinds("talkread"), ["problem", "resolved"])

    def test_the_rehearsal_room_switches_off(self):
        W.put(TEST_ROOM, [("calltest", "users", True, 0, 2)])
        open(f"{H}/.auto-off-{TEST_ROOM}", "w").close()
        run_for(60)
        self.assertEqual(W.opens, 0)
        os.remove(f"{H}/.auto-off-{TEST_ROOM}")
        run_for(40)
        self.assertEqual(W.opens, 1)
        self.assertEqual(agent.read_meta(open(f"{H}/.current").read().strip())["room"], TEST_ROOM)

    def test_the_log_says_when_the_rule_holds_and_when_the_call_empties(self):
        logs, orig_log = [], agent.log
        agent.log = lambda *a: logs.append(" ".join(str(x) for x in a))
        self.addCleanup(setattr, agent, "log", orig_log)
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(40)
        self.assertEqual(len([m for m in logs if m.startswith("auto-record: the rule holds in " + ROOM)]), 1, "once, not every loop")
        W.put(ROOM, [])
        run_for(30)
        self.assertEqual(len([m for m in logs if "nobody is in the call" in m]), 1)
        W.put(ROOM, ["elizabeth"])                          # someone comes back before the 90 seconds are over
        run_for(10)
        self.assertEqual(len([m for m in logs if "someone is back" in m]), 1)
        self.assertEqual(W.stops, 0)
        W.put(ROOM, [])
        run_for(100)
        self.assertEqual(W.stops, 1)
        self.assertEqual(len([m for m in logs if "nobody is in the call" in m]), 2)

    def test_a_test_room_is_recorded_but_never_reported(self):
        # the rehearsal room: the recorder works there like anywhere, but nothing about it reaches Scout's alerts or the Mac's banners
        banners, logs, orig_log = [], [], agent.log
        agent.notify = lambda *a, **k: banners.append(a)
        agent.log = lambda *a: logs.append(" ".join(str(x) for x in a))
        self.addCleanup(setattr, agent, "log", orig_log)
        W.start_fails = 999
        W.put(TEST_ROOM, [("calltest", "users", True, 0, 2)])
        run_for(400)
        self.assertEqual(W.health, [], "a test room's trouble is not reported")
        self.assertTrue([m for m in logs if m.startswith("watchdog: a test-room call")], logs[-5:])
        self.assertEqual(len([m for m in logs if m.startswith("watchdog: a test-room call")]), 1, "once, not every loop")
        W.start_fails = 0
        run_for(60)
        self.assertTrue(W.recording)
        self.assertEqual(banners, [], "no banner on the Mac when a test recording starts")
        W.put(TEST_ROOM, [])
        run_for(100)
        self.assertEqual(W.stops, 1)
        self.assertEqual(banners, [], "...or when it stops")
        self.assertEqual(W.health, [])
        self.assertEqual(agent.auto_summary()["test"], [TEST_ROOM])

    def test_a_real_room_still_shows_banners_and_alerts(self):
        banners = []
        agent.notify = lambda *a, **k: banners.append(a)
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(40)
        W.put(ROOM, [])
        run_for(100)
        self.assertEqual([b[0] for b in banners], ["Recording", "Recording stopped"])

    def test_a_test_rooms_calls_do_not_hide_a_real_rooms_alert(self):
        W.start_fails = 999
        W.put(ROOM, ["jared", "elizabeth"])
        W.put(TEST_ROOM, [("calltest", "users", True, 0, 2)])
        run_for(400)
        self.assertEqual(W.kinds("autostart"), ["problem"])
        self.assertIn("Centering YOU", [t for (k, _kind, t, _s) in W.health if k == "autostart"][0])

    def test_three_recordings_an_hour_at_most(self):
        for _ in range(3):
            W.put(ROOM, ["jared", "elizabeth"])
            run_for(40)
            W.put(ROOM, [])
            run_for(130)
        self.assertEqual(W.opens, 3)
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(100)
        self.assertEqual(W.opens, 3)
        self.assertIn("recordings in the last hour", agent.auto["last_error"])

    def test_a_forgotten_manual_recording_is_mentioned(self):
        W.recording = True
        open(f"{H}/.current", "w").write("meeting-20261020-0855")
        open(f"{H}/.started", "w").write(str(int(W.clock.now)))
        run_for(4 * 3600 + 60, step=30)
        self.assertEqual(W.kinds("longrec"), ["problem"])
        W.recording = False
        run_for(60)
        self.assertEqual(W.kinds("longrec"), ["problem", "resolved"])

    def test_a_recorder_that_dies_is_reported_and_restarted(self):
        W.put(ROOM, ["jared", "elizabeth"])
        run_for(40)
        W.recording = False                                   # talkrec crashed: no stop, no transcript
        run_for(60)
        self.assertEqual(W.kinds("nofile"), ["problem"])
        self.assertEqual(W.opens, 2, "the rest of the call is recorded")


class StartTests(unittest.TestCase):
    def setUp(self):
        setup_world()

    def test_two_recordings_in_one_minute_get_different_names(self):
        ok1, r1, _ = agent.do_start({"roster": ["a"]})
        W.recording = False
        open(f"{REC}/{r1['name']}-transcript.txt", "w").write("x")
        ok2, r2, _ = agent.do_start({"roster": ["b"]})
        self.assertTrue(ok1 and ok2)
        self.assertNotEqual(r1["name"], r2["name"])

    def test_refuses_while_recording_or_transcribing(self):
        agent.do_start({"roster": []})
        ok, _r, err = agent.do_start({"roster": []})
        self.assertFalse(ok)
        self.assertIn("Already recording", err)
        W.recording = False
        agent.busy["stage"] = "transcribing"
        ok, _r, err = agent.do_start({"roster": []})
        self.assertFalse(ok)
        self.assertIn("transcribing", err)

    def test_a_bad_room_is_ignored_and_a_manual_start_has_no_auto_marker(self):
        ok, r, _ = agent.do_start({"roster": ["Bad Name", "ok-name"], "room": "../../etc"})
        self.assertTrue(ok)
        self.assertEqual(r["roster"], ["ok-name"])
        self.assertIsNone(r["room"])
        self.assertFalse(os.path.exists(agent.AUTO_FILE))
        self.assertEqual(agent.read_meta(r["name"]).get("auto"), None)

    def test_it_tries_twice_then_says_why(self):
        W.start_fails = 999
        ok, _r, err = agent.do_start({"roster": []})
        self.assertFalse(ok)
        self.assertEqual(W.opens, 2)
        self.assertIn("didn't start", err)
        self.assertFalse(os.path.exists(f"{H}/.pending-name"))

    def test_second_try_works(self):
        W.start_fails = 1
        ok, _r, _ = agent.do_start({"roster": []})
        self.assertTrue(ok)
        self.assertEqual(W.opens, 2)


class AfterTests(unittest.TestCase):
    def setUp(self):
        setup_world()
        self.name = "meeting-20261020-0900"
        for s in ("system", "mic"):
            open(f"{REC}/{self.name}-{s}.m4a", "w").write("x")
        open(f"{REC}/{self.name}-transcript.txt", "w").write("[00:00] JARED: hi\n")
        agent.write_meta(self.name, room=ROOM, auto=True)

    def test_filed_under_the_client_folder_once(self):
        W.rows[self.name] = {"client_slug": "centering-you", "room": ROOM}
        agent.after_save(self.name, True)
        copies = [c for c in W.dav_calls if c[0] == "COPY"]
        self.assertEqual(len(copies), 3)
        self.assertTrue(copies[0][1].startswith("Meeting Recordings/2026-10-20/"))
        self.assertIn("Bestly/CenteringYOU/Calls/2026-10-20/", copies[0][2])
        mk = [c[1] for c in W.dav_calls if c[0] == "MKCOL"]
        self.assertEqual(mk, ["Bestly", "Bestly/CenteringYOU", "Bestly/CenteringYOU/Calls", "Bestly/CenteringYOU/Calls/2026-10-20"])
        self.assertTrue(agent.read_meta(self.name)["verified"])
        n = len(W.dav_calls)
        agent.after_save(self.name, True)
        self.assertEqual(len(W.dav_calls), n, "already filed")

    def test_a_shared_client_folder_is_never_written_to(self):
        W.rows[self.name] = {"client_slug": "centering-you", "room": ROOM}
        W.shared = ["/Bestly/CenteringYOU"]
        agent.after_save(self.name, True)
        self.assertEqual([c for c in W.dav_calls if c[0] in ("COPY", "PUT", "MKCOL")], [])
        self.assertEqual(W.kinds("clientfile"), ["problem"])

    def test_missing_day_file_is_uploaded_from_the_mac(self):
        W.rows[self.name] = {"client_slug": "bestly-test", "room": TEST_ROOM}
        W.dav_code["COPY"] = 404
        agent.after_save(self.name, True)
        puts = [c for c in W.dav_calls if c[0] == "PUT"]
        self.assertEqual(len(puts), 3)
        self.assertTrue(puts[0][1].startswith("Bestly/_admin/test-client-calls/2026-10-20/"))
        self.assertEqual(W.kinds("clientfile"), ["resolved"])

    def test_other_clients_and_no_client_are_left_alone(self):
        W.rows[self.name] = {"client_slug": None, "room": None}
        agent.after_save(self.name, True)
        self.assertEqual(W.dav_calls, [])

    def test_a_failed_stop_is_reported_at_once(self):
        agent.after_save(self.name, False, "No transcript came out. boom", "tail")
        self.assertEqual(W.kinds("nofile"), ["problem"])

    def test_row_check_after_forty_five_minutes(self):
        agent.write_meta(self.name, ended=W.clock.now)
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), [])
        W.clock.advance(44 * 60)
        agent.auto["verify_next"] = 0
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), [], "not yet")
        W.clock.advance(2 * 60)
        agent.auto["verify_next"] = 0
        agent.verify_tick(W.clock.now)                         # the transcript is here: it is sent now instead of alerting
        self.assertEqual(W.kinds("nofile"), [])
        self.assertIn(self.name, W.rows)
        W.rows.pop(self.name)                                  # ...and if it still isn't there
        os.remove(f"{REC}/{self.name}-transcript.txt")
        agent.write_meta(self.name, recheck=0)
        agent.auto["verify_next"] = 0
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), ["problem"])
        agent.auto["verify_next"] = 0
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), ["problem"], "once")
        W.clock.advance(11 * 60)
        W.rows[self.name] = {"client_slug": "centering-you", "room": ROOM}
        agent.auto["verify_next"] = 0
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), ["problem", "resolved"])
        self.assertTrue(agent.read_meta(self.name)["verified"])

    def test_a_deleted_meeting_is_not_a_missing_one(self):
        agent.write_meta(self.name, ended=W.clock.now - 3600)
        W.deleted.add(self.name)
        os.remove(f"{REC}/{self.name}-transcript.txt")
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), [])
        self.assertTrue(agent.read_meta(self.name)["verified"])

    def test_cannot_ask_is_not_an_alert(self):
        agent.write_meta(self.name, ended=W.clock.now - 3600)
        W.ask_fails = True
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), [])
        self.assertFalse(agent.read_meta(self.name).get("verified"))

    def test_a_test_recording_never_alerts_and_never_closes_a_real_alert(self):
        test_name = "meeting-20261020-0910"
        for s in ("system", "mic"):
            open(f"{REC}/{test_name}-{s}.m4a", "w").write("x")
        agent.write_meta(test_name, room=TEST_ROOM, auto=True, ended=W.clock.now - 7200)
        # a real recording has an open alert; a test recording being found must not close it, and a lost test recording must not raise one
        agent.alert_nofile(self.name, "boom")
        self.assertEqual(W.kinds("nofile"), ["problem"])
        agent.after_save(test_name, False, "No transcript came out. boom", "tail")
        agent.verify_tick(W.clock.now)                                  # 45 minutes passed, no row, no transcript
        agent.auto["verify_next"] = 0
        agent.verify_tick(W.clock.now)
        W.rows[test_name] = {"client_slug": "bestly-test", "room": TEST_ROOM}
        agent.write_meta(test_name, alerted=True, recheck=0)
        agent.auto["verify_next"] = 0
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), ["problem"], "nothing from the test recording, neither a new problem nor a 'resolved'")
        self.assertEqual(W.kinds("clientfile"), [])
        copies = [c for c in W.dav_calls if c[0] == "COPY"]
        self.assertTrue(copies and "test-client-calls" in copies[0][2], "it is still filed in the test client's folder")

    def test_other_rooms_are_not_watched(self):
        name = "meeting-20261019-1400"
        open(f"{REC}/{name}-system.m4a", "w").write("x")
        agent.write_meta(name, room="zzzzzzzz", ended=W.clock.now - 7200)
        agent.verify_tick(W.clock.now)
        self.assertEqual(W.kinds("nofile"), [])


class NotetakerTickTests(unittest.TestCase):
    def setUp(self):
        setup_world()
        os.makedirs(agent.NT_DIR, exist_ok=True)
        open(f"{agent.NT_DIR}/notetaker.js", "w").write("//")
        self.launched = []
        self.posted = []

        class P:
            def __init__(s):
                s.returncode = None

            def poll(s):
                return s.returncode

        def popen(cmd, **kw):
            self.launched.append(cmd)
            return P()
        agent.subprocess = types.SimpleNamespace(run=W.run, Popen=popen, PIPE=-1, STDOUT=-2, DEVNULL=-3)
        agent.selftest_lock = threading.Lock()
        agent.os.makedirs(f"{REC}", exist_ok=True)

    def start(self, room=ROOM):
        W.recording = True
        open(f"{H}/.current", "w").write("meeting-20261020-0900")
        agent.write_meta("meeting-20261020-0900", room=room, title="Centering YOU", auto=True)

    def test_does_not_launch_until_the_call_is_live(self):
        self.start()
        W.rooms[ROOM]["call"] = False
        orig = agent.talk
        agent.talk = lambda m, p, d=None, timeout=15: orig(m, p, d, timeout) if m == "GET" else {}
        agent.notetaker_tick()
        self.assertEqual(self.launched, [])
        self.assertEqual(agent.nt["status"], "waiting for the call")
        W.rooms[ROOM]["call"] = True
        W.clock.advance(20)
        agent.notetaker_tick()
        self.assertEqual(len(self.launched), 1)
        self.assertEqual(self.launched[0][2], ROOM)

    def test_exit_four_is_not_a_failure_and_five_is(self):
        self.start()
        W.rooms[ROOM]["call"] = True
        orig = agent.talk
        agent.talk = lambda m, p, d=None, timeout=15: orig(m, p, d, timeout) if m == "GET" else {}
        agent.notetaker_tick()
        proc = agent.nt["proc"]
        proc.returncode = agent.NT_NOT_LIVE
        agent.notetaker_tick()
        self.assertEqual(agent.nt["fails"], 0)
        self.assertEqual(W.kinds("notetaker"), [])
        W.clock.advance(30)
        agent.notetaker_tick()
        agent.nt["proc"].returncode = agent.NT_LOST_CALL
        agent.notetaker_tick()
        self.assertEqual(agent.nt["fails"], 1)
        self.assertEqual(W.kinds("notetaker"), ["problem"])

    def test_a_test_rooms_notetaker_trouble_is_not_reported(self):
        self.start(TEST_ROOM)
        W.rooms[TEST_ROOM]["call"] = True
        orig = agent.talk
        agent.talk = lambda m, p, d=None, timeout=15: orig(m, p, d, timeout) if m == "GET" else {}
        agent.notetaker_tick()
        self.assertEqual(len(self.launched), 1)
        self.assertEqual(self.launched[0][2], TEST_ROOM)
        agent.nt["proc"].returncode = agent.NT_LOST_CALL
        agent.notetaker_tick()
        self.assertEqual(agent.nt["fails"], 1, "it still counts and retries")
        self.assertEqual(W.kinds("notetaker"), [], "but says nothing")


if __name__ == "__main__":
    unittest.main()
