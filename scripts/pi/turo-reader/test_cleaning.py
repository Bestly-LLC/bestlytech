"""Tests for the 1.5.0 cleaning-report helpers (run: python3 test_cleaning.py). No network, no Turo."""
import importlib.util, os, sys, types, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.modules.setdefault("websockets", types.ModuleType("websockets"))
open_ = open
def fake_open(path, *a, **k):
    if str(path).endswith(".token"):
        import io; return io.StringIO("test-token")
    return open_(path, *a, **k)
import builtins; builtins.open = fake_open
spec = importlib.util.spec_from_file_location("reader", os.path.join(HERE, "reader.py"))
reader = importlib.util.module_from_spec(spec); spec.loader.exec_module(reader)
builtins.open = open_

H = 3600 * 1000
START, END = 1_791_770_400_000, 1_791_856_800_000  # Yuta: Oct 11 7:00 PM to Oct 12 7:00 PM PT


def img(uuid, role, step, t, typ=None):
    return {"uuid": uuid, "role": role, "step": step, "taken": t, "type": typ}


class Pick(unittest.TestCase):
    def test_windows(self):
        imgs = [
            img("in1", "HOST", "OWNER_CHECK_IN", START - 2 * H),
            img("in-old", "HOST", "OWNER_CHECK_IN", START - 30 * H),        # older than 24h before: not usable
            img("odo", "HOST", "OWNER_CHECK_OUT", END + H, "ODOMETER"),     # odometer: skipped
            img("out1", "HOST", "OWNER_CHECK_OUT", END + H),
            img("out-late", "HOST", "OWNER_CHECK_OUT", END + 30 * H),       # later than 24h after: not usable
            img("g1", "GUEST", "RENTER_CHECK_OUT", END - H),
            img("g-in", "GUEST", "RENTER_CHECK_IN", START),                 # guest pickup photos are not return photos
            img("trip", "GUEST", "TRIP_PHOTO", END),
        ]
        pre, post, guest = reader.pick_cleaning_photos(imgs, START, END)
        self.assertEqual([x["uuid"] for x in pre], ["in1"])
        self.assertEqual([x["uuid"] for x in post], ["out1"])
        self.assertEqual([x["uuid"] for x in guest], ["g1"])

    def test_missing_uuid_or_time(self):
        pre, post, guest = reader.pick_cleaning_photos([img(None, "HOST", "OWNER_CHECK_IN", START), img("x", "HOST", "OWNER_CHECK_OUT", None)], START, END)
        self.assertEqual((pre, post, guest), ([], [], []))

    def test_spread(self):
        self.assertEqual(reader.spread(list(range(60)), 5), [0, 15, 30, 44, 59])
        self.assertEqual(reader.spread([1, 2], 5), [1, 2])

    def test_iso_ms(self):
        self.assertEqual(reader.iso_ms("2026-10-12T02:00:00+00:00"), START)


if __name__ == "__main__":
    unittest.main()
