#!/bin/sh
# usage (on the Pi): sh install_on_pi.sh <git sha or branch>
# Fetches bestly-unit-frames.tar through the repo-read function and unpacks it into the unit kit (/opt/bestly/social-kit/unit3d). Safe to run again.
set -e
REF=${1:-main}
K=/opt/bestly/social-kit/unit3d
mkdir -p "$K"
python3 /opt/bestly/cron/tools/repo_get.py tools/montage/unit3d/bestly-unit-frames.tar -r "$REF" -o /tmp/bestly-unit-frames.tar
tar -C "$K" -xf /tmp/bestly-unit-frames.tar
rm -f /tmp/bestly-unit-frames.tar
for m in reveal turn glimpse hero; do echo "$m $(ls $K/$m | wc -l)"; done
du -sh "$K"
