import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "meet"))
import meetparse  # noqa: E402

SUBJ = "Invitation: Centering YOU / Sam Cauthon Intro Call @ Wed Nov 4, 2026\r\n 11am - 12pm (PST) (jared@bestly.tech)"
BODY = (
    "Centering YOU / Sam Cauthon Intro Call\r\nWednesday Nov 4, 2026 ⋅ 11am – 12pm\r\nPacific Time - Los Angeles\r\n\r\n"
    "Join with Google Meet\r\nhttps://meet.google.com/ipo-zswm-jeh?hs=224\r\n\r\n\r\n\t\r\nJoin by phone\r\n(US) +1 319-343-8946\r\nPIN: 845197476\r\n\r\n"
    "Organizer\r\nEli Cooper\r\neli.cooper@bdcuniversal.com\r\n\r\nGuests\r\nEli Cooper - organizer\r\nsamantha@prairiemovement.com\r\n"
    "elizabethobrienlpc@gmail.com\r\njared@bestly.tech\r\nView all guest info  \r\n"
    "https://calendar.google.com/calendar/event?action=VIEW&eid=NzV0M2hrb2JyZWJkN3Q5cnBrZmh1aXBvZ20gamFyZWRAYmVzdGx5LnRlY2g&tok=Mjcj&ctz=America%2FLos_Angeles\r\n"
)


class ParseInvite(unittest.TestCase):
    def test_sam_call(self):
        r = meetparse.parse_invite(SUBJ, BODY, None, "mail-1")
        self.assertEqual(r["meet_code"], "ipo-zswm-jeh")
        self.assertEqual(r["title"], "Centering YOU / Sam Cauthon Intro Call")
        self.assertEqual(r["starts_at"], "2026-11-04T19:00:00+00:00")   # 11 AM PST = 19:00 UTC
        self.assertEqual(r["ends_at"], "2026-11-04T20:00:00+00:00")
        self.assertEqual(r["organizer"], "eli.cooper@bdcuniversal.com")
        self.assertIn("samantha@prairiemovement.com", r["guests"])
        self.assertIn("elizabethobrienlpc@gmail.com", r["guests"])
        self.assertEqual(r["google_event_id"], "75t3hkobrebd7t9rpkfhuipogm")
        self.assertEqual(r["event_key"], "m:75t3hkobrebd7t9rpkfhuipogm")

    def test_dst_summer(self):
        b = BODY.replace("Wednesday Nov 4, 2026", "Thursday Aug 20, 2026").replace("11am – 12pm", "12pm – 1pm")
        r = meetparse.parse_invite("Invitation: X @ Thu Aug 20, 2026 12pm - 1pm (PDT)", b)
        self.assertEqual(r["starts_at"], "2026-08-20T19:00:00+00:00")  # PDT = UTC-7

    def test_start_without_suffix(self):
        b = BODY.replace("11am – 12pm", "10 – 11am")
        r = meetparse.parse_invite(SUBJ, b)
        self.assertEqual(r["starts_at"], "2026-11-04T18:00:00+00:00")

    def test_half_hour_and_crossing_noon(self):
        b = BODY.replace("11am – 12pm", "11:30am – 12:30pm")
        r = meetparse.parse_invite(SUBJ, b)
        self.assertEqual(r["starts_at"], "2026-11-04T19:30:00+00:00")
        self.assertEqual(r["ends_at"], "2026-11-04T20:30:00+00:00")

    def test_updated_invitation_same_key(self):
        r1 = meetparse.parse_invite(SUBJ, BODY)
        r2 = meetparse.parse_invite("Updated invitation: Centering YOU / Sam Cauthon Intro Call @ Wed Nov 4, 2026 1pm - 2pm (PST)",
                                    BODY.replace("11am – 12pm", "1pm – 2pm"))
        self.assertEqual(r1["event_key"], r2["event_key"])
        self.assertEqual(r2["starts_at"], "2026-11-04T21:00:00+00:00")
        self.assertEqual(r2["title"], "Centering YOU / Sam Cauthon Intro Call")

    def test_no_meet_link(self):
        self.assertIsNone(meetparse.parse_invite(SUBJ, BODY.replace("meet.google.com", "example.com")))

    def test_other_timezone(self):
        b = BODY.replace("Pacific Time - Los Angeles", "Central Time - Chicago")
        r = meetparse.parse_invite(SUBJ, b)
        self.assertEqual(r["starts_at"], "2026-11-04T17:00:00+00:00")  # 11 AM CST = 17:00 UTC


class ParseCancel(unittest.TestCase):
    def test_cancel(self):
        c = meetparse.parse_cancel("Canceled event: Centering YOU Call @ Wed Aug 12, 2026 10:30am -\r\n 11:30am (PDT) (jared@bestly.tech)")
        self.assertEqual(c["title"], "Centering YOU Call")
        self.assertEqual(c["date"], "2026-08-12")

    def test_not_cancel(self):
        self.assertIsNone(meetparse.parse_cancel(SUBJ))
        self.assertIsNone(meetparse.parse_invite("Canceled event: X @ Wed Nov 4, 2026 11am - 12pm", BODY))


if __name__ == "__main__":
    unittest.main()
