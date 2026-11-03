#!/bin/bash
set -e
cd ~/tmp/wave1
T=$(date +%H%M%S)
H=pi@192.168.1.211
ssh -o BatchMode=yes $H "cp /opt/bestly/wall/www/wall.html /opt/bestly/wall/www/wall.html.bak_wave1_$T"
scp -q wall.new.html $H:/tmp/wall.wave1.html
ssh -o BatchMode=yes $H "cp /tmp/wall.wave1.html /opt/bestly/wall/www/wall.html && grep -c WAVE1_20261102 /opt/bestly/wall/www/wall.html"
echo "backup wall.html.bak_wave1_$T"
cd ~/tmp/walldown 2>/dev/null; ls ~/tmp/skyap/repo/scripts/wall/signclean/cdp.mjs >/dev/null 2>&1 && (cd ~/tmp/skyap/repo && node scripts/wall/signclean/cdp.mjs --reload) || echo "no cdp helper"
