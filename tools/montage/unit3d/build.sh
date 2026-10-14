#!/bin/sh
# Re-render the Bestly Cloud unit frames (2026-10-14). Any machine with Node 22: no GPU needed (software WebGL).
# usage: sh build.sh [workdir]     -> <workdir>/kit/{reveal,turn,glimpse,hero}/fNNN.webp + manifest.json, and bestly-unit-frames.tar next to this script
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
W=${1:-$HERE/.work}
mkdir -p "$W/www" "$W/png" && cd "$W"
[ -f package.json ] || npm init -y >/dev/null
npm i three@0.160.1 playwright >/dev/null
npx playwright install chromium >/dev/null
rm -rf www/three www/draco && cp -r node_modules/three www/three && cp -r "$ROOT/public/draco" www/draco && cp "$ROOT/public/models/device-web-split.glb" www/
cp "$HERE/scene.html" www/index.html && cp "$HERE/render.mjs" render.mjs
# frames: hero 4 s, glimpse 4 s, reveal 5 s, turn 8 s (full turn, seamless loop) at 30 fps; about 4 s a frame on 2 cores
node render.mjs hero 120 png/hero && node render.mjs glimpse 120 png/glimpse && node render.mjs reveal 150 png/reveal && node render.mjs turn 240 png/turn
rm -rf kit && python3 "$HERE/frames.py" png kit
tar -C kit -cf "$HERE/bestly-unit-frames.tar" .
ls -la "$HERE/bestly-unit-frames.tar"
