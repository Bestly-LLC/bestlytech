#!/bin/sh
# usage (on the Pi): sh deploy.sh <git sha> <path under tools/montage> [more paths]
# Backs each existing file up once as <file>.bak_music_20261012, fetches that commit's copy through repo-read, compiles the Python. Does NOT restart.
set -e
SHA=$1; shift
RG="python3 /opt/bestly/cron/tools/repo_get.py"   # authenticated repo fetch (repo-read function)
D=/opt/bestly/montage
for f in "$@"; do
  mkdir -p "$(dirname "$D/$f")"
  if [ -f "$D/$f" ] && [ ! -f "$D/$f.bak_music_20261012" ]; then cp "$D/$f" "$D/$f.bak_music_20261012"; fi
  $RG "tools/montage/$f" -r "$SHA" -o "$D/$f.new"
  mv "$D/$f.new" "$D/$f"
done
cd $D && python3 -m py_compile worker.py brands/*.py && echo compiled
md5sum "$@"
