# LTX Box — AI video on the AWS GPU (2026-10-05)

Scout, Spark and any Claude chat make LTX-2.5 clips; cost shows in the chat (estimate, actual, today's total, credit left).

- Box: EC2 `i-0c4af7500e11cf633` "bestly-ltx", g5.2xlarge (A10G 24 GB), us-west-2b. ComfyUI at /opt/ltx/comfy (localhost only, SSM access only).
- `ltx-worker.py` (systemd ltx-worker) claims jobs from edge fn `ltx-box`, runs `make-video.py` (official template video_ltx2_5_t2v), uploads to bucket `ltx-clips`.
- `ltx-idle-stop.sh` stops the box after 10 idle minutes; 6 h cap.
- `dispatch-lambda.py` = AWS Lambda `bestly-ltx-dispatch` (EventBridge every minute): wakes the box for queued jobs; hourly reports the AWS credit balance.
- DB: migration 20261006050000_ltx_video_queue + 20261006060000_ltx_credits. Watchdogs: cron ltx-watch (box + stuck jobs), ltx-credit-watch (credits).
- Links: bestly.tech/v/<code> (vercel.json rewrite to ltx-box ?v=).
