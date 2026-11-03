import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "meet"))
import meetwatch as mw  # noqa: E402


def snap(t, name, text):
    return {"t": int(t * 1000), "name": name, "text": text}


class Utterances(unittest.TestCase):
    def test_growing_caption_is_one_utterance(self):
        u = mw.build_utterances([snap(100, "Eli Cooper", "Hello"), snap(101, "Eli Cooper", "Hello everyone"), snap(102, "Eli Cooper", "Hello everyone this is Eli")])
        self.assertEqual(len(u), 1)
        self.assertEqual(u[0]["text"], "Hello everyone this is Eli")
        self.assertEqual((u[0]["t0"], u[0]["t1"]), (100, 102))

    def test_scrolling_caption_appends(self):
        u = mw.build_utterances([snap(100, "Sam", "one two three four five six"), snap(104, "Sam", "five six seven eight nine")])
        self.assertEqual(u[0]["text"], "one two three four five six seven eight nine")

    def test_two_speakers_and_gap(self):
        u = mw.build_utterances([snap(100, "Eli", "hi there"), snap(103, "Sam", "hello"), snap(140, "Eli", "back again")])
        self.assertEqual([x["name"] for x in u], ["Eli", "Sam", "Eli"])

    def test_you_is_ignored(self):
        self.assertEqual(mw.build_utterances([snap(1, "You", "x y")]), [])


class Transcript(unittest.TestCase):
    utts = [{"name": "Eli Cooper", "t0": 1000.0, "t1": 1006.0, "text": "welcome everyone"}, {"name": "Samantha Cauthon", "t0": 1010.0, "t1": 1020.0, "text": "thanks for having me"}]

    def test_names_from_captions(self):
        lines, people, src = mw.build_transcript([(1.0, "welcome everyone"), (11.0, "thanks for having me")], self.utts, 1000.0)
        self.assertEqual(lines[0], "[00:01] ELI-COOPER: welcome everyone")
        self.assertEqual(lines[1], "[00:11] SAMANTHA-CAUTHON: thanks for having me")
        self.assertEqual(src, "audio+captions")

    def test_captions_only_fallback(self):
        lines, people, src = mw.build_transcript([], self.utts, 1000.0)
        self.assertEqual(src, "captions")
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("[00:00] ELI-COOPER"))

    def test_audio_only(self):
        lines, people, src = mw.build_transcript([(2.0, "hello")], [], 1000.0)
        self.assertEqual(lines, ["[00:02] SPEAKER: hello"])
        self.assertEqual(src, "audio")

    def test_nothing(self):
        self.assertEqual(mw.build_transcript([], [], 0)[2], "none")

    def test_jared_label(self):
        self.assertEqual(mw.label("Jared Best"), "JARED")
        self.assertEqual(mw.label("Jared (phone)"), "JARED")
        self.assertEqual(mw.label("Elizabeth O'Brien"), "ELIZABETH-OBRIEN")


class Roster(unittest.TestCase):
    def test_roster_from_guests(self):
        r = mw.roster_from(["eli.cooper@bdcuniversal.com", "samantha@prairiemovement.com", "elizabethobrienlpc@gmail.com", "jared@bestly.tech"], ["Jared Best", "Samantha Cauthon"])
        self.assertEqual(r, ["eli-cooper", "sam-cauthon", "elizabeth-obrien"])

    def test_unknown_guest_and_caption_name(self):
        r = mw.roster_from(["jane.doe@example.com"], ["Pat Lee"])
        self.assertEqual(r, ["jane-doe", "pat-lee"])

    def test_client_and_name(self):
        row = {"title": "Centering YOU / Sam Cauthon Intro Call", "starts_at": "2026-11-04T19:00:00+00:00"}
        self.assertEqual(mw.client_for(row), "centering-you")
        self.assertEqual(mw.rec_name(row), "meeting-20261104-1100")


if __name__ == "__main__":
    unittest.main()
