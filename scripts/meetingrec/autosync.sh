#!/bin/bash
# autosync.sh — upload completed meeting recordings to Nextcloud.
#
# COPIES ONLY. curl -T reads the local file and PUTs it; nothing local is ever
# moved or deleted. start.sh/stop.sh/postprocess.sh all expect the files to stay
# in ~/MeetingRec/recordings (postprocess.sh does `ls -t recordings/*-transcript*`
# to find the newest transcript), so moving them would break the pipeline.
#
# WHY A WATCH + GUARDS, NOT A PLAIN SCHEDULE
# `start.sh` launches ./bin/talkrec in the background and it writes the .m4a
# files progressively for the whole meeting. A bare schedule would happily PUT a
# half-written file. But a bare WatchPaths trigger is no safer — it fires on
# every write flush *during* recording. So the LaunchAgent triggers on both a
# folder watch and a slow interval, and the real safety lives here, in three
# independent guards that must all pass before a file is uploaded:
#
#   1. ACTIVE RECORDING — if .pid names a live process, the meeting named in
#      .current is skipped outright.
#   2. QUIESCENCE — any file modified within QUIET_SECS is skipped. Covers the
#      transcription/labelling writes that land minutes after recording stops.
#   3. NO GROWTH — size is sampled twice, SETTLE_SECS apart. If it changed, skip.
#
# A manifest records what has already been uploaded (path|size|mtime), so a
# re-run is cheap and a transcript that gets relabelled later is re-uploaded
# without dragging its 80 MB of audio along with it.

set -uo pipefail

ROOT_DIR="$HOME/MeetingRec"
REC="$ROOT_DIR/recordings"
MANIFEST="$ROOT_DIR/.autosync-manifest"
LOCK="$ROOT_DIR/.autosync.lock"
LOG="$ROOT_DIR/autosync.log"

QUIET_SECS=90     # file must be untouched this long
SETTLE_SECS=5     # re-measure size after this gap

exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') autosync start ==="

# Single instance. The watch can fire several times in a row; overlapping runs
# would race on the manifest.
if ! mkdir "$LOCK" 2>/dev/null; then
  # Clear a lock orphaned by a crash/reboot rather than wedging forever.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
    echo "  stale lock (>60m) — clearing"
    rmdir "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null || { echo "  lock busy, exiting"; exit 0; }
  else
    echo "  another run in progress, exiting"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

cd "$ROOT_DIR" || exit 1
[ -d "$REC" ] || { echo "  no recordings dir"; exit 0; }

PW=$(security find-generic-password -s "nextcloud-meetingrec" -a jared -w 2>/dev/null)
if [ -z "$PW" ]; then echo "  !! no Nextcloud password in keychain"; exit 1; fi

B="https://cloud.bestly.tech/remote.php/dav/files/jared"
ROOT="Meeting%20Recordings"

# ---- Guard 1: is a recording in flight? -------------------------------------
ACTIVE=""
PID="$(cat "$ROOT_DIR/.pid" 2>/dev/null)"
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  ACTIVE="$(cat "$ROOT_DIR/.current" 2>/dev/null)"
  echo "  recording in progress (pid $PID) — holding back: $ACTIVE"
fi

touch "$MANIFEST"
NOW=$(date +%s)
UP=0; SKIP=0; FAIL=0; HELD=0

for f in "$REC"/meeting-*; do
  [ -f "$f" ] || continue
  bn="$(basename "$f")"

  # .log files are local scratch from talkrec; nothing downstream reads them.
  case "$bn" in *.log) continue ;; esac

  # meeting-YYYYMMDD-HHMM-<suffix>
  if [[ ! "$bn" =~ ^(meeting-([0-9]{4})([0-9]{2})([0-9]{2})-[0-9]{4})- ]]; then
    continue
  fi
  mtg="${BASH_REMATCH[1]}"
  day="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]}"

  # Guard 1
  if [ -n "$ACTIVE" ] && [ "$mtg" = "$ACTIVE" ]; then
    HELD=$((HELD+1)); continue
  fi

  size=$(stat -f%z "$f" 2>/dev/null) || continue
  mtime=$(stat -f%m "$f" 2>/dev/null) || continue

  # Already uploaded at this exact size+mtime?
  key="$bn|$size|$mtime"
  if grep -qxF "$key" "$MANIFEST" 2>/dev/null; then
    SKIP=$((SKIP+1)); continue
  fi

  # Guard 2: quiescence
  age=$(( NOW - mtime ))
  if [ "$age" -lt "$QUIET_SECS" ]; then
    echo "  holding  $bn (modified ${age}s ago, need ${QUIET_SECS}s)"
    HELD=$((HELD+1)); continue
  fi

  # Guard 3: confirm it is not still growing
  sleep "$SETTLE_SECS"
  size2=$(stat -f%z "$f" 2>/dev/null) || continue
  mtime2=$(stat -f%m "$f" 2>/dev/null) || continue
  if [ "$size" != "$size2" ] || [ "$mtime" != "$mtime2" ]; then
    echo "  holding  $bn (still changing: ${size} -> ${size2})"
    HELD=$((HELD+1)); continue
  fi

  curl -s -o /dev/null -u "jared:$PW" -X MKCOL "$B/$ROOT" 2>/dev/null
  curl -s -o /dev/null -u "jared:$PW" -X MKCOL "$B/$ROOT/$day" 2>/dev/null

  # Chunked, resumable, size-verified upload (LAN first, then the tunnel) via ncupload.py. A single long PUT through the
  # tunnel failed every time on 2026-11-03 (HTTP 524). Falls back to the old single PUT only if ncupload.py is missing.
  if [ -f "$ROOT_DIR/ncupload.py" ]; then
    if python3 "$ROOT_DIR/ncupload.py" "$f" "Meeting Recordings/$day/$bn" >/tmp/ncupload.$$ 2>&1; then
      code=200; NCOK=1
    else
      code="ncupload: $(tail -1 /tmp/ncupload.$$ | cut -c1-200)"; NCOK=0
    fi
    rm -f /tmp/ncupload.$$
  else
    NCOK=0
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 20 --max-time 900 \
                -u "jared:$PW" -T "$f" "$B/$ROOT/$day/$bn")
  fi

  case "$code" in
    20*)
      # Verify the far end really has all the bytes before trusting the manifest.
      if [ "${NCOK:-0}" = 1 ]; then rsize="$size"; else rsize=$(curl -s -I --connect-timeout 20 -u "jared:$PW" "$B/$ROOT/$day/$bn" \
              | awk 'BEGIN{IGNORECASE=1}/^content-length:/{gsub(/\r/,"");print $2}' | tail -1); fi
      if [ -n "$rsize" ] && [ "$rsize" = "$size" ]; then
        echo "$key" >> "$MANIFEST"
        echo "  uploaded $bn -> $day/ (${size} B verified)"
        UP=$((UP+1))
      else
        echo "  FAILED   $bn size mismatch after PUT (local=$size remote=${rsize:-?}) — not recorded"
        FAIL=$((FAIL+1))
      fi
      ;;
    *)
      echo "  FAILED   $bn (HTTP $code)"
      FAIL=$((FAIL+1))
      ;;
  esac
done

echo "  done: $UP uploaded, $SKIP already current, $HELD held back, $FAIL failed"

# Keep only the most recent entry per filename. A file that is revised (a
# transcript relabelled days later, say) otherwise leaves its old size|mtime
# line behind forever.
if [ -s "$MANIFEST" ]; then
  awk -F'|' '{ last[$1] = $0 } END { for (k in last) print last[k] }' \
      "$MANIFEST" | sort > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"
fi

exit 0
