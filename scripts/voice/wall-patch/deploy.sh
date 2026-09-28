#!/bin/bash
# Run on the Mac mini: dry run on fresh copies (node --check + py_compile) -> apply on the Pi under the shared edit lock
# (re-reads live files) -> node --check the live page -> restart bestly-wall + reload the page. Restores wall.html on a bad check.
set -u
export PATH=$PATH:/Users/jaredbest/.local/node/bin
D=/tmp/r4w7/wp; rm -rf $D/dry; mkdir -p $D/dry/www
cd $D || exit 1
scp -q bestly-pi-lan:/opt/bestly/wall/server.py bestly-pi-lan:/opt/bestly/wall/watchdog.py $D/dry/ && scp -q bestly-pi-lan:/opt/bestly/wall/www/wall.html $D/dry/www/ || exit 1
python3 apply.py spec.json $D/dry --dry || { echo "DRY ANCHOR FAILED"; exit 2; }
python3 -m py_compile $D/dry/server.py $D/dry/watchdog.py && echo "dry PYOK" || exit 2
python3 -c "import re;s=open('$D/dry/www/wall.html').read();open('$D/dry/page.js','w').write('\n'.join(re.findall(r'<script>(.*?)</script>',s,re.S)))"
node --check $D/dry/page.js && echo "dry JSOK" || { echo "DRY JS FAILED"; exit 2; }
scp -q apply.py spec.json bestly-pi-lan:/tmp/r4w7/ || exit 3
ssh bestly-pi-lan 'sudo flock /opt/bestly/wall/.edit.lock python3 /tmp/r4w7/apply.py /tmp/r4w7/spec.json /opt/bestly/wall' | tee apply.log
grep -q PYOK apply.log || { echo "APPLY FAILED"; exit 4; }
scp -q bestly-pi-lan:/opt/bestly/wall/www/wall.html $D/live.html
python3 -c "import re;s=open('$D/live.html').read();open('$D/live.js','w').write('\n'.join(re.findall(r'<script>(.*?)</script>',s,re.S)))"
if ! node --check $D/live.js; then
  B=$(grep -o 'backup [^ ]*wall.html.bak_r4w7_[0-9]*' apply.log | awk '{print $2}')
  [ -n "$B" ] && ssh bestly-pi-lan "sudo flock /opt/bestly/wall/.edit.lock cp $B /opt/bestly/wall/www/wall.html && echo restored $B"
  exit 5
fi
echo "live JSOK"
ssh bestly-pi-lan 'python3 -m py_compile /opt/bestly/wall/server.py && sudo systemctl restart bestly-wall && sleep 4 && systemctl is-active bestly-wall && python3 -c "import sys; sys.path.insert(0,\"/opt/bestly/wall\"); import watchdog as w; w.launch_wall(fresh=False)"; echo reloaded'
echo DEPLOYED
