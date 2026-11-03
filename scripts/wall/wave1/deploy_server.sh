#!/bin/bash
set -e
cd ~/tmp/wave1
T=$(date +%H%M%S)
H=pi@192.168.1.211
scp -q $H:/opt/bestly/wall/server.py server_live.py
python3 p_server.py server_live.py server.new.py server_block.py
scp -q server.new.py $H:/tmp/server.wave1.py
ssh -o BatchMode=yes $H "cd /opt/bestly/wall && cp server.py server.py.bak_wave1_$T && python3 -c \"import ast;ast.parse(open('/tmp/server.wave1.py').read())\" && cp /tmp/server.wave1.py server.py && sudo systemctl restart bestly-wall && sleep 5 && systemctl is-active bestly-wall && curl -s -m 5 localhost:8099/api/health | head -c 150; sleep 20; journalctl -u bestly-wall --no-pager -n 8 | cut -c1-200"
echo; echo "backup server.py.bak_wave1_$T"
