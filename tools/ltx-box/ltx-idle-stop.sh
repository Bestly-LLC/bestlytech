#!/bin/bash
# Stop the box after 10 idle minutes (no render, no queued job, no download); hard cap 6 h.
STATE=/run/ltx-last-active
now=$(date +%s)
[ -f $STATE ] || echo $now > $STATE
up=$(cut -d. -f1 /proc/uptime)
util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1)
q=$(curl -s -m 3 http://127.0.0.1:8188/queue | jq '(.queue_running|length)+(.queue_pending|length)' 2>/dev/null)
w=$(curl -s -m 5 "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/ltx-box?op=waiting" | jq '.waiting' 2>/dev/null)
if [ "${util:-0}" -ge 5 ] || [ "${q:-0}" -gt 0 ] || [ "${w:-0}" -gt 0 ] || [ -f /opt/ltx/BUSY ] || pgrep -f "hf download|huggingface-cli" >/dev/null || [ -f /opt/ltx/KEEP_AWAKE ]; then echo $now > $STATE; fi
last=$(cat $STATE)
if [ $((now-last)) -ge 600 ] && [ $up -ge 600 ]; then logger "ltx-idle-stop: idle 10 min, stopping"; shutdown -h now; fi
if [ $up -ge 21600 ] && [ ! -f /opt/ltx/KEEP_AWAKE ]; then logger "ltx-idle-stop: 6 h cap, stopping"; shutdown -h now; fi
