#!/bin/bash
# Build tesla-http-proxy (teslamotors/vehicle-command, pinned tag) for the Pi. Official golang image, no host Go needed.
set -euo pipefail
TAG=v0.4.1
WANT=49977a18fd68567501d59e16a6c9e4a8b9348544
OUT=/opt/bestly/bin
rm -rf /tmp/vc-build && mkdir -p /tmp/vc-build
git clone --quiet --depth 1 --branch "$TAG" https://github.com/teslamotors/vehicle-command /tmp/vc-build/src
GOT=$(git -C /tmp/vc-build/src rev-parse HEAD)
echo "tag $TAG commit $GOT"
[ "$GOT" = "$WANT" ] || { echo "COMMIT MISMATCH"; exit 1; }
docker pull --quiet golang:1.23-bookworm >/dev/null
IMG=$(docker image inspect golang:1.23-bookworm --format '{{index .RepoDigests 0}}')
echo "builder $IMG"
docker run --rm -v /tmp/vc-build/src:/src -w /src -e CGO_ENABLED=0 -e GOFLAGS=-trimpath "$IMG" \
  go build -o /src/tesla-http-proxy -ldflags "-s -w" ./cmd/tesla-http-proxy
install -m 0755 -o root -g root /tmp/vc-build/src/tesla-http-proxy "$OUT/tesla-http-proxy.new"
mv "$OUT/tesla-http-proxy.new" "$OUT/tesla-http-proxy"
file "$OUT/tesla-http-proxy" 2>/dev/null || true
sha256sum "$OUT/tesla-http-proxy"
echo "$TAG $GOT $IMG" > "$OUT/tesla-http-proxy.version"
"$OUT/tesla-http-proxy" -h 2>&1 | head -5 || true
echo BUILD_DONE
