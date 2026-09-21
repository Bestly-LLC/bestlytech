#!/bin/bash
# usage: start.sh [name] [roster]
#   roster: comma-separated names of everyone on the call besides Jared.
#           "-" means none given. With no roster argument at all, asks in a dialog.
cd "$HOME/MeetingRec"
NAME="${1:-meeting-$(date +%Y%m%d-%H%M)}"
ROSTER="$2"
# Scout (agent.py) can't record by itself: macOS only lets the Start Recording
# app capture the call. So it leaves the names here and opens that app, which
# runs this script with no arguments.
if [ -z "$ROSTER" ] && [ -f .pending-roster ] && [ $(( $(date +%s) - $(stat -f %m .pending-roster) )) -lt 120 ]; then
  ROSTER="$(cat .pending-roster)"
  [ -f .pending-name ] && NAME="$(cat .pending-name)"
  rm -f .pending-roster .pending-name
fi
if [ -z "$ROSTER" ]; then
  KNOWN=$(ls voices/*.npy 2>/dev/null | xargs -n1 basename 2>/dev/null | sed 's/\.npy$//' | grep -v '^jared$' | paste -sd',' - | sed 's/,/, /g')
  ROSTER=$(osascript -e "with timeout of 3600 seconds
    try
      text returned of (display dialog \"Who's on this call besides you? Separate names with commas. New names are fine - they get learned.\" & return & return & \"Known voices: $KNOWN\" default answer \"\" with title \"Meeting Recorder\" buttons {\"Cancel\",\"Start\"} default button \"Start\")
    end try
  end timeout" 2>/dev/null)
fi
[ "$ROSTER" = "-" ] && ROSTER=""
# normalise: lower-case, commas, no spaces inside a name
ROSTER=$(echo "$ROSTER" | tr 'A-Z' 'a-z' | sed 's/ and /,/g; s/[;&]/,/g' | tr -s ' ' | sed 's/ *, */,/g; s/^ *//; s/ *$//; s/ /-/g; s/[^a-z0-9,-]//g; s/,,*/,/g; s/^,//; s/,$//')
echo "$NAME" > .current
echo "$ROSTER" > .roster
date +%s > .started
rm -f .stage
nohup ./bin/talkrec "recordings/$NAME" > "recordings/$NAME.log" 2>&1 &
echo $! > .pid
sleep 2
echo "started: $NAME  roster=[$ROSTER]"
cat "recordings/$NAME.log"
