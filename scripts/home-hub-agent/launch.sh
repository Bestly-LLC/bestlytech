#!/usr/bin/env bash
# Starts the Bestly Home Hub agent (systemd ExecStart).
#
# After a self-update the agent leaves $STATE/update-pending behind and only removes it once
# the new version has polled the server successfully for about a minute. Every start while the
# marker exists is counted here; on the 4th start the new version is considered broken and
# agent.py.prev is put back. The restored agent sees $STATE/rolled-back and raises an alert.
DIR=/opt/bestly/home-hub-agent
STATE=/var/lib/bestly-home-hub
mkdir -p "$STATE"

if [ -f "$STATE/update-pending" ]; then
  n=$(( $(cat "$STATE/update-pending" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$STATE/update-pending"
  if [ "$n" -gt 3 ] && [ -f "$DIR/agent.py.prev" ]; then
    cp -p "$DIR/agent.py" "$DIR/agent.py.bad"
    cp -p "$DIR/agent.py.prev" "$DIR/agent.py"
    rm -f "$STATE/update-pending"
    date -Is > "$STATE/rolled-back"
    echo "launch: the updated agent failed to start 3 times; restored agent.py.prev"
  fi
fi

exec /usr/bin/python3 "$DIR/agent.py"
