"""Tests for talk_tracks.py: whose lines come from where (1.10.2: Jared's Talk track first, the Mac mic only as a fallback and only
on a call he was in). The recorder's tools (ffmpeg, talkscribe) are replaced by tiny fakes.

    cd scripts/meetingrec && python3 -m unittest discover -s tests -v
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "talk_tracks.py")

# A "track file" in these tests is plain text: one "seconds|words" per line. The fake ffmpeg copies it (padded so it looks like
# audio) and the fake talkscribe turns the lines back into the tab-separated rows the real one prints.
FAKE_FFMPEG = r'''#!/bin/sh
# duration probe: ffmpeg -i FILE
if [ "$1" = "-i" ]; then
  if [ -f "$2" ]; then echo "  Duration: 00:$(head -1 "$2" | cut -d' ' -f2):00.00, start: 0" >&2; fi
  exit 0
fi
# convert: ... -i SRC ... OUT
src=""; out=""; prev=""
for a in "$@"; do [ "$prev" = "-i" ] && src="$a"; prev="$a"; out="$a"; done
cp "$src" "$out"
i=0; while [ $i -lt 300 ]; do echo "# padding padding padding padding" >> "$out"; i=$((i+1)); done
'''
FAKE_SCRIBE = r'''#!/bin/sh
echo "$1" >> "$(dirname "$0")/scribe.log"
grep '|' "$1" | while IFS='|' read -r sec words; do printf '%s\t%s\t%s\n' "$sec" "$sec" "$words"; done
'''


class Sandbox:
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="talktracks-")
        os.makedirs(f"{self.dir}/bin")
        os.makedirs(f"{self.dir}/recordings")
        shutil.copy(SCRIPT, f"{self.dir}/talk_tracks.py")
        for n, body in (("ffmpeg", FAKE_FFMPEG), ("talkscribe", FAKE_SCRIBE)):
            with open(f"{self.dir}/bin/{n}", "w") as f:
                f.write(body)
            os.chmod(f"{self.dir}/bin/{n}", 0o755)
        self.name = "meeting-20261020-0900-t%d" % os.getpid()

    def track(self, n, lines):
        with open(f"{self.dir}/recordings/{self.name}-talk/track-{n}.webm", "w") as f:
            f.write("\n".join(f"{s}|{w}" for s, w in lines) + "\n")

    def setup(self, tracks, mic_minutes, jared_tsv, meta=None, plain=None):
        """meta: what the agent noted ({"auto": True, "jared_seen": True}...); plain: stop.sh's merged transcript text."""
        if tracks is not None:
            os.makedirs(f"{self.dir}/recordings/{self.name}-talk", exist_ok=True)
            manifest = {"token": "abcd1234", "tracks": []}
            for i, (nm, t0_s, t1_s, lines) in enumerate(tracks, 1):
                self.track(i, lines)
                manifest["tracks"].append({"file": f"track-{i}.webm", "trackId": str(i), "name": nm, "seen": {nm: 3},
                                           "t0": int((1000 + t0_s) * 1000), "t1": int((1000 + t1_s) * 1000)})
            json.dump(manifest, open(f"{self.dir}/recordings/{self.name}-talk/manifest.json", "w"))
        if meta is not None:
            os.makedirs(f"{self.dir}/.meta", exist_ok=True)
            json.dump(meta, open(f"{self.dir}/.meta/{self.name}.json", "w"))
        if plain is not None:
            open(f"{self.dir}/recordings/{self.name}-transcript.txt", "w").write(plain)
        open(f"{self.dir}/.started", "w").write("1000")
        # the fake ffmpeg reads the minutes from the second word of the first line
        open(f"{self.dir}/recordings/{self.name}-mic.m4a", "w").write(f"x {mic_minutes}\n")
        with open(f"/tmp/{self.name}.jared.tsv", "w") as f:
            for sec, words in jared_tsv:
                f.write(f"{sec}\t{sec}\t{words}\n")

    def run(self):
        r = subprocess.run([sys.executable, f"{self.dir}/talk_tracks.py", self.name], capture_output=True, text=True)
        out = ""
        p = f"{self.dir}/recordings/{self.name}-transcript-named.txt"
        if os.path.exists(p):
            out = open(p).read()
        return r.returncode, out, r.stderr

    def plain(self):
        p = f"{self.dir}/recordings/{self.name}-transcript.txt"
        return open(p).read() if os.path.exists(p) else None

    def speakers(self):
        p = f"/tmp/{self.name}-speakers.json"
        return json.load(open(p)) if os.path.exists(p) else None

    def scribed(self):
        p = f"{self.dir}/bin/scribe.log"
        return open(p).read().split() if os.path.exists(p) else []

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)
        for p in (f"/tmp/{self.name}.jared.tsv", f"/tmp/{self.name}-speakers.json"):
            if os.path.exists(p):
                os.remove(p)


