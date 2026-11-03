#!/bin/bash
# usage: upload.sh <meeting-name>
NAME="$1"
[ -z "$NAME" ] && NAME="$(cat "$HOME/MeetingRec/.current" 2>/dev/null)"
cd "$HOME/MeetingRec" || exit 1
PW=$(security find-generic-password -s "nextcloud-meetingrec" -a jared -w 2>/dev/null)
if [ -z "$PW" ]; then echo "!! no Nextcloud password in keychain"; exit 1; fi
B="https://cloud.bestly.tech/remote.php/dav/files/jared"
ROOT="Meeting%20Recordings"
# Destination day comes from the MEETING NAME (meeting-YYYYMMDD-HHMM), not from
# today's date. Previously a meeting recorded at 23:50 and post-processed after
# midnight landed in the wrong day folder, and back-filling older recordings
# filed every one of them under the day the back-fill happened to run.
if [[ "$NAME" =~ ^meeting-([0-9]{4})([0-9]{2})([0-9]{2})- ]]; then
  DAY="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
else
  DAY=$(date +%Y-%m-%d)
fi
curl -s -o /dev/null -u "jared:$PW" -X MKCOL "$B/$ROOT"
curl -s -o /dev/null -u "jared:$PW" -X MKCOL "$B/$ROOT/$DAY"
OK=0; FAIL=0
for f in "recordings/$NAME-system.m4a" "recordings/$NAME-mic.m4a" "recordings/$NAME-room.m4a" "recordings/$NAME-transcript.txt" "recordings/$NAME-transcript-named.txt" "recordings/$NAME-transcript-turns.txt"; do
  [ -f "$f" ] || continue
  bn=$(basename "$f")
  # chunked, resumable, size-verified (LAN first, then the tunnel); the old single PUT only if ncupload.py is missing
  if [ -f "$HOME/MeetingRec/ncupload.py" ]; then
    if python3 "$HOME/MeetingRec/ncupload.py" "$f" "Meeting Recordings/$DAY/$bn" >/dev/null 2>&1; then code=201; else code=000; fi
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" -u "jared:$PW" -T "$f" "$B/$ROOT/$DAY/$bn")
  fi
  case "$code" in
    20*) echo "  uploaded  $bn  ($(du -h "$f" | cut -f1))"; OK=$((OK+1)) ;;
    *)   echo "  FAILED    $bn  (HTTP $code)"; FAIL=$((FAIL+1)) ;;
  esac
done
echo "Nextcloud: Meeting Recordings/$DAY/  ($OK uploaded, $FAIL failed)"
