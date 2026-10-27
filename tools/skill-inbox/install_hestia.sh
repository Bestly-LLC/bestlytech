#!/bin/zsh
# Installs the Skill Inbox Pi jobs on Hestia (owner: Radar). Run from a Mac that has the ssh alias bestly-pi-lan (the Mac mini does).
# Idempotent. Backs up the crontab first. Usage:  zsh tools/skill-inbox/install_hestia.sh   (from the repo root)
# Rollback: restore the backup crontab it names, touch /opt/bestly/cron/state/skill_inbox.OFF, delete the four job files.
set -e
H=bestly-pi-lan; J=/opt/bestly/cron/jobs; D=tools/skill-inbox/jobs; T=$(date +%Y%m%d-%H%M%S)
ssh -o ConnectTimeout=10 -o BatchMode=yes $H 'hostname' >/dev/null || { echo "Hestia is not reachable on $H, nothing changed"; exit 1; }
ssh $H "crontab -l > /opt/bestly/cron/crontab.bak-$T-skillinbox && echo backed up to /opt/bestly/cron/crontab.bak-$T-skillinbox"
scp $D/skill_inbox.py $D/skill_inbox_push.py $D/skill_inbox_watch.py $D/skill_inbox_claude.py $H:$J/
ssh $H "cd $J && python3 -m py_compile skill_inbox.py skill_inbox_push.py skill_inbox_watch.py skill_inbox_claude.py && echo compiled"
ssh $H "/opt/bestly/cron/run.sh skill_inbox_watch; cd $J && python3 skill_inbox.py --dry"
LINES=$(grep -v '^#' tools/skill-inbox/cron.txt | grep -v '^$')
ssh $H "mkdir -p /home/pi/scripts/cron-logs; (crontab -l 2>/dev/null | grep -v 'run.sh skill_inbox'; cat) | crontab -" <<< "$LINES"
ssh $H "crontab -l | grep skill_inbox"
echo "installed. Prove the alert path with:  ssh $H 'cd $J && python3 skill_inbox_watch.py --sim=no-sync'  then run the watchdog again to resolve it."
