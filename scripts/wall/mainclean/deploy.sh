#!/bin/bash
# usage (from Mac): bash deploy.sh   -- backs up, copies wall.new.html + enrich.new.py to Hestia, restarts bestly-wall
set -e
cd ~/tmp/mainclean
T=$(date +%H%M%S)
H=pi@192.168.1.211
ssh -o BatchMode=yes $H "cd /opt/bestly/wall && [ -f www/wall.html.bak_mainclean_orig ] || cp www/wall.html www/wall.html.bak_mainclean_orig; [ -f aircraft_enrich.py.bak_mainclean_orig ] || cp aircraft_enrich.py aircraft_enrich.py.bak_mainclean_orig; cp www/wall.html www/wall.html.bak_mainclean_$T; cp aircraft_enrich.py aircraft_enrich.py.bak_mainclean_$T"
scp -q wall.new.html $H:/tmp/wall.new.html
scp -q enrich.new.py $H:/tmp/enrich.new.py
ssh -o BatchMode=yes $H "python3 -c \"import ast;ast.parse(open('/tmp/enrich.new.py').read())\" && cp /tmp/enrich.new.py /opt/bestly/wall/aircraft_enrich.py && cp /tmp/wall.new.html /opt/bestly/wall/www/wall.html && sudo systemctl restart bestly-wall && sleep 4 && systemctl is-active bestly-wall && curl -s -m 5 localhost:8099/api/health | head -c 200"
echo; echo "deployed $T"
