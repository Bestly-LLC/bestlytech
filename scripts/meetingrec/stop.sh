#!/bin/bash
# Stop the recording, transcribe both tracks, name the speakers, upload.
# Run by "Stop & Transcribe.app" and by the Scout agent (SCOUT=1: no TextEdit).
cd "$HOME/MeetingRec"
NAME="$(cat .current 2>/dev/null)"
PID="$(cat .pid 2>/dev/null)"
ROSTER="$(cat .roster 2>/dev/null)"
stage() { echo "== $1 =="; echo "$1" > .stage; }

stage "stopping the recording"
[ -n "$PID" ] && kill -INT "$PID" 2>/dev/null
for i in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
ls -la "recordings/$NAME"-*.m4a

stage "transcribing"
./bin/talkscribe "recordings/$NAME-system.m4a" THEM  > "/tmp/$NAME.them.tsv"  2>/dev/null
./bin/talkscribe "recordings/$NAME-mic.m4a"    JARED > "/tmp/$NAME.jared.tsv" 2>/dev/null
python3 merge.py "/tmp/$NAME.them.tsv" "/tmp/$NAME.jared.tsv" > "recordings/$NAME-transcript.tmp" \
  && mv "recordings/$NAME-transcript.tmp" "recordings/$NAME-transcript.txt"
wc -l "recordings/$NAME-transcript.txt"

stage "naming speakers"
./.venv-diar/bin/python name_speakers.py "$NAME" "$ROSTER" 2>&1 | grep -v -i warn | tail -8

if [ -z "$SCOUT" ] && [ -f "recordings/$NAME-transcript-named.txt" ]; then
  open -e "recordings/$NAME-transcript-named.txt"
fi

stage "uploading to Nextcloud"
"$HOME/MeetingRec/upload.sh" "$NAME"
rm -f .stage
echo "== done: $NAME =="
