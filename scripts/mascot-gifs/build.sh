#!/usr/bin/env bash
# Rebuild the welcome-email mascot GIFs (public/mascots/<icon>.gif, served at bestly.tech/mascots/<icon>.gif).
# Run after adding or changing a mascot in src/components/admin/BotMascot.tsx. Needs Playwright's Chromium + Pillow.
set -euo pipefail
cd "$(dirname "$0")/../.."
FRAMES="$(mktemp -d)"
PORT=5188
npx vite --host 127.0.0.1 --port "$PORT" --strictPort >/dev/null 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null; rm -rf "$FRAMES"' EXIT
for _ in $(seq 1 40); do curl -s "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 0.5; done
node scripts/mascot-gifs/capture.mjs "http://127.0.0.1:$PORT/scripts/mascot-gifs/index.html" "$FRAMES" 15
python3 scripts/mascot-gifs/make_gifs.py "$FRAMES" public/mascots
