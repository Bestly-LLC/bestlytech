"""Tests for talk_tracks.py: whose lines come from where. The recorder's tools (ffmpeg, talkscribe) are replaced by tiny fakes.

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

    def setup(self, tracks, mic_minutes, jared_tsv):
        os.makedirs(f"{self.dir}/recordings/{self.name}-talk", exist_ok=True)
        manifest = {"token": "abcd1234", "tracks": []}
        for i, (nm, t0_s, t1_s, lines) in enumerate(tracks, 1):
            self.track(i, lines)
            manifest["tracks"].append({"file": f"track-{i}.webm", "trackId": str(i), "name": nm, "seen": {nm: 3},
                                       "t0": int((1000 + t0_s) * 1000), "t1": int((1000 + t1_s) * 1000)})
        json.dump(manifest, open(f"{self.dir}/recordings/{self.name}-talk/manifest.json", "w"))
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

    def test_the_mic_is_used_when_it_has_him(self):
        mic = [(i * 10, "word " * 12) for i in range(10)]                      # 120 words
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)]), ("Jared", 0, 600, [(i * 10, TALK) for i in range(10)])],
                      mic_minutes=10, jared_tsv=mic)
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 10)
        self.assertIn("# JARED = your own mic.", out)
        self.assertEqual([os.path.basename(p) for p in self.sb.scribed()], ["track-1.m4a"], "his Talk track was not even transcribed")

    def test_another_device(self):
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)]),
                       ("Jared (Studio)", 0, 600, [(20, TALK), (80, TALK), (200, TALK)])], mic_minutes=10, jared_tsv=[])
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 3)
        self.assertIn("# JARED = your Talk audio", out)
        self.assertIn("probably on another device", out)

    def test_a_mic_with_a_few_stray_words_is_still_replaced(self):
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK)]), ("Jared", 0, 600, [(20, TALK), (80, TALK), (200, TALK)])],
                      mic_minutes=10, jared_tsv=[(3, "uh huh")])
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 3)
        self.assertNotIn("uh huh", out)

    def test_the_mic_ended_early(self):
        mic = [(i * 10, "word " * 12) for i in range(5)]                       # his mic: first 50 seconds, plenty of words
        self.sb.setup([("Elizabeth", 0, 1200, [(5, TALK)]),
                       ("Jared", 0, 1200, [(10, TALK), (700, TALK), (900, TALK)])], mic_minutes=10, jared_tsv=mic)
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        lines = [ln for ln in out.splitlines() if "] JARED:" in ln]
        self.assertEqual(len(lines), 5 + 2, "the five mic lines plus the two Talk lines after the mic ended (10 minutes)")
        self.assertIn("ended at 10:00", out)

    def test_no_track_for_him_and_no_mic(self):
        self.sb.setup([("Elizabeth", 0, 600, [(5, TALK), (65, TALK)])], mic_minutes=10, jared_tsv=[])
        code, out, err = self.sb.run()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.count("] JARED:"), 0)
        self.assertEqual(out.count("] ELIZABETH:"), 2)


if __name__ == "__main__":
    unittest.main()
