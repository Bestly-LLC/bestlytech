#!/bin/sh
# usage: deploy_unique.sh <sha>  - put the unique-content Montage files of that commit on the Pi (backup .bak_unique_20261012 first), compile
# Python. Does NOT restart bestly-montage (restart it after: sudo -n systemctl restart bestly-montage). 2026-10-12.
set -e
SHA=$1
RG="python3 /opt/bestly/cron/tools/repo_get.py"   # authenticated repo fetch (repo-read function)
D=/opt/bestly/montage
for f in variety.py worker.py brands/_common.py brands/bestly_agent.py brands/bestly_cloud.py brands/bestly_studio.py brands/cookie_yeti.py brands/inventoryproof.py brands/hoku.py \
         comp/brand/BrandShort.tsx comp/hoku/HokuShort.tsx; do
  [ -f $D/$f ] && { [ -f $D/$f.bak_unique_20261012 ] || cp $D/$f $D/$f.bak_unique_20261012; }
  mkdir -p $(dirname $D/$f)
  $RG "tools/montage/$f" -r "$SHA" -o "$D/$f.new"
  mv $D/$f.new $D/$f
done
cd $D && python3 -m py_compile variety.py worker.py brands/_common.py brands/bestly_agent.py brands/bestly_cloud.py brands/bestly_studio.py brands/cookie_yeti.py brands/inventoryproof.py brands/hoku.py && echo compiled
md5sum variety.py worker.py brands/*.py comp/brand/BrandShort.tsx comp/hoku/HokuShort.tsx