TALK = "one two three four five six seven eight nine ten eleven twelve"


class TalkTrackTests(unittest.TestCase):
    def setUp(self):
        self.sb = Sandbox()

    def tearDown(self):
        self.sb.close()

    def test_names(self):
        sys.path.insert(0, os.path.join(HERE, ".."))
        import re
        src = open(SCRIPT).read()
        ns = {"re": re}
        exec(src[src.index("JARED_RE ="):src.index("name = sys.argv[1]")], ns)
        yes = ["Jared", "jared", "Jared Best", "Jared (Studio)", "Jared Best - phone", "jared [iPhone]"]
        no = ["Elizabeth", "Jaredson", "Eli", "Guest", "Jared Smith", "", None]
        for n in yes:
            self.assertTrue(ns["is_jared"](n), n)
        for n in no:
            self.assertFalse(ns["is_jared"](n), n)

    def test_his_talk_track_is_the_source_even_when_the_mic_heard_more(self):
        mic = [(i * 10, "mic mic mic mic mic mic mic mic mic mic mic mic") for i in range(10)]           # 120 mic words
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)]), ("Jared", 0, 600, [(100, TALK), (200, TALK), (300, TALK)])],
                      mic_minutes=10, jared_tsv=mic, meta={"auto": True, "jared_seen": True})
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 3, "the three Talk lines, none of the ten mic lines")
        self.assertNotIn("mic mic", out)
        self.assertIn("# JARED = your Talk audio", out)
        self.assertEqual(sorted(os.path.basename(p) for p in self.sb.scribed()), ["track-1.m4a", "track-2.m4a"])
        self.assertEqual(self.sb.speakers()["jared"], {"in_call": True, "source": "talk"})

    def test_another_device(self):
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)]),
                       ("Jared (Studio)", 0, 600, [(20, TALK), (80, TALK), (200, TALK)])], mic_minutes=10, jared_tsv=[],
                      meta={"auto": True, "jared_seen": True})
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 3)
        self.assertIn("# JARED = your Talk audio", out)

    def test_a_mic_with_a_few_stray_words_is_ignored_when_his_talk_track_has_words(self):
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK)]), ("Jared", 0, 600, [(20, TALK), (80, TALK), (200, TALK)])],
                      mic_minutes=10, jared_tsv=[(3, "uh huh")], meta={"auto": True, "jared_seen": True})
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 3)
        self.assertNotIn("uh huh", out)

    def test_the_mic_stands_in_when_his_talk_track_is_empty_and_he_was_in_the_call(self):
        mic = [(i * 10, "from the mic " * 3) for i in range(6)]
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK)]), ("Jared", 0, 600, [(50, "thank you")])],
                      mic_minutes=10, jared_tsv=mic, meta={"auto": True, "jared_seen": True})
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 6)
        self.assertIn("from the mic", out)
        self.assertNotIn("thank you", out, "the two stray Talk words are not mixed in with the mic")
        self.assertIn("Your Talk audio".lower(), out.lower())
        self.assertIn("was empty", out)
        self.assertEqual(self.sb.speakers()["jared"], {"in_call": True, "source": "mic"})

    def test_the_mic_stands_in_when_he_has_no_talk_track_but_scout_saw_him_in_the_call(self):
        mic = [(i * 10, "from the mic " * 3) for i in range(6)]
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)])], mic_minutes=10, jared_tsv=mic,
                      meta={"auto": True, "jared_seen": True})
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 6)
        self.assertIn("was missing", out)
        self.assertEqual(self.sb.speakers()["jared"], {"in_call": True, "source": "mic"})

    def test_a_silent_track_under_his_name_is_proof_he_was_there(self):
        mic = [(i * 10, "from the mic " * 3) for i in range(6)]
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK)]), ("Jared", 0, 600, [])], mic_minutes=10, jared_tsv=mic,
                      meta={"auto": True})
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 6, "no jared_seen, but the notetaker recorded a track under his name")

    def test_when_jared_was_not_in_the_call_the_mic_is_never_used(self):
        ambient = [(i * 10, "music music music music music music") for i in range(12)]                 # the room's radio
        plain = ("[00:05] THEM: hello\n" + "".join("[00:%02d] JARED: music music music music music music\n" % (i * 10 % 60) for i in range(12)))
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)]), ("Call test seat", 0, 600, [(100, TALK)])],
                      mic_minutes=10, jared_tsv=ambient, meta={"auto": True, "room": "yqne2jpr"}, plain=plain)
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 0, out)
        self.assertNotIn("music", out)
        self.assertEqual(out.count("] ELIZABETH:"), 2)
        self.assertIn("Jared was not in this call, so the Mac mini's mic (72 words) was left out.", out)
        self.assertEqual(self.sb.speakers()["jared"], {"in_call": False, "source": "none"})
        self.assertNotIn("JARED:", self.sb.plain(), "the plain transcript is cleaned too (the ingest falls back to it)")
        self.assertIn("[00:05] THEM: hello", self.sb.plain(), "everything else in it stays")

    def test_when_jared_was_not_in_the_call_even_a_missing_notetaker_leaves_no_mic_lines(self):
        plain = "[00:05] THEM: hello there\n[00:09] JARED: ambient chatter\n[00:20] THEM: and again\n"
        self.sb.setup(None, mic_minutes=10, jared_tsv=[(9, "ambient chatter")], meta={"auto": True}, plain=plain)
        code, out, err = self.sb.run()
        self.assertEqual(code, 3, "no Talk tracks: stop.sh falls back to voice matching, which reads the plain transcript")
        self.assertEqual(self.sb.plain(), "[00:05] THEM: hello there\n[00:20] THEM: and again\n")

    def test_a_recording_started_by_hand_keeps_the_mic(self):
        plain = "[00:05] THEM: hello there\n[00:09] JARED: my own words here\n"
        self.sb.setup(None, mic_minutes=10, jared_tsv=[(9, "my own words here")], meta={"room": "abcd1234"}, plain=plain)
        code, out, err = self.sb.run()
        self.assertEqual(code, 3)
        self.assertEqual(self.sb.plain(), plain, "Jared started it at this Mac: the mic is his")

    def test_nothing_is_known_about_an_old_recording_so_the_mic_stays(self):
        mic = [(i * 10, "from the mic " * 3) for i in range(6)]
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)])], mic_minutes=10, jared_tsv=mic)        # no meta file at all
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 6)

    def test_no_track_for_him_and_no_mic(self):
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)])], mic_minutes=10, jared_tsv=[], meta={"auto": True, "jared_seen": True})
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 0)
        self.assertEqual(out.count("] ELIZABETH:"), 2)
        self.assertIn("No lines from you", out)


if __name__ == "__main__":
    unittest.main()
